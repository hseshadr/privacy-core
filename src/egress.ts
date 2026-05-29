import type { AuditSink, VaultRef } from "./types.js";

/**
 * The egress boundary, expressed as a type.
 *
 * `RedactedPayload` is a branded type: the brand is a COMPILE-TIME-ONLY phantom
 * field (no runtime representation), so the only way to obtain a value of this
 * type is through this module's factory. A raw `string` — or a hand-rolled
 * object literal that merely sets `redactedText` — is not assignable here, which
 * is exactly what makes "raw text reaching a provider" a type error.
 */
declare const brand: unique symbol;

interface Branded {
  readonly [brand]: "RedactedPayload";
}

export type RedactedPayload = Branded & {
  readonly __brand: "RedactedPayload";
  readonly redactedText: string;
  readonly vaultRef: VaultRef;
  readonly approvedAt: number;
};

/** The egress boundary: providers accept ONLY a branded RedactedPayload. */
export interface LlmProvider {
  complete(
    payload: RedactedPayload,
  ): Promise<import("./types.js").RedactedResponse>;
}

/**
 * Internal-only factory for the brand. Used by the redact pipeline and the
 * audited bypass to mint payloads. It is intentionally NOT re-exported from the
 * public barrel — callers cannot forge a payload, only earn one.
 */
export function mintRedactedPayload(
  redactedText: string,
  vaultRef: VaultRef,
): RedactedPayload {
  // The phantom `brand` field exists only in the type system; at runtime we
  // build the plain object and assert the brand here — the single trusted spot.
  return {
    __brand: "RedactedPayload",
    redactedText,
    vaultRef,
    approvedAt: Date.now(),
  } as RedactedPayload;
}

/**
 * The explicit, named, audited escape hatch — the ONLY way raw text can be
 * branded for a provider without going through detection. It cannot be silent:
 * it always emits an audit entry recording the human-supplied reason.
 */
export function unsafeBypass(
  raw: string,
  reason: string,
  audit: AuditSink,
): RedactedPayload {
  audit({ kind: "unsafe-bypass", at: Date.now(), reason });
  return mintRedactedPayload(raw, { id: "unsafe-no-vault" });
}
