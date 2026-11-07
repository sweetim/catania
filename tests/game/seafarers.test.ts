import { describe, expect, test } from "bun:test";
import { createBoard, edgeTiles } from "../../src/game/board";
import { chooseComputerAction, getController } from "../../src/game/computer";
import {
  applyAction, COSTS, createGame, emptyResources, getLongestRoadLength, getScore, legalRoadEdges,
  legalSettlementVertices, legalShipDestinations, legalShipEdges, movableShipEdges, RESOURCES, resourceTotal,
} from "../../src/game/engine";
import type { GameAction, GameState, Player, Resources } from "../../src/game/types";
import { parseAction, parseClientMessage, parseServerMessage } from "../../src/multiplayer/protocol";
import { HostRoom } from "../../src/multiplayer/state";

function randomFromSeed(seed: number) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
}
const profiles: Pick<Player, "name" | "color" | "control">[] = [
  { name: "Alex", color: "#b85d47", control: "human" },
  { name: "Sam", color: "#477c91", control: "human" },
  { name: "Jordan", color: "#c1953d", control: "human" },
  { name: "Robin", color: "#76608c", control: "human" },
];
function newGame(): GameState {
  return createGame(profiles.slice(0, 3), randomFromSeed(1), undefined, "seafarers");
}
function resources(values: Partial<Resources> = {}): Resources {
  return { ...emptyResources(), ...values };
}
function give(state: GameState, playerId: string, values: Resources) {
  const player = state.players.find(player => player.id === playerId)!;
  for (const resource of RESOURCES) {
    state.bank[resource] -= values[resource] - player.resources[resource];
    player.resources[resource] = values[resource];
  }
}
function coastalGame() {
  const state = newGame();
  state.pirateTileId = null;
  const vertexId = legalSettlementVertices(state, state.activePlayerId).find(id => {
    const vertex = state.board.vertices.find(vertex => vertex.id === id)!;
    return vertex.tileIds.filter(id => state.board.tiles.find(tile => tile.id === id)!.terrain === "sea").length === 2;
  })!;
  const placed = applyAction(state, state.activePlayerId, { type: "place-settlement", vertexId });
  return { state: placed, vertexId };
}
function shippedGame() {
  let { state, vertexId } = coastalGame();
  const playerId = state.activePlayerId;
  const edgeId = legalShipEdges(state, playerId)[0]!;
  state = applyAction(state, playerId, { type: "place-ship", edgeId });
  state.activePlayerId = playerId;
  state.phase = { type: "actions" };
  state.turnNumber = 5;
  state.shipsBuiltThisTurn = [];
  return { state, playerId, edgeId, vertexId };
}
function assertConservation(state: GameState) {
  for (const resource of RESOURCES) {
    expect(state.bank[resource] + state.players.reduce((total, player) => total + player.resources[resource], 0)).toBe(19);
    expect(state.bank[resource]).toBeGreaterThanOrEqual(0);
  }
}

