import { VaultMismatchError } from "./errors.js";
import type { VaultRef } from "./types.js";
import type { Vault } from "./vault.js";

/**
 * Restore real values locally: walk every [TYPE_n] placeholder in the text and
 * swap in its raw value from the vault. Unknown tokens are left untouched. This
 * is the close of the loop — it runs on-device, after the provider replied, so
 * the real values are restored without ever having crossed the wire.
 *
 * Pass the payload's `vaultRef` as `expectedRef` to bind the restore to the
 * vault the text was actually redacted with — a mismatched vault fails closed
 * with {@link VaultMismatchError} instead of silently restoring wrong values.
 */
export function rehydrate(
  redactedText: string,
  vault: Vault,
  expectedRef?: VaultRef,
): string {
  if (expectedRef && vault.ref.id !== expectedRef.id) {
    throw new VaultMismatchError(
      `vault "${vault.ref.id}" does not match the payload's vault ` +
        `"${expectedRef.id}" — restoring with the wrong vault yields wrong values`,
    );
  }
  return redactedText.replace(/\[[A-Z]+_\d+\]/g, (token) => {
    return vault.resolve(token) ?? token;
  });
}
