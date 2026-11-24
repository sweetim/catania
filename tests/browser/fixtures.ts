import { expect, test as base, type BrowserContext, type Page, type TestInfo } from "@playwright/test";

const PROFILE_SEED = {
  profiles: JSON.stringify([{ id: "profile-1", name: "Alex", games: 0, wins: 0, totalPoints: 0, lastRecordedGameId: null }]),
  activeId: "profile-1",
};

/** Captures a diagnostic screenshot only when CAPTURE_SCREENSHOTS is enabled. */
export async function captureScreenshot(
  page: Page,
  testInfo: TestInfo,
  name: string,
  options: { fullPage?: boolean; attach?: boolean } = {},
) {
  if (!process.env.CAPTURE_SCREENSHOTS) return;
  const filename = name.endsWith(".png") ? name : `${name}.png`;
  const path = testInfo.outputPath(filename);
  await page.screenshot({ path, fullPage: options.fullPage ?? true });
  if (options.attach) {
    await testInfo.attach(name.replace(/\.png$/, ""), { path, contentType: "image/png" });
  }
}

/** Gives a context a selected player profile so the app skips the profile-selection screen. */
export function seedProfile(context: BrowserContext) {
  return context.addInitScript(seed => {
    localStorage.setItem("catania.profiles", seed.profiles);
    localStorage.setItem("catania.profile.active", seed.activeId);
  }, PROFILE_SEED);
}

export const test = base.extend<{ context: BrowserContext }>({
  context: async ({ context }, use) => {
    await seedProfile(context);
    await use(context);
  },
});

export { expect };
