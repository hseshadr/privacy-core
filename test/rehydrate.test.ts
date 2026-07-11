import { describe, expect, it } from "vitest";
import {
  redactForEgress,
  rehydrate,
  UnresolvedPlaceholderError,
  Vault,
} from "../src/index.js";

describe("rehydrate", () => {
  it("restores a vaulted placeholder to its real value", async () => {
    const vault = new Vault();
    const payload = await redactForEgress(
      "Email ada.lovelace@example.com please.",
      vault,
    );
    expect(payload.redactedText).toContain("[EMAIL_1]");
    expect(rehydrate(payload.redactedText, vault, payload.vaultRef)).toContain(
      "ada.lovelace@example.com",
    );
  });

  it("fails closed on a placeholder the bound vault cannot resolve (no silent passthrough)", () => {
    const vault = new Vault();
    // A model-invented token the vault never minted must not be left in place —
    // a token that merely *looks* like redaction is an anomaly under a bound vault.
    const reply = "The charge on [CARD_7] looks like [HALLUCINATED_1].";
    expect(() => rehydrate(reply, vault, vault.ref)).toThrow(
      UnresolvedPlaceholderError,
    );
  });
});
