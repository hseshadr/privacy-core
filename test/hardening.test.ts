import { describe, expect, it, vi } from "vitest";
import {
  approve,
  guardedProvider,
  type LlmProvider,
  NoLLMProvider,
  type RedactedPayload,
  redactForEgress,
  UnapprovedPayloadError,
  Vault,
} from "../src/index.js";

/** Structurally identical to an approved payload — but never minted by the guard. */
function forge(): RedactedPayload {
  return {
    redactedText: "raw statement smuggled past the guard",
    vaultRef: { id: "x" },
    approvedAt: Date.now(),
  } as unknown as RedactedPayload;
}

describe("Vault.ref is frozen (the payload binding cannot be rewritten)", () => {
  it("is frozen and cannot be mutated", () => {
    const vault = new Vault();
    expect(Object.isFrozen(vault.ref)).toBe(true);
    expect(() => {
      // @ts-expect-error ref.id is readonly; it is also frozen at runtime.
      vault.ref.id = "attacker-controlled";
    }).toThrow(TypeError);
    expect(vault.ref.id).not.toBe("attacker-controlled");
  });
});

describe("guardedProvider is the single-chokepoint runtime guard", () => {
  it("enforces assertApproved even when the wrapped provider forgot to", async () => {
    // A careless third-party provider that never calls assertApproved.
    const careless: LlmProvider = {
      async complete(payload) {
        return { redactedText: payload.redactedText }; // no guard!
      },
    };
    // Unwrapped, the forged payload leaks straight through.
    await expect(careless.complete(forge())).resolves.toBeDefined();
    // Wrapped, the chokepoint rejects it before the inner provider runs.
    await expect(guardedProvider(careless).complete(forge())).rejects.toThrow(
      UnapprovedPayloadError,
    );
  });

  it("delegates to the inner provider for a genuinely approved payload", async () => {
    const guarded = guardedProvider(new NoLLMProvider());
    const payload = approve(
      await redactForEgress("Pay Ada Lovelace.", new Vault()),
      () => {},
    );
    const reply = await guarded.complete(payload);
    expect(reply.redactedText).toContain("[NAME_1]");
  });
});

describe("approve() requires an audit sink (every approval is observable)", () => {
  it("does not compile without a sink", async () => {
    const pending = await redactForEgress("Pay Ada Lovelace.", new Vault());
    const _proof = () => {
      // @ts-expect-error the audit sink is required — approval must be observable.
      return approve(pending);
    };
    expect(typeof _proof).toBe("function");
  });

  it("emits an approve entry to the required sink", async () => {
    const sink = vi.fn();
    const payload = approve(
      await redactForEgress("Pay Ada Lovelace.", new Vault()),
      sink,
    );
    expect(payload.approvedAt).toBeTypeOf("number");
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "approve" }),
    );
  });
});
