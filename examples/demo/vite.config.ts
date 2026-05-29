import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// Resolve the library's PUBLIC entry points from source so the demo runs without
// a prior `pnpm build` — and so it exercises exactly the published surface
// (the main barrel + the ./testing subpath), nothing internal.
const libRoot = fileURLToPath(new URL("../../src", import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@edgeproc\/privacy-core\/testing$/,
        replacement: `${libRoot}/testing.ts`,
      },
      {
        find: /^@edgeproc\/privacy-core$/,
        replacement: `${libRoot}/index.ts`,
      },
    ],
  },
});
