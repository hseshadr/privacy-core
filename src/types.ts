/** The PII categories the Tier-1 deterministic detector recognizes. */
export type EntityType =
  | "CARD"
  | "IBAN"
  | "SSN"
  | "EMAIL"
  | "PHONE"
  | "ACCOUNT"
  | "ROUTING"
  | "AMOUNT"
  | "DATE"
  | "NAME"
  | "MERCHANT";

/** A detected PII span in the source text. */
export interface Span {
  readonly type: EntityType;
  readonly value: string;
  readonly start: number;
  readonly end: number;
}

/** Opaque handle to a vault holding token -> raw-value mappings. */
export interface VaultRef {
  readonly id: string;
}

/**
 * An audit record — metadata only, never raw PII (except the explicit bypass
 * case, which records the human-supplied reason). Modelled as a discriminated
 * union on `kind`, so the fields that exist for each event are exact: `redact`
 * and `approve` always carry `placeholders`, `unsafe-bypass` always carries
 * `reason`, and no entry can be constructed with the wrong shape.
 */
export type AuditEntry =
  | RedactAuditEntry
  | ApproveAuditEntry
  | UnsafeBypassAuditEntry;

/** A redaction proposal was minted, listing the placeholder tokens produced. */
export interface RedactAuditEntry {
  readonly kind: "redact";
  readonly at: number;
  readonly placeholders: readonly string[];
}

/** A pending redaction was explicitly approved for egress. */
export interface ApproveAuditEntry {
  readonly kind: "approve";
  readonly at: number;
  readonly placeholders: readonly string[];
}

/** Raw text was sent via the audited escape hatch, recording the human reason. */
export interface UnsafeBypassAuditEntry {
  readonly kind: "unsafe-bypass";
  readonly at: number;
  readonly reason: string;
}

/** A sink the caller supplies to receive append-only audit entries. */
export type AuditSink = (entry: AuditEntry) => void;

/** A provider's reply, still in placeholder form until rehydrated locally. */
export interface RedactedResponse {
  readonly redactedText: string;
}
