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
 * makes the demo runnable cold, with the full redact → send → rehydrate loop
 * intact.
 */
export class NoLLMProvider implements LlmProvider {
  async complete(payload: RedactedPayload): Promise<RedactedResponse> {
    // Runtime guard: even the offline echo refuses a forged payload.
    assertApproved(payload);
    const tokens = [...payload.redactedText.matchAll(/\[[A-Z]+_\d+\]/g)].map(
      (m) => m[0],
    );
    const list = tokens.length ? tokens.join(", ") : "no sensitive values";
    const lines = [
      "Summary (offline echo — no API key set):",
      `I reviewed your statement. It referenced ${tokens.length} redacted value(s): ${list}.`,
    ];
    // Only ever echo placeholders that ACTUALLY came from this payload — the
    // vault can resolve those. Inventing a token the vault never minted would
    // (correctly) trip rehydrate's fail-closed guard.
    if (tokens[0]) {
      lines.push(`The first flagged value, ${tokens[0]}, is the one to check.`);
    }
    lines.push(
      "(Set OPENROUTER_API_KEY + VITE_USE_OPENROUTER=1 to call a real model via the dev proxy.)",
    );
    return { redactedText: lines.join("\n") };
  }
}
