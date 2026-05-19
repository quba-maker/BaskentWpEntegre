// @ts-nocheck
import { defineConfig, devices } from "@playwright/test";

// =========================================================================
// QUBA AI OS — Playwright E2E & Chaos Testing Suite Configuration
// =========================================================================
// This configuration enables high-fidelity simulation of edge-case scenarios:
//   - Network disconnections (Offline Recovery)
//   - Multi-context orchestration (Cross-tab Failover)
//   - Network latency & failures (Polling Fallbacks)
// =========================================================================

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  // Automatically spin up the Next.js local server before executing the tests
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
