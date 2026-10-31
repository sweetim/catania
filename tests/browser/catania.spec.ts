import { expect, test as base, type Page, type TestInfo } from "@playwright/test";

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

async function screenshot(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach(name, { path, contentType: "image/png" });
}

async function noHorizontalOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) <= window.innerWidth)).toBe(true);
}

async function privateHandIsAbsent(page: Page) {
  await expect(page.getByRole("region", { name: "Private resources", includeHidden: true })).toHaveCount(0);
  await expect(page.getByRole("complementary", { name: "Your hand and actions", includeHidden: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Your development cards/, includeHidden: true })).toHaveCount(0);
  await expect(page.getByText("Your victory points", { exact: true })).toHaveCount(0);
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

test("table names, player counts, keyboard rules and private start", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "A little island. Endless possibility." })).toBeVisible();
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
  await expect(page.getByRole("textbox")).toHaveCount(4);
  const names = ["Nora", "Jules", "Taylor", "Casey"];
  for (const [index, name] of names.entries()) await page.getByRole("textbox", { name: `Player ${index + 1} name`, exact: true }).fill(` ${name} `);
  await page.getByRole("button", { name: "3 players", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Player 4 name" })).toHaveCount(0);
  await page.getByRole("button", { name: "4 players", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Player 4 name" })).toHaveValue(" Casey ");
  await page.getByRole("button", { name: "Let's settle in", exact: true }).click();
  await privateHandIsAbsent(page);
  await expect(page.getByRole("button", { name: /^Place settlement at/, includeHidden: true })).toHaveCount(0);
  await screenshot(page, testInfo, "private-handoff");
  expect(names).toContain(await revealHand(page));
  await expect(page.getByText("Standard island / 4 settlers", { exact: true })).toBeVisible();
  await showView(page, "hand");
  await expect(page.getByRole("region", { name: "Private resources" })).toContainText("0 cards");
  await noHorizontalOverflow(page);
});

test("three-player snake setup, real dice turn and private handoffs", async ({ page }, testInfo) => {
  await page.goto("/");
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
  await trade.getByRole("combobox", { name: "You receive / 1 card", exact: true }).selectOption("wood");
  await expect(trade.getByRole("button", { name: "Confirm exchange", exact: true })).toBeDisabled();
  const give = trade.getByRole("combobox", { name: /^You give/ });
  const scarceResource = await give.getByRole("option").evaluateAll(options => options.map(option => ({ value: (option as HTMLOptionElement).value, count: Number(option.textContent!.match(/\((\d+)\)/)![1]) })).find(option => option.count < 2)!.value);
  await give.selectOption(scarceResource);
  await trade.getByRole("combobox", { name: "You receive / 1 card", exact: true }).selectOption(scarceResource === "wood" ? "brick" : "wood");
  await expect(trade.getByRole("button", { name: "Confirm exchange", exact: true })).toBeDisabled();
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

test("board zoom stays contained and keyboard selection can be cancelled", async ({ page, isMobile }, testInfo) => {
  await page.goto("/");
  if (isMobile) {
    await page.setViewportSize({ width: 320, height: 844 });
    await noHorizontalOverflow(page);
  }
  await page.getByRole("button", { name: "Let's settle in", exact: true }).click();
  await revealHand(page);
  const board = page.getByRole("region", { name: "Game board", exact: true });
  const map = board.getByRole("region", { name: /^Island map\./ });
  await expect(board.getByRole("button", { name: "Zoom out", exact: true })).toBeDisabled();
  for (let step = 0; step < 6; step++) await board.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect(board.getByRole("status", { name: "Zoom level" })).toHaveText("250%");
  await expect(board.getByRole("button", { name: "Zoom in", exact: true })).toBeDisabled();
  expect(await map.evaluate(element => element.scrollWidth > element.clientWidth && element.scrollHeight > element.clientHeight)).toBe(true);
  await noHorizontalOverflow(page);
  await screenshot(page, testInfo, "zoomed-board");
  await board.getByRole("button", { name: "Reset board view", exact: true }).click();
  await expect(board.getByRole("status", { name: "Zoom level" })).toHaveText("100%");
  await expect(board.getByRole("button", { name: "Zoom out", exact: true })).toBeDisabled();
  expect(await map.evaluate(element => ({ left: element.scrollLeft, top: element.scrollTop }))).toEqual({ left: 0, top: 0 });
  await noHorizontalOverflow(page);
  const settlement = board.getByRole("button", { name: /^Place settlement at/ }).first();
  await settlement.focus();
  await page.keyboard.press("Enter");
  await expect(settlement).toHaveAttribute("aria-pressed", "true");
  await expect(board.getByRole("img", { name: /'s settlement at / })).toHaveCount(0);
  await screenshot(page, testInfo, "keyboard-settlement-preview");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(settlement).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("button", { name: "Confirm placement", includeHidden: true })).toHaveCount(0);
});
