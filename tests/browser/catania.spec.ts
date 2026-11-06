import { type Locator, type Page, type TestInfo } from "@playwright/test";
import { expect, test as base } from "./fixtures";
import { createBoard, seededRandom } from "../../src/game/board";
import { applyAction, COSTS, createGame, emptyResources, getLongestRoadLength, getScore, getTradeRatio, legalCityVertices, legalRoadEdges, legalSettlementVertices, legalShipEdges, RESOURCES, resourceTotal } from "../../src/game/engine";
import { chooseComputerAction } from "../../src/game/computer";
import type { GameState, Resource, Resources } from "../../src/game/types";
import { RESOURCE_NAMES } from "../../src/components/GameUi";
import { BOARD_THEMES as ALL_THEMES } from "../../src/themes";

const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    const errors: string[] = [];
    const warnings: string[] = [];
    page.on("console", message => {
      if (message.type() === "error") errors.push(`console: ${message.text()}`);
      if (message.type() === "warning") warnings.push(message.text());
    });
    page.on("pageerror", error => errors.push(`pageerror: ${error.message}`));
    page.on("requestfailed", request => errors.push(`${request.failure()?.errorText}: ${request.url()}`));
    page.on("response", response => {
      if (response.status() >= 400) errors.push(`HTTP ${response.status()}: ${response.url()}`);
    });
    try {
      await use(page);
    } finally {
      await testInfo.attach("browser-diagnostics", {
        body: JSON.stringify({ errors, warnings }, null, 2),
        contentType: "application/json",
      });
      expect.soft(errors, "No browser errors or failed application requests").toEqual([]);
    }
  },
});

async function screenshot(page: Page, testInfo: TestInfo, name: string, fullPage = true) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage });
  await testInfo.attach(name, { path, contentType: "image/png" });
}

async function noHorizontalOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) <= window.innerWidth)).toBe(true);
}

async function noPageOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => ({
    horizontal: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) > window.innerWidth,
    vertical: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight) > window.innerHeight,
    left: window.scrollX,
    top: window.scrollY,
  }))).toEqual({ horizontal: false, vertical: false, left: 0, top: 0 });
  expect(await page.locator(".hand-content:visible").evaluateAll(elements => elements.every(element =>
    element.scrollWidth <= element.clientWidth && element.scrollLeft === 0,
  )), "Sidebar fits without horizontal scrolling").toBe(true);
}

async function boardFrame(page: Page) {
  const board = page.getByRole("region", { name: "Game board", exact: true });
  await expect(board).toBeInViewport({ ratio: 1 });
  await expect(board.locator(".board-map")).toBeInViewport({ ratio: 1 });
  const zoom = board.getByRole("group", { name: "Map zoom controls", exact: true });
  await expect(zoom).toHaveText(/^\s*-\s*\d+%\s*\+\s*$/);
  await expect(zoom).toBeInViewport({ ratio: 1 });
  const theme = board.locator(".board-controls").getByRole("button", { name: "Change theme", exact: true });
  await expect(theme).toHaveText("Theme");
  await expect(theme).toBeInViewport({ ratio: 1 });
  await noPageOverflow(page);
  const frame = await board.locator(".board-surface, .board-viewport, .board-map").evaluateAll(elements => elements.map(element => {
    const { x, y, width, height } = element.getBoundingClientRect();
    return { x, y, width, height };
  }));
  expect(frame).toHaveLength(3);
  return frame;
}

async function expectBoardFrame(page: Page, expected: Awaited<ReturnType<typeof boardFrame>>) {
  await expect.poll(async () => {
    const current = await boardFrame(page);
    return current.length === expected.length && current.every((bounds, index) =>
      (Object.keys(bounds) as (keyof typeof bounds)[]).every(key => Math.abs(bounds[key] - expected[index]![key]) <= 1),
    );
  }, { message: "The board, map viewport and island keep their position and size" }).toBe(true);
}

async function expectPlacementConfirmation(page: Page, target: Locator, selectionId: string) {
  const confirmation = page.getByRole("group", { name: "Placement confirmation", exact: true });
  await expect(confirmation).toHaveClass(/placement-confirmation/);
  await expect(confirmation).toHaveAttribute("data-selection-id", selectionId);
  await expect(confirmation).not.toHaveAttribute("aria-modal", "true");
  await expect(confirmation.locator(".placement-confirmation-player")).toBeVisible();
  await expect(confirmation.locator(".placement-confirmation-player")).not.toBeEmpty();
  const title = confirmation.locator('p[id$="-confirmation-title"]');
  await expect(title).toBeVisible();
  await expect(title).not.toBeEmpty();
  await expect(target).toHaveAttribute("aria-pressed", "true");
  await expect(async () => {
    const popup = (await confirmation.boundingBox())!;
    const viewport = (await page.getByRole("region", { name: "Game board", exact: true }).locator(".board-viewport").boundingBox())!;
    const anchor = await target.evaluate(element => {
      const graphic = element as SVGGraphicsElement;
      const bounds = graphic.getBBox();
      const point = new DOMPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2).matrixTransform(graphic.getScreenCTM()!);
      const { x, y, width, height } = graphic.getBoundingClientRect();
      return { x: point.x, y: point.y, target: { x, y, width, height } };
    });
    expect(anchor.x).toBeGreaterThanOrEqual(viewport.x);
    expect(anchor.x).toBeLessThanOrEqual(viewport.x + viewport.width);
    expect(anchor.y).toBeGreaterThanOrEqual(viewport.y);
    expect(anchor.y).toBeLessThanOrEqual(viewport.y + viewport.height);
    expect(popup.x).toBeGreaterThanOrEqual(viewport.x);
    expect(popup.y).toBeGreaterThanOrEqual(viewport.y);
    expect(popup.x + popup.width).toBeLessThanOrEqual(viewport.x + viewport.width);
    expect(popup.y + popup.height).toBeLessThanOrEqual(viewport.y + viewport.height);
    const horizontalGap = Math.max(anchor.target.x - popup.x - popup.width, popup.x - anchor.target.x - anchor.target.width, 0);
    const verticalGap = Math.max(anchor.target.y - popup.y - popup.height, popup.y - anchor.target.y - anchor.target.height, 0);
    expect(Math.hypot(horizontalGap, verticalGap), "Confirmation stays beside the selected SVG target").toBeLessThanOrEqual(24);
    const horizontalDistance = Math.max(popup.x - anchor.x, anchor.x - popup.x - popup.width, 0);
    const verticalDistance = Math.max(popup.y - anchor.y, anchor.y - popup.y - popup.height, 0);
    expect(Math.hypot(horizontalDistance, verticalDistance)).toBeLessThanOrEqual(Math.max(anchor.target.width, anchor.target.height) / 2 + 24);
  }).toPass({ timeout: 5_000 });
  await expect(confirmation.getByRole("button", { name: "Confirm placement", exact: true })).toBeInViewport({ ratio: 1 });
  await expect(confirmation.getByRole("button", { name: "Cancel", exact: true })).toBeInViewport({ ratio: 1 });
  return confirmation;
}

