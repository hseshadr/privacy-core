import { afterEach, describe, expect, it, vi } from "vitest";
import {
  approve,
  OpenRouterProvider,
  redactForEgress,
  Vault,
} from "../src/index.js";
import { SYNTHETIC_STATEMENT } from "../src/testing.js";

// The raw PII values planted in the synthetic statement. NONE may appear on the wire.
const RAW_PII = [
  "4242 4242 4242 4242",
  "GB82 WEST 1234 5698 7654 32",
  "123-45-6789",
  "ada.lovelace@example.com",
  "000123456789",
  "021000021",
  "$1,482.10",
  "Ada Lovelace",
  "Whole Foods",
  // The formats added to the fixture for the browser e2e, kept in lockstep here
  // so a regression trips the fast unit gate too, not only Playwright.
  "223456789",
  "234 56 7890",
  "josé.álvarez@example.com",
  "kontakt@münchen-bank.example",
  "415-555-0148",
  "212.555.0187",
  "+1 646 555 0143",
  // Identifying fragments — a PARTIAL redaction must not pass as a clean send.
  "josé",
  "álvarez",
  "kontakt",
  "münchen-bank",
];

afterEach(() => vi.restoreAllMocks());

describe("HEADLINE: the network-tab proof, automated", () => {
  it("the outbound request body contains ONLY placeholders and NONE of the raw PII", async () => {
    // Spy on the exact network egress: global fetch.
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "ack" } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const vault = new Vault();
    const payload = approve(
      await redactForEgress(SYNTHETIC_STATEMENT, vault),
      () => {},
    );

    const provider = new OpenRouterProvider({
      apiKey: "test-key-not-real",
      model: "openai/gpt-4o-mini",
    });
    await provider.complete(payload);

    // Capture exactly what crossed the wire.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const call = fetchSpy.mock.calls[0];
    if (!call) throw new Error("fetch was not called");
    const init = call[1];
    const wireBody = String(init?.body ?? "");

    // 1. NONE of the raw PII leaked.
    for (const secret of RAW_PII) {
      expect(wireBody, `raw PII leaked to wire: ${secret}`).not.toContain(
        secret,
      );
    }

    // 2. Placeholders DID cross (proof the redacted text is what was sent).
    expect(wireBody).toMatch(/\[CARD_\d+\]/);
    expect(wireBody).toMatch(/\[NAME_\d+\]/);
    expect(wireBody).toMatch(/\[AMOUNT_\d+\]/);
  });
});
