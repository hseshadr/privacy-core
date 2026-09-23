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

/** The rule's pattern anchored to match a WHOLE candidate string. */
function anchored(rule: Rule): RegExp {
  return new RegExp(`^(?:${rule.re.source})$`, rule.re.flags.replace("g", ""));
}

/**
 * After an accept-gate rejects a greedy match, retry the rule's SHORTER
 * candidates from the same start, longest first, and return the first one the
 * gate accepts.
 *
 * The regex engine only reports the longest match at a position, so a valid
 * card or IBAN followed by more digits/letters (`4111 1111 1111 1111 12/27`,
 * `GB82 WEST 1234 5698 7654 32 ABCD`) used to be matched too long, fail its
 * checksum, and leak whole. A candidate must (a) close a word — the rule's
 * `shorter` only offers prefixes followed by a separator INSIDE the match, so a
 * card is never carved out of a longer digit run — and (b) be a complete match
 * of the rule's own pattern.
 *
 * Deterministic and bounded: the rule names its candidates (every word-closing
 * prefix of a ≤ 23-character card; for an IBAN only the word-closing prefixes
 * that already pass mod-97, found in one pass), so this is a small constant per
 * rejection.
 */
function retryShorter(
  text: string,
  rule: Rule,
  whole: RegExp,
  accept: (value: string) => boolean,
  match: RegExpExecArray,
  shorter: (match: string) => readonly number[],
): Span | undefined {
  const start = match.index;
  for (const length of shorter(match[0])) {
    const end = start + length;
    const value = text.slice(start, end);
    if (whole.test(value) && accept(value)) {
      return { type: rule.type, value, start, end };
    }
  }
  return undefined;
}

/** A gated rule's match: accepted whole, accepted shorter, or rejected. */
function gatedSpan(
  text: string,
  rule: Rule,
  accept: (value: string) => boolean,
  whole: () => RegExp,
  m: RegExpExecArray,
): Span | undefined {
  const value = m[0];
  if (accept(value)) {
    return {
      type: rule.type,
      value,
      start: m.index,
      end: m.index + value.length,
    };
  }
  return rule.shorter
    ? retryShorter(text, rule, whole(), accept, m, rule.shorter)
    : undefined;
}

/** Where the next attempt of a gated rule begins after the match `m`. */
function nextStart(rule: Rule, m: RegExpExecArray, span?: Span): number {
  // "every-start": a real card preceded by another digit group (`#2 4111 …`,
  // a phone's last four) is otherwise hidden inside a longer, rejected
  // candidate that started too early. Each start is tried once and a gated
  // match is bounded, so this stays linear.
  if (rule.scan === "every-start") return m.index + 1;
  return span ? span.end : m.index + m[0].length;
}

function regexSpans(text: string, rule: Rule): Span[] {
  const out: Span[] = [];
  // A private copy: the shared RULES regex is global, so its lastIndex is state.
  const re = new RegExp(rule.re.source, rule.re.flags);
  const accept = rule.accept;
  let anchoredRe: RegExp | undefined;
  const whole = () => {
    anchoredRe ??= anchored(rule);
    return anchoredRe;
  };
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    if (!accept) {
      // A label-gated rule redacts its named `value` group; others the match.
      const value = m.groups?.value ?? m[0];
      const start = m.index + m[0].indexOf(value);
      out.push({ type: rule.type, value, start, end: start + value.length });
      continue;
    }
    const span = gatedSpan(text, rule, accept, whole, m);
    if (span) out.push(span);
    // Overlaps between these spans are merged afterwards, so coverage only grows.
    re.lastIndex = nextStart(rule, m, span);
  }
  return out;
}

/**
 * Merge overlapping spans into their UNION, keeping a sorted, disjoint set.
 *
 * Spans are ordered by start, longer first. A span that starts inside the one
 * before it EXTENDS that span to the later end (the earlier span's type is
 * kept, and its value becomes the exact text of the union) instead of being
 * dropped. Dropping was a leak: in `3852631216 760-04-7660` a candidate card
 * covering `…1216 760` beat the SSN, and the SSN's `-04-7660` went out bare.
 * An overlap can therefore only ever widen what is redacted, never uncover it.
 *
 * `Array.prototype.sort` is stable (ES2019), so spans that tie on both offset
 * and length keep their input order — which is `RULES` order. That is the
 * documented type-priority channel: a label-gated ACCOUNT span beats the
 * bare-digit SSN span covering the same characters because ACCOUNT is listed
 * first.
 */
function mergeOverlaps(text: string, spans: readonly Span[]): Span[] {
  const sorted = [...spans].sort(
    (a, b) => a.start - b.start || b.end - b.start - (a.end - a.start),
  );
  const kept: Span[] = [];
  for (const s of sorted) {
    const last = kept[kept.length - 1];
    if (last === undefined || s.start >= last.end) {
      kept.push(s);
    } else if (s.end > last.end) {
      kept[kept.length - 1] = {
        type: last.type,
        value: text.slice(last.start, s.end),
        start: last.start,
        end: s.end,
      };
    }
  }
  return kept;
}

/**
 * Detect PII spans deterministically from the FIXED ruleset in `patterns.ts`:
 * structured patterns, checksum/issuance validators, and the finance/name
 * dictionaries. Overlapping spans are merged into their union; the result is
 * sorted by start offset and non-overlapping.
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
  return mergeOverlaps(text, all);
}
