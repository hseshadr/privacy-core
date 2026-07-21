import {
  type AvowError,
  contentHash,
  publicKeyHex,
  ReplayMismatch,
  SignatureInvalid,
  verifySignature,
} from "@edgeproc/avow";
import { describe, expect, it } from "vitest";
import {
  buildEgressSubject,
  DETECTOR_VERSION,
  sealEgressReceipt,
} from "../src/egressReceipt.js";

// A FIXED test-only seed (documented non-secret) so signatures are reproducible.
const SEED_HEX =
  "0101010101010101010101010101010101010101010101010101010101010101";
const WRONG_KEY =
  "0000000000000000000000000000000000000000000000000000000000000000";

// The redacted text a reviewer approved to leave the device — already scrubbed.
const REDACTED = "Pay [NAME_1] from account [ACCOUNT_1].";
// A raw secret that MUST NOT appear anywhere in a signed receipt.
const RAW_PII = "Ada Lovelace, account 021000021";

/**
 * `SignatureInvalid` covers TWO different failures, and a test that asserts only
 * the class cannot tell them apart:
 *
 *   1. the embedded `public_key` is not the pinned signer — a plain string
 *      comparison that short-circuits BEFORE any cryptography runs, and
 *   2. the Ed25519 signature bytes do not verify — the actual curve check.
 *
 * Asserting the class alone means a garbage pinned key rejects byte-identically
 * to a forged signature, so the ed25519 verification is never exercised at all.
 * These messages are what separate the two paths, so each is pinned by name.
 */
const PINNED_KEY_MISMATCH = "receipt public key is not the expected signer";
const SIGNATURE_MISMATCH = "signature does not match payload";

/**
 * Capture the coded error a verification rejects with, so the exact failure can
 * be asserted. Throws if the promise RESOLVES, so a verification that stopped
 * failing can never masquerade as a pass.
 */
async function rejectionOf(promise: Promise<unknown>): Promise<AvowError> {
  try {
    await promise;
  } catch (error) {
    return error as AvowError;
  }
  throw new Error("expected verification to reject, but it resolved");
}

describe("egress subject (a Writ-style effect over the egress decision)", () => {
  it("digests only the redacted text, never storing the plaintext", async () => {
    const subject = await buildEgressSubject({
      provider: "openrouter",
      redactedText: REDACTED,
      decision: "allow",
    });
    expect(subject.action).toBe("llm.egress");
    expect(subject.provider).toBe("openrouter");
    expect(subject.decision).toBe("allow");
    expect(subject.detector_version).toBe(DETECTOR_VERSION);
    // The digest is exactly the hash of {redactedText} — nothing else.
    expect(subject.args_digest).toBe(
      await contentHash({ redactedText: REDACTED }),
    );
    // The subject itself carries no readable text field, only the digest.
    expect(JSON.stringify(subject)).not.toContain(REDACTED);
  });

  it("is deterministic: identical inputs yield an identical digest", async () => {
    const a = await buildEgressSubject({
      provider: "openrouter",
      redactedText: REDACTED,
      decision: "allow",
    });
    const b = await buildEgressSubject({
      provider: "openrouter",
      redactedText: REDACTED,
      decision: "allow",
    });
    expect(a.args_digest).toBe(b.args_digest);
  });
});

describe("egress receipt (signed, pinned-key verifiable)", () => {
  it("an approved egress emits a receipt that verifies under the pinned key", async () => {
    const receipt = await sealEgressReceipt(
      { provider: "openrouter", redactedText: REDACTED, decision: "allow" },
      SEED_HEX,
    );
    const pinned = await publicKeyHex(SEED_HEX);
    await expect(verifySignature(receipt, pinned)).resolves.toBeUndefined();
    expect(receipt.payload.decision).toBe("allow");
  });

  it("a denial is a signed, verifiable receipt just like an allow", async () => {
    const receipt = await sealEgressReceipt(
      { provider: "openrouter", redactedText: REDACTED, decision: "deny" },
      SEED_HEX,
    );
    await expect(
      verifySignature(receipt, await publicKeyHex(SEED_HEX)),
    ).resolves.toBeUndefined();
    expect(receipt.payload.decision).toBe("deny");
  });

  it("NO plaintext PII appears anywhere in a signed receipt", async () => {
    // The caller hands the guard the redacted (safe) text; the raw PII the
    // vault holds must never be derivable from the receipt. We seal over the
    // redacted text and assert neither the redacted body nor the raw value
    // is present — only the sha256 digest is.
    const receipt = await sealEgressReceipt(
      { provider: "openrouter", redactedText: REDACTED, decision: "allow" },
      SEED_HEX,
    );
    const serialized = JSON.stringify(receipt);
    expect(serialized).not.toContain(REDACTED);
    expect(serialized).not.toContain(RAW_PII);
    expect(serialized).not.toContain("Ada Lovelace");
    expect(receipt.payload.args_digest.startsWith("sha256:")).toBe(true);
  });

  it("rejects a tampered decision with a coded ReplayMismatch", async () => {
    const receipt = await sealEgressReceipt(
      { provider: "openrouter", redactedText: REDACTED, decision: "allow" },
      SEED_HEX,
    );
    const tampered = {
      ...receipt,
      payload: { ...receipt.payload, decision: "deny" as const },
    };
    await expect(
      verifySignature(tampered, await publicKeyHex(SEED_HEX)),
    ).rejects.toThrow(ReplayMismatch);
  });

  it("rejects a receipt under a wrong pinned key, naming the KEY as the cause", async () => {
    const receipt = await sealEgressReceipt(
      { provider: "openrouter", redactedText: REDACTED, decision: "allow" },
      SEED_HEX,
    );
    const error = await rejectionOf(verifySignature(receipt, WRONG_KEY));
    expect(error).toBeInstanceOf(SignatureInvalid);
    expect(error.code).toBe("avow.signature_invalid");
    // The key-pinning short-circuit, NOT the curve check — that distinction is
    // the whole point, and only the message carries it.
    expect(error.message).toBe(PINNED_KEY_MISMATCH);
  });

  it("rejects a corrupted signature under the CORRECT pinned key — the ed25519 check", async () => {
    const receipt = await sealEgressReceipt(
      { provider: "openrouter", redactedText: REDACTED, decision: "allow" },
      SEED_HEX,
    );
    // A whole, well-formed Ed25519 signature from the SAME signer over DIFFERENT
    // content. Replacing the signature ENTIRELY is deliberate: Ed25519 requires
    // S < L, so the final byte is already 0x00 roughly 1 time in 16, and nudging
    // only that byte silently no-ops at the same rate — a measured false-pass.
    const overOtherContent = await sealEgressReceipt(
      { provider: "openrouter", redactedText: REDACTED, decision: "deny" },
      SEED_HEX,
    );
    const forged = { ...receipt, signature: overOtherContent.signature };
    expect(forged.signature).not.toBe(receipt.signature);

    const pinned = await publicKeyHex(SEED_HEX);
    // The key matches and the payload hash still recomputes, so BOTH earlier
    // guards pass. Only the curve verification can reject this receipt.
    expect(forged.public_key).toBe(pinned);
    const error = await rejectionOf(verifySignature(forged, pinned));
    expect(error).toBeInstanceOf(SignatureInvalid);
    expect(error.code).toBe("avow.signature_invalid");
    expect(error.message).toBe(SIGNATURE_MISMATCH);
  });
});
