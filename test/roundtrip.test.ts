import { describe, expect, it } from "vitest";
import { redactForEgress, rehydrate, Vault } from "../src/index.js";
import { SYNTHETIC_STATEMENT } from "../src/testing.js";

describe("redact -> rehydrate round-trip", () => {
  it("restores the exact original string", async () => {
    const vault = new Vault();
    const payload = await redactForEgress(SYNTHETIC_STATEMENT, vault);
    const restored = rehydrate(payload.redactedText, vault, payload.vaultRef);
    expect(restored).toBe(SYNTHETIC_STATEMENT);
  });

  it("produces stable typed placeholders, reusing the token for a repeated value", async () => {
    const vault = new Vault();
    const text =
      "Email ada.lovelace@example.com twice: ada.lovelace@example.com";
    const payload = await redactForEgress(text, vault);
    const matches = payload.redactedText.match(/\[EMAIL_\d+\]/g) ?? [];
    expect(matches).toHaveLength(2);
    expect(matches[0]).toBe(matches[1]); // same value -> same token
  });

  it("rehydrates placeholders embedded in an LLM-style reply", async () => {
    const vault = new Vault();
    const payload = await redactForEgress(
      "Charge of $1,482.10 to Ada Lovelace.",
      vault,
    );
    // Simulate a model that echoes placeholders back in prose.
    const amount = payload.redactedText.match(/\[AMOUNT_\d+\]/)?.[0];
    const name = payload.redactedText.match(/\[NAME_\d+\]/)?.[0];
    if (!amount || !name) throw new Error("expected planted placeholders");
    const reply = `The charge ${amount} was made by ${name}.`;
    expect(rehydrate(reply, vault, payload.vaultRef)).toBe(
      "The charge $1,482.10 was made by Ada Lovelace.",
    );
  });
});
