import { UnresolvedPlaceholderError, VaultMismatchError } from "./errors.js";
import type { VaultRef } from "./types.js";
import type { Vault } from "./vault.js";

/** The placeholder grammar `rehydrate` restores (same shape `redact` mints). */
const PLACEHOLDER = /\[[A-Z]+_\d+\]/g;

/**
 * Restore real values locally: walk every [TYPE_n] placeholder in the text and
 * swap in its raw value from the vault. This is the close of the loop — it runs
 * on-device, after the provider replied, so the real values are restored
 * without ever having crossed the wire.
 *
 * Vault binding is MANDATORY: pass the payload's `vaultRef` so the restore is
 * bound to the vault the text was actually redacted with. This fails closed in
 * two ways instead of ever silently substituting a wrong value:
 *
 *  - Wrong vault → {@link VaultMismatchError}. Without the binding, an
 *    overlapping `[NAME_1]`/`[CARD_1]` from a *different* vault would resolve to
 *    the wrong person's real value.
 *  - A placeholder the bound vault cannot resolve → {@link
 *    UnresolvedPlaceholderError}. A model-invented `[CARD_9]`, or text redacted
 *    with another vault, is an anomaly — stop, don't leave a lookalike token.
 */
export function rehydrate(
  redactedText: string,
  vault: Vault,
  expectedRef: VaultRef,
): string {
  if (vault.ref.id !== expectedRef.id) {
    throw new VaultMismatchError(
      `vault "${vault.ref.id}" does not match the payload's vault ` +
        `"${expectedRef.id}" — restoring with the wrong vault yields wrong values`,
    );
  }
  return redactedText.replace(PLACEHOLDER, (token) => {
    const value = vault.resolve(token);
    if (value === undefined) {
      throw new UnresolvedPlaceholderError(
        `placeholder ${token} is not in vault "${vault.ref.id}" — under a bound ` +
          "vault an unresolvable token is an anomaly (a model-invented token, or " +
          "text redacted with a different vault), so rehydrate fails closed",
      );
    }
    return value;
  });
}
