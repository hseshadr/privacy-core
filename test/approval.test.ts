import { describe, expect, it, vi } from "vitest";
import {
  approve,
  ForgedPayloadError,
  NoLLMProvider,
  redactForEgress,
  Vault,
} from "../src/index.js";

describe("explicit approval (a capability is earned by review, never implied)", () => {
  it("a ZERO-detection redaction result is not sendable and carries no approvedAt", async () => {
    const pending = await redactForEgress(
      "nothing sensitive here",
      new Vault(),
    );
    // No approval side effect: the pending proposal has no approvedAt at all.
    expect(Object.keys(pending)).not.toContain("approvedAt");

    const provider = new NoLLMProvider();
    const _compileProof = () => {
      // @ts-expect-error a pending (unapproved) redaction is not sendable.
      return provider.complete(pending);
    };
    expect(typeof _compileProof).toBe("function");
  });

  it("a redaction WITH detections is equally unapproved until the explicit step", async () => {
    const pending = await redactForEgress("Pay Ada Lovelace now.", new Vault());
    expect(Object.keys(pending)).not.toContain("approvedAt");
    expect(pending.redactedText).not.toContain("Ada Lovelace");
  });

  it("approve() is the only step that mints a sendable payload, and it is audited", async () => {
    const auditSink = vi.fn();
    const pending = await redactForEgress(
      "nothing sensitive here",
      new Vault(),
    );
    const payload = approve(pending, auditSink);
    expect(payload.approvedAt).toBeTypeOf("number");
    expect(payload.redactedText).toBe(pending.redactedText);
    expect(auditSink).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "approve" }),
    );
    // The approved payload is accepted by a provider.
    const reply = await new NoLLMProvider().complete(payload);
    expect(reply.redactedText).toContain("no sensitive values");
  });

  it("approve() rejects a hand-built pending object with a typed error", () => {
    const forgedPending = {
      redactedText: "raw secret text pretending to be redacted",
      vaultRef: { id: "fake" },
      placeholders: [],
    };
    expect(() => approve(forgedPending as never)).toThrow(ForgedPayloadError);
  });
});
