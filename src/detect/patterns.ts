import type { EntityType } from "../types.js";
import { ibanValid, luhnValid } from "./checksums.js";

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
 */
export const RULES: readonly Rule[] = [
  { type: "EMAIL", re: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g },
  {
    type: "IBAN",
    re: /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{2,4})+\b/g,
    accept: ibanValid,
  },
  { type: "CARD", re: /\b(?:\d[ -]?){13,19}\b/g, accept: luhnValid },
  { type: "SSN", re: /\b\d{3}-\d{2}-\d{4}\b/g },
  { type: "ROUTING", re: /\bRouting number:\s*(\d{9})\b/g },
  { type: "ACCOUNT", re: /\bAccount number:\s*(\d{9,12})\b/g },
  { type: "PHONE", re: /\(\d{3}\)\s?\d{3}-\d{4}\b/g },
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
