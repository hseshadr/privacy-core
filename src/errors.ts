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
