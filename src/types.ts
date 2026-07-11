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

/** An audit record — metadata only, never raw PII (except the explicit bypass case). */
export interface AuditEntry {
  readonly kind: "redact" | "approve" | "unsafe-bypass";
  readonly at: number;
  readonly placeholders?: readonly string[];
  readonly reason?: string;
}

/** A sink the caller supplies to receive append-only audit entries. */
export type AuditSink = (entry: AuditEntry) => void;

/** A provider's reply, still in placeholder form until rehydrated locally. */
export interface RedactedResponse {
  readonly redactedText: string;
}
