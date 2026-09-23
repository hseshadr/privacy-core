/** Luhn check for card numbers (digits only). */
export function luhnValid(digits: string): boolean {
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

/**
 * SSA issuance rules for a US SSN candidate (separators are stripped first).
 *
 * Area `000`, `666` and `900-999`, group `00`, and serial `0000` were never
 * issued. Requiring a structurally issuable number is what makes the *unseparated*
 * `123456789` form safe to recognize: it rejects the bare 9-digit runs that are
 * something else, most usefully ABA routing numbers (`021000021` — group `00`).
 */
export function ssnValid(raw: string): boolean {
  const d = raw.replace(/\D/g, "");
  if (d.length !== 9) return false;
  const area = d.slice(0, 3);
  if (area === "000" || area === "666" || area.startsWith("9")) return false;
  return d.slice(3, 5) !== "00" && d.slice(5) !== "0000";
}

/**
 * ISO 13616 IBAN mod-97 check. Letters count as two digits (`A` = 10 …
 * `Z` = 35) after the country code and check digits are moved to the end; the
 * remainder is folded one character at a time so no expanded digit string is
 * built — IBAN candidates are tested at every group start of hostile input.
 */
export function ibanValid(raw: string): boolean {
  const s = raw.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{1,30}$/.test(s)) return false;
  const rearranged = s.slice(4) + s.slice(0, 4);
  let remainder = 0;
  for (let i = 0; i < rearranged.length; i++) {
    const c = rearranged.charCodeAt(i);
    remainder =
      c >= 65
        ? (remainder * 100 + c - 55) % 97
        : (remainder * 10 + c - 48) % 97;
  }
  return remainder === 1;
}

/**
 * IBAN length per country (ISO 13616 / SWIFT IBAN registry): an IBAN from a
 * given country always has exactly this many characters, spaces excluded.
 */
export const IBAN_LENGTHS: Readonly<Record<string, number>> = {
  AD: 24,
  AE: 23,
  AL: 28,
  AT: 20,
  AZ: 28,
  BA: 20,
  BE: 16,
  BG: 22,
  BH: 22,
  BI: 27,
  BR: 29,
  BY: 28,
  CH: 21,
  CR: 22,
  CY: 28,
  CZ: 24,
  DE: 22,
  DJ: 27,
  DK: 18,
  DO: 28,
  EE: 20,
  EG: 29,
  ES: 24,
  FI: 18,
  FK: 18,
  FO: 18,
  FR: 27,
  GB: 22,
  GE: 22,
  GI: 23,
  GL: 18,
  GR: 27,
  GT: 28,
  HN: 28,
  HR: 21,
  HU: 28,
  IE: 22,
  IL: 23,
  IQ: 23,
  IS: 26,
  IT: 27,
  JO: 30,
  KW: 30,
  KZ: 20,
  LB: 28,
  LC: 32,
  LI: 21,
  LT: 20,
  LU: 20,
  LV: 21,
  LY: 25,
  MC: 27,
  MD: 24,
  ME: 22,
  MK: 19,
  MN: 20,
  MR: 27,
  MT: 31,
  MU: 30,
  NI: 28,
  NL: 18,
  NO: 15,
  OM: 23,
  PK: 24,
  PL: 28,
  PS: 29,
  PT: 25,
  QA: 29,
  RO: 24,
  RS: 22,
  RU: 33,
  SA: 24,
  SC: 31,
  SD: 18,
  SE: 24,
  SI: 19,
  SK: 24,
  SM: 27,
  SO: 23,
  ST: 25,
  SV: 28,
  TL: 23,
  TN: 24,
  TR: 26,
  UA: 29,
  VA: 22,
  VG: 24,
  XK: 20,
  YE: 30,
};
