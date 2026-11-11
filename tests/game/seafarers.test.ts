import { describe, expect, test } from "bun:test";
import { createBoard, edgeTiles, isPortRevealed, portAnchor, portHexId, relocateFoggyWorldPorts, seededRandom } from "../../src/game/board";
import { chooseComputerAction, getController } from "../../src/game/computer";
import {
  applyAction, COSTS, createGame, emptyResources, getLongestRoadLength, getScore, getTradeRatio, legalRoadEdges,
  legalSettlementVertices, legalSetupRevealTiles, legalShipDestinations, legalShipEdges, movableShipEdges, RESOURCES, resourceTotal,
} from "../../src/game/engine";
import type { Board, GameAction, GameState, Player, Resources } from "../../src/game/types";
import { parseAction, parseClientMessage, parseServerMessage } from "../../src/multiplayer/protocol";
import { HostRoom, publicGame } from "../../src/multiplayer/state";

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

describe("Foggy World", () => {
  function selectSetupCell(state: GameState, tileId: string, vertexId?: string): GameState {
    const revealed = applyAction(state, state.activePlayerId, { type: "reveal-tile", tileId });
    return revealed.phase.type === "setup-settlement"
      ? applyAction(revealed, revealed.activePlayerId, { type: "place-settlement", vertexId: vertexId ?? legalSettlementVertices(revealed, revealed.activePlayerId)[0]! })
      : revealed;
  }

  function revealHarborTile(board: Board, tileId: string): void {
    Object.assign(board.tiles.find(tile => tile.id === tileId)!, board.fogDiscoveriesByTileId![tileId]!);
    delete board.fogDiscoveriesByTileId![tileId];
    relocateFoggyWorldPorts(board);
  }

  test("covers every hex with fog and a matching fixed terrain assignment", () => {
    for (let seed = 0; seed < 30; seed++) {
      const board = createBoard(randomFromSeed(seed), "foggy-world");
      expect(board.variant).toBe("foggy-world");
      expect(board.tiles).toHaveLength(42);
      expect(board.tiles.every(tile => tile.terrain === "fog")).toBe(true);
      expect(board.tiles.filter(tile => tile.islandId === "main")).toHaveLength(19);
      expect(board.ports).toHaveLength(9);
      expect(board.fogDiscoveryDeck).toBeUndefined();
      expect(Object.keys(board.fogDiscoveriesByTileId!).toSorted()).toEqual(board.tiles.map(tile => tile.id).toSorted());
      const deck = Object.values(board.fogDiscoveriesByTileId!);
      expect(deck).toHaveLength(42);
      expect(Object.fromEntries(["wood", "brick", "wool", "grain", "ore", "gold", "desert", "sea"].map(terrain =>
        [terrain, deck.filter(discovery => discovery.terrain === terrain).length])))
        .toEqual({ wood: 6, brick: 4, wool: 6, grain: 6, ore: 4, gold: 2, desert: 1, sea: 13 });
      expect(deck.filter(discovery => discovery.terrain === "sea" || discovery.terrain === "desert")
        .every(discovery => discovery.number === null)).toBe(true);
      expect(deck.filter(discovery => discovery.number !== null).flatMap(discovery => discovery.number === null ? [] : [discovery.number]).sort((first, second) => first - second))
        .toEqual([2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6, 8, 8, 8, 9, 9, 9, 10, 10, 10, 11, 11, 11, 12, 12]);
      // Harbor labels anchor outward while everything is fog, so the preview renders.
      for (const port of board.ports) expect(portAnchor(board, port).portX).toBeDefined();
    }
    expect(createBoard(seededRandom("6SMHDES6"), "foggy-world")).toEqual(createBoard(seededRandom("6SMHDES6"), "foggy-world"));
  });

  test("the map code fixes every cell's terrain and number regardless of discovery order", () => {
    const board = createBoard(seededRandom("6SMHDES6"), "foggy-world");
    const expected = board.tiles.map(tile => ({ id: tile.id, ...board.fogDiscoveriesByTileId![tile.id]! }));
    for (const tileIds of [board.tiles.map(tile => tile.id), board.tiles.map(tile => tile.id).reverse()]) {
      let state = createGame(profiles.slice(0, 3), randomFromSeed(1), board);
      for (const tileId of tileIds) {
        state.phase = { type: "setup-reveal" };
        state = applyAction(state, state.activePlayerId, { type: "reveal-tile", tileId });
        if (state.phase.type === "gold") {
          state = applyAction(state, state.activePlayerId, { type: "choose-gold", resources: resources({ ore: 1 }) });
        }
      }
      expect(state.board.tiles.map(({ id, terrain, number }) => ({ id, terrain, number }))).toEqual(expected);
      expect(state.board.fogDiscoveriesByTileId).toEqual({});
      assertConservation(state);
    }
    expect(Object.keys(board.fogDiscoveriesByTileId!)).toHaveLength(42);
  });

  test("missing fixed terrain is an explicit error and cannot fall back to a discovery deck", () => {
    const state = createGame(profiles.slice(0, 3), randomFromSeed(1), undefined, "foggy-world");
    const tileId = state.board.tiles[0]!.id;
    delete state.board.fogDiscoveriesByTileId![tileId];
    state.board.fogDiscoveryDeck = [{ terrain: "wood", number: 5 }];
    const original = structuredClone(state);
    expect(() => applyAction(state, state.activePlayerId, { type: "reveal-tile", tileId })).toThrow("no hidden terrain");
    expect(state).toEqual(original);
  });

  test("cell selection repeats on sea and unlocks only the chosen land cell's settlement nodes", () => {
    const start = () => {
      const state = createGame(profiles.slice(0, 3), randomFromSeed(1), undefined, "foggy-world");
      expect(state.phase.type).toBe("setup-reveal");
      expect(state.pirateTileId).toBeNull();
      expect(state.robberTileId).toBe("");
      return state;
    };
    const playerId = start().activePlayerId;
    let state = start();
    const sea = state.board.tiles[0]!;
    const land = state.board.tiles[1]!;
    state.board.fogDiscoveriesByTileId = {
      [sea.id]: { terrain: "sea", number: null },
      [land.id]: { terrain: "wood", number: 5 },
      [state.board.tiles[2]!.id]: { terrain: "brick", number: 9 },
    };
    const original = structuredClone(state);
    expect(legalSetupRevealTiles(state, playerId)).toHaveLength(42);
    expect(legalSettlementVertices(state, playerId)).toHaveLength(0);
    expect(() => applyAction(state, playerId, { type: "place-settlement", vertexId: land.vertexIds[0]! })).toThrow("legal intersection");
    const pending = structuredClone(state);
    expect(() => applyAction(state, state.players.find(player => player.id !== playerId)!.id,
      { type: "reveal-tile", tileId: sea.id })).toThrow("Wait for your turn");
    expect(state).toEqual(pending);
    state = applyAction(state, playerId, { type: "reveal-tile", tileId: sea.id });
    expect(state.phase.type).toBe("setup-reveal");
    expect(state.activePlayerId).toBe(playerId);
    expect(state.setupIndex).toBe(0);
    expect(state.board.vertices.some(vertex => vertex.building)).toBe(false);
    expect(state.board.tiles.find(tile => tile.id === sea.id)!.terrain).toBe("sea");
    expect(state.board.tiles.filter(tile => tile.terrain === "fog")).toHaveLength(41);
    expect(original.board.tiles.every(tile => tile.terrain === "fog")).toBe(true);
    expect(state.players.find(player => player.id === playerId)!.resources).toEqual(emptyResources());
    expect(state.log.at(-1)!.key).toBe("{player} finds sea. Choose another starting cell.");
    expect(legalSetupRevealTiles(state, playerId)).not.toContain(sea.id);
    expect(() => applyAction(state, playerId, { type: "reveal-tile", tileId: sea.id })).toThrow("available starting cell");
    state = applyAction(state, playerId, { type: "reveal-tile", tileId: land.id });
    expect(state.phase).toEqual({ type: "setup-settlement", tileId: land.id });
    expect(state.board.vertices.some(vertex => vertex.building)).toBe(false);
    expect(legalSetupRevealTiles(state, playerId)).toHaveLength(0);
    expect(legalSettlementVertices(state, playerId).toSorted()).toEqual(land.vertexIds.toSorted());
    const unrelated = state.board.vertices.find(vertex => !land.vertexIds.includes(vertex.id))!;
    expect(() => applyAction(state, playerId, { type: "place-settlement", vertexId: unrelated.id })).toThrow("legal intersection");
    expect(state.players.find(player => player.id === playerId)!.resources).toEqual(resources({ wood: 1 }));
    expect(Object.keys(state.board.fogDiscoveriesByTileId!)).toHaveLength(1);
    expect(state.board.tiles.filter(tile => tile.terrain === "fog")).toHaveLength(40);
    expect(() => applyAction(state, playerId, { type: "reveal-tile", tileId: state.board.tiles[2]!.id })).toThrow("available starting cell");
    const vertexId = land.vertexIds[2]!;
    state = applyAction(state, playerId, { type: "place-settlement", vertexId });
    expect(state.phase).toEqual({ type: "setup-road", vertexId });
    expect(state.board.vertices.find(vertex => vertex.id === vertexId)!.building).toEqual({ playerId, kind: "settlement" });
    assertConservation(state);
  });

  test("gold discovery resolves before choosing the selected cell's settlement node", () => {
    let state = createGame(profiles.slice(0, 3), randomFromSeed(1), undefined, "foggy-world");
    const playerId = state.activePlayerId;
    const node = state.board.vertices.find(vertex => vertex.tileIds.length === 3)!;
    const tileId = node.tileIds[0]!;
    state.board.fogDiscoveriesByTileId = {
      [tileId]: { terrain: "gold", number: 6 },
      [node.tileIds[1]!]: { terrain: "gold", number: 9 },
      [node.tileIds[2]!]: { terrain: "sea", number: null },
    };
    state = applyAction(state, playerId, { type: "reveal-tile", tileId });
    expect(state.phase).toEqual({
      type: "gold", required: { [playerId]: 1 }, resumePhase: { type: "setup-settlement", tileId }, resumePlayerId: playerId,
    });
    expect(state.board.vertices.some(vertex => vertex.building)).toBe(false);
    expect(legalSettlementVertices(state, playerId)).toHaveLength(0);
    expect(legalRoadEdges(state, playerId)).toHaveLength(0);
    expect(Object.keys(state.board.fogDiscoveriesByTileId!)).toHaveLength(2);
    state = applyAction(state, playerId, { type: "choose-gold", resources: resources({ ore: 1 }) });
    expect(state.phase).toEqual({ type: "setup-settlement", tileId });
    expect(state.players.find(player => player.id === playerId)!.resources).toEqual(resources({ ore: 1 }));
    state = applyAction(state, playerId, { type: "place-settlement", vertexId: node.id });
    expect(state.phase).toEqual({ type: "setup-road", vertexId: node.id });
    assertConservation(state);
  });

  test("desert supports a settlement without a discovery reward", () => {
    let state = createGame(profiles.slice(0, 3), randomFromSeed(1), undefined, "foggy-world");
    const playerId = state.activePlayerId;
    const node = state.board.vertices.find(vertex => vertex.tileIds.length === 1)!;
    state.board.fogDiscoveriesByTileId = { [node.tileIds[0]!]: { terrain: "desert", number: null } };
    state = selectSetupCell(state, node.tileIds[0]!, node.id);
    expect(state.phase).toEqual({ type: "setup-road", vertexId: node.id });
    expect(state.players.find(player => player.id === playerId)!.resources).toEqual(emptyResources());
  });

  test("new land grants discovery and second-settlement starting resources", () => {
    let state = createGame(profiles.slice(0, 3), randomFromSeed(1), undefined, "foggy-world");
    const playerId = state.activePlayerId;
    state.setupIndex = state.players.length;
    const node = state.board.vertices.find(vertex => vertex.tileIds.length === 3)!;
    const tiles = state.board.tiles.filter(tile => node.tileIds.includes(tile.id));
    tiles[0]!.terrain = "wood";
    tiles[0]!.number = 5;
    state.board.fogDiscoveriesByTileId = {
      [tiles[1]!.id]: { terrain: "brick", number: 9 },
      [tiles[2]!.id]: { terrain: "sea", number: null },
    };
    state = selectSetupCell(state, tiles[1]!.id, node.id);
    expect(state.phase).toEqual({ type: "setup-road", vertexId: node.id });
    expect(state.players.find(player => player.id === playerId)!.resources).toEqual(resources({ wood: 1, brick: 2 }));
    expect(Object.keys(state.board.fogDiscoveriesByTileId!)).toHaveLength(1);
    assertConservation(state);
  });

  test.each(["wood", "gold"] as const)("a second settlement can reuse revealed %s while fog remains without a discovery reward", terrain => {
    let state = createGame(profiles.slice(0, 3), randomFromSeed(1), undefined, "foggy-world");
    const playerId = state.activePlayerId;
    const land = state.board.tiles[0]!;
    land.terrain = terrain;
    land.number = 5;
    const sea = state.board.tiles[1]!;
    sea.terrain = "sea";
    sea.number = null;
    expect(legalSetupRevealTiles(state, playerId)).not.toContain(land.id);
    expect(legalSettlementVertices(state, playerId)).toHaveLength(0);
    expect(() => applyAction(state, playerId, { type: "reveal-tile", tileId: land.id })).toThrow("available starting cell");
    const firstVertex = state.board.vertices.find(vertex => vertex.tileIds.every(id =>
      !state.board.tiles.find(tile => tile.id === id)!.vertexIds.some(id => land.vertexIds.includes(id))))!;
    firstVertex.building = { playerId, kind: "settlement" };
    state.setupIndex = state.players.length;
    const hidden = structuredClone(state.board.fogDiscoveriesByTileId);
    const choices = legalSetupRevealTiles(state, playerId);
    expect(choices).not.toContain(land.id);
    expect(choices.some(id => state.board.tiles.find(tile => tile.id === id)!.terrain === "fog")).toBe(true);
    expect(choices).not.toContain(sea.id);
    expect(legalSettlementVertices(state, playerId).toSorted()).toEqual(land.vertexIds.toSorted());
    const vertexId = legalSettlementVertices(state, playerId)[0]!;
    state = applyAction(state, playerId, { type: "place-settlement", vertexId });
    expect(state.phase).toEqual({ type: "setup-road", vertexId });
    expect(state.board.fogDiscoveriesByTileId).toEqual(hidden);
    expect(state.players.find(player => player.id === playerId)!.resources).toEqual(resources(terrain === "wood" ? { wood: 1 } : {}));
    assertConservation(state);
  });

  test.each(["road", "ship"] as const)("a direct second settlement keeps its free %s on a revealed land boundary", kind => {
    let state = createGame(profiles.slice(0, 3), randomFromSeed(1), undefined, "foggy-world");
    const playerId = state.activePlayerId;
    const node = state.board.vertices.find(vertex => vertex.tileIds.length === 3)!;
    const land = state.board.tiles.find(tile => tile.id === node.tileIds[0])!;
    land.terrain = "wood";
    land.number = 5;
    state.board.vertices.at(-1)!.building = { playerId, kind: "settlement" };
    state.setupIndex = state.players.length;
    const hidden = structuredClone(state.board.fogDiscoveriesByTileId);
    const fogOnly = state.board.vertices.find(vertex => vertex.tileIds.every(id =>
      state.board.tiles.find(tile => tile.id === id)!.terrain === "fog"))!;
    expect(() => applyAction(state, playerId, { type: "place-settlement", vertexId: fogOnly.id })).toThrow("legal intersection");
    expect(() => applyAction(state, state.players.find(player => player.id !== playerId)!.id,
      { type: "place-settlement", vertexId: node.id })).toThrow("Wait for your turn");
    state = applyAction(state, playerId, { type: "place-settlement", vertexId: node.id });
    expect(state.phase).toEqual({ type: "setup-road", vertexId: node.id });
    expect(state.board.fogDiscoveriesByTileId).toEqual(hidden);
    const boundary = state.board.edges.filter(edge => edge.vertexIds.includes(node.id) &&
      edge.vertexIds.every(id => land.vertexIds.includes(id))).map(edge => edge.id);
    const legalEdges = (kind === "ship" ? legalShipEdges : legalRoadEdges)(state, playerId);
    expect(legalEdges.toSorted()).toEqual(boundary.toSorted());
    const outside = node.edgeIds.find(id => !boundary.includes(id))!;
    expect(() => applyAction(state, playerId, { type: kind === "ship" ? "place-ship" : "place-road", edgeId: outside })).toThrow("empty");
    state.board.fogDiscoveriesByTileId = Object.fromEntries(state.board.tiles.filter(tile => tile.terrain === "fog")
      .map(tile => [tile.id, { terrain: "sea", number: null }]));
    state = applyAction(state, playerId, { type: kind === "ship" ? "place-ship" : "place-road", edgeId: legalEdges[0]! });
    expect(state.setupIndex).toBe(state.players.length + 1);
    assertConservation(state);
  });

  test.each(["road", "ship"] as const)("setup %s may use any edge bordering revealed land beside the new settlement", kind => {
    let state = createGame(profiles.slice(0, 3), randomFromSeed(1), undefined, "foggy-world");
    const playerId = state.activePlayerId;
    const node = state.board.vertices.find(vertex => vertex.tileIds.length === 3)!;
    const selected = state.board.tiles.find(tile => tile.id === node.tileIds[0])!;
    state.board.fogDiscoveriesByTileId = Object.fromEntries(state.board.tiles.map(tile => [tile.id, { terrain: "sea", number: null }]));
    state.board.fogDiscoveriesByTileId[selected.id] = { terrain: "wood", number: 5 };
    const outside = state.board.edges.find(edge => node.edgeIds.includes(edge.id) &&
      !edge.vertexIds.every(id => selected.vertexIds.includes(id)))!;
    const neighbors = edgeTiles(state.board, outside);
    neighbors[0]!.terrain = "wood";
    neighbors[0]!.number = 9;
    neighbors[1]!.terrain = "sea";
    state = selectSetupCell(state, selected.id, node.id);
    const legalEdges = (kind === "ship" ? legalShipEdges : legalRoadEdges)(state, playerId);
    expect(legalEdges.length).toBeGreaterThan(0);
    expect(legalEdges).toContain(outside.id);
    state = applyAction(state, playerId, { type: kind === "ship" ? "place-ship" : "place-road", edgeId: outside.id });
    expect(state.setupIndex).toBe(1);
    assertConservation(state);
  });

  test("computer choices do not depend on unrevealed terrain assignments", () => {
    const state = createGame(profiles.slice(0, 3).map(profile => ({ ...profile, control: "computer" })), randomFromSeed(1), undefined, "foggy-world");
    const altered = structuredClone(state);
    altered.board.fogDiscoveriesByTileId = Object.fromEntries(altered.board.tiles.map(tile => [tile.id, { terrain: "gold", number: 6 }]));
    expect(chooseComputerAction(state, state.activePlayerId)).toEqual(chooseComputerAction(altered, altered.activePlayerId));
    const playerId = state.activePlayerId;
    const revealed = state.board.tiles[0]!;
    revealed.terrain = "wood";
    revealed.number = 5;
    state.board.vertices.at(-1)!.building = { playerId, kind: "settlement" };
    altered.board.tiles[0]!.terrain = revealed.terrain;
    altered.board.tiles[0]!.number = revealed.number;
    altered.board.vertices.at(-1)!.building = { playerId, kind: "settlement" };
    expect(chooseComputerAction(state, playerId)).toEqual(chooseComputerAction(altered, playerId));
  });

  test("computers keep exploring when possible and settle directly when no eligible fog remains", () => {
    const state = createGame(profiles.slice(0, 3).map(profile => ({ ...profile, control: "computer" })), randomFromSeed(1), undefined, "foggy-world");
    const playerId = state.activePlayerId;
    const land = state.board.tiles[0]!;
    land.terrain = "wood";
    land.number = 5;
    state.board.vertices.at(-1)!.building = { playerId, kind: "settlement" };
    state.setupIndex = state.players.length;
    expect(chooseComputerAction(state, playerId)?.type).toBe("reveal-tile");
    for (const tile of state.board.tiles) {
      if (tile.id !== land.id) tile.terrain = "sea";
    }
    expect(legalSetupRevealTiles(state, playerId)).toEqual([]);
    const action = chooseComputerAction(state, playerId)!;
    expect(action.type).toBe("place-settlement");
    const next = applyAction(state, playerId, action);
    expect(next.phase.type).toBe("setup-road");
    expect(next.players.find(player => player.id === playerId)!.resources).toEqual(resources({ wood: 1 }));
    assertConservation(next);
  });

  test("discovery and starting resources respect remaining bank stock", () => {
    let state = createGame(profiles.slice(0, 3), randomFromSeed(1), undefined, "foggy-world");
    const playerId = state.activePlayerId;
    state.setupIndex = state.players.length;
    const otherPlayer = state.players.find(player => player.id !== playerId)!;
    give(state, otherPlayer.id, resources({ wood: 19, brick: 18 }));
    const node = state.board.vertices.find(vertex => vertex.tileIds.length === 3)!;
    const land = state.board.tiles.find(tile => tile.id === node.tileIds[0])!;
    land.terrain = "wood";
    land.number = 5;
    state.board.fogDiscoveriesByTileId = {
      [node.tileIds[1]!]: { terrain: "brick", number: 9 },
      [node.tileIds[2]!]: { terrain: "sea", number: null },
    };
    state = selectSetupCell(state, node.tileIds[1]!, node.id);
    expect(state.players.find(player => player.id === playerId)!.resources).toEqual(resources({ brick: 1 }));
    assertConservation(state);
  });

  test("sea requires another cell even when it touches existing land", () => {
    let state = createGame(profiles.slice(0, 3), randomFromSeed(1), undefined, "foggy-world");
    const playerId = state.activePlayerId;
    const node = state.board.vertices.find(vertex => vertex.tileIds.length === 3)!;
    state.board.tiles.find(tile => tile.id === node.tileIds[0])!.terrain = "wood";
    state.board.fogDiscoveriesByTileId = {
      [node.tileIds[2]!]: { terrain: "sea", number: null },
      [node.tileIds[1]!]: { terrain: "gold", number: 6 },
    };
    state = applyAction(state, playerId, { type: "reveal-tile", tileId: node.tileIds[2]! });
    expect(state.phase).toEqual({ type: "setup-reveal" });
    expect(state.board.vertices.some(vertex => vertex.building)).toBe(false);
    expect(legalSettlementVertices(state, playerId)).toHaveLength(0);
    expect(state.board.tiles.find(tile => tile.id === node.tileIds[1])!.terrain).toBe("fog");
    expect(Object.keys(state.board.fogDiscoveriesByTileId!)).toHaveLength(1);
    expect(state.players.find(player => player.id === playerId)!.resources).toEqual(emptyResources());
    assertConservation(state);
  });

  test("revealed land can be selected without a discovery reward when no eligible fog remains", () => {
    let state = createGame(profiles.slice(0, 3), randomFromSeed(1), undefined, "foggy-world");
    for (const tile of state.board.tiles) tile.terrain = "sea";
    const land = state.board.tiles[0]!;
    land.terrain = "wood";
    state.board.fogDiscoveriesByTileId = {};
    expect(legalSetupRevealTiles(state, state.activePlayerId)).toEqual([land.id]);
    state = selectSetupCell(state, land.id);
    expect(state.phase.type).toBe("setup-road");
    expect(state.players.find(player => player.id === state.activePlayerId)!.resources).toEqual(emptyResources());
    expect(state.board.fogDiscoveriesByTileId).toEqual({});
  });

  test("blocked or off-turn node attempts do not reveal fixed terrain", () => {
    const state = createGame(profiles.slice(0, 3), randomFromSeed(1), undefined, "foggy-world");
    const playerId = state.activePlayerId;
    const node = state.board.vertices[0]!;
    state.board.vertices.find(vertex => vertex.id === state.board.edges.find(edge => node.edgeIds.includes(edge.id))!.vertexIds[1])!
      .building = { playerId, kind: "settlement" };
    const original = structuredClone(state);
    expect(() => applyAction(state, playerId, { type: "place-settlement", vertexId: node.id })).toThrow("legal intersection");
    expect(() => applyAction(state, state.players.find(player => player.id !== playerId)!.id,
      { type: "place-settlement", vertexId: state.board.vertices.at(-1)!.id })).toThrow("Wait for your turn");
    expect(state).toEqual(original);
  });

  test("cells with no legal settlement nodes cannot be selected or consume discoveries", () => {
    const state = createGame(profiles.slice(0, 3), randomFromSeed(1), undefined, "foggy-world");
    const tile = state.board.tiles[0]!;
    const otherPlayer = state.players.find(player => player.id !== state.activePlayerId)!;
    for (const index of [0, 2, 4]) {
      state.board.vertices.find(vertex => vertex.id === tile.vertexIds[index])!.building = { playerId: otherPlayer.id, kind: "settlement" };
    }
    const original = structuredClone(state);
    expect(legalSetupRevealTiles(state, state.activePlayerId)).not.toContain(tile.id);
    expect(() => applyAction(state, state.activePlayerId, { type: "reveal-tile", tileId: tile.id })).toThrow("available starting cell");
    expect(state).toEqual(original);
  });

  test.each([3, 4])("varied worlds support a complete %s-player cell-first setup", playerCount => {
    function resolveMandatory(current: GameState): GameState {
      while (current.phase.type === "gold" || current.phase.type === "setup-reveal") {
        if (current.phase.type === "setup-reveal") {
          current = applyAction(current, current.activePlayerId, { type: "reveal-tile", tileId: legalSetupRevealTiles(current, current.activePlayerId)[0]! });
          continue;
        }
        const chooser = Object.keys(current.phase.required)[0]!;
        const amount = current.phase.required[chooser]!;
        const resource = RESOURCES.find(resource => current.bank[resource] >= amount)!;
        current = applyAction(current, chooser, { type: "choose-gold", resources: resources({ [resource]: amount }) });
      }
      return current;
    }
    for (let seed = 0; seed < 10; seed++) {
      let state = createGame(profiles.slice(0, playerCount), randomFromSeed(seed), undefined, "foggy-world");
      for (let placement = 0; placement < playerCount * 2; placement++) {
        state = resolveMandatory(state);
        expect(state.phase.type).toBe("setup-settlement");
        const playerId = state.activePlayerId;
        const vertexId = legalSettlementVertices(state, playerId)[0]!;
        expect(vertexId).toBeDefined();
        state = applyAction(state, playerId, { type: "place-settlement", vertexId });
        const roadId = legalRoadEdges(state, playerId)[0];
        state = applyAction(state, playerId, roadId
          ? { type: "place-road", edgeId: roadId }
          : { type: "place-ship", edgeId: legalShipEdges(state, playerId)[0]! });
      }
      state = resolveMandatory(state);
      expect(state.phase.type).toBe("roll");
      expect(state.board.vertices.filter(vertex => vertex.building)).toHaveLength(playerCount * 2);
      expect(state.board.tiles.some(tile => tile.terrain !== "fog")).toBe(true);
      assertConservation(state);
    }
  });

  test.each(["road", "ship"] as const)("a chosen setup %s explores fog and advances to the next settlement", kind => {
    let state = createGame(profiles.slice(0, 3), randomFromSeed(1), undefined, "foggy-world");
    const playerId = state.activePlayerId;
    const vertexId = state.board.vertices.find(vertex => vertex.tileIds.length === 3)!.id;
    const tileId = state.board.vertices.find(vertex => vertex.id === vertexId)!.tileIds[0]!;
    state.board.fogDiscoveriesByTileId![tileId] = { terrain: "wood", number: 5 };
    state = selectSetupCell(state, tileId, vertexId);
    const edgeId = (kind === "ship" ? legalShipEdges : legalRoadEdges)(state, playerId).find(id => {
      const edge = state.board.edges.find(edge => edge.id === id)!;
      return edge.vertexIds.includes(vertexId) && state.board.tiles.some(tile => tile.terrain === "fog" &&
        tile.vertexIds.some(id => edge.vertexIds.includes(id)));
    })!;
    expect(edgeId).toBeDefined();
    const discoveries = state.board.tiles.filter(tile => tile.terrain === "fog" &&
      tile.vertexIds.some(id => state.board.edges.find(edge => edge.id === edgeId)!.vertexIds.includes(id)));
    for (const tile of discoveries) state.board.fogDiscoveriesByTileId![tile.id] = { terrain: "gold", number: 6 };
    const before = state.players.find(player => player.id === playerId)!.resources;
    state = applyAction(state, playerId, { type: kind === "ship" ? "place-ship" : "place-road", edgeId });
    expect(state.board.edges.find(edge => edge.id === edgeId)).toMatchObject({ playerId, ...(kind === "ship" ? { kind } : {}) });
    expect(state.setupIndex).toBe(1);
    expect(state.phase.type).toBe("gold");
    expect(state.activePlayerId).toBe(playerId);
    state = applyAction(state, playerId, { type: "choose-gold", resources: resources({ ore: discoveries.length }) });
    expect(state.activePlayerId).toBe(state.setupOrder[1]!);
    expect(state.phase.type).toBe("setup-reveal");
    expect(state.players.find(player => player.id === playerId)!.resources).toEqual({ ...before, ore: discoveries.length });
    expect(state.board.tiles.filter(tile => tile.terrain === "fog").length).toBeLessThan(42);
    for (const tile of discoveries) expect(state.board.fogDiscoveriesByTileId![tile.id]).toBeUndefined();
    assertConservation(state);
  });

  test("harbors require a revealed land coast before granting their trade ratio", () => {
    let state = createGame(profiles.slice(0, 3), randomFromSeed(1), undefined, "foggy-world");
    const playerId = state.activePlayerId;
    expect(state.board.ports.every(port => !isPortRevealed(state.board, port))).toBe(true);
    const fogIslands = createBoard(randomFromSeed(1), "fog-islands");
    expect(fogIslands.ports.every(port => isPortRevealed(fogIslands, port))).toBe(true);
    const port = state.board.ports.find(port => port.resource !== "any") ?? state.board.ports[0]!;
    const tradedResource = port.resource === "any" ? "wood" : port.resource;
    const hexId = portHexId(state.board, port);
    expect(state.board.tiles.find(tile => tile.id === hexId)!.terrain).toBe("fog");
    const edge = state.board.edges.find(edge => edge.id === port.edgeId)!;
    for (const tile of edgeTiles(state.board, edge)) {
      if (tile.id !== hexId) tile.terrain = "sea";
    }
    state.board.vertices.find(vertex => vertex.id === edge.vertexIds[0])!.building = { playerId, kind: "settlement" };
    expect(getTradeRatio(state, playerId, tradedResource)).toBe(4);
    state.board.fogDiscoveriesByTileId![hexId] = { terrain: "wood", number: 5 };
    revealHarborTile(state.board, hexId);
    expect(isPortRevealed(state.board, port)).toBe(true);
    expect(getTradeRatio(state, playerId, tradedResource)).toBe(port.resource === "any" ? 3 : 2);
  });

  test("revealing both sides of a harbor as sea never reveals or activates it", () => {
    let state = createGame(profiles.slice(0, 3), randomFromSeed(1), createBoard(seededRandom("6SMHDE26"), "foggy-world"));
    const playerId = state.activePlayerId;
    const port = state.board.ports.find(port => port.edgeId === "edge-16")!;
    const edge = state.board.edges.find(edge => edge.id === port.edgeId)!;
    const tradedResource = port.resource === "any" ? "wood" : port.resource;
    state.board.vertices.find(vertex => vertex.id === edge.vertexIds[0])!.building = { playerId, kind: "settlement" };
    for (const tileId of ["tile-3", "tile-37"]) {
      state.board.fogDiscoveriesByTileId![tileId] = { terrain: "sea", number: null };
      revealHarborTile(state.board, tileId);
      expect(state.board.tiles.find(tile => tile.id === tileId)!.terrain).toBe("sea");
      expect(state.board.ports.every(port => !isPortRevealed(state.board, port))).toBe(true);
      expect(getTradeRatio(state, playerId, tradedResource)).toBe(4);
    }
    expect(state.board.ports.map(port => port.resource)).toEqual(createBoard(seededRandom("6SMHDE26"), "foggy-world").ports.map(port => port.resource));
    assertConservation(state);
  });

  test("harbors wait beside fog or inland edges and relocate when a sea coast is discovered", () => {
    let state = createGame(profiles.slice(0, 3), randomFromSeed(1), createBoard(seededRandom("6SMHDE26"), "foggy-world"));
    const port = state.board.ports.find(port => port.edgeId === "edge-16")!;
    const portIndex = state.board.ports.indexOf(port);
    const edge = state.board.edges.find(edge => edge.id === port.edgeId)!;
    const landTiles = edgeTiles(state.board, edge);
    const seaTile = state.board.tiles.find(tile => !landTiles.includes(tile) &&
      landTiles.some(land => land.vertexIds.filter(id => tile.vertexIds.includes(id)).length === 2))!;
    state.board.fogDiscoveriesByTileId = {
      [landTiles[0]!.id]: { terrain: "wood", number: 5 },
      [landTiles[1]!.id]: { terrain: "grain", number: 9 },
      [seaTile.id]: { terrain: "sea", number: null },
    };
    for (const tile of landTiles) {
      revealHarborTile(state.board, tile.id);
      expect(isPortRevealed(state.board, state.board.ports[portIndex]!)).toBe(false);
    }
    revealHarborTile(state.board, seaTile.id);
    const revealedPorts = state.board.ports.filter(port => isPortRevealed(state.board, port));
    expect(revealedPorts.length).toBeGreaterThan(0);
    expect(revealedPorts.every(port => port.edgeId !== edge.id)).toBe(true);
    for (const port of revealedPorts) {
      const tiles = edgeTiles(state.board, state.board.edges.find(edge => edge.id === port.edgeId)!);
      expect(tiles.filter(tile => tile.terrain !== "sea" && tile.terrain !== "fog")).toHaveLength(1);
      expect(tiles.some(tile => tile.terrain === "fog")).toBe(false);
    }
  });

  test("exploration preserves nine harbor types and fills distinct revealed coasts without moving established ports", () => {
    for (let seed = 0; seed < 30; seed++) {
      let state = createGame(profiles.slice(0, 3), randomFromSeed(seed), undefined, "foggy-world");
      const portResources = state.board.ports.map(port => port.resource);
      const establishedEdges = new Map<number, string>();
      for (const tile of state.board.tiles) {
        revealHarborTile(state.board, tile.id);
        const occupiedVertices = new Set<string>();
        state.board.ports.forEach((port, index) => {
          if (establishedEdges.has(index)) expect(port.edgeId).toBe(establishedEdges.get(index)!);
          if (!isPortRevealed(state.board, port)) return;
          establishedEdges.set(index, port.edgeId);
          const edge = state.board.edges.find(edge => edge.id === port.edgeId)!;
          const tiles = edgeTiles(state.board, edge);
          expect(tiles.filter(tile => tile.terrain !== "sea" && tile.terrain !== "fog")).toHaveLength(1);
          expect(tiles.every(tile => tile.terrain !== "fog")).toBe(true);
          for (const vertexId of edge.vertexIds) {
            expect(occupiedVertices.has(vertexId)).toBe(false);
            occupiedVertices.add(vertexId);
          }
        });
        expect(state.board.ports.map(port => port.resource)).toEqual(portResources);
      }
      expect(state.board.ports.filter(port => isPortRevealed(state.board, port))).toHaveLength(9);
      assertConservation(state);
    }
  });

  test("robber and pirate start off board and may enter only revealed hexes", () => {
    const state = createGame(profiles.slice(0, 3), randomFromSeed(1), undefined, "foggy-world");
    state.phase = { type: "robber", returnPhase: "actions" };
    const playerId = state.activePlayerId;
    const fog = state.board.tiles.find(tile => tile.terrain === "fog")!;
    expect(() => applyAction(state, playerId, { type: "move-robber", tileId: fog.id })).toThrow("land hex");
    expect(() => applyAction(state, playerId, { type: "move-pirate", tileId: fog.id })).toThrow("sea hex");
    const revealed = structuredClone(state);
    const land = revealed.board.tiles[0]!;
    land.terrain = "wood";
    land.number = 5;
    const sea = revealed.board.tiles[1]!;
    sea.terrain = "sea";
    expect(applyAction(revealed, playerId, { type: "move-robber", tileId: land.id }).robberTileId).toBe(land.id);
    expect(applyAction(revealed, playerId, { type: "move-pirate", tileId: sea.id }).pirateTileId).toBe(sea.id);
  });

  test("hosts select cells then their nodes on the shared board while fixed terrain stays hidden", () => {
    const room = new HostRoom("secret");
    for (let index = 0; index < 3; index++) {
      room.join(`phone-${index + 1}`, { type: "join", secret: "secret", name: profiles[index]!.name });
      room.admit(`phone-${index + 1}`);
    }
    room.setVariant("foggy-world");
    const preview = room.snapshot().previewBoard!;
    expect(preview.tiles.every(tile => tile.terrain === "fog")).toBe(true);
    expect("fogDiscoveryDeck" in preview).toBe(false);
    expect("fogDiscoveriesByTileId" in preview).toBe(false);
    room.start();
    expect(room.game!.phase.type).toBe("setup-reveal");
    const playerId = room.game!.activePlayerId;
    const connection = playerId.replace("player-", "phone-");
    expect(room.snapshot().boardTargets.vertices).toHaveLength(0);
    expect(room.snapshot().boardTargets.tiles).toHaveLength(42);
    const tileId = room.snapshot().boardTargets.tiles[0]!;
    room.game!.board.fogDiscoveriesByTileId = Object.fromEntries(room.game!.board.tiles.map(tile => [tile.id, { terrain: "sea", number: null }]));
    expect(room.game!.phase).toEqual({ type: "setup-reveal" });
    const pending = room.snapshot(connection);
    expect(parseServerMessage({ type: "snapshot", snapshot: pending })).toEqual({ type: "snapshot", snapshot: pending });
    expect(room.command(connection, { type: "action", requestId: "reveal", version: room.version, action: { type: "reveal-tile", tileId } }).error).not.toBeNull();
    room.performBoard({ type: "reveal-tile", tileId });
    expect(room.game!.board.tiles.find(tile => tile.id === tileId)!.terrain).toBe("sea");
    expect(room.game!.board.tiles.filter(tile => tile.terrain === "fog")).toHaveLength(41);
    expect(Object.keys(room.game!.board.fogDiscoveriesByTileId!)).toHaveLength(41);
    expect(room.game!.phase.type).toBe("setup-reveal");
    expect(room.game!.activePlayerId).toBe(playerId);
    expect(() => room.performBoard({ type: "reveal-tile", tileId })).toThrow("highlighted");
    const landId = room.snapshot().boardTargets.tiles[0]!;
    room.game!.board.fogDiscoveriesByTileId![landId] = { terrain: "wood", number: 5 };
    room.performBoard({ type: "reveal-tile", tileId: landId });
    expect(room.game!.phase).toEqual({ type: "setup-settlement", tileId: landId });
    const nodes = room.game!.board.tiles.find(tile => tile.id === landId)!.vertexIds;
    expect(room.snapshot().boardTargets.vertices.toSorted()).toEqual(nodes.toSorted());
    expect(room.snapshot().boardTargets.tiles).toHaveLength(0);
    const snapshot = room.snapshot(connection);
    expect(parseServerMessage({ type: "snapshot", snapshot })).toEqual({ type: "snapshot", snapshot });
    expect(snapshot.game!.board.ports.some(port => port.awaitingCoast)).toBe(true);
    const invalidSnapshot = {
      ...snapshot,
      game: {
        ...snapshot.game!,
        board: { ...snapshot.game!.board, ports: snapshot.game!.board.ports.map(port => ({ ...port, awaitingCoast: "yes" })) },
      },
    };
    expect(() => parseServerMessage({ type: "snapshot", snapshot: invalidSnapshot })).toThrow();
    expect("fogDiscoveryDeck" in snapshot.game!.board).toBe(false);
    expect("fogDiscoveriesByTileId" in snapshot.game!.board).toBe(false);
    expect(parseAction({ type: "reveal-tile", tileId: "tile-41" })).toEqual({ type: "reveal-tile", tileId: "tile-41" });
    expect(() => parseAction({ type: "reveal-tile", tileId: "tile-41", vertexId: nodes[0] })).toThrow();
    const unrelated = room.game!.board.vertices.find(vertex => !nodes.includes(vertex.id))!;
    expect(() => room.performBoard({ type: "place-settlement", vertexId: unrelated.id })).toThrow("highlighted");
    room.performBoard({ type: "place-settlement", vertexId: nodes[1]! });
    expect(room.game!.phase).toEqual({ type: "setup-road", vertexId: nodes[1]! });
    const routeSnapshot = room.snapshot(connection);
    expect(routeSnapshot.game!.phase).toEqual(room.game!.phase);
    expect(parseServerMessage({ type: "snapshot", snapshot: routeSnapshot })).toEqual({ type: "snapshot", snapshot: routeSnapshot });
    expect(routeSnapshot.boardTargets.edges).toEqual(
      [...legalRoadEdges(room.game!, playerId), ...legalShipEdges(room.game!, playerId)],
    );
    for (const edgeId of routeSnapshot.boardTargets.edges) {
      expect(room.game!.board.edges.find(edge => edge.id === edgeId)!.vertexIds.every(id => nodes.includes(id))).toBe(true);
    }
  });

  test("hosts offer revealed-land nodes alongside fog and both route kinds after direct placement", () => {
    const room = new HostRoom("secret");
    for (let index = 0; index < 3; index++) {
      room.join(`phone-${index + 1}`, { type: "join", secret: "secret", name: profiles[index]!.name });
      room.admit(`phone-${index + 1}`);
    }
    room.setVariant("foggy-world");
    room.start();
    const playerId = room.game!.activePlayerId;
    const land = room.game!.board.tiles[0]!;
    land.terrain = "wood";
    land.number = 5;
    const away = room.game!.board.vertices.find(vertex => !land.vertexIds.includes(vertex.id) &&
      room.game!.board.edges.filter(edge => vertex.edgeIds.includes(edge.id))
        .every(edge => edge.vertexIds.every(id => !land.vertexIds.includes(id))))!;
    away.building = { playerId, kind: "settlement" };
    room.game!.setupIndex = room.game!.players.length;
    const targets = room.snapshot().boardTargets;
    expect(targets.vertices.toSorted()).toEqual(land.vertexIds.toSorted());
    expect(targets.tiles).not.toContain(land.id);
    expect(targets.tiles.length).toBeGreaterThan(0);
    const vertexId = targets.vertices.find(id => room.game!.board.vertices.find(vertex => vertex.id === id)!.tileIds.length > 1)!;
    room.performBoard({ type: "place-settlement", vertexId });
    expect(room.game!.phase).toEqual({ type: "setup-road", vertexId });
    const routeTargets = room.snapshot().boardTargets.edges;
    expect(routeTargets).toEqual(expect.arrayContaining(legalRoadEdges(room.game!, playerId)));
    expect(routeTargets).toEqual(expect.arrayContaining(legalShipEdges(room.game!, playerId)));
    for (const kind of ["road", "ship"] as const) {
      room.selectBuild(kind);
      const snapshot = room.snapshot(playerId.replace("player-", "phone-"));
      expect(snapshot.boardTargets.edges).toEqual((kind === "ship" ? legalShipEdges : legalRoadEdges)(room.game!, playerId));
      expect(snapshot.boardTargets.edges.length).toBeGreaterThan(0);
      expect(parseServerMessage({ type: "snapshot", snapshot })).toEqual({ type: "snapshot", snapshot });
    }
  });

  test("three computers finish a legal foggy world game at twelve points", () => {
    const random = randomFromSeed(3);
    let state = createGame(profiles.slice(0, 3).map(profile => ({ ...profile, control: "computer" })), random, undefined, "foggy-world");
    let actions = 0;
    let setupPlacements = 0;
    while (!state.winnerId && actions < 10000) {
      const decision = state.players.map(player => ({ playerId: player.id, action: chooseComputerAction(state, player.id) }))
        .find(decision => decision.action);
      const playerId = decision!.playerId;
      const action = decision!.action;
      expect(action).not.toBeNull();
      if (!action) break;
      if (action.type === "place-settlement" &&
        (state.phase.type === "setup-settlement" || state.phase.type === "setup-reveal")) setupPlacements++;
      state = applyAction(state, playerId, action, random);
      assertConservation(state);
      actions++;
    }
    expect(state.winnerId).not.toBeNull();
    expect(setupPlacements).toBeGreaterThanOrEqual(6);
    expect(getScore(state, state.winnerId!).total).toBeGreaterThanOrEqual(12);
  }, 60000);
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

  test("an eight-piece mixed route joins five roads only through an own settlement or city", () => {
    const state = createGame(profiles.slice(0, 3), randomFromSeed(1), createBoard(seededRandom("6SMHDES6"), "fog-islands"));
    const playerId = state.activePlayerId;
    state.phase = { type: "actions" };
    const path = [50, 53, 54, 96, 98, 97, 74, 71, 92, 32, 31, 99, 101, 65].map(index => `vertex-${index}`);
    for (let index = 0; index < path.length - 1; index++) {
      const edge = state.board.edges.find(edge => edge.vertexIds.includes(path[index]!) && edge.vertexIds.includes(path[index + 1]!))!;
      expect(edge).toBeDefined();
      edge.playerId = playerId;
      edge.kind = index === 6 || index === 7 ? "ship" : "road";
    }
    state.board.vertices.find(vertex => vertex.id === path[6])!.building = { playerId, kind: "settlement" };
    const junction = state.board.vertices.find(vertex => vertex.id === path[8])!;
    expect(getLongestRoadLength(state, playerId)).toBe(8);
    expect(publicGame(state, [], "mixed-route").players.find(player => player.id === playerId)!.longestRoad).toBe(8);

    for (const kind of ["settlement", "city"] as const) {
      const joined = structuredClone(state);
      joined.board.vertices.find(vertex => vertex.id === junction.id)!.building = { playerId, kind };
      const awarded = applyAction(joined, playerId, { type: "end-turn" });
      expect(getLongestRoadLength(awarded, playerId)).toBe(13);
      expect(awarded.awards.longestRoad).toBe(playerId);
      expect(getScore(awarded, playerId).longestRoad).toBe(2);
      const published = publicGame(awarded, [], "mixed-route");
      expect(published.players.find(player => player.id === playerId)!.longestRoad).toBe(13);
      expect(published.awards.longestRoad).toBe(playerId);
    }

    junction.building = { playerId: state.players.find(player => player.id !== playerId)!.id, kind: "settlement" };
    expect(getLongestRoadLength(state, playerId)).toBe(8);
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
