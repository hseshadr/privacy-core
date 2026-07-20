/**
 * Egress decisions, sealed as signed Avow effect receipts.
 *
 * The Egress Guard already gates whether redacted text may leave the device
 * (see {@link file://./egress.ts}). This module makes that decision *provable*:
 * every allow or deny is expressed as a Writ-style governed effect — an
 * `EgressSubject` — and signed into a tamper-evident receipt via the shared
 * `@edgeproc/avow` envelope. A holder of the signer's public key can later
 * verify exactly which egress decisions were taken, without ever seeing the
 * content.
 *
 * INVARIANT — no plaintext in a receipt: the subject stores only
 * `args_digest = sha256(canonical({ redactedText }))`, never the text itself,
 * and never the raw PII the vault holds. A receipt records *that* a decision
 * happened over *this* content, not the content.
 */

import { contentHash, type SignedReceipt, signPayload } from "@edgeproc/avow";

// Re-exported so receipt verifiers can recompute `args_digest` with the SAME
// canonical hash the sealer used, without importing @edgeproc/avow directly.
export { contentHash } from "@edgeproc/avow";

/** Whether the guard let the redacted text leave the device, or refused it. */
export type EgressDecision = "allow" | "deny";

/**
 * The governed effect: sending redacted text to a named provider was either
 * allowed or denied. A type alias (not an interface) so it satisfies the
 * `@edgeproc/avow` `JsonValue` constraint via TypeScript's implicit index
 * signature — the subject IS a plain JSON object.
 */
export type EgressSubject = {
  readonly action: "llm.egress";
  readonly provider: string;
  readonly args_digest: string;
  readonly decision: EgressDecision;
  readonly detector_version: string;
};

/**
 * Version tag for the Tier-1 deterministic detector ruleset. Bumping the
 * ruleset bumps this so a verifier can tell which detector version screened
 * the content behind a receipt.
 */
export const DETECTOR_VERSION = "1";

/** What the caller knows at the egress decision point. */
export interface EgressSubjectInput {
  readonly provider: string;
  /** The redacted (already-scrubbed) text — hashed, never stored verbatim. */
  readonly redactedText: string;
  readonly decision: EgressDecision;
  readonly detectorVersion?: string;
}

/** Build the signed subject, digesting the redacted text and nothing else. */
export async function buildEgressSubject(
  input: EgressSubjectInput,
): Promise<EgressSubject> {
  return {
    action: "llm.egress",
    provider: input.provider,
    args_digest: await contentHash({ redactedText: input.redactedText }),
    decision: input.decision,
    detector_version: input.detectorVersion ?? DETECTOR_VERSION,
  };
}

/**
 * How a guarded provider seals its decisions. Given to
 * {@link file://./egress.ts guardedProvider}, every allow AND every fail-closed
 * deny at that chokepoint is signed and handed to `onReceipt` — the guard
 * cannot act silently once governed.
 */
export interface EgressGovernance {
  /** Provider name recorded in each receipt (e.g. "openrouter"). */
  readonly provider: string;
  /** Ed25519 seed (hex) that signs the receipts. */
  readonly seedHex: string;
  /** Receives every sealed decision receipt. */
  readonly onReceipt: (receipt: SignedReceipt<EgressSubject>) => void;
  readonly detectorVersion?: string;
}

/** Seal an egress decision into a signed, pinned-key-verifiable receipt. */
export async function sealEgressReceipt(
  input: EgressSubjectInput,
  seedHex: string,
): Promise<SignedReceipt<EgressSubject>> {
  return signPayload(await buildEgressSubject(input), seedHex);
}
