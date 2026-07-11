import { ForgedPayloadError, UnapprovedPayloadError } from "./errors.js";
import type { AuditSink, VaultRef } from "./types.js";

/**
 * The egress boundary, expressed as a capability earned in two explicit steps:
 *
 *  1. `redactForEgress` mints a {@link PendingRedaction} — a review PROPOSAL.
 *     It is not sendable; no provider accepts it. Zero detections do NOT relax
 *     this: an empty redaction set still requires the explicit review step,
 *     because "the detector found nothing" is not the same as "a reviewer
 *     approved this content to leave the device".
 *  2. `approve` — the explicit review action — converts a pipeline-minted
 *     pending into a {@link RedactedPayload}, the sendable capability.
 *
 * Both types carry a compile-time phantom brand (a raw `string` or hand-rolled
 * object literal is not assignable), and every value minted here is registered
 * in a module-private WeakSet so the capability also holds at RUNTIME in plain
 * JS — a structurally identical forgery is rejected by {@link approve} and by
 * every provider adapter (via {@link assertApproved}).
 */
declare const brand: unique symbol;

interface Branded<B extends string> {
  readonly [brand]: B;
}

/** A redaction proposal awaiting explicit review. NOT sendable. */
export type PendingRedaction = Branded<"PendingRedaction"> & {
  readonly redactedText: string;
  readonly vaultRef: VaultRef;
  /** The placeholder tokens the reviewer is being asked to approve. */
  readonly placeholders: readonly string[];
};

/** The sendable capability: reviewed, redacted content — never raw content. */
export type RedactedPayload = Branded<"RedactedPayload"> & {
  readonly redactedText: string;
  readonly vaultRef: VaultRef;
  readonly approvedAt: number;
};

/** The egress boundary: providers accept ONLY an approved RedactedPayload. */
export interface LlmProvider {
  complete(
    payload: RedactedPayload,
  ): Promise<import("./types.js").RedactedResponse>;
}

/** Module-private: every pending the redaction pipeline actually minted. */
const mintedPending = new WeakSet<object>();

/**
 * Module-private: every payload the guard actually approved. A WeakSet keyed
 * by object IDENTITY — callers cannot reproduce membership by building a
 * structurally identical object, and entries vanish with the payloads.
 */
const approvedPayloads = new WeakSet<object>();

/**
 * Runtime half of the egress guard. Every provider adapter MUST call this
 * before doing anything with a payload; it rejects any object that was not
 * minted by {@link approve} or {@link unsafeBypass} — TypeScript branding
 * alone cannot stop a plain-JS caller, this check does.
 */
export function assertApproved(payload: RedactedPayload): void {
  if (!approvedPayloads.has(payload)) {
    throw new UnapprovedPayloadError(
      "payload was not approved by the egress guard — providers only accept " +
        "the capability minted by approve() (or the audited unsafeBypass)",
    );
  }
}

/**
 * Internal factory used by the redact pipeline. Intentionally NOT re-exported
 * from the public barrel — a pending is earned from detection, not built.
 */
export function mintPendingRedaction(
  redactedText: string,
  vaultRef: VaultRef,
  placeholders: readonly string[],
): PendingRedaction {
  const pending = Object.freeze({ redactedText, vaultRef, placeholders });
  mintedPending.add(pending);
  return pending as PendingRedaction;
}

/**
 * THE explicit approval step — the only way a PendingRedaction becomes
 * sendable. Approval is a deliberate human/reviewer action, never a side
 * effect: even a zero-detection result passes through here. It refuses any
 * object the pipeline did not mint (a hand-built "pending" would smuggle
 * unreviewed text past the guard).
 *
 * The `audit` sink is REQUIRED — an approval that no one can observe is not
 * an approval this boundary will grant. (Same stance as {@link unsafeBypass}.)
 */
export function approve(
  pending: PendingRedaction,
  audit: AuditSink,
): RedactedPayload {
  if (!mintedPending.has(pending)) {
    throw new ForgedPayloadError(
      "approve() only accepts a PendingRedaction minted by redactForEgress — " +
        "hand-built objects are rejected so unreviewed text cannot be approved",
    );
  }
  const payload = Object.freeze({
    redactedText: pending.redactedText,
    vaultRef: pending.vaultRef,
    approvedAt: Date.now(),
  }) as RedactedPayload;
  approvedPayloads.add(payload);
  audit({
    kind: "approve",
    at: payload.approvedAt,
    placeholders: pending.placeholders,
  });
  return payload;
}

/**
 * Wrap any {@link LlmProvider} so the runtime egress guard runs at ONE
 * chokepoint before the inner provider ever sees the payload. TypeScript's
 * brand stops a raw string at compile time, but a hand-rolled or third-party
 * provider could still forget to call {@link assertApproved} at runtime — this
 * wrapper makes that impossible for any provider obtained through it.
 */
export function guardedProvider(inner: LlmProvider): LlmProvider {
  return {
    async complete(payload) {
      assertApproved(payload);
      return inner.complete(payload);
    },
  };
}

/**
 * The explicit, named, audited escape hatch — the ONLY way raw text can be
 * made sendable without going through detection + review. It cannot be silent:
 * it always emits an audit entry recording the human-supplied reason.
 */
export function unsafeBypass(
  raw: string,
  reason: string,
  audit: AuditSink,
): RedactedPayload {
  audit({ kind: "unsafe-bypass", at: Date.now(), reason });
  const payload = Object.freeze({
    redactedText: raw,
    vaultRef: { id: "unsafe-no-vault" },
    approvedAt: Date.now(),
  }) as RedactedPayload;
  approvedPayloads.add(payload);
  return payload;
}
