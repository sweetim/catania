import { expect, test, type Locator, type Page } from "@playwright/test";
import { createBoard, edgeTiles, seededRandom } from "../../src/game/board";
import { resourceName } from "../../src/i18n";
import { BOARD_THEMES, getTerrainName } from "../../src/themes";
import type { PlayerProfile, ProfileGame } from "../../src/profile";

const history: ProfileGame[] = [
  { gameId: "game-seafarers", mapCode: "8765432A", variant: "seafarers", won: false, points: 7, turnCount: 34, completedAt: "2026-11-06T00:00:00.000Z" },
  { gameId: "game-original", mapCode: "ABCDEFGH", variant: "original", won: true, points: 10, turnCount: 28, completedAt: "2026-11-05T00:00:00.000Z" },
];

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(history => {
    localStorage.setItem("catania.profiles", JSON.stringify([
      { id: "history-profile", name: "Alex", games: 2, wins: 1, totalPoints: 17, lastRecordedGameId: history[0]!.gameId, history },
    ]));
    localStorage.setItem("catania.profile.active", "history-profile");
  }, history);
  await page.reload();
});

async function openProfiles(page: Page) {
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("button", { name: "Profile", exact: true }).click();
}

async function openHistory(page: Page) {
  await openProfiles(page);
  await page.locator("summary").filter({ hasText: "Game history" }).click();
  return page.getByRole("list", { name: "Game history for Alex", exact: true });
}

async function addOtherProfile(page: Page) {
  await page.evaluate(() => {
    const profiles: PlayerProfile[] = JSON.parse(localStorage.getItem("catania.profiles")!);
    profiles.push({ ...profiles[0]!, id: "other-profile", name: "Sam" });
    localStorage.setItem("catania.profiles", JSON.stringify(profiles));
  });
  await page.reload();
}

async function expectMap(context: Locator, entry: ProfileGame) {
  const board = createBoard(seededRandom(entry.mapCode), entry.variant);
  const expected = board.tiles.map(tile => ({
    terrain: getTerrainName(BOARD_THEMES.illustrated, tile.terrain, "en").toUpperCase(),
    number: tile.number === null ? "" : String(tile.number),
    points: tile.vertexIds.map(id => {
      const vertex = board.vertices.find(vertex => vertex.id === id)!;
      return `${vertex.x},${vertex.y}`;
    }).join(" "),
  }));
  await expect.poll(() => context.locator(".terrain-hex").evaluateAll(elements => elements.map(element => ({
    terrain: element.querySelector(":scope > text")!.textContent,
    number: element.querySelector(".number-token > text")?.textContent ?? "",
    points: element.querySelector("polygon")!.getAttribute("points"),
  })))).toEqual(expected);
  const ports = board.ports.map(port => {
    const edge = board.edges.find(edge => edge.id === port.edgeId)!;
    const [start, end] = edge.vertexIds.map(id => board.vertices.find(vertex => vertex.id === id)!);
    const x = (start!.x + end!.x) / 2;
    const y = (start!.y + end!.y) / 2;
    const land = edgeTiles(board, edge).find(tile => tile.terrain !== "sea")!;
    const distance = Math.hypot(x, y);
    const coastDistance = Math.hypot(x - land.x, y - land.y);
    const directionX = board.variant === "seafarers" ? (x - land.x) / coastDistance : x / distance;
    const directionY = board.variant === "seafarers" ? (y - land.y) / coastDistance : y / distance;
    return {
      label: port.resource === "any" ? "Any resource harbor, trade 3:1" : `${resourceName("en", port.resource).toLowerCase()} harbor, trade 2:1`,
      coordinates: [x, y, x + directionX * 51, y + directionY * 51].map(value => expect.closeTo(value, 6)),
    };
  });
  await expect.poll(() => context.locator('g[role="img"][aria-label*="harbor, trade"]').evaluateAll(elements => elements.map(element => ({
    label: element.getAttribute("aria-label"),
    coordinates: element.querySelector("path")!.getAttribute("d")!.replace(/[ML]/g, " ").trim().split(/\s+/).map(Number),
  })))).toEqual(ports);
}

async function expectNoOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)))
    .toBeLessThanOrEqual(page.viewportSize()!.width);
}