describe("Heading for New Shores boards", () => {
  test("has the four-player scenario terrain, three remote islands, navigable sea, and mainland ports", () => {
    for (let seed = 0; seed < 30; seed++) {
      const board = createBoard(randomFromSeed(seed), "seafarers");
      expect(board.variant).toBe("seafarers");
      expect(board.tiles).toHaveLength(42);
      expect(board.vertices).toHaveLength(108);
      expect(board.edges).toHaveLength(149);
      expect(Object.fromEntries(["wood", "brick", "wool", "grain", "ore", "desert", "sea", "gold"].map(terrain =>
        [terrain, board.tiles.filter(tile => tile.terrain === terrain).length])))
        .toEqual({ wood: 5, brick: 5, wool: 5, grain: 5, ore: 5, desert: 1, sea: 14, gold: 2 });
      expect(board.tiles.filter(tile => tile.islandId === "main")).toHaveLength(19);
      expect(board.tiles.filter(tile => tile.terrain === "sea" || tile.terrain === "desert").every(tile => tile.number === null)).toBe(true);
      expect(board.tiles.filter(tile => tile.number !== null)).toHaveLength(27);
      expect(board.tiles.filter(tile => tile.islandId === "main").flatMap(tile => tile.number === null ? [] : [tile.number]).sort((first, second) => first - second))
        .toEqual([2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12]);
      expect(board.tiles.filter(tile => tile.terrain === "gold").every(tile => tile.islandId !== "main")).toBe(true);
      for (const tile of board.tiles.filter(tile => tile.number === 6 || tile.number === 8)) {
        expect(board.tiles.some(other => other !== tile && (other.number === 6 || other.number === 8) &&
          other.vertexIds.filter(id => tile.vertexIds.includes(id)).length === 2)).toBe(false);
      }
      const portVertices = board.ports.flatMap(port => {
        const edge = board.edges.find(edge => edge.id === port.edgeId)!;
        const tiles = edgeTiles(board, edge);
        expect(tiles.some(tile => tile.islandId === "main")).toBe(true);
        expect(tiles.filter(tile => tile.terrain !== "sea")).toHaveLength(1);
        return edge.vertexIds;
      });
      expect(new Set(portVertices).size).toBe(18);
      for (const edge of board.edges) {
        for (const id of edge.vertexIds) expect(board.vertices.find(vertex => vertex.id === id)!.edgeIds).toContain(edge.id);
      }
    }
    expect(createBoard(() => 0, "seafarers").tiles).toHaveLength(42);
    expect(createBoard(() => 0.999999, "seafarers").tiles).toHaveLength(42);
  });

  test("Original stays the default; the selected preview is cloned and cannot mismatch the variant", () => {
    expect(createGame(profiles.slice(0, 3)).variant).toBe("original");
    const board = createBoard(undefined, "seafarers");
    const state = createGame(profiles.slice(0, 3), undefined, board);
    expect(state.variant).toBe("seafarers");
    expect(state.board).toEqual(board);
    expect(state.board).not.toBe(board);
    expect(() => createGame(profiles.slice(0, 3), undefined, board, "original")).toThrow("match");
  });

  test("starting settlements are restricted to the mainland, not sea intersections or remote islands", () => {
    const state = newGame();
    const legal = legalSettlementVertices(state, state.activePlayerId);
    expect(legal.length).toBeGreaterThan(0);
    for (const id of legal) expect(state.board.tiles.some(tile => tile.islandId === "main" && tile.vertexIds.includes(id))).toBe(true);
    const remote = state.board.tiles.find(tile => tile.islandId === "island-1")!.vertexIds[0]!;
    expect(() => applyAction(state, state.activePlayerId, { type: "place-settlement", vertexId: remote })).toThrow("legal intersection");
  });
});

