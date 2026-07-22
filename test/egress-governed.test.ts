import {
  publicKeyHex,
  type SignedReceipt,
  verifySignature,
} from "@edgeproc/avow";
import { describe, expect, it } from "vitest";
import type { EgressSubject } from "../src/index.js";
import {
  approve,
  contentHash,
  type EgressGovernance,
  guardedProvider,
  type LlmProvider,
  type RedactedPayload,
  UnapprovedPayloadError,
} from "../src/index.js";
import { redactForEgress } from "../src/redact.js";
import type { RedactedResponse } from "../src/types.js";
import { Vault } from "../src/vault.js";

const SEED_HEX =
  "0101010101010101010101010101010101010101010101010101010101010101";

/** A provider that records whether it was actually reached. */
function spyProvider(): LlmProvider & { calls: RedactedPayload[] } {
  const calls: RedactedPayload[] = [];
  return {
    calls,
    async complete(payload): Promise<RedactedResponse> {
      calls.push(payload);
      return { redactedText: payload.redactedText };
    },
  };
}

function collector(): {
  governance: (provider: string) => EgressGovernance;
  receipts: SignedReceipt<EgressSubject>[];
} {
  const receipts: SignedReceipt<EgressSubject>[] = [];
  return {
    receipts,
    governance: (provider) => ({
      provider,
      seedHex: SEED_HEX,
      onReceipt: (r) => {
        receipts.push(r);
      },
    }),
  };
}

describe("guardedProvider as a Writ-style governed egress effect", () => {
  it("an approved egress reaches the provider AND emits a verifiable allow receipt", async () => {
    const inner = spyProvider();
    const { governance, receipts } = collector();
    const guarded = guardedProvider(inner, governance("openrouter"));

    const payload = approve(
      await redactForEgress("Pay Ada Lovelace now.", new Vault()),
      () => {},
    );
    const res = await guarded.complete(payload);

    expect(res.redactedText).toContain("[NAME_1]");
    expect(inner.calls).toHaveLength(1); // the send happened
    expect(receipts).toHaveLength(1);
    const receipt = receipts[0];
    if (!receipt) throw new Error("no receipt");
    expect(receipt.payload.decision).toBe("allow");
    expect(receipt.payload.provider).toBe("openrouter");
    await expect(
      verifySignature(receipt, await publicKeyHex(SEED_HEX)),
    ).resolves.toBeUndefined();
  });

  it("a denied/fail-closed egress SENDS NOTHING and emits a verifiable denial", async () => {
    const inner = spyProvider();
    const { governance, receipts } = collector();
    const guarded = guardedProvider(inner, governance("openrouter"));

    // A structurally valid but never-approved payload (forgery / bypassed guard).
    const forged = {
      redactedText: "Pay [NAME_1] now.",
      vaultRef: { id: "forged" },
      approvedAt: Date.now(),
    } as unknown as RedactedPayload;

    await expect(guarded.complete(forged)).rejects.toThrow(
      UnapprovedPayloadError,
    );
    expect(inner.calls).toHaveLength(0); // nothing left the device

    expect(receipts).toHaveLength(1);
    const receipt = receipts[0];
    if (!receipt) throw new Error("no denial receipt");
    expect(receipt.payload.decision).toBe("deny");
    // The denial digests the ATTEMPTED redacted text, and only its hash.
    expect(receipt.payload.args_digest).toBe(
      await contentHash({ redactedText: "Pay [NAME_1] now." }),
    );
    await expect(
      verifySignature(receipt, await publicKeyHex(SEED_HEX)),
    ).resolves.toBeUndefined();
  });

  it("records malformed runtime payloads as denials instead of losing the receipt", async () => {
    const inner = spyProvider();
    const { governance, receipts } = collector();
    const guarded = guardedProvider(inner, governance("openrouter"));

    await expect(
      guarded.complete(null as unknown as RedactedPayload),
    ).rejects.toThrow(UnapprovedPayloadError);

    expect(inner.calls).toHaveLength(0);
    expect(receipts).toHaveLength(1);
    const receipt = receipts[0];
    if (!receipt) throw new Error("no denial receipt");
    expect(receipt.payload.decision).toBe("deny");
    expect(receipt.payload.args_digest).toBe(
      await contentHash({ redactedText: "<invalid-payload>" }),
    );
    await expect(
      verifySignature(receipt, await publicKeyHex(SEED_HEX)),
    ).resolves.toBeUndefined();

    const hostile = Object.defineProperty({}, "redactedText", {
      get: () => {
        throw new Error("hostile getter");
      },
    });
    await expect(
      guarded.complete(hostile as unknown as RedactedPayload),
    ).rejects.toThrow(UnapprovedPayloadError);
    expect(receipts).toHaveLength(2);
    const hostileReceipt = receipts[1];
    if (!hostileReceipt) throw new Error("no hostile denial receipt");
    await expect(
      verifySignature(hostileReceipt, await publicKeyHex(SEED_HEX)),
    ).resolves.toBeUndefined();

    await expect(
      guarded.complete({ redactedText: 42 } as unknown as RedactedPayload),
    ).rejects.toThrow(UnapprovedPayloadError);
    expect(receipts).toHaveLength(3);
  });

  it("a pinned detectorVersion is recorded in the sealed receipt", async () => {
    const inner = spyProvider();
    const receipts: SignedReceipt<EgressSubject>[] = [];
    const guarded = guardedProvider(inner, {
      provider: "openrouter",
      seedHex: SEED_HEX,
      detectorVersion: "2",
      onReceipt: (r) => {
        receipts.push(r);
      },
    });

    const payload = approve(
      await redactForEgress("hello", new Vault()),
      () => {},
    );
    await guarded.complete(payload);

    expect(receipts[0]?.payload.detector_version).toBe("2");
  });

  it("without governance, guardedProvider keeps its original guard-only behavior", async () => {
    const inner = spyProvider();
    const guarded = guardedProvider(inner);
    const forged = {
      redactedText: "x",
      vaultRef: { id: "f" },
      approvedAt: 0,
    } as unknown as RedactedPayload;
    await expect(guarded.complete(forged)).rejects.toThrow(
      UnapprovedPayloadError,
    );
    expect(inner.calls).toHaveLength(0);
  });
});
