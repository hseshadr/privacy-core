import { describe, expect, it } from "vitest";
import {
  makeProvider,
  NoLLMProvider,
  OpenRouterProvider,
} from "../src/index.js";

describe("makeProvider", () => {
  it("falls back to the offline echo when no API key is set", () => {
    const { provider, label } = makeProvider();
    expect(provider).toBeInstanceOf(NoLLMProvider);
    expect(label).toContain("offline echo");
  });

  it("treats a blank/whitespace key as absent (no accidental live calls)", () => {
    const { provider } = makeProvider({ apiKey: "   " });
    expect(provider).toBeInstanceOf(NoLLMProvider);
  });

  it("selects OpenRouter when a real key is present, surfacing the model in the label", () => {
    const { provider, label } = makeProvider({
      apiKey: "sk-not-real",
      model: "openai/gpt-4o-mini",
    });
    expect(provider).toBeInstanceOf(OpenRouterProvider);
    expect(label).toContain("openai/gpt-4o-mini");
  });
});