async function privateHandIsAbsent(page: Page) {
  await expect(page.getByRole("region", { name: "Private resources", includeHidden: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Your current resources", includeHidden: true })).toHaveCount(0);
  await expect(page.getByRole("complementary", { name: "Your hand and actions", includeHidden: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Your development cards", includeHidden: true })).toHaveCount(0);
  await expect(page.getByText("Your victory points", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Resource collection", includeHidden: true })).toHaveCount(0);
  await expect(page.getByRole("status", { name: "Resource receipt", includeHidden: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Robbery notification", includeHidden: true })).toHaveCount(0);
  await expect(page.getByRole("status", { name: "Robbery result", includeHidden: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Monopoly notification", includeHidden: true })).toHaveCount(0);
  await expect(page.getByRole("status", { name: "Monopoly result", includeHidden: true })).toHaveCount(0);
  await expect(page.getByRole("list", { name: "Your roll rewards", includeHidden: true })).toHaveCount(0);
}

async function revealHand(page: Page) {
  const heading = page.getByRole("heading", { name: /^Pass the device to / });
  await expect(heading).toBeVisible();
  const name = (await heading.innerText()).replace(/^Pass the device to /, "").replace(/\.$/, "");
  await privateHandIsAbsent(page);
  await page.getByRole("button", { name: `I'm ${name}. Reveal my hand`, exact: true }).click();
  await expect(page.getByRole("heading", { name: `${name}'s hand`, exact: true, includeHidden: true })).toHaveCount(1);
  return name;
}

async function showView(page: Page, view: "board" | "hand" | "players") {
  const navigation = page.getByRole("navigation", { name: "Game views" });
  if (await navigation.isVisible()) {
    await navigation.getByRole("button", { name: view, exact: true }).click();
    await expect(navigation.getByRole("button", { name: view, exact: true })).toHaveAttribute("aria-pressed", "true");
  }
}

async function revealBuildSection(page: Page) {
  const toggle = page.getByRole("button", { name: "Build a little bigger", exact: true });
  if ((await toggle.getAttribute("aria-expanded")) === "false") {
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
}

async function showHomeView(page: Page, view: "Setup" | "Island") {
  const navigation = page.getByRole("navigation", { name: "Home views", exact: true });
  if (await navigation.isVisible()) {
    const button = navigation.getByRole("button", { name: view, exact: true });
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true");
  }
}

async function openHomeThemes(page: Page) {
  await showHomeView(page, "Setup");
  await page.getByRole("region", { name: "Set up your table", exact: true })
    .getByRole("button", { name: "Change theme", exact: true }).click();
  return page.getByRole("dialog", { name: "Choose your theme", exact: true });
}

async function chooseGameOption(page: Page, name: "Help" | "Settings" | "Pass device" | "Reset game" | "End game") {
  await page.getByRole("button", { name: "Game", exact: true }).click();
  await page.getByRole("group", { name: "Game menu", exact: true }).getByRole("button", { name, exact: true }).click();
}

async function expectResourceInventory(context: Locator, resources: Resources) {
  const inventory = context.getByRole("region", { name: "Your current resources", exact: true });
  await expect(inventory).toBeVisible();
  await expect(inventory.getByRole("heading", { name: "Your hand", exact: true })).toBeVisible();
  const cardCount = inventory.getByText(`${resourceTotal(resources)} cards`, { exact: true });
  await expect(cardCount).toBeVisible();
  if (resourceTotal(resources) > 7) {
    await expect(cardCount).toHaveClass(/card-count-at-risk/);
  } else {
    await expect(cardCount).not.toHaveClass(/card-count-at-risk/);
  }
  const cards = inventory.getByRole("list", { name: "Cards in hand", exact: true });
  await expect(cards.getByRole("listitem")).toHaveCount(5);
  for (const resource of RESOURCES) {
    const card = cards.getByRole("listitem", { name: `${RESOURCE_NAMES[resource]}: ${resources[resource]} in hand`, exact: true });
    await expect(card.getByText(RESOURCE_NAMES[resource], { exact: true })).toBeVisible();
    await expect(card.getByText(String(resources[resource]), { exact: true })).toBeVisible();
    await expect(card.locator(".resource-card")).toHaveCSS("filter", resources[resource] === 0 ? "grayscale(1)" : "none");
  }
  return inventory;
}

async function expectResourceBank(page: Page, resources: Resources) {
  const bank = page.getByRole("region", { name: "Resource bank", exact: true });
  await expect(bank).toBeInViewport({ ratio: 1 });
  await expect(bank.getByRole("listitem")).toHaveCount(5);
  for (const resource of RESOURCES) {
    const card = bank.getByRole("listitem", { name: `${RESOURCE_NAMES[resource]}: ${resources[resource]} in bank`, exact: true });
    await expect(card.getByText(String(resources[resource]), { exact: true })).toBeVisible();
  }
  expect(await bank.locator(".bank-card").evaluateAll(cards => cards.every(card => {
    const bounds = card.getBoundingClientRect();
    const icon = card.querySelector("svg")!.getBoundingClientRect();
    const quantity = card.querySelector("strong")!.getBoundingClientRect();
    return quantity.top >= icon.bottom + 1 && quantity.bottom <= bounds.bottom &&
      quantity.left >= bounds.left && quantity.right <= bounds.right;
  })), "Bank quantities sit below the icons and stay inside their cards").toBe(true);
  await expect(page.getByRole("region", { name: "Game board", exact: true, includeHidden: true }).getByRole("region", { name: "Resource bank", includeHidden: true })).toHaveCount(0);
  await expect(page.getByRole("complementary", { name: "Your hand and actions", includeHidden: true }).getByRole("region", { name: "Resource bank", includeHidden: true })).toHaveCount(0);
  return bank;
}

async function expectResourceSelection(fieldset: Locator, resource: Resource, selected: number, owned?: number) {
  const selection = fieldset.getByRole("group", { name: `${RESOURCE_NAMES[resource]} selection`, exact: true });
  const output = selection.getByRole("status", { name: `${RESOURCE_NAMES[resource]} selected`, exact: true });
  await expect(output).toHaveText(String(selected));
  await expect(output).toBeVisible();
  await expect(selection).toHaveAccessibleDescription(owned === undefined
    ? `Selected ${selected}.`
    : `In hand ${owned}. Selected ${selected}. Remaining ${owned - selected}.`);
  await expect(selection.getByText(/^(In hand|In bank|Selected|Remaining)\b/)).toHaveCount(0);
  return selection;
}

async function expectTradeCards(context: Locator, label: "You give" | "You receive", resources: Resources) {
  const entries = RESOURCES.filter(resource => resources[resource] > 0);
  const cards = context.getByRole("img", {
    name: `${label}: ${entries.map(resource => `${resources[resource]} ${RESOURCE_NAMES[resource]}`).join(", ")}`,
    exact: true,
  });
  await expect(cards).toBeVisible();
  await expect(cards.getByText(label, { exact: true })).toBeVisible();
  await expect(cards.locator("strong")).toHaveText(entries.map(resource => String(resources[resource])));
}

async function expectPublicCardCounts(page: Page, state: GameState) {
  await showView(page, "players");
  for (const player of state.players) {
    const counts = page.getByRole("group", { name: `${player.name}'s card counts`, exact: true });
    await counts.scrollIntoViewIfNeeded();
    await expect(counts.getByRole("img", { name: `${resourceTotal(player.resources)} resource cards`, exact: true })).toBeVisible();
    await expect(counts.getByRole("img", { name: `${player.developmentCards.length} development cards`, exact: true })).toBeVisible();
    expect(await counts.innerText()).not.toMatch(/resources|development/i);
    const seat = page.locator(".player-seat").filter({ has: counts });
    await expect(seat.getByRole("list", { name: "Cards in hand", includeHidden: true })).toHaveCount(0);
    await expect(seat.getByText(/^(Wood|Brick|Wool|Grain|Ore)$/)).toHaveCount(0);
  }
  await noPageOverflow(page);
}

const BOARD_THEMES = [
  { id: "illustrated", name: "Illustrated Island" },
  { id: "ceramic", name: "Mediterranean Ceramic" },
  { id: "wooden", name: "Carved Wooden Tabletop" },
  { id: "pixel", name: "Pixel-Art Kingdom" },
  { id: "space", name: "Space Frontier" },
  { id: "underwater", name: "Underwater Colonies" },
] as const;

async function expectBoardTheme(page: Page, theme: typeof BOARD_THEMES[number]["id"]) {
  await expect(page.locator("#root > [data-theme]")).toHaveAttribute("data-theme", theme);
  const surfaces = page.locator(".board-surface");
  expect(await surfaces.count()).toBeGreaterThan(0);
  for (const surface of await surfaces.all()) await expect(surface).toHaveAttribute("data-theme", theme);
}

async function themeBoardGeometry(context: Locator) {
  return context.locator('svg g[role="img"]').evaluateAll(elements => elements.map(element => ({
    label: element.getAttribute("aria-label"),
    transform: element.getAttribute("transform"),
    points: element.querySelector("polygon")?.getAttribute("points") ?? null,
    token: element.querySelector(".number-token")?.textContent ?? null,
    path: element.classList.contains("terrain-hex") ? null : element.querySelector(":scope > path")?.getAttribute("d") ?? null,
    line: element.querySelector(":scope > line")?.getAttributeNames().filter(name => ["x1", "x2", "y1", "y2"].includes(name))
      .map(name => [name, element.querySelector(":scope > line")!.getAttribute(name)]) ?? null,
  })));
}

async function themeTerrainArtwork(context: Locator) {
  return context.locator(".terrain-hex").evaluateAll(elements => elements.map(element =>
    Array.from(element.querySelectorAll("path, use, rect, ellipse, line"), graphic => graphic.outerHTML).join(""),
  ).join(""));
}

for (const theme of BOARD_THEMES) {
  test(`board theme ${theme.name} previews immediately, starts the selected island and persists`, async ({ page }, testInfo) => {
    await page.goto("/");
    await page.getByRole("combobox", { name: "Human players", exact: true }).selectOption("3");
    await seedGameRandomness(page);
    const dialog = await openHomeThemes(page);
    const choices = page.getByRole("group", { name: "Board theme", exact: true });
    await expect(choices.locator("legend")).toHaveText("Board theme");
    expect(await choices.evaluate(element => element.tagName)).toBe("FIELDSET");
    await expect(choices.locator('input[type="radio"]')).toHaveCount(6);
    for (const choice of BOARD_THEMES) await expect(choices.getByRole("radio", { name: choice.name, exact: true })).toBeEnabled();
    await expect(choices.getByRole("radio", { name: "Illustrated Island", exact: true })).toBeChecked();
    await expectBoardTheme(page, "illustrated");
    const preview = page.getByRole("region", { name: "Island preview", exact: true, includeHidden: true });
    const geometry = await themeBoardGeometry(preview);
    const originalArtwork = await themeTerrainArtwork(preview);
    const sample = page.locator(".home-theme-preview");
    await expect(sample.locator(":scope > g > polygon")).toHaveCount(3);
    for (const tile of await sample.locator(":scope > g").all()) {
      expect(await tile.locator("path").count()).toBeGreaterThan(0);
    }
    const originalSample = await sample.innerHTML();
    await choices.getByRole("radio", { name: theme.name, exact: true }).check();
    await expectBoardTheme(page, theme.id);
    await expect(choices.getByRole("radio", { name: theme.name, exact: true })).toBeChecked();
    expect(await themeBoardGeometry(preview)).toEqual(geometry);
    if (theme.id !== "illustrated") expect(await themeTerrainArtwork(preview)).not.toBe(originalArtwork);
    await expect(sample).toHaveAttribute("data-theme", theme.id);
    if (theme.id !== "illustrated") expect(await sample.innerHTML()).not.toBe(originalSample);
    await expect.poll(() => page.evaluate(() => localStorage.getItem("catania.boardTheme"))).toBe(theme.id);
    await dialog.getByRole("button", { name: "Close dialog", exact: true }).click();
    await screenshot(page, testInfo, `theme-${theme.id}-home`, false);
    await showHomeView(page, "Island");
    await noPageOverflow(page);
    await screenshot(page, testInfo, `theme-${theme.id}-preview`, false);

    await showHomeView(page, "Setup");
    await page.getByRole("button", { name: "Let's settle in", exact: true }).click();
    await privateHandIsAbsent(page);
    await expectBoardTheme(page, theme.id);
    expect(await themeBoardGeometry(page.locator(".handoff-island"))).toEqual(geometry);
    await revealHand(page);
    await showView(page, "board");
    const board = page.getByRole("region", { name: "Game board", exact: true });
    expect(await themeBoardGeometry(board)).toEqual(geometry);
    await placeStartingPieces(page);
    await revealHand(page);
    await showView(page, "board");
    await expectBoardTheme(page, theme.id);
    await expect(board.getByRole("img", { name: /'s settlement at / })).toHaveCount(1);
    await expect(board.getByRole("img", { name: /'s road at / })).toHaveCount(1);
    await boardFrame(page);
    await screenshot(page, testInfo, `theme-${theme.id}-game-board`, false);

    await chooseGameOption(page, "End game");
    await page.getByRole("dialog", { name: "Leave this island?", exact: true }).getByRole("button", { name: "End game", exact: true }).click();
    await openHomeThemes(page);
    await expect(choices.getByRole("radio", { name: theme.name, exact: true })).toBeChecked();
    await page.reload();
    await expectBoardTheme(page, theme.id);
    await openHomeThemes(page);
    await expect(choices.getByRole("radio", { name: theme.name, exact: true })).toBeChecked();
  });
}

for (const storage of ["unknown", "blocked", "read-write-errors"] as const) {
  test(`board theme falls back safely with ${storage} storage`, async ({ page }) => {
    await page.addInitScript(storage => {
      if (storage === "unknown") localStorage.setItem("catania.boardTheme", "not-a-board-theme");
      if (storage === "blocked") Object.defineProperty(window, "localStorage", {
        get() { throw new DOMException("Storage blocked", "SecurityError"); },
      });
      if (storage === "read-write-errors") Object.defineProperty(window, "localStorage", {
        value: {
          getItem() { throw new DOMException("Storage blocked", "SecurityError"); },
          setItem() { throw new DOMException("Storage full", "QuotaExceededError"); },
        },
      });
    }, storage);
    await page.goto("/");
    // Blocked or erroring storage cannot restore a profile: create one for this visit.
    if (storage !== "unknown") {
      await page.getByLabel("Profile name", { exact: true }).fill("Pat");
      await page.getByRole("button", { name: "Create and continue", exact: true }).click();
    }
    await expectBoardTheme(page, "illustrated");
    await openHomeThemes(page);
    const choices = page.getByRole("group", { name: "Board theme", exact: true });
    await expect(choices.getByRole("radio", { name: "Illustrated Island", exact: true })).toBeChecked();
    await choices.getByRole("radio", { name: "Space Frontier", exact: true }).check();
    await expectBoardTheme(page, "space");
    await page.keyboard.press("Escape");
    await page.getByRole("combobox", { name: "Human players", exact: true }).selectOption("3");
    await page.getByRole("button", { name: "Let's settle in", exact: true }).click();
    await revealHand(page);
    await showView(page, "board");
    await page.getByRole("button", { name: "Change theme", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Choose your theme", exact: true });
    await dialog.getByRole("radio", { name: "Underwater Colonies", exact: true }).check();
    await expectBoardTheme(page, "underwater");
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Change theme", exact: true })).toBeFocused();
    await page.reload();
    if (storage !== "unknown") {
      await page.getByLabel("Profile name", { exact: true }).fill("Pat");
      await page.getByRole("button", { name: "Create and continue", exact: true }).click();
    }
    await expectBoardTheme(page, "illustrated");
    await openHomeThemes(page);
    await expect(choices.getByRole("radio", { name: "Illustrated Island", exact: true })).toBeChecked();
  });
}

test("board theme native radios support keyboard selection on the home preview", async ({ page }) => {
  await page.goto("/");
  const dialog = await openHomeThemes(page);
  const choices = page.getByRole("group", { name: "Board theme", exact: true });
  const illustrated = choices.getByRole("radio", { name: "Illustrated Island", exact: true });
  await illustrated.focus();
  await page.keyboard.press("ArrowRight");
  const ceramic = choices.getByRole("radio", { name: "Mediterranean Ceramic", exact: true });
  await expect(ceramic).toBeFocused();
  await expect(ceramic).toBeChecked();
  await expectBoardTheme(page, "ceramic");
  await page.keyboard.press("ArrowLeft");
  await expect(illustrated).toBeFocused();
  await expect(illustrated).toBeChecked();
  await page.keyboard.press("ArrowUp");
  await expect(choices.getByRole("radio", { name: "Underwater Colonies", exact: true })).toBeFocused();
  await expectBoardTheme(page, "underwater");
  await page.keyboard.press("ArrowDown");
  await expect(illustrated).toBeChecked();
  await expectBoardTheme(page, "illustrated");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Set up your table", exact: true })
    .getByRole("button", { name: "Change theme", exact: true })).toBeFocused();
  await noPageOverflow(page);
});

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
  { width: 320, height: 568 },
  { width: 844, height: 390 },
]) {
  test(`home fits one screen at ${viewport.width}x${viewport.height} with setup, themes and island views`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    const setup = page.getByRole("region", { name: "Set up your table", exact: true });
    const start = setup.getByRole("button", { name: "Let's settle in", exact: true });
    const settings = setup.locator(".home-setup-content");
    const multiplayer = page.getByRole("link", { name: "Play across devices", exact: true });
    await expect(setup.getByText("On this device", { exact: true })).toBeVisible();
    const localStart = setup.getByRole("group", { name: "Start on this device", exact: true });
    const crossDevice = page.getByRole("region", { name: "Cross-device play", exact: true });
    await expect(localStart.getByRole("button", { name: "Let's settle in", exact: true })).toHaveCount(1);
    await expect(localStart.getByRole("link")).toHaveCount(0);
    await expect(crossDevice.getByRole("link", { name: "Play across devices", exact: true })).toHaveCount(1);
    await expect(crossDevice.getByRole("heading", { name: "Separate multiplayer setup", exact: true })).toBeVisible();
    await expect(start).not.toHaveAttribute("aria-describedby");
    await expect(multiplayer).not.toHaveAttribute("aria-describedby");
    await expect(page.locator("#local-start-note, #multiplayer-start-note")).toHaveCount(0);
    const buttonStyles = await page.locator(".home-local-start .button-primary, .home-multiplayer .button-primary").evaluateAll(elements => elements.map(element => {
      const bounds = element.getBoundingClientRect();
      const styles = getComputedStyle(element);
      return { height: bounds.height, background: styles.backgroundColor, radius: styles.borderRadius, font: styles.font, padding: styles.padding };
    }));
    expect(buttonStyles).toHaveLength(2);
    expect(buttonStyles[0]).toEqual(buttonStyles[1]);
    expect(await crossDevice.evaluate(element => getComputedStyle(element).borderTopStyle)).toBe("solid");
    await expect(start).toBeInViewport({ ratio: 1 });
    await expect(multiplayer).toBeInViewport({ ratio: 1 });
    await expect(multiplayer).toHaveAttribute("href", "/?multiplayer=1");
    await noPageOverflow(page);
    await page.getByRole("button", { name: "4 players", exact: true }).click();
    await page.getByRole("combobox", { name: "Human players", exact: true }).selectOption("4");
    for (const [index, name] of ["Alex", "Sam", "Jordan", "Robin"].entries()) {
      const input = setup.getByRole("textbox", { name: `Player ${index + 1} name`, exact: true });
      await input.fill(name);
      await input.scrollIntoViewIfNeeded();
      await expect(input).toBeInViewport({ ratio: 1 });
    }
    if (viewport.height >= 650) {
      await expect(setup.getByRole("button", { name: "Change theme", exact: true })).toBeInViewport({ ratio: 1 });
      expect(await settings.evaluate(element => element.scrollHeight <= element.clientHeight)).toBe(true);
    }
    await settings.evaluate(element => { element.scrollTop = 0; });
    const startBounds = await start.boundingBox();
    await settings.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect(start).toBeInViewport({ ratio: 1 });
    expect(await start.boundingBox()).toEqual(startBounds);
    await settings.evaluate(element => { element.scrollTop = 0; });
    await noPageOverflow(page);
    await screenshot(page, testInfo, "single-screen-setup", false);

    const dialog = await openHomeThemes(page);
    await expect(dialog).toBeInViewport({ ratio: 1 });
    await expect(dialog.getByRole("radio")).toHaveCount(6);
    await dialog.getByRole("radio", { name: "Carved Wooden Tabletop", exact: true }).check();
    await noPageOverflow(page);
    await screenshot(page, testInfo, "single-screen-theme-dialog", false);
    await page.keyboard.press("Escape");
    await expect(setup.getByRole("button", { name: "Change theme", exact: true })).toBeFocused();
    await expect(setup).toContainText("Carved Wooden Tabletop");

    await showHomeView(page, "Island");
    const island = page.getByRole("region", { name: "Island preview", exact: true });
    await expect(island).toBeInViewport({ ratio: 1 });
    await expect(island.locator(".board-map")).toBeInViewport({ ratio: 1 });
    expect((await island.locator(".board-viewport").boundingBox())!.height).toBeGreaterThan(100);
    await expect(island.getByRole("textbox", { name: "Map code", exact: true })).toBeInViewport({ ratio: 1 });
    await expect(island.getByRole("button", { name: "Replay map", exact: true })).toHaveCount(0);
    await expect(island.getByRole("button", { name: "Shuffle island preview", exact: true })).toBeInViewport({ ratio: 1 });
    const seedToolbar = island.locator(".board-surface > .board-header-controls").getByRole("form", { name: "Map code", exact: true });
    await expect(seedToolbar).toBeInViewport({ ratio: 1 });
    expect(await seedToolbar.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    const geometry = await themeBoardGeometry(island);
    await island.getByRole("button", { name: "Shuffle island preview", exact: true }).click();
    await expect.poll(() => themeBoardGeometry(island)).not.toEqual(geometry);
    await island.getByRole("button", { name: "Zoom in", exact: true }).click();
    await expect(island.getByRole("status", { name: "Zoom level", exact: true })).toHaveText("125%");
    if (await page.getByRole("navigation", { name: "Home views", exact: true }).isVisible()) {
      await expect(start).toBeHidden();
    } else {
      await expect(start).toBeInViewport({ ratio: 1 });
    }
    await expect(multiplayer).toBeInViewport({ ratio: 1 });
    await noPageOverflow(page);
    await screenshot(page, testInfo, "single-screen-island", false);
    await island.getByRole("button", { name: "Change theme", exact: true }).click();
    await expect(dialog.getByRole("radio", { name: "Carved Wooden Tabletop", exact: true })).toBeChecked();
    await page.keyboard.press("Escape");
    await expect(island.getByRole("button", { name: "Change theme", exact: true })).toBeFocused();

    await showHomeView(page, "Setup");
    await setup.getByRole("textbox", { name: "Player 2 name", exact: true }).fill("Alex");
    await start.click();
    await expect(setup).toBeVisible();
    await expect(page.getByRole("alert")).toHaveText("Use a different name for each player so private handoffs are clear.");
    await expect(page.getByRole("alert")).toBeInViewport({ ratio: 1 });
    await expect(start).toBeInViewport({ ratio: 1 });
    await expect(multiplayer).toBeInViewport({ ratio: 1 });
    await setup.getByRole("textbox", { name: "Player 2 name", exact: true }).fill("Sam");
    await noPageOverflow(page);
    await screenshot(page, testInfo, "single-screen-validation", false);
    await start.click();
    await privateHandIsAbsent(page);
    await expect(page.getByRole("heading", { name: /^Pass the device to / })).toBeVisible();
  });
}

for (const language of ["en", "ja"] as const) {
  test(`map seed toolbar automatically loads complete codes without overflow in ${language}`, async ({ page }, testInfo) => {
    await page.addInitScript(language => localStorage.setItem("catania.language", language), language);
    await page.goto("/");
    const labels = language === "ja"
      ? { island: "島", preview: "島のプレビュー", code: "マップコード", replay: "このマップを再現", shuffle: "島の配置をシャッフル" }
      : { island: "Island", preview: "Island preview", code: "Map code", replay: "Replay map", shuffle: "Shuffle island preview" };
    const island = page.getByRole("region", { name: labels.preview, exact: true });
    const toolbar = island.locator(".board-surface > .board-header-controls").getByRole("form", { name: labels.code, exact: true });
    const input = toolbar.getByRole("textbox", { name: labels.code, exact: true });
    const shuffle = toolbar.getByRole("button", { name: labels.shuffle, exact: true });
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 568 }]) {
      await page.setViewportSize(viewport);
      const islandView = page.getByRole("button", { name: labels.island, exact: true });
      if (await islandView.isVisible()) await islandView.click();
      await expect(toolbar).toBeInViewport({ ratio: 1 });
      await expect(toolbar.getByRole("button", { name: labels.replay, exact: true })).toHaveCount(0);
      await expect(toolbar.getByRole("button")).toHaveCount(1);
      await expect(input).toHaveAttribute("maxlength", "8");
      await expect(toolbar.locator("label > span")).toBeVisible();
      expect(await toolbar.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      const fieldBounds = (await toolbar.locator("label").boundingBox())!;
      await expect(shuffle).toBeInViewport({ ratio: 1 });
      const bounds = (await shuffle.boundingBox())!;
      expect(bounds.height).toBeGreaterThanOrEqual(44);
      expect(bounds.width).toBeGreaterThanOrEqual(44);
      expect(bounds.y + bounds.height / 2).toBeCloseTo(fieldBounds.y + fieldBounds.height / 2, 0);
      expect(await input.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      await input.fill("testmap2");
      await expect(input).toHaveValue("TESTMAP2");
      const selectedIsland = await themeBoardGeometry(island);
      await input.fill("225DV7H");
      expect(await themeBoardGeometry(island)).toEqual(selectedIsland);
      await expect(page.getByRole("alert")).toHaveCount(0);
      await input.press("4");
      await expect.poll(() => themeBoardGeometry(island)).not.toEqual(selectedIsland);
      await input.fill("testmap2");
      await expect(input).toHaveValue("TESTMAP2");
      await expect.poll(() => themeBoardGeometry(island)).toEqual(selectedIsland);
      await input.press("Enter");
      expect(await themeBoardGeometry(island)).toEqual(selectedIsland);
      await input.press("Tab");
      await expect(shuffle).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(input).not.toHaveValue("TESTMAP2");
      await expect(input).toHaveValue(/^[A-HJKMNP-Z2-9]{8}$/);
      await expect.poll(() => themeBoardGeometry(island)).not.toEqual(selectedIsland);
      await expect(page.getByRole("alert")).toHaveCount(0);
      await noPageOverflow(page);
      await screenshot(page, testInfo, `map-seed-${language}-${viewport.width}`, false);
    }
    const selectedIsland = await themeBoardGeometry(island);
    await input.fill("TESTMAP");
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect(await themeBoardGeometry(island)).toEqual(selectedIsland);
    await input.press("Enter");
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByRole("alert")).toBeInViewport({ ratio: 1 });
    await input.fill("INVALID?");
    await expect(page.getByRole("alert")).toHaveText(language === "ja"
      ? "8文字の有効なマップコードを入力してください。"
      : "Enter a valid 8-character map code.");
    await expect(page.getByRole("alert")).toBeInViewport({ ratio: 1 });
    await expect(input).toHaveAttribute("aria-invalid", "true");
    expect(await themeBoardGeometry(island)).toEqual(selectedIsland);
    await input.fill("TESTMAP2");
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(input).toHaveAttribute("aria-invalid", "false");
    await input.press("Enter");
    await expect(input).toHaveValue("TESTMAP2");
  });
}

test("cross-device play opens its own setup without using local player settings", async ({ page }) => {
  await page.routeWebSocket(/\/peerjs\?/, () => {});
  await page.goto("/");
  await page.getByRole("button", { name: "4 players", exact: true }).click();
  await page.getByRole("combobox", { name: "Human players", exact: true }).selectOption("4");
  await page.getByRole("textbox", { name: "Player 2 name", exact: true }).fill("Alex");
  await page.getByRole("button", { name: "Let's settle in", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  const multiplayer = page.getByRole("region", { name: "Cross-device play", exact: true })
    .getByRole("link", { name: "Play across devices", exact: true });
  await multiplayer.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/\?multiplayer=1$/);
  await expect(page.getByRole("heading", { name: "Scan. Join. Settle in.", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Set up your table", exact: true })).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("island harbors carry their resource color, icon and trade ratio", async ({ page }, testInfo) => {
  await page.goto("/");
  await showHomeView(page, "Island");
  const island = page.getByRole("region", { name: "Island preview", exact: true });
  const harbors = island.locator(".board-map g[role='img'][aria-label*='harbor, trade']");
  await expect(harbors).toHaveCount(9);
  const labels = await harbors.evaluateAll(groups => groups.map(group => group.getAttribute("aria-label") ?? ""));
  const theme = ALL_THEMES.illustrated;
  const seenResources: Resource[] = [];
  let anyHarbors = 0;
  for (const [index, label] of labels.entries()) {
    const harbor = harbors.nth(index);
    const resource = (Object.keys(RESOURCE_NAMES) as Resource[]).find(name =>
      label === `${RESOURCE_NAMES[name].toLowerCase()} harbor, trade 2:1`,
    );
    if (resource) {
      seenResources.push(resource);
      const badge = harbor.locator("rect").last();
      await expect(badge, `${resource} badge uses its resource color`).toHaveAttribute("fill", theme.resources[resource]);
      await expect(harbor.locator("text"), "resource harbor shows the ratio and name texts").toHaveCount(2);
      await expect(harbor.getByText("2:1")).toBeVisible();
      await expect(harbor.getByText(RESOURCE_NAMES[resource].toUpperCase())).toBeVisible();
      const icon = harbor.locator("g[color]");
      await expect(icon, `${resource} icon is drawn in white`).toHaveAttribute("color", "#ffffff");
      expect(await icon.locator("path, circle, ellipse").count(), `${resource} icon has artwork`).toBeGreaterThan(0);
      expect(await harbor.evaluate(group => {
        const badge = group.querySelector("rect:last-of-type")!;
        const name = group.querySelectorAll("text")[1]!;
        const badgeBounds = badge.getBoundingClientRect();
        const nameBounds = name.getBoundingClientRect();
        return nameBounds.left >= badgeBounds.left && nameBounds.right <= badgeBounds.right;
      }), `${resource} name stays inside the badge`).toBe(true);
    } else {
      anyHarbors++;
      expect(label, "any harbor label").toBe("Any resource harbor, trade 3:1");
      await expect(harbor.locator("rect").last()).toHaveAttribute("fill", "#f7f0d9");
      await expect(harbor.getByText("3:1")).toBeVisible();
      await expect(harbor.getByText("ANY")).toBeVisible();
    }
  }
  expect(seenResources.sort()).toEqual([...(Object.keys(RESOURCE_NAMES) as Resource[])].sort());
  expect(anyHarbors).toBe(4);
  await screenshot(page, testInfo, "island-harbors", false);
});

for (const variant of ["original", "seafarers"] as const) {
  test(`${variant === "original" ? "Original" : "Seafarers"} harbor piers connect directly to the coastline`, async ({ page }, testInfo) => {
    await page.goto("/");
    await page.getByRole("combobox", { name: "Game version", exact: true }).selectOption(variant);
    await showHomeView(page, "Island");
    const island = page.getByRole("region", { name: "Island preview", exact: true });
    await expect(island.locator(".board-surface")).toHaveAttribute("data-variant", variant);
    const coastMidpoints = await island.locator('g[stroke="#b8a777"] > line').evaluateAll(lines => lines.map(element => {
      const line = element as SVGLineElement;
      return {
        x: (line.x1.baseVal.value + line.x2.baseVal.value) / 2,
        y: (line.y1.baseVal.value + line.y2.baseVal.value) / 2,
      };
    }));
    expect(coastMidpoints.length).toBeGreaterThan(0);
    const harbors = island.getByRole("img", { name: /harbor, trade/ });
    await expect(harbors).toHaveCount(9);
    const connections = await harbors.evaluateAll((groups, midpoints) => groups.map(group =>
      Array.from(group.querySelectorAll<SVGPathElement>(":scope > path"), path => {
        const start = path.getPointAtLength(0);
        return {
          coastGap: Math.min(...midpoints.map(midpoint => Math.hypot(start.x - midpoint.x, start.y - midpoint.y))),
          length: path.getTotalLength(),
        };
      }),
    ), coastMidpoints);
    for (const strokes of connections) {
      expect(strokes, "Both pier strokes reach the coast").toHaveLength(2);
      for (const stroke of strokes) {
        expect(stroke.coastGap, "Pier starts at the coastal-edge midpoint").toBeCloseTo(0, 4);
        expect(stroke.length, "Badge stays 51 units offshore").toBeCloseTo(51, 4);
      }
    }
    await noHorizontalOverflow(page);
    await screenshot(page, testInfo, `${variant}-harbor-connections`, false);
  });
}

test("theme dialog stays open while computers continue into a private human handoff", async ({ page, isMobile }, testInfo) => {
  await page.goto("/");
  if (isMobile) await page.setViewportSize({ width: 320, height: 844 });
  await page.clock.install({ time: new Date("2026-10-31T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-31T00:00:01Z"));
  await page.getByRole("button", { name: "4 players", exact: true }).click();
  await page.getByRole("combobox", { name: "Human players", exact: true }).selectOption("2");
  await seedGameRandomness(page, 4);
  await page.getByRole("button", { name: "Let's settle in", exact: true }).click();
  await expect(page.getByRole("status", { name: "Computer activity", exact: true })).toContainText("Computer 2");
  await page.getByRole("button", { name: "Change theme", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Choose your theme", exact: true });
  const originalDialog = await dialog.elementHandle();
  const selectedTheme = dialog.getByRole("radio", { name: "Space Frontier", exact: true });
  await selectedTheme.focus();
  await page.keyboard.press("Space");
  await expect(selectedTheme).toBeChecked();
  for (let move = 1; move <= 4; move++) {
    await page.clock.runFor(450);
    await expect(page.getByRole("img", { name: /'s settlement at /, includeHidden: true })).toHaveCount(Math.ceil(move / 2));
    await expect(page.getByRole("img", { name: /'s road at /, includeHidden: true })).toHaveCount(Math.floor(move / 2));
    await expect(dialog).toBeVisible();
    await expect(selectedTheme).toBeChecked();
    await expectBoardTheme(page, "space");
    await privateHandIsAbsent(page);
    expect(await originalDialog!.evaluate(element => element.isConnected)).toBe(true);
    if (move === 2) await expect(page.getByRole("status", { name: "Computer activity", exact: true, includeHidden: true })).toContainText("Computer 1");
  }
  await expect(page.getByRole("heading", { name: "Pass the device to Sam.", exact: true, includeHidden: true })).toHaveCount(1);
  await screenshot(page, testInfo, "theme-dialog-through-automatic-handoff", false);
  await dialog.getByRole("button", { name: "Close dialog", exact: true }).click();
  const themeButton = page.locator(".handoff-island .board-controls").getByRole("button", { name: "Change theme", exact: true });
  await expect(themeButton).toBeInViewport({ ratio: 1 });
  expect(await themeButton.evaluate(element => {
    let opacity = 1;
    for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) opacity *= Number.parseFloat(getComputedStyle(ancestor).opacity);
    return opacity;
  }), "Handoff artwork fades without dimming the interactive theme toolbar").toBe(1);
  await expect(page.locator(".handoff-island .board-viewport")).toHaveCSS("opacity", "0.45");
  await noPageOverflow(page);
  await screenshot(page, testInfo, "theme-handoff-toolbar", false);
  await themeButton.click();
  await expect(selectedTheme).toBeChecked();
  await page.keyboard.press("Escape");
  await expect(themeButton).toBeFocused();
  expect(await revealHand(page)).toBe("Sam");
  await expectBoardTheme(page, "space");
});

test("live board themes preserve human turn, pieces, selection, zoom and pan with keyboard dialog focus", async ({ page, isMobile }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  if (isMobile) await page.setViewportSize({ width: 320, height: 844 });
  const state = await prepareRollGame(page);
  const player = state.players.find(player => player.id === state.activePlayerId)!;
  await expectResourceBank(page, state.bank);
  await chooseDice(page, [3, 4]);
  await page.getByRole("button", { name: "Roll the dice", exact: true }).click();
  await showView(page, "board");
  const dismissCollection = page.getByRole("button", { name: "Dismiss resource collection", exact: true });
  if (await dismissCollection.isVisible()) await dismissCollection.click();
  const board = page.getByRole("region", { name: "Game board", exact: true });
  const viewport = board.locator(".board-viewport");
  const toolbar = board.locator(".board-controls");
  const themeButton = toolbar.getByRole("button", { name: "Change theme", exact: true });
  await boardFrame(page);
  await expect(toolbar.getByRole("button")).toHaveCount(3);
  for (const name of ["Change theme", "Zoom out", "Zoom in"]) {
    await expect(toolbar.getByRole("button", { name, exact: true })).toBeVisible();
  }
  for (const button of await toolbar.getByRole("button").all()) {
    await expect(button).toBeInViewport({ ratio: 1 });
    const bounds = (await button.boundingBox())!;
    expect(bounds.width).toBeGreaterThanOrEqual(44);
    expect(bounds.height).toBeGreaterThanOrEqual(44);
  }
  await screenshot(page, testInfo, "theme-toolbar", false);
  await expect(board.getByRole("img", { name: /'s settlement at / })).toHaveCount(6);
  await expect(board.getByRole("img", { name: /'s road at / })).toHaveCount(6);
  const target = board.getByRole("button", { name: /^Move robber to / }).first();
  await target.click();
  const confirmation = page.getByRole("group", { name: "Placement confirmation", exact: true });
  const selection = await confirmation.getAttribute("data-selection-id");
  for (let step = 0; step < 3; step++) await board.getByRole("button", { name: "Zoom in", exact: true }).click();
  await target.scrollIntoViewIfNeeded();
  await viewport.evaluate(element => element.scrollBy({ left: 17, top: 13 }));
  const position = await viewport.evaluate(element => ({ left: element.scrollLeft, top: element.scrollTop }));
  expect(position.left > 0 || position.top > 0).toBe(true);
  const geometry = await themeBoardGeometry(board);
  const frames = await board.locator(".board-surface, .board-viewport, .board-map").evaluateAll(elements => elements.map(element => {
    const { x, y, width, height } = element.getBoundingClientRect();
    return { x, y, width, height };
  }));
  const originalSurface = await board.locator(".board-surface").elementHandle();
  const originalMap = await board.locator(".board-map > svg").elementHandle();
  const bank = page.getByRole("region", { name: "Resource bank", exact: true });
  const bankLabels = await bank.getByRole("listitem").evaluateAll(elements => elements.map(element => element.getAttribute("aria-label")));
  const turn = await page.locator(".turn-header").textContent();
  const artwork = new Set<string>();
  const icons = new Set<string>();
  const palettes = new Set<string>();

  await themeButton.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Choose your theme", exact: true });
  const close = dialog.getByRole("button", { name: "Close dialog", exact: true });
  await expect(close).toBeFocused();
  const choices = dialog.getByRole("group", { name: "Board theme", exact: true });
  await expect(choices.locator('input[type="radio"]')).toHaveCount(6);
  await page.keyboard.press("Tab");
  await expect(choices.getByRole("radio", { name: "Illustrated Island", exact: true })).toBeFocused();
  for (const theme of [...BOARD_THEMES.slice(1), BOARD_THEMES[0]]) {
    await page.keyboard.press("ArrowRight");
    const radio = choices.getByRole("radio", { name: theme.name, exact: true });
    await expect(radio).toBeChecked();
    await expect(radio).toBeFocused();
    await expect(dialog).toBeVisible();
    await expect(dialog).toBeInViewport({ ratio: 1 });
    await expect(radio).toBeInViewport({ ratio: 1 });
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await expectBoardTheme(page, theme.id);
    await expect.poll(() => page.evaluate(() => localStorage.getItem("catania.boardTheme"))).toBe(theme.id);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(themeButton).toBeFocused();
    await expect(target).toHaveAttribute("aria-pressed", "true");
    await expect(confirmation).toHaveAttribute("data-selection-id", selection!);
    await expect(confirmation).toBeVisible();
    await expect(board.getByRole("status", { name: "Zoom level", exact: true })).toHaveText("175%");
    expect(await viewport.evaluate(element => ({ left: element.scrollLeft, top: element.scrollTop }))).toEqual(position);
    expect(await themeBoardGeometry(board)).toEqual(geometry);
    expect(await board.locator(".board-surface, .board-viewport, .board-map").evaluateAll(elements => elements.map(element => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    }))).toEqual(frames);
    expect(await originalSurface!.evaluate(element => element === document.querySelector(".board-surface"))).toBe(true);
    expect(await originalMap!.evaluate(element => element === document.querySelector(".board-map > svg"))).toBe(true);
    expect(await bank.getByRole("listitem").evaluateAll(elements => elements.map(element => element.getAttribute("aria-label")))).toEqual(bankLabels);
    expect(await page.locator(".turn-header").textContent()).toBe(turn);
    await expectResourceBank(page, state.bank);
    const bankIcons = bank.locator(".bank-card svg[data-theme]");
    await expect(bankIcons).toHaveCount(5);
    for (const icon of await bankIcons.all()) await expect(icon).toHaveAttribute("data-theme", theme.id);
    artwork.add(await themeTerrainArtwork(board));
    icons.add(await bankIcons.first().innerHTML());
    const bankPalette = await bank.locator(".bank-card").evaluateAll(elements => elements.map(element => getComputedStyle(element).backgroundColor));
    palettes.add(JSON.stringify(bankPalette));
    await showView(page, "hand");
    const hand = page.getByRole("region", { name: "Private resources", exact: true });
    await expect(page.getByRole("heading", { name: `${player.name}'s hand`, exact: true })).toBeVisible();
    for (const resource of RESOURCES) await expect(hand.getByTitle(`${player.resources[resource]} ${RESOURCE_NAMES[resource]}`, { exact: true })).toBeVisible();
    const handCards = hand.locator(".hand-resource-card");
    await expect(handCards).toHaveCount(5);
    for (const icon of await handCards.locator("svg").all()) await expect(icon).toHaveAttribute("data-theme", theme.id);
    expect(await handCards.evaluateAll(elements => elements.map(element => getComputedStyle(element).backgroundColor))).toEqual(bankPalette);
    await screenshot(page, testInfo, `theme-${theme.id}-resource-cards`, false);
    await showView(page, "board");
    await noPageOverflow(page);
    await themeButton.click();
    await expect(close).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(radio).toBeFocused();
  }
  expect(artwork.size, "Each theme has distinct board artwork").toBe(6);
  expect(icons.size, "Each theme has distinct resource artwork").toBe(6);
  expect(palettes.size, "Each theme has a distinct resource palette").toBe(6);
  await screenshot(page, testInfo, "theme-dialog", false);
  await close.click();
  await expect(dialog).toHaveCount(0);
  await expect(themeButton).toBeFocused();
  await expect(target).toHaveAttribute("aria-pressed", "true");
  await screenshot(page, testInfo, "theme-preserved-selection-and-zoom", false);
});

for (const shuffleCount of [0, 2]) {
  test(`starting uses the selected island after ${shuffleCount} shuffles`, async ({ page }, testInfo) => {
    await page.goto("/");
    await page.getByRole("combobox", { name: "Human players", exact: true }).selectOption("3");
    await showHomeView(page, "Island");
    const preview = page.getByRole("region", { name: "Island preview", exact: true });
    const islandLayout = (context: Locator) => context.locator('svg g[role="img"]').evaluateAll(elements =>
      elements.map(element => ({
        label: element.getAttribute("aria-label"),
        points: element.querySelector("polygon")?.getAttribute("points") ?? null,
        path: element.querySelector("path")?.getAttribute("d") ?? null,
        transform: element.getAttribute("transform"),
      })),
    );
    await expect(preview.locator('svg g[role="img"]')).toHaveCount(29);
    let selectedIsland = await islandLayout(preview);
    for (let shuffle = 0; shuffle < shuffleCount; shuffle++) {
      await seedRandomness(page, shuffle + 1);
      await preview.getByRole("button", { name: "Shuffle island preview", exact: true }).click();
      await expect.poll(() => islandLayout(preview)).not.toEqual(selectedIsland);
      selectedIsland = await islandLayout(preview);
    }
    await screenshot(page, testInfo, "selected-island");
    await showHomeView(page, "Setup");
    await page.getByRole("button", { name: "Let's settle in", exact: true }).click();
    await expect.poll(() => islandLayout(page.locator(".handoff-island"))).toEqual(selectedIsland);
    await revealHand(page);
    await showView(page, "board");
    const board = page.getByRole("region", { name: "Game board", exact: true });
    await expect.poll(() => islandLayout(board)).toEqual(selectedIsland);
    await expect(board.getByRole("img", { name: "Robber on desert; production blocked", exact: true })).toBeVisible();
    await noPageOverflow(page);
    await screenshot(page, testInfo, "started-island", false);
  });
}

test("profile avatar and cards follow renaming, creation and switching", async ({ page }, testInfo) => {
  await page.goto("/");
  const menuButton = page.getByRole("button", { name: "Menu", exact: true });
  await expect(menuButton.locator(".profile-avatar")).toHaveText("A");
  await expect(menuButton).toHaveAttribute("title", "Alex");
  await expect(menuButton).toHaveText("A");
  const triggerBounds = (await menuButton.boundingBox())!;
  expect(triggerBounds.width).toBeGreaterThanOrEqual(44);
  expect(triggerBounds.height).toBeGreaterThanOrEqual(44);
  await menuButton.click();
  await page.getByRole("button", { name: "Profile", exact: true }).click();
  const profiles = page.getByRole("list", { name: "Your player profile", exact: true });
  const current = page.getByRole("button", { name: "Continue as Alex", exact: true });
  const currentCard = profiles.getByRole("listitem").filter({ has: current });
  await expect(currentCard).toContainText("Current profile");
  await expect(currentCard.locator(".grid > span")).toHaveText(["0Games", "0Wins", "0Total points"]);
  await expect(page.getByRole("button", { name: "Keep current profile", exact: true })).toHaveCount(0);
  const nameBounds = (await currentCard.locator("strong").boundingBox())!;
  const renameBounds = (await currentCard.getByRole("button", { name: "Rename Alex", exact: true }).boundingBox())!;
  expect(renameBounds.x - nameBounds.x - nameBounds.width).toBeLessThanOrEqual(8);
  expect(Math.abs(renameBounds.y + renameBounds.height / 2 - nameBounds.y - nameBounds.height / 2)).toBeLessThan(2);
  await expect(page.getByRole("form", { name: "Create a profile", exact: true }).getByLabel("Profile name")).toHaveAttribute("aria-invalid", "false");
  await noHorizontalOverflow(page);
  await screenshot(page, testInfo, "profile-cards");

  await page.getByRole("button", { name: "Rename Alex", exact: true }).click();
  const renameForm = profiles.locator("form");
  const renameInput = renameForm.getByLabel("Profile name", { exact: true });
  await expect(renameInput).toBeFocused();
  await renameInput.fill(" ");
  await expect(renameForm.getByRole("alert")).toHaveText("Use 1 to 20 characters, without control characters.");
  await expect(renameForm.getByRole("button", { name: "Save name", exact: true })).toBeDisabled();
  await renameForm.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(current).toBeVisible();
  await page.getByRole("button", { name: "Rename Alex", exact: true }).click();
  await renameInput.fill("Harbor Master Taylor");
  await page.setViewportSize({ width: 320, height: 568 });
  await noHorizontalOverflow(page);
  for (const control of await renameForm.locator("input, button").all()) {
    const bounds = (await control.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
    expect(bounds.height).toBeGreaterThanOrEqual(44);
  }
  await screenshot(page, testInfo, "profile-rename-narrow");
  await renameForm.getByRole("button", { name: "Save name", exact: true }).click();
  await profiles.getByRole("button", { name: "Continue as Harbor Master Taylor", exact: true }).click();
  await expect(menuButton.locator(".profile-avatar")).toHaveText("H");
  await expect(page.getByRole("textbox", { name: "Player 1 name", exact: true })).toHaveValue("Harbor Master Taylor");

  await menuButton.click();
  await page.getByRole("button", { name: "Profile", exact: true }).click();
  const creation = page.getByRole("form", { name: "Create a profile", exact: true });
  await creation.getByLabel("Profile name", { exact: true }).fill("harbor master taylor");
  await expect(creation).toContainText("That name is already in use. Choose another name.");
  await expect(creation.getByRole("button", { name: "Create and continue", exact: true })).toBeDisabled();
  await creation.getByLabel("Profile name", { exact: true }).fill("Sam");
  await creation.getByRole("button", { name: "Create and continue", exact: true }).click();
  await expect(menuButton.locator(".profile-avatar")).toHaveText("S");
  await menuButton.click();
  await page.getByRole("button", { name: "Profile", exact: true }).click();
  await expect(profiles.getByRole("listitem").filter({ has: page.getByRole("button", { name: "Continue as Sam", exact: true }) })).toContainText("Current profile");
  await expect(profiles.getByRole("listitem").filter({ has: page.getByRole("button", { name: "Continue as Harbor Master Taylor", exact: true }) })).not.toContainText("Current profile");
  await screenshot(page, testInfo, "profile-switch-narrow");
  await profiles.getByRole("button", { name: "Continue as Harbor Master Taylor", exact: true }).click();
  await expect(menuButton.locator(".profile-avatar")).toHaveText("H");
  const saved = await page.evaluate(() => ({
    profiles: JSON.parse(localStorage.getItem("catania.profiles")!),
    activeId: localStorage.getItem("catania.profile.active"),
  }));
  expect(saved.activeId).toBe("profile-1");
  expect(saved.profiles.map((profile: { name: string }) => profile.name)).toEqual(["Harbor Master Taylor", "Sam"]);
});

test("fresh profile creation has neutral guidance and persists on reload", async ({ browser, baseURL, viewport, isMobile, hasTouch }, testInfo) => {
  const context = await browser.newContext({ baseURL, viewport, isMobile, hasTouch, locale: "en-US" });
  try {
    const page = await context.newPage();
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Your player profile", exact: true })).toBeVisible();
    await expect(page.getByRole("list")).toHaveCount(0);
    const input = page.getByLabel("Profile name", { exact: true });
    await expect(input).toHaveAttribute("aria-invalid", "false");
    await expect(page.locator("#profile-name-help")).toHaveText("Choose a name to use at the table.");
    await expect(page.getByRole("button", { name: "Create and continue", exact: true })).toBeDisabled();
    await noHorizontalOverflow(page);
    await screenshot(page, testInfo, "profile-first-visit");
    await input.focus();
    await input.blur();
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await input.fill("Élodie");
    await expect(input).toHaveAttribute("aria-invalid", "false");
    await page.getByRole("button", { name: "Create and continue", exact: true }).click();
    await expect(page.getByRole("button", { name: "Menu", exact: true }).locator(".profile-avatar")).toHaveText("É");
    await page.evaluate(() => {
      const profiles: { games: number; wins: number; totalPoints: number }[] = JSON.parse(localStorage.getItem("catania.profiles")!);
      profiles[0]!.games = 12;
      profiles[0]!.wins = 3;
      profiles[0]!.totalPoints = 87;
      localStorage.setItem("catania.profiles", JSON.stringify(profiles));
    });
    await page.reload();
    await expect(page.getByRole("button", { name: "Menu", exact: true }).locator(".profile-avatar")).toHaveText("É");
    await expect(page.getByRole("textbox", { name: "Player 1 name", exact: true })).toHaveValue("Élodie");
    await page.getByRole("button", { name: "Menu", exact: true }).click();
    await page.getByRole("button", { name: "Profile", exact: true }).click();
    await expect(page.getByRole("listitem").filter({ has: page.getByRole("button", { name: "Continue as Élodie", exact: true }) }).locator(".grid > span"))
      .toHaveText(["12Games", "3Wins", "87Total points"]);
  } finally {
    await context.close();
  }
});

test("table names, player counts, keyboard Help and private start", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "A little island. Endless possibility." })).toBeVisible();
  const logoPaths = page.getByRole("banner").locator("svg").first().locator("path");
  await expect(logoPaths.nth(0)).toHaveCSS("fill", "rgb(176, 205, 193)");
  await expect(logoPaths.nth(1)).toHaveCSS("fill", "rgb(37, 59, 54)");
  await expect(logoPaths.nth(2)).toHaveCSS("fill", "rgb(176, 205, 193)");
  await expect(page.getByRole("combobox", { name: "Human players", exact: true })).toHaveValue("1");
  await expect(page.getByRole("textbox", { name: /^Player \d+ name$/ })).toHaveCount(1);
  await page.getByRole("combobox", { name: "Human players", exact: true }).selectOption("3");
  await expect(page.getByRole("textbox", { name: /^Player \d+ name$/ })).toHaveCount(3);
  await expect(page.getByRole("button", { name: "3 players", exact: true })).toHaveAttribute("aria-pressed", "true");
  await noPageOverflow(page);
  await screenshot(page, testInfo, "home", false);

  const menuButton = page.getByRole("button", { name: "Menu", exact: true });
  await menuButton.focus();
  await page.keyboard.press("Enter");
  const helpButton = page.getByRole("button", { name: "Help", exact: true });
  await helpButton.focus();
  await page.keyboard.press("Enter");
  const help = page.getByRole("dialog", { name: "Help", exact: true });
  await expect(help).toBeVisible();
  await expect(help).toContainText("Ten victory points.");
  await expect(help).toContainText("then again in reverse");
  await expect(help.getByRole("button", { name: "Close dialog" })).toBeFocused();
  await screenshot(page, testInfo, "help");
  await page.keyboard.press("Escape");
  await expect(help).toHaveCount(0);
  // Closing the dialog returns focus to the Menu trigger, not the hidden menu item.
  await expect(menuButton).toBeFocused();

  await page.getByRole("textbox", { name: "Player 2 name", exact: true }).fill("Alex");
  await page.getByRole("button", { name: "Let's settle in", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Use a different name for each player so private handoffs are clear.");
  await expect(page.getByRole("region", { name: "Set up your table" })).toBeVisible();
  await page.getByRole("button", { name: "4 players", exact: true }).click();
  await page.getByRole("combobox", { name: "Human players", exact: true }).selectOption("4");
  await expect(page.getByRole("textbox", { name: /^Player \d+ name$/ })).toHaveCount(4);
  const names = ["Nora", "Jules", "Taylor", "Casey"];
  for (const [index, name] of names.entries()) await page.getByRole("textbox", { name: `Player ${index + 1} name`, exact: true }).fill(` ${name} `);
  for (const [index, name] of names.entries()) await expect(page.locator(".player-number").nth(index)).toHaveText(name[0]!.toUpperCase());
  await page.getByRole("button", { name: "3 players", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Player 4 name" })).toHaveCount(0);
  await page.getByRole("button", { name: "4 players", exact: true }).click();
  await page.getByRole("combobox", { name: "Human players", exact: true }).selectOption("4");
  await expect(page.getByRole("textbox", { name: "Player 4 name" })).toHaveValue(" Casey ");
  await page.getByRole("button", { name: "Let's settle in", exact: true }).click();
  await privateHandIsAbsent(page);
  await expect(page.getByRole("button", { name: /^Place settlement at/, includeHidden: true })).toHaveCount(0);
  await screenshot(page, testInfo, "private-handoff");
  await chooseGameOption(page, "End game");
  await page.getByRole("dialog", { name: "Leave this island?", exact: true }).getByRole("button", { name: "Keep playing", exact: true }).click();
  await privateHandIsAbsent(page);
  await expect(page.getByRole("button", { name: "Game", exact: true })).toBeFocused();
  expect(names).toContain(await revealHand(page));
  await chooseGameOption(page, "Help");
  await expect(help.getByRole("heading", { name: "Current table", exact: true })).toHaveCount(0);
  await expect(help.getByText("Standard island / 4 settlers", { exact: true })).toHaveCount(0);
  await help.getByRole("button", { name: "Close dialog", exact: true }).click();
  await showView(page, "hand");
  await expect(page.getByRole("region", { name: "Private resources" })).toContainText("0 cards");
  await noHorizontalOverflow(page);
});

test("Help shows starting card counts and rules without current table details before or during play", async ({ page }, testInfo) => {
  const browserErrors: string[] = [];
  page.on("pageerror", error => browserErrors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("requestfailed", request => browserErrors.push(`${request.url()}: ${request.failure()?.errorText}`));
  await page.goto("/");
  const help = page.getByRole("dialog", { name: "Help", exact: true });
  const close = help.getByRole("button", { name: "Close dialog", exact: true });
  for (const stage of ["before-play", "empty-hand"] as const) {
    if (stage === "before-play") {
      await page.getByRole("button", { name: "Menu", exact: true }).click();
      await page.getByRole("button", { name: "Help", exact: true }).click();
    } else {
      await page.getByRole("combobox", { name: "Human players", exact: true }).selectOption("3");
      await page.getByRole("button", { name: "Let's settle in", exact: true }).click();
      await chooseGameOption(page, "Help");
      await privateHandIsAbsent(page);
      await expect(help.getByRole("region", { name: "Current table", exact: true })).toHaveCount(0);
      await expect(help.locator(".player-seat")).toHaveCount(0);
      await close.click();
      await privateHandIsAbsent(page);
      await revealHand(page);
      await expect(page.getByRole("region", { name: "Your development cards", includeHidden: true })).toHaveCount(0);
      await chooseGameOption(page, "Help");
    }

    await expect(help).toBeVisible();
    await expect(help.getByRole("region")).toHaveCount(4);
    await expect(help.getByRole("heading", { name: "Current table", exact: true })).toHaveCount(0);
    await expect(help.getByRole("list", { name: "Public activity", exact: true })).toHaveCount(0);
    await expect(help.getByRole("region", { name: "How to play", exact: true })).toContainText("then again in reverse");
    await expect(help).toContainText("request build resources once per turn, wait up to 15 seconds for prices");
    const builds = help.getByRole("list", { name: "Available builds and purchases", exact: true });
    await expect(builds.getByRole("listitem")).toHaveCount(4);
    for (const [piece, name] of [["road", "Road"], ["settlement", "Settlement"], ["city", "City"], ["development", "Development card"]] as const) {
      const build = builds.getByRole("listitem").filter({ has: page.getByRole("heading", { name, exact: true }) });
      await build.evaluate(element => element.scrollIntoView({ block: "center" }));
      await expect(build).toBeInViewport({ ratio: 1 });
      await expect(build.locator(".sr-only")).toHaveText(RESOURCES.filter(resource => COSTS[piece][resource] > 0)
        .map(resource => `${COSTS[piece][resource]} ${RESOURCE_NAMES[resource]}`));
      await expect(build.locator("p")).not.toBeEmpty();
    }
    if (stage === "before-play") await screenshot(page, testInfo, "help-build-costs", false);

    const cards = help.getByRole("list", { name: "All development cards", exact: true });
    await expect(cards.getByRole("listitem")).toHaveCount(5);
    await expect(cards.getByRole("heading")).toHaveText(["Knight", "Victory point", "Road building", "Year of plenty", "Monopoly"]);
    for (const [kind, count, description] of [
      ["knight", 14, "Move the robber and steal one random resource"],
      ["victory-point", 5, "One hidden victory point. Counted automatically"],
      ["road-building", 2, "Place two roads for free"],
      ["year-of-plenty", 2, "Choose two resources from the bank"],
      ["monopoly", 2, "Every other player gives you all of that resource"],
    ] as const) {
      const card = cards.getByRole("listitem").filter({ has: page.locator(`[data-development-kind="${kind}"]`) });
      await card.evaluate(element => element.scrollIntoView({ block: "center" }));
      await expect(card).toBeInViewport({ ratio: 1 });
      await expect(card).toContainText(description);
      await expect(card.getByText(`${count} in starting deck`, { exact: true })).toBeVisible();
    }
    await expect(cards.getByRole("button")).toHaveCount(0);
    await expect(help.getByRole("region", { name: "Development cards", exact: true })).toContainText("never on the turn you bought it");
    if (stage === "before-play") {
      await help.getByRole("heading", { name: "Development cards", exact: true }).scrollIntoViewIfNeeded();
      await screenshot(page, testInfo, "help-development-cards", false);
    }

    const rules = help.getByRole("region", { name: "Game rules", exact: true });
    for (const rule of ["Resources and production.", "Seven and the robber.", "Trading and ports.", "Points and victory.", "Longest Road and Largest Army.", "refreshing or closing it ends the game."]) {
      await expect(rules).toContainText(rule);
    }
    await rules.getByText("One device, a whole table.", { exact: true }).scrollIntoViewIfNeeded();
    expect(await help.evaluate(element => element.scrollTop > 0 && element.scrollHeight > element.clientHeight)).toBe(true);
    expect(await help.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await expect(close).toBeInViewport({ ratio: 1 });
    await noHorizontalOverflow(page);
    if (stage === "empty-hand") await noPageOverflow(page);
    if (stage === "before-play") await screenshot(page, testInfo, "help-game-rules", false);
    await close.click();
    await expect(help).toHaveCount(0);
  }
  expect(browserErrors).toEqual([]);
});

test("three-player snake setup, real dice turn and private handoffs", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.getByRole("combobox", { name: "Human players", exact: true }).selectOption("3");
  await page.getByRole("button", { name: "Let's settle in", exact: true }).click();
  const setupPlayers: string[] = [];
  let currentPlayer = "";

  for (let placement = 0; placement < 6; placement++) {
    if (placement !== 3) currentPlayer = await revealHand(page);
    setupPlayers.push(currentPlayer);
    await showView(page, "board");
    const settlement = page.getByRole("button", { name: /^Place settlement at/ }).first();
    const settlementName = (await settlement.getAttribute("aria-label"))!.replace("Place settlement at ", "");
    await settlement.click();
    await expect(settlement).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("img", { name: /'s settlement at / })).toHaveCount(placement);
    if (placement === 0) {
      const confirmation = await expectPlacementConfirmation(page, settlement, settlementName);
      await expect(confirmation.locator(".placement-confirmation-player")).toHaveText(currentPlayer);
      await expect(confirmation.getByRole("button", { name: "Confirm placement", exact: true })).toBeFocused();
      await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(page.getByRole("button", { name: "Confirm placement" })).toHaveCount(0);
      await expect(settlement).toHaveAttribute("aria-pressed", "false");
      await expect(settlement).toBeFocused();
      await page.keyboard.press("Enter");
      await expectPlacementConfirmation(page, settlement, settlementName);
      await expect(confirmation.getByRole("button", { name: "Confirm placement", exact: true })).toBeFocused();
      await expect(page.getByRole("img", { name: /'s settlement at / })).toHaveCount(0);
      await screenshot(page, testInfo, "settlement-preview");
      await page.keyboard.press("Enter");
      await expect(page.getByRole("region", { name: /^Island map\./ })).toBeFocused();
    } else {
      await page.getByRole("button", { name: "Confirm placement", exact: true }).click();
    }
    await expect(page.getByRole("img", { name: `${currentPlayer}'s settlement at ${settlementName}`, exact: true })).toBeVisible();
    await expect(page.getByRole("img", { name: /'s settlement at / })).toHaveCount(placement + 1);

    const road = page.getByRole("button", { name: /^Build road at/ }).first();
    const roadName = (await road.getAttribute("aria-label"))!.replace("Build road at ", "");
    await road.click();
    await expect(road).toHaveAttribute("aria-pressed", "true");
    if (placement === 0) {
      await expectPlacementConfirmation(page, road, roadName);
      await expect(page.getByRole("img", { name: /'s road at / })).toHaveCount(0);
      await screenshot(page, testInfo, "road-placement-confirmation", false);
    }
    await page.getByRole("button", { name: "Confirm placement", exact: true }).click();
    await expect(page.getByRole("img", { name: `${currentPlayer}'s road at ${roadName}`, exact: true, includeHidden: true })).toHaveCount(1);
    await expect(page.getByRole("img", { name: /'s road at /, includeHidden: true })).toHaveCount(placement + 1);
    await expect(page.getByRole("alert")).toHaveCount(0);
  }

  const firstRound = setupPlayers.slice(0, 3);
  expect(new Set(firstRound).size).toBe(3);
  expect(setupPlayers).toEqual([...firstRound, ...firstRound.toReversed()]);
  await showView(page, "board");
  for (const name of firstRound) {
    await expect(page.getByRole("img", { name: new RegExp(`^${name}'s settlement at `) })).toHaveCount(2);
    await expect(page.getByRole("img", { name: new RegExp(`^${name}'s road at `) })).toHaveCount(2);
  }
  await noHorizontalOverflow(page);
  await screenshot(page, testInfo, "completed-setup-board");
  await showView(page, "hand");
  await expect(page.getByRole("img", { name: "0 victory point cards", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Private resources" })).not.toContainText("public +");
  const development = page.getByRole("region", { name: "Your development cards", exact: true });
  await expect(development).toHaveCount(0);
  await revealBuildSection(page);
  await expect(page.getByRole("button", { name: "Make a trade", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Roll the dice", exact: true }).click();
  const diceLabel = await page.getByRole("img", { name: /^Dice: / }).getAttribute("aria-label");
  const dice = diceLabel!.match(/\d/g)!.map(Number);
  expect(dice).toHaveLength(2);
  for (const die of dice) expect(die).toBeGreaterThanOrEqual(1);
  for (const die of dice) expect(die).toBeLessThanOrEqual(6);
  await testInfo.attach("first-roll", { body: JSON.stringify({ dice, total: dice[0]! + dice[1]! }), contentType: "application/json" });

  if (dice[0]! + dice[1]! === 7) {
    // Starting hands have at most three cards, so a first-turn seven cannot require discards.
    await expect(page.getByRole("button", { name: "Confirm discard", includeHidden: true })).toHaveCount(0);
    await showView(page, "board");
    await expect(page.getByRole("button", { name: /^Move robber to / })).toHaveCount(18);
    await screenshot(page, testInfo, "robber-seven");
    await page.getByRole("button", { name: /^Move robber to / }).first().click();
    await page.getByRole("button", { name: "Confirm placement", exact: true }).click();
    await showView(page, "hand");
    const victims = page.locator("section").filter({ has: page.getByRole("heading", { name: "Choose a player to steal from", exact: true }) });
    if (await victims.count()) {
      await victims.getByRole("button").first().click();
      await page.getByRole("dialog", { name: "Confirm theft" }).getByRole("button", { name: "Confirm", exact: true }).click();
    }
  }
  await expect(page.getByRole("button", { name: "End turn & pass device", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Roll the dice", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Roll the dice", exact: true })).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole("button", { name: "Make a trade", exact: true })).toBeEnabled();
  await noHorizontalOverflow(page);
  await screenshot(page, testInfo, "first-turn-hand");
  await page.getByRole("button", { name: "Make a trade", exact: true }).click();
  const trade = page.getByRole("dialog", { name: "A fair exchange", exact: true });
  await expect(trade.getByRole("button", { name: "Bank & ports", exact: true })).toHaveAttribute("aria-pressed", "true");
  // A starting hand cannot fund every 4:1 exchange, so at least one give card stays dimmed.
  expect(await trade.getByRole("button", { name: /^Give / }).and(page.locator(":disabled")).count()).toBeGreaterThan(0);
  await expect(trade.getByRole("button", { name: "Give Wood", exact: true })).toHaveAttribute("aria-pressed", "true");
  const receiveWood = trade.getByRole("button", { name: "Receive Wood", exact: true });
  await receiveWood.click();
  await expect(receiveWood).toHaveAttribute("aria-pressed", "true");
  // Give and receive now name the same resource, so the exchange cannot be confirmed.
  await expect(trade.getByRole("button", { name: "Confirm exchange", exact: true })).toBeDisabled();
  await screenshot(page, testInfo, "bank-trade-cards");
  await trade.getByRole("button", { name: "Player trade", exact: true }).click();
  await trade.getByRole("button", { name: "Exact offer", exact: true }).click();
  const submitOffer = trade.getByRole("button", { name: "Put the offer on the table", exact: true });
  await expect(submitOffer).toBeDisabled();
  const offerAddition = trade.getByRole("group", { name: "You offer", exact: true }).getByRole("button", { name: /^Add / }).and(page.locator(":enabled")).first();
  const offeredResource = (await offerAddition.getAttribute("aria-label"))!.replace(/^Add /, "").replace(/ to You offer$/, "");
  await offerAddition.click();
  await expect(submitOffer).toBeDisabled();
  const requestedResource = offeredResource === "Wood" ? "Brick" : "Wood";
  await trade.getByRole("button", { name: `Add ${requestedResource} to You ask for`, exact: true }).click();
  await expect(submitOffer).toBeEnabled();
  await screenshot(page, testInfo, "trade-preview");
  await submitOffer.click();
  await expect(page.getByRole("region", { name: "Open trade", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Withdraw offer", exact: true }).click();
  await expect(page.getByRole("region", { name: "Open trade", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "End turn & pass device", exact: true }).click();
  await privateHandIsAbsent(page);
  await expect(page.getByRole("heading", { name: `Pass the device to ${firstRound[1]}.`, exact: true })).toBeVisible();
  await screenshot(page, testInfo, "turn-handoff");
  expect(await revealHand(page)).toBe(firstRound[1]);
  await expect(page.getByText("Turn 2", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Turn controls", exact: true }).getByRole("heading", { name: `${firstRound[1]} - Your turn`, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Roll the dice", exact: true })).toBeEnabled();

  await chooseGameOption(page, "Pass device");
  await page.getByRole("dialog", { name: "Pass the device", exact: true }).getByRole("button", { name: firstRound[2]!, exact: true }).click();
  expect(await revealHand(page)).toBe(firstRound[2]);
  await showView(page, "hand");
  await expect(page.getByRole("region", { name: "Turn controls", exact: true }).getByRole("heading", { name: `${firstRound[1]} - Their turn`, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Roll the dice", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Make a trade", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: `Return to ${firstRound[1]}`, exact: true }).click();
  expect(await revealHand(page)).toBe(firstRound[1]);

  await chooseGameOption(page, "End game");
  const confirmation = page.getByRole("dialog", { name: "Leave this island?", exact: true });
  await expect(confirmation).toContainText("progress are not saved");
  await confirmation.getByRole("button", { name: "Keep playing", exact: true }).click();
  await expect(confirmation).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Roll the dice", exact: true })).toBeEnabled();
  await chooseGameOption(page, "End game");
  await confirmation.getByRole("button", { name: "End game", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Make room at the table.", exact: true })).toBeVisible();
  await privateHandIsAbsent(page);
});

for (const variant of ["original", "seafarers"] as const) {
  test(`Reset game restores the ${variant} island and original private setup`, async ({ page }, testInfo) => {
    await page.goto("/");
    await page.getByRole("combobox", { name: "Game version", exact: true }).selectOption(variant);
    await page.getByRole("combobox", { name: "Human players", exact: true }).selectOption("3");
    await page.getByRole("button", { name: "Let's settle in", exact: true }).click();
    const firstPlayer = await revealHand(page);
    await showView(page, "board");
    const board = page.getByRole("region", { name: "Game board", exact: true });
    const initialGeometry = await themeBoardGeometry(board);
    const profiles = await page.evaluate(() => localStorage.getItem("catania.profiles"));
    await page.getByRole("button", { name: /^Place settlement at/ }).first().click();
    await page.getByRole("button", { name: "Confirm placement", exact: true }).click();
    await page.getByRole("button", { name: /^Build road at/ }).first().click();
    await chooseGameOption(page, "Reset game");
    const confirmation = page.getByRole("dialog", { name: "Reset this game?", exact: true });
    await expect(confirmation).toContainText("All current progress will be lost.");
    await expect(confirmation).toBeInViewport({ ratio: 1 });
    await confirmation.getByRole("button", { name: "Keep playing", exact: true }).click();
    await expect(page.getByRole("button", { name: "Game", exact: true })).toBeFocused();
    await expect(board.getByRole("img", { name: /'s settlement at / })).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Confirm placement", exact: true })).toBeVisible();
    await chooseGameOption(page, "Reset game");
    await screenshot(page, testInfo, `reset-${variant}-confirmation`, false);
    await confirmation.getByRole("button", { name: "Reset game", exact: true }).click();
    await expect(confirmation).toHaveCount(0);
    await privateHandIsAbsent(page);
    expect(await revealHand(page)).toBe(firstPlayer);
    await showView(page, "board");
    expect(await themeBoardGeometry(board)).toEqual(initialGeometry);
    await expect(board.getByRole("img", { name: /'s (settlement|road|ship) at / })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Confirm placement", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Place settlement at/ }).first()).toBeVisible();
    await expectResourceBank(page, { wood: 19, brick: 19, wool: 19, grain: 19, ore: 19 });
    await showView(page, "hand");
    await expect(page.getByRole("region", { name: "Private resources", exact: true }).locator(".resource-count")).toHaveText(["0", "0", "0", "0", "0"]);
    await expect(page.getByRole("region", { name: "Dice tray", exact: true })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("catania.profiles"))).toBe(profiles);
    await chooseGameOption(page, "Reset game");
    await page.keyboard.press("Escape");
    await expect(confirmation).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Game", exact: true })).toBeFocused();
    await noPageOverflow(page);
  });
}

test("Reset game during a roll discards the old roll timer and restores empty hands", async ({ page }) => {
  const state = await prepareRollGame(page);
  await page.clock.install({ time: new Date("2030-01-01T00:00:00Z") });
  await page.clock.pauseAt(new Date("2030-01-01T00:00:01Z"));
  await page.getByRole("button", { name: "Roll the dice", exact: true }).click();
  await expect(page.getByRole("region", { name: "Roll result", exact: true })).toHaveAttribute("data-stage", "rolling");
  await chooseGameOption(page, "Reset game");
  await page.clock.fastForward(5_000);
  await expect(page.getByRole("region", { name: "Roll result", exact: true })).toHaveAttribute("data-stage", "rolling");
  await page.getByRole("dialog", { name: "Reset this game?", exact: true }).getByRole("button", { name: "Reset game", exact: true }).click();
  await page.clock.fastForward(5_000);
  expect(await revealHand(page)).toBe(state.players[0]!.name);
  await expect(page.getByRole("region", { name: "Dice tray", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Roll result", exact: true })).toHaveCount(0);
  await expect(page.getByRole("img", { name: /'s (settlement|road) at /, includeHidden: true })).toHaveCount(0);
  await expectResourceBank(page, { wood: 19, brick: 19, wool: 19, grain: 19, ore: 19 });
  await showView(page, "hand");
  await expect(page.getByRole("region", { name: "Private resources", exact: true }).locator(".resource-count")).toHaveText(["0", "0", "0", "0", "0"]);
});

test("Game menu keeps secondary actions accessible without a toolbar", async ({ page, isMobile }, testInfo) => {
  await page.goto("/");
  await page.getByRole("combobox", { name: "Human players", exact: true }).selectOption("3");
  await page.getByRole("button", { name: "Let's settle in", exact: true }).click();
  await revealHand(page);
  const viewports = isMobile ? [{ width: 320, height: 844 }, { width: 390, height: 667 }] : [{ width: 1280, height: 720 }, { width: 1280, height: 480 }];
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await showView(page, "board");
    const initialFrame = await boardFrame(page);
    const artifact = `${viewport.width}x${viewport.height}`;
    await expect(page.getByText("Your island, taking shape", { exact: true })).toHaveCount(0);
    await expect(page.locator(".table-toolbar")).toHaveCount(0);
    const gameButton = page.getByRole("button", { name: "Game", exact: true });
    const menu = page.getByRole("group", { name: "Game menu", exact: true });
    await gameButton.scrollIntoViewIfNeeded();
    await expect(page.locator(".turn-header").getByRole("button", { name: "Game", exact: true })).toBeVisible();
    await expect(page.getByRole("banner").getByRole("button", { name: "Game", exact: true })).toHaveCount(0);
    await expect(gameButton).toBeInViewport({ ratio: 1 });
    await expect(gameButton).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("button", { name: "End game", exact: true })).toBeHidden();
    await gameButton.focus();
    await page.keyboard.press("Enter");
    await expect(menu).toBeInViewport({ ratio: 1 });
    await expect(gameButton).toHaveAttribute("aria-expanded", "true");
    await expect(menu.getByRole("button")).toHaveText(["Help", "Settings", "Pass device", "Reset game", "End game"]);
    for (const name of ["Help", "Settings", "Pass device", "Reset game", "End game"]) {
      const option = menu.getByRole("button", { name, exact: true });
      await expect(option).toBeInViewport({ ratio: 1 });
      expect((await option.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await expectBoardFrame(page, initialFrame);
    await screenshot(page, testInfo, `game-menu-${artifact}`, false);
    await page.keyboard.press("Tab");
    const helpButton = page.getByRole("button", { name: "Help", exact: true });
    await expect(helpButton).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(gameButton).toHaveAttribute("aria-expanded", "false");
    await expect(gameButton).toBeFocused();
    await page.keyboard.press("Space");
    await expect(menu).toBeVisible();
    await page.getByRole("region", { name: "Dice tray", exact: true }).click({ position: { x: 8, y: 8 } });
    await expect(menu).toBeHidden();
    await gameButton.focus();
    await page.keyboard.press("Enter");
    for (let step = 0; step < 8; step++) await page.keyboard.press("Tab");
    await expect(menu).toBeHidden();
    await chooseGameOption(page, "Help");
    await expect(page.getByRole("dialog", { name: "Help", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(gameButton).toBeFocused();
    await chooseGameOption(page, "End game");
    await expect(page.getByRole("dialog", { name: "Leave this island?", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(gameButton).toBeFocused();
    await expect(menu).toBeHidden();
    await expectBoardFrame(page, initialFrame);
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    const guide = page.getByRole("dialog", { name: "Help", exact: true });
    await expect(guide).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(gameButton).toBeFocused();
    await expect(menu).toBeHidden();
    await expectBoardFrame(page, initialFrame);
    await showView(page, "hand");
    await expect(page.locator(".turn-header").getByText("Setup", { exact: true })).toBeVisible();
    await noPageOverflow(page);
    await screenshot(page, testInfo, `header-and-turn-card-${artifact}`, false);
  }
});

test("player score highlights and active-turn seat pulses follow public VP leaders without crowns", async ({ page, isMobile }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize(isMobile ? { width: 320, height: 568 } : { width: 1024, height: 768 });
  await page.goto("/");
  await page.getByRole("button", { name: "4 players", exact: true }).click();
  await page.getByRole("combobox", { name: "Human players", exact: true }).selectOption("4");
  const names = await page.getByRole("textbox", { name: /^Player \d+ name$/ }).evaluateAll(elements => elements.map(element => (element as HTMLInputElement).value));
  const points = new Map(names.map(name => [name, 0]));
  await page.getByRole("button", { name: "Let's settle in", exact: true }).click();
  const seats = isMobile ? page.getByRole("region", { name: "Players and awards", exact: true }) : page.locator(".table-seats");
  let currentPlayer = await revealHand(page);
  await expectResourceBank(page, { wood: 19, brick: 19, wool: 19, grain: 19, ore: 19 });
  await showView(page, "players");
  await expect(seats.getByRole("img", { name: "Public VP leader", exact: true })).toHaveCount(0);
  await expect(seats.getByRole("img", { name: "0 connected roads", exact: true })).toHaveCount(4);
  await expect(seats.locator('.player-card-stat[aria-label="0 connected roads"] strong')).toHaveText(["0", "0", "0", "0"]);
  await expect(seats.locator(".player-seat-leading")).toHaveCount(0);
  await expect(seats.locator(".player-seat-active")).toHaveCount(1);
  for (let placement = 0; placement < 8; placement++) {
    if (placement !== 0 && placement !== 4) currentPlayer = await revealHand(page);
    if (placement === 1) {
      await showView(page, "players");
      await expect(seats.getByRole("img", { name: "1 connected road", exact: true })).toHaveCount(1);
      await expect(seats.getByRole("img", { name: "0 connected roads", exact: true })).toHaveCount(3);
      const activeSeat = seats.locator(".player-seat").filter({ has: page.getByText(currentPlayer, { exact: true }) });
      await expect(activeSeat).not.toHaveClass(/player-seat-leading/);
      await expect(activeSeat.getByText(/^(Your turn|Playing)$/)).toHaveCount(0);
      await expect(seats.locator(".player-seat-leading")).toHaveCount(1);
      await activeSeat.scrollIntoViewIfNeeded();
      await screenshot(page, testInfo, "leader-and-active-player", false);
      if (!isMobile) {
        for (const width of [1280, 1440, 1920, 1024]) {
          await page.setViewportSize({ width, height: 768 });
          for (const name of names) {
            const seat = seats.locator(".player-seat").filter({ has: page.getByText(name, { exact: true }) });
            await expect(seat.getByRole("img", { name: /^\d+ connected roads?$/ })).toBeInViewport({ ratio: 1 });
            expect(await seat.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
            expect(await seat.getByText(name, { exact: true }).evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
          }
          await noPageOverflow(page);
          await screenshot(page, testInfo, `four-player-road-counts-${width}`, false);
        }
      }
    }
    await showView(page, "board");
    await page.getByRole("button", { name: /^Place settlement at/ }).first().click();
    await page.getByRole("button", { name: "Confirm placement", exact: true }).click();
    points.set(currentPlayer, points.get(currentPlayer)! + 1);
    const settlements = page.getByRole("img", { name: `${currentPlayer}'s settlement at `, includeHidden: true }).locator("text");
    await expect(settlements).toHaveText(Array(points.get(currentPlayer)!).fill(currentPlayer[0]!.toUpperCase()));
    const highest = Math.max(...points.values());
    const allTied = new Set(points.values()).size === 1;
    await showView(page, "players");
    for (const [name, score] of points) {
      const seat = seats.locator(".player-seat").filter({ has: page.getByText(name, { exact: true }) });
      await expect(seat.getByRole("img", { name: "Public VP leader", exact: true })).toHaveCount(0);
      await expect(seat.locator(".player-score > svg")).toHaveCount(0);
      if (!allTied && score === highest) {
        await expect(seat).toHaveClass(/player-seat-leading/);
        await expect(seat).toHaveCSS("border-top-color", "rgb(181, 138, 45)");
        await expect(seat).toHaveCSS("background-image", /linear-gradient/);
        await expect(seat).not.toHaveCSS("box-shadow", "none");
      } else {
        await expect(seat).not.toHaveClass(/player-seat-leading/);
        await expect(seat).toHaveCSS("background-image", "none");
      }
      await expect(seat.locator(".player-turn")).toHaveCount(0);
      await expect(seat.getByText(/^(Your turn|Playing)$/)).toHaveCount(0);
      if (name === currentPlayer) {
        await expect(seat).toHaveClass(/player-seat-active/);
        await expect(seat).toHaveCSS("outline-style", "none");
      } else {
        await expect(seat).not.toHaveClass(/player-seat-active/);
      }
      await expect(seat).toHaveCSS("animation-name", "none");
      expect(await seat.evaluate(element => {
        const avatar = element.firstElementChild!.firstElementChild!.getBoundingClientRect();
        const name = element.querySelector("p")!.getBoundingClientRect();
        return Math.abs(name.top + name.height / 2 - avatar.top - avatar.height / 2);
      }), "Player names are vertically centered beside their avatars").toBeLessThanOrEqual(1);
      await expect(seat.locator(".player-score > span")).toHaveText(["VP", String(score)]);
      expect(await seat.evaluate(element => element.scrollWidth <= element.clientWidth), "Player details fit beside the score").toBe(true);
      expect(await seat.getByText(name, { exact: true }).evaluate(element => element.scrollWidth <= element.clientWidth), "Player names remain readable beside the score").toBe(true);
    }
    if (placement === 0) {
      const activeSeat = seats.locator(".player-seat-active");
      await activeSeat.scrollIntoViewIfNeeded();
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await expect(activeSeat).toHaveCSS("animation-name", "none");
      const playerColors = ["rgb(184, 93, 71)", "rgb(71, 124, 145)", "rgb(193, 149, 61)", "rgb(118, 96, 140)"];
      const expectedColor = playerColors[names.indexOf(currentPlayer)]!;
      const { duration, iterations, frames } = await activeSeat.evaluate((element, expectedColor) => {
        const animation = element.getAnimations({ subtree: true }).find(animation => animation instanceof CSSAnimation && animation.animationName === "player-turn-pulse");
        if (!animation?.effect) throw new Error("Missing active-turn area pulse");
        const timing = animation.effect.getTiming();
        animation.pause();
        const frames = [0, 0.5, 1].map(progress => {
          animation.currentTime = Number(timing.duration) * progress;
          const overlay = getComputedStyle(element, "::before");
          const style = getComputedStyle(element);
          const { x, y, width, height } = element.getBoundingClientRect();
          return { opacity: overlay.opacity, color: overlay.backgroundColor, background: style.backgroundImage, border: style.borderTopColor, bounds: { x, y, width, height } };
        });
        animation.currentTime = Number(timing.duration) / 2;
        return { duration: timing.duration, iterations: timing.iterations, frames };
      }, expectedColor);
      expect(duration).toBe(2400);
      expect(iterations).toBe(Infinity);
      expect(frames[1]!.opacity).not.toBe(frames[0]!.opacity);
      expect(frames[2]!.opacity).toBe(frames[0]!.opacity);
      for (const frame of frames) {
        expect(frame.bounds).toEqual(frames[0]!.bounds);
        expect(frame.background).toBe(frames[0]!.background);
        expect(frame.border).toBe("rgb(181, 138, 45)");
        expect(frame.color).toBe(expectedColor);
      }
      await screenshot(page, testInfo, "active-player-area-pulse", false);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await expect(activeSeat).toHaveCSS("animation-name", "none");
      expect(await activeSeat.evaluate(element => {
        const overlay = getComputedStyle(element, "::before");
        return element.getAnimations({ subtree: true }).length === 0 && overlay.animationName === "none" && overlay.opacity === "0.18";
      })).toBe(true);
    }
    if (placement === 0 || placement === 1) {
      await seats.locator(".player-seat-leading").first().scrollIntoViewIfNeeded();
      await screenshot(page, testInfo, placement === 0 ? "public-vp-leader" : "tied-public-vp-leaders", false);
    }
    await noPageOverflow(page);
    await showView(page, "board");
    await page.getByRole("button", { name: /^Build road at/ }).first().click();
    await page.getByRole("button", { name: "Confirm placement", exact: true }).click();
  }
});

test("blocked settlement markers follow the distance rule and toggle without changing placement", async ({ page, isMobile }, testInfo) => {
  await page.goto("/");
  await page.getByRole("combobox", { name: "Human players", exact: true }).selectOption("3");
  await page.getByRole("button", { name: "Let's settle in", exact: true }).click();
  await revealHand(page);
  const board = createBoard(() => 0);
  const occupiedVertices = new Set<string>();
  const markers = page.getByRole("img", { name: /^Settlement blocked at / });
  const settlementTargets = page.getByRole("button", { name: /^Place settlement at / });
  await expect(markers).toHaveCount(0);
  let expectedLabels: string[] = [];
  for (let placement = 0; placement < 2; placement++) {
    const target = settlementTargets.first();
    const vertexId = (await target.getAttribute("aria-label"))!.replace("Place settlement at ", "");
    await target.click();
    await expect(markers).toHaveCount(expectedLabels.length);
    await page.getByRole("button", { name: "Confirm placement", exact: true }).click();
    occupiedVertices.add(vertexId);
    const blockedVertices = board.vertices.filter(vertex => !occupiedVertices.has(vertex.id) && board.edges.some(edge =>
      edge.vertexIds.includes(vertex.id) && edge.vertexIds.some(neighborId => occupiedVertices.has(neighborId)),
    ));
    expectedLabels = blockedVertices.map(vertex => `Settlement blocked at ${vertex.id}: adjacent settlement or city`);
    await expect.poll(() => markers.evaluateAll(elements => elements.map(element => element.getAttribute("aria-label")))).toEqual(expectedLabels);
    expect(await markers.evaluateAll(elements => elements.every(element =>
      !element.hasAttribute("tabindex") && getComputedStyle(element).pointerEvents === "none",
    ))).toBe(true);
    await page.getByRole("button", { name: /^Build road at / }).first().click();
    await page.getByRole("button", { name: "Confirm placement", exact: true }).click();
    await expect(page.getByRole("heading", { name: /^Pass the device to / })).toBeVisible();
    await expect(markers).toHaveCount(expectedLabels.length);
    await revealHand(page);
    await expect(settlementTargets).toHaveCount(board.vertices.length - occupiedVertices.size - expectedLabels.length);
  }

  await page.setViewportSize(isMobile ? { width: 320, height: 568 } : { width: 1280, height: 720 });
  const initialFrame = await boardFrame(page);
  const legalLabels = await settlementTargets.evaluateAll(elements => elements.map(element => element.getAttribute("aria-label")));
  await screenshot(page, testInfo, "blocked-settlement-markers", false);
  const gameButton = page.getByRole("button", { name: "Game", exact: true });
  await gameButton.focus();
  await page.keyboard.press("Enter");
  for (let step = 0; step < 2; step++) await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  const toggle = settings.getByRole("checkbox", { name: "Show blocked settlement locations", exact: true });
  await expect(toggle).toBeChecked();
  await expect(toggle).toHaveAccessibleDescription(/distance rule prevents building/);
  await expect(settings).toBeInViewport({ ratio: 1 });
  await screenshot(page, testInfo, "settlement-marker-settings", false);
  await page.keyboard.press("Tab");
  await expect(toggle).toBeFocused();
  await page.keyboard.press("Space");
  await expect(toggle).not.toBeChecked();
  await page.keyboard.press("Escape");
  await expect(gameButton).toBeFocused();
  await expect(markers).toHaveCount(0);
  await expectBoardFrame(page, initialFrame);
  expect(await settlementTargets.evaluateAll(elements => elements.map(element => element.getAttribute("aria-label")))).toEqual(legalLabels);
  await screenshot(page, testInfo, "settlement-markers-off", false);

  await chooseGameOption(page, "Settings");
  await toggle.check();
  await settings.getByRole("button", { name: "Close dialog", exact: true }).click();
  await expect(markers).toHaveCount(expectedLabels.length);
  await expectBoardFrame(page, initialFrame);
  expect(await settlementTargets.evaluateAll(elements => elements.map(element => element.getAttribute("aria-label")))).toEqual(legalLabels);
  await page.setViewportSize(isMobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
  await screenshot(page, testInfo, "blocked-settlement-markers-restored", false);
  for (let step = 0; step < 4; step++) await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect(page.getByRole("status", { name: "Zoom level", exact: true })).toHaveText("200%");
  await expect(markers).toHaveCount(expectedLabels.length);
  await noPageOverflow(page);
  await screenshot(page, testInfo, "blocked-settlement-markers-zoomed", false);
});

for (const storageAvailable of [true, false]) {
  test(`settlement marker settings work with browser storage ${storageAvailable ? "available" : "blocked"}`, async ({ page }) => {
    if (!storageAvailable) {
      await page.addInitScript(() => {
        Object.defineProperty(window, "localStorage", {
          get() { throw new DOMException("Storage blocked", "SecurityError"); },
        });
      });
    }
    await page.goto("/");
    if (!storageAvailable) {
      await page.getByLabel("Profile name", { exact: true }).fill("Alex");
      await page.getByRole("button", { name: "Create and continue", exact: true }).click();
    }
    await page.getByRole("combobox", { name: "Human players", exact: true }).selectOption("3");
    await page.getByRole("button", { name: "Let's settle in", exact: true }).click();
    await revealHand(page);
    await placeStartingPieces(page);
    await chooseGameOption(page, "Settings");
    const toggle = page.getByRole("checkbox", { name: "Show blocked settlement locations", exact: true });
    await expect(toggle).toBeChecked();
    await toggle.uncheck();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("img", { name: /^Settlement blocked at / })).toHaveCount(0);
    await chooseGameOption(page, "End game");
    await page.getByRole("dialog", { name: "Leave this island?", exact: true }).getByRole("button", { name: "End game", exact: true }).click();
    await page.reload();
    if (!storageAvailable) {
      await page.getByLabel("Profile name", { exact: true }).fill("Alex");
      await page.getByRole("button", { name: "Create and continue", exact: true }).click();
    }
    await page.getByRole("combobox", { name: "Human players", exact: true }).selectOption("3");
    await page.getByRole("button", { name: "Let's settle in", exact: true }).click();
    await chooseGameOption(page, "Settings");
    await expect(toggle).toBeChecked({ checked: !storageAvailable });
    await page.keyboard.press("Escape");
    await revealHand(page);
    await placeStartingPieces(page);
    const markers = page.getByRole("img", { name: /^Settlement blocked at / });
    if (storageAvailable) await expect(markers).toHaveCount(0);
    else await expect(markers.first()).toBeVisible();
  });
}

test("water background defaults to round and fills the map without changing play", async ({ page }, testInfo) => {
  await page.goto("/");
  const map = page.locator(".board-viewport");
  const roundWater = map.locator('path[fill$="-sea)"]');
  await expect(map).toHaveCSS("background-image", "none");
  await expect(roundWater).toHaveCount(1);
  await page.getByRole("combobox", { name: "Human players", exact: true }).selectOption("3");
  await page.getByRole("button", { name: "Let's settle in", exact: true }).click();
  await revealHand(page);
  await showView(page, "board");
  const board = page.getByRole("region", { name: "Game board", exact: true });
  const frame = await boardFrame(page);
  const geometry = await themeBoardGeometry(board);
  const targets = board.getByRole("button", { name: /^Place settlement at / });
  const legalLabels = await targets.evaluateAll(elements => elements.map(element => element.getAttribute("aria-label")));
  await screenshot(page, testInfo, "water-background-round", false);

  await chooseGameOption(page, "Settings");
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  const toggle = settings.getByRole("checkbox", { name: "Fill board with water", exact: true });
  await expect(toggle).not.toBeChecked();
  await expect(toggle).toHaveAccessibleDescription(/entire map area.*Off by default/);
  await toggle.focus();
  await page.keyboard.press("Space");
  await expect(toggle).toBeChecked();
  await screenshot(page, testInfo, "water-background-settings", false);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Game", exact: true })).toBeFocused();
  await expect(map).toHaveCSS("background-image", /radial-gradient.*rgb\(197, 220, 208\)/);
  await expect(roundWater).toHaveCount(0);
  await expect(map.locator('ellipse[stroke-dasharray="2 7"]')).toHaveCount(0);
  await expectBoardFrame(page, frame);
  expect(await themeBoardGeometry(board)).toEqual(geometry);
  expect(await targets.evaluateAll(elements => elements.map(element => element.getAttribute("aria-label")))).toEqual(legalLabels);
  await screenshot(page, testInfo, "water-background-full", false);

  await page.getByRole("button", { name: "Change theme", exact: true }).click();
  await page.getByRole("radio", { name: "Mediterranean Ceramic", exact: true }).check();
  await page.keyboard.press("Escape");
  await expect(map).toHaveCSS("background-image", /radial-gradient.*rgb\(166, 213, 215\)/);
  await expectBoardFrame(page, frame);
  for (let step = 0; step < 4; step++) await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await map.evaluate(element => { element.scrollLeft = 40; element.scrollTop = 60; });
  const scroll = await map.evaluate(element => ({ left: element.scrollLeft, top: element.scrollTop }));
  await chooseGameOption(page, "Settings");
  await toggle.uncheck();
  await page.keyboard.press("Escape");
  await expect(map).toHaveCSS("background-image", "none");
  await expect(roundWater).toHaveCount(1);
  await expect(page.getByRole("status", { name: "Zoom level", exact: true })).toHaveText("200%");
  expect(await map.evaluate(element => ({ left: element.scrollLeft, top: element.scrollTop }))).toEqual(scroll);
  expect(await themeBoardGeometry(board)).toEqual(geometry);
  await chooseGameOption(page, "Settings");
  await toggle.check();
  await page.keyboard.press("Escape");
  await expect(map).toHaveCSS("background-image", /radial-gradient.*rgb\(166, 213, 215\)/);
  await expect(roundWater).toHaveCount(0);
  await expect(page.getByRole("status", { name: "Zoom level", exact: true })).toHaveText("200%");
  expect(await map.evaluate(element => ({ left: element.scrollLeft, top: element.scrollTop }))).toEqual(scroll);
  await noPageOverflow(page);
  await screenshot(page, testInfo, "water-background-full-zoomed", false);

  await expect.poll(() => page.evaluate(() => localStorage.getItem("catania.fillBoardWithWater"))).toBe("true");
  await page.reload();
  await showHomeView(page, "Island");
  await expect(map).toHaveCSS("background-image", /radial-gradient.*rgb\(166, 213, 215\)/);
  await expect(roundWater).toHaveCount(0);
  await screenshot(page, testInfo, "water-background-full-preview", false);
  await showHomeView(page, "Setup");
  await page.getByRole("combobox", { name: "Human players", exact: true }).selectOption("3");
  await page.getByRole("button", { name: "Let's settle in", exact: true }).click();
  await expect(page.getByRole("heading", { name: /^Pass the device to / })).toBeVisible();
  await expect(map).toHaveCSS("background-image", /radial-gradient/);
  await expect(roundWater).toHaveCount(0);
  await screenshot(page, testInfo, "water-background-full-handoff", false);
  await chooseGameOption(page, "Settings");
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("catania.fillBoardWithWater"))).toBe("false");
  await page.reload();
  await expect(map).toHaveCSS("background-image", "none");
  await expect(roundWater).toHaveCount(1);
});

for (const storage of ["unknown", "blocked", "write-errors"] as const) {
  test(`water background stays usable with ${storage} storage`, async ({ page }) => {
    await page.addInitScript(storage => {
      if (storage === "unknown") localStorage.setItem("catania.fillBoardWithWater", "not-a-boolean");
      if (storage === "blocked") Object.defineProperty(window, "localStorage", {
        get() { throw new DOMException("Storage blocked", "SecurityError"); },
      });
      if (storage === "write-errors") Storage.prototype.setItem = () => {
        throw new DOMException("Storage full", "QuotaExceededError");
      };
    }, storage);
    await page.goto("/");
    if (storage === "blocked") {
      await page.getByLabel("Profile name", { exact: true }).fill("Alex");
      await page.getByRole("button", { name: "Create and continue", exact: true }).click();
    }
    const map = page.locator(".board-viewport");
    await expect(map).toHaveCSS("background-image", "none");
    await page.getByRole("combobox", { name: "Human players", exact: true }).selectOption("3");
    await page.getByRole("button", { name: "Let's settle in", exact: true }).click();
    await chooseGameOption(page, "Settings");
    const toggle = page.getByRole("checkbox", { name: "Fill board with water", exact: true });
    await expect(toggle).not.toBeChecked();
    await toggle.check();
    await page.keyboard.press("Escape");
    await expect(map).toHaveCSS("background-image", /radial-gradient/);
    await expect(map.locator('path[fill$="-sea)"]')).toHaveCount(0);
    await revealHand(page);
    await showView(page, "board");
    await expect(map).toHaveCSS("background-image", /radial-gradient/);
    await page.reload();
    if (storage === "blocked") {
      await page.getByLabel("Profile name", { exact: true }).fill("Alex");
      await page.getByRole("button", { name: "Create and continue", exact: true }).click();
    }
    await expect(map).toHaveCSS("background-image", "none");
    await expect(map.locator('path[fill$="-sea)"]')).toHaveCount(1);
  });
}

test("short and narrow tabletops contain zoom, controls and placement previews", async ({ page, isMobile }, testInfo) => {
  await page.goto("/");
  await page.getByRole("combobox", { name: "Human players", exact: true }).selectOption("3");
  await page.getByRole("button", { name: "Let's settle in", exact: true }).click();
  await revealHand(page);
  const board = page.getByRole("region", { name: "Game board", exact: true });
  const map = board.getByRole("region", { name: /^Island map\./ });
  const viewports = isMobile ? [{ width: 320, height: 844 }, { width: 390, height: 667 }] : [{ width: 1280, height: 720 }, { width: 1024, height: 768 }];
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await showView(page, "board");
    const initialFrame = await boardFrame(page);
    const artifact = `${viewport.width}x${viewport.height}`;
    const startingBank = { wood: 19, brick: 19, wool: 19, grain: 19, ore: 19 };
    const bank = await expectResourceBank(page, startingBank);
    const bankFrame = await bank.boundingBox();
    for (const view of ["hand", "players", "board"] as const) {
      await showView(page, view);
      await expectResourceBank(page, startingBank);
      expect(await bank.boundingBox()).toEqual(bankFrame);
      await noPageOverflow(page);
      if (view === "hand") {
        await revealBuildSection(page);
        const sidebar = page.getByRole("complementary", { name: "Your hand and actions" });
        const cards = sidebar.getByRole("region", { name: "Your cards", exact: true });
        const controls = sidebar.getByRole("region", { name: "Turn controls", exact: true });
        await expect(sidebar).toHaveCSS("border-top-width", "0px");
        await expect(sidebar).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
        for (const panel of [bank, cards, controls]) {
          await expect(panel).toBeInViewport({ ratio: 1 });
          await expect(panel).toHaveCSS("border-top-width", "1px");
          await expect(panel).toHaveCSS("border-top-left-radius", "20px");
          await expect(panel).not.toHaveCSS("box-shadow", "none");
        }
        const cardsFrame = (await cards.boundingBox())!;
        const controlsFrame = (await controls.boundingBox())!;
        expect(cardsFrame.x).toBe(bankFrame!.x);
        expect(cardsFrame.width).toBe(bankFrame!.width);
        expect(controlsFrame.x).toBe(cardsFrame.x);
        expect(controlsFrame.width).toBe(cardsFrame.width);
        const panelGap = isMobile ? 8 : 12;
        expect(cardsFrame.y - bankFrame!.y - bankFrame!.height).toBe(panelGap);
        expect(controlsFrame.y - cardsFrame.y - cardsFrame.height).toBe(panelGap);
        await expect(cards.getByRole("region", { name: "Private resources", exact: true })).toBeVisible();
        await expect(controls.locator(".turn-card")).toBeInViewport({ ratio: 1 });
        for (const name of ["Roll the dice", "End turn & pass device"]) {
          await expect(controls.getByRole("button", { name, exact: true })).toBeInViewport({ ratio: 1 });
        }
        await screenshot(page, testInfo, `three-sidebar-sections-${artifact}`, false);
      }
    }
    await expectBoardFrame(page, initialFrame);
    const boardBounds = await board.boundingBox();
    const diceBounds = await page.getByRole("region", { name: "Dice tray", exact: true }).boundingBox();
    if (isMobile) {
      expect(bankFrame!.y + bankFrame!.height).toBeLessThanOrEqual(boardBounds!.y);
      expect(bankFrame!.y).toBeGreaterThanOrEqual(diceBounds!.y + diceBounds!.height);
    } else {
      const sidebar = page.getByRole("complementary", { name: "Your hand and actions" });
      await expect(sidebar.getByRole("region", { name: "Dice tray", exact: true })).toBeInViewport({ ratio: 1 });
      const sidebarBounds = (await sidebar.boundingBox())!;
      expect(boardBounds!.y).toBe(bankFrame!.y);
      expect(boardBounds!.y + boardBounds!.height).toBe(sidebarBounds.y + sidebarBounds.height);
      expect(sidebarBounds.x).toBeGreaterThanOrEqual(boardBounds!.x + boardBounds!.width);
      expect(diceBounds!.y).toBeGreaterThan(sidebarBounds.y);
      expect(diceBounds!.x).toBeGreaterThanOrEqual(sidebarBounds.x);
      expect(diceBounds!.x + diceBounds!.width).toBeLessThanOrEqual(sidebarBounds.x + sidebarBounds.width);
    }
    await screenshot(page, testInfo, `shared-bank-above-play-area-${artifact}`, false);
    await expect(page.getByRole("region", { name: "Dice tray", exact: true })).toHaveAttribute("data-stage", "idle");
    await chooseGameOption(page, "Help");
    const guide = page.getByRole("dialog", { name: "Help", exact: true });
    await guide.getByRole("heading", { name: "Builds and costs", exact: true }).scrollIntoViewIfNeeded();
    await expect(guide.getByRole("heading", { name: "Builds and costs", exact: true })).toBeVisible();
    await expect(guide.getByRole("list", { name: "Public activity", exact: true })).toHaveCount(0);
    expect(await guide.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await noPageOverflow(page);
    await screenshot(page, testInfo, `help-${artifact}`, false);
    await guide.getByRole("button", { name: "Close dialog", exact: true }).click();
    await expect(page.getByRole("button", { name: "Game", exact: true })).toBeFocused();
    await expectBoardFrame(page, initialFrame);
    if (isMobile) await expect(page.getByRole("navigation", { name: "Game views" })).toBeInViewport({ ratio: 1 });
    await expect(board.getByRole("group", { name: "Map zoom controls" })).toBeInViewport({ ratio: 1 });
    await expect(board.getByRole("button", { name: "Zoom out", exact: true })).toBeDisabled();
    expect(await map.evaluate(element => element.scrollWidth <= element.clientWidth && element.scrollHeight <= element.clientHeight)).toBe(true);
    for (let step = 0; step < 6; step++) await board.getByRole("button", { name: "Zoom in", exact: true }).click();
    await expect(board.getByRole("status", { name: "Zoom level" })).toHaveText("250%");
    await expect(board.getByRole("button", { name: "Zoom in", exact: true })).toBeDisabled();
    expect(await map.evaluate(element => element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight)).toBe(true);
    expect(await map.evaluate(element => {
      element.scrollTo({ left: element.scrollWidth, top: element.scrollHeight });
      return element.scrollLeft > 0 || element.scrollTop > 0;
    })).toBe(true);
    await noPageOverflow(page);
    await screenshot(page, testInfo, `zoomed-board-${artifact}`, false);
    for (let step = 0; step < 6; step++) await board.getByRole("button", { name: "Zoom out", exact: true }).click();
    await expect(board.getByRole("status", { name: "Zoom level" })).toHaveText("100%");
    await expect(board.getByRole("button", { name: "Zoom out", exact: true })).toBeDisabled();
    expect(await map.evaluate(element => ({ left: element.scrollLeft, top: element.scrollTop }))).toEqual({ left: 0, top: 0 });
    await expectBoardFrame(page, initialFrame);
    const settlement = board.getByRole("button", { name: /^Place settlement at/ }).first();
    const selectionId = (await settlement.getAttribute("aria-label"))!.replace("Place settlement at ", "");
    await settlement.focus();
    await page.keyboard.press("Enter");
    const confirmation = await expectPlacementConfirmation(page, settlement, selectionId);
    await expect(confirmation.getByRole("button", { name: "Confirm placement", exact: true })).toBeFocused();
    await expect(board.getByRole("img", { name: /'s settlement at / })).toHaveCount(0);
    await expectBoardFrame(page, initialFrame);
    await screenshot(page, testInfo, `keyboard-settlement-preview-${artifact}`, false);
    await page.keyboard.press("Escape");
    await expect(settlement).toHaveAttribute("aria-pressed", "false");
    await expect(confirmation).toHaveCount(0);
    await expect(settlement).toBeFocused();
    await expectBoardFrame(page, initialFrame);
    await page.keyboard.press("Enter");
    await expectPlacementConfirmation(page, settlement, selectionId);
    await expect(confirmation.getByRole("button", { name: "Confirm placement", exact: true })).toBeFocused();
    for (let step = 0; step < 6; step++) await board.getByRole("button", { name: "Zoom in", exact: true }).click();
    await settlement.scrollIntoViewIfNeeded();
    await expectPlacementConfirmation(page, settlement, selectionId);
    const beforePan = await map.evaluate(element => ({ left: element.scrollLeft, top: element.scrollTop }));
    await settlement.evaluate(element => {
      const graphic = element as SVGGraphicsElement;
      const bounds = graphic.getBBox();
      const point = new DOMPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2).matrixTransform(graphic.getScreenCTM()!);
      const viewport = element.closest(".board-viewport")!;
      const viewportBounds = viewport.getBoundingClientRect();
      viewport.scrollBy({ left: point.x - viewportBounds.x - 24, top: point.y - viewportBounds.y - 24 });
    });
    await expect.poll(() => map.evaluate(element => ({ left: element.scrollLeft, top: element.scrollTop }))).not.toEqual(beforePan);
    await expectPlacementConfirmation(page, settlement, selectionId);
    expect(await board.locator(".board-surface, .board-viewport").evaluateAll(elements => elements.map(element => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    }))).toEqual(initialFrame.slice(0, 2));
    await expect(board.getByRole("img", { name: /'s settlement at / })).toHaveCount(0);
    await noPageOverflow(page);
    await screenshot(page, testInfo, `zoomed-edge-placement-${artifact}`, false);
    const pannedPosition = await map.evaluate(element => ({ left: element.scrollLeft, top: element.scrollTop }));
    await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(settlement).toBeFocused();
    await expect(settlement).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByRole("button", { name: "Confirm placement", includeHidden: true })).toHaveCount(0);
    expect(await map.evaluate(element => ({ left: element.scrollLeft, top: element.scrollTop }))).toEqual(pannedPosition);
    for (let step = 0; step < 6; step++) await board.getByRole("button", { name: "Zoom out", exact: true }).click();
    await expectBoardFrame(page, initialFrame);
    await showView(page, "hand");
    const hand = page.getByRole("region", { name: "Private resources", exact: true });
    await hand.scrollIntoViewIfNeeded();
    await expect(hand).toBeInViewport({ ratio: 1 });
    await expect(hand.getByText("0 cards", { exact: true })).toBeVisible();
    for (const resource of RESOURCES) {
      const count = hand.getByTitle(`0 ${RESOURCE_NAMES[resource]}`, { exact: true }).locator("strong");
      await expect(count).toHaveText("0");
      await expect(count).toBeVisible();
      expect(await count.evaluate(element => Number.parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThan(10);
    }
    const building = page.getByRole("region", { name: "Build a little bigger", exact: true });
    const buildOptions = building.locator(".build-options");
    const buildRows = buildOptions.locator(":scope > button");
    await expect(buildRows).toHaveCount(4);
    await expect(buildRows.nth(1)).toHaveAccessibleDescription("Available after rolling on your turn.");
    await expect(buildRows.nth(1)).not.toHaveAttribute("aria-describedby");
    const rowGeometry = await buildRows.evaluateAll(elements => elements.map(element => {
      const { x, y, width, height } = element.getBoundingClientRect();
      const content = element.firstElementChild!;
      const icon = content.firstElementChild!.getBoundingClientRect();
      const label = content.lastElementChild!.getBoundingClientRect();
      const cost = element.querySelector(".build-cost")!.getBoundingClientRect();
      return { x, y, width, height, parentWidth: element.parentElement!.getBoundingClientRect().width,
        iconWidth: icon.width, iconHeight: icon.height, labelLeft: label.left, labelRight: label.right, costLeft: cost.left, costRight: cost.right };
    }));
    for (const [index, piece] of (["road", "settlement", "city", "development"] as const).entries()) {
      const row = buildRows.nth(index);
      const bounds = rowGeometry[index]!;
      expect(Math.abs(bounds.width - bounds.parentWidth)).toBeLessThanOrEqual(1);
      expect(bounds.x).toBe(rowGeometry[0]!.x);
      expect(bounds.height).toBe(rowGeometry[0]!.height);
      expect(bounds.iconWidth).toBe(32);
      expect(bounds.iconHeight).toBe(32);
      expect(bounds.labelLeft).toBe(rowGeometry[0]!.labelLeft);
      expect(bounds.labelRight).toBeLessThanOrEqual(bounds.costLeft);
      expect(bounds.costRight).toBe(rowGeometry[0]!.costRight);
      if (index) expect(bounds.y).toBeGreaterThanOrEqual(rowGeometry[index - 1]!.y + rowGeometry[index - 1]!.height);
      await row.scrollIntoViewIfNeeded();
      await expect(row).toBeInViewport({ ratio: 1 });
      if (piece === "development") {
        await expect(row).toHaveAccessibleName("Buy a card 1 Wool 1 Grain 1 Ore");
        const icon = row.locator(":scope > span:first-child svg");
        await expect(icon).toHaveAttribute("aria-hidden", "true");
        await expect(icon).toHaveAttribute("viewBox", "0 0 24 28");
        expect(await icon.innerHTML()).toBe(await bank.locator(".bank-development svg").innerHTML());
        await expect(row.locator(".piece-icon")).toHaveCount(0);
      } else {
        await expect(row).toContainText(piece === "city" ? "Upgrade to city" : `Build ${piece}`);
        await expect(row.locator(`svg.piece-icon[data-piece="${piece}"]`)).toHaveAttribute("aria-hidden", "true");
      }
      await expect(row).toBeDisabled();
      const resources = RESOURCES.filter(resource => COSTS[piece][resource] > 0);
      expect(await row.locator(".build-cost [title]").evaluateAll(elements => elements.map(element => element.getAttribute("title")))).toEqual(
        resources.map(resource => `${COSTS[piece][resource]} ${RESOURCE_NAMES[resource]}`),
      );
      for (const resource of resources) {
        await expect(row.getByTitle(`${COSTS[piece][resource]} ${RESOURCE_NAMES[resource]}`, { exact: true })).toBeVisible();
      }
    }
    await expect(page.getByRole("button", { name: /^Buy a card\b/, includeHidden: true })).toHaveCount(1);
    const trade = building.getByRole("button", { name: "Make a trade", exact: true });
    const tradeGeometry = await trade.evaluate(element => {
      const { x, y, width } = element.getBoundingClientRect();
      const stack = element.parentElement!.querySelector(".build-options")!.getBoundingClientRect();
      return { x, y, width, stackLeft: stack.x, stackBottom: stack.bottom, stackWidth: stack.width };
    });
    expect(tradeGeometry.x).toBe(tradeGeometry.stackLeft);
    expect(tradeGeometry.width).toBe(tradeGeometry.stackWidth);
    expect(tradeGeometry.y).toBeGreaterThanOrEqual(tradeGeometry.stackBottom);
    for (const control of await buildOptions.getByRole("button").all()) {
      await control.scrollIntoViewIfNeeded();
      await expect(control).toBeInViewport({ ratio: 1 });
    }
    await noPageOverflow(page);
    await expect(building.locator("#settlement-build-explanation")).toHaveCount(0);
    await screenshot(page, testInfo, `vertical-build-rows-${artifact}`, false);
    await expect(page.getByRole("region", { name: "Your development cards", exact: true })).toHaveCount(0);
    await trade.scrollIntoViewIfNeeded();
    await expect(trade).toBeInViewport({ ratio: 1 });
    await noPageOverflow(page);
    expect(await page.getByRole("complementary", { name: "Your hand and actions", exact: true }).locator(".hand-content").evaluate(element =>
      element.scrollHeight > element.clientHeight && element.scrollTop > 0,
    )).toBe(true);
    for (const name of ["Roll the dice", "End turn & pass device"]) {
      await expect(page.getByRole("button", { name, exact: true })).toBeDisabled();
      await expect(page.getByRole("button", { name, exact: true })).toBeInViewport({ ratio: 1 });
    }
    await screenshot(page, testInfo, `accessible-hand-${artifact}`, false);
  }
});

test("turn controls stay visible and stable on every phone and tablet game view", async ({ page, isMobile }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  // Tablets exercise the side-by-side layout through a resized desktop viewport.
  if (!isMobile) await page.setViewportSize({ width: 768, height: 1024 });
  await prepareRollGame(page);
  const dismissCollection = page.getByRole("button", { name: "Dismiss resource collection", exact: true });
  if (await dismissCollection.isVisible()) await dismissCollection.click();
  const controls = page.getByRole("region", { name: "Turn controls", exact: true });
  const roll = page.getByRole("button", { name: "Roll the dice", exact: true });
  const endTurn = page.getByRole("button", { name: "End turn & pass device", exact: true });
  const privateResources = page.getByRole("region", { name: "Private resources", exact: true });
  for (const viewport of [page.viewportSize()!, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    let stableFrame: { x: number; y: number; width: number; height: number } | undefined;
    for (const view of ["hand", "board", "players"] as const) {
      await showView(page, view);
      await expect(controls).toBeInViewport({ ratio: 1 });
      await expect(roll).toBeInViewport({ ratio: 1 });
      await expect(endTurn).toBeInViewport({ ratio: 1 });
      const frame = (await controls.boundingBox())!;
      if (stableFrame) expect(frame).toEqual(stableFrame);
      stableFrame = frame;
      if (view === "hand" || !await page.getByRole("navigation", { name: "Game views" }).isVisible()) {
        await expect(privateResources).toBeVisible();
      } else {
        await expect(privateResources).toBeHidden();
      }
      await noPageOverflow(page);
      await screenshot(page, testInfo, `turn-controls-${view}-${viewport.width}`, false);
    }
  }
});

test("build section collapses on phones and starts expanded on larger screens", async ({ page, isMobile }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  // Mount the game at a tablet width so the disclosure default follows the viewport.
  if (!isMobile) await page.setViewportSize({ width: 820, height: 1180 });
  await prepareRollGame(page);
  await showView(page, "hand");
  const building = page.getByRole("region", { name: "Build a little bigger", exact: true });
  const toggle = page.getByRole("button", { name: "Build a little bigger", exact: true });
  const buildOptions = building.locator(".build-options");
  const buildRoad = building.getByRole("button", { name: /^Build road\b/ });
  const defaultExpanded = !isMobile;
  expect((await toggle.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await expect(toggle).toHaveAttribute("aria-expanded", defaultExpanded ? "true" : "false");
  if (!defaultExpanded) {
    await expect(buildRoad).toBeHidden();
    await screenshot(page, testInfo, "build-collapsed-phone", false);
  }
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", defaultExpanded ? "false" : "true");
  if (defaultExpanded) {
    await expect(buildRoad).toBeHidden();
  } else {
    await expect(buildOptions).toBeVisible();
    await expect(buildRoad).toBeVisible();
  }
  await screenshot(page, testInfo, "build-toggled", false);
  await page.keyboard.press("Space");
  await expect(toggle).toHaveAttribute("aria-expanded", defaultExpanded ? "true" : "false");
  if (!defaultExpanded) await expect(buildRoad).toBeHidden();
});

test("player list reuses compact table seats across phone and landscape widths", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page.getByRole("combobox", { name: "Human players", exact: true }).selectOption("3");
  await page.getByRole("button", { name: "Let's settle in", exact: true }).click();
  await revealHand(page);
  const tableMarkup = await page.locator(".table-seats .player-seat").evaluateAll(elements => elements.map(element => element.outerHTML));
  const list = page.getByRole("region", { name: "Players and awards", exact: true });
  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 850, height: 480 }]) {
    await page.setViewportSize(viewport);
    await showView(page, "players");
    await expect(list).toBeVisible();
    const seats = list.locator(".player-seat");
    await expect(seats).toHaveCount(3);
    expect(await seats.evaluateAll(elements => elements.map(element => element.outerHTML))).toEqual(tableMarkup);
    for (const seat of await seats.all()) {
      await seat.scrollIntoViewIfNeeded();
      await expect(seat).toBeInViewport({ ratio: 1 });
      await expect(seat.locator(":scope > div")).toHaveCount(1);
      const counts = seat.locator(".player-card-counts");
      await expect(counts.getByRole("img")).toHaveCount(4);
      expect(await counts.innerText()).not.toMatch(/resources|development/i);
      const bounds = await seat.evaluate(element => ({
        seat: element.getBoundingClientRect(),
        name: element.querySelector(".player-name")!.getBoundingClientRect(),
        score: element.querySelector(".player-score")!.getBoundingClientRect(),
        counts: [...element.querySelectorAll(".player-card-stat")].map(stat => stat.getBoundingClientRect()),
        overflowing: element.scrollWidth > element.clientWidth,
      }));
      expect(bounds.seat.height, "Player items stay compact").toBeLessThanOrEqual(80);
      expect(bounds.overflowing).toBe(false);
      expect(bounds.name.right).toBeLessThanOrEqual(bounds.score.left);
      expect(new Set(bounds.counts.map(stat => Math.round(stat.y))).size, "Counts share one row").toBe(1);
      for (const stat of bounds.counts) {
        expect(stat.left).toBeGreaterThanOrEqual(bounds.seat.left);
        expect(stat.right).toBeLessThanOrEqual(bounds.seat.right);
      }
    }
    await noPageOverflow(page);
    await screenshot(page, testInfo, `compact-player-list-${viewport.width}`, false);
  }
});

test("tablets keep every public player card above the island without scrolling", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 768, height: 1024 });
  for (const playerCount of [3, 4] as const) {
    await page.goto("/");
    if (playerCount === 4) await page.getByRole("button", { name: "4 players", exact: true }).click();
    await seedGameRandomness(page);
    await page.getByRole("button", { name: "Let's settle in", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Alex's hand", exact: true })).toBeVisible();
    const board = page.getByRole("region", { name: "Game board", exact: true });
    for (const viewport of [{ width: 768, height: 1024 }, { width: 820, height: 1180 }, { width: 1024, height: 768 }]) {
      await page.setViewportSize(viewport);
      await showView(page, "board");
      const seats = page.locator(".table-seats");
      await expect(seats).toBeVisible();
      const seatCards = seats.locator(".player-seat");
      await expect(seatCards).toHaveCount(playerCount);
      const seatBounds = await seatCards.evaluateAll(cards => cards.map(card => card.getBoundingClientRect()));
      const boardBounds = (await board.boundingBox())!;
      for (const bounds of seatBounds) {
        expect(bounds.width).toBeGreaterThan(0);
        expect(bounds.y + bounds.height).toBeLessThanOrEqual(boardBounds.y + 1);
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
      }
      // All seats share one row above the island and stay inside the screen.
      expect(seatBounds.map(bounds => Math.round(bounds.y))).toEqual(seatBounds.map(() => Math.round(seatBounds[0]!.y)));
      await expect(board).toBeInViewport();
      await expect(seatCards.first()).toBeInViewport({ ratio: 1 });
      await expect(seatCards.last()).toBeInViewport({ ratio: 1 });
      if (viewport.width <= 1024) {
        // Narrow tablet seats put the name on an upper level and the four counts
        // in one horizontal second row below it.
        for (const card of await seatCards.all()) {
          const cardBounds = await card.evaluate(element => {
            const seat = element.getBoundingClientRect();
            const name = element.querySelector(".player-name")!.getBoundingClientRect();
            const counts = [...element.querySelectorAll(".player-card-counts .player-card-stat strong")].map(
              stat => stat.getBoundingClientRect(),
            );
            return { seat, name, counts };
          });
          expect(cardBounds.name.bottom).toBeLessThanOrEqual(cardBounds.counts[0]!.y + 1);
          const countRows = new Set(cardBounds.counts.map(bounds => Math.round(bounds.y)));
          expect(countRows.size, "Counts stay on one horizontal row").toBe(1);
          expect(Math.max(...cardBounds.counts.map(bounds => bounds.right))).toBeLessThanOrEqual(cardBounds.seat.right + 1);
        }
      }
      await noHorizontalOverflow(page);
      await screenshot(page, testInfo, `tablet-seats-${playerCount}p-${viewport.width}`, false);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    // Wide cards keep the existing single row; four narrower cards still stack.
    const wideStyle = await page.locator(".table-seats .player-seat").first().evaluate(element => ({
      layout: getComputedStyle(element.firstElementChild!).display,
      counts: getComputedStyle(element.querySelector(".player-card-counts")!).flexDirection,
    }));
    expect(wideStyle.layout).toBe(playerCount === 3 ? "flex" : "grid");
    expect(wideStyle.counts).toBe("row");
    await page.getByRole("button", { name: "Game", exact: true }).click();
    await page.getByRole("group", { name: "Game menu", exact: true }).getByRole("button", { name: "End game", exact: true }).click();
    await page.getByRole("dialog", { name: "Leave this island?", exact: true }).getByRole("button", { name: "End game", exact: true }).click();
    await expect(page.getByRole("button", { name: "Let's settle in", exact: true })).toBeVisible();
  }
});

test("unfolded foldables show the island, hand, and seats side by side without the page header or view tabs", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 720, height: 960 });
  await page.goto("/");
  const header = page.getByRole("banner");
  await expect(header).toBeVisible();
  await seedGameRandomness(page);
  await page.getByRole("button", { name: "Let's settle in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Alex's hand", exact: true })).toBeVisible();
  const board = page.getByRole("region", { name: "Game board", exact: true });
  const hand = page.getByRole("region", { name: "Your cards", exact: true });
  const turnControls = page.getByRole("region", { name: "Turn controls", exact: true });
  const bank = page.getByRole("region", { name: "Resource bank", exact: true });
  for (const viewport of [{ width: 673, height: 841 }, { width: 841, height: 673 }, { width: 720, height: 960 }]) {
    await page.setViewportSize(viewport);
    await expect(header).toBeHidden();
    await expect(page.getByRole("navigation", { name: "Game views" })).toBeHidden();
    await expect(page.locator(".table-seats")).toBeVisible();
    await expect(board).toBeInViewport({ ratio: 1 });
    await expect(hand).toBeInViewport({ ratio: 1 });
    await expect(turnControls).toBeInViewport({ ratio: 1 });
    await expect(bank).toBeInViewport({ ratio: 1 });
    const boardBounds = (await board.boundingBox())!;
    const handBounds = (await hand.boundingBox())!;
    const bankBounds = (await bank.boundingBox())!;
    expect(handBounds.x).toBeGreaterThanOrEqual(boardBounds.x + boardBounds.width);
    expect(handBounds.x).toBeCloseTo(bankBounds.x, 1);
    // The dice summary sits beside the turn controls instead of above the island.
    await expect(page.locator(".roll-summary-feedback")).toBeHidden();
    await expect(page.locator(".roll-summary-hand .roll-summary")).toBeVisible();
    await noHorizontalOverflow(page);
    await screenshot(page, testInfo, `unfolded-foldable-${viewport.width}-${viewport.height}`, false);
  }
  const gameMenu = turnControls.getByRole("button", { name: "Game", exact: true });
  await gameMenu.click();
  await expect(page.getByRole("group", { name: "Game menu", exact: true }).getByRole("button", { name: "Help", exact: true })).toBeVisible();
  await gameMenu.press("Escape");
  for (const viewport of [{ width: 600, height: 601 }, { width: 1023, height: 601 }]) {
    await page.setViewportSize(viewport);
    await expect(header).toBeHidden();
    await expect(gameMenu).toBeVisible();
  }
  for (const viewport of [{ width: 599, height: 841 }, { width: 841, height: 600 }, { width: 1024, height: 841 }]) {
    await page.setViewportSize(viewport);
    await expect(header).toBeVisible();
    await expect(gameMenu).toBeVisible();
  }
});

for (const displayScale of [1.25, 1.5625]) {
  test.describe(`build labels at ${displayScale} display scale`, () => {
    test.use({ deviceScaleFactor: displayScale });

    test("disabled build labels stay readable when resizing between folded and unfolded layouts", async ({ page }, testInfo) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto("/");
      await page.getByRole("combobox", { name: "Human players", exact: true }).selectOption("3");
      await seedGameRandomness(page);
      await page.getByRole("button", { name: "Let's settle in", exact: true }).click();
      await revealHand(page);
      const building = page.getByRole("region", { name: "Build a little bigger", exact: true });
      for (const viewport of [{ width: 720, height: 960 }, { width: 390, height: 844 }, { width: 673, height: 841 }]) {
        await page.setViewportSize(viewport);
        await showView(page, "hand");
        const toggle = building.getByRole("button", { name: "Build a little bigger", exact: true });
        if (await toggle.getAttribute("aria-expanded") === "false") await toggle.click();
        const rows = building.locator(".build-options > button");
        await expect(rows).toHaveCount(4);
        for (const row of await rows.all()) {
          await expect(row).toBeDisabled();
          await expect(row).toHaveCSS("opacity", "1");
          const content = row.locator(":scope > span:first-child");
          await expect(content).toHaveCSS("opacity", "1");
          const label = content.locator(":scope > span:last-child");
          await expect(label).toHaveCSS("opacity", "1");
          await expect(label).toHaveCSS("color", "rgb(109, 118, 108)");
          await expect(content.locator(":scope > :first-child")).toHaveCSS("opacity", "0.65");
          await expect(row.locator(".build-cost")).toHaveCSS("opacity", "0.65");
          const bounds = await row.evaluate(element => {
            const label = element.firstElementChild!.lastElementChild!;
            const range = document.createRange();
            range.selectNodeContents(label);
            const rowBounds = element.getBoundingClientRect();
            const cost = element.querySelector(".build-cost")!.getBoundingClientRect();
            return [...range.getClientRects()].map(line => ({
              top: line.top, bottom: line.bottom, right: line.right,
              rowTop: rowBounds.top, rowBottom: rowBounds.bottom, costLeft: cost.left,
            }));
          });
          for (const line of bounds) {
            expect(line.top).toBeGreaterThanOrEqual(line.rowTop);
            expect(line.bottom).toBeLessThanOrEqual(line.rowBottom);
            expect(line.right).toBeLessThanOrEqual(line.costLeft);
          }
        }
        await noHorizontalOverflow(page);
        await screenshot(page, testInfo, `disabled-build-labels-${viewport.width}-${displayScale}`, false);
      }
    });
  });
}

test("shared-board seats keep one row on tablets", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto("/");
  await page.getByRole("button", { name: "Let's settle in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Alex's hand", exact: true })).toBeVisible();
  const seatMarkup = await page.locator(".table-seats .player-seat").first().evaluate(element => element.outerHTML);
  for (const viewport of [{ width: 768, height: 1024 }, { width: 820, height: 1180 }]) {
    await page.setViewportSize(viewport);
    // Reuse a real rendered seat so the shared-board styles are checked against
    // live markup; the full shared-board flow belongs to multiplayer.spec.ts.
    await page.evaluate(markup => {
      document.querySelector(".shared-table-seats")?.remove();
      const list = document.createElement("ul");
      list.className = "table-seats shared-table-seats";
      list.setAttribute("aria-label", "shared seats fixture");
      for (let seat = 0; seat < 4; seat++) {
        const item = document.createElement("li");
        item.className = "min-w-0";
        item.innerHTML = markup;
        list.append(item);
      }
      document.querySelector(".game-table")!.prepend(list);
    }, seatMarkup);
    const shared = page.getByRole("list", { name: "shared seats fixture", exact: true });
    await expect(shared).toBeVisible();
    const seats = shared.locator(".player-seat");
    await expect(seats).toHaveCount(4);
    expect(await shared.evaluate(element => element.scrollWidth <= element.clientWidth), "No horizontal seat scrolling").toBe(true);
    await expect(shared).toHaveCSS("overflow-x", "visible");
    const seatBounds = await seats.evaluateAll(cards => cards.map(card => card.getBoundingClientRect()));
    expect(seatBounds.map(bounds => Math.round(bounds.y)), "Seats stay on one row").toEqual(seatBounds.map(() => Math.round(seatBounds[0]!.y)));
    for (const bounds of seatBounds) {
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
    }
    await screenshot(page, testInfo, `shared-tablet-seats-${viewport.width}`, false);
  }
});

test("game hides vertical scrollbar tracks while panels and dialogs remain scrollable", async ({ page, isMobile }, testInfo) => {
  await page.setViewportSize(isMobile ? { width: 390, height: 667 } : { width: 1280, height: 720 });
  await page.goto("/");
  const homeSettings = page.locator(".home-setup-content");
  await expect(homeSettings).toHaveCSS("scrollbar-width", "thin");
  await page.getByRole("combobox", { name: "Human players", exact: true }).selectOption("3");
  await page.getByRole("button", { name: "Let's settle in", exact: true }).click();
  await revealHand(page);
  await showView(page, "hand");
  await revealBuildSection(page);
  for (const panel of await page.locator(".table-hand, .hand-content, .turn-title, .turn-description, .table-players, .roll-summary-content, .board-viewport").all()) {
    await expect(panel).toHaveCSS("scrollbar-width", "none");
  }
  const hand = page.locator(".hand-content");
  expect(await hand.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  await hand.hover();
  await page.mouse.wheel(0, 200);
  await expect.poll(() => hand.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await noPageOverflow(page);
  await screenshot(page, testInfo, "game-hidden-scrollbars", false);

  await page.getByRole("button", { name: "Game", exact: true }).click();
  const menu = page.getByRole("group", { name: "Game menu", exact: true });
  await expect(menu).toHaveCSS("scrollbar-width", "none");
  await menu.getByRole("button", { name: "Help", exact: true }).click();
  const guide = page.getByRole("dialog", { name: "Help", exact: true });
  await expect(guide).toHaveCSS("scrollbar-width", "none");
  expect(await guide.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  await guide.locator("h2").hover();
  await page.mouse.wheel(0, 200);
  await expect.poll(() => guide.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await screenshot(page, testInfo, "game-dialog-hidden-scrollbars", false);
  await page.keyboard.press("Escape");

  await chooseGameOption(page, "End game");
  await page.getByRole("dialog", { name: "Leave this island?", exact: true }).getByRole("button", { name: "End game", exact: true }).click();
  await expect(homeSettings).toHaveCSS("scrollbar-width", "thin");
});

test("game session blocks pull-to-refresh at the page root, home does not", async ({ page }) => {
  await page.goto("/");
  const body = page.locator("body");
  await expect(body).not.toHaveClass(/game-in-progress/);
  await expect(body).toHaveCSS("overscroll-behavior-y", "auto");
  await page.getByRole("button", { name: "Let's settle in", exact: true }).click();
  await expect(page.getByRole("button", { name: "Game", exact: true })).toBeVisible();
  await expect(body).toHaveClass(/game-in-progress/);
  await expect(body).toHaveCSS("overscroll-behavior-y", "none");
  await chooseGameOption(page, "End game");
  await page.getByRole("dialog", { name: "Leave this island?", exact: true }).getByRole("button", { name: "End game", exact: true }).click();
  await expect(page.getByRole("button", { name: "Let's settle in", exact: true })).toBeVisible();
  await expect(body).not.toHaveClass(/game-in-progress/);
  await expect(body).toHaveCSS("overscroll-behavior-y", "auto");
});

test("Seafarers selection changes the preview independently of themes and can return to Original", async ({ page }, testInfo) => {
  await page.goto("/");
  const versions = page.getByRole("combobox", { name: "Game version", exact: true });
  await expect(versions).toHaveValue("original");
  await expect(page.locator(".terrain-hex")).toHaveCount(19);
  await versions.selectOption("seafarers");
  await expect(page.locator(".terrain-hex")).toHaveCount(42);
  await expect(page.getByText("Heading for New Shores", { exact: true })).toBeVisible();
  const island = page.getByRole("region", { name: "Island preview", exact: true, includeHidden: true });
  const geometry = await themeBoardGeometry(island);
  for (const theme of BOARD_THEMES) {
    const dialog = await openHomeThemes(page);
    await dialog.getByRole("radio", { name: theme.name, exact: true }).check();
    await dialog.getByRole("button", { name: "Close dialog", exact: true }).click();
    await showHomeView(page, "Island");
    await expect(page.locator(".board-surface")).toHaveAttribute("data-variant", "seafarers");
    await expect(page.locator(".board-surface")).toHaveAttribute("data-theme", theme.id);
    await expect(page.locator(".terrain-hex")).toHaveCount(42);
    const goldFields = page.getByRole("img", { name: /^Gold, gold, roll/ });
    await expect(goldFields).toHaveCount(2);
    for (const goldField of await goldFields.all()) {
      await expect(goldField.locator(":scope > polygon").nth(1)).toHaveAttribute("fill", ALL_THEMES[theme.id].terrain.gold.fill);
      const artwork = goldField.locator(".gold-field-artwork");
      await expect(artwork).toHaveAttribute("aria-hidden", "true");
      await expect(artwork).toHaveAttribute("pointer-events", "none");
      await expect(artwork.locator(".gold-ingots > g")).toHaveCount(1);
      await expect(artwork.locator(".gold-coins > g")).toHaveCount(2);
      await expect(artwork.locator(".gold-sparkles")).toBeVisible();
      await expect(goldField.locator(".number-token")).toBeVisible();
      await expect(goldField.locator(":scope > text")).toHaveText("GOLD");
      await expect(goldField.locator(":scope > text")).toHaveAttribute("fill", ALL_THEMES[theme.id].terrain.gold.ink);
      expect(await goldField.evaluate(element => {
        const goldBar = element.querySelector(".gold-ingots")!.getBoundingClientRect();
        const label = element.querySelector(":scope > text")!.getBoundingClientRect();
        return goldBar.bottom < label.top;
      }), "The gold bar stays above the terrain label").toBe(true);
    }
    expect(await themeBoardGeometry(island)).toEqual(geometry);
    await noHorizontalOverflow(page);
    await screenshot(page, testInfo, `gold-fields-${theme.id}`, false);
  }
  await screenshot(page, testInfo, "seafarers-preview", false);
  await showHomeView(page, "Setup");
  await versions.selectOption("original");
  await expect(page.locator(".terrain-hex")).toHaveCount(19);
  await expect(page.locator(".board-surface")).toHaveAttribute("data-variant", "original");
});

test("Seafarers starts on its exact preview and confirms a free coastal ship with variant-specific help", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.getByRole("combobox", { name: "Human players", exact: true }).selectOption("3");
  await page.getByRole("combobox", { name: "Game version", exact: true }).selectOption("seafarers");
  const mapCode = await page.getByRole("textbox", { name: "Map code", exact: true, includeHidden: true }).inputValue();
  await seedRandomness(page, 17);
  let seed = 17;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  const preview = createBoard(seededRandom(mapCode), "seafarers");
  let state = createGame(["Alex", "Sam", "Jordan"].map((name, index) => ({
    name, color: ["#b85d47", "#477c91", "#c1953d"][index]!, control: "human" as const,
  })), random, preview);
  await page.getByRole("button", { name: "Let's settle in", exact: true }).click();
  await revealHand(page);
  await showView(page, "board");
  await expect(page.locator(".board-surface")).toHaveAttribute("data-variant", "seafarers");
  const vertexId = legalSettlementVertices(state, state.activePlayerId).find(id => {
    const placed = applyAction(state, state.activePlayerId, { type: "place-settlement", vertexId: id });
    return legalShipEdges(placed, placed.activePlayerId).length > 0;
  })!;
  await page.getByRole("button", { name: `Place settlement at ${vertexId}`, exact: true }).click();
  await page.getByRole("button", { name: "Confirm placement", exact: true }).click();
  state = applyAction(state, state.activePlayerId, { type: "place-settlement", vertexId });
  await page.getByRole("button", { name: "Choose ships", exact: true }).click();
  const edgeId = legalShipEdges(state, state.activePlayerId)[0]!;
  await page.getByRole("button", { name: `Build ship at ${edgeId}`, exact: true }).click();
  await expect(page.getByText("Build a ship here?", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Confirm placement", exact: true }).click();
  await revealHand(page);
  await showView(page, "board");
  await expect(page.getByRole("img", { name: `${state.players.find(player => player.id === state.activePlayerId)!.name}'s ship at ${edgeId}`, exact: true })).toBeVisible();
  await noPageOverflow(page);
  await screenshot(page, testInfo, "seafarers-starting-ship", false);
  await chooseGameOption(page, "Help");
  const help = page.getByRole("dialog", { name: "Help", exact: true });
  await expect(help.getByRole("heading", { name: "Seafarers rules", exact: true })).toBeVisible();
  await expect(help.getByText("Good neighbors. Clever trades. Thirteen victory points.", { exact: true })).toBeVisible();
  await expect(help.getByText("Ship", { exact: true })).toHaveCount(1);
});

async function seedRandomness(page: Page, initialSeed: number, initialValues: number[] = []) {
  await page.evaluate(({ initialSeed, initialValues }) => {
    let seed = initialSeed;
    Object.defineProperty(crypto, "getRandomValues", {
      configurable: true,
      value: (values: Uint32Array) => {
        for (let index = 0; index < values.length; index++) {
          if (initialValues.length) {
            values[index] = initialValues.shift()!;
          } else {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            values[index] = seed;
          }
        }
        return values;
      },
    });
  }, { initialSeed, initialValues });
}

async function seedGameRandomness(page: Page, playerCount = 3, initialSeed = 1, mapCode = initialSeed === 1 ? "225DV7H4" : "22222229") {
  let seed = initialSeed;
  const nextRandomValue = () => seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  const playerOrderValues = Array.from({ length: playerCount - 1 }, nextRandomValue);
  createBoard(() => nextRandomValue() / 0x100000000);
  await showHomeView(page, "Island");
  await page.getByRole("textbox", { name: "Map code", exact: true }).fill(mapCode);
  await page.getByRole("textbox", { name: "Map code", exact: true }).press("Enter");
  await showHomeView(page, "Setup");
  await seedRandomness(page, seed, playerOrderValues);
  return {
    board: createBoard(seededRandom(mapCode)),
    random: () => (playerOrderValues.length ? playerOrderValues.shift()! : nextRandomValue()) / 0x100000000,
  };
}

async function placeStartingPieces(page: Page) {
  await showView(page, "board");
  const settlement = page.getByRole("button", { name: /^Place settlement at/ }).first();
  await expect(settlement).toBeVisible({ timeout: 15_000 });
  await settlement.click();
  await page.getByRole("button", { name: "Confirm placement", exact: true }).click();
  await page.getByRole("button", { name: /^Build road at/ }).first().click();
  await page.getByRole("button", { name: "Confirm placement", exact: true }).click();
}

async function prepareRollGame(page: Page, startingPieces?: readonly (readonly [number, number])[], mapCode?: string) {
  await page.goto("/");
  await page.getByRole("combobox", { name: "Human players", exact: true }).selectOption("3");
  const fixture = await seedGameRandomness(page, 3, 1, mapCode);
  let state = createGame(["Alex", "Sam", "Jordan"].map((name, index) => ({
    name, color: ["#b85d47", "#477c91", "#c1953d"][index]!, control: "human" as const,
  })), fixture.random, fixture.board);
  await page.getByRole("button", { name: "Let's settle in", exact: true }).click();
  for (let placement = 0; placement < 6; placement++) {
    if (placement !== 3) await revealHand(page);
    await showView(page, "board");
    const vertexId = startingPieces ? `vertex-${startingPieces[placement]![0]}` : legalSettlementVertices(state, state.activePlayerId)[0]!;
    await page.getByRole("button", { name: `Place settlement at ${vertexId}`, exact: true }).click();
    await page.getByRole("button", { name: "Confirm placement", exact: true }).click();
    state = applyAction(state, state.activePlayerId, { type: "place-settlement", vertexId });
    const collection = page.getByRole("region", { name: "Resource collection" });
    if (placement >= 3) {
      await expect(collection).toBeInViewport({ ratio: 1 });
      const player = state.players.find(player => player.id === state.activePlayerId)!;
      for (const resource of RESOURCES.filter(resource => player.resources[resource] > 0)) {
        await expect(collection.getByRole("listitem", { name: `${RESOURCE_NAMES[resource]} +${player.resources[resource]}`, exact: true })).toBeVisible();
      }
    } else {
      await expect(collection).toHaveCount(0);
    }
    const edgeId = startingPieces ? `edge-${startingPieces[placement]![1]}` : legalRoadEdges(state, state.activePlayerId)[0]!;
    await page.getByRole("button", { name: `Build road at ${edgeId}`, exact: true }).click();
    await page.getByRole("button", { name: "Confirm placement", exact: true }).click();
    state = applyAction(state, state.activePlayerId, { type: "place-road", edgeId });
  }
  await showView(page, "hand");
  return state;
}

async function prepareSeededRollGame(page: Page, initialSeed: number, startingPieces: readonly (readonly [number, number])[]) {
  await page.goto("/");
  await page.getByRole("combobox", { name: "Human players", exact: true }).selectOption("3");
  const fixture = await seedGameRandomness(page, 3, initialSeed);
  let state = createGame(["Alex", "Sam", "Jordan"].map((name, index) => ({
    name, color: ["#b85d47", "#477c91", "#c1953d"][index]!, control: "human" as const,
  })), fixture.random, fixture.board);
  await page.getByRole("button", { name: "Let's settle in", exact: true }).click();
  for (let placement = 0; placement < 6; placement++) {
    if (placement !== 3) await revealHand(page);
    await showView(page, "board");
    const vertexId = `vertex-${startingPieces[placement]![0]}`;
    await page.getByRole("button", { name: `Place settlement at ${vertexId}`, exact: true }).click();
    await page.getByRole("button", { name: "Confirm placement", exact: true }).click();
    state = applyAction(state, state.activePlayerId, { type: "place-settlement", vertexId });
    const collection = page.getByRole("region", { name: "Resource collection" });
    const player = state.players.find(player => player.id === state.activePlayerId)!;
    if (placement >= 3 && resourceTotal(player.resources) > 0) {
      await expect(collection).toBeInViewport({ ratio: 1 });
      await collection.getByRole("button", { name: "Dismiss resource collection", exact: true }).click();
    } else {
      await expect(collection).toHaveCount(0);
    }
    const edgeId = `edge-${startingPieces[placement]![1]}`;
    await page.getByRole("button", { name: `Build road at ${edgeId}`, exact: true }).click();
    await page.getByRole("button", { name: "Confirm placement", exact: true }).click();
    state = applyAction(state, state.activePlayerId, { type: "place-road", edgeId });
  }
  await showView(page, "hand");
  return state;
}

async function chooseDice(page: Page, dice: [number, number]) {
  await page.evaluate(values => {
    let index = 0;
    Object.defineProperty(crypto, "getRandomValues", {
      configurable: true,
      value: (target: Uint32Array) => {
        for (let position = 0; position < target.length; position++) {
          target[position] = Math.floor(((values[index++ % 2]! - 0.5) / 6) * 0x100000000);
        }
        return target;
      },
    });
  }, dice);
}

test("robbery notices reveal the stolen card only to the thief and victim across private handoffs", async ({ page, isMobile }, testInfo) => {
  const browserErrors: string[] = [];
  page.on("pageerror", error => browserErrors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("requestfailed", request => browserErrors.push(`${request.url()}: ${request.failure()?.errorText}`));
  await page.emulateMedia({ reducedMotion: "reduce" });
  if (isMobile) await page.setViewportSize({ width: 320, height: 568 });
  let state = await prepareRollGame(page);
  const thief = state.players.find(player => player.id === state.activePlayerId)!;
  await chooseDice(page, [1, 6]);
  await page.getByRole("button", { name: "Roll the dice", exact: true }).click();
  let diceIndex = 0;
  state = applyAction(state, thief.id, { type: "roll" }, () => ([1, 6][diceIndex++]! - 0.5) / 6);
  expect(state.phase.type).toBe("robber");
  const destination = state.board.tiles.find(tile => tile.id !== state.robberTileId && tile.vertexIds.some(vertexId => {
    const ownerId = state.board.vertices.find(vertex => vertex.id === vertexId)!.building?.playerId;
    return state.players.some(player => player.id === ownerId && player.id !== thief.id && resourceTotal(player.resources) > 0);
  }))!;
  await showView(page, "board");
  await page.getByRole("button", { name: /^Move robber to / }).nth(state.board.tiles.filter(tile => tile.id !== state.robberTileId).indexOf(destination)).click();
  await page.getByRole("button", { name: "Confirm placement", exact: true }).click();
  state = applyAction(state, thief.id, { type: "move-robber", tileId: destination.id });
  const victim = state.players.find(player => state.phase.type === "steal" && state.phase.victimIds.includes(player.id) && resourceTotal(player.resources) > 0)!;
  const bystander = state.players.find(player => player.id !== thief.id && player.id !== victim.id)!;
  await page.clock.install({ time: new Date("2030-01-01T00:00:00Z") });
  await page.clock.pauseAt(new Date("2030-01-01T00:00:01Z"));
  await showView(page, "hand");
  await page.getByRole("button", { name: `${state.players.findIndex(player => player.id === victim.id) + 1} ${victim.name} ${resourceTotal(victim.resources)} resources`, exact: true }).click();
  await chooseDice(page, [1, 1]);
  await page.getByRole("dialog", { name: "Confirm theft", exact: true }).getByRole("button", { name: "Confirm", exact: true }).click();
  state = applyAction(state, thief.id, { type: "steal", playerId: victim.id }, () => 0.5 / 6);
  const resource = RESOURCE_NAMES[state.thefts.at(-1)!.resource];
  const notice = page.getByRole("region", { name: "Robbery notification", exact: true });
  const result = page.getByRole("status", { name: "Robbery result", exact: true });
  const dismiss = page.getByRole("button", { name: "Dismiss robbery notification", exact: true });
  await notice.scrollIntoViewIfNeeded();
  await expect(notice).toBeInViewport({ ratio: 1 });
  expect(await notice.evaluate(element => element.parentElement?.parentElement?.getAttribute("aria-label"))).toBe("Turn controls");
  await expect(notice).toHaveCSS("position", "absolute");
  const noticeBounds = (await notice.boundingBox())!;
  const turnBounds = (await page.getByRole("region", { name: "Turn controls", exact: true }).boundingBox())!;
  expect(turnBounds.y).toBeGreaterThanOrEqual(noticeBounds.y + noticeBounds.height);
  expect(turnBounds.y - noticeBounds.y - noticeBounds.height).toBeLessThanOrEqual(12);
  expect(turnBounds.x).toBeCloseTo(noticeBounds.x, 0);
  expect(turnBounds.width).toBeCloseTo(noticeBounds.width, 0);
  await expect(notice.getByRole("heading", { name: `You stole from ${victim.name}`, exact: true })).toBeVisible();
  await expect(notice.getByText("+1", { exact: true })).toBeVisible();
  await expect(result).toHaveText(`You stole 1 ${resource} from ${victim.name}.`);
  await expect(page.getByRole("region", { name: "Resource collection", includeHidden: true })).toHaveCount(0);
  await noPageOverflow(page);
  await screenshot(page, testInfo, "robbery-thief", false);

  async function passTo(name: string) {
    await chooseGameOption(page, "Pass device");
    await page.getByRole("dialog", { name: "Pass the device", exact: true }).getByRole("button", { name, exact: true }).click();
    await privateHandIsAbsent(page);
    expect(await revealHand(page)).toBe(name);
  }

  await passTo(bystander.name);
  await page.clock.runFor(6000);
  await expect(notice).toHaveCount(0);
  await expect(result).toBeEmpty();
  await passTo(victim.name);
  await notice.scrollIntoViewIfNeeded();
  await expect(notice).toBeInViewport({ ratio: 1 });
  await expect(notice.getByRole("heading", { name: `${thief.name} robbed you`, exact: true })).toBeVisible();
  await expect(notice.getByText("-1", { exact: true })).toBeVisible();
  await expect(result).toHaveText(`${thief.name} robbed you of 1 ${resource}.`);
  await expect(dismiss).toBeInViewport({ ratio: 1 });
  await noPageOverflow(page);
  await screenshot(page, testInfo, "robbery-victim", false);
  const turnControls = page.getByRole("region", { name: "Turn controls", exact: true });
  const hand = page.getByRole("complementary", { name: "Your hand and actions", exact: true }).locator(".hand-content");
  const turnBeforeDismissal = await turnControls.boundingBox();
  const handBeforeDismissal = await hand.boundingBox();
  await dismiss.focus();
  await page.keyboard.press("Enter");
  await expect(notice).toHaveCount(0);
  await expect(result).toBeEmpty();
  expect(await turnControls.boundingBox()).toEqual(turnBeforeDismissal);
  expect(await hand.boundingBox()).toEqual(handBeforeDismissal);

  // Dismissing the victim's notice must not acknowledge the thief's notice.
  await passTo(thief.name);
  await notice.scrollIntoViewIfNeeded();
  await expect(notice.getByText("+1", { exact: true })).toBeVisible();
  await page.clock.runFor(4999);
  await expect(notice).toHaveCount(1);
  await page.clock.runFor(1);
  await expect(notice).toHaveCount(0);
  await expect(result).toBeEmpty();
  await passTo(victim.name);
  await expect(notice).toHaveCount(0);
  await expect(result).toBeEmpty();
  await passTo(thief.name);
  await expect(notice).toHaveCount(0);
  await expect(result).toBeEmpty();
  expect(browserErrors).toEqual([]);
});

test("settlement build hides descriptions for the roll requirement and missing resources", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  let state = await prepareRollGame(page);
  await revealBuildSection(page);
  const building = page.getByRole("region", { name: "Build a little bigger", exact: true });
  const settlement = building.getByRole("button", { name: /^Build settlement\b/ });
  const explanation = building.locator("#settlement-build-explanation");
  await expect(settlement).toBeDisabled();
  await expect(settlement).not.toHaveAttribute("aria-describedby");
  await expect(explanation).toHaveCount(0);

  await chooseDice(page, [1, 1]);
  await page.getByRole("button", { name: "Roll the dice", exact: true }).click();
  state = applyAction(state, state.activePlayerId, { type: "roll" }, () => 0);
  const player = state.players.find(player => player.id === state.activePlayerId)!;
  const missing = RESOURCES.filter(resource => player.resources[resource] < COSTS.settlement[resource]);
  expect(missing.length).toBeGreaterThan(0);
  await expect(settlement).toBeDisabled();
  await expect(settlement).not.toHaveAttribute("aria-describedby");
  await expect(settlement).toHaveAttribute("title", "You need more resources.");
  await expect(explanation).toHaveCount(0);
  await settlement.scrollIntoViewIfNeeded();
  await expect(settlement).toBeInViewport({ ratio: 1 });
  await noPageOverflow(page);
  await screenshot(page, testInfo, "settlement-missing-resources", false);
});

test("settlement build shows a description only for exhausted pieces and recovers after a city upgrade", async ({ page, isMobile }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  if (isMobile) await page.setViewportSize({ width: 320, height: 844 });
  // Give Sam room to expand and produce the required cards through real rolls, without injecting state.
  let state = await prepareRollGame(page, [[20, 41], [0, 0], [2, 1], [4, 3], [7, 7], [15, 33]], "222222AF");
  await revealBuildSection(page);
  const playerId = state.activePlayerId;
  const building = page.getByRole("region", { name: "Build a little bigger", exact: true });
  const settlement = building.getByRole("button", { name: /^Build settlement\b/ });
  const city = building.getByRole("button", { name: /^Upgrade to city\b/ });
  const explanation = building.locator("#settlement-build-explanation");
  const stockReason = "All 5 settlements are on the board. Upgrade one to a city to free a settlement piece.";

  // Owning settlements to upgrade keeps the city control free of a stock explanation.
  await expect(city).not.toHaveAttribute("aria-describedby");
  await expect(building.locator("#city-build-explanation")).toHaveCount(0);

  async function expectUnavailable(reason: string) {
    const dismissCollection = page.getByRole("button", { name: "Dismiss resource collection", exact: true });
    if (await dismissCollection.isVisible()) await dismissCollection.click();
    await expect(settlement).toBeDisabled();
    await expect(settlement).toHaveAccessibleDescription(reason);
    await expect(settlement).toHaveAttribute("title", reason);
    await expect(explanation).toHaveText(reason);
    await explanation.scrollIntoViewIfNeeded();
    await expect(explanation).toBeInViewport({ ratio: 1 });
    await noPageOverflow(page);
  }

  async function build(piece: "road" | "settlement" | "city", location: number) {
    const label = piece === "city" ? "Upgrade to city" : `Build ${piece}`;
    await building.getByRole("button", { name: new RegExp(`^${label}\\b`) }).click();
    await showView(page, "board");
    const target = piece === "road" ? `Build road at edge-${location}`
      : `${piece === "city" ? "Upgrade to city" : "Place settlement"} at vertex-${location}`;
    await page.getByRole("button", { name: target, exact: true }).click();
    await page.getByRole("button", { name: "Confirm placement", exact: true }).click();
    state = applyAction(state, playerId, piece === "road"
      ? { type: "place-road", edgeId: `edge-${location}` }
      : { type: piece === "city" ? "place-city" : "place-settlement", vertexId: `vertex-${location}` });
    await showView(page, "hand");
  }

  const rollTotals = [3, 3, 3, 2, 3, 2, 2, 3, 3, 5, 5, 5, 2];
  for (const [index, total] of rollTotals.entries()) {
    const dice: [number, number] = [Math.max(1, total - 6), Math.min(6, total - 1)];
    await showView(page, "hand");
    if (index === 12) await expectUnavailable(stockReason);
    await chooseDice(page, dice);
    await page.getByRole("button", { name: "Roll the dice", exact: true }).click();
    let diceIndex = 0;
    state = applyAction(state, state.activePlayerId, { type: "roll" }, () => (dice[diceIndex++]! - 0.5) / 6);
    await expect(page.getByRole("button", { name: "End turn & pass device", exact: true })).toBeEnabled();
    if (index === 3) {
      expect(legalSettlementVertices(state, playerId)).toHaveLength(0);
      await expect(settlement).toBeDisabled();
      await expect(settlement).not.toHaveAttribute("aria-describedby");
      await expect(explanation).toHaveCount(0);
      await screenshot(page, testInfo, "settlement-no-legal-location", false);
      await build("road", 40);
      await expect(settlement).toBeEnabled();
      await expect(settlement).not.toHaveAttribute("aria-describedby");
      await expect(explanation).toHaveCount(0);
      await build("settlement", 31);
      await build("road", 42);
      expect(legalSettlementVertices(state, playerId)).toEqual(["vertex-33"]);
      await expect(settlement).toBeDisabled();
      await expect(settlement).not.toHaveAttribute("aria-describedby");
      await expect(explanation).toHaveCount(0);
    } else if (index === 6) {
      await build("settlement", 33);
    } else if (index === 9) {
      await build("road", 36);
      await build("settlement", 29);
      await build("road", 32);
      await expectUnavailable(stockReason);
    }
    if (index < rollTotals.length - 1) {
      await page.getByRole("button", { name: "End turn & pass device", exact: true }).click();
      state = applyAction(state, state.activePlayerId, { type: "end-turn" });
      await revealHand(page);
    }
  }
  const player = state.players.find(player => player.id === playerId)!;
  expect(RESOURCES.every(resource => player.resources[resource] >= COSTS.settlement[resource])).toBe(true);
  await expect(page.getByRole("img", { name: /Sam's settlement at /, includeHidden: true })).toHaveCount(5);
  await expectUnavailable(stockReason);
  await screenshot(page, testInfo, "settlement-pieces-exhausted", false);
  await build("city", 15);
  await expect(page.getByRole("img", { name: /Sam's settlement at /, includeHidden: true })).toHaveCount(4);
  await expect(page.getByRole("img", { name: /Sam's city at /, includeHidden: true })).toHaveCount(1);
  await expect(page.getByRole("img", { name: /Sam's city at /, includeHidden: true }).locator("text")).toHaveText("S");
  await expect(page.getByRole("img", { name: /Sam's settlement at /, includeHidden: true }).locator("text")).toHaveText(["S", "S", "S", "S"]);
  await expect(settlement).toBeEnabled();
  await expect(settlement).not.toHaveAttribute("aria-describedby");
  await expect(explanation).toHaveCount(0);
  await settlement.scrollIntoViewIfNeeded();
  await screenshot(page, testInfo, "settlement-piece-returned", false);
  await build("settlement", 26);
  // A city does not consume a settlement piece; the five remaining settlements do.
  await expect(page.getByRole("img", { name: /Sam's settlement at /, includeHidden: true })).toHaveCount(5);
  await expectUnavailable(stockReason);
});

test("development card purchase requires resources and keyboard confirmation", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  let state = await prepareRollGame(page);
  await revealBuildSection(page);
  const buyerId = state.activePlayerId;
  const buy = page.getByRole("button", { name: "Buy a card 1 Wool 1 Grain 1 Ore", exact: true });
  const developmentHand = page.getByRole("region", { name: "Your development cards", exact: true });
  const privateResources = page.getByRole("region", { name: "Private resources", exact: true });
  const resourceCounts = privateResources.getByText(/^\d+ (Wood|Brick|Wool|Grain|Ore)$/);
  // Sam starts with wool. Rolls of three and eight add grain and ore before his next turn.
  const rolls: [number, number][] = [[1, 2], [2, 6], [1, 1], [1, 1]];
  for (const [turn, dice] of rolls.entries()) {
    if (turn === 3) {
      expect(state.activePlayerId).toBe(buyerId);
      const resources = state.players.find(player => player.id === buyerId)!.resources;
      expect(RESOURCES.every(resource => resources[resource] >= COSTS.development[resource])).toBe(true);
    }
    await expect(buy).toBeDisabled();
    await chooseDice(page, dice);
    await page.getByRole("button", { name: "Roll the dice", exact: true }).click();
    let diceIndex = 0;
    state = applyAction(state, state.activePlayerId, { type: "roll" }, () => (dice[diceIndex++]! - 0.5) / 6);
    await expect(page.getByRole("button", { name: "End turn & pass device", exact: true })).toBeEnabled();
    if (turn < 3) {
      await expect(buy).toBeDisabled();
      await page.getByRole("button", { name: "End turn & pass device", exact: true }).click();
      state = applyAction(state, state.activePlayerId, { type: "end-turn" });
      await revealHand(page);
    }
  }
  const beforePurchase = state.players.find(player => player.id === buyerId)!;
  await expect(buy).toBeEnabled();
  await expect(developmentHand).toHaveCount(0);
  await expect(page.getByText("Your next big idea is waiting.", { exact: false })).toHaveCount(0);
  await buy.scrollIntoViewIfNeeded();
  await screenshot(page, testInfo, "empty-development-hand", false);
  await expect(resourceCounts).toHaveText(RESOURCES.map(resource => `${beforePurchase.resources[resource]} ${RESOURCE_NAMES[resource]}`));
  await buy.focus();
  await page.keyboard.press("Enter");
  const confirmation = page.getByRole("dialog", { name: "Invest in a development card", exact: true });
  await expect(confirmation).toBeVisible();
  await expect(confirmation.locator(".eyebrow")).toHaveText(state.players.find(player => player.id === buyerId)!.name);
  await expect(confirmation).toContainText("Pay one wool, one grain, and one ore. Your new card stays private. Action cards cannot be played until a later turn.");
  await expect(confirmation.getByRole("button", { name: "Close dialog", exact: true })).toBeFocused();
  await expectResourceInventory(confirmation, beforePurchase.resources);
  await screenshot(page, testInfo, "development-purchase-confirmation", false);
  await page.keyboard.press("Escape");
  await expect(confirmation).toHaveCount(0);
  await expect(buy).toBeFocused();
  await expect(resourceCounts).toHaveText(RESOURCES.map(resource => `${beforePurchase.resources[resource]} ${RESOURCE_NAMES[resource]}`));
  await expect(developmentHand).toHaveCount(0);
  await expectResourceBank(page, state.bank);

  await page.keyboard.press("Space");
  await page.keyboard.press("Tab");
  await expect(confirmation.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(confirmation).toHaveCount(0);
  await expect(buy).toBeFocused();
  await expect(resourceCounts).toHaveText(RESOURCES.map(resource => `${beforePurchase.resources[resource]} ${RESOURCE_NAMES[resource]}`));
  await expect(developmentHand).toHaveCount(0);

  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(confirmation.getByRole("button", { name: "Confirm", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  state = applyAction(state, buyerId, { type: "buy-development" });
  await expect(confirmation).toHaveCount(0);
  await expect(resourceCounts).toHaveText(RESOURCES.map(resource => `${beforePurchase.resources[resource] - COSTS.development[resource]} ${RESOURCE_NAMES[resource]}`));
  await expect(developmentHand.locator(":scope > div").getByText("1", { exact: true })).toBeVisible();
  await expect(developmentHand.getByRole("listitem")).toHaveCount(1);
  const knight = developmentHand.getByRole("button", { name: /^Knight 1 card Move the robber/ });
  await expect(knight.locator('svg[data-development-kind="knight"]')).toBeVisible();
  await knight.focus();
  await page.keyboard.press("Enter");
  const development = page.getByRole("dialog", { name: "A card up your sleeve", exact: true });
  await expect(development.getByRole("region", { name: "Your current resources", includeHidden: true })).toHaveCount(0);
  await expect(development.getByRole("button", { pressed: true })).toContainText("Knight");
  await expect(development.getByRole("button", { name: "Confirm Knight", exact: true })).toBeDisabled();
  await screenshot(page, testInfo, "new-development-card", false);
  await page.keyboard.press("Escape");
  await expect(knight).toBeFocused();
  await expectResourceBank(page, state.bank);
  await expect(page.getByRole("img", { name: `${state.developmentDeck.length} development cards in bank`, exact: true })).toBeVisible();
  await expect(buy).toBeDisabled();
  expect(state.developmentDeck.filter(kind => kind === "knight")).toHaveLength(13);
  await chooseGameOption(page, "Help");
  const help = page.getByRole("dialog", { name: "Help", exact: true });
  const knightReference = help.getByRole("list", { name: "All development cards", exact: true })
    .getByRole("listitem").filter({ has: page.getByRole("heading", { name: "Knight", exact: true }) });
  await knightReference.scrollIntoViewIfNeeded();
  await expect(knightReference.getByText("14 in starting deck", { exact: true })).toBeVisible();
  await expect(help.getByRole("region", { name: "Current table", exact: true })).toHaveCount(0);
  await help.getByRole("button", { name: "Close dialog", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await noPageOverflow(page);
});

test("Cancel Knight restores the card and turn until the robber move is confirmed", async ({ page, isMobile }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  let state = await prepareRollGame(page);
  await revealBuildSection(page);
  const buyerId = state.activePlayerId;
  const buyerName = state.players.find(player => player.id === buyerId)!.name;
  const seats = isMobile ? page.getByRole("region", { name: "Players and awards", exact: true }) : page.locator(".table-seats");
  const buyerSeat = seats.locator(".player-seat").filter({ has: page.getByRole("group", { name: `${buyerName}'s card counts`, exact: true }) });
  const roll = page.getByRole("button", { name: "Roll the dice", exact: true });
  const endTurn = page.getByRole("button", { name: "End turn & pass device", exact: true });
  const developmentHand = page.getByRole("region", { name: "Your development cards", exact: true, includeHidden: true });
  const knight = developmentHand.getByRole("button", { name: /^Knight 1 card Move the robber/ });
  const development = page.getByRole("dialog", { name: "A card up your sleeve", exact: true });
  // The dice panel now stays visible on the board view, so target its Cancel Knight copy explicitly.
  const cancelKnight = page.getByRole("region", { name: "Turn controls", exact: true }).getByRole("button", { name: "Cancel Knight", exact: true });
  const board = page.getByRole("region", { name: "Game board", exact: true });
  const placement = page.getByRole("group", { name: "Placement confirmation", exact: true, includeHidden: true });
  const rolls: [number, number][] = [[1, 2], [2, 6], [1, 1], [1, 1]];
  for (const [turn, dice] of rolls.entries()) {
    await chooseDice(page, dice);
    await roll.click();
    let diceIndex = 0;
    state = applyAction(state, state.activePlayerId, { type: "roll" }, () => (dice[diceIndex++]! - 0.5) / 6);
    await expect(endTurn).toBeEnabled();
    if (turn < 3) {
      await endTurn.click();
      state = applyAction(state, state.activePlayerId, { type: "end-turn" });
      await revealHand(page);
    }
  }
  expect(state.activePlayerId).toBe(buyerId);
  await page.getByRole("button", { name: "Buy a card 1 Wool 1 Grain 1 Ore", exact: true }).click();
  await page.getByRole("dialog", { name: "Invest in a development card", exact: true }).getByRole("button", { name: "Confirm", exact: true }).click();
  state = applyAction(state, buyerId, { type: "buy-development" });
  const card = state.players.find(player => player.id === buyerId)!.developmentCards[0]!;
  expect(card.kind).toBe("knight");
  for (let turn = 0; turn < 3; turn++) {
    await endTurn.click();
    state = applyAction(state, state.activePlayerId, { type: "end-turn" });
    await revealHand(page);
    if (turn < 2) {
      await chooseDice(page, [1, 1]);
      await roll.click();
      state = applyAction(state, state.activePlayerId, { type: "roll" }, () => 0);
      await expect(endTurn).toBeEnabled();
    }
  }
  expect(state.activePlayerId).toBe(buyerId);
  expect(state.turnNumber).toBeGreaterThan(card.purchasedTurn);
  await showView(page, "board");
  const initialFrame = await boardFrame(page);
  const originalRobber = await board.getByRole("img", { name: /^Robber on / }).getAttribute("aria-label");
  const destination = state.board.tiles.find(tile => tile.id !== state.robberTileId && tile.vertexIds.some(vertexId => {
    const ownerId = state.board.vertices.find(vertex => vertex.id === vertexId)!.building?.playerId;
    return state.players.some(player => player.id === ownerId && player.id !== buyerId && resourceTotal(player.resources) > 0);
  }))!;
  const targetIndex = state.board.tiles.filter(tile => tile.id !== state.robberTileId).indexOf(destination);
  const robberTarget = board.getByRole("button", { name: /^Move robber to / }).nth(targetIndex);
  const defaultViewport = page.viewportSize()!;

  for (const returnPhase of ["roll", "actions"] as const) {
    await showView(page, "hand");
    if (returnPhase === "actions") {
      await chooseDice(page, [1, 1]);
      await roll.click();
      state = applyAction(state, buyerId, { type: "roll" }, () => 0);
      await expect(endTurn).toBeEnabled();
    }
    await knight.click();
    await expect(development.getByRole("button", { name: "Confirm Knight", exact: true })).toBeEnabled();
    await development.getByRole("button", { name: "Confirm Knight", exact: true }).click();
    state = applyAction(state, buyerId, { type: "play-development", cardId: card.id });
    await expect(development).toHaveCount(0);
    await expect(developmentHand).toHaveCount(0);
    await showView(page, "players");
    await expect(buyerSeat.getByRole("img", { name: "1 knight played", exact: true })).toBeVisible();
    await showView(page, "board");
    await expect(board.getByRole("button", { name: /^Move robber to / })).toHaveCount(18);
    await expect(board.getByRole("img", { name: /^Robber on / })).toHaveAttribute("aria-label", originalRobber!);
    await expect(cancelKnight).toBeInViewport({ ratio: 1 });
    const robberPrompt = page.getByRole("heading", { name: "Move the robber.", exact: true });
    await expect(robberPrompt).toBeVisible();
    expect(await robberPrompt.evaluate(element => element.scrollHeight <= element.clientHeight)).toBe(true);
    await expectBoardFrame(page, initialFrame);

    if (returnPhase === "roll") {
      await screenshot(page, testInfo, "cancel-knight-before-roll", false);
      await page.setViewportSize(isMobile ? { width: 390, height: 667 } : { width: 1280, height: 480 });
      await boardFrame(page);
      await cancelKnight.scrollIntoViewIfNeeded();
      await expect(cancelKnight).toBeInViewport({ ratio: 1 });
      await screenshot(page, testInfo, "cancel-knight-short-board", false);
      await showView(page, "hand");
      await cancelKnight.scrollIntoViewIfNeeded();
      await expect(cancelKnight).toBeInViewport({ ratio: 1 });
      await expect(roll).toBeDisabled();
      await expect(endTurn).toBeDisabled();
      await noPageOverflow(page);
      await screenshot(page, testInfo, "cancel-knight-short-hand", false);
      await page.setViewportSize(defaultViewport);
      await showView(page, "board");
    } else {
      // Cancelling only the tile preview must not undo the played Knight.
      for (const dismissal of ["Cancel", "Escape"]) {
        await robberTarget.click();
        const confirmation = await expectPlacementConfirmation(page, robberTarget, destination.id);
        if (dismissal === "Cancel") await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
        else await page.keyboard.press("Escape");
        await expect(placement).toHaveCount(0);
        await expect(robberTarget).toHaveAttribute("aria-pressed", "false");
        await expect(robberTarget).toBeFocused();
        await expect(cancelKnight).toBeInViewport({ ratio: 1 });
        await expect(developmentHand).toHaveCount(0);
        await expect(board.getByRole("img", { name: /^Robber on / })).toHaveAttribute("aria-label", originalRobber!);
        await expectBoardFrame(page, initialFrame);
      }
      await robberTarget.click();
      await expectPlacementConfirmation(page, robberTarget, destination.id);
      await screenshot(page, testInfo, "cancel-knight-selected-robber", false);
      await showView(page, "hand");
      await expect(cancelKnight).toBeInViewport({ ratio: 1 });
      await expect(roll).toBeDisabled();
      await expect(endTurn).toBeDisabled();
      await noPageOverflow(page);
      await screenshot(page, testInfo, "cancel-knight-hand", false);
    }

    await cancelKnight.focus();
    await expect(cancelKnight).toBeFocused();
    await page.keyboard.press(returnPhase === "roll" ? "Space" : "Enter");
    state = applyAction(state, buyerId, { type: "cancel-knight" });
    await expect(page.getByRole("button", { name: "Cancel Knight", exact: true, includeHidden: true })).toHaveCount(0);
    await expect(placement).toHaveCount(0);
    await showView(page, "board");
    await expect(board.getByRole("button", { name: /^Move robber to / })).toHaveCount(0);
    await expect(board.getByRole("img", { name: /^Robber on / })).toHaveAttribute("aria-label", originalRobber!);
    await expectBoardFrame(page, initialFrame);
    await showView(page, "hand");
    await knight.scrollIntoViewIfNeeded();
    await expect(knight).toBeVisible();
    await expect(developmentHand.getByRole("listitem")).toHaveCount(1);
    if (returnPhase === "roll") {
      await expect(roll).toBeEnabled();
      await expect(endTurn).toBeDisabled();
    } else {
      await expect(roll).toBeDisabled();
      await expect(endTurn).toBeEnabled();
    }
    await showView(page, "players");
    await buyerSeat.scrollIntoViewIfNeeded();
    await expect(buyerSeat.getByRole("img", { name: "0 knights played", exact: true })).toBeVisible();
    await expect(buyerSeat.getByRole("img", { name: "1 development cards", exact: true })).toBeVisible();
    await showView(page, "hand");
  }

  await knight.click();
  await expect(development.getByRole("button", { name: "Confirm Knight", exact: true })).toBeEnabled();
  await development.getByRole("button", { name: "Confirm Knight", exact: true }).click();
  state = applyAction(state, buyerId, { type: "play-development", cardId: card.id });
  await showView(page, "board");
  await expect(placement).toHaveCount(0);
  await expect(robberTarget).toHaveAttribute("aria-pressed", "false");
  await robberTarget.click();
  const confirmation = await expectPlacementConfirmation(page, robberTarget, destination.id);
  await confirmation.getByRole("button", { name: "Confirm placement", exact: true }).click();
  state = applyAction(state, buyerId, { type: "move-robber", tileId: destination.id });
  expect(state.phase.type).toBe("steal");
  if (state.phase.type !== "steal") throw new Error("The chosen robber tile must have a victim");
  const victim = state.players.find(player => state.phase.type === "steal" && state.phase.victimIds.includes(player.id) && resourceTotal(player.resources) > 0)!;
  await expect(page.getByRole("button", { name: "Cancel Knight", exact: true, includeHidden: true })).toHaveCount(0);
  await showView(page, "board");
  await expect(board.getByRole("img", { name: /^Robber on / })).toHaveAccessibleName(`Robber on ${destination.terrain}${destination.number === null ? "" : ` ${destination.number}`}; production blocked`);
  await expect(placement).toHaveCount(0);
  await expectBoardFrame(page, initialFrame);
  await showView(page, "hand");
  await expect(developmentHand).toHaveCount(0);
  await expect(endTurn).toBeDisabled();
  const victims = page.getByRole("heading", { name: "Choose a player to steal from", exact: true }).locator("..");
  await expect(victims).toBeVisible();
  await screenshot(page, testInfo, "knight-theft-pending", false);
  await victims.getByRole("button", { name: `${state.players.findIndex(player => player.id === victim.id) + 1} ${victim.name} ${resourceTotal(victim.resources)} resources`, exact: true }).click();
  await chooseDice(page, [1, 1]);
  const theft = page.getByRole("dialog", { name: "Confirm theft", exact: true });
  await expect(theft).toContainText(`Steal one random resource from ${victim.name}.`);
  await expect(theft.getByRole("region", { name: "Your current resources", includeHidden: true })).toHaveCount(0);
  await screenshot(page, testInfo, "theft-confirmation", false);
  await theft.getByRole("button", { name: "Confirm", exact: true }).click();
  state = applyAction(state, buyerId, { type: "steal", playerId: victim.id }, () => 0.5 / 6);
  await expect(victims).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Cancel Knight", exact: true, includeHidden: true })).toHaveCount(0);
  await expect(developmentHand).toHaveCount(0);
  await expect(endTurn).toBeEnabled();
  await expect(roll).toBeDisabled();
  const resourceCounts = page.getByRole("region", { name: "Private resources", exact: true }).getByText(/^\d+ (Wood|Brick|Wool|Grain|Ore)$/);
  await expect(resourceCounts).toHaveText(RESOURCES.map(resource => `${state.players.find(player => player.id === buyerId)!.resources[resource]} ${RESOURCE_NAMES[resource]}`));
  await showView(page, "players");
  await buyerSeat.scrollIntoViewIfNeeded();
  await expect(buyerSeat.getByRole("img", { name: "1 knight played", exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await noPageOverflow(page);
});

test("played Knight and connected road counts show Largest Army and Longest Road in player seats", async ({ page, isMobile }, testInfo) => {
  test.slow();
  const browserErrors: string[] = [];
  page.on("pageerror", error => browserErrors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("requestfailed", request => browserErrors.push(`${request.url()}: ${request.failure()?.errorText}`));
  await page.emulateMedia({ reducedMotion: "reduce" });
  let state = await prepareRollGame(page);
  await revealBuildSection(page);
  const buyerId = state.activePlayerId;
  const buyerName = state.players.find(player => player.id === buyerId)!.name;
  const seats = isMobile ? page.getByRole("region", { name: "Players and awards", exact: true }) : page.locator(".table-seats");
  const buyerSeat = seats.locator(".player-seat").filter({ has: page.getByRole("group", { name: `${buyerName}'s card counts`, exact: true }) });
  const army = buyerSeat.getByRole("img", { name: /^\d+ knights? played/ });
  const roads = buyerSeat.getByRole("img", { name: /^\d+ connected roads?$/ });
  const largestArmy = buyerSeat.getByRole("img", { name: "Largest Army (+2 victory points)", exact: true });
  const longestRoad = buyerSeat.getByRole("img", { name: "Longest Road (+2 victory points)", exact: true });
  const awards = buyerSeat.getByRole("group", { name: "Victory point awards", exact: true });
  const dismissCollection = page.getByRole("button", { name: "Dismiss resource collection", exact: true });
  const rolls: [number, number][] = [[1, 2], [2, 6], [5, 5]];
  await showView(page, "players");
  // Each player has two disconnected starting roads, so their longest road is only one.
  for (const player of state.players) {
    expect(state.board.edges.filter(edge => edge.playerId === player.id)).toHaveLength(2);
    const counts = seats.getByRole("group", { name: `${player.name}'s card counts`, exact: true });
    await expect(counts.getByRole("img", { name: "1 connected road", exact: true }).locator("strong")).toHaveText("1");
  }
  // Nine purchases give three Knights. Keep them in hand, then play one on each subsequent turn.
  for (let turn = 0; turn <= 36; turn++) {
    await showView(page, "hand");
    const dice = rolls[turn % rolls.length]!;
    await chooseDice(page, dice);
    await page.getByRole("button", { name: "Roll the dice", exact: true }).click();
    let diceIndex = 0;
    state = applyAction(state, state.activePlayerId, { type: "roll" }, () => (dice[diceIndex++]! - 0.5) / 6);
    await expect(page.getByRole("button", { name: "End turn & pass device", exact: true })).toBeEnabled();
    if (state.activePlayerId === buyerId) {
      if (turn > 0 && turn <= 27) {
        await page.getByRole("button", { name: /^Buy a card\b/ }).click();
        await page.getByRole("dialog", { name: "Invest in a development card", exact: true }).getByRole("button", { name: "Confirm", exact: true }).click();
        state = applyAction(state, buyerId, { type: "buy-development" });
      }
      if (turn >= 30) {
        const card = state.players.find(player => player.id === buyerId)!.developmentCards.find(card => card.kind === "knight")!;
        await page.getByRole("region", { name: "Your development cards", exact: true }).getByRole("button", { name: /^Knight \d+ cards? / }).click();
        await page.getByRole("dialog", { name: "A card up your sleeve", exact: true }).getByRole("button", { name: "Confirm Knight", exact: true }).click();
        state = applyAction(state, buyerId, { type: "play-development", cardId: card.id });
        // Avoid theft and leave the resource-producing tiles used by this test unblocked.
        const destination = state.board.tiles.find(tile => tile.id !== state.robberTileId && ![3, 8, 10].includes(tile.number ?? 0) &&
          tile.vertexIds.every(vertexId => !state.board.vertices.find(vertex => vertex.id === vertexId)!.building))!;
        await showView(page, "board");
        const targetIndex = state.board.tiles.filter(tile => tile.id !== state.robberTileId).indexOf(destination);
        await page.getByRole("button", { name: /^Move robber to / }).nth(targetIndex).click();
        await page.getByRole("button", { name: "Confirm placement", exact: true }).click();
        state = applyAction(state, buyerId, { type: "move-robber", tileId: destination.id });
      }
      const buyer = state.players.find(player => player.id === buyerId)!;
      const holdsAward = buyer.knightsPlayed === 3;
      await showView(page, "players");
      await buyerSeat.scrollIntoViewIfNeeded();
      const label = `${buyer.knightsPlayed} ${buyer.knightsPlayed === 1 ? "knight" : "knights"} played`;
      await expect(army).toHaveAccessibleName(label);
      await expect(army).toHaveAttribute("title", label);
      await expect(army.locator('svg[data-development-kind="knight"]')).toBeVisible();
      await expect(army.locator("strong")).toHaveText(String(buyer.knightsPlayed));
      await expect(largestArmy).toHaveCount(holdsAward ? 1 : 0);
      await expect(awards).toHaveCount(holdsAward ? 1 : 0);
      await expect(army).toBeInViewport({ ratio: 1 });
      await expect(seats.getByRole("img", { name: /Largest Army/ })).toHaveCount(holdsAward ? 1 : 0);
      expect(await buyerSeat.innerText()).not.toMatch(/knights? played|Largest Army|\+2/);
      await expect(buyerSeat.locator(".player-score > span")).toHaveText(["VP", String(getScore(state, buyerId).total)]);
      await expect(buyerSeat.locator(".player-score")).not.toContainText("total");
      if (turn === 27) {
        expect(buyer.developmentCards.filter(card => card.kind === "knight")).toHaveLength(3);
        expect(buyer.knightsPlayed).toBe(0);
        if (await dismissCollection.isVisible()) await dismissCollection.click();
        await screenshot(page, testInfo, "three-knights-held-not-played", false);
      }
      await noPageOverflow(page);
    }
    if (turn < 36) {
      await showView(page, "hand");
      await page.getByRole("button", { name: "End turn & pass device", exact: true }).click();
      state = applyAction(state, state.activePlayerId, { type: "end-turn" });
      await revealHand(page);
      if (turn === 27) {
        await showView(page, "players");
        await expect(buyerSeat.locator(".player-score > span")).toHaveText(["VP", String(getScore(state, buyerId).public)]);
      }
    }
  }
  expect(state.awards.largestArmy).toBe(buyerId);
  if (await dismissCollection.isVisible()) await dismissCollection.click();
  await expect(largestArmy).toHaveCSS("color", "rgb(181, 138, 45)");
  await expect(largestArmy.locator("title")).toHaveText("Largest Army (+2 victory points)");
  await expect(seats.getByRole("img", { name: "Longest Road (+2 victory points)", exact: true })).toHaveCount(0);
  await screenshot(page, testInfo, "largest-army-player-seat", false);

  // Trade earned resources for bricks, then extend a starting road to five connected roads.
  await showView(page, "hand");
  for (const resource of ["wood", "wood", "wool", "grain"] as const) {
    await page.getByRole("button", { name: "Make a trade", exact: true }).click();
    const trade = page.getByRole("dialog", { name: "A fair exchange", exact: true });
    await trade.getByRole("button", { name: `Give ${RESOURCE_NAMES[resource]}`, exact: true }).click();
    await trade.getByRole("button", { name: "Receive Brick", exact: true }).click();
    await trade.getByRole("button", { name: "Confirm exchange", exact: true }).click();
    state = applyAction(state, buyerId, { type: "bank-trade", give: resource, receive: "brick" });
  }
  for (const [index, location] of [5, 4, 18, 17].entries()) {
    await showView(page, "hand");
    await page.getByRole("button", { name: /^Build road\b/ }).click();
    await showView(page, "board");
    await page.getByRole("button", { name: `Build road at edge-${location}`, exact: true }).click();
    await page.getByRole("button", { name: "Confirm placement", exact: true }).click();
    state = applyAction(state, buyerId, { type: "place-road", edgeId: `edge-${location}` });
    await showView(page, "players");
    await expect(roads).toHaveAccessibleName(`${index + 2} connected roads`);
    await expect(roads).toHaveAttribute("title", `${index + 2} connected roads`);
    await expect(roads.locator("strong")).toHaveText(String(index + 2));
    await expect(seats.getByRole("img", { name: "1 connected road", exact: true })).toHaveCount(2);
    const holdsLongestRoad = location === 17;
    expect(state.awards.longestRoad).toBe(holdsLongestRoad ? buyerId : null);
    await expect(longestRoad).toHaveCount(holdsLongestRoad ? 1 : 0);
    await expect(seats.getByRole("img", { name: "Longest Road (+2 victory points)", exact: true })).toHaveCount(holdsLongestRoad ? 1 : 0);
    await expect(largestArmy).toBeVisible();
    await expect(buyerSeat.locator(".player-score > span")).toHaveText(["VP", String(getScore(state, buyerId).total)]);
  }
  await expect(longestRoad).toHaveAttribute("title", "Longest Road (+2 victory points)");
  await expect(longestRoad).toHaveCSS("color", "rgb(181, 138, 45)");
  await expect(longestRoad.locator('svg[data-piece="road"]')).toBeVisible();
  await expect(roads.locator('svg[data-piece="road"]')).toBeVisible();
  await expect(roads).toHaveCSS("color", await army.evaluate(element => getComputedStyle(element).color));
  await expect(awards.getByRole("img")).toHaveCount(2);
  await expect(buyerSeat.locator(".player-card-counts").getByRole("img", { name: /Largest Army|Longest Road/ })).toHaveCount(0);
  await expect(buyerSeat.locator(".player-score").getByRole("group", { name: "Victory point awards", exact: true })).toBeVisible();
  expect(await buyerSeat.innerText()).not.toMatch(/Longest Road|Largest Army|\+2/);
  await expect(buyerSeat.locator(":scope > div")).toHaveCount(1);
  if (await dismissCollection.isVisible()) await dismissCollection.click();
  const viewports = isMobile
    ? [{ width: 390, height: 844 }, { width: 320, height: 568 }]
    : [{ width: 1440, height: 1000 }, { width: 1024, height: 768 }, { width: 1280, height: 480 }];
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await buyerSeat.scrollIntoViewIfNeeded();
    await expect(army).toBeInViewport({ ratio: 1 });
    await expect(roads).toBeInViewport({ ratio: 1 });
    await expect(largestArmy).toBeInViewport({ ratio: 1 });
    await expect(longestRoad).toBeInViewport({ ratio: 1 });
    const iconSizes = await buyerSeat.locator(".player-card-counts svg, .player-score svg").evaluateAll(elements => elements.map(element => {
      const { width, height } = element.getBoundingClientRect();
      return { width, height };
    }));
    expect(iconSizes).toHaveLength(6);
    for (const size of iconSizes) expect(size).toEqual(iconSizes[0]);
    const countGaps = await buyerSeat.locator(".player-card-stat").evaluateAll(elements => elements.map(element => {
      const icon = element.querySelector("svg")!.getBoundingClientRect();
      const count = element.querySelector("strong")!.getBoundingClientRect();
      return count.x - icon.right;
    }));
    const expectedGap = await buyerSeat.locator(".player-card-stat").first().evaluate(element => Number.parseFloat(getComputedStyle(element).columnGap));
    expect(countGaps).toEqual([expectedGap, expectedGap, expectedGap, expectedGap]);
    const victoryPointBounds = (await buyerSeat.locator(".player-score > .font-serif").boundingBox())!;
    const awardBounds = (await largestArmy.boundingBox())!;
    expect(awardBounds.x - victoryPointBounds.x - victoryPointBounds.width).toBeCloseTo(10);
    expect(awardBounds.y + awardBounds.height / 2).toBeCloseTo(victoryPointBounds.y + victoryPointBounds.height / 2);
    const roadBounds = (await longestRoad.boundingBox())!;
    expect(roadBounds.x - awardBounds.x - awardBounds.width).toBeCloseTo(10);
    expect(roadBounds.y + roadBounds.height / 2).toBeCloseTo(awardBounds.y + awardBounds.height / 2);
    expect(await buyerSeat.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await noPageOverflow(page);
    await screenshot(page, testInfo, `player-awards-${viewport.width}`, false);
  }
  expect(browserErrors).toEqual([]);
});

test("a won game pops the winner up over the board with the point breakdown and rematch choices", async ({ page, isMobile }, testInfo) => {
  test.slow();
  const browserErrors: string[] = [];
  page.on("pageerror", error => browserErrors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("requestfailed", request => browserErrors.push(`${request.failure()?.errorText}: ${request.url()}`));
  await page.emulateMedia({ reducedMotion: "reduce" });
  if (isMobile) await page.setViewportSize({ width: 320, height: 568 });

  // The board, player order and script below come from a deterministic simulation against
  // the engine: map 22222229 and initial seed 206 let the first roller win in 55 turns.
  let state = await prepareSeededRollGame(page, 206, [[40, 50], [0, 0], [2, 1], [4, 3], [7, 7], [42, 54]]);
  await revealBuildSection(page);
  const buyerId = state.activePlayerId;
  const buyerName = state.players.find(player => player.id === buyerId)!.name;
  const roll = page.getByRole("button", { name: "Roll the dice", exact: true });
  const endTurn = page.getByRole("button", { name: "End turn & pass device", exact: true });
  const dismissCollection = page.getByRole("button", { name: "Dismiss resource collection", exact: true });

  const scriptCosts = {
    road: { wood: 1, brick: 1 },
    settlement: { wood: 1, brick: 1, wool: 1, grain: 1 },
    city: { grain: 2, ore: 3 },
  } as const;
  const production = (number: number) => {
    let total = 0;
    for (const tile of state.board.tiles) {
      if (tile.id === state.robberTileId || tile.number !== number || tile.terrain === "desert") continue;
      for (const vertexId of tile.vertexIds) {
        const building = state.board.vertices.find(vertex => vertex.id === vertexId)!.building;
        if (building && building.playerId === buyerId) total += building.kind === "city" ? 2 : 1;
      }
    }
    return total;
  };
  const canAfford = (cost: Partial<Record<Resource, number>>) => {
    const player = state.players.find(player => player.id === buyerId)!;
    return Object.entries(cost).every(([resource, amount]) => player.resources[resource as Resource] >= amount!);
  };
  const needsRoad = () =>
    getLongestRoadLength(state, buyerId) < 5 || legalSettlementVertices(state, buyerId).length === 0;
  const bestRoadEdge = (): string | null => {
    if (!needsRoad()) return null;
    const edges = legalRoadEdges(state, buyerId);
    if (!edges.length || !canAfford(scriptCosts.road)) return null;
    let best: string | null = null;
    let bestLength = getLongestRoadLength(state, buyerId);
    for (const edgeId of edges) {
      let length: number;
      try { length = getLongestRoadLength(applyAction(state, buyerId, { type: "place-road", edgeId }), buyerId); }
      catch { continue; }
      if (length > bestLength) { bestLength = length; best = edgeId; }
    }
    return best ?? edges[0]!;
  };
  const nextBuildNeed = (): Partial<Record<Resource, number>> | null => {
    if (canAfford(scriptCosts.city) && legalCityVertices(state, buyerId).length > 0) return { ...scriptCosts.city };
    if (legalSettlementVertices(state, buyerId).length > 0) return { ...scriptCosts.settlement };
    if (needsRoad() && legalRoadEdges(state, buyerId).length > 0) return { ...scriptCosts.road };
    if (legalCityVertices(state, buyerId).length > 0) return { ...scriptCosts.city };
    return null;
  };
  const scriptAction = () => {
    if (state.phase.type !== "actions") return null;
    if (canAfford(scriptCosts.city) && legalCityVertices(state, buyerId).length > 0) {
      return { type: "place-city" as const, vertexId: legalCityVertices(state, buyerId)[0]! };
    }
    if (canAfford(scriptCosts.settlement) && legalSettlementVertices(state, buyerId).length > 0) {
      return { type: "place-settlement" as const, vertexId: legalSettlementVertices(state, buyerId)[0]! };
    }
    const edgeId = bestRoadEdge();
    if (edgeId) return { type: "place-road" as const, edgeId };
    return null;
  };
  const tradeToward = () => {
    const player = state.players.find(player => player.id === buyerId)!;
    const need = nextBuildNeed();
    if (!need) return null;
    for (const [resource, amount] of Object.entries(need)) {
      if (player.resources[resource as Resource] >= amount!) continue;
      if (state.bank[resource as Resource] <= 0) continue;
      const surplus = RESOURCES
        .filter(source => player.resources[source] >= getTradeRatio(state, buyerId, source) + (need[source] ?? 0))
        .sort((first, second) => player.resources[second] - player.resources[first])[0];
      if (surplus) return { type: "bank-trade" as const, give: surplus, receive: resource as Resource };
    }
    return null;
  };
  const diceFor = (total: number): [number, number] => [Math.min(6, total - 1), total - Math.min(6, total - 1)];
  const rollAndMirror = async (playerId: string, dice: [number, number]) => {
    await chooseDice(page, dice);
    await roll.click();
    let diceIndex = 0;
    state = applyAction(state, playerId, { type: "roll" }, () => (dice[diceIndex++ % 2]! - 0.5) / 6);
    await expect(endTurn).toBeEnabled();
    if (await dismissCollection.isVisible()) await dismissCollection.click();
  };

  async function playScriptedAction(action: NonNullable<ReturnType<typeof scriptAction>> | NonNullable<ReturnType<typeof tradeToward>>) {
    if (action.type === "bank-trade") {
      await showView(page, "hand");
      await page.getByRole("button", { name: "Make a trade", exact: true }).click();
      const trade = page.getByRole("dialog", { name: "A fair exchange", exact: true });
      await trade.getByRole("button", { name: `Give ${RESOURCE_NAMES[action.give]}`, exact: true }).click();
      await trade.getByRole("button", { name: `Receive ${RESOURCE_NAMES[action.receive]}`, exact: true }).click();
      await trade.getByRole("button", { name: "Confirm exchange", exact: true }).click();
    } else {
      const label = action.type === "place-city" ? "Upgrade to city" : action.type === "place-settlement" ? "Build settlement" : "Build road";
      await showView(page, "hand");
      await page.getByRole("button", { name: new RegExp(`^${label}\\b`) }).click();
      await showView(page, "board");
      const target = action.type === "place-road"
        ? `Build road at ${action.edgeId}`
        : `${action.type === "place-city" ? "Upgrade to city" : "Place settlement"} at ${action.vertexId}`;
      await page.getByRole("button", { name: target, exact: true }).click();
      await page.getByRole("button", { name: "Confirm placement", exact: true }).click();
    }
    state = applyAction(state, buyerId, action);
  }

  let turns = 0;
  while (!state.winnerId && turns < 90) {
    await showView(page, "hand");
    const active = state.activePlayerId;
    if (active === buyerId) {
      let best = 6;
      for (const number of [2, 3, 4, 5, 6, 8, 9, 10, 11, 12]) {
        if (production(number) > production(best)) best = number;
      }
      await rollAndMirror(buyerId, diceFor(best));
      let guard = 0;
      while (!state.winnerId && state.phase.type === "actions" && guard++ < 24) {
        const action = scriptAction() ?? tradeToward();
        if (!action) break;
        await playScriptedAction(action);
      }
    } else {
      let idle = 2;
      for (const number of [2, 3, 4, 5, 6, 8, 9, 10, 11, 12]) {
        const anyProduction = state.board.tiles.some(tile =>
          tile.id !== state.robberTileId && tile.number === number && tile.terrain !== "desert" &&
          tile.vertexIds.some(vertexId => state.board.vertices.find(vertex => vertex.id === vertexId)!.building));
        if (!anyProduction) { idle = number; break; }
      }
      await rollAndMirror(active, diceFor(idle));
    }
    if (!state.winnerId) {
      await showView(page, "hand");
      await endTurn.click();
      state = applyAction(state, state.activePlayerId, { type: "end-turn" });
      await revealHand(page);
    }
    turns++;
  }
  expect(state.winnerId, "The scripted buyer reaches ten victory points").toBe(buyerId);

  const score = getScore(state, buyerId);
  const victory = page.getByRole("dialog", { name: `${buyerName} takes the island.`, exact: true });
  await expect(victory).toBeVisible();
  await expect(victory).toContainText(`${score.total}`);
  await expect(victory.locator("dd")).toHaveText([
    String(score.settlements), String(score.cities), String(score.longestRoad), String(score.largestArmy), String(score.hidden),
  ]);
  // Each breakdown row leads with an icon and spells out the count math behind the points.
  await expect(victory.locator("dl > div svg")).toHaveCount(5);
  if (score.settlements > 0) await expect(victory).toContainText(`${score.settlements} × 1 VP`);
  if (score.cities > 0) await expect(victory).toContainText(`${score.cities / 2} × 2 VP`);
  if (score.hidden > 0) await expect(victory).toContainText(`${score.hidden} × 1 VP`);
  await expect(victory).not.toContainText("0 ×");
  // Celebratory confetti drizzles behind the card without joining the dialog's semantics.
  await expect(victory.locator(".confetti-piece")).toHaveCount(28);
  await expect(victory.getByRole("button", { name: "Play a rematch", exact: true })).toBeVisible();
  await expect(victory.getByRole("button", { name: "See full results", exact: true })).toBeVisible();
  await expect(victory.getByRole("button", { name: "Back to the table", exact: true })).toBeVisible();
  // The winning island stays mounted behind the popup.
  await expect(page.getByRole("region", { name: "Game board", exact: true })).toBeVisible();
  await noPageOverflow(page);
  await screenshot(page, testInfo, "victory-popup", false);

  await victory.getByRole("button", { name: "See full results", exact: true }).click();
  await expect(page.getByRole("heading", { name: `${buyerName} takes the island.`, exact: true })).toBeVisible();
  await expect(page.getByText(`${buyerName} / Winner`, { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Play a rematch", exact: true }).click();
  await expect(page.getByRole("heading", { name: /^Pass the device to / })).toBeVisible();
  await expect(victory).toHaveCount(0);
  await revealHand(page);
  await showView(page, "board");
  await expect(page.getByRole("button", { name: /^Place settlement at/ }).first()).toBeVisible({ timeout: 15_000 });
  expect(browserErrors).toEqual([]);
});

test("owned development cards group by type with counts, descriptions and older-copy selection", async ({ page, isMobile }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  let state = await prepareRollGame(page);
  await revealBuildSection(page);
  const buyerId = state.activePlayerId;
  const developmentHand = page.getByRole("region", { name: "Your development cards", exact: true });
  const development = page.getByRole("dialog", { name: "A card up your sleeve", exact: true });
  const cardNames = {
    knight: "Knight", "victory-point": "Victory point", "road-building": "Road building",
    "year-of-plenty": "Year of plenty", monopoly: "Monopoly",
  };
  const cardDescriptions = {
    knight: "Move the robber and steal one random resource from an adjacent opponent. Only played Knights count toward Largest Army (+2 points): at least three, and more than the current holder.",
    "victory-point": "One hidden victory point. Counted automatically toward your ten points on your turn, including when purchased.",
    "road-building": "Place two roads for free, following the usual connection and piece-limit rules.",
    "year-of-plenty": "Choose two resources from the bank, or all that remain if fewer than two are available.",
    monopoly: "Name a resource. Every other player gives you all of that resource from their hand.",
  };
  // These rolls fund one purchase each round. The first eight cards cover every kind and duplicates.
  const rolls: [number, number][] = [[1, 2], [2, 6], [5, 5]];
  for (let turn = 0; turn < 25; turn++) {
    const dice = rolls[turn % rolls.length]!;
    await chooseDice(page, dice);
    await page.getByRole("button", { name: "Roll the dice", exact: true }).click();
    let diceIndex = 0;
    state = applyAction(state, state.activePlayerId, { type: "roll" }, () => (dice[diceIndex++]! - 0.5) / 6);
    await expect(page.getByRole("button", { name: "End turn & pass device", exact: true })).toBeEnabled();
    if (turn > 0 && state.activePlayerId === buyerId) {
      await page.getByRole("button", { name: /^Buy a card\b/ }).click();
      await page.getByRole("dialog", { name: "Invest in a development card", exact: true }).getByRole("button", { name: "Confirm", exact: true }).click();
      state = applyAction(state, buyerId, { type: "buy-development" });
      const cards = state.players.find(player => player.id === buyerId)!.developmentCards;
      await expect(developmentHand.getByRole("listitem")).toHaveCount(new Set(cards.map(card => card.kind)).size);
      await expect(developmentHand.locator(":scope > div").getByText(String(cards.length), { exact: true })).toBeVisible();
      if (turn === 15) {
        // An older Knight stays playable when a duplicate was just purchased.
        expect(cards.at(-1)!.kind).toBe("knight");
        expect(cards.at(-1)!.purchasedTurn).toBe(state.turnNumber);
        await developmentHand.getByRole("button", { name: /^Knight 2 cards / }).click();
        await expect(development.locator("button[aria-pressed]").first()).toHaveAttribute("aria-pressed", "true");
        await expect(development.getByRole("button", { name: "Confirm Knight", exact: true })).toBeEnabled();
        await development.getByRole("button", { name: /^Knight Move the robber/ }).last().click();
        await expect(development.getByRole("button", { name: "Confirm Knight", exact: true })).toBeDisabled();
        await page.keyboard.press("Escape");
      }
    }
    if (turn < 24) {
      await page.getByRole("button", { name: "End turn & pass device", exact: true }).click();
      state = applyAction(state, state.activePlayerId, { type: "end-turn" });
      await revealHand(page);
    }
  }
  const buyer = state.players.find(player => player.id === buyerId)!;
  expect(buyer.developmentCards).toHaveLength(8);
  const kinds = [...new Set(buyer.developmentCards.map(card => card.kind))];
  expect(kinds).toHaveLength(5);
  await showView(page, "players");
  await expect(page.locator(".player-seat-leading")).toHaveCount(0);
  await showView(page, "hand");
  const dismissCollection = page.getByRole("button", { name: "Dismiss resource collection", exact: true });
  if (await dismissCollection.isVisible()) await dismissCollection.click();
  const rows = developmentHand.getByRole("listitem").getByRole("button");
  await expect(rows).toHaveCount(5);
  await expect(developmentHand.getByText("8", { exact: true })).toBeVisible();
  await expect(developmentHand.getByText(/^(In your hand|New this turn)$/)).toHaveCount(0);
  const icons = rows.locator("svg[data-development-kind]");
  expect(await icons.evaluateAll(elements => new Set(elements.map(element => element.innerHTML)).size)).toBe(5);
  for (const viewport of isMobile ? [{ width: 390, height: 844 }, { width: 320, height: 844 }] : [{ width: 1280, height: 720 }]) {
    await page.setViewportSize(viewport);
    const geometry = await rows.evaluateAll(elements => elements.map(element => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height, parentWidth: element.parentElement!.getBoundingClientRect().width };
    }));
    for (const [index, bounds] of geometry.entries()) {
      expect(bounds.width).toBe(bounds.parentWidth);
      expect(bounds.x).toBe(geometry[0]!.x);
      expect(bounds.height).toBeGreaterThanOrEqual(44);
      if (index) expect(bounds.y).toBeGreaterThanOrEqual(geometry[index - 1]!.y + geometry[index - 1]!.height);
      await rows.nth(index).scrollIntoViewIfNeeded();
      await expect(rows.nth(index)).toBeInViewport({ ratio: 1 });
      await expect(icons.nth(index)).toHaveAttribute("aria-hidden", "true");
      const kind = kinds[index]!;
      await expect(icons.nth(index)).toHaveAttribute("data-development-kind", kind);
      const count = buyer.developmentCards.filter(card => card.kind === kind).length;
      const quantity = rows.nth(index).locator('span[aria-hidden="true"]').filter({ hasText: new RegExp(`^${count}$`) });
      await expect(quantity).toBeInViewport({ ratio: 1 });
      const title = rows.nth(index).getByText(cardNames[kind], { exact: true });
      const description = rows.nth(index).getByText(cardDescriptions[kind], { exact: true });
      await expect(description).toBeInViewport({ ratio: 1 });
      await expect(description).toHaveCSS("-webkit-line-clamp", "2");
      await expect(description).toHaveCSS("overflow", "hidden");
      const titleBounds = (await title.boundingBox())!;
      const quantityBounds = (await quantity.boundingBox())!;
      const descriptionBounds = (await description.boundingBox())!;
      expect(quantityBounds.x).toBeGreaterThanOrEqual(titleBounds.x + titleBounds.width);
      expect(quantityBounds.x + quantityBounds.width).toBeLessThanOrEqual(bounds.x + bounds.width);
      expect(descriptionBounds.y).toBeGreaterThanOrEqual(titleBounds.y + titleBounds.height);
      expect(descriptionBounds.x).toBe(titleBounds.x);
      expect(descriptionBounds.x + descriptionBounds.width).toBeLessThanOrEqual(bounds.x + bounds.width);
    }
    await noPageOverflow(page);
    await screenshot(page, testInfo, `development-stack-bottom-${viewport.width}`, false);
    await developmentHand.evaluate(element => element.scrollIntoView({ block: "start" }));
    await noPageOverflow(page);
    await screenshot(page, testInfo, `development-stack-top-${viewport.width}`, false);
  }
  for (const [index, kind] of kinds.entries()) {
    const cards = buyer.developmentCards.filter(card => card.kind === kind);
    const card = cards.find(card => card.purchasedTurn < state.turnNumber) ?? cards[0]!;
    const row = rows.nth(index);
    await expect(row).toHaveAccessibleName(`${cardNames[kind]} ${cards.length} ${cards.length === 1 ? "card" : "cards"} ${cardDescriptions[kind]}`);
    await row.focus();
    await page.keyboard.press("Enter");
    if (card.kind === "year-of-plenty" || card.kind === "monopoly") {
      await expectResourceInventory(development, buyer.resources);
    } else {
      await expect(development.getByRole("region", { name: "Your current resources", includeHidden: true })).toHaveCount(0);
    }
    await expect(development.getByRole("button", { pressed: true })).toHaveCount(1);
    await expect(development.getByRole("button", { pressed: true }).locator("svg[data-development-kind]")).toHaveAttribute("data-development-kind", card.kind);
    await expect(development.getByRole("button", { pressed: true })).toContainText(cardNames[card.kind]);
    await expect(development.getByRole("button", { pressed: true })).toContainText(cardDescriptions[card.kind]);
    await expect(development.getByText(/^(In your hand|New this turn)$/)).toHaveCount(0);
    const confirm = development.getByRole("button", { name: `Confirm ${cardNames[card.kind]}`, exact: true });
    if (card.kind === "victory-point") {
      await expect(development.getByRole("button", { name: /^Confirm / })).toHaveCount(0);
    } else if (card.purchasedTurn === state.turnNumber || card.kind === "year-of-plenty") {
      await expect(confirm).toBeDisabled();
    } else {
      await expect(confirm).toBeEnabled();
    }
    await expect(development.locator("button[aria-pressed]")).toHaveCount(8);
    await expect(development.locator("button[aria-pressed]").nth(buyer.developmentCards.indexOf(card))).toHaveAttribute("aria-pressed", "true");
    await screenshot(page, testInfo, `development-dialog-${index}-${card.kind}`, false);
    await page.keyboard.press("Escape");
    await expect(row).toBeFocused();
    await expect(rows).toHaveCount(5);
  }
  const plenty = developmentHand.getByRole("button", { name: /^Year of plenty\b/ });
  await expect(plenty.getByText("2 cards", { exact: true })).toBeVisible();
  await plenty.click();
  await development.getByRole("button", { name: "Add Grain to Take from the bank", exact: true }).click();
  await page.keyboard.press("Escape");
  await plenty.click();
  await expect(development.getByText("Selected 0 of 2", { exact: true })).toBeVisible();
  await development.getByRole("button", { name: "Add Grain to Take from the bank", exact: true }).click();
  await development.getByRole("button", { name: "Add Ore to Take from the bank", exact: true }).click();
  await development.getByRole("button", { name: "Confirm Year of plenty", exact: true }).click();
  await expect(development).toHaveCount(0);
  await expect(rows).toHaveCount(5);
  await expect(developmentHand.getByText("7", { exact: true })).toBeVisible();
  await expect(plenty).toHaveCount(1);
  await expect(plenty.getByText("1 card", { exact: true })).toBeVisible();
  await developmentHand.getByRole("button", { name: /^Knight 2 cards / }).click();
  await expect(development.getByRole("button", { name: "Confirm Knight", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "End turn & pass device", exact: true }).click();
  await privateHandIsAbsent(page);
  await revealHand(page);
  await expect(developmentHand).toHaveCount(0);
  await noPageOverflow(page);
});

async function verifyResourceAnimation(card: Locator, animationName: "resource-collect" | "resource-hand-pulse" | "resource-deal") {
  const { timing, frames } = await card.evaluate((element, name) => {
    const animation = element.getAnimations().find(animation => animation instanceof CSSAnimation && animation.animationName === name);
    if (!animation?.effect) throw new Error(`Missing ${name} animation`);
    const timing = animation.effect.getTiming();
    animation.pause();
    const frames = [0, 0.4, 1].map(progress => {
      animation.currentTime = (timing.delay ?? 0) + Number(timing.duration) * progress;
      const style = getComputedStyle(element);
      const { x, y, width, height } = element.getBoundingClientRect();
      return { transform: style.transform, opacity: style.opacity, shadow: style.boxShadow, bounds: { x, y, width, height } };
    });
    return { timing, frames };
  }, animationName);
  expect(timing.duration).toBe(animationName === "resource-collect" ? 950 : 1000);
  if (animationName === "resource-hand-pulse") {
    for (const frame of frames) {
      expect(frame.bounds).toEqual(frames[0]!.bounds);
      expect(frame.transform).toBe("none");
    }
    expect(frames[1]!.shadow).not.toBe(frames[0]!.shadow);
    return;
  }
  if (animationName === "resource-deal") expect(timing.delay).toBe(150);
  expect(frames[1]!.transform).not.toBe(frames[0]!.transform);
  expect(frames[1]!.bounds.y).not.toBeCloseTo(frames[0]!.bounds.y, 1);
  expect(frames[1]!.bounds.width).not.toBeCloseTo(frames[0]!.bounds.width, 1);
  expect(Number(frames[1]!.opacity)).toBeGreaterThan(0);
  expect(frames[2]!.opacity).toBe(animationName === "resource-deal" ? "0" : "1");
}

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`roll production, receipt and seven respect ${reducedMotion}`, async ({ page, isMobile }, testInfo) => {
    await page.emulateMedia({ reducedMotion });
    await page.setViewportSize(isMobile ? { width: 320, height: 844 } : { width: 1280, height: 720 });
    // Setup receipts and their cleanup must use the same clock as the roll.
    await page.clock.install({ time: new Date("2026-10-31T00:00:00Z") });
    await page.clock.pauseAt(new Date("2026-10-31T00:00:01Z"));
    const state = await prepareRollGame(page);
    await revealBuildSection(page);
    const tile = state.board.tiles.find(candidate => candidate.number && candidate.vertexIds.some(
      vertexId => state.board.vertices.find(vertex => vertex.id === vertexId)?.building?.playerId === state.activePlayerId,
    ))!;
    const firstDie = Math.max(1, tile.number! - 6);
    const dice: [number, number] = [firstDie, tile.number! - firstDie];
    await chooseDice(page, dice);
    let diceIndex = 0;
    const next = applyAction(state, state.activePlayerId, { type: "roll" }, () => (dice[diceIndex++]! - 0.5) / 6);
    const beforePlayer = state.players.find(player => player.id === state.activePlayerId)!;
    const afterPlayer = next.players.find(player => player.id === state.activePlayerId)!;
    const privateResources = page.getByRole("region", { name: "Private resources", includeHidden: true });
    const resourceCounts = privateResources.getByText(/^\d+ (Wood|Brick|Wool|Grain|Ore)$/);
    const collection = page.getByRole("region", { name: "Resource collection" });
    const summary = page.getByRole("region", { name: "Roll result" });
    const highlights = page.getByRole("img", { name: /produced resources this roll/, includeHidden: true });
    const numberHighlights = page.locator("g.number-token-highlight");
    const raisedTiles = page.locator("g.terrain-hex-raised");
    const matchingTiles = state.board.tiles.filter(candidate => candidate.number === tile.number);
    await showView(page, "board");
    await expect(raisedTiles).toHaveCount(0);
    await expectResourceBank(page, state.bank);
    await expect(page.getByRole("region", { name: "Dice tray", exact: true })).toHaveAttribute("data-stage", "idle");
    const idleFrame = await boardFrame(page);
    await screenshot(page, testInfo, "roll-idle", false);
    await showView(page, "hand");
    const handFrame = await privateResources.boundingBox();
    const sidebar = page.getByRole("complementary", { name: "Your hand and actions" });
    const rollButton = sidebar.getByRole("button", { name: "Roll the dice", exact: true });
    const endTurnButton = sidebar.getByRole("button", { name: "End turn & pass device", exact: true });
    const turnCard = sidebar.locator(".turn-card");
    const turnHeader = sidebar.locator(".turn-header");
    const turnNumber = turnHeader.getByText(`Turn ${state.turnNumber}`, { exact: true });
    const gameButton = turnHeader.getByRole("button", { name: "Game", exact: true });
    await expect(turnHeader.getByRole("heading", { name: `${beforePlayer.name} - Your turn`, exact: true })).toBeVisible();
    await expect(turnHeader).toBeInViewport({ ratio: 1 });
    await expect(turnNumber).toBeInViewport({ ratio: 1 });
    await expect(gameButton).toBeInViewport({ ratio: 1 });
    await expect(turnCard.getByText("Your turn", { exact: true })).toHaveCount(0);
    expect(await turnNumber.evaluate(element => {
      const style = getComputedStyle(element);
      const luminance = (color: string) => color.match(/\d+/g)!.slice(0, 3).map(value => {
        const channel = Number(value) / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index]!, 0);
      const foreground = luminance(style.color);
      const background = luminance(style.backgroundColor);
      return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
    })).toBeGreaterThanOrEqual(4.5);
    await expect(rollButton).toBeInViewport({ ratio: 1 });
    await expect(endTurnButton).toBeInViewport({ ratio: 1 });
    await expect(endTurnButton).toBeDisabled();
    await expect(turnCard).toBeInViewport({ ratio: 1 });
    const rollButtonFrame = (await rollButton.boundingBox())!;
    const endTurnButtonFrame = (await endTurnButton.boundingBox())!;
    const turnCardFrame = (await turnCard.boundingBox())!;
    const turnHeaderFrame = (await turnHeader.boundingBox())!;
    const turnOwnerFrame = (await turnHeader.getByRole("heading").boundingBox())!;
    const turnNumberFrame = (await turnNumber.boundingBox())!;
    const gameButtonFrame = (await gameButton.boundingBox())!;
    expect(Math.abs(turnOwnerFrame.y + turnOwnerFrame.height / 2 - turnNumberFrame.y - turnNumberFrame.height / 2)).toBeLessThanOrEqual(1);
    expect(Math.abs(turnHeaderFrame.x + turnHeaderFrame.width - gameButtonFrame.x - gameButtonFrame.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(turnOwnerFrame.y + turnOwnerFrame.height / 2 - gameButtonFrame.y - gameButtonFrame.height / 2)).toBeLessThanOrEqual(1);
    expect(turnNumberFrame.x + turnNumberFrame.width).toBeLessThanOrEqual(gameButtonFrame.x - 8);
    expect(turnOwnerFrame.x + turnOwnerFrame.width).toBeLessThanOrEqual(turnNumberFrame.x - 8);
    for (const selector of [".turn-title", ".turn-description"]) {
      const textFrame = (await turnCard.locator(selector).boundingBox())!;
      expect(textFrame.y).toBeGreaterThanOrEqual(turnCardFrame.y);
      expect(textFrame.y + textFrame.height).toBeLessThanOrEqual(turnCardFrame.y + turnCardFrame.height);
    }
    expect(turnHeaderFrame.y + turnHeaderFrame.height).toBeLessThanOrEqual(turnCardFrame.y);
    expect(turnCardFrame.y + turnCardFrame.height).toBeLessThanOrEqual(rollButtonFrame.y);
    expect(rollButtonFrame.y - turnCardFrame.y - turnCardFrame.height).toBeLessThanOrEqual(8);
    expect(endTurnButtonFrame.y).toBe(rollButtonFrame.y);
    const sidebarFrame = (await sidebar.boundingBox())!;
    expect(sidebarFrame.y + sidebarFrame.height - rollButtonFrame.y - rollButtonFrame.height).toBeLessThanOrEqual(12);
    await sidebar.getByRole("button", { name: "Make a trade", exact: true }).scrollIntoViewIfNeeded();
    expect(await rollButton.boundingBox()).toEqual(rollButtonFrame);
    expect(await turnCard.boundingBox()).toEqual(turnCardFrame);
    expect(await turnHeader.boundingBox()).toEqual(turnHeaderFrame);
    if (!isMobile) {
      const sidebarDice = sidebar.getByRole("region", { name: "Dice tray", exact: true });
      await expect(sidebarDice).toBeInViewport({ ratio: 1 });
      const diceFrame = (await sidebarDice.boundingBox())!;
      expect(turnHeaderFrame.y + turnHeaderFrame.height).toBeLessThanOrEqual(diceFrame.y);
      expect(diceFrame.y + diceFrame.height).toBeLessThanOrEqual(turnCardFrame.y);
    }
    await sidebar.locator(".hand-content").evaluate(element => element.scrollTo({ top: 0 }));
    expect(await privateResources.boundingBox()).toEqual(handFrame);
    await screenshot(page, testInfo, "sidebar-dice-and-roll", false);
    await rollButton.click();

    if (reducedMotion === "no-preference") {
      await expect(summary).toHaveAttribute("data-stage", "rolling");
      await expect(summary.getByRole("list", { name: "Your roll rewards" })).toHaveCount(0);
      await expect(summary.getByRole("img", { name: "Dice rolling", exact: true })).toBeVisible();
      for (const [index, value] of dice.entries()) {
        await expect(summary.locator(".roll-die").nth(index).locator("circle")).toHaveCount(value);
      }
      await screenshot(page, testInfo, "roll-actual-faces", false);
      await expect(page.getByRole("button", { name: "Roll the dice", exact: true })).toBeDisabled();
      await page.getByRole("button", { name: "Game", exact: true }).click();
      await expect(page.getByRole("button", { name: "Pass device", exact: true })).toBeDisabled();
      await page.keyboard.press("Escape");
      await expect(highlights).toHaveCount(0);
      await expect(numberHighlights).toHaveCount(0);
      await expect(raisedTiles).toHaveCount(0);
      await expect(resourceCounts).toHaveText(RESOURCES.map(resource => `${beforePlayer.resources[resource]} ${RESOURCE_NAMES[resource]}`));
      await expect(collection).toHaveCount(0);
      await showView(page, "board");
      await expectBoardFrame(page, idleFrame);
      await page.clock.runFor(500);
      await expect(summary).toHaveAttribute("data-stage", "production");
      await expect(summary.getByRole("list", { name: "Your roll rewards" })).toHaveCount(0);
      await expect(resourceCounts).toHaveText(RESOURCES.map(resource => `${beforePlayer.resources[resource]} ${RESOURCE_NAMES[resource]}`));
      await expect(summary).toBeVisible();
      await expect(highlights.first()).toBeVisible();
      await expect(numberHighlights).toHaveText(matchingTiles.map(candidate => String(candidate.number)));
      await expect(raisedTiles).toHaveCount(matchingTiles.length);
      await expect(page.locator("polygon.production-highlight, polygon.number-token-highlight")).toHaveCount(0);
      await expectResourceBank(page, state.bank);
      await expectBoardFrame(page, idleFrame);
      await screenshot(page, testInfo, "roll-production");
      await page.clock.runFor(300);
      await expect(summary).toHaveAttribute("data-stage", "received");
    } else {
      await expect(summary).toHaveAttribute("data-stage", "complete");
    }

    await expect(summary.getByRole("img", { name: `Dice: ${dice[0]} and ${dice[1]}` })).toBeVisible();
    for (const [index, value] of dice.entries()) {
      await expect(summary.locator(".roll-die").nth(index).locator("circle")).toHaveCount(value);
    }
    await expect(summary.locator(".roll-summary-total, .roll-summary-details")).toHaveCount(0);
    await expect(summary).not.toContainText(/rolled|The island supplied|The robber blocked/);
    const rollRewards = summary.getByRole("list", { name: "Your roll rewards" });
    await expect(rollRewards).toBeInViewport({ ratio: 1 });
    await expect(rollRewards.getByRole("listitem")).toHaveCount(RESOURCES.filter(resource => afterPlayer.resources[resource] > beforePlayer.resources[resource]).length);
    await expect(page.getByRole("status", { name: "Resource receipt" })).toContainText("You received +");
    const producingTiles = state.board.tiles.filter(candidate => candidate.number === tile.number && candidate.id !== state.robberTileId && candidate.vertexIds.some(
      vertexId => state.board.vertices.find(vertex => vertex.id === vertexId)?.building,
    ));
    await expect(highlights).toHaveCount(producingTiles.length);
    await expect(numberHighlights).toHaveCount(matchingTiles.length);
    await expect(numberHighlights).toHaveText(matchingTiles.map(candidate => String(candidate.number)));
    await expect(page.locator("g.number-token-blocked")).toHaveCount(matchingTiles.filter(candidate => candidate.id === state.robberTileId).length);
    await expect(page.locator("polygon.production-highlight, polygon.number-token-highlight")).toHaveCount(0);
    await showView(page, "board");
    await expectBoardFrame(page, idleFrame);
    await expectResourceBank(page, next.bank);
    await expect(raisedTiles).toHaveCount(matchingTiles.length);
    for (const raisedTile of await raisedTiles.all()) {
      await expect(raisedTile).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, -8)");
      await expect(raisedTile).toHaveCSS("filter", /drop-shadow/);
      await expect(raisedTile).toHaveCSS("pointer-events", "none");
      await expect(raisedTile.locator("polygon").first()).toHaveAttribute("transform", "translate(0 10.5)");
      await expect(raisedTile.locator(".number-token-highlight")).toHaveText(String(tile.number));
    }
    expect(await page.locator("g.terrain-hex").evaluateAll((elements, raisedCount) => elements.every((element, index) =>
      element.classList.contains("terrain-hex-raised") === (index >= elements.length - raisedCount),
    ), matchingTiles.length), "Raised hexes paint above ordinary terrain").toBe(true);
    await expect(collection).toBeInViewport({ ratio: 1 });
    if (!isMobile) {
      const collectionFrame = (await collection.boundingBox())!;
      expect(collectionFrame.y + collectionFrame.height).toBeLessThanOrEqual(turnHeaderFrame.y);
    }
    if (reducedMotion === "no-preference") {
      await verifyResourceAnimation(collection.getByRole("listitem").first(), "resource-collect");
    } else {
      expect(await collection.getByRole("listitem").first().evaluate(element => element.getAnimations().length)).toBe(0);
      expect(await numberHighlights.evaluateAll(elements => elements.every(element => element.getAnimations().length === 0))).toBe(true);
      expect(await raisedTiles.evaluateAll(elements => elements.every(element => element.getAnimations().length === 0))).toBe(true);
    }
    await screenshot(page, testInfo, "resource-collection-board", false);
    await screenshot(page, testInfo, "roll-highlighted-board");
    await showView(page, "hand");
    expect(await privateResources.boundingBox()).toEqual(handFrame);
    await expect(resourceCounts).toHaveText(RESOURCES.map(resource => `${afterPlayer.resources[resource]} ${RESOURCE_NAMES[resource]}`));
    for (const resource of RESOURCES) {
      const gain = afterPlayer.resources[resource] - beforePlayer.resources[resource];
      if (gain) {
        const badge = privateResources.getByLabel(`Received ${gain} ${RESOURCE_NAMES[resource]}`, { exact: true });
        const handCard = badge.locator("..");
        const dealtCard = handCard.locator(".resource-dealt-card");
        await expect(badge).toHaveText(`+${gain}`);
        await expect(collection.getByRole("listitem", { name: `${RESOURCE_NAMES[resource]} +${gain}`, exact: true })).toBeVisible();
        const reward = rollRewards.getByRole("listitem", { name: `${RESOURCE_NAMES[resource]} +${gain}`, exact: true });
        await expect(reward.locator("svg")).toBeVisible();
        await expect(reward.locator("strong")).toHaveText(`+${gain}`);
        await expect(dealtCard).toHaveAttribute("aria-hidden", "true");
        if (reducedMotion === "reduce") {
          expect(await handCard.evaluate(element => element.getAnimations().length)).toBe(0);
          expect(await dealtCard.evaluate(element => element.getAnimations().length)).toBe(0);
          await expect(dealtCard).toHaveCSS("display", "none");
        } else {
          await verifyResourceAnimation(handCard, "resource-hand-pulse");
          const beforeDeal = await handCard.boundingBox();
          await verifyResourceAnimation(dealtCard, "resource-deal");
          expect(await handCard.boundingBox()).toEqual(beforeDeal);
        }
      }
    }
    await noPageOverflow(page);
    await screenshot(page, testInfo, "roll-receipt");
    if (reducedMotion === "no-preference") await page.clock.runFor(700);
    await expect(summary).toHaveAttribute("data-stage", "complete");
    await expect(rollButton).toBeDisabled();
    await expect(rollButton).toBeInViewport({ ratio: 1 });
    await expect(endTurnButton).toBeEnabled();
    expect(await rollButton.boundingBox()).toEqual(rollButtonFrame);
    expect(await endTurnButton.boundingBox()).toEqual(endTurnButtonFrame);
    expect(await turnCard.boundingBox()).toEqual(turnCardFrame);
    await showView(page, "board");
    await expectBoardFrame(page, idleFrame);
    await collection.getByRole("button", { name: "Dismiss resource collection", exact: true }).click();
    await expect(collection).toHaveCount(0);
    await expect(page.getByLabel(/^Received /)).toHaveCount(0);
    await expect(page.getByRole("status", { name: "Resource receipt" })).toBeEmpty();
    await expectBoardFrame(page, idleFrame);
    await screenshot(page, testInfo, "roll-complete-dismissed", false);
    await showView(page, "hand");
    await expect(page.getByRole("button", { name: "End turn & pass device", exact: true })).toBeInViewport({ ratio: 1 });
    await page.getByRole("button", { name: "End turn & pass device", exact: true }).click();
    await privateHandIsAbsent(page);
    await expect(summary).toHaveCount(0);
    await expect(raisedTiles).toHaveCount(0);
    await expect(collection).toHaveCount(0);
    await expect(page.getByLabel(/^Received /)).toHaveCount(0);
    await revealHand(page);
    await chooseDice(page, [3, 4]);
    await page.getByRole("button", { name: "Roll the dice", exact: true }).click();
    if (reducedMotion === "no-preference") {
      await expect(summary).toHaveAttribute("data-stage", "rolling");
      await page.emulateMedia({ reducedMotion: "reduce" });
      const changedAt = await page.evaluate(() => Date.now());
      await expect.poll(async () => {
        await page.clock.runFor(16);
        return summary.getAttribute("data-stage");
      }).toBe("complete");
      expect(await page.evaluate(() => Date.now()) - changedAt).toBeLessThan(500);
    }
    await expect(summary).toHaveAttribute("data-stage", "complete");
    await expect(page.getByRole("status", { name: "Roll announcement" })).toContainText("No resources produced. Resolve any discards, then move the robber.");
    await expect(summary.getByRole("img", { name: "Dice: 3 and 4", exact: true })).toBeVisible();
    await expect(summary).toHaveText("");
    await screenshot(page, testInfo, "roll-seven-simplified", false);
    await expect(summary.getByRole("list", { name: "Your roll rewards" })).toHaveCount(0);
    await showView(page, "hand");
    await expect(rollButton).toBeDisabled();
    await expect(endTurnButton).toBeDisabled();
    await expect(highlights).toHaveCount(0);
    await expect(numberHighlights).toHaveCount(0);
    await expect(raisedTiles).toHaveCount(0);
    await expect(collection).toHaveCount(0);
    await expect(page.getByLabel(/^Received /)).toHaveCount(0);
    await showView(page, "board");
    await expect(summary).toBeVisible();
    await expect(page.getByRole("button", { name: /^Move robber to / })).toHaveCount(18);
    await expectBoardFrame(page, idleFrame);
    await expect(page.getByRole("button", { name: "Cancel Knight", exact: true, includeHidden: true })).toHaveCount(0);
    const robberTarget = page.getByRole("button", { name: /^Move robber to / }).first();
    const robberDestination = state.board.tiles.find(candidate => candidate.id !== state.robberTileId)!;
    const hitTarget = robberTarget.locator("polygon").first();
    const hitTargetBounds = await hitTarget.boundingBox();
    await robberTarget.focus();
    await expect(raisedTiles).toHaveCount(1);
    await expect(raisedTiles).toHaveAccessibleName(new RegExp(`, ${robberDestination.terrain},`));
    await expect(raisedTiles).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, -8)");
    expect(await hitTarget.boundingBox()).toEqual(hitTargetBounds);
    await page.keyboard.press("Space");
    const confirmation = await expectPlacementConfirmation(page, robberTarget, robberDestination.id);
    await expect(raisedTiles).toHaveCount(1);
    expect(await hitTarget.boundingBox()).toEqual(hitTargetBounds);
    await expect(confirmation.getByRole("button", { name: "Confirm placement", exact: true })).toBeFocused();
    await expect(page.getByRole("button", { name: /^Move robber to / })).toHaveCount(18);
    await expectBoardFrame(page, idleFrame);
    await screenshot(page, testInfo, "robber-placement-confirmation", false);
    await page.keyboard.press("Escape");
    await expect(confirmation).toHaveCount(0);
    await expect(robberTarget).toBeFocused();
    await expect(robberTarget).toHaveAttribute("aria-pressed", "false");
    await expect(raisedTiles).toHaveCount(1);
    await page.getByRole("button", { name: "Zoom in", exact: true }).focus();
    await expect(raisedTiles).toHaveCount(0);
    await robberTarget.click();
    await expectPlacementConfirmation(page, robberTarget, robberDestination.id);
    await expect(raisedTiles).toHaveCount(1);
    expect(await hitTarget.boundingBox()).toEqual(hitTargetBounds);
    await expectBoardFrame(page, idleFrame);
  });
}

test("robber-blocked dice matches stay raised with muted tokens", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const state = await prepareRollGame(page);
  const destination = state.board.tiles.find(tile => tile.number !== null && tile.vertexIds.every(vertexId =>
    !state.board.vertices.find(vertex => vertex.id === vertexId)!.building,
  ))!;
  await chooseDice(page, [3, 4]);
  await page.getByRole("button", { name: "Roll the dice", exact: true }).click();
  await showView(page, "board");
  const targetIndex = state.board.tiles.filter(tile => tile.id !== state.robberTileId).indexOf(destination);
  await page.getByRole("button", { name: /^Move robber to / }).nth(targetIndex).click();
  await page.getByRole("button", { name: "Confirm placement", exact: true }).click();
  await expect(page.locator("g.terrain-hex-raised")).toHaveCount(0);
  await showView(page, "hand");
  await page.getByRole("button", { name: "End turn & pass device", exact: true }).click();
  await revealHand(page);
  const firstDie = Math.max(1, destination.number! - 6);
  await chooseDice(page, [firstDie, destination.number! - firstDie]);
  await page.getByRole("button", { name: "Roll the dice", exact: true }).click();
  await showView(page, "board");
  const blockedTile = page.locator("g.terrain-hex-raised").filter({ has: page.locator(".number-token-blocked") });
  await expect(blockedTile).toHaveCount(1);
  await expect(blockedTile).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, -8)");
  await expect(blockedTile).toHaveAccessibleName(/blocked by the robber/);
  await expect(blockedTile).not.toHaveAccessibleName(/produced resources this roll/);
  await expect(blockedTile.locator(".number-token-halo")).toHaveAttribute("stroke-dasharray", "3 4");
  await expect(blockedTile.locator(".number-token-face")).toHaveAttribute("fill", "#e6e1d4");
  await expect(page.getByRole("img", { name: /^Robber on / })).toHaveAttribute("transform", `translate(${destination.x + 24} ${destination.y + 10})`);
  await screenshot(page, testInfo, "raised-robber-blocked-hex", false);
});

test("roll rewards show resource cards, quantities and empty results across screen sizes", async ({ page, isMobile }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await prepareRollGame(page);
  const summary = page.getByRole("region", { name: "Roll result", exact: true });
  const rewards = summary.getByRole("list", { name: "Your roll rewards", exact: true });
  const scenarios: { dice: [number, number]; rewards: [Resource, number][] }[] = [
    { dice: [2, 6], rewards: [["wood", 1], ["ore", 1]] },
    { dice: [2, 3], rewards: [["wood", 2]] },
    { dice: [1, 3], rewards: [] },
  ];
  for (const [index, scenario] of scenarios.entries()) {
    await chooseDice(page, scenario.dice);
    await page.getByRole("button", { name: "Roll the dice", exact: true }).click();
    await expect(summary).toHaveAttribute("data-stage", "complete");
    const collection = page.getByRole("region", { name: "Resource collection" });
    if (await collection.isVisible()) await collection.getByRole("button", { name: "Dismiss resource collection", exact: true }).click();
    await expect(summary.getByRole("img", { name: `Dice: ${scenario.dice[0]} and ${scenario.dice[1]}`, exact: true })).toBeVisible();
    await expect(summary.locator(".roll-summary-total, .roll-summary-details")).toHaveCount(0);
    await expect(summary).not.toContainText(/rolled|The island supplied|The robber blocked/);
    await expect(page.getByRole("status", { name: "Roll announcement", exact: true })).toContainText(`rolled ${scenario.dice[0]} + ${scenario.dice[1]} = ${scenario.dice[0] + scenario.dice[1]}.`);
    await expect(rewards.getByRole("listitem")).toHaveCount(scenario.rewards.length);
    if (!scenario.rewards.length) {
      await expect(summary.getByText("You received no resources this roll.", { exact: true })).toBeVisible();
    }
    for (const viewport of isMobile
      ? [{ width: 320, height: 844 }, { width: 390, height: 667 }, { width: 320, height: 568 }]
      : [{ width: 1280, height: 720 }, { width: 1440, height: 1000 }]) {
      await page.setViewportSize(viewport);
      await expect(summary).toBeInViewport({ ratio: 1 });
      const summaryBounds = (await summary.boundingBox())!;
      const dice = summary.locator(".roll-die");
      await expect(dice).toHaveCount(2);
      for (const die of await dice.all()) {
        const size = isMobile && viewport.height <= 740 ? "40px" : "56px";
        await expect(die).toHaveCSS("width", size);
        await expect(die).toHaveCSS("height", size);
        await expect(die).toBeInViewport({ ratio: 1 });
      }
      const diceBounds = (await summary.getByRole("img").boundingBox())!;
      for (const [resource, quantity] of scenario.rewards) {
        const reward = rewards.getByRole("listitem", { name: `${RESOURCE_NAMES[resource]} +${quantity}`, exact: true });
        await expect(reward.locator("svg")).toBeVisible();
        await expect(reward.locator("strong")).toHaveText(`+${quantity}`);
        expect(await reward.locator(".roll-summary-resource > span > span").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
        for (const element of [reward, reward.locator("strong")]) {
          await expect(element).toBeInViewport({ ratio: 1 });
          const bounds = (await element.boundingBox())!;
          expect(bounds.x).toBeGreaterThanOrEqual(diceBounds.x + diceBounds.width);
          expect(bounds.x + bounds.width).toBeLessThanOrEqual(summaryBounds.x + summaryBounds.width);
          expect(bounds.y).toBeGreaterThanOrEqual(summaryBounds.y);
          expect(bounds.y + bounds.height).toBeLessThanOrEqual(summaryBounds.y + summaryBounds.height);
        }
      }
      expect(await summary.locator(".roll-summary-content").evaluate(element => element.scrollWidth <= element.clientWidth && element.scrollHeight <= element.clientHeight)).toBe(true);
      await noPageOverflow(page);
      await screenshot(page, testInfo, `roll-rewards-${index}-${viewport.width}-${viewport.height}`, false);
    }
    if (index < scenarios.length - 1) {
      await page.getByRole("button", { name: "End turn & pass device", exact: true }).click();
      await privateHandIsAbsent(page);
      await revealHand(page);
    }
  }
});

test("very short windows keep hand tasks and turn controls reachable", async ({ page, isMobile }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.install({ time: new Date("2026-10-31T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-31T00:00:01Z"));
  await prepareRollGame(page);
  await page.setViewportSize(isMobile ? { width: 844, height: 390 } : { width: 1280, height: 480 });
  await showView(page, "hand");
  const collection = page.getByRole("region", { name: "Resource collection" });
  await expect(collection).toBeInViewport({ ratio: 1 });
  await collection.getByRole("button", { name: "Dismiss resource collection", exact: true }).click();
  const sidebar = page.getByRole("complementary", { name: "Your hand and actions" });
  const rollButton = sidebar.getByRole("button", { name: "Roll the dice", exact: true });
  const endTurnButton = sidebar.getByRole("button", { name: "End turn & pass device", exact: true });
  await rollButton.scrollIntoViewIfNeeded();
  await expect(rollButton).toBeInViewport({ ratio: 1 });
  await expect(endTurnButton).toBeInViewport({ ratio: 1 });
  const statusBounds = (await sidebar.locator(".turn-card").boundingBox())!;
  expect(statusBounds.y + statusBounds.height).toBeLessThanOrEqual((await rollButton.boundingBox())!.y);
  await noPageOverflow(page);
  expect(await sidebar.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await screenshot(page, testInfo, "short-window-turn-controls", false);

  await chooseDice(page, [1, 1]);
  await rollButton.click();
  await expect(rollButton).toBeDisabled();
  await expect(endTurnButton).toBeEnabled();
  await revealBuildSection(page);
  await page.getByRole("button", { name: "Make a trade", exact: true }).click();
  const trade = page.getByRole("dialog", { name: "A fair exchange", exact: true });
  await trade.getByRole("button", { name: "Player trade", exact: true }).click();
  await trade.getByRole("button", { name: "Add Ore to You ask for", exact: true }).click();
  await trade.getByRole("button", { name: "Ask for these cards", exact: true }).click();
  const openTrade = page.getByRole("region", { name: "Open trade", exact: true });
  const withdraw = openTrade.getByRole("button", { name: "Withdraw request", exact: true });
  await withdraw.scrollIntoViewIfNeeded();
  await expect(withdraw).toBeInViewport({ ratio: 1 });
  await noPageOverflow(page);
  await screenshot(page, testInfo, "short-window-trade", false);
  await rollButton.scrollIntoViewIfNeeded();
  await expect(rollButton).toBeInViewport({ ratio: 1 });
  await expect(endTurnButton).toBeInViewport({ ratio: 1 });
  await expect(rollButton).toBeDisabled();
  await expect(endTurnButton).toBeDisabled();
  await withdraw.click();
  await expect(openTrade).toHaveCount(0);
  await expect(endTurnButton).toBeEnabled();
});

test("request-first trades compare prices and only exchange cards after confirmation", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  let state = await prepareRollGame(page);
  await revealBuildSection(page);
  await chooseDice(page, [2, 6]);
  await page.getByRole("button", { name: "Roll the dice", exact: true }).click();
  let diceIndex = 0;
  state = applyAction(state, state.activePlayerId, { type: "roll" }, () => ([2, 6][diceIndex++]! - 0.5) / 6);
  const requester = state.players.find(player => player.name === "Sam")!;
  const responder = state.players.find(player => player.name === "Jordan")!;
  const otherResponder = state.players.find(player => player.name === "Alex")!;
  expect(state.activePlayerId).toBe(requester.id);
  await page.getByRole("button", { name: "Make a trade", exact: true }).click();
  const trade = page.getByRole("dialog", { name: "A fair exchange", exact: true });
  await trade.getByRole("button", { name: "Player trade", exact: true }).click();
  await expect(trade.getByRole("button", { name: "Request cards", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(trade.getByRole("group", { name: "You offer", exact: true })).toHaveCount(0);
  const ask = trade.getByRole("button", { name: "Ask for these cards", exact: true });
  await expect(ask).toBeDisabled();
  await trade.getByRole("button", { name: "Add Ore to You ask for", exact: true }).click();
  await expect(ask).toBeEnabled();
  await expectResourceInventory(trade, requester.resources);
  await screenshot(page, testInfo, "request-only-trade", false);
  await ask.click();
  state = applyAction(state, requester.id, { type: "request-trade", receive: { ...emptyResources(), ore: 1 } });

  const openTrade = page.getByRole("region", { name: "Open trade", exact: true });
  await expect(openTrade.getByRole("heading", { name: "Trade request", exact: true })).toBeVisible();
  await expectTradeCards(openTrade, "You receive", { ...emptyResources(), ore: 1 });
  await expect(openTrade.getByRole("button", { name: "Complete trade", exact: true })).toHaveCount(0);
  await openTrade.getByRole("button", { name: "Pass to Jordan", exact: true }).click();
  expect(await revealHand(page)).toBe(responder.name);
  await expect(page.getByRole("region", { name: "Turn controls", exact: true }).getByRole("heading", { name: `${requester.name} - Their turn`, exact: true })).toBeVisible();
  await expectResourceInventory(openTrade, responder.resources);
  await expectTradeCards(openTrade, "You give", { ...emptyResources(), ore: 1 });
  await expect(openTrade.getByRole("button", { name: "Change offer", exact: true })).toHaveCount(0);
  const propose = openTrade.getByRole("button", { name: "Propose price", exact: true });
  await expect(propose).toBeDisabled();
  await openTrade.getByRole("button", { name: "Add Ore to You want in return", exact: true }).click();
  await expect(propose).toBeDisabled();
  await openTrade.getByRole("button", { name: "Remove Ore from You want in return", exact: true }).click();
  await openTrade.getByRole("button", { name: "Add Wood to You want in return", exact: true }).click();
  await openTrade.getByRole("button", { name: "Add Wood to You want in return", exact: true }).click();
  await expect(propose).toBeEnabled();
  await propose.scrollIntoViewIfNeeded();
  await noPageOverflow(page);
  await screenshot(page, testInfo, "trade-price-proposal", false);
  await propose.click();
  state = applyAction(state, responder.id, { type: "propose-trade", price: { ...emptyResources(), wood: 2 } });
  expect(await revealHand(page)).toBe(requester.name);
  await expect(page.getByRole("region", { name: "Turn controls", exact: true }).getByRole("heading", { name: `${requester.name} - Your turn`, exact: true })).toBeVisible();
  await expectResourceInventory(openTrade, requester.resources);

  await openTrade.getByRole("button", { name: "Pass to Alex", exact: true }).click();
  expect(await revealHand(page)).toBe(otherResponder.name);
  await expectResourceInventory(openTrade, otherResponder.resources);
  await expectResourceSelection(openTrade.getByRole("group", { name: "You want in return", exact: true }), "wood", 0);
  for (let count = 0; count < 3; count++) await openTrade.getByRole("button", { name: "Add Wood to You want in return", exact: true }).click();
  await openTrade.getByRole("button", { name: "Add Grain to You want in return", exact: true }).click();
  await propose.click();
  state = applyAction(state, otherResponder.id, { type: "propose-trade", price: { ...emptyResources(), wood: 3, grain: 1 } });
  expect(await revealHand(page)).toBe(requester.name);
  await expectResourceInventory(openTrade, requester.resources);
  const affordable = openTrade.getByRole("group", { name: "Jordan's trade response", exact: true });
  const unaffordable = openTrade.getByRole("group", { name: "Alex's trade response", exact: true });
  await expectTradeCards(affordable, "You give", { ...emptyResources(), wood: 2 });
  await expectTradeCards(unaffordable, "You give", { ...emptyResources(), wood: 3, grain: 1 });
  expect(requester.resources.wood).toBe(2);
  const missing = unaffordable.getByText("Missing 1 Wood, 1 Grain", { exact: true });
  await expect(missing).toBeVisible();
  const unavailable = unaffordable.getByRole("button", { name: "Complete trade", exact: true });
  await expect(unavailable).toBeDisabled();
  await expect(unavailable).toHaveAttribute("aria-describedby", (await missing.getAttribute("id"))!);
  await expect(unavailable).toHaveAccessibleDescription("Missing 1 Wood, 1 Grain");
  await expect(openTrade.getByText(/price proposed|You do not have these cards|You ask for:/)).toHaveCount(0);
  const complete = affordable.getByRole("button", { name: "Complete trade", exact: true });
  await expect(complete).toBeEnabled();
  await complete.scrollIntoViewIfNeeded();
  await noPageOverflow(page);
  await screenshot(page, testInfo, "compare-trade-prices", false);

  const responses = await openTrade.getByRole("group", { name: /'s trade response$/ }).allTextContents();
  const change = openTrade.getByRole("button", { name: "Change offer", exact: true });
  await change.focus();
  await page.keyboard.press("Enter");
  await expect(trade.getByRole("button", { name: "Close dialog", exact: true })).toBeFocused();
  await expect(trade.getByRole("button", { name: "Player trade", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(trade.getByRole("button", { name: "Exact offer", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expectResourceInventory(trade, requester.resources);
  const offeredCards = trade.getByRole("group", { name: "You offer", exact: true });
  const requestedCards = trade.getByRole("group", { name: "You ask for", exact: true });
  const submitOffer = trade.getByRole("button", { name: "Put the offer on the table", exact: true });
  await expect(submitOffer).toBeDisabled();
  for (const resource of RESOURCES) {
    await expectResourceSelection(requestedCards, resource, resource === "ore" ? 1 : 0);
    const selection = await expectResourceSelection(offeredCards, resource, 0, requester.resources[resource]);
    const add = selection.getByRole("button", { name: `Add ${RESOURCE_NAMES[resource]} to You offer`, exact: true });
    await expect(selection.getByRole("button", { name: `Remove ${RESOURCE_NAMES[resource]} from You offer`, exact: true })).toBeDisabled();
    for (let count = 0; count < requester.resources[resource]; count++) await add.click();
    await expect(add).toBeDisabled();
    await expectResourceSelection(offeredCards, resource, requester.resources[resource], requester.resources[resource]);
  }
  await noPageOverflow(page);
  await page.keyboard.press("Escape");
  await expect(trade).toHaveCount(0);
  await expect(change).toBeFocused();
  await expect(openTrade.getByRole("group", { name: /'s trade response$/ })).toHaveText(responses);
  await expectTradeCards(openTrade, "You receive", { ...emptyResources(), ore: 1 });
  await expectResourceInventory(openTrade, requester.resources);
  await expectResourceBank(page, state.bank);
  await expect(complete).toBeEnabled();
  await expect(unavailable).toBeDisabled();

  await page.keyboard.press("Space");
  await expectResourceSelection(offeredCards, "wood", 0, requester.resources.wood);
  await trade.getByRole("button", { name: "Close dialog", exact: true }).click();
  await expect(change).toBeFocused();
  await expect(openTrade.getByRole("group", { name: /'s trade response$/ })).toHaveText(responses);
  await page.keyboard.press("Enter");
  for (let count = 0; count < 2; count++) await offeredCards.getByRole("button", { name: "Add Wood to You offer", exact: true }).click();
  await expect(submitOffer).toBeEnabled();
  await submitOffer.scrollIntoViewIfNeeded();
  await noPageOverflow(page);
  await screenshot(page, testInfo, "change-request-exact-offer", false);
  await submitOffer.click();
  state = applyAction(state, requester.id, { type: "offer-trade", give: { ...emptyResources(), wood: 2 }, receive: { ...emptyResources(), ore: 1 } });
  await expect(openTrade.getByRole("heading", { name: "Trade offer", exact: true })).toBeVisible();
  await expectTradeCards(openTrade, "You give", { ...emptyResources(), wood: 2 });
  await expectTradeCards(openTrade, "You receive", { ...emptyResources(), ore: 1 });
  await expect(openTrade.getByText("not answered", { exact: true })).toHaveCount(2);
  await expect(openTrade.getByRole("button", { name: "Complete trade", exact: true })).toHaveCount(0);
  await expect(openTrade.getByText(/^Missing /)).toHaveCount(0);
  await expectResourceInventory(openTrade, requester.resources);
  await expectResourceBank(page, state.bank);

  await change.click();
  for (const resource of RESOURCES) {
    await expectResourceSelection(offeredCards, resource, resource === "wood" ? 2 : 0, requester.resources[resource]);
    await expectResourceSelection(requestedCards, resource, resource === "ore" ? 1 : 0);
  }
  await offeredCards.getByRole("button", { name: "Remove Wood from You offer", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(change).toBeFocused();
  await expectTradeCards(openTrade, "You give", { ...emptyResources(), wood: 2 });
  await expect(openTrade.getByText("not answered", { exact: true })).toHaveCount(2);
  await openTrade.getByRole("button", { name: "Pass to Jordan", exact: true }).click();
  expect(await revealHand(page)).toBe(responder.name);
  await expectTradeCards(openTrade, "You give", { ...emptyResources(), ore: 1 });
  await expectTradeCards(openTrade, "You receive", { ...emptyResources(), wood: 2 });
  await openTrade.getByRole("button", { name: "Accept offer", exact: true }).click();
  state = applyAction(state, responder.id, { type: "respond-trade", accept: true });
  expect(await revealHand(page)).toBe(requester.name);
  await expect(affordable.getByText("accepted", { exact: true })).toBeVisible();
  await complete.click();
  const confirmation = page.getByRole("dialog", { name: "Trade with Jordan", exact: true });
  await expectTradeCards(confirmation, "You give", { ...emptyResources(), wood: 2 });
  await expectTradeCards(confirmation, "You receive", { ...emptyResources(), ore: 1 });
  await expectResourceInventory(confirmation, requester.resources);
  await screenshot(page, testInfo, "request-trade-confirmation", false);
  await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
  await expectResourceInventory(openTrade, requester.resources);
  await expectResourceBank(page, state.bank);
  await complete.click();
  await confirmation.getByRole("button", { name: "Confirm", exact: true }).click();
  state = applyAction(state, requester.id, { type: "complete-trade", playerId: responder.id });
  await expect(openTrade).toHaveCount(0);
  const privateResources = page.getByRole("region", { name: "Private resources", exact: true });
  await expect(privateResources.getByText(/^\d+ (Wood|Brick|Wool|Grain|Ore)$/)).toHaveText(
    RESOURCES.map(resource => `${state.players.find(player => player.id === requester.id)!.resources[resource]} ${RESOURCE_NAMES[resource]}`),
  );
  await expectResourceBank(page, state.bank);

  await page.getByRole("button", { name: "Make a trade", exact: true }).click();
  await trade.getByRole("button", { name: "Request cards", exact: true }).click();
  await trade.getByRole("button", { name: "Add Ore to You ask for", exact: true }).click();
  await ask.click();
  await openTrade.getByRole("button", { name: "Pass to Jordan", exact: true }).click();
  expect(await revealHand(page)).toBe(responder.name);
  await expectResourceInventory(openTrade, state.players.find(player => player.id === responder.id)!.resources);
  // The responder paid away all Ore, so the requested card stays sharp but dimmed.
  const requestedOre = openTrade.getByRole("img", { name: "You give: 1 Ore", exact: true });
  await expect(requestedOre.locator(".resource-card")).toHaveCSS("filter", "none");
  await expect(requestedOre.locator(".resource-card")).toHaveCSS("opacity", "0.5");
  await expect(openTrade.getByText("Choose different cards in return.", { exact: true })).toHaveCount(0);
  await expect(openTrade.getByText("You do not have all the requested cards to offer this trade.", { exact: true })).toHaveCount(0);
  await openTrade.getByRole("button", { name: "Add Wood to You want in return", exact: true }).click();
  await expect(propose).toBeDisabled();
  await requestedOre.screenshot({ path: testInfo.outputPath("sharp-unavailable-trade-card.png") });
  await openTrade.getByRole("button", { name: "Decline", exact: true }).click();
  expect(await revealHand(page)).toBe(requester.name);
  await expect(affordable).toContainText("declined");
  await openTrade.getByRole("button", { name: "Withdraw request", exact: true }).click();
  await expect(openTrade).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await noPageOverflow(page);
});

test("owned resources stay visible through private trades and mandatory discards", async ({ page, isMobile }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize(isMobile ? { width: 390, height: 667 } : { width: 1280, height: 720 });
  await page.clock.install({ time: new Date("2026-10-31T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-31T00:00:01Z"));
  let state = await prepareRollGame(page);
  await revealBuildSection(page);
  await expectResourceBank(page, state.bank);
  await chooseDice(page, [2, 6]);
  for (let turn = 0; turn < 3; turn++) {
    await page.getByRole("button", { name: "Roll the dice", exact: true }).click();
    let diceIndex = 0;
    state = applyAction(state, state.activePlayerId, { type: "roll" }, () => ([2, 6][diceIndex++]! - 0.5) / 6);
    await expect(page.getByRole("button", { name: "End turn & pass device", exact: true })).toBeEnabled();
    if (turn < 2) {
      await page.getByRole("button", { name: "End turn & pass device", exact: true }).click();
      state = applyAction(state, state.activePlayerId, { type: "end-turn" });
      await revealHand(page);
    }
  }
  const trader = state.players.find(player => player.id === state.activePlayerId)!;
  const responder = state.players.find(player => player.id !== trader.id && resourceTotal(player.resources) > 7)!;
  expect(responder).toBeDefined();
  await expectResourceBank(page, state.bank);
  await expectPublicCardCounts(page, state);
  await screenshot(page, testInfo, "readable-public-card-totals", false);
  await showView(page, "hand");
  await page.getByRole("button", { name: "Make a trade", exact: true }).click();
  const trade = page.getByRole("dialog", { name: "A fair exchange", exact: true });
  await expect(trade.getByRole("region", { name: "Your current resources", includeHidden: true })).toHaveCount(0);
  await trade.getByRole("button", { name: "Player trade", exact: true }).click();
  const tradeInventory = await expectResourceInventory(trade, trader.resources);
  await trade.getByRole("button", { name: "Exact offer", exact: true }).click();
  const offeredCards = trade.getByRole("group", { name: "You offer", exact: true });
  for (const resource of RESOURCES) {
    const selection = await expectResourceSelection(offeredCards, resource, 0, trader.resources[resource]);
    await expect(selection.getByRole("button", { name: `Remove ${RESOURCE_NAMES[resource]} from You offer`, exact: true })).toBeDisabled();
    if (!trader.resources[resource]) await expect(selection.getByRole("button", { name: `Add ${RESOURCE_NAMES[resource]} to You offer`, exact: true })).toBeDisabled();
  }
  await offeredCards.getByRole("button", { name: "Add Wool to You offer", exact: true }).click();
  await expectResourceSelection(offeredCards, "wool", 1, trader.resources.wool);
  const requestedCards = trade.getByRole("group", { name: "You ask for", exact: true });
  await expect(requestedCards.getByText(/^In (hand|bank) /)).toHaveCount(0);
  await requestedCards.getByRole("button", { name: "Add Wood to You ask for", exact: true }).click();
  await expectResourceSelection(requestedCards, "wood", 1);
  const submitOffer = trade.getByRole("button", { name: "Put the offer on the table", exact: true });
  await submitOffer.scrollIntoViewIfNeeded();
  await expect(tradeInventory).toBeInViewport({ ratio: 1 });
  await expectResourceInventory(trade, trader.resources);
  await noPageOverflow(page);
  await screenshot(page, testInfo, "trade-owned-and-selected-resources", false);
  await submitOffer.click();
  state = applyAction(state, trader.id, { type: "offer-trade", give: { ...emptyResources(), wool: 1 }, receive: { ...emptyResources(), wood: 1 } });

  const openTrade = page.getByRole("region", { name: "Open trade", exact: true });
  await expectResourceInventory(openTrade, trader.resources);
  await openTrade.getByRole("button", { name: `Pass to ${responder.name}`, exact: true }).click();
  expect(await revealHand(page)).toBe(responder.name);
  await showView(page, "hand");
  // More than seven resource cards puts the hand at risk of a rolled seven; the count badge warns.
  const responseInventory = await expectResourceInventory(openTrade, responder.resources);
  const responderCount = responseInventory.getByText(`${resourceTotal(responder.resources)} cards`, { exact: true });
  await expect(responderCount).toBeVisible();
  await expect(responderCount).toHaveClass(/card-count-at-risk/);
  await expect(page.getByRole("region", { name: "Private resources", exact: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Your current resources", includeHidden: true })).toHaveCount(1);
  await expect(page.getByRole("heading", { name: `${trader.name}'s hand`, exact: true, includeHidden: true })).toHaveCount(0);
  for (const resource of RESOURCES.filter(resource => trader.resources[resource] !== responder.resources[resource])) {
    await expect(responseInventory.getByRole("listitem", { name: `${RESOURCE_NAMES[resource]}: ${trader.resources[resource]} in hand`, exact: true })).toHaveCount(0);
  }
  await responseInventory.scrollIntoViewIfNeeded();
  await expect(responseInventory).toBeInViewport({ ratio: 1 });
  await noPageOverflow(page);
  await screenshot(page, testInfo, "private-trade-response-inventory", false);
  await openTrade.getByRole("button", { name: "Accept offer", exact: true }).click();
  state = applyAction(state, responder.id, { type: "respond-trade", accept: true });
  expect(await revealHand(page)).toBe(trader.name);
  await openTrade.getByRole("button", { name: "Complete trade", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: `Trade with ${responder.name}`, exact: true });
  await expectResourceInventory(confirmation, trader.resources);
  await confirmation.getByRole("button", { name: "Confirm", exact: true }).click();
  state = applyAction(state, trader.id, { type: "complete-trade", playerId: responder.id });
  const privateResources = page.getByRole("region", { name: "Private resources", exact: true });
  await expect(privateResources.getByText(/^\d+ (Wood|Brick|Wool|Grain|Ore)$/)).toHaveText(
    RESOURCES.map(resource => `${state.players.find(player => player.id === trader.id)!.resources[resource]} ${RESOURCE_NAMES[resource]}`),
  );
  await page.getByRole("button", { name: "End turn & pass device", exact: true }).click();
  state = applyAction(state, trader.id, { type: "end-turn" });
  expect(await revealHand(page)).toBe(responder.name);
  expect(state.activePlayerId).toBe(responder.id);
  await chooseDice(page, [3, 4]);
  await page.getByRole("button", { name: "Roll the dice", exact: true }).click();
  let diceIndex = 0;
  state = applyAction(state, state.activePlayerId, { type: "roll" }, () => ([3, 4][diceIndex++]! - 0.5) / 6);
  const discarder = state.players.find(player => player.id === responder.id)!;
  const required = Math.floor(resourceTotal(discarder.resources) / 2);
  expect(state.phase).toEqual({ type: "discard", required: { [discarder.id]: required } });
  await showView(page, "hand");
  const bank = page.getByRole("group", { name: "Return to the bank", exact: true });
  const discard = page.locator(".hand-task").filter({ has: bank });
  const discardInventory = await expectResourceInventory(discard, discarder.resources);
  const confirmDiscard = discard.getByRole("button", { name: "Confirm discard", exact: true });
  await expect(confirmDiscard).toBeDisabled();
  await expect(discard.getByText(`Selected 0 of ${required}`, { exact: true })).toBeVisible();
  await expect(discard.getByText(`${resourceTotal(discarder.resources)} cards left`, { exact: true })).toBeVisible();
  for (const resource of RESOURCES) {
    const selection = await expectResourceSelection(bank, resource, 0, discarder.resources[resource]);
    await expect(selection.getByRole("button", { name: `Remove ${RESOURCE_NAMES[resource]} from Return to the bank`, exact: true })).toBeDisabled();
    if (!discarder.resources[resource]) await expect(selection.getByRole("button", { name: `Add ${RESOURCE_NAMES[resource]} to Return to the bank`, exact: true })).toBeDisabled();
  }
  const wood = bank.getByRole("group", { name: "Wood selection", exact: true });
  const addWood = wood.getByRole("button", { name: "Add Wood to Return to the bank", exact: true });
  const removeWood = wood.getByRole("button", { name: "Remove Wood from Return to the bank", exact: true });
  await expect(removeWood).toHaveCSS("color", "rgb(37, 59, 54)");
  await expect(removeWood).toHaveCSS("opacity", "0.4");
  for (let count = 0; count < discarder.resources.wood; count++) await addWood.click();
  await expect(addWood).toBeDisabled();
  await expectResourceSelection(bank, "wood", discarder.resources.wood, discarder.resources.wood);
  await expect(confirmDiscard).toBeDisabled();
  await expect(removeWood).toBeEnabled();
  await expect(removeWood).toHaveCSS("color", "rgb(37, 59, 54)");
  await expect(removeWood).toHaveCSS("opacity", "1");
  const discardViewport = page.viewportSize()!;
  await page.setViewportSize({ ...discardViewport, height: 1200 });
  await removeWood.screenshot({ path: testInfo.outputPath("readable-discard-minus.png") });
  await page.setViewportSize(discardViewport);
  await removeWood.click();
  await expectResourceSelection(bank, "wood", discarder.resources.wood - 1, discarder.resources.wood);
  await expect(discard.getByText(`Selected ${discarder.resources.wood - 1} of ${required}`, { exact: true })).toBeVisible();
  await expect(discard.getByText(`${resourceTotal(discarder.resources) - discarder.resources.wood + 1} cards left`, { exact: true })).toBeVisible();
  await addWood.click();
  const selectedResources = { ...emptyResources(), wood: discarder.resources.wood };
  let remaining = required - selectedResources.wood;
  for (const resource of RESOURCES.filter(resource => resource !== "wood")) {
    selectedResources[resource] = Math.min(remaining, discarder.resources[resource]);
    for (let count = 0; count < selectedResources[resource]; count++) {
      await bank.getByRole("button", { name: `Add ${RESOURCE_NAMES[resource]} to Return to the bank`, exact: true }).click();
    }
    remaining -= selectedResources[resource];
  }
  expect(remaining).toBe(0);
  await expect(confirmDiscard).toBeEnabled();
  await expectResourceInventory(discard, discarder.resources);
  await expect(discard.getByText(`Selected ${required} of ${required}`, { exact: true })).toBeVisible();
  await expect(discard.getByText(`${resourceTotal(discarder.resources) - required} cards left`, { exact: true })).toBeVisible();
  for (const resource of RESOURCES) {
    await expectResourceSelection(bank, resource, selectedResources[resource], discarder.resources[resource]);
  }
  await confirmDiscard.scrollIntoViewIfNeeded();
  await expect(discardInventory).toBeInViewport({ ratio: 1 });
  await expect(confirmDiscard).toBeInViewport({ ratio: 1 });
  await noPageOverflow(page);
  await screenshot(page, testInfo, "discard-owned-selected-and-remaining", false);
  await confirmDiscard.click();
  state = applyAction(state, discarder.id, { type: "discard", resources: selectedResources });
  await expectResourceBank(page, state.bank);
  await expect(page.getByRole("region", { name: "Your current resources", includeHidden: true })).toHaveCount(0);
  await showView(page, "hand");
  const remainingResources = state.players.find(player => player.id === discarder.id)!.resources;
  await expect(privateResources.getByText(/^\d+ (Wood|Brick|Wool|Grain|Ore)$/)).toHaveText(
    RESOURCES.map(resource => `${remainingResources[resource]} ${RESOURCE_NAMES[resource]}`),
  );
  const remainingCount = privateResources.getByText(`${resourceTotal(remainingResources)} cards`, { exact: true });
  await expect(remainingCount).toBeVisible();
  if (resourceTotal(remainingResources) > 7) {
    await expect(remainingCount).toHaveClass(/card-count-at-risk/);
  } else {
    await expect(remainingCount).not.toHaveClass(/card-count-at-risk/);
  }
  await expectPublicCardCounts(page, state);
});

test("bank receipts animate identical gains again and expire independently", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.install({ time: new Date("2026-10-31T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-31T00:00:01Z"));
  let state = await prepareRollGame(page);
  await revealBuildSection(page);
  await chooseDice(page, [2, 6]);
  for (let turn = 0; turn < 4; turn++) {
    await page.getByRole("button", { name: "Roll the dice", exact: true }).click();
    let diceIndex = 0;
    state = applyAction(state, state.activePlayerId, { type: "roll" }, () => ([2, 6][diceIndex++]! - 0.5) / 6);
    await expect(page.getByRole("button", { name: "End turn & pass device", exact: true })).toBeEnabled();
    if (turn < 3) {
      await page.getByRole("button", { name: "End turn & pass device", exact: true }).click();
      state = applyAction(state, state.activePlayerId, { type: "end-turn" });
      await revealHand(page);
    }
  }
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const collection = page.getByRole("region", { name: "Resource collection" });
  await showView(page, "board");
  const receiptFrame = await boardFrame(page);
  await showView(page, "hand");
  for (const [index, resource] of ["Wood", "Ore"].entries()) {
    const previousCard = await collection.getByRole("listitem").first().elementHandle();
    await page.getByRole("button", { name: "Make a trade", exact: true }).click();
    const trade = page.getByRole("dialog", { name: "A fair exchange" });
    const ownedResources = state.players.find(player => player.id === state.activePlayerId)!.resources;
    await expect(trade.getByRole("region", { name: "Your current resources", includeHidden: true })).toHaveCount(0);
    await trade.getByRole("button", { name: "Player trade", exact: true }).click();
    await expectResourceInventory(trade, ownedResources);
    await trade.getByRole("button", { name: "Bank & ports", exact: true }).click();
    await expect(trade.getByRole("region", { name: "Your current resources", includeHidden: true })).toHaveCount(0);
    for (const resource of RESOURCES) {
      const give = trade.getByRole("button", { name: `Give ${RESOURCE_NAMES[resource]}`, exact: true });
      const receive = trade.getByRole("button", { name: `Receive ${RESOURCE_NAMES[resource]}`, exact: true });
      await expect(give).toHaveAccessibleDescription(`In hand: ${ownedResources[resource]}. ${getTradeRatio(state, state.activePlayerId, resource)}:1`);
      await expect(receive).toHaveAccessibleDescription(`In bank: ${state.bank[resource]}.`);
      await expect(give.getByText(String(ownedResources[resource]), { exact: true })).toBeVisible();
      await expect(receive.getByText(String(state.bank[resource]), { exact: true })).toBeVisible();
      await expect(give.getByText(/^In hand:/)).toHaveCount(0);
      await expect(receive.getByText(/^In bank:/)).toHaveCount(0);
    }
    await expect(trade.getByRole("group", { name: "Take 1 from the bank", exact: true })).toBeVisible();
    await trade.getByRole("button", { name: `Give ${resource}`, exact: true }).click();
    await trade.getByRole("button", { name: "Receive Brick", exact: true }).click();
    const giveResource = resource === "Wood" ? "wood" : "ore";
    const afterExchange = applyAction(state, state.activePlayerId, { type: "bank-trade", give: giveResource, receive: "brick" });
    const afterResources = afterExchange.players.find(player => player.id === state.activePlayerId)!.resources;
    await expect(trade.getByRole("status", { name: "Hand after exchange", exact: true })).toHaveText(
      `After exchange: ${afterResources[giveResource]} ${resource}, ${afterResources.brick} Brick in your hand. Other cards stay the same.`,
    );
    await trade.getByRole("button", { name: "Confirm exchange", exact: true }).scrollIntoViewIfNeeded();
    await screenshot(page, testInfo, `bank-exchange-${index}`, false);
    await trade.getByRole("button", { name: "Confirm exchange", exact: true }).click();
    state = afterExchange;
    await expect(trade).toHaveCount(0);
    await expectResourceBank(page, state.bank);
    await expect(collection).toBeInViewport({ ratio: 1 });
    await expect(collection.getByRole("listitem")).toHaveCount(1);
    const receivedCard = collection.getByRole("listitem", { name: "Brick +1", exact: true });
    await verifyResourceAnimation(receivedCard, "resource-collect");
    expect(await previousCard!.evaluate(element => element.isConnected)).toBe(false);
    await expect(page.getByRole("region", { name: "Private resources" }).getByTitle(`${index + 1} Brick`, { exact: true })).toBeVisible();
    if (index === 0) await page.clock.runFor(1000);
  }
  await showView(page, "board");
  await expectBoardFrame(page, receiptFrame);
  await screenshot(page, testInfo, "bank-resource-collection", false);
  await page.clock.runFor(2200);
  await expect(collection).toBeVisible();
  await page.clock.runFor(999);
  await expect(collection).toBeVisible();
  await page.clock.runFor(1);
  await expect(collection).toHaveCount(0);
  await expect(page.getByLabel(/^Received /)).toHaveCount(0);
  await expect(page.getByRole("status", { name: "Resource receipt" })).toBeEmpty();
  await expectBoardFrame(page, receiptFrame);
  await screenshot(page, testInfo, "bank-resource-expired", false);
});

test("ending an in-flight roll cancels its result before a new game", async ({ page }) => {
  await prepareRollGame(page);
  await chooseDice(page, [2, 3]);
  await page.clock.install({ time: new Date("2026-10-31T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-31T00:00:01Z"));
  await page.getByRole("button", { name: "Roll the dice", exact: true }).click();
  await expect(page.getByRole("region", { name: "Roll result" })).toHaveAttribute("data-stage", "rolling");
  await chooseGameOption(page, "End game");
  await page.getByRole("dialog", { name: "Leave this island?", exact: true }).getByRole("button", { name: "End game", exact: true }).click();
  await page.getByRole("button", { name: "Let's settle in", exact: true }).click();
  await page.clock.runFor(5_000);
  await expect(page.getByRole("region", { name: "Roll result" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /^Pass the device to / })).toBeVisible();
  await expect(page.getByRole("img", { name: /'s settlement at /, includeHidden: true })).toHaveCount(0);
  await privateHandIsAbsent(page);
});

async function resolveHumanRoll(page: Page) {
  await page.getByRole("button", { name: "Roll the dice", exact: true }).click();
  const endTurn = page.getByRole("button", { name: /^End turn/ }).and(page.locator(":enabled"));
  const discard = page.getByRole("button", { name: "Confirm discard", exact: true });
  const robber = page.getByRole("button", { name: /^Move robber to / }).first();
  const victims = page.locator("section").filter({ has: page.getByRole("heading", { name: "Choose a player to steal from", exact: true }) });
  for (let step = 0; step < 4; step++) {
    await expect(endTurn.or(discard).or(robber).or(victims).first()).toBeVisible({ timeout: 15_000 });
    if (await endTurn.count()) return;
    if (await discard.count()) {
      const prompt = await page.getByText(/^Selected \d+ of \d+$/).innerText();
      const [selected, required] = prompt.match(/\d+/g)!.map(Number);
      let remaining = required! - selected!;
      const bank = page.getByRole("group", { name: "Return to the bank", exact: true });
      for (const resource of ["Wood", "Brick", "Wool", "Grain", "Ore"]) {
        const add = bank.getByRole("button", { name: `Add ${resource} to Return to the bank`, exact: true });
        while (remaining > 0 && (await add.isEnabled())) {
          await add.click();
          remaining -= 1;
        }
      }
      expect(remaining).toBe(0);
      await discard.click();
    } else if (await robber.count()) {
      await robber.click();
      await page.getByRole("button", { name: "Confirm placement", exact: true }).click();
    } else {
      await victims.getByRole("button").first().click();
      await page.getByRole("dialog", { name: "Confirm theft", exact: true }).getByRole("button", { name: "Confirm", exact: true }).click();
    }
  }
  await expect(endTurn).toBeVisible();
}

test("solo trade quotes show missing cards and complete an affordable exchange with keyboard confirmation", async ({ page }, testInfo) => {
  const browserErrors: string[] = [];
  page.on("pageerror", error => browserErrors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("requestfailed", request => browserErrors.push(`${request.url()}: ${request.failure()?.errorText}`));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const fixture = await seedGameRandomness(page, 3, 1, "222222AP");
  const random = fixture.random;
  let state = createGame(["Alex", "Computer 1", "Computer 2"].map((name, index) => ({
    name, color: ["#b85d47", "#477c91", "#c1953d"][index]!, control: index === 0 ? "human" as const : "computer" as const,
  })), random, fixture.board);
  const requesterId = state.players.find(player => player.control === "human")!.id;
  // Mirror real computer setup and turns, including a theft, without injecting game state into the browser.
  for (let step = 0; step < 40 && !(state.activePlayerId === requesterId && state.phase.type === "roll"); step++) {
    const action = state.activePlayerId !== requesterId ? chooseComputerAction(state, state.activePlayerId)
      : state.phase.type === "setup-settlement"
        ? { type: "place-settlement" as const, vertexId: legalSettlementVertices(state, requesterId)[0]! }
        : { type: "place-road" as const, edgeId: legalRoadEdges(state, requesterId)[0]! };
    expect(action).not.toBeNull();
    state = applyAction(state, state.activePlayerId, action!, random);
  }
  expect(state.activePlayerId).toBe(requesterId);
  expect(state.phase.type).toBe("roll");
  await page.getByRole("button", { name: "Let's settle in", exact: true }).click();
  for (let placement = 0; placement < 2; placement++) await placeStartingPieces(page);
  for (const [index, player] of state.players.entries()) {
    const settlements = page.getByRole("img", { name: `${player.name}'s settlement at `, includeHidden: true }).locator("text");
    await expect(settlements).toHaveText(Array(2).fill(player.control === "human" ? "A" : String(index + 1)));
  }
  await showView(page, "hand");
  await revealBuildSection(page);
  await expect(page.getByRole("button", { name: "Roll the dice", exact: true })).toBeEnabled({ timeout: 20_000 });
  const robbery = state.thefts.find(theft => theft.victimId === requesterId)!;
  expect(robbery).toBeDefined();
  const robberName = state.players.find(player => player.id === robbery.thiefId)!.name;
  const robberyNotice = page.getByRole("region", { name: "Robbery notification", exact: true });
  await robberyNotice.scrollIntoViewIfNeeded();
  await expect(robberyNotice.getByRole("heading", { name: `${robberName} robbed you`, exact: true })).toBeVisible();
  await expect(robberyNotice.getByText("-1", { exact: true })).toBeVisible();
  await expect(page.getByRole("status", { name: "Robbery result", exact: true })).toHaveText(`${robberName} robbed you of 1 ${RESOURCE_NAMES[robbery.resource]}.`);
  await screenshot(page, testInfo, "solo-robbery-victim", false);
  await robberyNotice.getByRole("button", { name: "Dismiss robbery notification", exact: true }).click();
  await chooseDice(page, [1, 3]);
  await page.getByRole("button", { name: "Roll the dice", exact: true }).click();
  let diceIndex = 0;
  state = applyAction(state, requesterId, { type: "roll" }, () => ([1, 3][diceIndex++]! - 0.5) / 6);
  const requester = state.players.find(player => player.id === requesterId)!;
  expect(requester.resources).toEqual({ ...emptyResources(), wood: 1, wool: 1, grain: 1 });
  const bankBefore = { ...state.bank };
  await expectResourceBank(page, bankBefore);
  await page.getByRole("button", { name: "Make a trade", exact: true }).click();
  const trade = page.getByRole("dialog", { name: "A fair exchange", exact: true });
  await expect(trade.getByRole("region", { name: "Your current resources", includeHidden: true })).toHaveCount(0);
  await trade.getByRole("button", { name: "Player trade", exact: true }).click();
  await expectResourceInventory(trade, requester.resources);
  await trade.getByRole("button", { name: "Add Ore to You ask for", exact: true }).click();
  await trade.getByRole("button", { name: "Ask for these cards", exact: true }).click();
  state = applyAction(state, requesterId, { type: "request-trade", receive: { ...emptyResources(), ore: 1 } });
  for (const player of state.players.filter(player => player.control === "computer")) {
    const response = chooseComputerAction(state, player.id);
    expect(response?.type).toBe("propose-trade");
    state = applyAction(state, player.id, response!);
  }
  const unavailablePlayer = state.players.find(player => player.name === "Computer 1")!;
  const affordablePlayer = state.players.find(player => player.name === "Computer 2")!;
  expect(state.trade!.responses[unavailablePlayer.id]).toEqual({ ...emptyResources(), brick: 1 });
  expect(state.trade!.responses[affordablePlayer.id]).toEqual({ ...emptyResources(), wood: 1 });
  const openTrade = page.getByRole("region", { name: "Open trade", exact: true });
  await expect(openTrade).not.toContainText("not answered", { timeout: 10_000 });
  await expect(openTrade.getByRole("heading", { name: "Trade request", exact: true })).toBeVisible();
  await expectTradeCards(openTrade, "You receive", { ...emptyResources(), ore: 1 });
  await expect(openTrade.getByText(/price proposed|You do not have these cards|You ask for:/)).toHaveCount(0);
  await expectResourceInventory(openTrade, requester.resources);
  await expectResourceBank(page, bankBefore);
  const unaffordable = openTrade.getByRole("group", { name: "Computer 1's trade response", exact: true });
  const affordable = openTrade.getByRole("group", { name: "Computer 2's trade response", exact: true });
  await expectTradeCards(unaffordable, "You give", { ...emptyResources(), brick: 1 });
  await expectTradeCards(affordable, "You give", { ...emptyResources(), wood: 1 });
  const unavailable = unaffordable.getByRole("button", { name: "Complete trade", exact: true });
  const missing = unaffordable.getByText("Missing 1 Brick", { exact: true });
  await expect(unavailable).toBeDisabled();
  await expect(missing).toBeVisible();
  await expect(unavailable).toHaveAttribute("aria-describedby", (await missing.getAttribute("id"))!);
  await expect(unavailable).toHaveAccessibleDescription("Missing 1 Brick");
  await missing.scrollIntoViewIfNeeded();
  await noPageOverflow(page);
  await screenshot(page, testInfo, "solo-trade-missing-cards", false);
  const complete = affordable.getByRole("button", { name: "Complete trade", exact: true });
  await expect(complete).toBeEnabled();
  await expect(complete).not.toHaveAttribute("aria-describedby");
  await expect(affordable.getByText(/^Missing /)).toHaveCount(0);
  await complete.scrollIntoViewIfNeeded();
  await noPageOverflow(page);
  await screenshot(page, testInfo, "solo-trade-affordable", false);
  await expect(page.getByRole("button", { name: /Reveal my hand|Pass to Computer|Pass device|Return to /, includeHidden: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /^Computer \d+'s hand$/, includeHidden: true })).toHaveCount(0);

  const responses = await openTrade.getByRole("group", { name: /'s trade response$/ }).allTextContents();
  const resourceCounts = page.getByRole("region", { name: "Private resources", exact: true, includeHidden: true }).getByText(/^\d+ (Wood|Brick|Wool|Grain|Ore)$/);
  const countsBefore = RESOURCES.map(resource => `${requester.resources[resource]} ${RESOURCE_NAMES[resource]}`);
  await complete.focus();
  await page.keyboard.press("Enter");
  const confirmation = page.getByRole("dialog", { name: "Trade with Computer 2", exact: true });
  await expect(confirmation.getByRole("button", { name: "Close dialog", exact: true })).toBeFocused();
  await expectTradeCards(confirmation, "You give", { ...emptyResources(), wood: 1 });
  await expectTradeCards(confirmation, "You receive", { ...emptyResources(), ore: 1 });
  await expect(confirmation.getByText("You give 1 Wood and receive 1 Ore.", { exact: true })).toHaveCount(0);
  await expectResourceInventory(confirmation, requester.resources);
  await expect(resourceCounts).toHaveText(countsBefore);
  const bank = page.getByRole("region", { name: "Resource bank", exact: true, includeHidden: true });
  for (const resource of RESOURCES) {
    await expect(bank.getByRole("listitem", {
      name: `${RESOURCE_NAMES[resource]}: ${bankBefore[resource]} in bank`, exact: true, includeHidden: true,
    })).toHaveCount(1);
  }
  await noPageOverflow(page);
  await screenshot(page, testInfo, "solo-trade-confirmation", false);
  await page.keyboard.press("Escape");
  await expect(confirmation).toHaveCount(0);
  await expect(complete).toBeFocused();
  await expect(openTrade.getByRole("group", { name: /'s trade response$/ })).toHaveText(responses);
  await expectResourceInventory(openTrade, requester.resources);
  await expect(resourceCounts).toHaveText(countsBefore);
  await expectResourceBank(page, bankBefore);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await expect(confirmation.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(confirmation.getByRole("button", { name: "Confirm", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  state = applyAction(state, requesterId, { type: "complete-trade", playerId: affordablePlayer.id });
  expect(state.bank).toEqual(bankBefore);
  await expect(confirmation).toHaveCount(0);
  await expect(openTrade).toHaveCount(0);
  await expect(resourceCounts).toHaveText(RESOURCES.map(resource =>
    `${state.players.find(player => player.id === requesterId)!.resources[resource]} ${RESOURCE_NAMES[resource]}`,
  ));
  await expectResourceBank(page, bankBefore);
  await expectPublicCardCounts(page, state);
  await expect(page.getByRole("heading", { name: /^Computer \d+'s hand$/, includeHidden: true })).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await noPageOverflow(page);
  expect(browserErrors).toEqual([]);
});

test("solo AI setup, automatic trade responses and turns never require hand reveals", async ({ page, isMobile }, testInfo) => {
  await page.goto("/");
  if (isMobile) await page.setViewportSize({ width: 320, height: 844 });
  await noHorizontalOverflow(page);
  await seedGameRandomness(page, 3, 1, "TESTMAP2");
  await screenshot(page, testInfo, "solo-table");
  await page.getByRole("button", { name: "Let's settle in", exact: true }).click();
  await showView(page, "hand");
  await expect(page.getByRole("status", { name: "Computer activity" })).toContainText("Computer");
  await expect(page.getByRole("heading", { name: "Alex's hand", exact: true, includeHidden: true })).toHaveCount(1);
  await expect(page.getByRole("button", { name: /Reveal my hand|Pass device|Return to /, includeHidden: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Private resources" })).toBeVisible();
  await revealBuildSection(page);
  await expect(page.getByRole("button", { name: "Make a trade", exact: true })).toBeDisabled();
  await screenshot(page, testInfo, "solo-computer-turn");

  for (let placement = 0; placement < 2; placement++) {
    await placeStartingPieces(page);
    await expect(page.getByRole("heading", { name: /Reveal|Pass the device/ })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Alex's hand", exact: true, includeHidden: true })).toHaveCount(1);
  }
  await expect(page.getByRole("img", { name: /'s road at /, includeHidden: true })).toHaveCount(6, { timeout: 15_000 });
  await showView(page, "hand");
  await revealBuildSection(page);
  await expect(page.getByRole("button", { name: "Roll the dice", exact: true })).toBeEnabled({ timeout: 15_000 });
  await resolveHumanRoll(page);
  await page.getByRole("button", { name: "Make a trade", exact: true }).click();
  const trade = page.getByRole("dialog", { name: "A fair exchange", exact: true });
  await trade.getByRole("button", { name: "Player trade", exact: true }).click();
  await trade.getByRole("button", { name: "Exact offer", exact: true }).click();
  const addition = trade.getByRole("group", { name: "You offer", exact: true }).getByRole("button", { name: /^Add / }).and(page.locator(":enabled")).first();
  const offeredResource = (await addition.getAttribute("aria-label"))!.replace(/^Add /, "").replace(/ to You offer$/, "");
  await addition.click();
  await trade.getByRole("button", { name: `Add ${offeredResource === "Wood" ? "Brick" : "Wood"} to You ask for`, exact: true }).click();
  await trade.getByRole("button", { name: "Put the offer on the table", exact: true }).click();
  const offer = page.getByRole("region", { name: "Open trade", exact: true });
  await expect(offer).not.toContainText("not answered", { timeout: 10_000 });
  await expect(offer.getByText("accepted", { exact: true }).or(offer.getByText("declined", { exact: true }))).toHaveCount(2);
  await expect(page.getByRole("button", { name: /^Pass to Computer/, includeHidden: true })).toHaveCount(0);
  await screenshot(page, testInfo, "solo-trade-responses");
  await page.getByRole("button", { name: "Withdraw offer", exact: true }).click();
  await page.getByRole("button", { name: "Make a trade", exact: true }).click();
  await trade.getByRole("button", { name: "Request cards", exact: true }).click();
  await trade.getByRole("button", { name: "Add Wood to You ask for", exact: true }).click();
  await trade.getByRole("button", { name: "Ask for these cards", exact: true }).click();
  await expect(offer).not.toContainText("not answered", { timeout: 10_000 });
  await expect(offer.getByRole("button", { name: "Complete trade", exact: true }).or(offer.getByText("declined", { exact: true }))).toHaveCount(2);
  await expect(offer.getByText("price proposed", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Pass to Computer/, includeHidden: true })).toHaveCount(0);
  await screenshot(page, testInfo, "solo-request-responses");
  await page.getByRole("button", { name: "Withdraw request", exact: true }).click();
  await page.clock.install({ time: new Date("2026-10-31T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-31T00:00:01Z"));
  await showView(page, "board");
  const humanTurnFrame = await boardFrame(page);
  await showView(page, "hand");
  await page.getByRole("button", { name: "End turn", exact: true }).click();
  await expect(page.getByRole("status", { name: "Computer activity" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Turn controls", exact: true }).getByRole("heading", { name: /^Computer \d+ - Their turn$/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Roll the dice", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "End turn", exact: true })).toBeDisabled();
  const settlement = page.getByRole("button", { name: /^Build settlement\b/ });
  await expect(settlement).toBeDisabled();
  await expect(settlement).not.toHaveAttribute("aria-describedby");
  await expect(page.locator("#settlement-build-explanation")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Private resources" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Reveal my hand|Pass device|Return to /, includeHidden: true })).toHaveCount(0);
  await showView(page, "board");
  await expectBoardFrame(page, humanTurnFrame);
  await page.clock.runFor(450);
  const computerRoll = page.getByRole("region", { name: "Roll result" });
  await expect(computerRoll).toHaveAttribute("data-stage", "rolling");
  await expect(computerRoll).toHaveText("Rolling...");
  await expect(computerRoll.getByRole("img", { name: "Dice rolling", exact: true })).toBeVisible();
  await expectBoardFrame(page, humanTurnFrame);
  await page.clock.runFor(500);
  await expect(computerRoll).toHaveAttribute("data-stage", "production");
  await expectBoardFrame(page, humanTurnFrame);
  await page.clock.runFor(300);
  await expect(computerRoll).toHaveAttribute("data-stage", "received");
  await expectBoardFrame(page, humanTurnFrame);
  await page.clock.runFor(699);
  await expect(computerRoll).toHaveAttribute("data-stage", "received");
  await page.clock.runFor(1);
  await expect(computerRoll).toHaveAttribute("data-stage", "complete");
  await expectBoardFrame(page, humanTurnFrame);
  await page.clock.runFor(449);
  await expect(computerRoll).toHaveAttribute("data-stage", "complete");
  await expect(page.getByRole("heading", { name: /^Computer \d+'s hand$/, includeHidden: true })).toHaveCount(0);
  await showView(page, "hand");
  for (let step = 0; step < 20 && !(await page.getByRole("button", { name: "Roll the dice", exact: true }).isEnabled()); step++) {
    await page.clock.runFor(450);
    if (await offer.isVisible()) await offer.getByRole("button", { name: "Decline", exact: true }).click();
  }
  await page.clock.resume();
  await expect(page.getByRole("button", { name: "Roll the dice", exact: true })).toBeEnabled({ timeout: 20_000 });
  await expect(page.getByRole("region", { name: "Turn controls", exact: true }).getByRole("heading", { name: "Alex - Your turn", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Alex's hand", exact: true })).toBeVisible();
  await expect(page.getByRole("status", { name: "Computer activity", includeHidden: true })).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await showView(page, "board");
  await expectBoardFrame(page, humanTurnFrame);
  await showView(page, "hand");
  await noPageOverflow(page);
  await screenshot(page, testInfo, "solo-next-turn");
});

async function prepareComputerRequest(page: Page, humanDice: [number, number], computerDice: [number, number], mapCode: string) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await seedGameRandomness(page, 3, 1, mapCode);
  await page.getByRole("button", { name: "Let's settle in", exact: true }).click();
  for (let placement = 0; placement < 2; placement++) await placeStartingPieces(page);
  await showView(page, "hand");
  const roll = page.getByRole("button", { name: "Roll the dice", exact: true });
  const request = page.getByRole("region", { name: "Open trade", exact: true });
  await expect.poll(async () => {
    const decline = request.getByRole("button", { name: "Decline", exact: true });
    if (await decline.isVisible()) await decline.click();
    return roll.isEnabled();
  }, { timeout: 20_000 }).toBe(true);
  await chooseDice(page, humanDice);
  await roll.click();
  await chooseDice(page, computerDice);
  await page.clock.install({ time: new Date("2026-11-04T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-11-04T00:00:01Z"));
  await page.getByRole("button", { name: "End turn", exact: true }).click();
  for (let step = 0; step < 12 && !(await request.isVisible()); step++) await page.clock.runFor(450);
  await expect(request.getByRole("heading", { name: "Trade request", exact: true })).toBeVisible();
  return request;
}

test("computer resource requests accept useful human prices without revealing computer hands", async ({ page }, testInfo) => {
  const request = await prepareComputerRequest(page, [1, 2], [1, 5], "222222DV");
  await expect(request.getByText("From Computer 2", { exact: true })).toBeVisible();
  await expect(request.getByText("Computer players wait up to 15 seconds for prices.", { exact: true })).toBeVisible();
  const give = { ...emptyResources(), wood: 1, grain: 1 };
  await expectTradeCards(request, "You give", give);
  const inventory = { ...emptyResources(), wood: 1, grain: 1 };
  await expectResourceInventory(request, inventory);
  const bank = await page.getByRole("region", { name: "Resource bank", exact: true }).innerText();
  await request.getByRole("button", { name: "Add Brick to You want in return", exact: true }).click();
  await expect(request.getByRole("button", { name: "Propose price", exact: true })).toBeEnabled();
  await request.scrollIntoViewIfNeeded();
  await noHorizontalOverflow(page);
  await screenshot(page, testInfo, "computer-resource-request");
  await request.getByRole("button", { name: "Propose price", exact: true }).click();
  await page.clock.runFor(450);
  await page.clock.runFor(450);
  await expect(request).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Resource bank", exact: true })).toHaveText(bank, { useInnerText: true });
  await expect(page.getByRole("heading", { name: "Alex's hand", exact: true, includeHidden: true })).toHaveCount(1);
  await expect(page.getByRole("heading", { name: /^Computer \d+'s hand$/, includeHidden: true })).toHaveCount(0);
  const receipt = page.getByRole("region", { name: "Resource collection", exact: true });
  await expect(receipt.getByRole("listitem", { name: "Brick +1", exact: true })).toBeVisible();
  const hand = page.getByRole("region", { name: "Private resources", exact: true });
  await expect(hand.getByText("1 Brick", { exact: true })).toBeVisible();
  await expect(hand.getByText("0 Wood", { exact: true })).toBeVisible();
  await expect(hand.getByText("0 Grain", { exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("unanswered computer resource requests stay open for 15 seconds then resume the turn", async ({ page }) => {
  const request = await prepareComputerRequest(page, [1, 1], [1, 1], "2222223J");
  await expect(request.getByText("From Computer 1", { exact: true })).toBeVisible();
  await expect(request.getByRole("button", { name: "Propose price", exact: true })).toBeDisabled();
  await page.clock.runFor(450);
  await page.clock.runFor(14_549);
  await expect(request).toBeVisible();
  await page.clock.runFor(1);
  await expect(request).toHaveCount(0);
  await page.clock.runFor(450);
  await expect(page.getByRole("region", { name: "Turn controls", exact: true })
    .getByRole("heading", { name: "Computer 2 - Their turn", exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("two humans keep private handoffs and cannot open computer hands", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.getByRole("button", { name: "4 players", exact: true }).click();
  await page.getByRole("combobox", { name: "Human players", exact: true }).selectOption("2");
  await seedGameRandomness(page, 4);
  await page.getByRole("button", { name: "Let's settle in", exact: true }).click();
  await privateHandIsAbsent(page);
  const humanOrder: string[] = [];
  for (let placement = 0; placement < 4; placement++) {
    const handoff = page.getByRole("heading", { name: /^Pass the device to / });
    const settlement = page.getByRole("button", { name: /^Place settlement at/ }).first();
    await expect(handoff.or(settlement).first()).toBeVisible({ timeout: 15_000 });
    if (await handoff.count()) {
      const name = await revealHand(page);
      expect(["Alex", "Sam"]).toContain(name);
      humanOrder.push(name);
    }
    if (placement === 0) {
      await chooseGameOption(page, "Pass device");
      const pass = page.getByRole("dialog", { name: "Pass the device", exact: true });
      await expect(pass.getByRole("button", { name: "Alex", exact: true })).toBeVisible();
      await expect(pass.getByRole("button", { name: "Sam", exact: true })).toBeVisible();
      await expect(pass.getByRole("button", { name: /^Computer/ })).toHaveCount(0);
      await expect(pass.locator(".player-seat")).toHaveCount(0);
      await expect(pass.getByRole("region", { name: "Your current resources", includeHidden: true })).toHaveCount(0);
      await screenshot(page, testInfo, "human-only-handoffs");
      await pass.getByRole("button", { name: "Close dialog", exact: true }).click();
    }
    await placeStartingPieces(page);
    await expect(page.getByRole("heading", { name: /^Computer \d+'s hand$/, includeHidden: true })).toHaveCount(0);
  }
  expect(new Set(humanOrder)).toEqual(new Set(["Alex", "Sam"]));
  await expect(page.getByRole("img", { name: /'s road at /, includeHidden: true })).toHaveCount(8, { timeout: 15_000 });
  await expect(page.getByRole("alert")).toHaveCount(0);
  await noHorizontalOverflow(page);
});

test("ending a game cancels a queued computer move before a new table starts", async ({ page }) => {
  await page.goto("/");
  await page.clock.install({ time: new Date("2026-10-31T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-31T00:00:01Z"));
  await seedGameRandomness(page);
  await page.getByRole("button", { name: "Let's settle in", exact: true }).click();
  await showView(page, "hand");
  await expect(page.getByRole("status", { name: "Computer activity" })).toBeVisible();
  await chooseGameOption(page, "End game");
  await page.getByRole("dialog", { name: "Leave this island?", exact: true }).getByRole("button", { name: "End game", exact: true }).click();
  await page.getByRole("combobox", { name: "Human players", exact: true }).selectOption("3");
  await page.getByRole("button", { name: "Let's settle in", exact: true }).click();
  await page.clock.fastForward(5_000);
  await privateHandIsAbsent(page);
  await expect(page.getByRole("heading", { name: /^Pass the device to / })).toBeVisible();
  await expect(page.getByRole("img", { name: /'s settlement at /, includeHidden: true })).toHaveCount(0);
  await expect(page.getByRole("status", { name: "Computer activity" })).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
});
