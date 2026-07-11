import {
  approve,
  detect,
  makeProvider,
  redactForEgress,
  rehydrate,
  type Span,
  Vault,
} from "@edgeproc/privacy-core";
import { SYNTHETIC_STATEMENT } from "@edgeproc/privacy-core/testing";
import "./styles.css";

interface Refs {
  readonly input: HTMLTextAreaElement;
  readonly setList: HTMLElement;
  readonly wire: HTMLElement;
  readonly answer: HTMLElement;
  readonly status: HTMLElement;
  readonly send: HTMLButtonElement;
}

const { provider, label } = makeProvider({
  apiKey: import.meta.env.VITE_OPENROUTER_API_KEY,
  model: import.meta.env.VITE_OPENROUTER_MODEL,
});

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c,
  );
}

/** Render the redaction set: each token, its raw value (escaped), and its type. */
function renderSet(refs: Refs, spans: readonly Span[], vault: Vault): void {
  const seen = new Set<string>();
  const rows: string[] = [];
  for (const s of spans) {
    const token = vault.tokenize(s.type, s.value); // stable; reuses existing token
    if (seen.has(token)) continue;
    seen.add(token);
    rows.push(
      `<li><code>${escapeHtml(token)}</code> ← <span class="raw">${escapeHtml(s.value)}</span> <em>${s.type}</em></li>`,
    );
  }
  refs.setList.innerHTML = rows.join("");
}

/** Live preview: show the redaction set + exact wire text BEFORE approval. */
async function refreshPreview(refs: Refs): Promise<void> {
  const vault = new Vault();
  const spans = detect(refs.input.value);
  const pending = await redactForEgress(refs.input.value, vault);
  refs.wire.textContent = pending.redactedText;
  renderSet(refs, spans, vault);
}

/** redact → review → APPROVE (the click) → send → rehydrate, fresh vault per run. */
async function runLoop(refs: Refs): Promise<void> {
  refs.send.disabled = true;
  refs.status.textContent = "Redacting on-device…";
  const vault = new Vault();
  const spans = detect(refs.input.value);
  const pending = await redactForEgress(refs.input.value, vault);
  refs.wire.textContent = pending.redactedText;
  renderSet(refs, spans, vault);
  // The click on "Approve & send" IS the explicit review action: the user has
  // seen the redaction set + exact wire payload above. Nothing is sendable
  // until this line runs — zero detections included.
  const payload = approve(pending);
  refs.status.textContent = `Approved. Sending redacted text to ${label}…`;
  try {
    const res = await provider.complete(payload);
    refs.answer.textContent = rehydrate(res.redactedText, vault);
    refs.status.textContent =
      "Done. The provider only saw placeholders; real values were restored locally.";
  } catch (err) {
    refs.answer.textContent = `Provider error: ${String(err)}`;
    refs.status.textContent = "Error (see answer pane).";
  } finally {
    refs.send.disabled = false;
  }
}

function queryRef<T extends HTMLElement>(root: HTMLElement, sel: string): T {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`missing element: ${sel}`);
  return el;
}

export function mountApp(root: HTMLElement): void {
  root.innerHTML = TEMPLATE.replace("{{provider}}", escapeHtml(label));
  const refs: Refs = {
    input: queryRef<HTMLTextAreaElement>(root, "#input"),
    setList: queryRef(root, "#set"),
    wire: queryRef(root, "#wire"),
    answer: queryRef(root, "#answer"),
    status: queryRef(root, "#status"),
    send: queryRef<HTMLButtonElement>(root, "#send"),
  };
  refs.input.value = SYNTHETIC_STATEMENT;
  refs.input.addEventListener("input", () => void refreshPreview(refs));
  refs.send.addEventListener("click", () => void runLoop(refs));
  void refreshPreview(refs);
}

const TEMPLATE = `
  <header>
    <h1>EdgeProc Privacy Core</h1>
    <p>Raw text stays on your device. Only redacted placeholders reach the provider,
       then the answer is rehydrated locally. Provider: <strong>{{provider}}</strong></p>
  </header>
  <main>
    <section>
      <h2>1 · Paste sensitive text</h2>
      <textarea id="input" spellcheck="false"></textarea>
    </section>
    <section>
      <h2>2 · Review &amp; approve — exactly what will leave the device</h2>
      <p class="hint">Redaction set:</p>
      <ul id="set" class="set"></ul>
      <p class="hint">Wire payload (sent verbatim — open your network tab to confirm):</p>
      <pre id="wire" class="wire"></pre>
      <button id="send">Approve &amp; send redacted text →</button>
      <p id="status" class="status"></p>
    </section>
    <section>
      <h2>3 · Locally-rehydrated answer (real values restored)</h2>
      <pre id="answer" class="answer"></pre>
    </section>
  </main>
`;
