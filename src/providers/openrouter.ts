import {
  assertApproved,
  type LlmProvider,
  type RedactedPayload,
} from "../egress.js";
import {
  MalformedProviderResponseError,
  ProviderResponseTooLargeError,
  ProviderTimeoutError,
} from "../errors.js";
import type { RedactedResponse } from "../types.js";

export interface OpenRouterConfig {
  readonly apiKey: string;
  readonly model: string;
  readonly endpoint?: string | undefined;
  /** End-to-end request + response deadline in milliseconds. */
  readonly timeoutMs?: number | undefined;
  /** Maximum UTF-8 response body size accepted before JSON parsing. */
  readonly maxResponseBytes?: number | undefined;
}

const DEFAULT_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
export const DEFAULT_OPENROUTER_TIMEOUT_MS = 30_000;
export const DEFAULT_OPENROUTER_MAX_RESPONSE_BYTES = 1_048_576;

const SYSTEM_PROMPT =
  "You are a personal finance assistant. The user's text has had sensitive " +
  "values replaced by typed placeholders like [CARD_1] or [NAME_2]. Reason " +
  "about the placeholders as opaque tokens and reuse the SAME placeholders in " +
  "your reply. Never invent real values.";

interface ChatCompletion {
  readonly choices?: ReadonlyArray<{
    readonly message?: { readonly content?: string };
  }>;
}

/**
 * OpenRouter (OpenAI-compatible chat/completions). It accepts ONLY a
 * RedactedPayload, so by construction only placeholder text can ever be put on
 * the wire — the raw values are never in scope here.
 */
export class OpenRouterProvider implements LlmProvider {
  constructor(private readonly cfg: OpenRouterConfig) {}

  async complete(payload: RedactedPayload): Promise<RedactedResponse> {
    // Runtime guard: a structurally forged payload never reaches the wire.
    assertApproved(payload);
    const body = JSON.stringify({
      model: this.cfg.model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: payload.redactedText },
      ],
    });
    const timeoutMs = this.cfg.timeoutMs ?? DEFAULT_OPENROUTER_TIMEOUT_MS;
    const maxResponseBytes =
      this.cfg.maxResponseBytes ?? DEFAULT_OPENROUTER_MAX_RESPONSE_BYTES;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(this.cfg.endpoint ?? DEFAULT_ENDPOINT, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.cfg.apiKey}`,
        },
        body,
        signal: controller.signal,
      });
      const responseText = await readResponseText(res, maxResponseBytes);
      if (!res.ok) {
        throw new Error(`OpenRouter ${res.status}: ${responseText}`);
      }
      const json = JSON.parse(responseText) as ChatCompletion;
      const content = json.choices?.[0]?.message?.content;
      if (typeof content !== "string") {
        // A missing/non-string message is a broken reply. Returning "" here
        // would hand back an empty answer indistinguishable from a real one.
        throw new MalformedProviderResponseError();
      }
      return { redactedText: content };
    } catch (error) {
      if (controller.signal.aborted) {
        throw new ProviderTimeoutError(timeoutMs);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function readResponseText(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new ProviderResponseTooLargeError(maxBytes);
  }
  if (!response.body) {
    return readUnstreamedText(response, maxBytes);
  }
  return readStreamedText(response.body, maxBytes);
}

/**
 * No stream to meter chunk-by-chunk, so the cap can only be enforced BEFORE
 * buffering via the declared content-length. A missing (or non-numeric) header
 * cannot bound `.text()`, so we fail closed rather than buffer an unbounded body
 * — the same stance the streamed path takes on overflow. A lying content-length
 * (declared small, actual large) is still caught by the post-read byte check.
 */
async function readUnstreamedText(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const header = response.headers.get("content-length");
  // `Number(null)` is 0 (finite), so absence must be detected from the raw
  // header, not from the coerced number.
  const declared = header === null ? Number.NaN : Number(header);
  if (!Number.isFinite(declared)) {
    throw new ProviderResponseTooLargeError(maxBytes);
  }
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new ProviderResponseTooLargeError(maxBytes);
  }
  return text;
}

/** Read a body stream, cancelling and failing closed the instant it exceeds the cap. */
async function readStreamedText(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      totalBytes += chunk.value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new ProviderResponseTooLargeError(maxBytes);
      }
      chunks.push(decoder.decode(chunk.value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join("");
  } finally {
    reader.releaseLock();
  }
}
