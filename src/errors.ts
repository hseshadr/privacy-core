/**
 * Typed failures of the privacy boundary. Every one of these is a FAIL-CLOSED
 * signal: the safe reaction is to stop the send/restore, not to continue.
 *
 * They share one base, {@link PrivacyCoreError}, so a consumer can catch every
 * boundary failure with a single `instanceof PrivacyCoreError` while still
 * discriminating the specific class when it needs to. The base sets `name` from
 * the concrete subclass, so no subclass has to restate its own name.
 */

/** Common base for every typed failure this package throws. */
export abstract class PrivacyCoreError extends Error {
  constructor(message: string) {
    super(message);
    // `new.target` is the concrete subclass being constructed, so its name is
    // set once here rather than repeated in every subclass constructor.
    this.name = new.target.name;
  }
}

/**
 * Thrown by {@link redactForEgress} before detection when the input exceeds
 * the bounded UTF-8 budget. Refusing before vault writes or audit callbacks
 * keeps oversized hostile input from turning the detector into a client-side
 * resource exhaustion path.
 */
export class InputTooLargeError extends PrivacyCoreError {
  readonly maxBytes: number;

  constructor(maxBytes: number) {
    super(`redaction input exceeds the ${maxBytes}-byte UTF-8 limit`);
    this.maxBytes = maxBytes;
  }
}

/** Thrown when an OpenRouter request exceeds its bounded end-to-end deadline. */
export class ProviderTimeoutError extends PrivacyCoreError {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`OpenRouter request timed out after ${timeoutMs} ms`);
    this.timeoutMs = timeoutMs;
  }
}

/** Thrown before JSON parsing when an OpenRouter response exceeds its byte cap. */
export class ProviderResponseTooLargeError extends PrivacyCoreError {
  readonly maxBytes: number;

  constructor(maxBytes: number) {
    super(`OpenRouter response exceeds the ${maxBytes}-byte limit`);
    this.maxBytes = maxBytes;
  }
}

/**
 * Thrown when an OpenRouter reply cannot be read as an assistant message —
 * missing `choices[0].message.content`, or a `content` that is not a string.
 * Silently returning `""` here would hand the caller an empty answer that is
 * indistinguishable from a real one, hiding an upstream/API contract break, so
 * the reader fails closed instead.
 */
export class MalformedProviderResponseError extends PrivacyCoreError {
  constructor() {
    super(
      "OpenRouter response did not contain a string assistant message at " +
        "choices[0].message.content — refusing to return an empty answer that " +
        "would mask the malformed reply",
    );
  }
}

/**
 * Thrown by {@link makeProvider} when no API key is supplied AND the offline
 * echo was not explicitly enabled. The offline echo is a demo/test convenience,
 * never a silent production fallback: a blank key must fail loudly rather than
 * quietly downgrade a real deployment to a no-op provider.
 */
export class MissingApiKeyError extends PrivacyCoreError {
  constructor() {
    super(
      "makeProvider received no usable API key and the offline echo was not " +
        "enabled — pass a non-empty apiKey, or set allowOffline: true to opt " +
        "into the offline echo provider (intended for demos and tests)",
    );
  }
}

/**
 * Thrown by {@link approve} when handed an object the redaction pipeline never
 * minted. A hand-built "pending" could smuggle unreviewed raw text past the
 * guard, so it is rejected outright.
 */
export class ForgedPayloadError extends PrivacyCoreError {}

/**
 * Thrown by every provider adapter (via {@link assertApproved}) when handed a
 * payload the egress guard never approved — e.g. a structurally identical
 * object hand-built by the caller. The capability is checked by IDENTITY in a
 * module-private registry, so it holds at runtime in plain JS, not only in the
 * type system.
 */
export class UnapprovedPayloadError extends PrivacyCoreError {}

/**
 * Thrown by {@link redactForEgress} when the input already contains text
 * matching the placeholder grammar (`[TYPE_1]`). Such text is
 * indistinguishable from a vault token after redaction, so rehydration would
 * silently substitute vault values into text that never contained them —
 * fail closed instead of weakening reversibility.
 */
export class PlaceholderCollisionError extends PrivacyCoreError {}

/**
 * Thrown by {@link rehydrate} when the vault it was handed is not the vault
 * the payload was redacted with. Restoring with the wrong vault silently
 * yields wrong or missing values — fail closed instead.
 */
export class VaultMismatchError extends PrivacyCoreError {}

/**
 * Thrown by {@link rehydrate} when a placeholder-shaped token (`[TYPE_n]`) in
 * the reply cannot be resolved by the bound vault. Under a bound vault an
 * unresolvable token is an anomaly — the reply was redacted with a different
 * vault, or a model invented a placeholder — so the safe reaction is to stop,
 * not to leave a token that merely *looks* like redaction in place.
 */
export class UnresolvedPlaceholderError extends PrivacyCoreError {}

/**
 * Thrown by {@link redactForEgress} when a value the detector recognised (and
 * wrote into the vault) still appears verbatim in the redacted output — e.g. a
 * second, unlabelled copy of an account number that the label-gated rule only
 * matched once. Emitting it would put a value the tool already knows is PII on
 * the wire, so redaction fails closed instead of leaking it. The reversibility
 * backstop is the human preview; this is the belt to that suspenders.
 */
export class ResidualValueError extends PrivacyCoreError {}
