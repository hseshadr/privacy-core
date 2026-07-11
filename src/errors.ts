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
