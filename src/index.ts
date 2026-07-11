/**
 * `@edgeproc/privacy-core` — a browser-side privacy boundary for LLM calls.
 *
 * Raw private text stays on-device; only policy-approved, redacted text can
 * reach a provider; the model's reply is rehydrated locally. The load-bearing
 * idea is the type-enforced Egress Guard: provider adapters accept ONLY a
 * branded {@link RedactedPayload}, so handing raw text to a provider is a
 * compile error.
 *
 * This barrel is the PRODUCTION surface. Test fixtures live behind the
 * `@edgeproc/privacy-core/testing` subpath, never here.
 */

// Detection spine.
export { detect } from "./detect/detector.js";
// The egress boundary.
export {
  approve,
  assertApproved,
  type LlmProvider,
  type PendingRedaction,
  type RedactedPayload,
  unsafeBypass,
} from "./egress.js";
// Typed fail-closed errors.
export {
  ForgedPayloadError,
  PlaceholderCollisionError,
  UnapprovedPayloadError,
  UnresolvedPlaceholderError,
  VaultMismatchError,
} from "./errors.js";
export {
  makeProvider,
  type ProviderConfig,
  type SelectedProvider,
} from "./providers/factory.js";
// Providers.
export { NoLLMProvider } from "./providers/nollm.js";
export {
  type OpenRouterConfig,
  OpenRouterProvider,
} from "./providers/openrouter.js";
// The reversible loop.
export { redactForEgress } from "./redact.js";
export { rehydrate } from "./rehydrate.js";
// Public domain types.
export type {
  AuditEntry,
  AuditSink,
  EntityType,
  RedactedResponse,
  Span,
  VaultRef,
} from "./types.js";
export { Vault } from "./vault.js";
