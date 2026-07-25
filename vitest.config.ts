import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/testing.ts"],
      // Pinned to what this suite ACHIEVES, not to a lower floor. A floor
      // set below the achieved number silently absorbs a regression: coverage
      // could fall from 100% to 90% and the gate would stay green. At the real
      // value, any newly uncovered line is a failure rather than slack. And
      // `statements` is listed explicitly — omitting it left one of the four
      // metrics completely ungated.
      thresholds: {
        statements: 100,
        lines: 100,
        functions: 100,
        branches: 100,
      },
    },
  },
});
