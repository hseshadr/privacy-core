import type { EntityType } from "../types.js";
import { ibanValid, luhnValid, ssnValid } from "./checksums.js";

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
 * US SSN in the three forms people actually type: `123-45-6789`, `123 45 6789`,
 * and unseparated `123456789`. `ssnValid` gates all three on the SSA issuance
 * rules, which is what keeps the unseparated form from swallowing arbitrary
 * 9-digit runs.
 */
const SSN_RE = /\b(?:\d{3}-\d{2}-\d{4}|\d{3} \d{2} \d{4}|\d{9})\b/g;

/**
 * NANP phone number. Separators may be `-`, `.` or a space, the area code may
 * be parenthesized, and a `+1` / `1` country code is optional. Area and exchange
 * codes must start `2-9` (the NANP rule), which is what stops dotted decimals
 * and version strings from reading as phone numbers.
 *
 * A separator or parentheses are REQUIRED: a bare `4155550132` is not matched,
 * because a 10-digit run with no formatting is indistinguishable from an order
 * or reference number. That limit is stated in the README coverage table.
 */
const PHONE_RE =
  /(?<!\d)(?:\+?1[-. ])?(?:\([2-9]\d{2}\)[-. ]?|[2-9]\d{2}[-. ])[2-9]\d{2}[-. ]\d{4}\b/g;

/** A regex recognizer, optionally gated by a checksum/structure accept-test. */
export interface Rule {
  readonly type: EntityType;
  readonly re: RegExp;
  readonly accept?: (match: string) => boolean;
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
  },
  { type: "CARD", re: /\b(?:\d[ -]?){13,19}\b/g, accept: luhnValid },
  { type: "ROUTING", re: /\bRouting number:\s*(\d{9})\b/g },
  { type: "ACCOUNT", re: /\bAccount number:\s*(\d{9,12})\b/g },
  { type: "SSN", re: SSN_RE, accept: ssnValid },
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
