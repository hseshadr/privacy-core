import { afterEach, describe, expect, it, vi } from "vitest";
import {
  approve,
  detect,
  type EntityType,
  OpenRouterProvider,
  redactForEgress,
  Vault,
} from "../src/index.js";

/**
 * The completeness contract, proved at the WIRE — not at the detector.
 *
 * Every case below is an ORDINARY way a real person writes a value the README,
 * QUICKSTART, ARCHITECTURE doc and package description all promise is redacted
 * on-device. A test that merely asserted `detect()` returned a span would be a
 * shape check; these drive the real egress path (redactForEgress → approve →
 * OpenRouterProvider → global fetch) and assert the raw value is genuinely
 * ABSENT from the bytes that cross the network boundary.
 *
 * The paired placeholder assertion is what stops the test passing vacuously:
 * an empty or truncated body would satisfy "not present" all on its own.
 */

interface OrdinaryCase {
  readonly label: string;
  /** The raw value that must never reach the wire. */
  readonly raw: string;
  /** Sentence a user would actually paste, containing `raw` exactly once. */
  readonly text: string;
  /** The placeholder family that must appear in its place. */
  readonly type: EntityType;
  /**
   * Identifying fragments of `raw` that must ALSO be absent. A rule that
   * matches only the ASCII tail of an address redacts `lvarez@example.com` and
   * strands `josé.á` on the wire — the raw string is technically gone while the
   * identifier is not. Whole-value absence alone would score that a pass.
   */
  readonly fragments: readonly string[];
}

const ORDINARY_PII: readonly OrdinaryCase[] = [
  {
    label: "SSN written without dashes",
    raw: "123456789",
    text: "SSN on file: 123456789 — please confirm the account.",
    type: "SSN",
    fragments: ["123456789"],
  },
  {
    label: "SSN written with spaces",
    raw: "234 56 7890",
    text: "My social is 234 56 7890 if you need it.",
    type: "SSN",
    fragments: ["234 56 7890"],
  },
  {
    label: "email with a non-ASCII local part",
    raw: "josé.álvarez@example.com",
    text: "Reply to josé.álvarez@example.com when the dispute closes.",
    type: "EMAIL",
    fragments: ["josé", "álvarez"],
  },
  {
    label: "email on a non-ASCII (IDN) domain",
    raw: "kontakt@münchen-bank.example",
    text: "The branch address is kontakt@münchen-bank.example for statements.",
    type: "EMAIL",
    fragments: ["kontakt", "münchen-bank"],
  },
  {
    label: "phone written with hyphens",
    raw: "415-555-0132",
    text: "Call me back on 415-555-0132 any weekday.",
    type: "PHONE",
    fragments: ["415-555-0132", "555-0132"],
  },
  {
    label: "phone written with dots",
    raw: "212.555.0187",
    text: "The branch line is 212.555.0187 during business hours.",
    type: "PHONE",
    fragments: ["212.555.0187", "555.0187"],
  },
  {
    label: "phone written with a +1 country code",
    raw: "+1 646 555 0143",
    text: "My mobile is +1 646 555 0143 for the callback.",
    type: "PHONE",
    fragments: ["646 555 0143", "555 0143"],
  },
];

