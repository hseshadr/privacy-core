import { detect } from "./detect/detector.js";
import { mintRedactedPayload, type RedactedPayload } from "./egress.js";
import type { AuditSink } from "./types.js";
import type { Vault } from "./vault.js";

/**
 * THE ONLY legitimate constructor of a RedactedPayload.
 *
 * Detects PII, writes each raw value into the vault, replaces it with a stable
 * placeholder, and brands the result so the Egress Guard will accept it. The
 * raw values never leave the vault; only the branded, placeholder-only payload
 * can be handed to a provider.
 */
export async function redactForEgress(
  raw: string,
  vault: Vault,
  audit?: AuditSink,
): Promise<RedactedPayload> {
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
  return mintRedactedPayload(out, vault.ref);
}
