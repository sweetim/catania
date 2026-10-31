import { describe, expect, test } from "bun:test";
import { applyAction, createGame, emptyResources, RESOURCES } from "../../src/game/engine";
import type { GameState, Player } from "../../src/game/types";
import { getRollOutcome, type RollOutcome } from "../../src/rollPresentation";

const profiles: Pick<Player, "name" | "color" | "control">[] = [
  { name: "Ada", color: "red", control: "human" }, { name: "Grace", color: "blue", control: "human" },
  { name: "Linus", color: "white", control: "human" },
];
const firstPlayer = "player-1";
const secondPlayer = "player-2";
const thirdPlayer = "player-3";

function productionState(): GameState {
  const state = createGame(profiles, () => 0.999999);
  state.phase = { type: "roll" };
  state.turnNumber = 5;
  state.setupIndex = state.setupOrder.length;
  for (const tile of state.board.tiles) tile.number = null;
  const tile = state.board.tiles.find(tile => tile.terrain === "wood")!;
  tile.number = 6;
  state.board.vertices.find(vertex => vertex.id === tile.vertexIds[0])!.building = { playerId: firstPlayer, kind: "city" };
  state.board.vertices.find(vertex => vertex.id === tile.vertexIds[3])!.building = { playerId: secondPlayer, kind: "settlement" };
  return state;
}

