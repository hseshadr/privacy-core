import { describe, expect, it } from "vitest";
import {
  approve,
  ResidualValueError,
  redactForEgress,
  Vault,
} from "../src/index.js";

/**
 * Defence-in-depth for the redaction pipeline: a value the detector already
 * recognised (and wrote into the vault) must never survive verbatim in the text
 * that becomes sendable. The label-gated ACCOUNT / ROUTING rules match only the
 * FIRST digit run after their English label, so a second, unlabelled copy of the
 * SAME account number slips past the span-by-span rebuild and would cross the
 * wire in the clear — a value the tool has already proven is PII. Fail closed.
 */
describe("residual-value fail-closed guard", () => {
  const LEAKY = "Account number: 021000021 021000021";

  it("refuses a redaction whose output still contains a detected raw value", async () => {
    await expect(redactForEgress(LEAKY, new Vault())).rejects.toThrow(
      ResidualValueError,
    );
  });

  it("the known-sensitive value never reaches an approved payload's wire text", async () => {
    let wireText = "";
    try {
      const pending = await redactForEgress(LEAKY, new Vault());
      wireText = approve(pending, () => {}).redactedText;
    } catch {
      /* fail-closed path — nothing sendable was minted */
    }
    expect(wireText).not.toContain("021000021");
  });

  it("does NOT refuse a statement where every detected value appears once", async () => {
    const clean = "Card 4242 4242 4242 4242 for Ada Lovelace at Whole Foods.";
    const pending = await redactForEgress(clean, new Vault());
    expect(pending.redactedText).not.toContain("4242 4242 4242 4242");
    expect(pending.redactedText).toContain("[CARD_1]");
  });
});
