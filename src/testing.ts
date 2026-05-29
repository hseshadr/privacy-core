/**
 * Test-only fixtures, exposed via the `@edgeproc/privacy-core/testing` subpath.
 * These are NOT part of the production barrel — keep synthetic data out of the
 * front door so consumers never ship a fixture by accident.
 */

/**
 * SYNTHETIC, INVENTED bank statement. Contains NO real PII.
 * - Card 4242…4242 is the canonical Stripe test card (Luhn-valid, not issued).
 * - IBAN GB82 WEST… is the public mod-97 IBAN example from Wikipedia.
 * - SSN 123-45-6789 is a textbook placeholder.
 * - Routing 021000021 is a published ABA test routing number (JPMorgan Chase).
 */
export const SYNTHETIC_STATEMENT = `MONTHLY STATEMENT — FIRST INVENTED BANK

Account holder: Ada Lovelace
Email: ada.lovelace@example.com
Phone: (415) 555-0132
SSN on file: 123-45-6789

Account number: 000123456789
Routing number: 021000021
Linked IBAN: GB82 WEST 1234 5698 7654 32
Card on file: 4242 4242 4242 4242

Transactions:
  01/05/2026  Whole Foods            $1,482.10
  01/09/2026  Starbucks                 $7.45
  01/14/2026  Amazon                  $329.00

Please review the charge to Whole Foods.`;
