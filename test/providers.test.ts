import { afterEach, describe, expect, it, vi } from "vitest";
import {
  approve,
  DEFAULT_OPENROUTER_MAX_RESPONSE_BYTES,
  DEFAULT_OPENROUTER_TIMEOUT_MS,
  MalformedProviderResponseError,
  NoLLMProvider,
  OpenRouterProvider,
  ProviderResponseTooLargeError,
  ProviderTimeoutError,
  redactForEgress,
  Vault,
} from "../src/index.js";

const utf8Len = (s: string): number => new TextEncoder().encode(s).byteLength;
const okCompletion = (content: string): string =>
  JSON.stringify({ choices: [{ message: { content } }] });

afterEach(() => vi.restoreAllMocks());

describe("NoLLMProvider (offline echo)", () => {
  it("reports 'no sensitive values' for a placeholder-free payload", async () => {
    const payload = approve(
      await redactForEgress("nothing sensitive here", new Vault()),
      () => {},
    );
    const reply = await new NoLLMProvider().complete(payload);
    expect(reply.redactedText).toContain("no sensitive values");
    expect(reply.redactedText).toContain("0 redacted value(s)");
  });
});

describe("OpenRouterProvider", () => {
  const cfg = { apiKey: "test-key-not-real", model: "openai/gpt-4o-mini" };

  it("exposes bounded production defaults", () => {
    expect(DEFAULT_OPENROUTER_TIMEOUT_MS).toBe(30_000);
    expect(DEFAULT_OPENROUTER_MAX_RESPONSE_BYTES).toBe(1_048_576);
  });

  it("fails with a typed timeout when the endpoint never resolves", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true },
          );
        }),
    );
    const payload = approve(
      await redactForEgress("hello", new Vault()),
      () => {},
    );

    await expect(
      new OpenRouterProvider({ ...cfg, timeoutMs: 5 }).complete(payload),
    ).rejects.toBeInstanceOf(ProviderTimeoutError);
  });

  it("fails closed before parsing a response larger than the configured cap", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("123456789", { status: 200 }),
    );
    const payload = approve(
      await redactForEgress("hello", new Vault()),
      () => {},
    );

    await expect(
      new OpenRouterProvider({ ...cfg, maxResponseBytes: 8 }).complete(payload),
    ).rejects.toBeInstanceOf(ProviderResponseTooLargeError);
  });

  it("rejects a response whose declared length already exceeds the cap", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", {
        status: 200,
        headers: { "content-length": "9" },
      }),
    );
    const payload = approve(
      await redactForEgress("hello", new Vault()),
      () => {},
    );

    await expect(
      new OpenRouterProvider({ ...cfg, maxResponseBytes: 8 }).complete(payload),
    ).rejects.toBeInstanceOf(ProviderResponseTooLargeError);
  });

  it("supports a bodyless response with a declared length within the cap", async () => {
    const body = okCompletion("ok");
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-length": String(utf8Len(body)) }),
      body: null,
      text: async () => body,
    } as Response);
    const payload = approve(
      await redactForEgress("hello", new Vault()),
      () => {},
    );

    await expect(
      new OpenRouterProvider({ ...cfg, maxResponseBytes: 1024 }).complete(
        payload,
      ),
    ).resolves.toEqual({ redactedText: "ok" });
  });

  it("refuses a bodyless response with no declared length (cannot be bounded before buffering)", async () => {
    // No stream to meter chunk-by-chunk AND no content-length to bound the read
    // means the cap cannot be enforced BEFORE `.text()` buffers the whole body,
    // so the reader fails closed rather than buffer an unbounded response.
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      body: null,
      text: async () => "123456789",
    } as Response);
    const payload = approve(
      await redactForEgress("hello", new Vault()),
      () => {},
    );

    await expect(
      new OpenRouterProvider({ ...cfg, maxResponseBytes: 8 }).complete(payload),
    ).rejects.toBeInstanceOf(ProviderResponseTooLargeError);
  });

  it("rejects a bodyless response whose declared length lies and actual bytes exceed the cap", async () => {
    // Declared length passes the pre-read check but the real body is larger — a
    // lying content-length must still be caught after the bounded read.
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-length": "2" }),
      body: null,
      text: async () => "123456789",
    } as Response);
    const payload = approve(
      await redactForEgress("hello", new Vault()),
      () => {},
    );

    await expect(
      new OpenRouterProvider({ ...cfg, maxResponseBytes: 8 }).complete(payload),
    ).rejects.toBeInstanceOf(ProviderResponseTooLargeError);
  });

  it("throws with status + body when the API responds non-OK", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("rate limited", { status: 429 }),
    );
    const payload = approve(
      await redactForEgress("hello", new Vault()),
      () => {},
    );
    await expect(new OpenRouterProvider(cfg).complete(payload)).rejects.toThrow(
      /OpenRouter 429: rate limited/,
    );
  });

  it.each([
    ["no choices array", JSON.stringify({})],
    ["an empty choices array", JSON.stringify({ choices: [] })],
    ["a choice with no message", JSON.stringify({ choices: [{}] })],
    [
      "a message with no content",
      JSON.stringify({ choices: [{ message: {} }] }),
    ],
    [
      "a non-string content",
      JSON.stringify({ choices: [{ message: { content: 42 } }] }),
    ],
  ])(
    "fails closed with MalformedProviderResponseError on %s",
    async (_label, body) => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(body, {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
      const payload = approve(
        await redactForEgress("hello", new Vault()),
        () => {},
      );
      await expect(
        new OpenRouterProvider(cfg).complete(payload),
      ).rejects.toBeInstanceOf(MalformedProviderResponseError);
    },
  );

  it("returns an empty-string content verbatim (a valid, if empty, reply)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(okCompletion(""), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const payload = approve(
      await redactForEgress("hello", new Vault()),
      () => {},
    );
    const reply = await new OpenRouterProvider(cfg).complete(payload);
    expect(reply.redactedText).toBe("");
  });

  it("honors an explicit endpoint override", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(
          JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    const payload = approve(
      await redactForEgress("hello", new Vault()),
      () => {},
    );
    const provider = new OpenRouterProvider({
      ...cfg,
      endpoint: "https://proxy.example.test/v1/chat/completions",
    });
    const reply = await provider.complete(payload);
    expect(reply.redactedText).toBe("ok");
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://proxy.example.test/v1/chat/completions",
      expect.anything(),
    );
  });
});
