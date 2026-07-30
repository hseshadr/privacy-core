# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **The detector no longer leaks three ordinary formats of the PII it advertises.**
  Each was a real leak, reproduced as a failing test that drove the value through
  the actual send path before any fix landed.
  - **Email now matches every script.** JavaScript's `\w` and `\b` are ASCII-only,
    so `josé.álvarez@example.com` matched only its ASCII tail and was redacted as
    `josé.á[EMAIL_1]` — a silent PARTIAL leak that a whole-value absence check
    would have scored a pass. The recognizer now uses Unicode property escapes
    under the `u` flag on both sides of the `@`, so IDN domains match too. Edges
    are asserted explicitly (a lookbehind, and a trailing alphanumeric) since `\b`
    could not do the job; every quantifier stays un-nested, so the pattern is
    linear and a ReDoS test pins that.
  - **SSN now matches `123 45 6789` and unseparated `123456789`**, not only the
    dashed form. All three are gated on the SSA issuance rules (new `ssnValid`:
    area not `000`/`666`/`9xx`, group not `00`, serial not `0000`), which is what
    makes a bare 9-digit run safe to recognize — group `00` is never issued, so
    ABA routing numbers are excluded by construction.
  - **Phone now matches the NANP set**, not only `(415) 555-0132`: `-`, `.` or
    space separators, optional parentheses, optional `+1`. Area and exchange must
    start `2-9`. An unformatted 10-digit run is still deliberately NOT matched.

### Changed

- **The browser e2e now proves the widened formats in real Chromium.**
  `SYNTHETIC_STATEMENT` carries an "Additional contacts" block containing every
  newly-covered format, and the Playwright suite asserts each raw value *and its
  identifying fragments* are absent from both the intercepted request body and
  the rendered wire pane, requires the placeholders those recognizers must mint
  (non-vacuity), and fails on any console error or warning during the flow. A
  Node test with a spied `fetch` cannot vouch for `u`-flag regex semantics under
  a different engine; this can. The suite also asserts the demo actually mounted,
  so an unrelated dev server squatting port 5173 fails with a named error instead
  of a bare "element(s) not found".
- **`RULES` order is now the documented tie-break** for overlapping spans of equal
  length at the same offset (`Array.prototype.sort` has been stable since ES2019).
  The label-gated `ROUTING`/`ACCOUNT` rules are listed before `SSN`, so
  `Account number: 100200300` stays an `ACCOUNT` even though those digits are also
  a structurally valid SSN.
- **The README now publishes a per-type coverage table** ("What it recognizes,
  exactly") stating what each recognizer accepts *and* what it does not, and the
  QUICKSTART, ARCHITECTURE TL;DR and `detect()` docstring point at it instead of
  implying the detector finds all PII.

- **`@edgeproc/avow` 0.1.0 → 0.1.1**, which splits a failed verification into two
  security-distinct subclasses of the published `SignatureInvalid` base:
  `SignerMismatch` (`avow.signer_mismatch`) when the receipt's embedded key is
  not the pinned signer — a *provenance* failure caught before any cryptography
  runs — and `SignatureBytesInvalid` (which keeps `avow.signature_invalid`) when
  the Ed25519 check rejects the bytes — a *tamper* failure. Purely additive: a
  caller catching `SignatureInvalid` still catches both. No public API change to
  this package; `verifySignature` is re-exported from `@edgeproc/avow` unchanged.
  The receipt tests now assert each cause by its own subclass, code, and message,
  so a wrong-signer rejection can no longer pass as a forged-signature rejection.

## [0.2.2] — 2026-07-25

Hardening release, and the first cut published with npm build **provenance** — a
signed, public transparency-log attestation linking the package to this repo and
its publish workflow. No public API breaks.

### Security

- **IBAN detection is no longer vulnerable to catastrophic backtracking.** The
  recognizer nested a bounded quantifier inside an unbounded one
  (`(?:\s?[A-Z0-9]{2,4})+`); a crafted near-IBAN froze the browser thread for
  ~0.5s (exponential in input length), defeating the "synchronous detection
  bounded on the browser thread" guarantee. Replaced with a linear,
  whitespace-tolerant pattern, guarded by a performance regression test.
- Dev-only `postcss` forced to the patched line (`>=8.5.18`) for
  GHSA-r28c-9q8g-f849 (source-map path traversal). It ships only in build
  tooling, never in `dist`; `pnpm audit` is clean including dev dependencies.

### Fixed

- **Silent failures now surface as typed, fail-closed errors.** `makeProvider`
  no longer returns the offline echo when a production API key is merely missing:
  the offline provider is opt-in via `allowOffline: true`, and a missing key
  throws the new `MissingApiKeyError`. `OpenRouterProvider` throws the new
  `MalformedProviderResponseError` instead of returning `""` when a reply lacks a
  string `choices[0].message.content`, and enforces the response byte cap BEFORE
  buffering a non-streamed body (a missing/untrusted `content-length` fails closed
  rather than buffering unbounded).
- **Governed egress now awaits the `onReceipt` sink**, so a send does not complete
  until the decision receipt has been durably handled (`onReceipt` may return a
  promise).
- Governed egress records a signed denial even when a plain-JavaScript caller
  supplies a malformed payload (`null`, a non-string text field, or a hostile
  getter), preserving the fail-closed error and receipt invariant.
- Redaction rejects inputs over 512 KiB of UTF-8 before detector, vault, or
  audit work, with an exported typed error and documented limit.
- OpenRouter requests have a 30-second default deadline and 1 MiB streamed
  response cap, with optional configuration overrides and typed fail-closed
  timeout/overflow errors.

### Changed

- All typed errors now share an exported `PrivacyCoreError` base, so a consumer
  can catch every boundary failure with one `instanceof`.
- `AuditEntry` is now a discriminated union on `kind` (`redact`/`approve` carry
  `placeholders`; `unsafe-bypass` carries `reason`), and its member types are
  exported. A minted `PendingRedaction`'s `placeholders` array is deep-frozen.
- The runnable demo now demonstrates both advertised guarantees directly: a
  "Sign egress receipts" toggle seals each allow/deny as a signed receipt, and a
  "Try to send without approval" action shows the fail-closed refusal. The
  Playwright e2e suite drives both.
- Remaining internal vocabulary removed from shipped and public-facing surfaces
  (source doc comments, tests, and `CLAUDE.md`).

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