/** Drive the real egress path and return exactly what crossed the wire. */
async function sendThroughEgress(
  text: string,
): Promise<{ body: string; userContent: string }> {
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(
      JSON.stringify({
        choices: [{ message: { role: "assistant", content: "ack" } }],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  );

  const payload = approve(await redactForEgress(text, new Vault()), () => {});
  await new OpenRouterProvider({
    apiKey: "test-key-not-real",
    model: "openai/gpt-4o-mini",
  }).complete(payload);

  const call = fetchSpy.mock.calls[0];
  if (!call) throw new Error("fetch was never called — no wire bytes to check");
  const body = String(call[1]?.body ?? "");
  // Compare against the DECODED text too: JSON escaping (\uXXXX) must not be
  // able to hide a leaked value from a raw substring check.
  const parsed = JSON.parse(body) as {
    messages?: ReadonlyArray<{ role?: string; content?: string }>;
  };
  const userContent =
    parsed.messages?.find((m) => m.role === "user")?.content ?? "";
  return { body, userContent };
}

afterEach(() => vi.restoreAllMocks());

describe("ordinary PII formats never reach the wire", () => {
  for (const { label, raw, text, type, fragments } of ORDINARY_PII) {
    it(`redacts ${label}: ${raw}`, async () => {
      const { body, userContent } = await sendThroughEgress(text);

      for (const leak of [raw, ...fragments]) {
        expect(
          userContent,
          `${type} leaked in the outbound message: ${leak}`,
        ).not.toContain(leak);
        expect(body, `${type} leaked in the wire body: ${leak}`).not.toContain(
          leak,
        );
      }
      // Non-vacuity: the value was replaced, not merely dropped.
      expect(userContent).toMatch(new RegExp(`\\[${type}_\\d+\\]`));
    });
  }
});

/**
 * The widened recognizers must not swallow things that are not PII. Every case
 * here is a value the README coverage table says is OUT of scope; if one starts
 * matching, the table has quietly stopped being true.
 */
describe("the widened recognizers do not over-match", () => {
  const typesOf = (text: string, type: EntityType) =>
    detect(text)
      .filter((s) => s.type === type)
      .map((s) => s.value);

  it("keeps a labelled account number labelled ACCOUNT, not SSN", () => {
    // 100200300 is a structurally valid SSN. RULES order is the tie-break: the
    // label-gated ACCOUNT rule is listed first, so it wins the identical span.
    const spans = detect("Account number: 100200300 was debited.");
    expect(spans.map((s) => s.type)).toEqual(["ACCOUNT"]);
    expect(spans[0]?.value).toBe("100200300");
  });

  it("does not mislabel an ABA routing number as an SSN", () => {
    // Group digits "00" are never issued in an SSN — this is what makes the
    // unseparated 9-digit form safe to recognize at all.
    expect(typesOf("Routing number: 021000021 confirmed.", "SSN")).toEqual([]);
    expect(typesOf("Routing number: 021000021 confirmed.", "ROUTING")).toEqual([
      "021000021",
    ]);
  });

  it("rejects 9-digit runs that are structurally impossible SSNs", () => {
    const impossible = [
      "000112222", // area 000
      "666112222", // area 666
      "900112222", // area 900-999
      "123002222", // group 00
      "123450000", // serial 0000
    ];
    for (const value of impossible) {
      expect(typesOf(`Reference ${value} filed.`, "SSN"), value).toEqual([]);
    }
  });

  it("does not read dotted decimals or version strings as phone numbers", () => {
    for (const text of ["Host 192.168.1.100", "Build 10.2.4 shipped"]) {
      expect(typesOf(text, "PHONE"), text).toEqual([]);
    }
  });

  it("leaves an unformatted 10-digit run alone (documented limit)", () => {
    // A bare 4155550132 is indistinguishable from an order/reference number, so
    // PHONE requires a separator or parentheses. The README says so; this pins it.
    expect(typesOf("Order 4155550132 shipped.", "PHONE")).toEqual([]);
  });

  it("does not swallow a sentence's trailing period into an email", () => {
    expect(typesOf("Write to josé@example.com.", "EMAIL")).toEqual([
      "josé@example.com",
    ]);
  });
});

/**
 * PERFORMANCE assertions, not correctness ones. Detection runs synchronously on
 * the browser thread, so a pattern that backtracks exponentially is a denial of
 * service against the redactor itself (see iban-redos.test.ts for the original
 * incident). Both widened patterns keep every quantifier un-nested; these inputs
 * are the shapes that would expose a nested one.
 */
describe("the widened recognizers stay linear on hostile input", () => {
  it("scans an adversarial near-email in well under 50ms", () => {
    // A long local-part run with no '@', then a long dotted domain-ish run that
    // can never satisfy the trailing alphanumeric requirement.
    const adversarial = `${"a.".repeat(400)}@${"b.".repeat(400)}!`;
    const start = performance.now();
    detect(adversarial);
    expect(performance.now() - start).toBeLessThan(50);
  });

  it("scans an adversarial near-phone in well under 50ms", () => {
    const adversarial = `${"555-".repeat(600)}x`;
    const start = performance.now();
    detect(adversarial);
    expect(performance.now() - start).toBeLessThan(50);
  });
});
