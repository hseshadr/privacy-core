import type { LlmProvider } from "../egress.js";
import { MissingApiKeyError } from "../errors.js";
import { NoLLMProvider } from "./nollm.js";
import { OpenRouterProvider } from "./openrouter.js";

/** Config for {@link makeProvider}. Host apps source these from their own env. */
export interface ProviderConfig {
  // `string | undefined` (not optional) so env-sourced values — which are always
  // `string | undefined` — pass directly under exactOptionalPropertyTypes.
  readonly apiKey?: string | undefined;
  readonly model?: string | undefined;
  // Override the chat/completions URL — e.g. a same-origin dev proxy that keeps
  // the API key server-side instead of shipping it to the browser.
  readonly endpoint?: string | undefined;
  readonly timeoutMs?: number | undefined;
  readonly maxResponseBytes?: number | undefined;
  // Opt IN to the offline echo provider when no API key is present. It is a
  // demo/test convenience; without this flag a missing key fails closed rather
  // than silently downgrading a real deployment to a no-op provider.
  readonly allowOffline?: boolean | undefined;
}

/** A live provider plus a label for the UI to show which one is selected. */
export interface SelectedProvider {
  readonly provider: LlmProvider;
  readonly label: string;
}

const DEFAULT_MODEL = "openai/gpt-4o-mini";

/**
 * Pick a provider from config. With a non-empty API key, the OpenRouter path is
 * selected. With no key, the offline echo is returned ONLY when the caller
 * explicitly opts in via `allowOffline: true`; otherwise it throws
 * {@link MissingApiKeyError} rather than silently downgrading to a no-op
 * provider. The library stays env-agnostic — the host (e.g. the Vite demo)
 * reads its own env and passes the values in.
 */
export function makeProvider(config: ProviderConfig = {}): SelectedProvider {
  const model = config.model ?? DEFAULT_MODEL;
  if (config.apiKey?.trim()) {
    return {
      provider: new OpenRouterProvider({
        apiKey: config.apiKey,
        model,
        endpoint: config.endpoint,
        timeoutMs: config.timeoutMs,
        maxResponseBytes: config.maxResponseBytes,
      }),
      label: `OpenRouter · ${model}`,
    };
  }
  if (config.allowOffline) {
    return {
      provider: new NoLLMProvider(),
      label: "NoLLMProvider (offline echo)",
    };
  }
  throw new MissingApiKeyError();
}
