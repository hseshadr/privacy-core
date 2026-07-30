import { describe, expect, it } from "vitest";
import { ibanValid, luhnValid, ssnValid } from "../src/detect/checksums.js";

describe("Luhn card checksum", () => {
  it("accepts a valid 16-digit card number", () => {
    expect(luhnValid("4242424242424242")).toBe(true);
  });

  it("rejects a digit string too short to be a card (< 13 digits)", () => {
    expect(luhnValid("424242424242")).toBe(false);
  });

  it("rejects a digit string too long to be a card (> 19 digits)", () => {
    expect(luhnValid("42424242424242424242")).toBe(false);
  });

  it("rejects a checksum-invalid number of card length", () => {
    expect(luhnValid("4242424242424241")).toBe(false);
  });
});

describe("IBAN mod-97 checksum", () => {
  it("accepts a valid IBAN (spacing and case normalized)", () => {
    expect(ibanValid("gb82 west 1234 5698 7654 32")).toBe(true);
  });

  it("rejects a string that is not IBAN-shaped at all", () => {
    expect(ibanValid("NOT AN IBAN")).toBe(false);
  });

  it("rejects an IBAN-shaped string that fails mod-97", () => {
    expect(ibanValid("GB00 WEST 1234 5698 7654 32")).toBe(false);
  });
});

/**
 * The SSA issuance rules. These are what make the UNSEPARATED `123456789` form
 * safe to recognize — without them, every 9-digit run in a document would be
 * labelled an SSN, starting with ABA routing numbers.
 */
describe("SSN issuance-rule validator", () => {
  it("accepts an issuable SSN in all three written forms", () => {
    for (const form of ["123-45-6789", "123 45 6789", "123456789"]) {
      expect(ssnValid(form), form).toBe(true);
    }
  });

  it("rejects a candidate that is not nine digits", () => {
    // Reached directly, not through `detect`: the recognizer's pattern already
    // fixes the length, so this is the guard for any other caller.
    expect(ssnValid("12345678")).toBe(false);
    expect(ssnValid("1234567890")).toBe(false);
    expect(ssnValid("")).toBe(false);
  });

  it("rejects area numbers that were never issued (000, 666, 900-999)", () => {
    expect(ssnValid("000-45-6789")).toBe(false);
    expect(ssnValid("666-45-6789")).toBe(false);
    expect(ssnValid("900-45-6789")).toBe(false);
    expect(ssnValid("999-45-6789")).toBe(false);
  });

  it("rejects group 00 — which is what spares ABA routing numbers", () => {
    expect(ssnValid("123-00-6789")).toBe(false);
    expect(ssnValid("021000021")).toBe(false);
  });

  it("rejects serial 0000", () => {
    expect(ssnValid("123-45-0000")).toBe(false);
  });
});
