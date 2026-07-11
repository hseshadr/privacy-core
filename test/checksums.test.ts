import { describe, expect, it } from "vitest";
import { ibanValid, luhnValid } from "../src/detect/checksums.js";

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