describe("Fog Islands exploration", () => {
  test.each([3, 4])("varied islands support a complete %s-player setup", playerCount => {
    for (let seed = 0; seed < 30; seed++) {
      const board = createBoard(randomFromSeed(seed), "fog-islands");
      let state = createGame(profiles.slice(0, playerCount), randomFromSeed(seed), board);
      for (let placement = 0; placement < playerCount * 2; placement++) {
        const playerId = state.activePlayerId;
        const vertexId = legalSettlementVertices(state, playerId)[0]!;
        expect(vertexId).toBeDefined();
        expect(board.tiles.some(tile => tile.islandId === "main" && tile.vertexIds.includes(vertexId))).toBe(true);
        state = applyAction(state, playerId, { type: "place-settlement", vertexId });
        const edgeId = legalRoadEdges(state, playerId)[0]!;
        expect(edgeId).toBeDefined();
        state = applyAction(state, playerId, { type: "place-road", edgeId });
        if (state.phase.type === "gold") {
          const amount = state.phase.required[playerId]!;
          const resource = RESOURCES.find(resource => state.bank[resource] >= amount)!;
          state = applyAction(state, playerId, { type: "choose-gold", resources: resources({ [resource]: amount }) });
        }
      }
      expect(state.phase.type).toBe("roll");
      expect(state.board.vertices.filter(vertex => vertex.building)).toHaveLength(playerCount * 2);
      assertConservation(state);
    }
  });

  test.each(["sea", "wood", "gold"] as const)("setup exploration reveals %s and resumes the next player's setup", terrain => {
    let state = createGame(profiles.slice(0, 3), randomFromSeed(1), undefined, "fog-islands");
    expect(state.pirateTileId).toBeNull();
    expect(state.board.tiles.filter(tile => tile.terrain === "fog")).toHaveLength(23);
    // Force the discovery kind to exercise sea, resource, and gold setup continuations.
    state.board.fogDiscoveryDeck = state.board.fogDiscoveryDeck!.map(() => ({ terrain, number: terrain === "sea" ? null : 5 }));
    const playerId = state.activePlayerId;
    const vertexId = legalSettlementVertices(state, playerId).find(id =>
      state.board.tiles.some(tile => tile.terrain === "fog" && tile.vertexIds.includes(id)))!;
    state = applyAction(state, playerId, { type: "place-settlement", vertexId });
    const edgeId = legalShipEdges(state, playerId)[0]!;
    const edge = state.board.edges.find(edge => edge.id === edgeId)!;
    const discoveries = state.board.tiles.filter(tile => tile.terrain === "fog" &&
      tile.vertexIds.some(id => edge.vertexIds.includes(id)));
    expect(discoveries.length).toBeGreaterThan(0);
    state = applyAction(state, playerId, { type: "place-ship", edgeId });
    expect(state.board.tiles.filter(tile => tile.terrain === "fog")).toHaveLength(23 - discoveries.length);
    expect(state.board.fogDiscoveryDeck).toHaveLength(23 - discoveries.length);
    for (const tile of discoveries) {
      expect(state.board.tiles.find(other => other.id === tile.id)).toMatchObject({ terrain, number: terrain === "sea" ? null : 5 });
    }
    if (terrain === "gold") {
      expect(state.phase.type).toBe("gold");
      expect(state.activePlayerId).toBe(playerId);
      state = applyAction(state, playerId, { type: "choose-gold", resources: resources({ wood: discoveries.length }) });
    }
    expect(state.phase.type).toBe("setup-settlement");
    expect(state.setupIndex).toBe(1);
    expect(state.activePlayerId).toBe(state.setupOrder[1]!);
    expect(state.players.find(player => player.id === playerId)!.resources.wood).toBe(terrain === "sea" ? 0 : discoveries.length);
    assertConservation(state);
  });
});

