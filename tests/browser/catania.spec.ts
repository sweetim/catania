import { expect, test as base, type Locator, type Page, type TestInfo } from "@playwright/test";
import { createBoard } from "../../src/game/board";
import { applyAction, COSTS, createGame, emptyResources, getTradeRatio, legalRoadEdges, legalSettlementVertices, RESOURCES, resourceTotal } from "../../src/game/engine";
import { chooseComputerAction } from "../../src/game/computer";
import type { GameState, Resource, Resources } from "../../src/game/types";
import { RESOURCE_NAMES } from "../../src/components/GameUi";

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
  await expect(confirmation.locator("p")).toBeVisible();
  await expect(confirmation.locator("p")).not.toBeEmpty();
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

async function chooseGameOption(page: Page, name: "Table guide" | "How to play" | "Pass device" | "End game") {
  await page.getByRole("button", { name: "Game", exact: true }).click();
  await page.getByRole("group", { name: "Game menu", exact: true }).getByRole("button", { name, exact: true }).click();
}

async function expectResourceInventory(context: Locator, resources: Resources) {
  const inventory = context.getByRole("region", { name: "Your current resources", exact: true });
  await expect(inventory).toBeVisible();
  await expect(inventory.getByRole("heading", { name: "Your hand", exact: true })).toBeVisible();
  await expect(inventory.getByText(`${resourceTotal(resources)} cards`, { exact: true })).toBeVisible();
  const cards = inventory.getByRole("list", { name: "Cards in hand", exact: true });
  await expect(cards.getByRole("listitem")).toHaveCount(5);
  for (const resource of RESOURCES) {
    const card = cards.getByRole("listitem", { name: `${RESOURCE_NAMES[resource]}: ${resources[resource]} in hand`, exact: true });
    await expect(card.getByText(RESOURCE_NAMES[resource], { exact: true })).toBeVisible();
    await expect(card.getByText(String(resources[resource]), { exact: true })).toBeVisible();
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
    if (await counts.evaluate(element => Boolean(element.closest(".table-seats")))) {
      expect(await counts.innerText()).not.toMatch(/resource cards|development/i);
    } else {
      await expect(counts.getByText("resources", { exact: true })).toBeVisible();
      await expect(counts.getByText("development", { exact: true })).toBeVisible();
    }
    const seat = page.locator(".player-seat").filter({ has: counts });
    await expect(seat.getByRole("list", { name: "Cards in hand", includeHidden: true })).toHaveCount(0);
    await expect(seat.getByText(/^(Wood|Brick|Wool|Grain|Ore)$/)).toHaveCount(0);
  }
  await noPageOverflow(page);
}

