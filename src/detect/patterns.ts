import type { EntityType } from "../types.js";
import { IBAN_LENGTHS, ibanValid, luhnValid, ssnValid } from "./checksums.js";

/**
 * Email, Unicode-aware. `\w` is ASCII-only in JavaScript, so the previous
 * `\b[\w.+-]+@…` recognizer matched only the ASCII TAIL of an address with an
 * accented local part — `josé.álvarez@example.com` was redacted as
 * `josé.á[EMAIL_1]`, stranding the identifying part on the wire. Unicode
 * property escapes under the `u` flag cover every script, on both sides of the
 * `@` (so IDN domains match too).
 *
 * `\b` is also ASCII-only, so the edges are asserted explicitly instead: a
 * lookbehind stops a match starting mid-address, and the domain must END on an
 * alphanumeric so a sentence's trailing period is not swallowed. Neither
 * quantifier is nested inside another, so the pattern is linear — the separator
 * (`@`, `.`) can never be consumed by the run beside it, which is the ambiguity
 * a backtracking blow-up needs.
 */
const EMAIL_RE =
  /(?<![\p{L}\p{M}\p{N}_.+-])[\p{L}\p{M}\p{N}_.+-]+@[\p{L}\p{M}\p{N}_-]+\.[\p{L}\p{M}\p{N}_.-]*[\p{L}\p{M}\p{N}_]/gu;

/**
 * US SSN / ITIN written with separators: `123-45-6789`, `123 45 6789`, and the
 * same shape with any ONE consistent separator — a dot, any whitespace
 * (NBSP included), or any Unicode dash (U+2010-U+2015, U+2212 minus). The
 * back-reference `\1` makes the second separator repeat the first, so a mixed
 * `123-45.6789` is not taken.
 *
 * Deliberately NOT gated on `ssnValid`. v0.2.2 redacted every dashed
 * `ddd-dd-dddd`, and the SSA issuance rules would drop real identifiers written
 * in exactly this shape: ITINs (area `9xx`, e.g. `912-70-1234`) are live
 * taxpayer IDs, and a `666-…`/`000-…`/`…-00-…` value typed with SSN
 * separators is still an identifier far more often than it is anything else.
 * The separators are what make the shape specific enough on their own.
 */
const SSN_SEPARATED_RE = /\b\d{3}([-.\s\u2010-\u2015\u2212])\d{2}\1\d{4}\b/g;

/**
 * US SSN written as a bare 9-digit run: `123456789`. Gated on `ssnValid` (SSA
 * issuance rules): an unseparated 9-digit run is otherwise indistinguishable
 * from an ABA routing number (`021000021` — group `00`) or an order number, so
 * only structurally issuable SSNs are taken.
 */
const SSN_BARE_RE = /\b\d{9}\b/g;

/**
 * NANP phone number, in two branches.
 *
 * Both branches end at `(?!\d)` rather than `\b`, so a number glued to its
 * extension (`415-555-0132x12`) is still redacted, while the middle of a longer
 * digit run never is.
 *
 * Parenthesized: `(415) 555-0132`, with an optional `+1`/`1` country code that
 * may be glued to the parenthesis (`+1(415) 555-0132`) and any single
 * whitespace character — including NBSP, tab or newline — or `-`/`.` after the
 * `)`. The parentheses already mark the area code, so no digit-class rule is
 * applied here: this branch is a superset of the v0.2.2 `(\d{3})\s?\d{3}-\d{4}`
 * recognizer, which matched `(123) 456-7890` and `(415) 155-0132` too.
 *
 * Unparenthesized: `415-555-0132`, `212.555.0187`, `+1 646 555 0143`. Separators
 * may be `-`, `.` or a space. Here the area and exchange codes must start `2-9`
 * (the NANP rule) — that is what stops dotted decimals, IPs and version strings
 * from reading as phone numbers when nothing else marks the shape.
 *
 * A separator or parentheses are REQUIRED: a bare `4155550132` is not matched,
 * because a 10-digit run with no formatting is indistinguishable from an order
 * or reference number. That limit is stated in the README coverage table.
 */
