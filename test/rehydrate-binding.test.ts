import { describe, expect, it } from "vitest";
import {
  approve,
  redactForEgress,
  rehydrate,
  UnresolvedPlaceholderError,
  Vault,
  VaultMismatchError,
} from "../src/index.js";

/**
 * Adversarial coverage for the fail-closed rehydrate contract (fix-to-A item 1).
 *
 * The old signature made the vault binding OPTIONAL: a 2-arg call skipped the
 * guard entirely and `resolve() ?? token` silently substituted another vault's
 * real value for an overlapping `[NAME_1]`/`[CARD_1]`. Vault binding is now
 * MANDATORY, and an unresolved placeholder under a bound vault fails closed.
 */
const auditNoop = () => {};

describe("rehydrate: vault binding is mandatory, unresolved fails closed", () => {
  it("requires the binding ref — the unguarded 2-arg path no longer compiles", async () => {
    const vault = new Vault();
    const payload = approve(
      await redactForEgress("Email ada.lovelace@example.com please.", vault),
      auditNoop,
    );
    // Compile-time proof only — never executed (see `_proof` pattern below).
    const _proof = () => {
      // @ts-expect-error the binding ref is required; the guard cannot be skipped.
      return rehydrate(payload.redactedText, vault);
    };
    expect(typeof _proof).toBe("function");
    // Supplying the ref restores the real value.
    expect(rehydrate(payload.redactedText, vault, payload.vaultRef)).toContain(
      "ada.lovelace@example.com",
    );
  });

  it("wrong vault → throws, and NEVER substitutes an overlapping token's other value", async () => {
    const vaultA = new Vault();
    const payloadA = approve(
      await redactForEgress("Pay Ada Lovelace.", vaultA),
      auditNoop,
    );
    expect(payloadA.redactedText).toContain("[NAME_1]");

    // A different vault that ALSO has a [NAME_1], mapping to someone else.
    const vaultB = new Vault();
    vaultB.tokenize("NAME", "Grace Hopper");

    expect(() =>
      rehydrate(payloadA.redactedText, vaultB, payloadA.vaultRef),
    ).toThrow(VaultMismatchError);

    let leaked = "";
    try {
      leaked = rehydrate(payloadA.redactedText, vaultB, payloadA.vaultRef);
    } catch {
      /* expected — fail closed */
    }
    expect(leaked).not.toContain("Grace Hopper");
  });

  it("an unresolved [TYPE_n] under the bound (matching) vault fails closed", async () => {
    const vault = new Vault();
    const payload = approve(
      await redactForEgress("Pay Ada Lovelace.", vault),
      auditNoop,
    );
    const name = payload.redactedText.match(/\[NAME_\d+\]/)?.[0];
    if (!name) throw new Error("expected a planted [NAME_n]");
    // The reply echoes the real token PLUS a placeholder the vault never minted.
    const reply = `Reviewed ${name}; also [CARD_9], which was never issued.`;
    expect(() => rehydrate(reply, vault, payload.vaultRef)).toThrow(
      UnresolvedPlaceholderError,
    );
  });
});
