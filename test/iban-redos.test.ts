import { describe, expect, it } from "vitest";
import { detect } from "../src/index.js";

/**
 * ReDoS regression for the IBAN recognizer.
 *
 * The original pattern `\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{2,4})+\b` nests a bounded
 * quantifier (`{2,4}`) inside an unbounded one (`+`). A long run of uppercase
 * alphanumerics that cannot satisfy the trailing `\b` (a trailing lowercase
 * letter keeps the boundary between two word characters) forces the engine to
 * try every 2-4 partition of the run — catastrophic, exponential backtracking.
 * On this input the old pattern took ~0.5s of pure CPU on a single string,
 * which on the browser thread means a frozen tab: a denial of service against
 * the very "synchronous detection bounded on the browser thread" guarantee the
 * redactor advertises.
 *
 * The fix keeps whitespace tolerance (real IBANs are grouped in fours) but
 * replaces the nested quantifier with a single-character unit repeated a bounded
 * number of times, which is linear. This test is a PERFORMANCE assertion, not a
 * correctness one: it fails (by wall-clock) on the vulnerable pattern and passes
 * comfortably on the linear one.
 */
describe("IBAN detection is not vulnerable to catastrophic backtracking", () => {
  // 2 letters + 2 digits, then a long uppercase run, then a lowercase letter so
  // the final \b sits between two word chars and can never match — the exact
  // shape that made the nested-quantifier pattern blow up.
  const adversarial = `GB82${"A".repeat(48)}a`;

  it("completes an adversarial near-IBAN in well under 50ms", () => {
    const start = performance.now();
    const spans = detect(adversarial);
    const elapsed = performance.now() - start;

    // The vulnerable pattern spends ~500ms here; the linear one spends <1ms.
    // 50ms is a generous ceiling that still separates the two by an order of
    // magnitude on any CI hardware.
    expect(elapsed).toBeLessThan(50);
    // And it is genuinely not a valid IBAN, so nothing is (mis)detected.
    expect(spans.filter((s) => s.type === "IBAN")).toHaveLength(0);
  });

  it("still detects both spaced and compact valid IBANs", () => {
    const spaced = detect("Linked IBAN: GB82 WEST 1234 5698 7654 32 today.");
    expect(spaced.filter((s) => s.type === "IBAN").map((s) => s.value)).toEqual(
      ["GB82 WEST 1234 5698 7654 32"],
    );

    const compact = detect("IBAN GB82WEST12345698765432 confirmed.");
    expect(
      compact.filter((s) => s.type === "IBAN").map((s) => s.value),
    ).toEqual(["GB82WEST12345698765432"]);
  });
});