describe("roll presentation", () => {
  test.each(RESOURCES)("reports actual settlement and city gains of %s, not existing holdings or logs", resource => {
    const previous = productionState();
    const tile = previous.board.tiles.find(tile => tile.number === 6)!;
    tile.terrain = resource;
    previous.activePlayerId = secondPlayer;
    previous.players[0]!.resources[resource] = 4;
    previous.bank[resource] -= 4;
    const next = applyAction(previous, secondPlayer, { type: "roll" }, () => 0.4);
    next.log = [];

    const outcome: RollOutcome = getRollOutcome(previous, next);
    expect(outcome).toEqual({
      id: `5-${secondPlayer}`,
      playerName: "Grace",
      dice: [3, 3],
      gains: {
        [firstPlayer]: { ...emptyResources(), [resource]: 2 },
        [secondPlayer]: { ...emptyResources(), [resource]: 1 },
        [thirdPlayer]: emptyResources(),
      },
      producingTileIds: [tile.id],
      blockedTileIds: [],
      shortages: [],
      totalReceived: 3,
    });
  });

  test("does not highlight matching tiles without adjacent buildings even when their resource is paid", () => {
    const previous = productionState();
    const producingTile = previous.board.tiles.find(tile => tile.number === 6)!;
    const emptyTile = previous.board.tiles.find(tile => tile.terrain === "wood" &&
      tile.vertexIds.every(vertexId => !previous.board.vertices.find(vertex => vertex.id === vertexId)!.building))!;
    emptyTile.number = 6;
    const next = applyAction(previous, firstPlayer, { type: "roll" }, () => 0.4);

    const outcome = getRollOutcome(previous, next);
    expect(outcome.producingTileIds).toEqual([producingTile.id]);
    expect(outcome.shortages).toEqual([]);
    expect(outcome.totalReceived).toBe(3);
  });

  test("reports a matching robber block, excludes desert, and does not count blocked demand as a shortage", () => {
    const previous = productionState();
    const blockedTile = previous.board.tiles.find(tile => tile.number === 6)!;
    previous.robberTileId = blockedTile.id;
    const producingTile = previous.board.tiles.find(tile => tile.terrain === "wood" &&
      tile.vertexIds.every(vertexId => !blockedTile.vertexIds.includes(vertexId)))!;
    producingTile.number = 6;
    previous.board.vertices.find(vertex => vertex.id === producingTile.vertexIds[0])!.building = { playerId: thirdPlayer, kind: "settlement" };
    const desert = previous.board.tiles.find(tile => tile.terrain === "desert")!;
    desert.number = 6;
    previous.board.vertices.find(vertex => vertex.id === desert.vertexIds[0])!.building = { playerId: thirdPlayer, kind: "city" };
    const next = applyAction(previous, firstPlayer, { type: "roll" }, () => 0.4);

    const outcome = getRollOutcome(previous, next);
    expect(outcome.gains).toEqual({
      [firstPlayer]: emptyResources(),
      [secondPlayer]: emptyResources(),
      [thirdPlayer]: { ...emptyResources(), wood: 1 },
    });
    expect(outcome.producingTileIds).toEqual([producingTile.id]);
    expect(outcome.blockedTileIds).toEqual([blockedTile.id]);
    expect(outcome.shortages).toEqual([]);
    expect(outcome.totalReceived).toBe(1);
  });

  test("reports unpaid multi-player demand without suppressing another resource's payout", () => {
    const previous = productionState();
    previous.players[2]!.resources.wood = 17;
    previous.bank.wood = 2;
    const woolTile = previous.board.tiles.find(tile => tile.terrain === "wool" &&
      tile.vertexIds.every(vertexId => !previous.board.vertices.find(vertex => vertex.id === vertexId)!.building))!;
    woolTile.number = 6;
    previous.board.vertices.find(vertex => vertex.id === woolTile.vertexIds[0])!.building = { playerId: thirdPlayer, kind: "settlement" };
    const next = applyAction(previous, firstPlayer, { type: "roll" }, () => 0.4);
    next.log = [];

    const outcome = getRollOutcome(previous, next);
    expect(outcome.gains).toEqual({
      [firstPlayer]: emptyResources(),
      [secondPlayer]: emptyResources(),
      [thirdPlayer]: { ...emptyResources(), wool: 1 },
    });
    expect(outcome.producingTileIds).toEqual([woolTile.id]);
    expect(outcome.blockedTileIds).toEqual([]);
    expect(outcome.shortages).toEqual(["wood"]);
    expect(outcome.totalReceived).toBe(1);
    expect(next.bank.wood).toBe(2);
  });

  test.each([3, 1, 0])("reports single-player partial or empty-bank production with %s cards available", available => {
    const previous = productionState();
    for (const vertex of previous.board.vertices) {
      if (vertex.building) vertex.building.playerId = firstPlayer;
    }
    const firstTile = previous.board.tiles.find(tile => tile.number === 6)!;
    const secondTile = previous.board.tiles.find(tile => tile.terrain === "wood" &&
      tile.vertexIds.every(vertexId => !firstTile.vertexIds.includes(vertexId)))!;
    secondTile.number = 6;
    previous.board.vertices.find(vertex => vertex.id === secondTile.vertexIds[0])!.building = { playerId: firstPlayer, kind: "settlement" };
    previous.players[2]!.resources.wood = 19 - available;
    previous.bank.wood = available;
    const next = applyAction(previous, firstPlayer, { type: "roll" }, () => 0.4);

    const outcome = getRollOutcome(previous, next);
    expect(outcome.gains).toEqual({
      [firstPlayer]: { ...emptyResources(), wood: available },
      [secondPlayer]: emptyResources(),
      [thirdPlayer]: emptyResources(),
    });
    expect(outcome.producingTileIds).toEqual(available > 0 ? [firstTile.id, secondTile.id] : []);
    expect(outcome.blockedTileIds).toEqual([]);
    expect(outcome.shortages).toEqual(["wood"]);
    expect(outcome.totalReceived).toBe(available);
    expect(next.bank.wood).toBe(0);
  });

  test.each([0, 8])("seven produces nothing before resolving robber or discards with %s held cards", heldCards => {
    const previous = productionState();
    previous.board.tiles.find(tile => tile.number === 6)!.number = 7;
    previous.players[2]!.resources.ore = heldCards;
    previous.bank.ore -= heldCards;
    let draw = 0;
    const next = applyAction(previous, firstPlayer, { type: "roll" }, () => draw++ === 0 ? 0 : 0.999999);

    const outcome = getRollOutcome(previous, next);
    expect(outcome.dice).toEqual([1, 6]);
    expect(outcome.gains).toEqual({
      [firstPlayer]: emptyResources(), [secondPlayer]: emptyResources(), [thirdPlayer]: emptyResources(),
    });
    expect(outcome.producingTileIds).toEqual([]);
    expect(outcome.blockedTileIds).toEqual([]);
    expect(outcome.shortages).toEqual([]);
    expect(outcome.totalReceived).toBe(0);
    expect(next.phase.type).toBe(heldCards > 7 ? "discard" : "robber");
  });

  test("reports no production or shortage when no tiles match the roll", () => {
    const previous = productionState();
    previous.robberTileId = previous.board.tiles.find(tile => tile.number === 6)!.id;
    const next = applyAction(previous, firstPlayer, { type: "roll" }, () => 0);

    const outcome = getRollOutcome(previous, next);
    expect(outcome.dice).toEqual([1, 1]);
    expect(outcome.gains).toEqual({
      [firstPlayer]: emptyResources(), [secondPlayer]: emptyResources(), [thirdPlayer]: emptyResources(),
    });
    expect(outcome.producingTileIds).toEqual([]);
    expect(outcome.blockedTileIds).toEqual([]);
    expect(outcome.shortages).toEqual([]);
    expect(outcome.totalReceived).toBe(0);
  });

  test("leaves both inputs unchanged and returns independent mutable presentation data", () => {
    const previous = productionState();
    const next = applyAction(previous, firstPlayer, { type: "roll" }, () => 0.4);
    const previousSnapshot = structuredClone(previous);
    const nextSnapshot = structuredClone(next);

    const outcome = getRollOutcome(previous, next);
    expect(previous).toEqual(previousSnapshot);
    expect(next).toEqual(nextSnapshot);
    expect(getRollOutcome(previous, next)).toEqual(outcome);
    outcome.dice[0] = 6;
    outcome.gains[firstPlayer]!.wood = 99;
    outcome.producingTileIds.push("another-tile");
    outcome.blockedTileIds.push("another-tile");
    outcome.shortages.push("ore");
    expect(previous).toEqual(previousSnapshot);
    expect(next).toEqual(nextSnapshot);
  });

  test("repeated dice on the same player's later turn have distinct identifiers", () => {
    const previous = productionState();
    let next = applyAction(previous, firstPlayer, { type: "roll" }, () => 0.4);
    const firstOutcome = getRollOutcome(previous, next);
    for (let turn = 0; turn < previous.players.length; turn++) {
      next = applyAction(next, next.activePlayerId, { type: "end-turn" });
      if (turn < previous.players.length - 1) {
        next = applyAction(next, next.activePlayerId, { type: "roll" }, () => 0.4);
      }
    }
    const later = applyAction(next, next.activePlayerId, { type: "roll" }, () => 0.4);
    const laterOutcome = getRollOutcome(next, later);

    expect(laterOutcome.dice).toEqual(firstOutcome.dice);
    expect(laterOutcome.playerName).toBe(firstOutcome.playerName);
    expect(laterOutcome.gains).toEqual(firstOutcome.gains);
    expect(laterOutcome.id).toBe(`8-${firstPlayer}`);
    expect(laterOutcome.id).not.toBe(firstOutcome.id);
  });
});
