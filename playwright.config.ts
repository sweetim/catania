import { defineConfig } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_PORT ?? 4173);
const signalingPort = Number(process.env.PLAYWRIGHT_SIGNALING_PORT ?? 4176);

export default defineConfig({
  testDir: "./tests/browser",
  testMatch: ["catania.spec.ts", "multiplayer.spec.ts", "localization.spec.ts", "profile.spec.ts"],
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 16,
  timeout: 90_000,
  expect: { timeout: 5_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    browserName: "chromium",
    locale: "en-US",
    actionTimeout: 10_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: [
    {
      command: `PORT=${port} bun run src/index.ts`,
      wait: { stdout: new RegExp(`Server running at http://localhost:${port}/`) },
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: "bun run tests/helpers/peer-server.ts",
      wait: { stdout: new RegExp(`Test PeerServer listening on http://127.0.0.1:${signalingPort}`) },
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