describe("ships and shipping routes", () => {
  test("coastal setup permits a free ship; sea-only edges reject roads and ship placement advances snake setup", () => {
    const { state, vertexId } = coastalGame();
    const playerId = state.activePlayerId;
    const edgeId = legalShipEdges(state, playerId).find(id => !legalRoadEdges(state, playerId).includes(id))!;
    expect(edgeId).toBeDefined();
    expect(() => applyAction(state, playerId, { type: "place-road", edgeId })).toThrow("empty edge");
    const next = applyAction(state, playerId, { type: "place-ship", edgeId });
    expect(next.setupIndex).toBe(1);
    expect(next.phase.type).toBe("setup-settlement");
    expect(next.board.edges.find(edge => edge.id === edgeId)).toMatchObject({ playerId, kind: "ship" });
    expect(next.board.edges.find(edge => edge.id === edgeId)!.vertexIds).toContain(vertexId);
    expect(next.players.find(player => player.id === playerId)!.resources).toEqual(emptyResources());
    expect(state.board.edges.find(edge => edge.id === edgeId)!.playerId).toBeNull();
  });

  test("ships cost wood and wool, obey coast/sea connections, and cannot switch from roads without an own building", () => {
    const { state, playerId, edgeId, vertexId } = shippedGame();
    const end = state.board.edges.find(edge => edge.id === edgeId)!.vertexIds.find(id => id !== vertexId)!;
    const extension = legalShipEdges(state, playerId).find(id => state.board.edges.find(edge => edge.id === id)!.vertexIds.includes(end))!;
    expect(extension).toBeDefined();
    give(state, playerId, COSTS.ship);
    const next = applyAction(state, playerId, { type: "place-ship", edgeId: extension });
    expect(next.players.find(player => player.id === playerId)!.resources).toEqual(emptyResources());
    expect(next.shipsBuiltThisTurn).toContain(extension);
    assertConservation(next);
    for (const id of legalRoadEdges(state, playerId)) {
      expect(edgeTiles(state.board, state.board.edges.find(edge => edge.id === id)!).some(tile => tile.terrain !== "sea")).toBe(true);
    }
    const switched = structuredClone(state);
    switched.board.edges.find(edge => edge.id === edgeId)!.kind = "road";
    expect(legalShipEdges(switched, playerId)).not.toContain(extension);
    switched.board.vertices.find(vertex => vertex.id === end)!.building = { playerId, kind: "settlement" };
    expect(legalShipEdges(switched, playerId)).toContain(extension);
  });

  test("ships have their own fifteen-piece supply, separate from roads", () => {
    const { state, playerId } = shippedGame();
    const legal = legalShipEdges(state, playerId)[0]!;
    const otherEdges = state.board.edges.filter(edge => edge.id !== legal);
    for (const edge of otherEdges.slice(0, 15)) { edge.playerId = playerId; edge.kind = "road"; }
    expect(legalRoadEdges(state, playerId)).toHaveLength(0);
    expect(legalShipEdges(state, playerId).length).toBeGreaterThan(0);
    for (const edge of otherEdges.slice(0, 15)) edge.kind = "ship";
    expect(legalShipEdges(state, playerId)).toHaveLength(0);
  });

  test("one old open-ended ship may move after rolling, at no cost; new, closed and pirate-blocked ships cannot move", () => {
    const { state, playerId, edgeId, vertexId } = shippedGame();
    const destinationEdgeId = legalShipDestinations(state, playerId, edgeId)[0]!;
    expect(destinationEdgeId).toBeDefined();
    expect(movableShipEdges(state, playerId)).toContain(edgeId);
    const before = structuredClone(state);
    const next = applyAction(state, playerId, { type: "move-ship", edgeId, destinationEdgeId });
    expect(next.board.edges.find(edge => edge.id === edgeId)!.playerId).toBeNull();
    expect(next.board.edges.find(edge => edge.id === destinationEdgeId)).toMatchObject({ playerId, kind: "ship" });
    expect(next.players).toEqual(before.players);
    expect(next.shipMoved).toBe(true);
    expect(movableShipEdges(next, playerId)).toHaveLength(0);
    expect(state).toEqual(before);
    const newShip = { ...state, shipsBuiltThisTurn: [edgeId] };
    expect(legalShipDestinations(newShip, playerId, edgeId)).toHaveLength(0);
    const rolling: GameState = { ...state, phase: { type: "roll" } };
    expect(movableShipEdges(rolling, playerId)).toHaveLength(0);
    const blocked = structuredClone(state);
    blocked.pirateTileId = edgeTiles(blocked.board, blocked.board.edges.find(edge => edge.id === edgeId)!).find(tile => tile.terrain === "sea")!.id;
    expect(movableShipEdges(blocked, playerId)).not.toContain(edgeId);
    const closed = structuredClone(state);
    const end = closed.board.edges.find(edge => edge.id === edgeId)!.vertexIds.find(id => id !== vertexId)!;
    closed.board.vertices.find(vertex => vertex.id === end)!.building = { playerId, kind: "settlement" };
    expect(movableShipEdges(closed, playerId)).not.toContain(edgeId);
    const nextTurn = applyAction(next, playerId, { type: "end-turn" });
    expect(nextTurn.shipMoved).toBe(false);
    expect(nextTurn.shipsBuiltThisTurn).toEqual([]);
  });

  test("Longest Route counts ships but joins a road and a ship only at an own building", () => {
    const { state, playerId, edgeId, vertexId } = shippedGame();
    const ship = state.board.edges.find(edge => edge.id === edgeId)!;
    const other = state.board.vertices.find(vertex => vertex.id === vertexId)!;
    const road = state.board.edges.find(edge => edge.id !== edgeId && edge.vertexIds.includes(other.id))!;
    road.playerId = playerId;
    expect(getLongestRoadLength(state, playerId)).toBe(2);
    other.building = null;
    expect(getLongestRoadLength(state, playerId)).toBe(1);
    other.building = { playerId: state.players.find(player => player.id !== playerId)!.id, kind: "settlement" };
    expect(getLongestRoadLength(state, playerId)).toBe(1);
    road.kind = "ship";
    other.building = null;
    expect(getLongestRoadLength(state, playerId)).toBe(2);
    expect(ship.kind).toBe("ship");
  });

  test("Road Building can place two free ships or mixed pieces and does not finish early when only ships remain", () => {
    let { state, playerId } = shippedGame();
    for (const edge of state.board.edges.filter(edge => edgeTiles(state.board, edge).every(tile => tile.terrain !== "sea")).slice(0, 15)) {
      edge.playerId = playerId;
    }
    state.players.find(player => player.id === playerId)!.developmentCards = [{ id: "development-1", kind: "road-building", purchasedTurn: 1 }];
    state = applyAction(state, playerId, { type: "play-development", cardId: "development-1" });
    expect(legalRoadEdges(state, playerId)).toHaveLength(0);
    for (let index = 0; index < 2; index++) {
      const edgeId = legalShipEdges(state, playerId)[0]!;
      state = applyAction(state, playerId, { type: "place-ship", edgeId });
    }
    expect(state.phase.type).toBe("actions");
    expect(state.shipsBuiltThisTurn).toHaveLength(2);
    expect(resourceTotal(state.players.find(player => player.id === playerId)!.resources)).toBe(0);
  });
});

