import type { LlmProvider } from "../egress.js";
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
}

/** A live provider plus a label for the UI to show which one is selected. */
export interface SelectedProvider {
  readonly provider: LlmProvider;
  readonly label: string;
}

const DEFAULT_MODEL = "openai/gpt-4o-mini";

/**
 * Pick a provider from config. With a non-empty API key, the OpenRouter path is
 * selected; otherwise it falls back to the offline echo so the demo runs cold.
 * The library stays env-agnostic — the host (e.g. the Vite demo) reads its own
 * env and passes the values in.
 */
export function makeProvider(config: ProviderConfig = {}): SelectedProvider {
  const model = config.model ?? DEFAULT_MODEL;
  if (config.apiKey?.trim()) {
    return {
      provider: new OpenRouterProvider({
        apiKey: config.apiKey,
        model,
        endpoint: config.endpoint,
      }),
      label: `OpenRouter · ${model}`,
    };
  }
  return {
    provider: new NoLLMProvider(),
    label: "NoLLMProvider (offline echo)",
  };
}
