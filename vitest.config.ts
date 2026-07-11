import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/testing.ts"],
      // ENGINEERING-STANDARDS §2 TypeScript floor (edge-reco's numbers).
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 85,
      },
    },
  },
});
