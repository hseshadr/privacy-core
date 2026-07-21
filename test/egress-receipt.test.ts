import {
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

  it("rejects a receipt under a wrong pinned key with SignatureInvalid", async () => {
    const receipt = await sealEgressReceipt(
      { provider: "openrouter", redactedText: REDACTED, decision: "allow" },
      SEED_HEX,
    );
    await expect(verifySignature(receipt, WRONG_KEY)).rejects.toThrow(
      SignatureInvalid,
    );
  });
});
