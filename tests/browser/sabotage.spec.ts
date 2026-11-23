import type { Page } from "@playwright/test";
import { createBoard, seededRandom } from "../../src/game/board";
import { applyAction, createGame, legalRoadEdges, legalSettlementVertices } from "../../src/game/engine";
import { type CustomMapConfig } from "../../src/game/types";
import { expect, test } from "./fixtures";

async function showView(page: Page, view: "board" | "hand") {
  const navigation = page.getByRole("navigation", { name: "Game views" });
  if (await navigation.isVisible()) {
    await navigation.getByRole("button", { name: view, exact: true }).click();
    await expect(navigation.getByRole("button", { name: view, exact: true })).toHaveAttribute("aria-pressed", "true");
  }
}

async function revealHand(page: Page) {
  const button = page.getByRole("button", { name: /^I'm .+\. Reveal my hand$/ });
  if (await button.isVisible()) await button.click();
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

function lcgFromSeed(initialSeed: number) {
  let seed = initialSeed >>> 0;
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
}

async function seedBrowserRandom(page: Page, initialSeed: number) {
  await page.evaluate(startSeed => {
    let seed = startSeed >>> 0;
    Object.defineProperty(crypto, "getRandomValues", {
      configurable: true,
      value: (target: Uint32Array) => {
        for (let position = 0; position < target.length; position++) {
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
          target[position] = seed;
        }
        return target;
      },
    });
  }, initialSeed);
}

const SABOTAGE_MAP_CODE = "23456789";
const SABOTAGE_CONFIG: CustomMapConfig = {
  wood: 0,
  brick: 0,
  wool: 14,
  grain: 14,
  ore: 14,
  gold: 0,
  desert: 0,
  sea: 0,
  fog: false,
  sabotageCards: 6,
};

function findSeedWithTopSabotage(): number {
  const board = createBoard(seededRandom(SABOTAGE_MAP_CODE), "custom-world", SABOTAGE_CONFIG);
  const profiles = [
    { name: "Alex", color: "#b85d47", control: "human" as const },
    { name: "Sam", color: "#477c91", control: "human" as const },
    { name: "Jordan", color: "#c1953d", control: "human" as const },
  ];
  for (let candidate = 1; candidate <= 500; candidate++) {
    const game = createGame(profiles, lcgFromSeed(candidate), board, "custom-world", 12, SABOTAGE_CONFIG);
    if (game.developmentDeck.at(-1) === "sabotage") return candidate;
  }
  throw new Error("Could not find a seed with Sabotage on top of the deck.");
}

async function setupSabotageReadyGame(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const randomSeed = findSeedWithTopSabotage();
  const deepLink = `/?map=${SABOTAGE_MAP_CODE}&variant=custom-world&wood=${SABOTAGE_CONFIG.wood}&brick=${SABOTAGE_CONFIG.brick}&wool=${SABOTAGE_CONFIG.wool}&grain=${SABOTAGE_CONFIG.grain}&ore=${SABOTAGE_CONFIG.ore}&gold=${SABOTAGE_CONFIG.gold}&desert=${SABOTAGE_CONFIG.desert}&sea=${SABOTAGE_CONFIG.sea}&fog=0&sabotage=${SABOTAGE_CONFIG.sabotageCards}`;
  await page.goto(deepLink);
  const setupButton = page.getByRole("button", { name: "Setup", exact: true });
  if (await setupButton.isVisible()) await setupButton.click();
  await page.getByRole("combobox", { name: "Human players", exact: true }).selectOption("3");

  const board = createBoard(seededRandom(SABOTAGE_MAP_CODE), "custom-world", SABOTAGE_CONFIG);
  const profiles = [
    { name: "Alex", color: "#b85d47", control: "human" as const },
    { name: "Sam", color: "#477c91", control: "human" as const },
    { name: "Jordan", color: "#c1953d", control: "human" as const },
  ];
  let state = createGame(profiles, lcgFromSeed(randomSeed), board, "custom-world", 12, SABOTAGE_CONFIG);
  const firstPlayerId = state.players[0]!.id;
  // Find a vertex bordering wool, grain, and ore for the first player's second settlement so they can buy a dev card on turn 1.
  const devCardVertex = board.vertices.find(vertex => {
    const terrains = new Set(vertex.tileIds.map(id => board.tiles.find(tile => tile.id === id)!.terrain));
    return terrains.has("wool") && terrains.has("grain") && terrains.has("ore");
  })!;
  expect(devCardVertex).toBeDefined();

  await seedBrowserRandom(page, randomSeed);
  await page.getByRole("button", { name: "Let's settle in", exact: true }).click();

  // Complete snake setup, reserving devCardVertex for the first player's second settlement.
  const forbidden = new Set<string>([devCardVertex.id]);
  for (const edgeId of devCardVertex.edgeIds) {
    const edge = board.edges.find(candidate => candidate.id === edgeId)!;
    for (const vertexId of edge.vertexIds) forbidden.add(vertexId);
  }
  while (state.phase.type.startsWith("setup")) {
    await revealHand(page);
    await showView(page, "board");
    const actor = state.activePlayerId;
    const isFirstPlayersSecond = actor === firstPlayerId && state.setupIndex >= state.players.length;
    const legalVertices = legalSettlementVertices(state, actor);
    const vertexId = isFirstPlayersSecond && legalVertices.includes(devCardVertex.id)
      ? devCardVertex.id
      : legalVertices.find(id => !forbidden.has(id)) ?? legalVertices[0]!;
    await page.getByRole("button", { name: `Place settlement at ${vertexId}`, exact: true }).click();
    await page.getByRole("button", { name: "Confirm placement", exact: true }).click();
    state = applyAction(state, actor, { type: "place-settlement", vertexId });

    const edgeId = legalRoadEdges(state, actor)[0]!;
    await page.getByRole("button", { name: `Build road at ${edgeId}`, exact: true }).click();
    const roadChoice = page.getByRole("button", { name: "Build road", exact: true });
    if (await roadChoice.isVisible()) {
      await roadChoice.click();
    } else {
      await page.getByRole("button", { name: "Confirm placement", exact: true }).click();
    }
    state = applyAction(state, actor, { type: "place-road", edgeId });
  }

  // Turn 1: first player rolls non-7, buys the top Sabotage card, and passes around back to their turn.
  await revealHand(page);
  await showView(page, "hand");
  await chooseDice(page, [1, 2]);
  await page.getByRole("button", { name: "Roll the dice", exact: true }).click();
  await page.getByRole("button", { name: "Buy a card" }).click();
  await page.getByRole("button", { name: "Buy", exact: true }).click();
  const sabotageCardButton = page.getByRole("button", { name: /Sabotage/ });
  await expect(sabotageCardButton).toBeVisible();
  await expect(sabotageCardButton.locator('svg[data-development-kind="sabotage"]')).toBeVisible();

  // Clicking the newly bought Sabotage card shows it is available next turn.
  await sabotageCardButton.click();
  await expect(page.getByText("Available next turn", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirm Sabotage", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();

  await page.getByRole("button", { name: "End turn & pass device", exact: true }).click();
  // Two opponents roll and end turn so the first player gets their next turn.
  for (let turn = 0; turn < 2; turn++) {
    await revealHand(page);
    await showView(page, "hand");
    await chooseDice(page, [1, 2]);
    await page.getByRole("button", { name: "Roll the dice", exact: true }).click();
    await page.getByRole("button", { name: "End turn & pass device", exact: true }).click();
  }

  await revealHand(page);
  return { firstPlayerName: state.players[0]!.name };
}

test("Custom World setup configures Sabotage cards and reflects them in Help", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Game version", exact: true }).click();
  await page.getByRole("listbox", { name: "Game version", exact: true }).getByRole("option", { name: "Custom World", exact: true }).click();
  const panel = page.getByRole("region", { name: "Customize the map", exact: true });
  const sabotageGroup = panel.getByRole("group", { name: "Sabotage cards", exact: true });
  await expect(sabotageGroup).toBeVisible();
  await expect(sabotageGroup).toContainText("2");

  await sabotageGroup.getByRole("button", { name: "Increase Sabotage cards", exact: true }).click();
  await expect(sabotageGroup).toContainText("3");
  await sabotageGroup.getByRole("button", { name: "Decrease Sabotage cards", exact: true }).click();
  await sabotageGroup.getByRole("button", { name: "Decrease Sabotage cards", exact: true }).click();
  await sabotageGroup.getByRole("button", { name: "Decrease Sabotage cards", exact: true }).click();
  await expect(sabotageGroup).toContainText("0");
  await expect(sabotageGroup.getByRole("button", { name: "Decrease Sabotage cards", exact: true })).toBeDisabled();

  for (let count = 0; count < 4; count++) {
    await sabotageGroup.getByRole("button", { name: "Increase Sabotage cards", exact: true }).click();
  }
  await expect(sabotageGroup).toContainText("4");

  await page.getByRole("button", { name: /Menu/ }).click();
  await page.getByRole("button", { name: "Help", exact: true }).click();
  const helpDialog = page.getByRole("dialog", { name: "Help", exact: true });
  await expect(helpDialog).toContainText("There are 29 cards");
  const sabotageRow = helpDialog.getByRole("listitem").filter({ has: page.locator('svg[data-development-kind="sabotage"]') });
  await expect(sabotageRow).toContainText("Sabotage");
  await expect(sabotageRow).toContainText("4 in starting deck");
});

test("playing Sabotage destroys two opponent roads on the board", async ({ page }) => {
  const { firstPlayerName } = await setupSabotageReadyGame(page);
  await showView(page, "hand");
  await page.getByRole("button", { name: /Sabotage/ }).click();
  await page.getByRole("button", { name: "Confirm Sabotage", exact: true }).click();
  await showView(page, "board");

  await expect(page.getByRole("heading", { name: "Sabotage the opposition.", exact: true })).toBeVisible();
  // Own roads are not targetable; opponent roads and settlements are highlighted.
  await expect(page.getByRole("button", { name: new RegExp(`^Destroy ${firstPlayerName}'s `) })).toHaveCount(0);
  const roadTargets = page.getByRole("button", { name: /^Destroy .+?'s road at edge-/ });
  const settlementTargets = page.getByRole("button", { name: /^Destroy .+?'s settlement at vertex-/ });
  expect(await roadTargets.count()).toBeGreaterThanOrEqual(2);
  expect(await settlementTargets.count()).toBeGreaterThanOrEqual(2);

  // Destroy first opponent road.
  const firstRoadLabel = await roadTargets.first().getAttribute("aria-label");
  await roadTargets.first().click();
  await expect(page.getByRole("group", { name: "Placement confirmation", exact: true })).toContainText(/Destroy .+'s road\?/);
  await page.getByRole("button", { name: "Confirm placement", exact: true }).click();

  // Second step allows only 1 more road/ship and no buildings.
  await expect(page.getByText("Destroy 1 more opponent road or ship on the board.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: firstRoadLabel!, exact: true })).toHaveCount(0);
  await expect(settlementTargets).toHaveCount(0);

  // Destroy second opponent road and return to pre-roll phase.
  await roadTargets.first().click();
  await page.getByRole("button", { name: "Confirm placement", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Let the dice decide.", exact: true })).toBeVisible();
});

test("playing Sabotage destroys an opponent settlement and finishes immediately", async ({ page }) => {
  await setupSabotageReadyGame(page);
  await showView(page, "hand");
  await page.getByRole("button", { name: /Sabotage/ }).click();
  await page.getByRole("button", { name: "Confirm Sabotage", exact: true }).click();
  await showView(page, "board");

  const settlementTargets = page.getByRole("button", { name: /^Destroy .+?'s settlement at vertex-/ });
  const initialCount = await settlementTargets.count();
  expect(initialCount).toBeGreaterThanOrEqual(2);

  await settlementTargets.first().click();
  await expect(page.getByRole("group", { name: "Placement confirmation", exact: true })).toContainText(/Destroy .+'s settlement\?/);
  await page.getByRole("button", { name: "Confirm placement", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Let the dice decide.", exact: true })).toBeVisible();
  await expect(settlementTargets).toHaveCount(0);
});
