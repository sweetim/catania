import { describe, expect, test } from "bun:test";
import { HostRoom } from "../../src/multiplayer/state";
import { computeSharedRollProduction, detectPlayerSabotages, detectSharedPublicEvents } from "../../src/multiplayer/presentation";

function startedRoom(variant: "original" | "seafarers" = "original") {
  const room = new HostRoom("presentation-secret");
  room.setVariant(variant);
  room.useMapSeed("ABCDEFGH");
  for (const [index, name] of ["Ada", "Grace", "Linus"].entries()) {
    room.join(`connection-${index + 1}`, { type: "join", name, secret: "presentation-secret" });
    room.admit(`connection-${index + 1}`);
  }
  room.start();
  return room;
}

describe("shared board roll production", () => {
  test("reports producing tiles and excludes tiles blocked by robber or bank shortages", () => {
    const room = startedRoom();
    const game = room.game!;
    const targetTile = game.board.tiles.find(tile => tile.terrain === "wood" && tile.number !== null && tile.id !== game.robberTileId)!;
    const secondTile = game.board.tiles.find(tile =>
      tile.id !== targetTile.id &&
      tile.terrain !== "desert" &&
      tile.number !== null &&
      tile.id !== game.robberTileId &&
      tile.vertexIds.every(vertexId => !targetTile.vertexIds.includes(vertexId)),
    )!;
    secondTile.terrain = "brick";
    secondTile.number = targetTile.number;
    // Clear any other tile with the same number so only targetTile and secondTile match the roll.
    for (const tile of game.board.tiles) {
      if (tile.id !== targetTile.id && tile.id !== secondTile.id && tile.number === targetTile.number) {
        tile.number = tile.number === 12 ? 2 : 12;
      }
    }
    const firstVertex = game.board.vertices.find(vertex => vertex.id === targetTile.vertexIds[0])!;
    const secondVertex = game.board.vertices.find(vertex => vertex.id === secondTile.vertexIds[0])!;
    firstVertex.building = { playerId: "player-1", kind: "city" };
    secondVertex.building = { playerId: "player-2", kind: "settlement" };

    const previous = room.snapshot().game!;
    game.dice = [Math.min(6, targetTile.number! - 1), targetTile.number! - Math.min(6, targetTile.number! - 1)];
    // Wood paid 2 from bank, brick suffered a total bank shortage (0 paid despite 1 demanded).
    game.bank.wood -= 2;
    const next = room.snapshot().game!;

    const result = computeSharedRollProduction(previous, next);
    expect(result.producingTileIds).toContain(targetTile.id);
    expect(result.producingTileIds).not.toContain(secondTile.id);
    expect(result.shortages).toEqual(["brick"]);
  });

  test("returns empty production on a rolled seven", () => {
    const room = startedRoom();
    const previous = room.snapshot().game!;
    room.game!.dice = [3, 4];
    const next = room.snapshot().game!;
    expect(computeSharedRollProduction(previous, next)).toEqual({ producingTileIds: [], shortages: [] });
  });
});

describe("shared board public event detection", () => {
  test("detects award claims, steals, island bonuses, development plays, robberies, and sabotage", () => {
    const room = startedRoom("seafarers");
    const game = room.game!;
    let nextId = 1;
    const allocateId = () => nextId++;

    const previous = room.snapshot().game!;
    game.awards.longestRoad = "player-1";
    game.awards.largestArmy = "player-2";
    game.log.push(
      { key: "{player} plays {kind}.", parameters: { player: "Ada", kind: "monopoly" } },
      { key: "{player} steals one resource card from {victim}.", parameters: { player: "Ada", victim: "Grace" } },
      { key: "{player} reduces {victim}'s city to a settlement.", parameters: { player: "Ada", victim: "Linus" } },
    );
    const next = room.snapshot().game!;
    const events = detectSharedPublicEvents(previous, next, allocateId);

    expect(events).toEqual([
      expect.objectContaining({ kind: "award", award: "longest-road", playerName: "Ada" }),
      expect.objectContaining({ kind: "award", award: "largest-army", playerName: "Grace" }),
      expect.objectContaining({ kind: "development", cardKind: "monopoly", playerName: "Ada" }),
      expect.objectContaining({ kind: "robbery", thiefName: "Ada", victimName: "Grace", emptyHand: false }),
      expect.objectContaining({ kind: "sabotage", pieceKind: "city", actorName: "Ada", victimName: "Linus" }),
    ]);
    expect(events[0] && "previousHolderName" in events[0]).toBe(false);
    expect(events[1] && "previousHolderName" in events[1]).toBe(false);

    const beforeSteal = room.snapshot().game!;
    game.awards.longestRoad = "player-2";
    const afterSteal = room.snapshot().game!;
    expect(detectSharedPublicEvents(beforeSteal, afterSteal, allocateId)).toEqual([
      expect.objectContaining({ kind: "award", award: "longest-road", playerName: "Grace", previousHolderName: "Ada" }),
    ]);
  });
});

describe("private sabotage victim detection", () => {
  test("detects opponent sabotage of roads, ships, settlements, and cities while ignoring own turn", () => {
    const room = startedRoom("seafarers");
    const game = room.game!;
    let nextId = 1;
    const allocateId = () => nextId++;

    const roadEdge = game.board.edges[0]!;
    const shipEdge = game.board.edges[1]!;
    const settlementVertex = game.board.vertices[0]!;
    const cityVertex = game.board.vertices[1]!;
    roadEdge.playerId = "player-2";
    roadEdge.kind = "road";
    shipEdge.playerId = "player-2";
    shipEdge.kind = "ship";
    settlementVertex.building = { playerId: "player-2", kind: "settlement" };
    cityVertex.building = { playerId: "player-2", kind: "city" };
    game.activePlayerId = "player-1";
    const previous = room.snapshot().game!;

    roadEdge.playerId = null;
    delete roadEdge.kind;
    shipEdge.playerId = null;
    delete shipEdge.kind;
    settlementVertex.building = null;
    cityVertex.building = { playerId: "player-2", kind: "settlement" };
    const next = room.snapshot().game!;

    const sabotages = detectPlayerSabotages(previous, next, "player-2", allocateId);
    expect(sabotages.map(item => ({ saboteurId: item.saboteurId, kind: item.kind }))).toEqual([
      { saboteurId: "player-1", kind: "settlement" },
      { saboteurId: "player-1", kind: "city" },
      { saboteurId: "player-1", kind: "road" },
      { saboteurId: "player-1", kind: "ship" },
    ]);

    // Own turn changes (e.g., ship moves) must never be reported as sabotage.
    expect(detectPlayerSabotages(previous, { ...next, activePlayerId: "player-2" }, "player-2", allocateId)).toEqual([]);
  });
});
