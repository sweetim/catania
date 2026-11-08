import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  testMatch: ["robber-repro.spec.ts"],
  timeout: 240_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4174",
    browserName: "chromium",
    viewport: { width: 1440, height: 1000 },
    actionTimeout: 10_000,
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "PORT=4174 bun run src/index.ts",
    url: "http://127.0.0.1:4174/",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
