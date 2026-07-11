/**
 * Typed failures of the privacy boundary. Every one of these is a FAIL-CLOSED
 * signal: the safe reaction is to stop the send/restore, not to continue.
 */

/**
 * Thrown by {@link approve} when handed an object the redaction pipeline never
 * minted. A hand-built "pending" could smuggle unreviewed raw text past the
 * guard, so it is rejected outright.
 */
export class ForgedPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForgedPayloadError";
  }
}

/**
 * Thrown by every provider adapter (via {@link assertApproved}) when handed a
 * payload the egress guard never approved — e.g. a structurally identical
 * object hand-built by the caller. The capability is checked by IDENTITY in a
 * module-private registry, so it holds at runtime in plain JS, not only in the
 * type system.
 */
export class UnapprovedPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnapprovedPayloadError";
  }
}

/**
 * Thrown by {@link redactForEgress} when the input already contains text
 * matching the placeholder grammar (`[TYPE_1]`). Such text is
 * indistinguishable from a vault token after redaction, so rehydration would
 * silently substitute vault values into text that never contained them —
 * fail closed instead of weakening reversibility.
 */
export class PlaceholderCollisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlaceholderCollisionError";
  }
}

/**
 * Thrown by {@link rehydrate} when the vault it was handed is not the vault
 * the payload was redacted with. Restoring with the wrong vault silently
 * yields wrong or missing values — fail closed instead.
 */
export class VaultMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultMismatchError";
  }
}