test("profile creation persists and starts a game without randomUUID", async ({ page, isMobile }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(crypto, "randomUUID", { configurable: true, value: undefined });
  });
  await page.evaluate(() => {
    localStorage.removeItem("catania.profiles");
    localStorage.removeItem("catania.profile.active");
  });
  await page.reload();
  expect(await page.evaluate(() => typeof crypto.randomUUID)).toBe("undefined");
  await page.getByLabel("Profile name", { exact: true }).fill("Nora");
  await page.getByRole("button", { name: "Create and continue", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Player 1 name", exact: true })).toHaveValue("Nora");
  const saved = await page.evaluate(() => ({
    profiles: JSON.parse(localStorage.getItem("catania.profiles")!),
    activeId: localStorage.getItem("catania.profile.active"),
  }));
  expect(saved.profiles).toMatchObject([{ id: saved.activeId, name: "Nora", games: 0, wins: 0, totalPoints: 0 }]);
  expect(saved.activeId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Player 1 name", exact: true })).toHaveValue("Nora");
  await page.getByRole("button", { name: "Let's settle in", exact: true }).click();
  if (isMobile) await page.getByRole("navigation", { name: "Game views", exact: true }).getByRole("button", { name: "board", exact: true }).click();
  await expect(page.getByRole("region", { name: "Game board", exact: true })).toBeVisible();
  await expectNoOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("profile-without-random-uuid.png"), fullPage: true });
  expect(errors).toEqual([]);
});

test("legacy profiles migrate without randomUUID", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(crypto, "randomUUID", { configurable: true, value: undefined });
  });
  await page.evaluate(() => {
    localStorage.removeItem("catania.profiles");
    localStorage.removeItem("catania.profile.active");
    localStorage.setItem("catania.profile", JSON.stringify({ games: 3, wins: 1, totalPoints: 27, lastRecordedGameId: "game-3" }));
  });
  await page.reload();
  await page.getByRole("button", { name: "Continue as Player", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Player 1 name", exact: true })).toHaveValue("Player");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Player 1 name", exact: true })).toHaveValue("Player");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("catania.profiles")!))).toMatchObject([
    { name: "Player", games: 3, wins: 1, totalPoints: 27 },
  ]);
  expect(errors).toEqual([]);
});

test("menu dropdown items render leading icons", async ({ page }, testInfo) => {
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  const mainMenu = page.getByRole("group", { name: "Main menu", exact: true });
  const mainMenuItems = mainMenu.getByRole("button");
  await expect(mainMenuItems).toHaveCount(2);
  for (const item of await mainMenuItems.all()) {
    await expect(item.locator(":scope > svg")).toHaveCount(1);
  }
  await page.screenshot({ path: testInfo.outputPath("menu-icons-home.png") });
  await page.getByRole("button", { name: "Profile", exact: true }).click();
  await page.getByRole("button", { name: "Continue as Alex", exact: true }).click();
  await page.getByRole("button", { name: "Let's settle in", exact: true }).click();
  await page.getByRole("button", { name: "Game", exact: true }).click();
  const gameMenu = page.getByRole("group", { name: "Game menu", exact: true });
  const gameMenuItems = gameMenu.getByRole("button");
  await expect(gameMenuItems.first()).toBeVisible();
  expect(await gameMenuItems.count()).toBeGreaterThanOrEqual(4);
  for (const item of await gameMenuItems.all()) {
    await expect(item.locator(":scope > svg")).toHaveCount(1);
  }
  await page.screenshot({ path: testInfo.outputPath("menu-icons-game.png") });
});

test("profile history survives reload and shows completed game results and stats", async ({ page }, testInfo) => {
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("button", { name: "Profile", exact: true }).click();
  const entries = page.getByRole("list", { name: "Game history for Alex", exact: true });
  await expect(entries).toBeHidden();
  await page.locator("summary").filter({ hasText: "Game history" }).click();
  await expect(entries.getByRole("listitem")).toHaveCount(2);
  const newest = entries.getByRole("listitem").first();
  await expect(newest.getByRole("img", { name: "Lost", exact: true })).toBeVisible();
  await expect(newest).toContainText("Seafarers");
  await expect(newest.getByRole("img", { name: "34 turns", exact: true })).toBeVisible();
  await expect(newest).toContainText("VP");
  await expect(newest).toContainText("7");
  await expect(newest.locator("time")).toHaveAttribute("datetime", history[0]!.completedAt);
  const oldest = entries.getByRole("listitem").last();
  await expect(oldest.getByRole("img", { name: "Won", exact: true })).toBeVisible();
  await expect(oldest).toContainText("Original");
  await expect(oldest).toContainText("10");
  await page.setViewportSize({ width: 320, height: 568 });
  await expectNoOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("profile-game-history-narrow.png"), fullPage: true });
  await page.getByRole("button", { name: "Continue as Alex", exact: true }).click();
  await page.reload();
  await openHistory(page);
  await expect(entries.getByRole("listitem")).toHaveCount(2);
});

