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

function diceForTotal(total: number): [number, number] {
  const first = Math.max(1, Math.min(6, Math.floor(total / 2)));
  return [first, total - first];
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
  wood: 9,
  brick: 9,
  wool: 8,
  grain: 8,
  ore: 8,
  gold: 0,
  desert: 0,
  sea: 0,
  fog: false,
  sabotage: true,
};

async function setupSabotageReadyGame(page: Page) {
  const randomSeed = 7;
  const deepLink = `/?map=${SABOTAGE_MAP_CODE}&variant=custom-world&wood=${SABOTAGE_CONFIG.wood}&brick=${SABOTAGE_CONFIG.brick}&wool=${SABOTAGE_CONFIG.wool}&grain=${SABOTAGE_CONFIG.grain}&ore=${SABOTAGE_CONFIG.ore}&gold=${SABOTAGE_CONFIG.gold}&desert=${SABOTAGE_CONFIG.desert}&sea=${SABOTAGE_CONFIG.sea}&fog=0&sabotage=1`;
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

  // Reserve a second-settlement vertex bordering wood, brick, and wool (3 of the 5 resources),
  // and a first-settlement vertex bordering grain and ore (the remaining 2 resources).
  const secondVertex = board.vertices.find(vertex => {
    const terrains = new Set(vertex.tileIds.map(id => board.tiles.find(tile => tile.id === id)!.terrain));
    return terrains.has("wood") && terrains.has("brick") && terrains.has("wool");
  })!;
  expect(secondVertex).toBeDefined();

  const secondForbidden = new Set<string>([secondVertex.id]);
  for (const edgeId of secondVertex.edgeIds) {
    const edge = board.edges.find(candidate => candidate.id === edgeId)!;
    for (const vertexId of edge.vertexIds) secondForbidden.add(vertexId);
  }

  const firstVertex = board.vertices.find(vertex => {
    if (secondForbidden.has(vertex.id)) return false;
    const tiles = vertex.tileIds.map(id => board.tiles.find(tile => tile.id === id)!);
    return tiles.some(tile => tile.terrain === "grain" && tile.number !== null) &&
      tiles.some(tile => tile.terrain === "ore" && tile.number !== null);
  })!;
  expect(firstVertex).toBeDefined();

  const grainNumber = firstVertex.tileIds.map(id => board.tiles.find(tile => tile.id === id)!).find(tile => tile.terrain === "grain")!.number!;
  const oreNumber = firstVertex.tileIds.map(id => board.tiles.find(tile => tile.id === id)!).find(tile => tile.terrain === "ore")!.number!;

  const forbiddenForOthers = new Set<string>([...secondForbidden, firstVertex.id]);
  for (const edgeId of firstVertex.edgeIds) {
    const edge = board.edges.find(candidate => candidate.id === edgeId)!;
    for (const vertexId of edge.vertexIds) forbiddenForOthers.add(vertexId);
  }

  await seedBrowserRandom(page, randomSeed);
  await page.getByRole("button", { name: "Let's settle in", exact: true }).click();

  while (state.phase.type.startsWith("setup")) {
    await revealHand(page);
    await showView(page, "board");
    const actor = state.activePlayerId;
    const isFirstPlayersFirst = actor === firstPlayerId && state.setupIndex < state.players.length;
    const isFirstPlayersSecond = actor === firstPlayerId && state.setupIndex >= state.players.length;
    const legalVertices = legalSettlementVertices(state, actor);
    const vertexId = isFirstPlayersFirst && legalVertices.includes(firstVertex.id)
      ? firstVertex.id
      : isFirstPlayersSecond && legalVertices.includes(secondVertex.id)
        ? secondVertex.id
        : legalVertices.find(id => !forbiddenForOthers.has(id)) ?? legalVertices[0]!;
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

  // Turn 1: first player rolls grainNumber (+1 grain), then opponent 1 rolls oreNumber (+1 ore).
  await revealHand(page);
  await showView(page, "hand");
  await chooseDice(page, diceForTotal(grainNumber));
  await page.getByRole("button", { name: "Roll the dice", exact: true }).click();
  await expect(page.getByRole("button", { name: "End turn & pass device", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "End turn & pass device", exact: true }).click();

  await revealHand(page);
  await showView(page, "hand");
  await chooseDice(page, diceForTotal(oreNumber));
  await page.getByRole("button", { name: "Roll the dice", exact: true }).click();
  await expect(page.getByRole("button", { name: "End turn & pass device", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "End turn & pass device", exact: true }).click();

  // Opponent 2 rolls a non-7 and passes back to first player.
  await revealHand(page);
  await showView(page, "hand");
  await chooseDice(page, [1, 1]);
  await page.getByRole("button", { name: "Roll the dice", exact: true }).click();
  await expect(page.getByRole("button", { name: "End turn & pass device", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "End turn & pass device", exact: true }).click();

  // First player's turn 2: roll a non-7; player now has at least 1 of each resource.
  await revealHand(page);
  await showView(page, "hand");
  await chooseDice(page, [1, 1]);
  await page.getByRole("button", { name: "Roll the dice", exact: true }).click();
  await expect(page.getByRole("button", { name: "End turn & pass device", exact: true })).toBeEnabled();

  return { firstPlayerName: state.players[0]!.name };
}

test("Custom World setup toggles Sabotage and reflects it in Help", { tag: "@desktop-only" }, async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Game version", exact: true }).click();
  await page.getByRole("listbox", { name: "Game version", exact: true }).getByRole("option", { name: "Custom World", exact: true }).click();
  const panel = page.getByRole("region", { name: "Customize the map", exact: true });
  const sabotageCheckbox = panel.getByRole("checkbox", { name: "Sabotage", exact: true });
  await expect(sabotageCheckbox).toBeVisible();
  await expect(sabotageCheckbox).toBeChecked();

  await page.getByRole("button", { name: /Menu/ }).click();
  await page.getByRole("button", { name: "Help", exact: true }).click();
  const helpDialog = page.getByRole("dialog", { name: "Help", exact: true });
  await expect(helpDialog).toContainText("There are 25 cards");
  const sabotageBuildItem = helpDialog.getByRole("listitem").filter({ has: page.locator('svg[data-piece="sabotage"]') });
  await expect(sabotageBuildItem).toContainText("Sabotage");
  await expect(sabotageBuildItem).toContainText("Pay 1 of each resource");
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();

  await sabotageCheckbox.uncheck();
  await expect(sabotageCheckbox).not.toBeChecked();

  await page.getByRole("button", { name: /Menu/ }).click();
  await page.getByRole("button", { name: "Help", exact: true }).click();
  await expect(helpDialog.locator('svg[data-piece="sabotage"]')).toHaveCount(0);
});

test("Sabotage build action destroys one opponent road and plays destruction animation", { tag: "@desktop-only" }, async ({ page }) => {
  const { firstPlayerName } = await setupSabotageReadyGame(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await showView(page, "hand");
  const sabotageButton = page.getByRole("button", { name: /^Sabotage\b/ });
  await expect(sabotageButton).toBeEnabled();
  await sabotageButton.click();
  await showView(page, "board");

  // Own pieces are not targetable; opponent roads and settlements are highlighted.
  await expect(page.getByRole("button", { name: new RegExp(`^Destroy ${firstPlayerName}'s `) })).toHaveCount(0);
  const roadTargets = page.getByRole("button", { name: /^Destroy .+?'s road at edge-/ });
  const settlementTargets = page.getByRole("button", { name: /^Destroy .+?'s settlement at vertex-/ });
  expect(await roadTargets.count()).toBeGreaterThanOrEqual(2);
  expect(await settlementTargets.count()).toBeGreaterThanOrEqual(2);

  // Destroy one opponent road.
  const firstRoadLabel = await roadTargets.first().getAttribute("aria-label");
  await roadTargets.first().click();
  await expect(page.getByRole("group", { name: "Placement confirmation", exact: true })).toContainText(/Destroy .+'s road\?/);
  await page.getByRole("button", { name: "Confirm placement", exact: true }).click();

  // Destruction animation appears on the board and Sabotage finishes immediately in actions phase.
  await expect(page.locator('svg [data-sabotage-burst="road"]').first()).toBeVisible();
  await expect(page.getByRole("button", { name: firstRoadLabel!, exact: true })).toHaveCount(0);
  await expect(roadTargets).toHaveCount(0);
  await expect(settlementTargets).toHaveCount(0);
  await expect(page.getByRole("button", { name: "End turn & pass device", exact: true })).toBeEnabled();
});

test("Sabotage build action destroys an opponent settlement and plays destruction animation", { tag: "@desktop-only" }, async ({ page }) => {
  await setupSabotageReadyGame(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await showView(page, "hand");
  await page.getByRole("button", { name: /^Sabotage\b/ }).click();
  await showView(page, "board");

  const settlementTargets = page.getByRole("button", { name: /^Destroy .+?'s settlement at vertex-/ });
  const initialCount = await settlementTargets.count();
  expect(initialCount).toBeGreaterThanOrEqual(2);

  await settlementTargets.first().click();
  await expect(page.getByRole("group", { name: "Placement confirmation", exact: true })).toContainText(/Destroy .+'s settlement\?/);
  await page.getByRole("button", { name: "Confirm placement", exact: true }).click();

  await expect(page.locator('svg [data-sabotage-burst="settlement"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "End turn & pass device", exact: true })).toBeEnabled();
  await expect(settlementTargets).toHaveCount(0);
});
