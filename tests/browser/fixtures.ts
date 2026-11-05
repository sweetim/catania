import { expect, test as base, type BrowserContext } from "@playwright/test";

const PROFILE_SEED = {
  profiles: JSON.stringify([{ id: "profile-1", name: "Alex", games: 0, wins: 0, totalPoints: 0, lastRecordedGameId: null }]),
  activeId: "profile-1",
};

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
