import { describe, expect, it } from "vitest";
import { detect } from "../src/index.js";
import { SYNTHETIC_STATEMENT } from "../src/testing.js";

describe("Tier-1 deterministic detector", () => {
  it("finds every planted finance entity in a realistic synthetic statement", () => {
    const spans = detect(SYNTHETIC_STATEMENT);
    const byType = (t: string) =>
      spans.filter((s) => s.type === t).map((s) => s.value);

    // Luhn-valid card number.
    expect(byType("CARD")).toContain("4242 4242 4242 4242");
    // IBAN (mod-97 valid).
    expect(byType("IBAN")).toContain("GB82 WEST 1234 5698 7654 32");
    // US SSN.
    expect(byType("SSN")).toContain("123-45-6789");
    // Email + phone.
    expect(byType("EMAIL")).toContain("ada.lovelace@example.com");
    expect(byType("PHONE").length).toBeGreaterThanOrEqual(1);
    // Finance set.
    expect(byType("ACCOUNT")).toContain("000123456789");
    expect(byType("ROUTING")).toContain("021000021");
    expect(byType("AMOUNT")).toContain("$1,482.10");
    expect(byType("DATE").length).toBeGreaterThanOrEqual(1);
    // Names + merchants via dictionary.
    expect(byType("NAME")).toContain("Ada Lovelace");
    expect(byType("MERCHANT")).toContain("Whole Foods");
  });

  it("rejects a Luhn-invalid 16-digit number (no false CARD)", () => {
    const spans = detect("Card 4242 4242 4242 4241 is fake.");
    expect(spans.filter((s) => s.type === "CARD")).toHaveLength(0);
  });

  it("rejects an IBAN that fails the mod-97 check", () => {
    const spans = detect("IBAN GB00 WEST 1234 5698 7654 32 is bogus.");
    expect(spans.filter((s) => s.type === "IBAN")).toHaveLength(0);
  });

  it("drops the shorter of two same-start overlapping spans (longer wins)", () => {
    // "Amazon@example.com" is both a MERCHANT dictionary hit and an EMAIL
    // match starting at the same offset — the email must win, once.
    const spans = detect("Contact Amazon@example.com today.");
    expect(spans).toHaveLength(1);
    expect(spans[0]?.type).toBe("EMAIL");
    expect(spans[0]?.value).toBe("Amazon@example.com");
  });

  it("returns non-overlapping spans sorted by start offset", () => {
    const spans = detect(SYNTHETIC_STATEMENT);
    for (let i = 1; i < spans.length; i++) {
      const prev = spans[i - 1];
      const cur = spans[i];
      if (!prev || !cur) throw new Error("unexpected sparse span array");
      expect(cur.start).toBeGreaterThanOrEqual(prev.end);
    }
  });
});
