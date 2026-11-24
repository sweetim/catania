import type { Page } from "@playwright/test";
import { createBoard, seededRandom } from "../../src/game/board";
import { applyAction, createGame, legalCityVertices, legalRoadEdges, legalSettlementVertices } from "../../src/game/engine";
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
  await expect(button).toBeVisible();
  await button.click();
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

function dicePairForTotal(total: number): [number, number] {
  const firstDie = Math.min(6, total - 1);
  return [firstDie, total - firstDie];
}

test("board settlements and cities render 3D architectural pieces with player labels and upgrade animation", { tag: "@desktop-only" }, async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  await page.getByRole("combobox", { name: "Human players", exact: true }).selectOption("3");

  const mapCode = "225DV7H4";
  const islandButton = page.getByRole("button", { name: "Island", exact: true });
  if (await islandButton.isVisible()) await islandButton.click();
  await page.getByRole("textbox", { name: "Map code", exact: true }).fill(mapCode);
  await page.getByRole("textbox", { name: "Map code", exact: true }).press("Enter");
  const setupButton = page.getByRole("button", { name: "Setup", exact: true });
  if (await setupButton.isVisible()) await setupButton.click();

  // Fix initial player order so Alex goes first deterministically.
  await page.evaluate(() => {
    let seed = 1;
    const nextValue = () => seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const orderValues = [nextValue(), nextValue()];
    let index = 0;
    Object.defineProperty(crypto, "getRandomValues", {
      configurable: true,
      value: (target: Uint32Array) => {
        for (let position = 0; position < target.length; position++) {
          target[position] = index < orderValues.length ? orderValues[index++]! : nextValue();
        }
        return target;
      },
    });
  });

  let localSeed = 1;
  const nextLocal = () => localSeed = (Math.imul(localSeed, 1664525) + 1013904223) >>> 0;
  const orderValues = [nextLocal(), nextLocal()];
  let orderIndex = 0;
  const board = createBoard(seededRandom(mapCode));
  let state = createGame(
    [
      { name: "Alex", color: "#b85d47", control: "human" },
      { name: "Sam", color: "#477c91", control: "human" },
      { name: "Jordan", color: "#c1953d", control: "human" },
    ],
    () => (orderIndex < orderValues.length ? orderValues[orderIndex++]! : nextLocal()) / 0x100000000,
    board,
  );

  // Pick a vertex touching both ore and grain for the first player so upgrading to a city takes only a few rolls.
  const firstPlayerId = state.activePlayerId;
  const oreAndGrainVertex = board.vertices.find(vertex => {
    const terrains = new Set(
      board.tiles
        .filter(tile => tile.vertexIds.includes(vertex.id) && tile.number !== null)
        .map(tile => tile.terrain),
    );
    return terrains.has("ore") && terrains.has("grain");
  })!;
  const oreTile = board.tiles.find(tile => tile.vertexIds.includes(oreAndGrainVertex.id) && tile.terrain === "ore")!;
  const grainTile = board.tiles.find(tile => tile.vertexIds.includes(oreAndGrainVertex.id) && tile.terrain === "grain")!;

  await page.getByRole("button", { name: "Let's settle in", exact: true }).click();

  for (let placement = 0; placement < 6; placement++) {
    if (placement !== 3) await revealHand(page);
    await showView(page, "board");
    const legalVertices = legalSettlementVertices(state, state.activePlayerId);
    const vertexId = placement === 0 && legalVertices.includes(oreAndGrainVertex.id)
      ? oreAndGrainVertex.id
      : legalVertices[0]!;
    await page.getByRole("button", { name: `Place settlement at ${vertexId}`, exact: true }).click();
    await page.getByRole("button", { name: "Confirm placement", exact: true }).click();
    state = applyAction(state, state.activePlayerId, { type: "place-settlement", vertexId });
    const dismissCollection = page.getByRole("button", { name: "Dismiss resource collection", exact: true });
    if (await dismissCollection.isVisible()) await dismissCollection.click();
    const edgeId = legalRoadEdges(state, state.activePlayerId)[0]!;
    await page.getByRole("button", { name: `Build road at ${edgeId}`, exact: true }).click();
    await page.getByRole("button", { name: "Confirm placement", exact: true }).click();
    state = applyAction(state, state.activePlayerId, { type: "place-road", edgeId });
  }

  // Verify all 6 settlements render with expected labels, shadows, and layered 3D geometry.
  await showView(page, "board");
  const firstPlayer = state.players.find(player => player.id === firstPlayerId)!;
  const settlementLocator = page.getByRole("img", { name: `${firstPlayer.name}'s settlement at ${oreAndGrainVertex.id}`, exact: true });
  await expect(settlementLocator).toBeVisible();
  await expect(settlementLocator.locator("text")).toHaveText(firstPlayer.name[0]!.toUpperCase());
  expect(await settlementLocator.locator("ellipse").count()).toBe(1);
  expect(await settlementLocator.locator("path").count()).toBeGreaterThanOrEqual(8);
  const settlementBounds = await settlementLocator.boundingBox();
  expect(settlementBounds).not.toBeNull();

  // Roll deterministic ore/grain numbers until firstPlayer can upgrade to a city.
  let safetyCounter = 0;
  while (safetyCounter++ < 15) {
    const owner = state.players.find(player => player.id === firstPlayerId)!;
    const targetNumber = owner.resources.ore < 3 ? oreTile.number! : grainTile.number!;
    await showView(page, "hand");
    await chooseDice(page, dicePairForTotal(targetNumber));
    await page.getByRole("button", { name: "Roll the dice", exact: true }).click();
    const pair = dicePairForTotal(targetNumber);
    let dieIndex = 0;
    state = applyAction(state, state.activePlayerId, { type: "roll" }, () => (pair[dieIndex++ % 2]! - 0.5) / 6);
    const dismissCollection = page.getByRole("button", { name: "Dismiss resource collection", exact: true });
    if (await dismissCollection.isVisible()) await dismissCollection.click();

    const updatedOwner = state.players.find(player => player.id === firstPlayerId)!;
    if (state.activePlayerId === firstPlayerId && updatedOwner.resources.ore >= 3 && updatedOwner.resources.grain >= 2) {
      break;
    }
    await page.getByRole("button", { name: /^End turn\b/ }).click();
    state = applyAction(state, state.activePlayerId, { type: "end-turn" });
    await revealHand(page);
  }

  // Record animations and upgrade the settlement to a city.
  await page.evaluate(() => {
    const windowState = window as typeof window & { __cityAnimations?: string[] };
    windowState.__cityAnimations = [];
    document.addEventListener("animationstart", event => {
      windowState.__cityAnimations?.push(event.animationName);
    }, true);
  });

  await showView(page, "hand");
  await expect(page.locator('.piece-icon[data-piece="settlement"]')).toBeVisible();
  await expect(page.locator('.piece-icon[data-piece="city"]')).toBeVisible();
  await page.getByRole("button", { name: /^Upgrade to city\b/ }).click();
  await showView(page, "board");
  const upgradeVertexId = legalCityVertices(state, firstPlayerId)[0]!;
  await page.getByRole("button", { name: `Upgrade to city at ${upgradeVertexId}`, exact: true }).click();
  await page.getByRole("button", { name: "Confirm placement", exact: true }).click();
  await showView(page, "board");

  const cityLocator = page.getByRole("img", { name: `${firstPlayer.name}'s city at ${upgradeVertexId}`, exact: true });
  await expect(cityLocator).toBeVisible();
  await expect(cityLocator.locator("text")).toHaveText(firstPlayer.name[0]!.toUpperCase());
  expect(await cityLocator.locator("ellipse").count()).toBe(1);
  expect(await cityLocator.locator("path").count()).toBeGreaterThanOrEqual(10);

  await expect.poll(() =>
    page.evaluate(() => (window as typeof window & { __cityAnimations?: string[] }).__cityAnimations ?? []),
  ).toEqual(expect.arrayContaining(["board-city-upgrade", "board-ring-expand"]));
  await expect(page.locator(".board-city-upgrade")).toHaveCount(0);

  const cityBounds = await cityLocator.boundingBox();
  expect(cityBounds).not.toBeNull();
  expect(cityBounds!.width).toBeGreaterThan(settlementBounds!.width);
  expect(cityBounds!.height).toBeGreaterThan(settlementBounds!.height);

  if (process.env.CAPTURE_BUILDINGS_SCREENSHOT) {
    await page.screenshot({ path: process.env.CAPTURE_BUILDINGS_SCREENSHOT });
    const zoomIn = page.getByRole("button", { name: "Zoom in", exact: true });
    await zoomIn.click();
    await zoomIn.click();
    const closeupPath = process.env.CAPTURE_BUILDINGS_SCREENSHOT.replace(/\.png$/, "-zoomed.png");
    await page.locator(".board-surface").screenshot({ path: closeupPath });
  }
});