describe("pirate and gold", () => {
  test("the pirate steals only from adjacent ship owners and blocks ship construction, not roads", () => {
    const { state, playerId, edgeId } = shippedGame();
    const opponent = state.players.find(player => player.id !== playerId)!;
    const ship = state.board.edges.find(edge => edge.id === edgeId)!;
    ship.playerId = opponent.id;
    const sea = edgeTiles(state.board, ship).find(tile => tile.terrain === "sea")!;
    state.board.vertices.find(vertex => vertex.id === sea.vertexIds.find(id => !ship.vertexIds.includes(id)))!.building =
      { playerId: state.players.find(player => player.id !== opponent.id && player.id !== playerId)!.id, kind: "settlement" };
    state.phase = { type: "robber", returnPhase: "actions" };
    give(state, opponent.id, resources({ ore: 1 }));
    let next = applyAction(state, playerId, { type: "move-pirate", tileId: sea.id });
    expect(next.phase).toEqual({ type: "steal", victimIds: [opponent.id], returnPhase: "actions" });
    expect(next.robberTileId).toBe(state.robberTileId);
    next = applyAction(next, playerId, { type: "steal", playerId: opponent.id }, () => 0);
    expect(next.players.find(player => player.id === playerId)!.resources.ore).toBe(1);
    for (const id of legalShipEdges(next, playerId)) expect(edgeTiles(next.board, next.board.edges.find(edge => edge.id === id)!).some(tile => tile.id === sea.id)).toBe(false);
    assertConservation(next);
    const land = state.board.tiles.find(tile => tile.terrain !== "sea")!;
    expect(() => applyAction(state, playerId, { type: "move-pirate", tileId: land.id })).toThrow("sea hex");
    expect(() => applyAction(state, playerId, { type: "move-robber", tileId: sea.id })).toThrow("land hex");
  });

  test("pirate may move off-board and Knight cancellation restores the pre-roll phase without moving either token", () => {
    let state = newGame();
    const playerId = state.activePlayerId;
    state.phase = { type: "roll" };
    state.turnNumber = 5;
    state.players.find(player => player.id === playerId)!.developmentCards = [{ id: "development-1", kind: "knight", purchasedTurn: 1 }];
    const original = structuredClone(state);
    state = applyAction(state, playerId, { type: "play-development", cardId: "development-1" });
    const cancelled = applyAction(state, playerId, { type: "cancel-knight" });
    expect(cancelled.phase.type).toBe("roll");
    expect(cancelled.pirateTileId).toBe(original.pirateTileId);
    expect(cancelled.players).toEqual(original.players);
    const moved = applyAction(state, playerId, { type: "move-pirate", tileId: null });
    expect(moved.pirateTileId).toBeNull();
    expect(moved.phase.type).toBe("roll");
    expect(() => applyAction(moved, playerId, { type: "cancel-knight" })).toThrow("no Knight");
  });

  test("gold pays settlements and cities with chosen bank resources, in active-player-first order, before actions resume", () => {
    let state = newGame();
    state.phase = { type: "roll" };
    state.turnNumber = 5;
    const [active, other] = [state.players.find(player => player.id === state.activePlayerId)!, state.players.find(player => player.id !== state.activePlayerId)!];
    const gold = state.board.tiles.find(tile => tile.terrain === "gold")!;
    for (const tile of state.board.tiles) tile.number = tile.id === gold.id ? 6 : null;
    state.board.vertices.find(vertex => vertex.id === gold.vertexIds[0])!.building = { playerId: active.id, kind: "settlement" };
    state.board.vertices.find(vertex => vertex.id === gold.vertexIds[3])!.building = { playerId: other.id, kind: "city" };
    state = applyAction(state, active.id, { type: "roll" }, () => 0.4);
    expect(state.phase).toEqual({ type: "gold", required: { [active.id]: 1, [other.id]: 2 } });
    expect(getController(state)).toBe(active.id);
    expect(() => applyAction(state, other.id, { type: "choose-gold", resources: resources({ ore: 2 }) })).toThrow("Wait");
    expect(() => applyAction(state, active.id, { type: "end-turn" })).toThrow("mandatory");
    state = applyAction(state, active.id, { type: "choose-gold", resources: resources({ wood: 1 }) });
    expect(getController(state)).toBe(other.id);
    state = applyAction(state, other.id, { type: "choose-gold", resources: resources({ ore: 1, wool: 1 }) });
    expect(state.phase.type).toBe("actions");
    expect(state.activePlayerId).toBe(active.id);
    assertConservation(state);
    const blocked = newGame();
    blocked.phase = { type: "roll" };
    blocked.robberTileId = blocked.board.tiles.find(tile => tile.terrain === "gold")!.id;
    blocked.board.tiles.find(tile => tile.id === blocked.robberTileId)!.number = 6;
    blocked.board.vertices.find(vertex => vertex.id === blocked.board.tiles.find(tile => tile.id === blocked.robberTileId)!.vertexIds[0])!.building =
      { playerId: blocked.activePlayerId, kind: "city" };
    expect(applyAction(blocked, blocked.activePlayerId, { type: "roll" }, () => 0.4).phase.type).toBe("actions");
  });

  test("gold choices enforce finite supply and complete even if the bank has fewer cards than owed", () => {
    const state = newGame();
    state.phase = { type: "gold", required: { [state.activePlayerId]: 2 } };
    state.bank = resources({ grain: 1 });
    expect(() => applyAction(state, state.activePlayerId, { type: "choose-gold", resources: resources({ ore: 1 }) })).toThrow("exactly 1");
    const next = applyAction(state, state.activePlayerId, { type: "choose-gold", resources: resources({ grain: 1 }) });
    expect(next.phase.type).toBe("actions");
    state.bank = emptyResources();
    expect(applyAction(state, state.activePlayerId, { type: "choose-gold", resources: emptyResources() }).phase.type).toBe("actions");
  });
});

