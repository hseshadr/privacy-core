import type { EntityType, VaultRef } from "./types.js";

let nextVaultId = 1;

/**
 * In-memory reversible token<->value map (v0 scope).
 *
 * Stable placeholders: the same raw value always maps to the same token, and
 * each entity type gets its own counter ([CARD_1], [NAME_2], ...). The encrypted
 * IndexedDB vault (AES-GCM + passphrase KDF) is deferred — see Roadmap. This v0
 * vault is in-memory and clears on reload, by design.
 */
export class Vault {
  readonly ref: VaultRef;
  private readonly tokenForValue = new Map<string, string>();
  private readonly valueForToken = new Map<string, string>();
  private readonly counters = new Map<EntityType, number>();

  constructor() {
    // Frozen: `payload.vaultRef` aliases this object, so the rehydrate binding
    // (VaultMismatchError) cannot be defeated by rewriting the id after the fact.
    this.ref = Object.freeze({ id: `vault-${nextVaultId++}` });
  }

  /** Return the stable placeholder for a (type, value), minting one on first sight. */
  tokenize(type: EntityType, value: string): string {
    const key = `${type}::${value}`;
    const existing = this.tokenForValue.get(key);
    if (existing) return existing;
    const n = (this.counters.get(type) ?? 0) + 1;
    this.counters.set(type, n);
    const token = `[${type}_${n}]`;
    this.tokenForValue.set(key, token);
    this.valueForToken.set(token, value);
    return token;
  }

  /** Resolve a placeholder back to its raw value, or undefined if unknown. */
  resolve(token: string): string | undefined {
    return this.valueForToken.get(token);
  }
}
