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

/** Compute n mod 97 over a decimal string too large for Number. */
function mod97(numeric: string): number {
  let remainder = 0;
  for (const ch of numeric) {
    remainder = (remainder * 10 + (ch.charCodeAt(0) - 48)) % 97;
  }
  return remainder;
}

/** ISO 13616 IBAN mod-97 check. */
export function ibanValid(raw: string): boolean {
  const s = raw.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{1,30}$/.test(s)) return false;
  const rearranged = s.slice(4) + s.slice(0, 4);
  const expanded = rearranged.replace(/[A-Z]/g, (c) =>
    String(c.charCodeAt(0) - 55),
  );
  return mod97(expanded) === 1;
}
