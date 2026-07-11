import { detect } from "./detect/detector.js";
import { mintPendingRedaction, type PendingRedaction } from "./egress.js";
import { PlaceholderCollisionError } from "./errors.js";
import type { AuditSink } from "./types.js";
import type { Vault } from "./vault.js";

/**
 * The placeholder grammar (same shape `rehydrate` restores). Input containing
 * it would be indistinguishable from vault tokens after redaction.
 */
const PLACEHOLDER_SHAPE = /\[[A-Z]+_\d+\]/;

/**
 * THE ONLY legitimate constructor of a PendingRedaction.
 *
 * Detects PII, writes each raw value into the vault, and replaces it with a
 * stable placeholder. The result is a review PROPOSAL — it is NOT sendable.
 * Only the explicit `approve()` step turns it into the RedactedPayload
 * capability a provider will accept, and that holds even when detection finds
 * nothing: zero detections never auto-approve.
 */
export async function redactForEgress(
  raw: string,
  vault: Vault,
  audit?: AuditSink,
): Promise<PendingRedaction> {
  const collision = raw.match(PLACEHOLDER_SHAPE);
  if (collision) {
    throw new PlaceholderCollisionError(
      `input already contains placeholder-shaped text ("${collision[0]}") — ` +
        "redacting it would make restore ambiguous, so the redaction is refused",
    );
  }
  const spans = detect(raw);
  // Rebuild text left-to-right, swapping each span for its vault token.
  let out = "";
  let cursor = 0;
  const placeholders: string[] = [];
  for (const s of spans) {
    out += raw.slice(cursor, s.start);
    const token = vault.tokenize(s.type, s.value);
    out += token;
    placeholders.push(token);
    cursor = s.end;
  }
  out += raw.slice(cursor);
  audit?.({ kind: "redact", at: Date.now(), placeholders });
  return mintPendingRedaction(out, vault.ref, placeholders);
}