for (const entry of history) {
  test(`profile history replays the exact ${entry.variant} map without starting a game`, async ({ page, isMobile }) => {
    const entries = await openHistory(page);
    await entries.getByRole("listitem").nth(history.indexOf(entry)).getByRole("button", { name: "Replay map", exact: true }).click();
    const preview = page.getByRole("region", { name: "Island preview", exact: true });
    await expect(preview.getByRole("textbox", { name: "Map code", exact: true })).toHaveValue(entry.mapCode);
    await expectMap(preview, entry);
    if (isMobile) await page.getByRole("button", { name: "Setup", exact: true }).click();
    await expect(page.getByRole("combobox", { name: "Game version", exact: true })).toHaveValue(entry.variant);
    await expect(page.getByRole("button", { name: "Let's settle in", exact: true })).toBeVisible();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("catania.profiles")!)[0].games)).toBe(2);
    await page.getByRole("button", { name: "Let's settle in", exact: true }).click();
    if (isMobile) await page.getByRole("navigation", { name: "Game views", exact: true }).getByRole("button", { name: "board", exact: true }).click();
    await expectMap(page.getByRole("region", { name: "Game board", exact: true }), entry);
  });
}

for (const humanCount of ["1", "3"]) {
  test(`profile management is unavailable during games with ${humanCount} human players`, async ({ page }) => {
    await page.clock.install({ time: new Date("2030-01-01T00:00:00Z") });
    await page.clock.pauseAt(new Date("2030-01-01T00:00:01Z"));
    await page.getByRole("combobox", { name: "Human players", exact: true }).selectOption(humanCount);
    await page.getByRole("button", { name: "Let's settle in", exact: true }).click();
    const gameButton = page.getByRole("button", { name: "Game", exact: true });
    await gameButton.click();
    await expect(page.getByRole("group", { name: "Game menu", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Profile", exact: true, includeHidden: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Delete /, includeHidden: true })).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem("catania.profile.active"))).toBe("history-profile");
    await page.getByRole("button", { name: "End game", exact: true }).click();
    await page.getByRole("dialog", { name: "Leave this island?", exact: true }).getByRole("button", { name: "End game", exact: true }).click();
    await openHistory(page);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("catania.profiles")!)[0].history)).toEqual(history);
  });
}

test("deleting an inactive profile requires confirmation and preserves the active profile", async ({ page }, testInfo) => {
  await addOtherProfile(page);
  await openProfiles(page);
  const deleteButton = page.getByRole("button", { name: "Delete Sam", exact: true });
  await deleteButton.click();
  const confirmation = page.getByRole("dialog", { name: "Delete profile?", exact: true });
  await expect(confirmation).toContainText("This permanently deletes Sam");
  await expect(confirmation).toContainText("This cannot be undone.");
  await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(deleteButton).toBeFocused();
  await deleteButton.press("Enter");
  await page.keyboard.press("Escape");
  await expect(deleteButton).toBeFocused();
  await deleteButton.press("Enter");
  await page.setViewportSize({ width: 320, height: 568 });
  await expectNoOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("delete-profile-confirmation-narrow.png"), fullPage: true });
  await confirmation.getByRole("button", { name: "Delete profile", exact: true }).click();
  await expect(page.getByRole("button", { name: "Continue as Sam", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("catania.profile.active"))).toBe("history-profile");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("catania.profiles")!))).toMatchObject([
    { id: "history-profile", name: "Alex", games: 2, wins: 1, totalPoints: 17, history },
  ]);
  await page.reload();
  await openProfiles(page);
  await expect(deleteButton).toHaveCount(0);
});

test("deleting the active profile requires choosing a remaining profile", async ({ page }) => {
  await addOtherProfile(page);
  await openProfiles(page);
  await page.getByRole("button", { name: "Delete Alex", exact: true }).click();
  await page.getByRole("dialog", { name: "Delete profile?", exact: true }).getByRole("button", { name: "Delete profile", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your player profile", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue as Alex", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("catania.profile.active"))).toBeNull();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Your player profile", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Continue as Sam", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Player 1 name", exact: true })).toHaveValue("Sam");
  expect(await page.evaluate(() => localStorage.getItem("catania.profile.active"))).toBe("other-profile");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("catania.profiles")!)[0].history)).toEqual(history);
});

