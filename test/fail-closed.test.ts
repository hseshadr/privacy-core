import { describe, expect, it } from "vitest";
import {
  approve,
  PlaceholderCollisionError,
  redactForEgress,
  rehydrate,
  Vault,
  VaultMismatchError,
} from "../src/index.js";

describe("fail-closed reversibility", () => {
  it("rejects input that already contains placeholder-shaped text (restore would be ambiguous)", async () => {
    // A pre-existing literal "[CARD_1]" is indistinguishable from a vault
    // token after redaction — rehydrate would silently substitute the card
    // number into text that never contained it. Fail closed instead.
    await expect(
      redactForEgress(
        "Refund [CARD_1] to card 4242 4242 4242 4242 please.",
        new Vault(),
      ),
    ).rejects.toThrow(PlaceholderCollisionError);
  });

  it("still accepts bracketed text that does not match the placeholder grammar", async () => {
    const pending = await redactForEgress(
      "See [note 12] and [REF] for details.",
      new Vault(),
    );
    expect(pending.redactedText).toContain("[note 12]");
    expect(pending.redactedText).toContain("[REF]");
  });

  it("rehydrating against a vault that does not match the payload's vaultRef fails closed", async () => {
    const vaultA = new Vault();
    const wrongVault = new Vault();
    const payload = approve(
      await redactForEgress("Email ada.lovelace@example.com please.", vaultA),
      () => {},
    );
    expect(() =>
      rehydrate(payload.redactedText, wrongVault, payload.vaultRef),
    ).toThrow(VaultMismatchError);
  });

  it("rehydrating with the matching vault restores the real values", async () => {
    const vault = new Vault();
    const payload = approve(
      await redactForEgress("Email ada.lovelace@example.com please.", vault),
      () => {},
    );
    expect(rehydrate(payload.redactedText, vault, payload.vaultRef)).toContain(
      "ada.lovelace@example.com",
    );
  });
});
