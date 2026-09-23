import { describe, expect, it } from "vitest";
import { RULES } from "../src/detect/patterns.js";
import { detect, type EntityType } from "../src/index.js";

/**
 * Regressions found by the 0.3.0 security review, which ran the v0.2.2 and the
 * 0.3.0 `src/detect` trees side by side. Every input below was REDACTED by
 * v0.2.2 (or, for the checksum-retry block, is a real identifier with trailing
 * text) and leaked from the first 0.3.0 candidate. Each one must stay redacted.
 */

/** The characters of `value` inside `text` that no detected span covers. */
function leakedChars(text: string, value: string): string {
  const at = text.indexOf(value);
  if (at === -1) throw new Error(`fixture bug: ${value} not in ${text}`);
  const spans = detect(text);
  let leaked = "";
  for (let i = at; i < at + value.length; i++) {
    if (!spans.some((s) => s.start <= i && i < s.end)) leaked += text[i];
  }
  return leaked;
}

function valuesOf(text: string, type: EntityType): string[] {
  return detect(text)
    .filter((s) => s.type === type)
    .map((s) => s.value);
}

describe("dashed and spaced SSNs are redacted without the issuance gate", () => {
  // v0.2.2 redacted every `ddd-dd-dddd`. ITINs (area 9xx) are real taxpayer
  // IDs, and a value that fails the SSA issuance rules is still far more likely
  // to be an identifier than anything else when it is written in SSN shape.
  const dashed = [
    ["ITIN", "912-70-1234"],
    ["ITIN", "987-65-4321"],
    ["area 9xx", "900-12-3456"],
    ["area 666", "666-12-3456"],
    ["area 000", "000-12-3456"],
    ["group 00", "123-00-4567"],
    ["serial 0000", "123-45-0000"],
    ["textbook", "123-45-6789"],
    ["Woolworth", "078-05-1120"],
  ] as const;

  for (const [label, value] of dashed) {
    it(`redacts a dashed ${label} value: ${value}`, () => {
      expect(valuesOf(`ITIN ${value} on file.`, "SSN")).toEqual([value]);
    });
  }

  const spaced = [
    "912 70 1234",
    "666 12 3456",
    "000 12 3456",
    "123 00 4567",
    "123 45 0000",
  ] as const;

  for (const value of spaced) {
    it(`redacts a spaced SSN-shaped value: ${value}`, () => {
      expect(valuesOf(`SSN ${value} on file.`, "SSN")).toEqual([value]);
    });
  }

  it("still gates the bare 9-digit form (routing numbers stay out)", () => {
    for (const value of ["912701234", "666123456", "123004567", "021000021"]) {
      expect(valuesOf(`Reference ${value} filed.`, "SSN"), value).toEqual([]);
    }
    expect(valuesOf("Reference 123456789 filed.", "SSN")).toEqual([
      "123456789",
    ]);
  });
});

describe("parenthesized phone numbers keep every v0.2.2 shape", () => {
  const cases = [
    ["country code glued to the parenthesis", "+1(415) 555-0132"],
    ["bare 1 glued to the parenthesis", "1(415) 555-0132"],
    ["NBSP after the area code", "(415)\u00a0555-0132"],
    ["tab after the area code", "(415)\t555-0132"],
    ["newline after the area code", "(415)\n555-0132"],
    ["em space after the area code", "(415)\u2003555-0132"],
    ["area code starting 1", "(123) 456-7890"],
    ["exchange starting 1", "(415) 155-0132"],
    ["area code starting 0", "(012) 055-0132"],
    ["no separator after the parenthesis", "(415)555-0132"],
    ["digit immediately before the parenthesis", "5(415) 555-0132"],
  ] as const;

  for (const [label, value] of cases) {
    it(`redacts ${label}: ${JSON.stringify(value)}`, () => {
      expect(leakedChars(`Call ${value} today.`, value)).toBe(
        value.startsWith("5(") ? "5" : "",
      );
    });
  }

  it("keeps the whole +1 prefix inside the span", () => {
    expect(valuesOf("Call +1(415) 555-0132 today.", "PHONE")).toEqual([
      "+1(415) 555-0132",
    ]);
    expect(valuesOf("Call +1 (415) 555-0132 today.", "PHONE")).toEqual([
      "+1 (415) 555-0132",
    ]);
  });

  it("keeps every shape the widened 0.3.0 pattern gained", () => {
    for (const value of [
      "415-555-0132",
      "212.555.0187",
      "415 555 0132",
      "+1 646 555 0143",
      "1-415-555-0132",
      "+1.415.555.0132",
      "(415)-555-0132",
      "(415).555.0132",
      "(415) 555 0132",
    ]) {
      expect(valuesOf(`Call ${value} today.`, "PHONE"), value).toEqual([value]);
    }
  });

  it("keeps the NANP 2-9 rule on the unparenthesized form only", () => {
    for (const text of ["Ref 123-456-7890 filed", "Ref 415-155-0132 filed"]) {
      expect(valuesOf(text, "PHONE"), text).toEqual([]);
    }
  });
});

