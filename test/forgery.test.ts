import { afterEach, describe, expect, it, vi } from "vitest";
import {
  approve,
  NoLLMProvider,
  OpenRouterProvider,
  type RedactedPayload,
  redactForEgress,
  UnapprovedPayloadError,
  unsafeBypass,
  Vault,
} from "../src/index.js";

afterEach(() => vi.restoreAllMocks());

/** Structurally identical to an approved payload — but never minted by the guard. */
function forge(): RedactedPayload {
  return {
    redactedText: "raw bank statement smuggled past the guard",
    vaultRef: { id: "vault-1" },
    approvedAt: Date.now(),
  } as unknown as RedactedPayload;
}

describe("runtime-unforgeable capability (identity registry, not just types)", () => {
  it("OpenRouterProvider rejects a hand-built payload with a typed error and never touches the network", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const provider = new OpenRouterProvider({
      apiKey: "test-key-not-real",
      model: "openai/gpt-4o-mini",
    });
    await expect(provider.complete(forge())).rejects.toThrow(
      UnapprovedPayloadError,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("NoLLMProvider rejects the same forgery", async () => {
    await expect(new NoLLMProvider().complete(forge())).rejects.toThrow(
      UnapprovedPayloadError,
    );
  });

  it("a structural CLONE of a genuinely approved payload is rejected — identity, not shape", async () => {
    const payload = approve(
      await redactForEgress("Pay Ada Lovelace.", new Vault()),
      () => {},
    );
    const clone = { ...payload };
    await expect(
      new NoLLMProvider().complete(clone as RedactedPayload),
    ).rejects.toThrow(UnapprovedPayloadError);
  });

  it("approved payloads are frozen — text cannot be swapped after approval", async () => {
    const payload = approve(
      await redactForEgress("Pay Ada Lovelace.", new Vault()),
      () => {},
    );
    expect(Object.isFrozen(payload)).toBe(true);
  });

  it("the audited unsafeBypass capability IS accepted (guard-minted, on purpose)", async () => {
    const bypassed = unsafeBypass("raw text", "test override", () => {});
    const reply = await new NoLLMProvider().complete(bypassed);
    expect(reply.redactedText).toBeTypeOf("string");
  });
});
