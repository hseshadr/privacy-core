import type { Vault } from "./vault.js";

/**
 * Restore real values locally: walk every [TYPE_n] placeholder in the text and
 * swap in its raw value from the vault. Unknown tokens are left untouched. This
 * is the close of the loop — it runs on-device, after the provider replied, so
 * the real values are restored without ever having crossed the wire.
 */
export function rehydrate(redactedText: string, vault: Vault): string {
  return redactedText.replace(/\[[A-Z]+_\d+\]/g, (token) => {
    return vault.resolve(token) ?? token;
  });
}
