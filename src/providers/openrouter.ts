import {
  assertApproved,
  type LlmProvider,
  type RedactedPayload,
} from "../egress.js";
import type { RedactedResponse } from "../types.js";

export interface OpenRouterConfig {
  readonly apiKey: string;
  readonly model: string;
  readonly endpoint?: string;
}

const DEFAULT_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

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
    const res = await fetch(this.cfg.endpoint ?? DEFAULT_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.cfg.apiKey}`,
      },
      body,
    });
    if (!res.ok) {
      throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
    }
    const json = (await res.json()) as ChatCompletion;
    const content = json.choices?.[0]?.message?.content ?? "";
    return { redactedText: content };
  }
}
