import { defineConfig, devices } from "@playwright/test";

/**
 * Headless-chromium e2e gate for the redact → send → rehydrate loop.
 *
 * The demo server is booted with a DUMMY OpenRouter key so the app selects the
 * OpenRouter provider path; the test intercepts the outbound request with
 * `page.route`, so nothing actually leaves the machine. The key only selects a
 * code path — it is never a real secret.
 */
export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: "list",
  use: {
    baseURL: "http://localhost:5173",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "pnpm --filter @edgeproc/privacy-core-demo dev",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    env: {
      VITE_OPENROUTER_API_KEY: "sk-e2e-dummy",
      VITE_OPENROUTER_MODEL: "openai/gpt-4o-mini",
    },
  },
});
