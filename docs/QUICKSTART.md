# Quickstart

The canonical runnable path lives in the [README Quickstart](../README.md#quickstart--one-command-see-the-proof) —
this page is the same loop, condensed.

## Run the demo (no API key needed)

```bash
# Prereqs: Node >= 22.13, pnpm (pinned via packageManager). From the repo root:
pnpm install && pnpm demo
```

Open <http://localhost:5173>. A synthetic bank statement is pre-loaded: you'll see the
raw text, the exact redacted wire payload, and — after **Send** — the locally
rehydrated answer. With no key set, the offline echo provider (`NoLLMProvider`) is
used, so the whole loop runs cold.

To call a real model, copy `.env.example` → `examples/demo/.env`, set
`OPENROUTER_API_KEY`, and add `VITE_USE_OPENROUTER=1`. The demo then routes through
a same-origin dev proxy that injects the key server-side — it never reaches the
browser. Either way, **only placeholders cross the wire** — verify it yourself in
the browser's network tab.

## Prove it headlessly

```bash
pnpm exec playwright install --with-deps chromium   # first time only
pnpm test:e2e
```

Drives the demo in real Chromium, intercepts the request, and asserts only
placeholders crossed (the screenshot lands in the gitignored `test-results/`).

## Run the full quality gate

```bash
pnpm gate
```

Biome lint/format → typecheck → Vitest (coverage thresholds) → Playwright e2e →
build. CI runs this exact command.
