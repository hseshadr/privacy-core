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
