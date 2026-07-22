# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Governed egress now records a signed denial even when a plain-JavaScript caller
  supplies a malformed payload (`null`, a non-string text field, or a hostile
  getter), preserving the fail-closed error and receipt invariant.
- Redaction now rejects inputs over 512 KiB of UTF-8 before detector, vault, or
  audit work, with an exported typed error and documented limit.
- OpenRouter requests now have a 30-second default deadline and 1 MiB streamed
  response cap, with optional configuration overrides and typed fail-closed
  timeout/overflow errors.

## [0.2.1] — 2026-07-21

First release shipped through the token-free OIDC release rail: a `v*` tag push
runs the reusable `hseshadr/ci` publish workflow, which authenticates to npm as
a registered Trusted Publisher — no npm token exists anywhere in this repo.
No library code changes.

### Added

- Tag-triggered npm publish caller (`.github/workflows/publish.yml`) delegating
  to the reusable `hseshadr/ci` ts-publish workflow via OIDC Trusted Publishing.
- `repository.url` in `package.json` (required for npm OIDC trusted publishing).

### Changed

- README rewritten around a concrete scenario a first-time reader immediately
  gets; docs scrubbed of internal vocabulary.
- The receipt-sealing claim in the docs is scoped to its opt-in reality.

### Security

- All GitHub Actions pinned to full commit SHAs and enforced by the test suite;
  the publish caller pins the `hseshadr/ci` reusable workflow to an immutable
  SHA (ci-v2.0.3), closing the transitive pinning hole.
- pnpm supply-chain cooldown (minimum release age) restored and guarded with a
  test against silent exemptions.
- Signature and residual-leak tests strengthened to exercise the properties
  they name.

## [0.2.0] — 2026-07-20

A breaking release (the egress API changed, see below). Also drops the local
`link:` dependency on `@edgeproc/avow` in favour of the published
`@edgeproc/avow@^0.1.0` from npm, and publishes this package publicly as
`@edgeproc/privacy-core`.

### Changed — BREAKING

- **Approval is now an explicit step, never a side effect.** `redactForEgress`
  returns a `PendingRedaction` (a review proposal — not sendable) instead of a
  `RedactedPayload`; the new `approve(pending, audit?)` step is the only way to
  mint the sendable capability, and it emits an `"approve"` audit entry. A
  zero-detection result no longer auto-approves: "the detector found nothing"
  is not "a reviewer approved this". Migration:
  `provider.complete(await redactForEgress(raw, vault))` →
  `provider.complete(approve(await redactForEgress(raw, vault)))`.
  `approve()` rejects hand-built pendings with the typed `ForgedPayloadError`.
- **The capability is now unforgeable at runtime, not just in the type
  system.** Every approved payload is registered by identity in a
  module-private `WeakSet`; every provider adapter calls the new
  `assertApproved()` before doing anything, so a structurally identical
  hand-built payload (or a spread-clone of a real one) is rejected with the
  typed `UnapprovedPayloadError` before any network call. Payloads and
  pendings are frozen, closing the mutate-after-approval hole. Custom
  `LlmProvider` implementations should call `assertApproved()` first —
  it is exported for exactly that.
- **Reversibility failures now fail closed with typed errors.**
  `redactForEgress` throws `PlaceholderCollisionError` when the input already
  contains placeholder-shaped text (`[CARD_1]`) — previously such text passed
  through and `rehydrate` would silently substitute vault values into text
  that never contained them. `rehydrate` accepts the payload's `vaultRef` as
  an optional third argument and throws `VaultMismatchError` when handed the
  wrong vault instead of silently restoring wrong/missing values (the demo
  passes it).

### Added

- `LICENSE` file (MIT — the license the package always claimed), `SECURITY.md`,
  `CONTRIBUTING.md`, and `CLAUDE.md` (agent doc with scarred quality gates and
  the §8 not-applicable-yet declaration).
- `docs/ARCHITECTURE.md` + `docs/QUICKSTART.md` with a committed d2 diagram
  (`docs/diagrams/privacy-loop.d2` + rendered SVG) of the
  detect → vault → egress-guard → rehydrate loop.
- Coverage thresholds (90 lines / 90 functions / 85 branches) enforced via
  `pnpm test`, plus the tests that took branch coverage from 79% to 100%
  (checksum bounds, unknown-token rehydrate, provider error paths, detector
  overlap tie-break).
- Biome `noExcessiveCognitiveComplexity` (max 15) as the TS complexity gate.
- CI: gitleaks full-history job, weekly `pnpm audit --audit-level moderate`
  security-audit workflow, and grouped weekly dependabot updates.

### Changed

- `ci.yml` now literally runs `pnpm gate` (the exact local command) instead of
  five hand-copied steps; `pnpm/action-setup` v4 → v6 (version read from
  `packageManager`).

## [0.1.0] — 2026-05-29

Initial graduation from the proven spike: deterministic detection spine +
reversible in-memory vault + type-enforced Egress Guard + redact→rehydrate loop
+ demo.

### Added

- **Deterministic detection spine** (`detect`) — ported Presidio-style regex +
  checksum recognizers (Luhn, IBAN mod-97, SSN, email, phone, amounts, dates)
  plus finance/name dictionaries.
- **Reversible in-memory vault** (`Vault`) — stable typed placeholders
  (`[CARD_1]`, `[NAME_2]`), same value → same token.
- **Type-enforced Egress Guard** — branded `RedactedPayload`, the `LlmProvider`
  interface that accepts only that brand, and the audited `unsafeBypass` escape
  hatch. Handing raw text to a provider is a compile error.
- **Reversible loop** — `redactForEgress` (the only legitimate payload
  constructor) and `rehydrate` (local restore).
- **Providers** — `NoLLMProvider` (offline echo, runs cold), `OpenRouterProvider`
  (OpenAI-compatible), and `makeProvider` factory.
- **Runnable demo** (`examples/demo`) consuming only the public API, with the
  redact → preview → send → rehydrate wow loop and a `docs/wow.png` proof.
- **Tests** — Vitest unit suite + a Playwright headless-chromium e2e that asserts
  only placeholders cross the wire.
