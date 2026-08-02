# @edgeproc/privacy-core

Swaps the card numbers, emails and names in a prompt for labels like `[CARD_1]` before it leaves
your machine, then puts the real values back into the model's reply — locally, from a table the
model was never shown.

Real output of the 23-line example below, run against the published npm package:

```text
you write:   Grace Hopper, card 4242 4242 4242 4242, was charged $482.10 at Whole Foods on 01/14/2026.
goes out:    [NAME_1], card [CARD_1], was charged [AMOUNT_1] at [MERCHANT_1] on [DATE_1].
model says:  …referenced 5 redacted value(s): [NAME_1], [CARD_1], [AMOUNT_1], [MERCHANT_1], [DATE_1].
you read:    …referenced 5 redacted value(s): Grace Hopper, 4242 4242 4242 4242, $482.10, Whole Foods, 01/14/2026.
```

The last two lines are the point. The model wrote `[NAME_1]`; you read *Grace Hopper*. That swap
happened on your machine, after the network call was over.

Run it — no API key, no account. The 23 lines are in
[Use it in your own repo](#use-it-in-your-own-repo).

```bash
npm install @edgeproc/privacy-core && node example.mjs
```

## Use it in your own repo

You need [Node](https://nodejs.org) 22.13 or newer. Nothing else — no API key, no account, no
network call. Save this as `example.mjs` in any empty directory:

```js
import {
  approve, guardedProvider, NoLLMProvider, redactForEgress, rehydrate, Vault,
} from "@edgeproc/privacy-core";

const statement =
  "Grace Hopper, card 4242 4242 4242 4242, was charged $482.10 at Whole Foods on 01/14/2026.";

const vault = new Vault(); // holds your real values, in this process, on this machine
const audit = (e) => console.log("[audit]", e.kind, e.placeholders);

// 1. REDACT on-device. This is a proposal — no provider will accept it yet.
const pending = await redactForEgress(statement, vault, audit);
console.log("leaves your machine:", pending.redactedText);

// 2. APPROVE. You read the line above and say yes; only this mints a sendable payload.
const payload = approve(pending, audit);

// 3. SEND. NoLLMProvider is the built-in offline stand-in — no API key, no network.
const reply = await guardedProvider(new NoLLMProvider()).complete(payload);
console.log("model replied:", reply.redactedText);

// 4. REHYDRATE locally, bound to the vault the text was redacted with.
console.log("you read:", rehydrate(reply.redactedText, vault, payload.vaultRef));
```

Then:

```bash
npm install @edgeproc/privacy-core && node example.mjs
```

That prints, verbatim:

```text
[audit] redact [ '[NAME_1]', '[CARD_1]', '[AMOUNT_1]', '[MERCHANT_1]', '[DATE_1]' ]
leaves your machine: [NAME_1], card [CARD_1], was charged [AMOUNT_1] at [MERCHANT_1] on [DATE_1].
[audit] approve [ '[NAME_1]', '[CARD_1]', '[AMOUNT_1]', '[MERCHANT_1]', '[DATE_1]' ]
model replied: Summary (offline echo — no API key set):
I reviewed your statement. It referenced 5 redacted value(s): [NAME_1], [CARD_1], [AMOUNT_1], [MERCHANT_1], [DATE_1].
The first flagged value, [NAME_1], is the one to check.
(Set OPENROUTER_API_KEY + VITE_USE_OPENROUTER=1 to call a real model via the dev proxy.)
you read: Summary (offline echo — no API key set):
I reviewed your statement. It referenced 5 redacted value(s): Grace Hopper, 4242 4242 4242 4242, $482.10, Whole Foods, 01/14/2026.
The first flagged value, Grace Hopper, is the one to check.
(Set OPENROUTER_API_KEY + VITE_USE_OPENROUTER=1 to call a real model via the dev proxy.)
```

Step 2 is the one people skip. `redactForEgress` returns a *proposal*, not something you can send.
Nothing becomes sendable until `approve()` — and that holds even when the detector finds nothing,
because "found nothing" is not the same as "someone said yes". Provider adapters accept only the
type `approve()` mints, so passing one a raw string is
[a compile error](#the-part-that-makes-leaking-a-compile-error), not a code-review comment.

To swap the offline stand-in for a real model, see
[Calling a real model](#calling-a-real-model). For a signed record of every allow and deny, see
[Receipts](#receipts-a-record-of-what-was-allowed-and-what-was-blocked).

## Why this exists

You get a letter from a doctor, or a bank statement with a charge you don't
recognize, and you want an AI chatbot to explain it. So you paste the whole
thing in — your name, your phone number, your card number, all of it — because
that's the only way to get the answer.

This library is the other way around. It finds the private bits **on your own
device**, swaps each one for a label like `[CARD_1]`, and sends only the
labeled version to the model. When the answer comes back, it puts your real
values back in, locally. The model helps you. The model never sees you.

"The private bits" means a specific, listed set of things — cards, emails,
phone numbers, SSNs, IBANs, amounts, dates. [What it recognizes,
exactly](#what-it-recognizes-exactly) is the full list, and the review step is
what covers everything outside it.

Three words used throughout, defined once:

- **redact** — replace a private value with a label.
- **rehydrate** — put the real value back when the answer returns.
- **egress** — anything leaving your device for the network.

## See it in a browser

Clone this repo and run the demo, which does the same loop with a live preview
of exactly what will be sent:

```bash
pnpm install && pnpm demo   # then open http://localhost:5173
```

![Paste a statement, preview exactly what leaves, send only labels, read a rehydrated answer.](docs/demo.png)

Open your browser's network tab and watch the request. Only labels go out.
Nothing is sent until you click **Approve & send** — you approve the exact
outgoing text, not a promise about it.

To prove it without a browser window, `pnpm test:e2e` drives the same loop in
real Chromium, intercepts the outbound request, and fails if any real value
appears in it.

## What it recognizes, exactly

Detection is a fixed ruleset, so the honest version of "it finds the private
bits" is a list. This is the whole of it. If a format is not in the left column,
it is not detected, and the review step is what catches it.

| Type | Recognized | Not recognized |
| --- | --- | --- |
| `EMAIL` | any script, on both sides of the `@` — `ada@example.com`, `josé.álvarez@example.com`, `kontakt@münchen-bank.example` | a domain with no dot (`user@localhost`) |
| `SSN` | `123-45-6789`, `123 45 6789`, and unseparated `123456789` — all gated on the SSA issuance rules (area not `000`/`666`/`9xx`, group not `00`, serial not `0000`) | a 9-digit run that could never have been issued — which is how routing numbers stay routing numbers |
| `PHONE` | US/NANP with `-`, `.` or space separators, optional parentheses, optional `+1`: `(415) 555-0132`, `415-555-0132`, `212.555.0187`, `+1 646 555 0143` | an unformatted `4155550132`, a 7-digit local number, non-NANP international |
| `CARD` | 13–19 digits, spaced or hyphenated, **Luhn-valid** | runs that fail Luhn (deliberately — they are not card numbers) |
| `IBAN` | grouped or compact, **mod-97-valid** | other bank identifiers (SWIFT/BIC, UK sort codes) |
| `ROUTING` | `Routing number: 021000021` — the English label is required | a bare routing number, which is not distinguishable from any other 9-digit run |
| `ACCOUNT` | `Account number: 000123456789` — the English label is required | a bare account number |
| `AMOUNT` | `$1,482.10` | other currencies |
| `DATE` | `01/14/2026` | every other date format |
| `NAME` | three demo names (`Ada Lovelace`, `Grace Hopper`, `Alan Turing`) | **every other name** — general name detection is not shipped |
| `MERCHANT` | five demo merchants (Whole Foods, Starbucks, Amazon, Walmart, Costco) | every other merchant |

The **Recognized** column is proved at the wire, not at the detector:
[`test/detector-completeness.test.ts`](test/detector-completeness.test.ts) drives
each format through the real send path and fails if the value — or an
identifying fragment of it — reaches the network. The limits that are easiest to
widen by accident (`4155550132`, phone-shaped reference numbers, 9-digit runs
that are not issuable SSNs) are pinned as tests too, so quietly broadening a rule
turns them red.

## What this does not protect you from

Read this before you trust it with anything that matters. Over-claiming privacy
is worse than claiming none.

- **It only hides what it recognizes**, and that set is exactly the table above —
  patterns plus checksums plus two small dictionaries. It will miss an oddly
  formatted account number, an unusual name, a kind of private data nobody wrote
  a rule for. The built-in name list is three demo names; general name detection
  is not shipped. **That is why you review the outgoing text before it goes.** A
  human catching a miss is the actual guarantee; the tool's job is to make the
  text you're about to send visible and approvable, not to promise it caught
  everything.

- **Redaction input is bounded.** `redactForEgress` accepts at most 512 KiB of
  UTF-8 text (`MAX_REDACTION_INPUT_BYTES`). Larger input fails closed with
  `InputTooLargeError` before detection, vault writes, or audit callbacks. Split
  a large document into reviewed sections rather than raising this limit in an
  untrusted browser path.

- **Hiding names is not the same as being anonymous.** Even with every name and
  number stripped, the shape of the text can identify you: "$482.10, the word
  *insurance*, early January" can point at one person with no identifier left in
  it. This reduces direct leakage of identifiers. It does not make data
  anonymous, and it will not stop someone deliberately trying to re-identify you.

- **The vault is in memory and clears on reload.** Your real values are held in
  ordinary process/tab memory for the length of the session, by design in this
  version. An encrypted stored vault is on the roadmap, not shipped.

- **Browser key custody is same-origin, not hardware-backed.** Signing keys held
  in a browser are protected by the browser's same-origin rules and nothing
  stronger. Anything that can run code on your origin — a malicious extension, a
  cross-site scripting bug, a compromised dependency — can reach them. There is
  no secure element or OS keychain involved.

- **The OpenRouter adapter has bounded network resources.** Each request has a
  30-second end-to-end deadline and accepts at most a 1 MiB UTF-8 response by
  default. Override `timeoutMs` or `maxResponseBytes` in `OpenRouterConfig` only
  when your host has a deliberate, tested budget; timeout and overflow failures
  are typed and fail closed.

If any of those limits are unacceptable for what you're doing, this is the wrong
tool. Say so out loud rather than working around it.

## Receipts: a record of what was allowed and what was blocked

Receipts are **opt-in**. Hand `guardedProvider` a governance context — a
provider name, your signing key, and an `onReceipt` callback — and from then on
every decision it makes is signed into a **receipt**: a small record saying
"text with this fingerprint was allowed (or refused) to go to this provider",
signed with your key. Refusals are recorded too, so a blocked send can't just
vanish. A receipt never contains the text itself, only a SHA-256 hash of it.

Omit that argument and you get exactly the same redaction and the same
fail-closed guard — just no receipt. Turn receipts on when you need to prove
afterwards what left the device; leave them off when you don't.

Receipts are tamper-evident records, not replay-prevention tokens. The signed
Avow envelope is deterministic, so two identical decisions produce identical
receipts; a downstream audit store must track receipt occurrences if it needs
to count sends rather than only verify their content.

Signing and verifying live in `@edgeproc/avow`, so add it alongside:
`npm install @edgeproc/avow`.

```js
import { generateSeedHex, publicKeyHex, verifySignature } from "@edgeproc/avow";
import {
  approve,
  guardedProvider,
  NoLLMProvider,
  redactForEgress,
  Vault,
} from "@edgeproc/privacy-core";

const seedHex = generateSeedHex(); // your signing key, generated on this device
const receipts = [];

const provider = guardedProvider(new NoLLMProvider(), {
  provider: "offline-echo",
  seedHex,
  onReceipt: (r) => receipts.push(r),
});

const vault = new Vault();
const pending = await redactForEgress("Card on file: 4242 4242 4242 4242", vault);
await provider.complete(approve(pending, () => {}));

// A payload the guard never approved is refused — and the refusal is recorded too.
// (In TypeScript this call wouldn't even compile; plain JS shows the runtime half.)
await provider
  .complete({ redactedText: "raw card 4242 4242 4242 4242", vaultRef: { id: "x" } })
  .catch((err) => console.log("refused:", err.constructor.name));

for (const r of receipts) console.log(r.payload);

// Anyone holding your public key can check the receipts were not edited later.
await verifySignature(receipts[0], await publicKeyHex(seedHex));
console.log("\nsignature check: passed");
```

```text
refused: UnapprovedPayloadError
{
  action: 'llm.egress',
  provider: 'offline-echo',
  args_digest: 'sha256:091a3728dd5622843e14ffb925abcec1bd1cb5ad6461154ab0893b68f63d50b1',
  decision: 'allow',
  detector_version: '1'
}
{
  action: 'llm.egress',
  provider: 'offline-echo',
  args_digest: 'sha256:6726c6222d515ab998abb62680724ca993157f40a9021ab0643d0e967f4b417b',
  decision: 'deny',
  detector_version: '1'
}

signature check: passed
```

**What a receipt is worth, precisely.** A signature proves a record has not been
altered *since it was signed*. It says nothing about whether the machine that
signed it was already compromised at the time. If an attacker controls the host,
they can make it sign a true-looking record of a decision you never wanted.
Receipts give you tamper-evidence after the fact, not a trustworthy host.

---

# For developers

## The part that makes leaking a compile error

The rule "don't send raw text to the model" isn't a convention here, and it isn't
a runtime check you could forget to call. Provider adapters accept **only** a
branded `RedactedPayload` type, and the only thing that mints one is the
redaction pipeline (`redactForEgress` → `approve`). A plain `string` is not
assignable to it, so this:

```ts
import { NoLLMProvider } from "@edgeproc/privacy-core";

const provider = new NoLLMProvider();
await provider.complete("my card is 4242 4242 4242 4242");
```

fails before it ever runs:

```text
oops.ts(4,25): error TS2345: Argument of type 'string' is not assignable to parameter of type 'RedactedPayload'.
  Type 'string' is not assignable to type 'Branded<"RedactedPayload">'.
```

TypeScript's brand disappears at runtime, so the same guarantee is enforced a
second way: every approved payload is registered by object identity, and
`assertApproved()` rejects a hand-built or spread-cloned look-alike before any
network call — that's the `UnapprovedPayloadError` in the receipts example
above. `pnpm build` re-proves the compile-time half on every build.

## Architecture — maps 1:1 to `src/`

```text
src/
├── index.ts            # public API barrel — the production surface, nothing else
├── types.ts            # shared domain types (EntityType, Span, AuditEntry, …)
├── egress.ts           # the boundary: branded RedactedPayload + LlmProvider + unsafeBypass
├── egressReceipt.ts    # signs allow/deny decisions into receipts when governed (hash only)
├── errors.ts           # typed fail-closed errors
├── redact.ts           # redactForEgress — the ONLY legitimate payload constructor
├── rehydrate.ts        # local restore of real values after the reply
├── vault.ts            # Vault — reversible token<->value map (in-memory)
├── detect/
│   ├── detector.ts     # detect() — merges patterns + dictionaries, drops overlaps
│   ├── patterns.ts     # the deterministic ruleset (generic + finance packs)
│   └── checksums.ts    # Luhn (cards) + IBAN mod-97
├── providers/
│   ├── factory.ts      # makeProvider — picks OpenRouter or the offline echo
│   ├── nollm.ts        # NoLLMProvider — offline echo, runs with no API key
│   └── openrouter.ts   # OpenRouterProvider — OpenAI-compatible chat/completions
└── testing.ts          # SYNTHETIC_STATEMENT fixture — via the ./testing subpath,
                        #   NEVER from the main barrel
```

Detection is deliberately deterministic — same input, same spans, no model, no
download, testable offline. The contextual name-detection tier that would widen
recall is a separate, optional adapter and is not shipped (see
[Roadmap](#roadmap)). See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the
flow in detail.

## Public API

Everything `src/index.ts` exports, and nothing more:

| Export | Kind | Role |
|---|---|---|
| `detect` | fn | deterministic PII span detection |
| `approve` | fn | explicit review step → mints the sendable payload (audit sink required) |
| `assertApproved` | fn | runtime half of the guard — rejects unminted payloads |
| `guardedProvider` | fn | wrap a provider so the runtime guard runs at one chokepoint — plus receipts if given a governance context |
| `LlmProvider` | interface | provider contract — accepts only `RedactedPayload` |
| `PendingRedaction` | type | a redaction proposal awaiting explicit review — not yet sendable |
| `RedactedPayload` | type | the branded egress type |
| `unsafeBypass` | fn | the explicit, audited escape hatch |
| `buildEgressSubject` | fn | build the signed subject (hash of redacted text, decision, provider) |
| `contentHash` | fn | the canonical hash a verifier recomputes `args_digest` with |
| `DETECTOR_VERSION` | const | version tag for the detector ruleset, recorded in each receipt |
| `EgressDecision` | type | the guard's verdict on one egress attempt — allow or deny |
| `EgressGovernance` | interface | how a guarded provider seals its decisions (signer seed + receipt sink) |
| `EgressSubject` | type | the signed, hash-only record of one egress decision |
| `EgressSubjectInput` | interface | what the caller supplies to build an `EgressSubject` |
| `sealEgressReceipt` | fn | sign one egress decision into a receipt |
| `makeProvider` | fn | config-driven provider selector |
| `ProviderConfig` | interface | host-supplied config (API key, model, endpoint, timeout and response budget) for `makeProvider` |
| `SelectedProvider` | interface | the provider `makeProvider` picked, plus a label for the UI |
| `NoLLMProvider` | class | offline echo provider |
| `OpenRouterConfig` | interface | config for `OpenRouterProvider` (API key, model, endpoint, timeout and response budget) |
| `OpenRouterProvider` | class | OpenAI-compatible provider |
| `DEFAULT_OPENROUTER_TIMEOUT_MS` | const | default OpenRouter deadline (30 seconds) |
| `DEFAULT_OPENROUTER_MAX_RESPONSE_BYTES` | const | default OpenRouter response cap (1 MiB UTF-8) |
| `MAX_REDACTION_INPUT_BYTES` | const | UTF-8 input budget enforced before detection (512 KiB) |
| `redactForEgress` | fn | detect → vault-write → brand → a `PendingRedaction` proposal |
| `rehydrate` | fn | restore real values locally from placeholders |
| `AuditEntry` | type | one append-only audit record — a discriminated union of the three below |
| `RedactAuditEntry` | interface | audit record for a redact step |
| `ApproveAuditEntry` | interface | audit record for an approve step |
| `UnsafeBypassAuditEntry` | interface | audit record for an explicit unsafe-bypass |
| `AuditSink` | type | the audit callback signature callers supply to `approve`/`unsafeBypass` |
| `EntityType` | type | the PII categories the detector recognizes (CARD, SSN, EMAIL, ...) |
| `RedactedResponse` | interface | a provider's reply, still in placeholder form until rehydrated |
| `Span` | interface | one detected PII span (type, value, start, end) |
| `VaultRef` | interface | opaque handle to a vault's token → value mappings |
| `Vault` | class | reversible token↔value map |

Typed fail-closed errors are exported too, all extending the `PrivacyCoreError`
base class: `ForgedPayloadError`, `InputTooLargeError`, `MalformedProviderResponseError`,
`MissingApiKeyError`, `PlaceholderCollisionError`, `ProviderResponseTooLargeError`,
`ProviderTimeoutError`, `ResidualValueError`, `UnapprovedPayloadError`,
`UnresolvedPlaceholderError`, `VaultMismatchError`.

The brand factory (`mintPendingRedaction`) and the `SYNTHETIC_STATEMENT` fixture
are intentionally **not** on the front door — a payload can be earned, not
forged, and a fixture is never shipped by accident.

## Calling a real model

The library is environment-agnostic: you pass your own key in, and it is never
read from the environment for you. The bundled demo keeps `OPENROUTER_API_KEY`
server-side — a same-origin dev proxy injects it, so it never reaches the browser
bundle. Copy `.env.example` → `examples/demo/.env`, set the key, add
`VITE_USE_OPENROUTER=1`, and re-run `pnpm demo`.

## Working on this repo

```bash
pnpm install
pnpm gate   # lint → typecheck → unit tests with coverage → browser e2e → build
```

`pnpm gate` is exactly what CI runs. See
[docs/QUICKSTART.md](docs/QUICKSTART.md) and
[CONTRIBUTING.md](CONTRIBUTING.md).

## Roadmap

Labeled so no one mistakes it for current scope:

- **Encrypted stored vault** (AES-GCM + passphrase KDF over IndexedDB). Today's
  vault is in-memory and clears on reload.
- **Contextual name/place detection** to widen recall past the fixed ruleset;
  would be an optional, off-by-default adapter.
- **Durable audit and receipt storage** — the sinks are wired today; persistence
  is not.
- **More domain rule packs** (medical, legal, HR, identity) beyond the generic +
  finance set, and generalization modes (amount bucketing, date coarsening) that
  would start to address the anonymity limit above.

## License

MIT. Recognizer patterns are ported from Microsoft Presidio (MIT); the
redact/rehydrate vault design follows LLM Guard's `Anonymize`/`Vault` (MIT),
reimplemented here in TypeScript.