const PHONE_RE =
  /(?:(?<!\d)\+?1[-. ]?)?\(\d{3}\)[-.\s]?\d{3}[-. ]\d{4}(?!\d)|(?<!\d)(?:\+?1[-. ])?[2-9]\d{2}[-. ][2-9]\d{2}[-. ]\d{4}(?!\d)/g;

/**
 * Payment card number, in the layouts cards are printed and typed in:
 *
 * - unseparated, 13-19 digits: `4111111111111111`;
 * - 4-digit groups with ONE consistent separator (`\1`): `4111 1111 1111 1111`,
 *   `4111-1111-1111-1111`, a short last group for 13-15 digits
 *   (`4222 2222 2222 2`), or one trailing 1-3 digit group for 17-19;
 * - Amex/Diners 4-6-5 / 4-6-4, again with one consistent separator (`\2`):
 *   `3782 822463 10005`.
 *
 * The previous `(?:\d[ -]?){13,19}` accepted any 13-19 digits with optional
 * separators ANYWHERE, so it glued a phone's last four, an SSN's serial or a
 * reference number onto the front of a real card, failed Luhn on the result,
 * and let the whole card through. Requiring real card grouping means a
 * neighbouring digit run can join a candidate only as a complete 4-digit group
 * with the same separator — and `detect()` still tries every later start. Luhn
 * gates every candidate; every quantifier is bounded, so the pattern is linear.
 */
const CARD_RE =
  /\b(?:\d{13,19}|\d{4}([ -])\d{4}\1\d{4}\1(?:\d{4}(?:\1\d{1,3})?|\d{1,3})|\d{4}([ -])\d{6}\2\d{4,5})\b/g;

/**
 * The v0.2.2 card recognizer, kept beside `CARD_RE`: 13-19 digits with an
 * optional space or hyphen between any two. (v0.2.2 wrote it
 * `(?:\d[ -]?){13,19}`, which could also swallow ONE trailing separator; ending
 * on a digit covers exactly the same digits without eating the space after a
 * card.) It is what redacts every
 * layout the print-layout grammar does not name — mixed separators, 8-8, 4-12,
 * 6-10, 6-13, 4-3-3-3, 4-4-4-7 — which v0.2.2 always redacted. Its looseness
 * (gluing a neighbour's digits onto a card) is harmless now: overlapping spans
 * merge into their union, so a chance Luhn-valid glue can only widen what is
 * redacted. Scanned the v0.2.2 way — resuming after each match — because
 * trying it at every start costs seconds on hostile input.
 */
const CARD_LOOSE_RE = /\b(?:\d[ -]?){12,18}\d\b/g;

/**
 * Lengths of the shorter candidates worth retrying when an accept-gate rejects
 * `match`, longest first: every prefix that closes a word inside the match.
 */
function wordClosingPrefixes(match: string): number[] {
  const out: number[] = [];
  for (let end = match.length - 1; end > 0; end--) {
    if (/\w/.test(match.charAt(end - 1)) && !/\w/.test(match.charAt(end))) {
      out.push(end);
    }
  }
  return out;
}

/**
 * The single IBAN retry candidate: the prefix holding exactly the country's
 * registered number of characters. An unknown country has none. One candidate
 * per start — not one per group — is what keeps hostile IBAN-shaped input
 * linear with a small constant.
 */
function ibanCountryPrefix(match: string): number[] {
  const length = IBAN_LENGTHS[match.slice(0, 2)];
  if (length === undefined) return [];
  let seen = 0;
  for (let end = 0; end < match.length; end++) {
    if (match.charAt(end) !== " ") seen++;
    if (seen === length) return end + 1 < match.length ? [end + 1] : [];
  }
  return [];
}