describe("island scoring and multiplayer", () => {
  test("each player gains two points per settled remote island, retained on city upgrades; victory needs thirteen", () => {
    let state = newGame();
    const playerId = state.activePlayerId;
    state.phase = { type: "actions" };
    state.turnNumber = 5;
    const first = state.board.tiles.find(tile => tile.islandId === "island-1")!;
    const vertices = [first.vertexIds[0]!, first.vertexIds[3]!];
    for (const id of vertices) state.board.vertices.find(vertex => vertex.id === id)!.building = { playerId, kind: "settlement" };
    expect(getScore(state, playerId).islands).toBe(2);
    const city = state.board.vertices.find(vertex => vertex.id === vertices[0])!;
    city.building = { playerId, kind: "city" };
    expect(getScore(state, playerId).islands).toBe(2);
    const remote = ["island-2", "island-3"].map(islandId => state.board.tiles.find(tile => tile.islandId === islandId)!);
    state.board.vertices.find(vertex => vertex.id === remote[0]!.vertexIds[0])!.building = { playerId, kind: "city" };
    state.board.vertices.find(vertex => vertex.id === remote[1]!.vertexIds[0])!.building = { playerId, kind: "settlement" };
    expect(getScore(state, playerId).islands).toBe(6);
    expect(getScore(state, playerId).total).toBe(12);
    const notWon = applyAction(state, playerId, { type: "end-turn" });
    expect(notWon.winnerId).toBeNull();
    give(state, playerId, COSTS.city);
    state = applyAction(state, playerId, { type: "place-city", vertexId: remote[1]!.vertexIds[0]! });
    expect(state.winnerId).toBe(playerId);
    expect(getScore(state, playerId).total).toBe(13);
  });

  test("host selects and shuffles the variant, preserves preview and roster, and broadcasts a validated larger board", () => {
    const room = new HostRoom("secret");
    room.join("phone", { type: "join", secret: "secret", name: "Alex" });
    room.admit("phone");
    room.addComputer();
    room.addComputer();
    const roster = room.snapshot().players;
    room.setVariant("seafarers");
    room.shuffleBoard();
    const preview = room.snapshot().previewBoard!;
    expect(preview.tiles).toHaveLength(42);
    expect(room.snapshot().players).toEqual(roster);
    expect(room.snapshot("phone").variant).toBe("seafarers");
    room.start();
    expect(room.game!.board).toEqual(preview);
    expect(() => room.setVariant("original")).toThrow("lobby");
    // Island bonus points are public snapshot data derived from buildings and island identifiers.
    const settlerId = room.game!.activePlayerId;
    const islandVertex = room.game!.board.vertices.find(vertex => vertex.id ===
      room.game!.board.tiles.find(tile => tile.islandId === "island-1")!.vertexIds[0])!;
    islandVertex.building = { playerId: settlerId, kind: "settlement" };
    const snapshot = room.snapshot("phone");
    expect(parseServerMessage({ type: "snapshot", snapshot })).toEqual({ type: "snapshot", snapshot });
    expect(snapshot.game!.variant).toBe("seafarers");
    expect(snapshot.game!.players.find(player => player.id === settlerId)!.islands).toBe(2);
    expect(snapshot.game!.players.filter(player => player.id !== settlerId).every(player => player.islands === 0)).toBe(true);
    expect(snapshot.privatePlayer!.resources).toEqual(emptyResources());
    expect(snapshot.game!.players.every(player => !("resources" in player))).toBe(true);
    const outOfRange = structuredClone(snapshot);
    outOfRange.game!.players.forEach(player => { player.islands = 7; });
    expect(() => parseServerMessage({ type: "snapshot", snapshot: outOfRange })).toThrow();
  });

  test("network parsing accepts larger identifiers and exact ship, pirate, and gold commands, but rejects unexpected fields", () => {
    for (const action of [
      { type: "place-ship", edgeId: "edge-148" },
      { type: "move-ship", edgeId: "edge-100", destinationEdgeId: "edge-101" },
      { type: "move-pirate", tileId: "tile-41" },
      { type: "move-pirate", tileId: null },
      { type: "choose-gold", resources: resources({ ore: 2 }) },
    ] satisfies GameAction[]) {
      expect(parseAction(action)).toEqual(action);
      expect(() => parseAction({ ...action, unexpected: true })).toThrow("unexpected");
    }
    expect(parseClientMessage({ type: "select-build", piece: "ship", requestId: "request-1", version: 1 })).toMatchObject({ piece: "ship" });
    expect(() => parseAction({ type: "move-ship", edgeId: "edge-1" })).toThrow("Invalid");
    expect(() => parseAction({ type: "choose-gold", resources: { ...emptyResources(), gold: 1 } })).toThrow("Invalid");
  });

  test("shared-board free builds respect the selected road/ship kind, and phones cannot place ships", () => {
    const room = new HostRoom("secret");
    for (let index = 0; index < 3; index++) {
      room.join(`phone-${index + 1}`, { type: "join", secret: "secret", name: profiles[index]!.name });
      room.admit(`phone-${index + 1}`);
    }
    room.setVariant("seafarers");
    room.start();
    room.game!.pirateTileId = null;
    const playerId = room.game!.activePlayerId;
    const vertexId = legalSettlementVertices(room.game!, playerId).find(id => {
      const placed = applyAction(room.game!, playerId, { type: "place-settlement", vertexId: id });
      return legalShipEdges(placed, playerId).some(edgeId => legalRoadEdges(placed, playerId).includes(edgeId));
    })!;
    room.performBoard({ type: "place-settlement", vertexId });
    room.selectBuild("ship");
    const edgeId = room.snapshot().boardTargets.edges.find(id => legalRoadEdges(room.game!, playerId).includes(id))!;
    expect(() => room.performBoard({ type: "place-road", edgeId })).toThrow("highlighted");
    const connection = playerId.replace("player-", "phone-");
    expect(room.command(connection, {
      type: "action", requestId: "place-ship", version: room.version, action: { type: "place-ship", edgeId },
    }).error).not.toBeNull();
    room.performBoard({ type: "place-ship", edgeId });
    expect(room.game!.board.edges.find(edge => edge.id === edgeId)).toMatchObject({ kind: "ship", playerId });
  });

  test("gold phases serialize and authorize only the next eligible private phone, even off-turn", () => {
    const room = new HostRoom("secret");
    for (let index = 0; index < 3; index++) {
      room.join(`phone-${index + 1}`, { type: "join", secret: "secret", name: profiles[index]!.name });
      room.admit(`phone-${index + 1}`);
    }
    room.setVariant("seafarers");
    room.start();
    const playerId = room.game!.players.find(player => player.id !== room.game!.activePlayerId)!.id;
    room.game!.phase = { type: "gold", required: { [playerId]: 1 } };
    const connection = playerId.replace("player-", "phone-");
    const snapshot = room.snapshot(connection);
    expect(parseServerMessage({ type: "snapshot", snapshot })).toMatchObject({ snapshot: { game: { phase: { type: "gold" } } } });
    const command = { type: "action" as const, requestId: "gold", version: room.version, action: { type: "choose-gold" as const, resources: resources({ ore: 1 }) } };
    expect(room.command(room.game!.activePlayerId.replace("player-", "phone-"), command).error).not.toBeNull();
    expect(room.command(connection, command).error).toBeNull();
    expect(room.snapshot(connection).privatePlayer!.resources.ore).toBe(1);
    expect(room.snapshot().game!.phase.type).toBe("actions");
    expect(room.snapshot().game!.players.every(player => !("resources" in player))).toBe(true);
    assertConservation(room.game!);
  });
});

describe("Seafarers computer games", () => {
  test.each([3, 4])("%s computers finish legal games with ships, gold, and thirteen-point scoring", count => {
    const random = randomFromSeed(count);
    let state = createGame(profiles.slice(0, count).map(profile => ({ ...profile, control: "computer" })), random, undefined, "seafarers");
    let actions = 0;
    let ships = 0;
    while (!state.winnerId && actions < 10000) {
      const decision = state.players.map(player => ({ playerId: player.id, action: chooseComputerAction(state, player.id) }))
        .find(decision => decision.action);
      const playerId = decision!.playerId;
      const action = decision!.action;
      expect(action).not.toBeNull();
      if (!action) break;
      if (action.type === "place-ship") ships++;
      state = applyAction(state, playerId, action, random);
      assertConservation(state);
      actions++;
    }
    expect(state.winnerId).not.toBeNull();
    expect(ships).toBeGreaterThan(0);
    expect(getScore(state, state.winnerId!).total).toBeGreaterThanOrEqual(13);
  }, 30000);
});
