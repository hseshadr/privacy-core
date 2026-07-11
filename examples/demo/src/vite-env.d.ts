/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Opt into the real OpenRouter path via the same-origin dev proxy ("1"). */
  readonly VITE_USE_OPENROUTER?: string;
  readonly VITE_OPENROUTER_MODEL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