for (const shuffleCount of [0, 2]) {
  test(`starting uses the selected island after ${shuffleCount} shuffles`, async ({ page }, testInfo) => {
    await page.goto("/");
    await page.getByRole("combobox", { name: "Human players", exact: true }).selectOption("3");
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

test("table names, player counts, keyboard rules and private start", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "A little island. Endless possibility." })).toBeVisible();
  const logoPaths = page.getByRole("banner").locator("svg").first().locator("path");
  await expect(logoPaths.nth(0)).toHaveCSS("fill", "rgb(176, 205, 193)");
  await expect(logoPaths.nth(1)).toHaveCSS("fill", "rgb(37, 59, 54)");
  await expect(logoPaths.nth(2)).toHaveCSS("fill", "rgb(176, 205, 193)");
  await expect(page.getByRole("combobox", { name: "Human players", exact: true })).toHaveValue("1");
  await expect(page.getByRole("textbox")).toHaveCount(1);
  await page.getByRole("combobox", { name: "Human players", exact: true }).selectOption("3");
  await expect(page.getByRole("textbox")).toHaveCount(3);
  await expect(page.getByRole("button", { name: "3 players", exact: true })).toHaveAttribute("aria-pressed", "true");
  await noHorizontalOverflow(page);
  await screenshot(page, testInfo, "home");

  const rulesButton = page.getByRole("button", { name: "How to play ?" });
  await rulesButton.focus();
  await page.keyboard.press("Enter");
  const rules = page.getByRole("dialog", { name: "A little guide to the island" });
  await expect(rules).toBeVisible();
  await expect(rules).toContainText("Ten victory points.");
  await expect(rules).toContainText("then again in reverse");
  await expect(rules.getByRole("button", { name: "Close dialog" })).toBeFocused();
  await screenshot(page, testInfo, "rules");
  await page.keyboard.press("Escape");
  await expect(rules).toHaveCount(0);
  await expect(rulesButton).toBeFocused();

  await page.getByRole("textbox", { name: "Player 2 name", exact: true }).fill("Alex");
  await page.getByRole("button", { name: "Let's settle in", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Use a different name for each player so private handoffs are clear.");
  await expect(page.getByRole("region", { name: "Set up your table" })).toBeVisible();
  await page.getByRole("button", { name: "4 players", exact: true }).click();
  await page.getByRole("combobox", { name: "Human players", exact: true }).selectOption("4");
  await expect(page.getByRole("textbox")).toHaveCount(4);
  const names = ["Nora", "Jules", "Taylor", "Casey"];
  for (const [index, name] of names.entries()) await page.getByRole("textbox", { name: `Player ${index + 1} name`, exact: true }).fill(` ${name} `);
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
  await chooseGameOption(page, "Table guide");
  await expect(page.getByText("Standard island / 4 settlers", { exact: true })).toBeVisible();
  await page.getByRole("dialog", { name: "Around the table", exact: true }).getByRole("button", { name: "Close dialog", exact: true }).click();
  await showView(page, "hand");
  await expect(page.getByRole("region", { name: "Private resources" })).toContainText("0 cards");
  await noHorizontalOverflow(page);
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
  await expect(page.getByRole("region", { name: "Private resources" })).toContainText("2 public + 0 hidden = 2");
  const development = page.getByRole("region", { name: "Your development cards", exact: true });
  await expect(development).toHaveCount(0);
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

test("Game menu keeps secondary actions accessible without a toolbar", async ({ page, isMobile }, testInfo) => {
  await page.goto("/");
  await page.getByRole("combobox", { name: "Human players", exact: true }).selectOption("3");
  await page.getByRole("button", { name: "Let's settle in", exact: true }).click();
  await revealHand(page);
  const viewports = isMobile ? [{ width: 320, height: 844 }, { width: 390, height: 667 }] : [{ width: 1280, height: 720 }];
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await showView(page, "board");
    const initialFrame = await boardFrame(page);
    const artifact = `${viewport.width}x${viewport.height}`;
    await expect(page.getByText("Your island, taking shape", { exact: true })).toHaveCount(0);
    await expect(page.locator(".table-toolbar")).toHaveCount(0);
    const gameButton = page.getByRole("button", { name: "Game", exact: true });
    const menu = page.getByRole("group", { name: "Game menu", exact: true });
    await expect(gameButton).toBeInViewport({ ratio: 1 });
    await expect(gameButton).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("button", { name: "End game", exact: true })).toBeHidden();
    await gameButton.focus();
    await page.keyboard.press("Enter");
    await expect(menu).toBeInViewport({ ratio: 1 });
    await expect(gameButton).toHaveAttribute("aria-expanded", "true");
    await expect(menu.getByRole("button")).toHaveText(["Table guide", "How to play", "Pass device", "End game"]);
    for (const name of ["Table guide", "How to play", "Pass device", "End game"]) {
      const option = menu.getByRole("button", { name, exact: true });
      await expect(option).toBeInViewport({ ratio: 1 });
      expect((await option.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await expectBoardFrame(page, initialFrame);
    await screenshot(page, testInfo, `game-menu-${artifact}`, false);
    await page.keyboard.press("Tab");
    const guideButton = page.getByRole("button", { name: "Table guide", exact: true });
    await expect(guideButton).toBeFocused();
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
    for (let step = 0; step < 5; step++) await page.keyboard.press("Tab");
    await expect(menu).toBeHidden();
    await chooseGameOption(page, "How to play");
    await expect(page.getByRole("dialog", { name: "A little guide to the island", exact: true })).toBeVisible();
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
    const guide = page.getByRole("dialog", { name: "Around the table", exact: true });
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
    await chooseGameOption(page, "Table guide");
    const guide = page.getByRole("dialog", { name: "Around the table", exact: true });
    await expect(guide.getByRole("heading", { name: "A little investment", exact: true })).toBeVisible();
    await expect(guide.getByRole("list", { name: "Public activity", exact: true })).toHaveCount(1);
    await noPageOverflow(page);
    await screenshot(page, testInfo, `table-guide-${artifact}`, false);
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
    await board.getByRole("button", { name: "Reset board view", exact: true }).click();
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
    await board.getByRole("button", { name: "Reset board view", exact: true }).click();
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

async function seedGameRandomness(page: Page, playerCount = 3) {
  let seed = 1;
  const nextRandomValue = () => seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  // Keep the existing fixtures, but generate their board in the preview first.
  const playerOrderValues = Array.from({ length: playerCount - 1 }, nextRandomValue);
  const previewSeed = seed;
  createBoard(() => nextRandomValue() / 0x100000000);
  await seedRandomness(page, previewSeed);
  await page.getByRole("button", { name: "Shuffle island preview", exact: true }).click();
  await seedRandomness(page, seed, playerOrderValues);
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

async function prepareRollGame(page: Page) {
  await page.goto("/");
  await page.getByRole("combobox", { name: "Human players", exact: true }).selectOption("3");
  await seedGameRandomness(page);
  let seed = 1;
  let state = createGame(["Alex", "Sam", "Jordan"].map((name, index) => ({
    name, color: ["#b85d47", "#477c91", "#c1953d"][index]!, control: "human" as const,
  })), () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  });
  await page.getByRole("button", { name: "Let's settle in", exact: true }).click();
  for (let placement = 0; placement < 6; placement++) {
    if (placement !== 3) await revealHand(page);
    await showView(page, "board");
    const vertexId = legalSettlementVertices(state, state.activePlayerId)[0]!;
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
    const edgeId = legalRoadEdges(state, state.activePlayerId)[0]!;
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

test("development card purchase requires resources and keyboard confirmation", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  let state = await prepareRollGame(page);
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
  await expect(developmentHand.getByText("1", { exact: true })).toBeVisible();
  await expect(developmentHand.getByRole("listitem")).toHaveCount(1);
  const knight = developmentHand.getByRole("button", { name: /^Knight Move the robber/ });
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
  await expect(page.getByRole("alert")).toHaveCount(0);
  await noPageOverflow(page);
});

test("Cancel Knight restores the card and turn until the robber move is confirmed", async ({ page, isMobile }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  let state = await prepareRollGame(page);
  const buyerId = state.activePlayerId;
  const buyerName = state.players.find(player => player.id === buyerId)!.name;
  const roll = page.getByRole("button", { name: "Roll the dice", exact: true });
  const endTurn = page.getByRole("button", { name: "End turn & pass device", exact: true });
  const developmentHand = page.getByRole("region", { name: "Your development cards", exact: true, includeHidden: true });
  const knight = developmentHand.getByRole("button", { name: /^Knight Move the robber/ });
  const development = page.getByRole("dialog", { name: "A card up your sleeve", exact: true });
  const cancelKnight = page.getByRole("button", { name: "Cancel Knight", exact: true });
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
    await chooseGameOption(page, "Table guide");
    const guide = page.getByRole("dialog", { name: "Around the table", exact: true });
    const buyer = guide.locator(".player-seat").filter({ has: page.getByRole("group", { name: `${buyerName}'s card counts`, exact: true }) });
    await expect(buyer.getByText("0 knights played", { exact: true })).toBeVisible();
    await expect(buyer.getByRole("img", { name: "1 development cards", exact: true })).toBeVisible();
    await guide.getByRole("button", { name: "Close dialog", exact: true }).click();
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
  await victims.getByRole("button", { name: `${victim.name} ${resourceTotal(victim.resources)} resources`, exact: true }).click();
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
  await chooseGameOption(page, "Table guide");
  const guide = page.getByRole("dialog", { name: "Around the table", exact: true });
  const buyer = guide.locator(".player-seat").filter({ has: page.getByRole("group", { name: `${buyerName}'s card counts`, exact: true }) });
  await expect(buyer.getByText("1 knights played", { exact: true })).toBeVisible();
  await guide.getByRole("button", { name: "Close dialog", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await noPageOverflow(page);
});

test("owned development cards stack vertically with descriptions, distinct icons and direct selection", async ({ page, isMobile }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  let state = await prepareRollGame(page);
  const buyerId = state.activePlayerId;
  const developmentHand = page.getByRole("region", { name: "Your development cards", exact: true });
  const development = page.getByRole("dialog", { name: "A card up your sleeve", exact: true });
  const cardNames = {
    knight: "Knight", "victory-point": "Victory point", "road-building": "Road building",
    "year-of-plenty": "Year of plenty", monopoly: "Monopoly",
  };
  const cardDescriptions = {
    knight: "Move the robber and steal one random resource from an adjacent opponent. Three knights can earn Largest Army.",
    "victory-point": "One hidden victory point. Counted automatically toward your ten points on your turn, including when purchased.",
    "road-building": "Place two roads for free, following the usual connection and piece-limit rules.",
    "year-of-plenty": "Choose two resources from the bank, or all that remain if fewer than two are available.",
    monopoly: "Name a resource. Every other player gives you all of that resource from their hand.",
  };
  // These rolls fund one purchase each round. The first eight cards cover every kind and duplicates.
  const rolls: [number, number][] = [[1, 2], [2, 6], [5, 6]];
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
      await expect(developmentHand.getByRole("listitem")).toHaveCount(turn / 3);
    }
    if (turn < 24) {
      await page.getByRole("button", { name: "End turn & pass device", exact: true }).click();
      state = applyAction(state, state.activePlayerId, { type: "end-turn" });
      await revealHand(page);
    }
  }
  const buyer = state.players.find(player => player.id === buyerId)!;
  expect(buyer.developmentCards).toHaveLength(8);
  expect(new Set(buyer.developmentCards.map(card => card.kind)).size).toBe(5);
  const dismissCollection = page.getByRole("button", { name: "Dismiss resource collection", exact: true });
  if (await dismissCollection.isVisible()) await dismissCollection.click();
  const rows = developmentHand.getByRole("listitem").getByRole("button");
  await expect(rows).toHaveCount(8);
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
      await expect(icons.nth(index)).toHaveAttribute("data-development-kind", buyer.developmentCards[index]!.kind);
      const kind = buyer.developmentCards[index]!.kind;
      const title = rows.nth(index).getByText(cardNames[kind], { exact: true });
      const description = rows.nth(index).getByText(cardDescriptions[kind], { exact: true });
      await expect(description).toBeInViewport({ ratio: 1 });
      const titleBounds = (await title.boundingBox())!;
      const descriptionBounds = (await description.boundingBox())!;
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
  for (const [index, card] of buyer.developmentCards.entries()) {
    const row = rows.nth(index);
    await expect(row).toHaveAccessibleName(`${cardNames[card.kind]} ${cardDescriptions[card.kind]}`);
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
    await expect(development.locator("button[aria-pressed]").nth(index)).toHaveAttribute("aria-pressed", "true");
    await screenshot(page, testInfo, `development-dialog-${index}-${card.kind}`, false);
    await page.keyboard.press("Escape");
    await expect(row).toBeFocused();
    await expect(rows).toHaveCount(8);
  }
  const plenty = developmentHand.getByRole("button", { name: /^Year of plenty Choose two resources/ }).last();
  await plenty.click();
  await development.getByRole("button", { name: "Add Grain to Take from the bank", exact: true }).click();
  await page.keyboard.press("Escape");
  await plenty.click();
  await expect(development.getByText("Selected 0 of 2", { exact: true })).toBeVisible();
  await development.getByRole("button", { name: "Add Grain to Take from the bank", exact: true }).click();
  await development.getByRole("button", { name: "Add Ore to Take from the bank", exact: true }).click();
  await development.getByRole("button", { name: "Confirm Year of plenty", exact: true }).click();
  await expect(development).toHaveCount(0);
  await expect(rows).toHaveCount(7);
  await expect(developmentHand.getByRole("button", { name: /^Year of plenty Choose two resources/ })).toHaveCount(1);
  await developmentHand.getByRole("button", { name: /^Knight Move the robber/ }).first().click();
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
    const matchingTiles = state.board.tiles.filter(candidate => candidate.number === tile.number);
    await showView(page, "board");
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
    await expect(turnHeader.getByRole("heading", { name: `${beforePlayer.name} - Your turn`, exact: true })).toBeVisible();
    await expect(turnHeader).toBeInViewport({ ratio: 1 });
    await expect(turnNumber).toBeInViewport({ ratio: 1 });
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
    expect(Math.abs(turnOwnerFrame.y + turnOwnerFrame.height / 2 - turnNumberFrame.y - turnNumberFrame.height / 2)).toBeLessThanOrEqual(1);
    expect(Math.abs(turnHeaderFrame.x + turnHeaderFrame.width - turnNumberFrame.x - turnNumberFrame.width)).toBeLessThanOrEqual(1);
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
      await expect(page.getByRole("button", { name: "Roll the dice", exact: true })).toBeDisabled();
      await page.getByRole("button", { name: "Game", exact: true }).click();
      await expect(page.getByRole("button", { name: "Pass device", exact: true })).toBeDisabled();
      await page.keyboard.press("Escape");
      await expect(highlights).toHaveCount(0);
      await expect(numberHighlights).toHaveCount(0);
      await expect(resourceCounts).toHaveText(RESOURCES.map(resource => `${beforePlayer.resources[resource]} ${RESOURCE_NAMES[resource]}`));
      await expect(collection).toHaveCount(0);
      await showView(page, "board");
      await expectBoardFrame(page, idleFrame);
      await page.clock.runFor(500);
      await expect(summary).toHaveAttribute("data-stage", "production");
      await expect(resourceCounts).toHaveText(RESOURCES.map(resource => `${beforePlayer.resources[resource]} ${RESOURCE_NAMES[resource]}`));
      await expect(summary).toBeVisible();
      await expect(highlights.first()).toBeVisible();
      await expect(numberHighlights).toHaveText(matchingTiles.map(candidate => String(candidate.number)));
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
    await showView(page, "hand");
    await expect(rollButton).toBeDisabled();
    await expect(endTurnButton).toBeDisabled();
    await expect(highlights).toHaveCount(0);
    await expect(numberHighlights).toHaveCount(0);
    await expect(collection).toHaveCount(0);
    await expect(page.getByLabel(/^Received /)).toHaveCount(0);
    await showView(page, "board");
    await expect(summary).toBeVisible();
    await expect(page.getByRole("button", { name: /^Move robber to / })).toHaveCount(18);
    await expectBoardFrame(page, idleFrame);
    await expect(page.getByRole("button", { name: "Cancel Knight", exact: true, includeHidden: true })).toHaveCount(0);
    const robberTarget = page.getByRole("button", { name: /^Move robber to / }).first();
    const robberDestination = state.board.tiles.find(candidate => candidate.id !== state.robberTileId)!;
    await robberTarget.focus();
    await page.keyboard.press("Space");
    const confirmation = await expectPlacementConfirmation(page, robberTarget, robberDestination.id);
    await expect(confirmation.getByRole("button", { name: "Confirm placement", exact: true })).toBeFocused();
    await expect(page.getByRole("button", { name: /^Move robber to / })).toHaveCount(18);
    await expectBoardFrame(page, idleFrame);
    await screenshot(page, testInfo, "robber-placement-confirmation", false);
    await page.keyboard.press("Escape");
    await expect(confirmation).toHaveCount(0);
    await expect(robberTarget).toBeFocused();
    await expect(robberTarget).toHaveAttribute("aria-pressed", "false");
    await expectBoardFrame(page, idleFrame);
  });
}

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
  await openTrade.getByRole("button", { name: "Add Wood to You want in return", exact: true }).click();
  await expect(propose).toBeDisabled();
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
  const responseInventory = await expectResourceInventory(openTrade, responder.resources);
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
  await expect(privateResources.getByText(`${resourceTotal(remainingResources)} cards`, { exact: true })).toBeVisible();
  await expectPublicCardCounts(page, state);
});

test("bank receipts animate identical gains again and expire independently", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.install({ time: new Date("2026-10-31T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-31T00:00:01Z"));
  let state = await prepareRollGame(page);
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
  await seedGameRandomness(page);
  let seed = 1;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  let state = createGame(["Alex", "Computer 1", "Computer 2"].map((name, index) => ({
    name, color: ["#b85d47", "#477c91", "#c1953d"][index]!, control: index === 0 ? "human" as const : "computer" as const,
  })), random);
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
  await showView(page, "hand");
  await expect(page.getByRole("button", { name: "Roll the dice", exact: true })).toBeEnabled({ timeout: 20_000 });
  await chooseDice(page, [1, 3]);
  await page.getByRole("button", { name: "Roll the dice", exact: true }).click();
  let diceIndex = 0;
  state = applyAction(state, requesterId, { type: "roll" }, () => ([1, 3][diceIndex++]! - 0.5) / 6);
  const requester = state.players.find(player => player.id === requesterId)!;
  expect(requester.resources).toEqual({ ...emptyResources(), wood: 1 });
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
  await seedGameRandomness(page);
  await screenshot(page, testInfo, "solo-table");
  await page.getByRole("button", { name: "Let's settle in", exact: true }).click();
  await showView(page, "hand");
  await expect(page.getByRole("status", { name: "Computer activity" })).toContainText("Computer");
  await expect(page.getByRole("heading", { name: "Alex's hand", exact: true, includeHidden: true })).toHaveCount(1);
  await expect(page.getByRole("button", { name: /Reveal my hand|Pass device|Return to /, includeHidden: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Private resources" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Make a trade", exact: true })).toBeDisabled();
  await screenshot(page, testInfo, "solo-computer-turn");

  for (let placement = 0; placement < 2; placement++) {
    await placeStartingPieces(page);
    await expect(page.getByRole("heading", { name: /Reveal|Pass the device/ })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Alex's hand", exact: true, includeHidden: true })).toHaveCount(1);
  }
  await expect(page.getByRole("img", { name: /'s road at /, includeHidden: true })).toHaveCount(6, { timeout: 15_000 });
  await showView(page, "hand");
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
  await expect(page.getByRole("region", { name: "Private resources" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Reveal my hand|Pass device|Return to /, includeHidden: true })).toHaveCount(0);
  await showView(page, "board");
  await expectBoardFrame(page, humanTurnFrame);
  await page.clock.runFor(450);
  const computerRoll = page.getByRole("region", { name: "Roll result" });
  await expect(computerRoll).toHaveAttribute("data-stage", "rolling");
  await expect(computerRoll).toContainText(/Computer \d+ is rolling/);
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
