import { describe, expect, it } from "vitest";
import { detect, redactForEgress, Vault } from "../src/index.js";

/**
 * RECALL FLOOR: nothing v0.2.2 redacted may leak from a later release.
 *
 * The 0.3.0 candidate widened SSN and PHONE detection but also quietly NARROWED
 * it (dashed ITINs and `+1(415) 555-0132` stopped being redacted). A narrowing
 * is a leak, so this file pins the v0.2.2 behaviour two ways, both
 * self-contained so no future edit to `src/detect` can move the oracle:
 *
 * 1. `V022_POSITIVES` — every PHONE, SSN, EMAIL, CARD and IBAN value the v0.2.2
 *    detector found in the v0.2.2 test corpus (`git show v0.2.2:test/…`,
 *    `e2e/…`, the `SYNTHETIC_STATEMENT` fixture and the README examples), found
 *    by running that tag's own `detect()` over every line and string literal.
 * 2. A differential sweep: `V022_RULES` is a verbatim copy of the v0.2.2 regexes
 *    for those five types, with verbatim copies of its Luhn and mod-97 gates.
 *    Over a deterministic generated corpus, every character v0.2.2 matched must
 *    be covered by a span from the current detector.
 */

/** Values v0.2.2's detector redacted in its own test corpus. */
const V022_POSITIVES = [
  ["EMAIL", "ada.lovelace@example.com"],
  ["EMAIL", "grace.hopper@example.com"],
  ["EMAIL", "Amazon@example.com"],
  ["EMAIL", "avow@0.1.0"],
  ["EMAIL", "x@1.0.0"],
  ["EMAIL", "checkout@v7.0.0"],
  ["PHONE", "(415) 555-0132"],
  ["CARD", "4242 4242 4242 4242"],
  ["CARD", "4242424242424242"],
  ["SSN", "123-45-6789"],
  ["IBAN", "GB82 WEST 1234 5698 7654 32"],
  ["IBAN", "GB82WEST12345698765432"],
] as const;

/** v0.2.2 `luhnValid`, verbatim. */
function luhnV022(digits: string): boolean {
  const d = digits.replace(/\D/g, "");
  if (d.length < 13 || d.length > 19) return false;
  let sum = 0;
  let dbl = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = d.charCodeAt(i) - 48;
    if (dbl) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

/** v0.2.2 `ibanValid`, verbatim. */
function ibanV022(raw: string): boolean {
  const s = raw.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{1,30}$/.test(s)) return false;
  const rearranged = s.slice(4) + s.slice(0, 4);
  const expanded = rearranged.replace(/[A-Z]/g, (c) =>
    String(c.charCodeAt(0) - 55),
  );
  let remainder = 0;
  for (const ch of expanded) {
    remainder = (remainder * 10 + (ch.charCodeAt(0) - 48)) % 97;
  }
  return remainder === 1;
}

/** The v0.2.2 ruleset for the five structured types, verbatim. */
const V022_RULES: ReadonlyArray<{
  readonly type: string;
  readonly re: RegExp;
  readonly accept?: (value: string) => boolean;
}> = [
  { type: "EMAIL", re: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g },
  {
    type: "IBAN",
    re: /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]){11,30}\b/g,
    accept: ibanV022,
  },
  { type: "CARD", re: /\b(?:\d[ -]?){13,19}\b/g, accept: luhnV022 },
  { type: "SSN", re: /\b\d{3}-\d{2}-\d{4}\b/g },
  { type: "PHONE", re: /\(\d{3}\)\s?\d{3}-\d{4}\b/g },
];

/** Every [start, end) range v0.2.2 would have matched in `text`. */
function v022Matches(text: string): Array<[string, number, number]> {
  const out: Array<[string, number, number]> = [];
  for (const rule of V022_RULES) {
    for (const m of text.matchAll(rule.re)) {
      if (rule.accept && !rule.accept(m[0])) continue;
      out.push([rule.type, m.index, m.index + m[0].length]);
    }
  }
  return out;
}