/** A regex recognizer, optionally gated by a checksum/structure accept-test. */
export interface Rule {
  readonly type: EntityType;
  readonly re: RegExp;
  readonly accept?: (match: string) => boolean;
  /**
   * `"every-start"`: after each match, the next attempt begins ONE character
   * in, so a real value hidden inside a longer, rejected candidate that began
   * too early is still found. Default: resume after the (accepted) match.
   */
  readonly scan?: "every-start";
  /**
   * For a gated rule: shorter candidate lengths to retry when the accept-gate
   * rejects a match, longest first (a valid value followed by more text).
   */
  readonly shorter?: (match: string) => readonly number[];
}

/**
 * The Tier-1 deterministic ruleset (generic + finance packs, v0 scope).
 * Patterns + checksums are ported from Microsoft Presidio's recognizer set;
 * we reuse the durable, well-tested structure, not Presidio's Python runtime.
 *
 * ORDER IS PRIORITY. When two rules produce spans of the same length at the
 * same offset, `dropOverlaps` keeps the earlier one, so the label-gated
 * ROUTING / ACCOUNT rules are listed BEFORE `SSN`: `Account number: 100200300`
 * stays an ACCOUNT even though those digits are also a structurally valid SSN.
 */
export const RULES: readonly Rule[] = [
  { type: "EMAIL", re: EMAIL_RE },
  {
    // Linear, ReDoS-safe recognizer. An IBAN is 2 letters + 2 check digits +
    // 11-30 BBAN characters (grouped in fours in print). Each remaining unit is
    // ONE alphanumeric optionally preceded by a single space (`\s?[A-Z0-9]`), so
    // there is no nested quantifier for a hostile run to backtrack across — the
    // earlier `(?:\s?[A-Z0-9]{2,4})+` could partition a run into 2-4 chunks in
    // exponentially many ways and froze the thread. `ibanValid` mod-97-checks
    // the candidate (stripping spaces) before it is accepted.
    type: "IBAN",
    re: /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]){11,30}\b/g,
    accept: ibanValid,
    scan: "every-start",
    shorter: ibanCountryPrefix,
  },
  {
    type: "CARD",
    re: CARD_RE,
    accept: luhnValid,
    scan: "every-start",
    shorter: wordClosingPrefixes,
  },
  { type: "CARD", re: CARD_LOOSE_RE, accept: luhnValid },
  // Label-gated: the English label is what makes a bare digit run an
  // identifier, so the named `value` group is what gets redacted. ACCOUNT takes
  // 6-17 digits (US account numbers run up to 17); five or fewer would collide
  // with years and amounts elsewhere in the text, which the residual guard then
  // refuses to send.
  { type: "ROUTING", re: /\bRouting number:\s*(?<value>\d{9})\b/g },
  { type: "ACCOUNT", re: /\bAccount number:\s*(?<value>\d{6,17})\b/g },
  { type: "SSN", re: SSN_SEPARATED_RE },
  { type: "SSN", re: SSN_BARE_RE, accept: ssnValid },
  { type: "PHONE", re: PHONE_RE },
  { type: "AMOUNT", re: /\$\d{1,3}(?:,\d{3})*(?:\.\d{2})?\b/g },
  { type: "DATE", re: /\b\d{2}\/\d{2}\/\d{4}\b/g },
] as const;

/** The finance pack's merchant name set (deterministic dictionary lookup). */
export const MERCHANTS: readonly string[] = [
  "Whole Foods",
  "Starbucks",
  "Amazon",
  "Walmart",
  "Costco",
] as const;

/**
 * A tiny known-names dictionary. Real name coverage is the job of the deferred
 * NER adapter (see Roadmap); this keeps the deterministic spine self-contained
 * and the demo runnable with zero download.
 */
export const NAMES: readonly string[] = [
  "Ada Lovelace",
  "Grace Hopper",
  "Alan Turing",
] as const;
