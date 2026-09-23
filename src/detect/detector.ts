import type { EntityType, Span } from "../types.js";
import { MERCHANTS, NAMES, RULES, type Rule } from "./patterns.js";

function dictSpans(
  text: string,
  type: EntityType,
  dict: readonly string[],
): Span[] {
  const out: Span[] = [];
  for (const term of dict) {
    let from = 0;
    let idx = text.indexOf(term, from);
    while (idx !== -1) {
      out.push({ type, value: term, start: idx, end: idx + term.length });
      from = idx + term.length;
      idx = text.indexOf(term, from);
    }
  }
  return out;
}

/** `[A-Za-z0-9_]` by char code — exactly what JavaScript's non-`u` `\b` treats as a word. */
const ASCII_WORD = new Uint8Array(128);
for (const ch of "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_") {
  ASCII_WORD[ch.charCodeAt(0)] = 1;
}

/**
 * Whether `text[i]` is a `\b` word character. A table lookup so the hot retry
 * loop allocates nothing; a non-ASCII or out-of-range position reads as
 * `undefined`, i.e. not a word character — the same answer `\b` gives.
 */
function isWordAt(text: string, i: number): boolean {
  return ASCII_WORD[text.charCodeAt(i)] === 1;
}

/** The rule's pattern anchored to match a WHOLE candidate string. */
function anchored(rule: Rule): RegExp {
  return new RegExp(`^(?:${rule.re.source})$`, rule.re.flags.replace("g", ""));
}

/**
 * After an accept-gate rejects a greedy match, retry SHORTER candidates from
 * the same start, longest first, and return the first one the gate accepts.
 *
 * The regex engine only reports the longest match at a position, so a valid
 * card or IBAN followed by more digits/letters (`4111 1111 1111 1111 12/27`,
 * `GB82 WEST 1234 5698 7654 32 ABCD`) used to be matched too long, fail its
 * checksum, and leak whole. A candidate must (a) end on a word boundary in the
 * FULL text, closing a word — so a card is never carved out of a longer digit
 * run — and (b) be a complete match of the rule's own pattern.
 *
 * Every gated pattern is `\b` + a bounded repetition of one unit + `\b`, so
 * its word-closing prefixes match exactly down to the pattern's minimum length:
 * the first prefix that fails (b) proves no shorter one can pass, and the loop
 * stops there. Deterministic and bounded — at most one attempt per unit of the
 * rejected match (≤ 38 chars for CARD, ≤ 64 for IBAN), so detection stays
 * linear in the input.
 */
function retryShorter(
  text: string,
  rule: Rule,
  whole: RegExp,
  accept: (value: string) => boolean,
  start: number,
  length: number,
): Span | undefined {
  for (let end = start + length - 1; end > start; end--) {
    if (!isWordAt(text, end - 1) || isWordAt(text, end)) continue;
    const value = text.slice(start, end);
    if (!whole.test(value)) return undefined;
    if (accept(value)) return { type: rule.type, value, start, end };
  }
  return undefined;
}

function regexSpans(text: string, rule: Rule): Span[] {
  const out: Span[] = [];
  // A private copy: the shared RULES regex is global, so its lastIndex is state.
  const re = new RegExp(rule.re.source, rule.re.flags);
  let whole: RegExp | undefined;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    // If the rule has a capture group, that group is the value; else whole match.
    const value = m[1] ?? m[0];
    const start = m.index + m[0].indexOf(value);
    const span = { type: rule.type, value, start, end: start + value.length };
    if (!rule.accept || rule.accept(value)) {
      out.push(span);
      continue;
    }
    whole ??= anchored(rule);
    const shorter = retryShorter(
      text,
      rule,
      whole,
      rule.accept,
      start,
      value.length,
    );
    if (shorter) {
      out.push(shorter);
      // Resume right after the accepted prefix so nothing it gave back is lost.
      re.lastIndex = shorter.end;
    }
  }
  return out;
}

/**
 * Drop overlapping spans (earlier/longer wins), keeping a sorted, disjoint set.
 *
 * `Array.prototype.sort` is stable (ES2019), so spans that tie on both offset
 * and length keep their input order — which is `RULES` order. That is the
 * documented priority channel: a label-gated ACCOUNT span beats the bare-digit
 * SSN span covering the same characters because ACCOUNT is listed first.
 */
function dropOverlaps(spans: readonly Span[]): Span[] {
  const sorted = [...spans].sort(
    (a, b) => a.start - b.start || b.end - b.start - (a.end - a.start),
  );
  const kept: Span[] = [];
  let lastEnd = -1;
  for (const s of sorted) {
    if (s.start >= lastEnd) {
      kept.push(s);
      lastEnd = s.end;
    }
  }
  return kept;
}

/**
 * Detect PII spans deterministically from the FIXED ruleset in `patterns.ts`:
 * structured patterns, checksum/issuance validators, and the finance/name
 * dictionaries. Overlaps are dropped; the result is sorted by start offset and
 * non-overlapping.
 *
 * This is not "all PII" — it is exactly what `RULES`, `MERCHANTS` and `NAMES`
 * cover, published as a coverage table in the README. Recall is the product:
 * anything not matched here leaks unless a human catches it in the preview. The
 * contextual NER tier that would widen recall is deliberately deferred (see
 * Roadmap).
 */
export function detect(text: string): Span[] {
  const all = [
    ...RULES.flatMap((r) => regexSpans(text, r)),
    ...dictSpans(text, "MERCHANT", MERCHANTS),
    ...dictSpans(text, "NAME", NAMES),
  ];
  return dropOverlaps(all);
}
