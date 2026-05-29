import { describe, expect, it, vi } from "vitest";
import {
  NoLLMProvider,
  type RedactedPayload,
  Vault,
  redactForEgress,
  unsafeBypass,
} from "../src/index.js";

describe("Egress Guard", () => {
  it("the redaction pipeline is the only legitimate constructor of a RedactedPayload", async () => {
    const vault = new Vault();
    const payload = await redactForEgress("Pay Ada Lovelace now.", vault);
    expect(payload.__brand).toBe("RedactedPayload");
    expect(payload.approvedAt).toBeTypeOf("number");
    // The redacted text must not contain the raw name.
    expect(payload.redactedText).not.toContain("Ada Lovelace");
  });

  it("complete() accepts a real RedactedPayload and runs the loop", async () => {
    const vault = new Vault();
    const payload = await redactForEgress("Pay Ada Lovelace now.", vault);
    const provider = new NoLLMProvider();
    const res = await provider.complete(payload);
    expect(res.redactedText).toContain("[NAME_1]");
  });

  it("the named escape hatch is the ONLY way raw text reaches a provider, and it is audited", () => {
    const auditSink = vi.fn();
    const bypassed = unsafeBypass(
      "raw bank statement",
      "demo override",
      auditSink,
    );
    expect(bypassed.__brand).toBe("RedactedPayload");
    expect(bypassed.redactedText).toBe("raw bank statement"); // raw, on purpose
    expect(auditSink).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "unsafe-bypass",
        reason: "demo override",
      }),
    );
  });

  it("COMPILE-TIME PROOF: a raw string is not assignable where RedactedPayload is required", () => {
    const provider = new NoLLMProvider();
    // The following lines are NEVER executed — they exist only so `tsc` (run by
    // `pnpm build`/`typecheck`) proves the egress invariant. If raw text became
    // assignable, `@ts-expect-error` would itself error and the build would fail.
    const _proof = () => {
      // @ts-expect-error raw string must be a compile error at the egress boundary.
      provider.complete("my raw bank statement");

      const fake = { redactedText: "x" } as unknown;
      // @ts-expect-error a hand-rolled literal cannot forge the brand.
      const _typed: RedactedPayload = fake;
      return _typed;
    };
    expect(typeof _proof).toBe("function");
  });
});
