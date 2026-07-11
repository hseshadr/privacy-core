import {
  assertApproved,
  type LlmProvider,
  type RedactedPayload,
} from "../egress.js";
import type { RedactedResponse } from "../types.js";

/**
 * Offline fallback provider — runs with NO API key. It does NOT touch the
 * network; it echoes a plausible analyst reply that references the same
 * placeholders, so the rehydrate step has something to restore. This is what
 * makes the demo runnable cold, with the wow-loop fully intact.
 */
export class NoLLMProvider implements LlmProvider {
  async complete(payload: RedactedPayload): Promise<RedactedResponse> {
    // Runtime guard: even the offline echo refuses a forged payload.
    assertApproved(payload);
    const tokens = [...payload.redactedText.matchAll(/\[[A-Z]+_\d+\]/g)].map(
      (m) => m[0],
    );
    const list = tokens.length ? tokens.join(", ") : "no sensitive values";
    const redactedText = [
      "Summary (offline echo — no API key set):",
      `I reviewed your statement. It referenced ${tokens.length} redacted value(s): ${list}.`,
      "The largest charge was [AMOUNT_1], and the account holder is [NAME_1].",
      "(Set VITE_OPENROUTER_API_KEY to call a real model.)",
    ].join("\n");
    return { redactedText };
  }
}
