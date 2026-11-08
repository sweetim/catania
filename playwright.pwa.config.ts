import { defineConfig } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_DIST_PORT ?? 4180);

export default defineConfig({
  testDir: "./tests/browser",
  testMatch: ["pwa.spec.ts"],
  timeout: 90_000,
  expect: { timeout: 5_000 },
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    browserName: "chromium",
    locale: "en-US",
    actionTimeout: 10_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `bun run build && PORT=${port} bun run scripts/serve-dist.ts`,
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