test("deleting the last profile allows creating a fresh profile", async ({ page }) => {
  await openProfiles(page);
  await page.getByRole("button", { name: "Delete Alex", exact: true }).click();
  await page.getByRole("dialog", { name: "Delete profile?", exact: true }).getByRole("button", { name: "Delete profile", exact: true }).click();
  await expect(page.getByRole("list", { name: "Your player profile", exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Your player profile", exact: true })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("catania.profiles")!))).toEqual([]);
  await page.getByLabel("Profile name", { exact: true }).fill("Nora");
  await page.getByRole("button", { name: "Create and continue", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Player 1 name", exact: true })).toHaveValue("Nora");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("catania.profiles")!))).toMatchObject([
    { name: "Nora", games: 0, wins: 0, totalPoints: 0, history: [] },
  ]);
});

test("failed profile deletion reports the storage error without removing the profile", async ({ page }) => {
  await openProfiles(page);
  await page.evaluate(() => {
    Storage.prototype.setItem = () => { throw new DOMException("Storage blocked", "SecurityError"); };
  });
  await page.getByRole("button", { name: "Delete Alex", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: "Delete profile?", exact: true });
  await confirmation.getByRole("button", { name: "Delete profile", exact: true }).click();
  await expect(confirmation.getByRole("alert")).toHaveText("The profile could not be deleted. Check browser storage and try again.");
  expect(await page.evaluate(() => localStorage.getItem("catania.profile.active"))).toBe("history-profile");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("catania.profiles")!)[0].history)).toEqual(history);
  await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("button", { name: "Delete Alex", exact: true })).toBeFocused();
});

test("invited phones can delete the active profile and choose another before joining", async ({ page }) => {
  await addOtherProfile(page);
  await page.goto("/?multiplayer=1#host=profile-delete-host&secret=profile-delete-secret");
  await openProfiles(page);
  await page.getByRole("button", { name: "Delete Alex", exact: true }).click();
  await page.getByRole("dialog", { name: "Delete profile?", exact: true }).getByRole("button", { name: "Delete profile", exact: true }).click();
  expect(await page.evaluate(() => localStorage.getItem("catania.profile.active"))).toBeNull();
  await page.getByRole("button", { name: "Continue as Sam", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Your name", exact: true })).toHaveValue("Sam");
  await expect(page.getByRole("button", { name: "Menu", exact: true }).locator(".profile-avatar")).toHaveText("S");
});

test("invited phones can replay saved maps in single-device setup", async ({ page }) => {
  await page.goto("/?multiplayer=1#host=profile-history-host&secret=profile-history-secret");
  const entries = await openHistory(page);
  await entries.getByRole("listitem").first().getByRole("button", { name: "Replay map", exact: true }).click();
  await expect(page).toHaveURL(/\/\?map=8765432A&variant=seafarers$/);
  await expectMap(page.getByRole("region", { name: "Island preview", exact: true }), history[0]!);
  await openHistory(page);
  await expect(page.getByRole("list", { name: "Game history for Alex", exact: true }).getByRole("listitem")).toHaveCount(2);
});

test("saved map links report invalid codes or game versions", async ({ page }) => {
  for (const address of ["/?map=invalid&variant=original", "/?map=ABCDEFGH&variant=unknown"]) {
    await page.goto(address);
    await expect(page.getByRole("alert")).toHaveText("This saved map link is invalid.");
  }
});

test("profile game history localizes in Japanese", async ({ page }, testInfo) => {
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("combobox", { name: "Language", exact: true }).selectOption("ja");
  await page.getByRole("button", { name: "プロフィール", exact: true }).click();
  await page.locator("summary").filter({ hasText: "ゲーム履歴" }).click();
    const entries = page.getByRole("list", { name: "Alexのゲーム履歴", exact: true });
    await expect(entries.getByRole("listitem").first()).toContainText("航海者");
    await expect(entries.getByRole("listitem").first().getByRole("img", { name: "敗北", exact: true })).toBeVisible();
    await expect(entries.getByRole("listitem").first()).toContainText("34");
    await expect(entries.getByRole("listitem").last().getByRole("img", { name: "勝利", exact: true })).toBeVisible();
    await expect(entries.getByRole("button", { name: "このマップを再現", exact: true })).toHaveCount(2);
  await page.getByRole("button", { name: "Alexを削除", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: "プロフィールを削除しますか？", exact: true });
  await expect(confirmation).toContainText("この操作は取り消せません。");
  await confirmation.getByRole("button", { name: "キャンセル", exact: true }).click();
  await expectNoOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("japanese-profile-history.png"), fullPage: true });
});
