import { describe, expect, it } from "vitest";
import { NoLLMProvider, Vault } from "../src/index.js";

/**
 * The compile-time half of the egress guard — what the README calls "the part
 * that makes leaking a compile error". The mechanism is the phantom brand on
 * `RedactedPayload` (src/egress.ts).
 *
 * `tsc` type-checks `test/` (tsconfig.json `include`), so `@ts-expect-error` is
 * a real assertion here: if the annotated line stops being an error, TypeScript
 * reports TS2578 ("Unused '@ts-expect-error' directive") and `pnpm typecheck`
 * fails. Delete the brand and this file is what goes red.
 */
describe("the RedactedPayload brand is what rejects an unminted payload", () => {
  it("refuses a STRUCTURALLY COMPLETE hand-built payload", () => {
    const provider = new NoLLMProvider();
    // Every field of RedactedPayload, present and correctly typed — nothing is
    // missing, nothing is mistyped, no cast papers over a gap. The brand is
    // therefore the ONLY thing left that can reject this value, which is what
    // makes the red run below attributable to the brand and nothing else.
    const lookAlike = {
      redactedText: "[CARD_1] was declined",
      vaultRef: new Vault().ref,
      approvedAt: Date.now(),
    };
    const _brandProof = () => {
      // @ts-expect-error the phantom brand — and nothing else — rejects this.
      return provider.complete(lookAlike);
    };
    expect(typeof _brandProof).toBe("function");
  });
});
