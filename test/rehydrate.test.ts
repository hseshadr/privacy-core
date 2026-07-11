import { describe, expect, it } from "vitest";
import { redactForEgress, rehydrate, Vault } from "../src/index.js";

describe("rehydrate", () => {
  it("restores a vaulted placeholder to its real value", async () => {
    const vault = new Vault();
    const payload = await redactForEgress(
      "Email ada.lovelace@example.com please.",
      vault,
    );
    expect(payload.redactedText).toContain("[EMAIL_1]");
    expect(rehydrate(payload.redactedText, vault)).toContain(
      "ada.lovelace@example.com",
    );
  });

  it("leaves unknown placeholder tokens untouched (model-invented tokens survive)", () => {
    const vault = new Vault();
    const reply = "The charge on [CARD_7] looks like [HALLUCINATED_1].";
    expect(rehydrate(reply, vault)).toBe(reply);
  });
});