describe("a checksum-rejected match is retried shorter from the same start", () => {
  it("finds a card followed by an expiry fragment", () => {
    expect(valuesOf("card 4111 1111 1111 1111 12/27", "CARD")).toEqual([
      "4111 1111 1111 1111",
    ]);
  });

  it("finds a card followed by a CVV and more text", () => {
    expect(valuesOf("card 4111 1111 1111 1111 123 exp 12/27", "CARD")).toEqual([
      "4111 1111 1111 1111",
    ]);
  });

  it("finds an unspaced card followed by a short number", () => {
    expect(valuesOf("card 4111111111111111 43 due", "CARD")).toEqual([
      "4111111111111111",
    ]);
  });

  it("finds an IBAN followed by an uppercase word", () => {
    expect(valuesOf("IBAN GB82 WEST 1234 5698 7654 32 ABCD", "IBAN")).toEqual([
      "GB82 WEST 1234 5698 7654 32",
    ]);
  });

  it("never carves a shorter candidate out of a longer digit run", () => {
    // 4111111111111111 is Luhn-valid, but here it is the first 16 digits of a
    // 17-digit run. A shorter candidate must still end on a word boundary.
    expect(valuesOf("ref 41111111111111112 filed", "CARD")).toEqual([]);
  });

  it("keeps scanning after a shortened match", () => {
    expect(
      valuesOf("cards 4111 1111 1111 1111 12 and 4242 4242 4242 4242", "CARD"),
    ).toEqual(["4111 1111 1111 1111", "4242 4242 4242 4242"]);
  });

  it("still rejects a candidate with no valid shorter prefix", () => {
    expect(valuesOf("Card 4242 4242 4242 4241 is fake.", "CARD")).toEqual([]);
  });
});

describe("the shorter-candidate retry stays sound and linear", () => {
  const gated = RULES.filter((rule) => rule.accept !== undefined);

  it("only runs on gated patterns shaped \\b + bounded unit repetition + \\b", () => {
    // retryShorter's early exit relies on this shape: a word-closing prefix of
    // a match is itself a match until it drops below the minimum length.
    expect(gated.map((rule) => rule.type)).toEqual(["IBAN", "CARD", "SSN"]);
    for (const rule of gated) {
      expect(rule.re.source.startsWith("\\b"), rule.type).toBe(true);
      expect(rule.re.source.endsWith("\\b"), rule.type).toBe(true);
      // No capture group: the whole match is the value that gets re-tested.
      expect(new RegExp(`${rule.re.source}|`).exec("")?.length, rule.type).toBe(
        1,
      );
    }
  });

  it("never lets any rule match the empty string (the scan must advance)", () => {
    for (const rule of RULES) {
      expect(
        new RegExp(rule.re.source, rule.re.flags).test(""),
        rule.type,
      ).toBe(false);
    }
  });

  it("scans 64 KiB of rejected-then-retried candidates in well under 1.5s", () => {
    // Each unit forces a checksum rejection followed by a retry. A blow-up
    // guard, not a benchmark: the bounded retry costs tens of milliseconds per
    // input here (a few hundred under coverage instrumentation on a loaded
    // runner), while a super-linear retry never finishes on 64 KiB at all.
    const size = 64 * 1024;
    for (const unit of [
      "4111 1111 1111 1111 12 ",
      "1 ",
      "2-",
      "GB82 WEST 1234 5698 7654 32 ABCD ",
      "GB00 A1B2 C3D4 E5F6 G7H8 I9J0 K1L2 M3 ",
    ]) {
      const hostile = unit.repeat(Math.ceil(size / unit.length)).slice(0, size);
      const started = performance.now();
      detect(hostile);
      expect(performance.now() - started, unit).toBeLessThan(1500);
    }
  });
});
