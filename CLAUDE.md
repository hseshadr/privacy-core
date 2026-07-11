# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Status

Portfolio rank, tier, current state, and the next gating move live in **one place**:
the Portfolio Status table in `~/dev/project-ideas/oss/README.md`. Never restate
status here. The design spec is `~/dev/project-ideas/oss/edgeproc-privacy-core.md`;
the house standard this repo builds against is
`~/dev/project-ideas/oss/ENGINEERING-STANDARDS.md`.

## Stack

TypeScript strict / pnpm (pinned via `packageManager`) / Node >= 22.13 (24 in CI) /
Biome (lint + format + cognitive-complexity) / Vitest 4 with coverage thresholds
(90 lines / 90 functions / 85 branches) / Playwright e2e / `tsc` build. Zero runtime
dependencies — everything in `devDependencies` is toolchain.

## Layout

```
src/            library source — see docs/ARCHITECTURE.md for the 1:1 module map
  index.ts      public API barrel (production surface, nothing else)
  egress.ts     the moat: branded RedactedPayload + LlmProvider + unsafeBypass
  detect/       deterministic detection spine (patterns + checksums + dictionaries)
  providers/    NoLLMProvider (offline echo), OpenRouterProvider, makeProvider
  testing.ts    fixtures — exported ONLY via the ./testing subpath
test/           Vitest unit tests
e2e/            Playwright wire-proof (only placeholders cross the wire)
examples/demo/  runnable Vite demo consuming only the public API
docs/           ARCHITECTURE.md, QUICKSTART.md, diagrams/ (d2 + rendered svg)
```

## Invariants (don't break without updating the spec)

- **Type-enforced Egress Guard is the moat.** Providers accept only the branded
  `RedactedPayload`; `redactForEgress` is its only public constructor. Handing raw
  text to a provider is a *compile error*. `mintPendingRedaction` never leaves the
  internal module; fixtures never leave `./testing`.
- **Redaction is reversible.** Same value → same typed placeholder (`[CARD_1]`);
  `rehydrate` restores real values locally, after the reply, on-device.
- **The vault is in-memory (v0), by design.** It clears on reload; nothing sensitive
  persists. The encrypted IndexedDB vault is a labeled roadmap item — don't imply it
  exists.
- **Detection stays deterministic** (regex + checksums + dictionaries). The
  contextual NER tier is deferred and arrives only as a bounded, off-by-default
  adapter.
- **`unsafeBypass` always emits an `AuditEntry`.** The escape hatch exists to be
  visible; a silent bypass is a security bug (see SECURITY.md).

## Workflow

- TDD: red → green → refactor; bug fixes start with a failing regression test.
- Branch off `main` → PR → CI green → merge → delete branch. Never merge without the
  user's go-ahead; the repo stays private until the user flips visibility.
- Docs follow code: README/ARCHITECTURE describe only what is shipped (§8.2
  truth-in-labeling — no unshipped-runtime claims).

## Commands

```bash
pnpm install         # setup (Node >= 22.13)
pnpm gate            # THE gate: lint → typecheck → test (cov) → e2e → build
pnpm demo            # run the wow-loop demo at localhost:5173
pnpm test            # vitest run --coverage (thresholds enforced)
pnpm test:e2e        # Playwright wire-proof (needs: pnpm exec playwright install --with-deps chromium)
pnpm lint:fix        # biome check --write
```

## Quality Gates (Non-Negotiable)

Each rule carries the scar it exists to prevent:

- **`pnpm gate` green before every push, and CI literally runs `pnpm gate`.**
  Scar: this repo's own CI hand-copied five gate steps for six weeks — the day the
  gate gained coverage enforcement, a hand-copied CI would have silently kept the
  old uncovered path. Portfolio scar: edge-reco's `poe lint` missed
  `ruff format --check` and CI/local drifted until a red remote surprised a green
  local. Drift is a config bug fixed in the same commit that finds it.
- **Coverage thresholds are enforced, not reported.** Scar: this repo sat at 79.48%
  branch coverage behind a fully green suite — the OpenRouter error path,
  the unknown-token rehydrate fallback, and the overlap tie-break had zero tests
  until thresholds (90/90/85) forced them into the light (2026-07-11).
- **The e2e wire-proof must keep driving the real demo.** Scar (portfolio): an
  "OpenRouter-only" change once shipped CI-green with the selector buried in an
  unlinked tab — unit-green, product-broken. Only the placeholders-on-the-wire
  Playwright assertion proves the product's actual promise.
- **Never mix browser-safe and node-only exports in a barrel.** Scar (portfolio):
  a `node:fs` re-export in a test-seam barrel poisoned every browser importer;
  build-green, runtime-dead — only e2e caught it. `src/index.ts` stays
  browser-safe.
- **Scheduled workflows count as CI.** Scar (portfolio): the first-ever
  security-audit run caught 2 live CVEs behind a green CI badge. Check
  `gh run list --workflow=security-audit.yml` — red scheduled run = red repo.

## §8 (WASM / edge-compute standard) declaration

**§8: not applicable yet.** privacy-core ships no browser WASM runtime today — the
detection spine is pure TypeScript. §8 becomes applicable (patterns **b** — vendored
WASM runtimes + parity-tested TS, and **c** — sqlite-wasm/OPFS storage) when
in-browser NER models land (the deferred contextual-NER roadmap item). Adopt
aml-filter's ORT-web embedder hardening config verbatim at that point.
