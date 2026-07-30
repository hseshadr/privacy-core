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

function regexSpans(text: string, rule: Rule): Span[] {
  const out: Span[] = [];
  for (const m of text.matchAll(rule.re)) {
    // If the rule has a capture group, that group is the value; else whole match.
    const value = m[1] ?? m[0];
    if (rule.accept && !rule.accept(value)) continue;
    const start = m.index + m[0].indexOf(value);
    out.push({ type: rule.type, value, start, end: start + value.length });
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
