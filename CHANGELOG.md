# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
