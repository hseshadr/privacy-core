import { describe, expect, it } from "vitest";
import {
  MissingApiKeyError,
  makeProvider,
  NoLLMProvider,
  OpenRouterProvider,
} from "../src/index.js";

describe("makeProvider", () => {
  it("returns the offline echo ONLY when it is explicitly enabled", () => {
    const { provider, label } = makeProvider({ allowOffline: true });
    expect(provider).toBeInstanceOf(NoLLMProvider);
    expect(label).toContain("offline echo");
  });

  it("treats a blank/whitespace key as absent, still honouring the opt-in", () => {
    const { provider } = makeProvider({ apiKey: "   ", allowOffline: true });
    expect(provider).toBeInstanceOf(NoLLMProvider);
  });

  it("fails closed with MissingApiKeyError when no key and offline not opted in", () => {
    // The silent-fallback bug: a real deployment that forgets its key must NOT
    // quietly downgrade to a no-op provider.
    expect(() => makeProvider()).toThrow(MissingApiKeyError);
  });

  it("fails closed on a blank key without the offline opt-in", () => {
    expect(() => makeProvider({ apiKey: "   " })).toThrow(MissingApiKeyError);
  });

  it("selects OpenRouter when a real key is present, surfacing the model in the label", () => {
    const { provider, label } = makeProvider({
      apiKey: "sk-not-real",
      model: "openai/gpt-4o-mini",
    });
    expect(provider).toBeInstanceOf(OpenRouterProvider);
    expect(label).toContain("openai/gpt-4o-mini");
  });

  it("prefers a real key over the offline opt-in", () => {
    const { provider } = makeProvider({
      apiKey: "sk-not-real",
      allowOffline: true,
    });
    expect(provider).toBeInstanceOf(OpenRouterProvider);
  });
});
