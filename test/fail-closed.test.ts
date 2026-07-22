import { describe, expect, it, vi } from "vitest";
import {
  approve,
  InputTooLargeError,
  MAX_REDACTION_INPUT_BYTES,
  PlaceholderCollisionError,
  redactForEgress,
  rehydrate,
  Vault,
  VaultMismatchError,
} from "../src/index.js";

describe("fail-closed reversibility", () => {
  it("rejects input over the UTF-8 byte cap before vault or audit work", async () => {
    const audit = vi.fn();
    const raw = "x".repeat(MAX_REDACTION_INPUT_BYTES + 1);

    await expect(redactForEgress(raw, new Vault(), audit)).rejects.toThrow(
      InputTooLargeError,
    );
    expect(audit).not.toHaveBeenCalled();
  });

  it("accepts input exactly at the UTF-8 byte cap", async () => {
    const pending = await redactForEgress(
      "x".repeat(MAX_REDACTION_INPUT_BYTES),
      new Vault(),
    );
    expect(pending.redactedText).toHaveLength(MAX_REDACTION_INPUT_BYTES);
  });

  it("counts UTF-8 bytes rather than JavaScript UTF-16 code units", async () => {
    const raw = "😀".repeat(Math.floor(MAX_REDACTION_INPUT_BYTES / 2) + 1);

    await expect(redactForEgress(raw, new Vault())).rejects.toThrow(
      InputTooLargeError,
    );
  });

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