/** Characters inside a v0.2.2 match that the current detector leaves bare. */
function narrowings(text: string): string[] {
  const spans = detect(text);
  const covered = (i: number) => spans.some((s) => s.start <= i && i < s.end);
  const found: string[] = [];
  for (const [type, start, end] of v022Matches(text)) {
    for (let i = start; i < end; i++) {
      if (!covered(i)) {
        found.push(`${type} ${JSON.stringify(text.slice(start, end))}`);
        break;
      }
    }
  }
  return found;
}

/** A deterministic sweep of the shapes the five v0.2.2 rules accept. */
function generatedCorpus(): string[] {
  const areas = ["000", "001", "123", "415", "665", "666", "899", "900", "987"];
  const groups = ["00", "01", "45", "99"];
  const serials = ["0000", "0001", "6789"];
  const ssns = areas.flatMap((a) =>
    groups.flatMap((g) => serials.map((s) => `${a}-${g}-${s}`)),
  );

  const gaps = ["", " ", "\u00a0", "\t", "\n", "\u2003", "\r", "\u2028"];
  const phoneDigits = ["000", "123", "155", "415", "999"];
  const phones = phoneDigits.flatMap((area) =>
    phoneDigits.flatMap((exchange) =>
      gaps.map((gap) => `(${area})${gap}${exchange}-0132`),
    ),
  );
  const phonePrefixes = ["", "+1", "1", "+1 ", "1-", "5", "x", "+"];

  const cards = [
    "4242424242424242",
    "4111111111111111",
    "5555555555554444",
    "378282246310005",
    "6011111111111117",
    "4000056655665556",
    "4222222222222",
    "6200000000000005",
    "3530111333300000",
  ].flatMap((digits) => [
    digits,
    digits.replace(/(\d{4})(?=\d)/g, "$1 "),
    digits.replace(/(\d{4})(?=\d)/g, "$1-"),
  ]);

  const ibans = [
    "GB82WEST12345698765432",
    "DE89370400440532013000",
    "FR1420041010050500013M02606",
    "NL91ABNA0417164300",
  ].flatMap((iban) => [iban, iban.replace(/(.{4})(?=.)/g, "$1 ")]);

  const emails = [
    "ada.lovelace@example.com",
    "a+tag@sub.example.co.uk",
    "first_last-9@my-host.example",
    "x@y.z",
    "UPPER.Case@Example.COM",
  ];

  const wrap = (v: string) => [
    v,
    `on file: ${v}`,
    `${v}.`,
    `(${v})`,
    `ref ${v} end`,
    `${v}, then more`,
  ];

  return [
    ...ssns.flatMap(wrap),
    ...phones.flatMap((p) => phonePrefixes.map((pre) => `Call ${pre}${p}`)),
    ...phones.flatMap(wrap),
    ...cards.flatMap(wrap),
    ...ibans.flatMap(wrap),
    ...emails.flatMap(wrap),
  ];
}

describe("v0.2.2 recall floor", () => {
  it("still redacts every value v0.2.2 redacted in its own corpus", async () => {
    for (const [type, value] of V022_POSITIVES) {
      const text = `Please note ${value} for the file.`;
      expect(v022Matches(text).length, `${type} oracle: ${value}`).toBe(1);
      expect(narrowings(text), `${type}: ${value}`).toEqual([]);
      const pending = await redactForEgress(text, new Vault());
      expect(pending.redactedText, `${type}: ${value}`).not.toContain(value);
    }
  });

  it("covers every character v0.2.2 matched across the generated corpus", () => {
    const corpus = generatedCorpus();
    // Non-vacuity: the sweep must actually exercise the oracle.
    const oracleHits = corpus.reduce((n, t) => n + v022Matches(t).length, 0);
    expect(oracleHits).toBeGreaterThan(1500);
    expect(corpus.flatMap(narrowings)).toEqual([]);
  });
});
