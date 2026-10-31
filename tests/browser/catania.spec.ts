import { expect, test as base, type Locator, type Page, type TestInfo } from "@playwright/test";
import { applyAction, COSTS, createGame, emptyResources, legalRoadEdges, legalSettlementVertices, RESOURCES, resourceTotal } from "../../src/game/engine";
import type { GameState, Resources } from "../../src/game/types";
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

async function privateHandIsAbsent(page: Page) {
  await expect(page.getByRole("region", { name: "Private resources", includeHidden: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Your current resources", includeHidden: true })).toHaveCount(0);
  await expect(page.getByRole("complementary", { name: "Your hand and actions", includeHidden: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Your development cards/, includeHidden: true })).toHaveCount(0);
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

async function expectResourceInventory(context: Locator, resources: Resources) {
  const inventory = context.getByRole("region", { name: "Your current resources", exact: true });
  await expect(inventory).toBeVisible();
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

async function expectPublicCardCounts(page: Page, state: GameState) {
  await showView(page, "players");
  for (const player of state.players) {
    const counts = page.getByRole("group", { name: `${player.name}'s card counts`, exact: true });
    await counts.scrollIntoViewIfNeeded();
    await expect(counts.getByText(`${resourceTotal(player.resources)} resource cards`, { exact: true })).toBeVisible();
    await expect(counts.getByText(`${player.developmentCards.length} development`, { exact: true })).toBeVisible();
    const seat = page.locator(".player-seat").filter({ has: counts });
    await expect(seat.getByRole("list", { name: "Cards in hand", includeHidden: true })).toHaveCount(0);
    await expect(seat.getByText(/^(Wood|Brick|Wool|Grain|Ore)$/)).toHaveCount(0);
  }
  await noPageOverflow(page);
}

test("table names, player counts, keyboard rules and private start", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "A little island. Endless possibility." })).toBeVisible();
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
  expect(names).toContain(await revealHand(page));
  await page.getByRole("button", { name: "Table guide", exact: true }).click();
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
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(page.getByRole("button", { name: "Confirm placement" })).toHaveCount(0);
      await expect(settlement).toHaveAttribute("aria-pressed", "false");
      await settlement.click();
      await screenshot(page, testInfo, "settlement-preview");
    }
    await page.getByRole("button", { name: "Confirm placement", exact: true }).click();
    await expect(page.getByRole("img", { name: `${currentPlayer}'s settlement at ${settlementName}`, exact: true })).toBeVisible();
    await expect(page.getByRole("img", { name: /'s settlement at / })).toHaveCount(placement + 1);

    const road = page.getByRole("button", { name: /^Build road at/ }).first();
    const roadName = (await road.getAttribute("aria-label"))!.replace("Build road at ", "");
    await road.click();
    await expect(road).toHaveAttribute("aria-pressed", "true");
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
  await page.getByRole("button", { name: /^Your development cards/ }).click();
  const development = page.getByRole("dialog", { name: "A card up your sleeve", exact: true });
  await expect(development).toContainText("Your next big idea is waiting.");
  await expect(development).toContainText("one wool, one grain, and one ore");
  await development.getByRole("button", { name: "Close dialog" }).click();
  await expect(page.getByRole("button", { name: "Make a trade", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Roll the dice", exact: true }).click();
  const diceLabel = await page.getByLabel(/^Dice: /).getAttribute("aria-label");
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
  await expect(page.getByRole("button", { name: "Roll the dice", includeHidden: true })).toHaveCount(0);
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
  await expect(page.getByRole("button", { name: "Roll the dice", exact: true })).toBeEnabled();

  await page.getByRole("button", { name: "Pass device", exact: true }).click();
  await page.getByRole("dialog", { name: "Pass the device", exact: true }).getByRole("button", { name: firstRound[2]!, exact: true }).click();
  expect(await revealHand(page)).toBe(firstRound[2]);
  await showView(page, "hand");
  await expect(page.getByRole("button", { name: "Roll the dice", includeHidden: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Make a trade", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: `Return to ${firstRound[1]}`, exact: true }).click();
  expect(await revealHand(page)).toBe(firstRound[1]);

  await page.getByRole("button", { name: "End game", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: "Leave this island?", exact: true });
  await expect(confirmation).toContainText("progress are not saved");
  await confirmation.getByRole("button", { name: "Keep playing", exact: true }).click();
  await expect(confirmation).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Roll the dice", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "End game", exact: true }).click();
  await confirmation.getByRole("button", { name: "End game", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Make room at the table.", exact: true })).toBeVisible();
  await privateHandIsAbsent(page);
});

test("short and narrow tabletops contain zoom, controls and placement previews", async ({ page, isMobile }, testInfo) => {
  await page.goto("/");
  await page.getByRole("combobox", { name: "Human players", exact: true }).selectOption("3");
  await page.getByRole("button", { name: "Let's settle in", exact: true }).click();
  await revealHand(page);
  const board = page.getByRole("region", { name: "Game board", exact: true });
  const map = board.getByRole("region", { name: /^Island map\./ });
  const viewports = isMobile ? [{ width: 320, height: 844 }, { width: 390, height: 667 }] : [{ width: 1280, height: 720 }];
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await showView(page, "board");
    const initialFrame = await boardFrame(page);
    const artifact = `${viewport.width}x${viewport.height}`;
    await expect(page.getByRole("region", { name: "Dice tray", exact: true })).toHaveAttribute("data-stage", "idle");
    for (const name of ["Table guide", "Pass device", "End game"]) {
      await expect(page.getByRole("button", { name, exact: true })).toBeInViewport({ ratio: 1 });
    }
    const guideButton = page.getByRole("button", { name: "Table guide", exact: true });
    await guideButton.click();
    const guide = page.getByRole("dialog", { name: "Around the table", exact: true });
    await expect(guide.getByRole("heading", { name: "A little investment", exact: true })).toBeVisible();
    await expect(guide.getByRole("list", { name: "Public activity", exact: true })).toHaveCount(1);
    await noPageOverflow(page);
    await screenshot(page, testInfo, `table-guide-${artifact}`, false);
    await guide.getByRole("button", { name: "Close dialog", exact: true }).click();
    await expect(guideButton).toBeFocused();
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
    await settlement.focus();
    await page.keyboard.press("Enter");
    await expect(settlement).toHaveAttribute("aria-pressed", "true");
    await expect(board.getByRole("img", { name: /'s settlement at / })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Confirm placement", exact: true })).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeInViewport({ ratio: 1 });
    await expectBoardFrame(page, initialFrame);
    await screenshot(page, testInfo, `keyboard-settlement-preview-${artifact}`, false);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(settlement).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByRole("button", { name: "Confirm placement", includeHidden: true })).toHaveCount(0);
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
    await expect(buildRows).toHaveCount(3);
    const rowGeometry = await buildRows.evaluateAll(elements => elements.map(element => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height, parentWidth: element.parentElement!.getBoundingClientRect().width };
    }));
    for (const [index, piece] of (["road", "settlement", "city"] as const).entries()) {
      const row = buildRows.nth(index);
      const bounds = rowGeometry[index]!;
      expect(Math.abs(bounds.width - bounds.parentWidth)).toBeLessThanOrEqual(1);
      expect(bounds.x).toBe(rowGeometry[0]!.x);
      if (index) expect(bounds.y).toBeGreaterThanOrEqual(rowGeometry[index - 1]!.y + rowGeometry[index - 1]!.height);
      await row.scrollIntoViewIfNeeded();
      await expect(row).toBeInViewport({ ratio: 1 });
      await expect(row).toContainText(piece === "city" ? "Upgrade to city" : `Build ${piece}`);
      await expect(row.locator(`svg.piece-icon[data-piece="${piece}"]`)).toHaveAttribute("aria-hidden", "true");
      await expect(row).toBeDisabled();
      for (const resource of RESOURCES.filter(resource => COSTS[piece][resource] > 0)) {
        await expect(row.getByTitle(`${COSTS[piece][resource]} ${RESOURCE_NAMES[resource]}`, { exact: true })).toBeVisible();
      }
    }
    await buildOptions.scrollIntoViewIfNeeded();
    await expect(buildOptions).toBeInViewport({ ratio: 1 });
    await noPageOverflow(page);
    await screenshot(page, testInfo, `vertical-build-rows-${artifact}`, false);
    for (const name of [/^Your development cards/, /^Make a trade$/]) {
      const control = page.getByRole("button", { name });
      await control.scrollIntoViewIfNeeded();
      await expect(control).toBeInViewport({ ratio: 1 });
      await noPageOverflow(page);
    }
    await screenshot(page, testInfo, `accessible-hand-${artifact}`, false);
  }
});

async function seedGameRandomness(page: Page) {
  // Set after the preview renders. This shuffle starts with a computer, not Alex.
  await page.evaluate(() => {
    let seed = 1;
    Object.defineProperty(crypto, "getRandomValues", {
      configurable: true,
      value: (values: Uint32Array) => {
        for (let index = 0; index < values.length; index++) {
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
          values[index] = seed;
        }
        return values;
      },
    });
  });
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
    await expect(page.getByRole("region", { name: "Dice tray", exact: true })).toHaveAttribute("data-stage", "idle");
    const idleFrame = await boardFrame(page);
    await screenshot(page, testInfo, "roll-idle", false);
    await showView(page, "hand");
    const handFrame = await privateResources.boundingBox();
    await expect(page.getByRole("button", { name: "Roll the dice", exact: true })).toBeInViewport({ ratio: 1 });
    await page.getByRole("button", { name: "Roll the dice", exact: true }).click();

    if (reducedMotion === "no-preference") {
      await expect(summary).toHaveAttribute("data-stage", "rolling");
      await expect(page.getByRole("button", { name: "Roll the dice", exact: true })).toBeDisabled();
      await expect(page.getByRole("button", { name: "Pass device", exact: true })).toBeDisabled();
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
    await expect(collection).toBeInViewport({ ratio: 1 });
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
    await expect(highlights).toHaveCount(0);
    await expect(numberHighlights).toHaveCount(0);
    await expect(collection).toHaveCount(0);
    await expect(page.getByLabel(/^Received /)).toHaveCount(0);
    await showView(page, "board");
    await expect(summary).toBeVisible();
    await expect(page.getByRole("button", { name: /^Move robber to / })).toHaveCount(18);
    await expectBoardFrame(page, idleFrame);
  });
}

test("owned resources stay visible through private trades and mandatory discards", async ({ page, isMobile }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize(isMobile ? { width: 390, height: 667 } : { width: 1280, height: 720 });
  await page.clock.install({ time: new Date("2026-10-31T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-31T00:00:01Z"));
  let state = await prepareRollGame(page);
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
  await expectPublicCardCounts(page, state);
  await screenshot(page, testInfo, "readable-public-card-totals", false);
  await showView(page, "hand");
  await page.getByRole("button", { name: /^Your development cards/ }).click();
  const development = page.getByRole("dialog", { name: "A card up your sleeve", exact: true });
  await expectResourceInventory(development, trader.resources);
  await development.getByRole("button", { name: "Close dialog", exact: true }).click();

  await page.getByRole("button", { name: "Make a trade", exact: true }).click();
  const trade = page.getByRole("dialog", { name: "A fair exchange", exact: true });
  const tradeInventory = await expectResourceInventory(trade, trader.resources);
  await trade.getByRole("button", { name: "Player trade", exact: true }).click();
  const offeredCards = trade.getByRole("group", { name: "You offer", exact: true });
  for (const resource of RESOURCES) {
    const selection = offeredCards.getByRole("group", { name: `${RESOURCE_NAMES[resource]} selection`, exact: true });
    await expect(selection.getByText("Selected 0", { exact: true })).toBeVisible();
    await expect(selection.getByText(`In hand ${trader.resources[resource]}`, { exact: true })).toBeVisible();
    await expect(selection.getByText(`Remaining ${trader.resources[resource]}`, { exact: true })).toBeVisible();
    await expect(selection.getByRole("button", { name: `Remove ${RESOURCE_NAMES[resource]} from You offer`, exact: true })).toBeDisabled();
    if (!trader.resources[resource]) await expect(selection.getByRole("button", { name: `Add ${RESOURCE_NAMES[resource]} to You offer`, exact: true })).toBeDisabled();
  }
  await offeredCards.getByRole("button", { name: "Add Wool to You offer", exact: true }).click();
  const offeredWool = offeredCards.getByRole("group", { name: "Wool selection", exact: true });
  await expect(offeredWool.getByText("Selected 1", { exact: true })).toBeVisible();
  await expect(offeredWool.getByText(`In hand ${trader.resources.wool}`, { exact: true })).toBeVisible();
  await expect(offeredWool.getByText(`Remaining ${trader.resources.wool - 1}`, { exact: true })).toBeVisible();
  const requestedCards = trade.getByRole("group", { name: "You ask for", exact: true });
  await expect(requestedCards.getByText(/^In (hand|bank) /)).toHaveCount(0);
  await requestedCards.getByRole("button", { name: "Add Wood to You ask for", exact: true }).click();
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
  for (const resource of RESOURCES) {
    const selection = bank.getByRole("group", { name: `${RESOURCE_NAMES[resource]} selection`, exact: true });
    await expect(selection.getByText("Selected 0", { exact: true })).toBeVisible();
    await expect(selection.getByText(`In hand ${discarder.resources[resource]}`, { exact: true })).toBeVisible();
    await expect(selection.getByText(`Remaining ${discarder.resources[resource]}`, { exact: true })).toBeVisible();
    await expect(selection.getByRole("button", { name: `Remove ${RESOURCE_NAMES[resource]} from Return to the bank`, exact: true })).toBeDisabled();
    if (!discarder.resources[resource]) await expect(selection.getByRole("button", { name: `Add ${RESOURCE_NAMES[resource]} to Return to the bank`, exact: true })).toBeDisabled();
  }
  const wood = bank.getByRole("group", { name: "Wood selection", exact: true });
  const addWood = wood.getByRole("button", { name: "Add Wood to Return to the bank", exact: true });
  for (let count = 0; count < discarder.resources.wood; count++) await addWood.click();
  await expect(addWood).toBeDisabled();
  await expect(wood.getByText("Remaining 0", { exact: true })).toBeVisible();
  await expect(confirmDiscard).toBeDisabled();
  await wood.getByRole("button", { name: "Remove Wood from Return to the bank", exact: true }).click();
  await expect(wood.getByText(`Selected ${discarder.resources.wood - 1}`, { exact: true })).toBeVisible();
  await expect(wood.getByText("Remaining 1", { exact: true })).toBeVisible();
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
  for (const resource of RESOURCES) {
    const selection = bank.getByRole("group", { name: `${RESOURCE_NAMES[resource]} selection`, exact: true });
    await expect(selection.getByText(`Selected ${selectedResources[resource]}`, { exact: true })).toBeVisible();
    await expect(selection.getByText(`Remaining ${discarder.resources[resource] - selectedResources[resource]}`, { exact: true })).toBeVisible();
  }
  await confirmDiscard.scrollIntoViewIfNeeded();
  await expect(discardInventory).toBeInViewport({ ratio: 1 });
  await expect(confirmDiscard).toBeInViewport({ ratio: 1 });
  await noPageOverflow(page);
  await screenshot(page, testInfo, "discard-owned-selected-and-remaining", false);
  await confirmDiscard.click();
  state = applyAction(state, discarder.id, { type: "discard", resources: selectedResources });
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
    const inventory = await expectResourceInventory(trade, ownedResources);
    for (const resource of RESOURCES) {
      await expect(trade.getByRole("button", { name: `Give ${RESOURCE_NAMES[resource]}`, exact: true }).getByText(`In hand: ${ownedResources[resource]}`, { exact: true })).toBeVisible();
      await expect(trade.getByRole("button", { name: `Receive ${RESOURCE_NAMES[resource]}`, exact: true }).getByText(`In bank: ${state.bank[resource]}`, { exact: true })).toBeVisible();
    }
    await trade.getByRole("button", { name: `Give ${resource}`, exact: true }).click();
    await trade.getByRole("button", { name: "Receive Brick", exact: true }).click();
    const giveResource = resource === "Wood" ? "wood" : "ore";
    const afterExchange = applyAction(state, state.activePlayerId, { type: "bank-trade", give: giveResource, receive: "brick" });
    const afterResources = afterExchange.players.find(player => player.id === state.activePlayerId)!.resources;
    await expect(trade.getByRole("status", { name: "Hand after exchange", exact: true })).toHaveText(
      `After exchange: ${afterResources[giveResource]} ${resource}, ${afterResources.brick} Brick in your hand. Other cards stay the same.`,
    );
    await trade.getByRole("button", { name: "Confirm exchange", exact: true }).scrollIntoViewIfNeeded();
    await expect(inventory).toBeInViewport({ ratio: 1 });
    await expectResourceInventory(trade, ownedResources);
    await trade.getByRole("button", { name: "Confirm exchange", exact: true }).click();
    state = afterExchange;
    await expect(trade).toHaveCount(0);
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
  await page.getByRole("button", { name: "End game", exact: true }).click();
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
  const endTurn = page.getByRole("button", { name: /^End turn/ });
  const discard = page.getByRole("button", { name: "Confirm discard", exact: true });
  const robber = page.getByRole("button", { name: /^Move robber to / }).first();
  const victims = page.locator("section").filter({ has: page.getByRole("heading", { name: "Choose a player to steal from", exact: true }) });
  for (let step = 0; step < 4; step++) {
    await expect(endTurn.or(discard).or(robber).or(victims).first()).toBeVisible({ timeout: 15_000 });
    if (await endTurn.count()) return;
    if (await discard.count()) {
      const prompt = await page.getByText(/^Choose exactly \d+ resources\./).innerText();
      let remaining = Number(prompt.match(/\d+/)![0]);
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
  await expect(page.getByRole("button", { name: "Roll the dice", exact: true })).toBeVisible({ timeout: 15_000 });
  await resolveHumanRoll(page);
  await page.getByRole("button", { name: "Make a trade", exact: true }).click();
  const trade = page.getByRole("dialog", { name: "A fair exchange", exact: true });
  await trade.getByRole("button", { name: "Player trade", exact: true }).click();
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
  await page.clock.install({ time: new Date("2026-10-31T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-31T00:00:01Z"));
  await showView(page, "board");
  const humanTurnFrame = await boardFrame(page);
  await showView(page, "hand");
  await page.getByRole("button", { name: "End turn", exact: true }).click();
  await expect(page.getByRole("status", { name: "Computer activity" })).toBeVisible();
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
  await expect(page.getByRole("button", { name: "Roll the dice", exact: true })).toBeVisible({ timeout: 20_000 });
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
  await seedGameRandomness(page);
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
      await page.getByRole("button", { name: "Pass device", exact: true }).click();
      const pass = page.getByRole("dialog", { name: "Pass the device", exact: true });
      await expect(pass.getByRole("button", { name: "Alex", exact: true })).toBeVisible();
      await expect(pass.getByRole("button", { name: "Sam", exact: true })).toBeVisible();
      await expect(pass.getByRole("button", { name: /^Computer/ })).toHaveCount(0);
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
  await page.getByRole("button", { name: "End game", exact: true }).click();
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
