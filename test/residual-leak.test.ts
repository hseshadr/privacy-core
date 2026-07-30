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
 *
 * The residual test is WORD-BOUNDARY aware: it flags a value only when it recurs
 * as a STANDALONE token, not when the digits merely appear inside a longer
 * alphanumeric token (a benign order id / tracking number that shares the
 * digits). Refusing those was a false positive; a standalone recurrence is
 * indistinguishable from a leak and still fails closed.
 */
describe("residual-value fail-closed guard", () => {
  const LEAKY = "Account number: 021000021 021000021";

  it("refuses a redaction whose output still contains a detected raw value", async () => {
    await expect(redactForEgress(LEAKY, new Vault())).rejects.toThrow(
      ResidualValueError,
    );
  });

  it("the known-sensitive value never reaches an approved payload's wire text", async () => {
    // Collect what was actually minted rather than defaulting to "". An empty
    // string satisfies the "does not contain the value" assertion no matter what
    // happened, so a swallowed error — or a deleted redactor — would pass. An
    // empty ARRAY can only mean no sendable payload was ever produced.
    const minted: string[] = [];

    // Assert the REFUSAL itself: the fail-closed path is the behaviour under
    // test, not an incidental route to an empty variable.
    await expect(async () => {
      const pending = await redactForEgress(LEAKY, new Vault());
      minted.push(approve(pending, () => {}).redactedText);
    }).rejects.toThrow(ResidualValueError);

    // Nothing sendable exists, so nothing can carry the value onto the wire.
    expect(minted).toEqual([]);
  });

  it("does NOT refuse a statement where every detected value appears once", async () => {
    const clean = "Card 4242 4242 4242 4242 for Ada Lovelace at Whole Foods.";
    const pending = await redactForEgress(clean, new Vault());
    expect(pending.redactedText).not.toContain("4242 4242 4242 4242");
    expect(pending.redactedText).toContain("[CARD_1]");
  });
});

/**
 * The confirmed leaks: the vaulted value recurs as its OWN standalone token, so
 * a verbatim copy would cross the wire. Every one of these must fail closed.
 */
describe("residual guard — confirmed leaks still REFUSE", () => {
  const LEAKS: readonly [string, string][] = [
    // Second copy is the bare value, space/EOS delimited.
    [
      "duplicate account, standalone copy",
      "Account number: 021000021 021000021",
    ],
    // Second copy is the bare value, sentence-delimited. This account number is
    // TEN digits on purpose: the bare-digit SSN recognizer matches exactly nine,
    // so the restated copy stays label-only-detectable and the residual scenario
    // this row exists to prove is still reachable. (The nine-digit form of this
    // case now redacts BOTH copies instead of refusing — pinned separately in
    // "restated SSN-shaped account number" below.)
    [
      "account restated later in the sentence",
      "Account number: 1234567890. Please confirm 1234567890 is correct.",
    ],
    // Second copy is the bare routing number, space-delimited.
    [
      "routing number restated after the label",
      "Routing number: 021000021. Funds were sent to 021000021 today.",
    ],
    // The exact value appears STANDALONE ("100000000 yen"). Indistinguishable
    // from a leak, so the fail-safe (refuse) is correct — we do NOT contort the
    // boundary logic to let this through.
    [
      "value recurs standalone even though it reads as a benign amount",
      "Routing number: 100000000. Budget is 100000000 yen approved.",
    ],
  ];

  for (const [label, input] of LEAKS) {
    it(`refuses: ${label}`, async () => {
      await expect(redactForEgress(input, new Vault())).rejects.toThrow(
        ResidualValueError,
      );
    });
  }

  /**
   * The outcome that got STRONGER when the detector learned the unseparated SSN
   * form. Previously only the labelled copy was recognised, the bare restatement
   * survived, and the residual guard refused the whole redaction (correct, but
   * the user got nothing). Now both copies are redacted, so there is no residual
   * to refuse. Refusing is the fallback; redacting is the win — assert the
   * stronger property directly rather than let the weaker one silently lapse.
   */
  it("redacts BOTH copies of a restated SSN-shaped account number", async () => {
    const input = "Account number: 123456789. Please confirm 123456789.";
    const pending = await redactForEgress(input, new Vault());
    const wire = approve(pending, () => {}).redactedText;
    expect(wire).not.toContain("123456789");
    expect(wire).toContain("[ACCOUNT_1]");
  });
});

/**
 * The false positives the boundary guard fixes: the vaulted digits appear ONLY
 * inside a longer alphanumeric token (a benign order id / tracking number), so
 * nothing sensitive stands alone on the wire. These must SEND, with the benign
 * token preserved verbatim and the labelled value replaced by its placeholder.
 */
describe("residual guard — benign superstrings now SEND", () => {
  it("sends when the digits are only a substring of a benign order id", async () => {
    const input = "Account number: 123456789. Order 0123456789A confirmed.";
    const pending = await redactForEgress(input, new Vault());
    // The labelled account is vaulted...
    expect(pending.redactedText).toContain("[ACCOUNT_1]");
    // ...while the benign order id (which merely contains the digits) is intact.
    expect(pending.redactedText).toContain("0123456789A");
    // And the payload is genuinely sendable end-to-end.
    const wire = approve(pending, () => {}).redactedText;
    expect(wire).toContain("0123456789A");
  });

  it("sends when the account number is only a prefix of a tracking number", async () => {
    const input = "Account number: 100200300. Tracking: 1002003009 shipped.";
    const pending = await redactForEgress(input, new Vault());
    expect(pending.redactedText).toContain("[ACCOUNT_1]");
    expect(pending.redactedText).toContain("1002003009");
    const wire = approve(pending, () => {}).redactedText;
    expect(wire).toContain("1002003009");
  });

  // Overlap regression: a merchant-dictionary hit ("Amazon") starts at the same
  // offset as a longer EMAIL match ("Amazon@example.com"). The detector's
  // same-start overlap resolution drops the shorter MERCHANT span, so
  // assertNoResidual only ever sees the surviving EMAIL span. It must NOT
  // spuriously flag the dropped "Amazon" as a residual value, and the redaction
  // must send cleanly with the whole email replaced.
  it("does not false-refuse when a merchant name overlaps a detected email", async () => {
    const input = "Contact Amazon@example.com about the order.";
    const pending = await redactForEgress(input, new Vault());
    expect(pending.redactedText).toContain("[EMAIL_1]");
    expect(pending.redactedText).not.toContain("Amazon@example.com");
    const wire = approve(pending, () => {}).redactedText;
    expect(wire).not.toContain("Amazon");
    expect(wire).toContain("[EMAIL_1]");
  });
});
