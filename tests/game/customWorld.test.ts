import { describe, expect, test } from "bun:test";
import { createBoard, seededRandom } from "../../src/game/board";
import { chooseComputerAction } from "../../src/game/computer";
import {
  applyAction, COSTS, createGame, getLongestRoadLength, getScore, hasLegalSabotageTarget, legalSabotageEdges,
  legalSabotageVertices, legalSettlementVertices, legalSetupRevealTiles, RESOURCES,
} from "../../src/game/engine";
import {
  CUSTOM_MAP_COUNT_FIELDS, DEFAULT_CUSTOM_MAP_CONFIG, isCustomMapConfig,
  isCustomMapConfigDraft, type CustomMapConfig, type Player,
} from "../../src/game/types";
import type { GameState } from "../../src/game/types";
import { HostRoom } from "../../src/multiplayer/state";
import { parseServerMessage } from "../../src/multiplayer/protocol";

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
];

const visibleConfig: CustomMapConfig = {
  wood: 5, brick: 3, wool: 5, grain: 5, ore: 3, gold: 1, desert: 1, sea: 19, fog: false,
};

function configWith(overrides: Partial<CustomMapConfig>): CustomMapConfig {
  return { ...DEFAULT_CUSTOM_MAP_CONFIG, ...overrides };
}

function terrainCounts(tiles: { terrain: string }[]): Record<string, number> {
  return tiles.reduce<Record<string, number>>((counts, tile) => {
    counts[tile.terrain] = (counts[tile.terrain] ?? 0) + 1;
    return counts;
  }, {});
}

function landIsConnected(board: ReturnType<typeof createBoard>): boolean {
  const land = board.tiles.filter(tile => tile.terrain !== "sea");
  const visited = new Set([land[0]!.id]);
  const pending = [land[0]!];
  while (pending.length > 0) {
    const tile = pending.pop()!;
    for (const other of land) {
      if (visited.has(other.id)) continue;
      if (tile.vertexIds.filter(id => other.vertexIds.includes(id)).length === 2) {
        visited.add(other.id);
        pending.push(other);
      }
    }
  }
  return visited.size === land.length;
}

describe("Custom World configuration validation", () => {
  test("accepts the default mix and rejects drafts, overflows, and land-poor setups", () => {
    expect(isCustomMapConfig(DEFAULT_CUSTOM_MAP_CONFIG)).toBe(true);
    expect(isCustomMapConfigDraft(DEFAULT_CUSTOM_MAP_CONFIG)).toBe(true);
    expect(isCustomMapConfig(configWith({ wood: 5 }))).toBe(false);
    expect(isCustomMapConfigDraft(configWith({ wood: 5 }))).toBe(true);
    expect(isCustomMapConfigDraft(configWith({ wood: 7 }))).toBe(false);
    expect(isCustomMapConfig(configWith({ sea: 42, wood: 0, brick: 0, wool: 0, grain: 0, ore: 0, gold: 0, desert: 0 }))).toBe(false);
    expect(isCustomMapConfig({ ...visibleConfig, fog: "yes" as unknown as boolean })).toBe(false);
    expect(isCustomMapConfig({ ...visibleConfig, sabotage: true })).toBe(true);
    expect(isCustomMapConfig({ ...visibleConfig, sabotage: false })).toBe(true);
    expect(isCustomMapConfig({ ...visibleConfig, sabotage: "yes" as unknown as boolean })).toBe(false);
    expect(isCustomMapConfig({ ...visibleConfig, sabotage: 2 as unknown as boolean })).toBe(false);
    expect(isCustomMapConfig({ wood: 1 } as unknown as CustomMapConfig)).toBe(false);
  });

  test("createBoard and createGame require a playable configuration", () => {
    expect(() => createBoard(randomFromSeed(1), "custom-world")).toThrow("Set up the Custom World map before starting the game.");
    expect(() => createBoard(randomFromSeed(1), "custom-world", configWith({ wood: 5 })))
      .toThrow("Set up the Custom World map before starting the game.");
    expect(() => createGame(profiles, randomFromSeed(1), undefined, "custom-world"))
      .toThrow("Set up the Custom World map before starting the game.");
    expect(() => createGame(profiles, randomFromSeed(1), undefined, "custom-world", 12, configWith({ wood: 5 })))
      .toThrow("Set up the Custom World map before starting the game.");
  });
});

describe("Custom World visible board", () => {
  test("grows one connected island with exactly the configured terrain", () => {
    const board = createBoard(randomFromSeed(7), "custom-world", visibleConfig);
    expect(board.variant).toBe("custom-world");
    expect(board.fogWorld).toBeUndefined();
    expect(board.tiles).toHaveLength(42);
    expect(terrainCounts(board.tiles)).toEqual({
      wood: 5, brick: 3, wool: 5, grain: 5, ore: 3, gold: 1, desert: 1, sea: 19,
    });
    expect(landIsConnected(board)).toBe(true);
    expect(board.tiles.filter(tile => tile.terrain !== "sea").every(tile => tile.islandId === "main")).toBe(true);
    expect(board.tiles.some(tile => tile.terrain === "fog")).toBe(false);
    const producing = board.tiles.filter(tile => tile.terrain !== "sea" && tile.terrain !== "desert");
    expect(producing.every(tile => tile.number !== null)).toBe(true);
    const red = producing.filter(tile => tile.number === 6 || tile.number === 8);
    expect(red.length).toBeLessThanOrEqual(4);
    expect(red.every(tile => red.every(other => other === tile ||
      tile.vertexIds.filter(id => other.vertexIds.includes(id)).length !== 2))).toBe(true);
    expect(board.ports).toHaveLength(9);
  });

  test("supports edge mixes: minimum land, no desert, and a full-land frame", () => {
    const minimumLand = createBoard(randomFromSeed(2), "custom-world", configWith({
      wood: 0, brick: 0, wool: 0, grain: 0, ore: 0, gold: 8, desert: 0, sea: 34,
    }));
    expect(minimumLand.tiles.filter(tile => tile.terrain === "gold")).toHaveLength(8);
    const noDesert = createBoard(randomFromSeed(3), "custom-world", configWith({ desert: 0, wood: 7 }));
    expect(noDesert.tiles.some(tile => tile.terrain === "desert")).toBe(false);
    const fullLand = createBoard(randomFromSeed(4), "custom-world", configWith({
      wood: 8, brick: 6, wool: 8, grain: 8, ore: 6, gold: 2, desert: 4, sea: 0,
    }));
    expect(fullLand.tiles.filter(tile => tile.terrain === "sea")).toHaveLength(0);
    expect(landIsConnected(fullLand)).toBe(true);
  });

  test("cycles number tokens when the map has more producing hexes than the standard pool", () => {
    const dense = createBoard(randomFromSeed(5), "custom-world", configWith({
      wood: 10, brick: 8, wool: 10, grain: 6, ore: 4, gold: 2, desert: 2, sea: 0,
    }));
    const producing = dense.tiles.filter(tile => tile.terrain !== "sea" && tile.terrain !== "desert");
    expect(producing).toHaveLength(40);
    expect(producing.every(tile => tile.number !== null)).toBe(true);
  });

  test("the same map code and configuration rebuild the identical island", () => {
    const first = createBoard(seededRandom("23456789"), "custom-world", visibleConfig);
    const second = createBoard(seededRandom("23456789"), "custom-world", visibleConfig);
    expect(first).toEqual(second);
    const otherConfig = createBoard(seededRandom("23456789"), "custom-world", configWith({ wood: 4, brick: 6 }));
    expect(otherConfig.tiles.map(tile => tile.terrain)).not.toEqual(first.tiles.map(tile => tile.terrain));
  });

  test("games start with visible-land setup and a desert robber when present", () => {
    const state = createGame(profiles, randomFromSeed(6), undefined, "custom-world", 12, visibleConfig);
    expect(state.phase.type).toBe("setup-settlement");
    expect(state.board.tiles.find(tile => tile.id === state.robberTileId)?.terrain).toBe("desert");
    expect(legalSettlementVertices(state, state.activePlayerId).length).toBeGreaterThan(0);
  });

  test("desertless maps start with an off-board robber", () => {
    const state = createGame(profiles, randomFromSeed(6), undefined, "custom-world", 12, configWith({ desert: 0, wood: 7 }));
    expect(state.robberTileId).toBe("");
    expect(state.phase.type).toBe("setup-settlement");
  });
});

describe("Custom World fog board", () => {
  test("hides all 42 cells under fixed per-cell discoveries matching the configuration", () => {
    const config = configWith({ fog: true });
    const board = createBoard(randomFromSeed(8), "custom-world", config);
    expect(board.fogWorld).toBe(true);
    expect(board.tiles.every(tile => tile.terrain === "fog")).toBe(true);
    expect(board.tiles.filter(tile => tile.islandId === "main")).toHaveLength(19);
    expect(board.ports).toHaveLength(9);
    expect(board.ports.every(port => port.awaitingCoast === true)).toBe(true);
    expect(board.fogDiscoveryDeck).toBeUndefined();
    expect(Object.keys(board.fogDiscoveriesByTileId!)).toHaveLength(42);
    const deck = Object.values(board.fogDiscoveriesByTileId!);
    const counts = deck.reduce<Record<string, number>>((totals, discovery) => {
      totals[discovery.terrain] = (totals[discovery.terrain] ?? 0) + 1;
      return totals;
    }, {});
    for (const field of CUSTOM_MAP_COUNT_FIELDS) expect(counts[field]).toBe(config[field]);
    expect(deck.filter(discovery => discovery.terrain === "sea" || discovery.terrain === "desert")
      .every(discovery => discovery.number === null)).toBe(true);
    const producing = deck.filter(discovery => discovery.number !== null);
    expect(producing).toHaveLength(config.wood + config.brick + config.wool + config.grain + config.ore + config.gold);
    expect(createBoard(seededRandom("23456789"), "custom-world", config))
      .toEqual(createBoard(seededRandom("23456789"), "custom-world", config));
  });

  test("runs the fog setup flow with per-cell reveal rewards", () => {
    const config = configWith({ fog: true });
    let state = createGame(profiles, randomFromSeed(9), undefined, "custom-world", 12, config);
    expect(state.phase.type).toBe("setup-reveal");
    const playerId = state.activePlayerId;
    const tileId = legalSetupRevealTiles(state, playerId)[0]!;
    expect(tileId).toBeDefined();
    state = applyAction(state, playerId, { type: "reveal-tile", tileId });
    const discoveryTerrains: readonly string[] = ["wood", "brick", "wool", "grain", "ore", "gold", "desert", "sea"];
    const revealed = state.board.tiles.find(tile => tile.id === tileId)!;
    expect(discoveryTerrains).toContain(revealed.terrain);
    if (revealed.terrain === "sea") {
      expect(state.phase.type).toBe("setup-reveal");
    } else {
      expect(state.phase.type === "setup-settlement" || state.phase.type === "gold").toBe(true);
    }
  });
});

describe("Custom World computer games", () => {
  const playFullGame = (config: CustomMapConfig, seed: number): GameState => {
    const random = randomFromSeed(seed);
    let state = createGame(profiles.map(profile => ({ ...profile, control: "computer" })), random, undefined, "custom-world", 12, config);
    let actions = 0;
    while (!state.winnerId && actions < 10000) {
      const decision = state.players.map(player => ({ playerId: player.id, action: chooseComputerAction(state, player.id) }))
        .find(decision => decision.action);
      expect(decision).toBeDefined();
      if (!decision?.action) break;
      state = applyAction(state, decision.playerId, decision.action, random);
      actions++;
    }
    return state;
  };

  test("four computers finish a visible custom game", () => {
    const state = playFullGame(visibleConfig, 11);
    expect(state.winnerId).not.toBeNull();
    expect(getScore(state, state.winnerId!).total).toBeGreaterThanOrEqual(12);
    for (const resource of RESOURCES) {
      expect(state.bank[resource]).toBeGreaterThanOrEqual(0);
    }
  }, 30000);

  test("four computers finish a foggy custom game", () => {
    const state = playFullGame(configWith({ fog: true }), 12);
    expect(state.winnerId).not.toBeNull();
    expect(getScore(state, state.winnerId!).total).toBeGreaterThanOrEqual(12);
    expect(state.board.tiles.some(tile => tile.terrain !== "fog")).toBe(true);
    expect(state.board.tiles.some(tile => tile.terrain === "fog")).toBe(false);
    expect(state.board.fogDiscoveriesByTileId).toEqual({});
    expect(state.board.fogDiscoveryDeck).toEqual([]);
  }, 30000);
});

describe("Custom World lobby", () => {
  test("the host customizes the map, and drafts wait for all 42 tiles before starting", () => {
    const room = new HostRoom("custom-secret");
    room.setVariant("custom-world");
    expect(room.snapshot().variant).toBe("custom-world");
    expect(room.snapshot().victoryPointsToWin).toBe(12);
    expect(room.snapshot().customMapConfig).toEqual(DEFAULT_CUSTOM_MAP_CONFIG);
    room.setCustomMapConfig(visibleConfig);
    const snapshot = room.snapshot();
    expect(snapshot.customMapConfig).toEqual(visibleConfig);
    room.join("phone-1", { type: "join", secret: "custom-secret", name: "Robin" });
    room.admit("phone-1");
    const phoneSnapshot = room.snapshot("phone-1");
    expect(phoneSnapshot.customMapConfig).toEqual(visibleConfig);
    expect(parseServerMessage({ type: "snapshot", snapshot: phoneSnapshot })).toEqual({ type: "snapshot", snapshot: phoneSnapshot });
    room.addComputer();
    room.addComputer();
    room.addComputer();
    room.setCustomMapConfig(configWith({ wood: 5 }));
    expect(() => room.start()).toThrow("Set up the Custom World map before starting the game.");
    room.setCustomMapConfig(visibleConfig);
    room.start();
    expect(room.game!.variant).toBe("custom-world");
    expect(room.game!.board.tiles.filter(tile => tile.terrain === "wood")).toHaveLength(5);
    expect(() => room.setCustomMapConfig(configWith({ wood: 4 }))).toThrow("The map can only be customized in the lobby.");
  });

  test("switching away and back keeps the last playable configuration", () => {
    const room = new HostRoom("custom-secret");
    room.setVariant("custom-world");
    room.setCustomMapConfig(visibleConfig);
    room.setVariant("original");
    expect(room.snapshot().customMapConfig).toBeUndefined();
    room.setVariant("custom-world");
    const snapshot = room.snapshot();
    expect(snapshot.customMapConfig).toEqual(visibleConfig);
    expect(snapshot.previewBoard!.tiles.filter(tile => tile.terrain === "wool")).toHaveLength(5);
  });
});

describe("Custom World Sabotage build action", () => {
  function finishSetup(config: CustomMapConfig = configWith({ sabotage: true }), seed = 21): GameState {
    const random = randomFromSeed(seed);
    let state = createGame(profiles, random, undefined, "custom-world", 12, config);
    while (state.phase.type.startsWith("setup")) {
      const playerId = state.activePlayerId;
      if (state.phase.type === "setup-settlement") {
        state = applyAction(state, playerId, { type: "place-settlement", vertexId: legalSettlementVertices(state, playerId)[0]! }, random);
      } else if (state.phase.type === "setup-road") {
        const edgeId = state.board.edges.find(edge => !edge.playerId && edge.vertexIds.includes((state.phase as { type: "setup-road"; vertexId: string }).vertexId))!.id;
        state = applyAction(state, playerId, { type: "place-road", edgeId }, random);
      }
    }
    return state;
  }

  test("enables Sabotage in Custom World when configured and keeps the standard 25-card deck", () => {
    const defaultGame = createGame(profiles, randomFromSeed(1), undefined, "custom-world", 12, DEFAULT_CUSTOM_MAP_CONFIG);
    expect(defaultGame.sabotageEnabled).toBe(true);
    expect(defaultGame.developmentDeck).toHaveLength(25);

    const disabledGame = createGame(profiles, randomFromSeed(1), undefined, "custom-world", 12, configWith({ sabotage: false }));
    expect(disabledGame.sabotageEnabled).toBeUndefined();
    expect(disabledGame.developmentDeck).toHaveLength(25);

    const originalGame = createGame(profiles, randomFromSeed(1), undefined, "original");
    expect(originalGame.sabotageEnabled).toBeUndefined();
    expect(originalGame.developmentDeck).toHaveLength(25);
  });

  test("costs 1 of each resource during actions and destroys one opponent road or ship", () => {
    let state = finishSetup();
    const activeId = state.activePlayerId;
    const opponent = state.players.find(player => player.id !== activeId)!;
    const activePlayer = state.players.find(player => player.id === activeId)!;
    const opponentEdges = state.board.edges.filter(edge => edge.playerId === opponent.id);
    expect(opponentEdges.length).toBeGreaterThanOrEqual(2);
    opponentEdges[1]!.kind = "ship";
    const ownEdge = state.board.edges.find(edge => edge.playerId === activeId)!;

    // Cannot sabotage before rolling.
    activePlayer.resources = { ...COSTS.sabotage };
    expect(legalSabotageEdges(state, activeId)).toEqual([]);
    expect(() => applyAction(state, activeId, { type: "sabotage-route", edgeId: opponentEdges[0]!.id }))
      .toThrow("Choose an opponent's road or ship to destroy.");

    // Cannot sabotage without 1 of each resource.
    state.phase = { type: "actions" };
    activePlayer.resources = { wood: 1, brick: 1, wool: 1, grain: 1, ore: 0 };
    expect(() => applyAction(state, activeId, { type: "sabotage-route", edgeId: opponentEdges[0]!.id }))
      .toThrow("You do not have the resources required for this purchase.");

    // With 1 of each resource, cannot target own road.
    activePlayer.resources = { ...COSTS.sabotage };
    expect(legalSabotageEdges(state, activeId)).not.toContain(ownEdge.id);
    expect(() => applyAction(state, activeId, { type: "sabotage-route", edgeId: ownEdge.id }))
      .toThrow("Choose an opponent's road or ship to destroy.");

    // Destroying an opponent's road spends 1 of each resource and stays in actions (no second free road).
    state = applyAction(state, activeId, { type: "sabotage-route", edgeId: opponentEdges[0]!.id });
    expect(state.players.find(player => player.id === activeId)!.resources).toEqual({ wood: 0, brick: 0, wool: 0, grain: 0, ore: 0 });
    expect(state.board.edges.find(edge => edge.id === opponentEdges[0]!.id)!.playerId).toBeNull();
    expect(state.phase).toEqual({ type: "actions" });
    expect(() => applyAction(state, activeId, { type: "sabotage-route", edgeId: opponentEdges[1]!.id }))
      .toThrow("You do not have the resources required for this purchase.");

    // Paying another 1 of each resource can destroy an opponent's ship.
    state.players.find(player => player.id === activeId)!.resources = { ...COSTS.sabotage };
    state = applyAction(state, activeId, { type: "sabotage-route", edgeId: opponentEdges[1]!.id });
    expect(state.board.edges.find(edge => edge.id === opponentEdges[1]!.id)!.playerId).toBeNull();
    expect(state.board.edges.find(edge => edge.id === opponentEdges[1]!.id)!.kind).toBeUndefined();
    expect(state.phase).toEqual({ type: "actions" });
  });

  test("destroys a non-final settlement, protects an opponent's last building, and reduces a city even if last", () => {
    let state = finishSetup();
    const activeId = state.activePlayerId;
    const [firstOpponent, secondOpponent] = state.players.filter(player => player.id !== activeId) as [Player, Player];

    // Reduce firstOpponent to 1 settlement (protected) and secondOpponent to 1 city (targetable).
    const firstBuildings = state.board.vertices.filter(vertex => vertex.building?.playerId === firstOpponent.id);
    firstBuildings[1]!.building = null;
    const secondBuildings = state.board.vertices.filter(vertex => vertex.building?.playerId === secondOpponent.id);
    secondBuildings[1]!.building = null;
    secondBuildings[0]!.building = { playerId: secondOpponent.id, kind: "city" };

    state.phase = { type: "actions" };
    state.players.find(player => player.id === activeId)!.resources = { ...COSTS.sabotage };
    const legalBuildings = legalSabotageVertices(state, activeId);
    expect(legalBuildings).not.toContain(firstBuildings[0]!.id);
    expect(legalBuildings).toContain(secondBuildings[0]!.id);
    expect(() => applyAction(state, activeId, { type: "sabotage-building", vertexId: firstBuildings[0]!.id }))
      .toThrow("Choose an opponent's city or non-final settlement to sabotage.");

    // Reducing secondOpponent's city to a settlement spends 1 of each resource and lowers score by 1.
    const scoreBefore = getScore(state, secondOpponent.id).public;
    state = applyAction(state, activeId, { type: "sabotage-building", vertexId: secondBuildings[0]!.id });
    expect(state.players.find(player => player.id === activeId)!.resources).toEqual({ wood: 0, brick: 0, wool: 0, grain: 0, ore: 0 });
    expect(state.board.vertices.find(vertex => vertex.id === secondBuildings[0]!.id)!.building)
      .toEqual({ playerId: secondOpponent.id, kind: "settlement" });
    expect(getScore(state, secondOpponent.id).public).toBe(scoreBefore - 1);
    expect(state.phase).toEqual({ type: "actions" });

    // Destroying a non-final settlement removes it completely and stays in actions.
    let settlementState = finishSetup();
    const actor = settlementState.activePlayerId;
    const victim = settlementState.players.find(player => player.id !== actor)!;
    const victimSettlement = settlementState.board.vertices.find(vertex => vertex.building?.playerId === victim.id)!;
    settlementState.phase = { type: "actions" };
    settlementState.players.find(player => player.id === actor)!.resources = { ...COSTS.sabotage };
    expect(legalSabotageVertices(settlementState, actor)).toContain(victimSettlement.id);
    settlementState = applyAction(settlementState, actor, { type: "sabotage-building", vertexId: victimSettlement.id });
    expect(settlementState.board.vertices.find(vertex => vertex.id === victimSettlement.id)!.building).toBeNull();
    expect(settlementState.phase).toEqual({ type: "actions" });
  });

  test("rejects Sabotage when disabled or with no targets, and finishes immediately after the last opponent route", () => {
    const disabledState = finishSetup(configWith({ sabotage: false }));
    disabledState.phase = { type: "actions" };
    const disabledActor = disabledState.activePlayerId;
    disabledState.players.find(player => player.id === disabledActor)!.resources = { ...COSTS.sabotage };
    expect(legalSabotageEdges(disabledState, disabledActor)).toEqual([]);
    expect(legalSabotageVertices(disabledState, disabledActor)).toEqual([]);

    const state = finishSetup();
    state.phase = { type: "actions" };
    const activeId = state.activePlayerId;
    for (const edge of state.board.edges) {
      if (edge.playerId && edge.playerId !== activeId) edge.playerId = null;
    }
    // Leave each opponent with only 1 settlement (protected) and 0 routes.
    for (const opponent of state.players.filter(player => player.id !== activeId)) {
      const buildings = state.board.vertices.filter(vertex => vertex.building?.playerId === opponent.id);
      for (const extra of buildings.slice(1)) extra.building = null;
    }
    expect(hasLegalSabotageTarget(state, activeId)).toBe(false);

    // Give one opponent a single road: destroying it finishes immediately without entering sabotage follow-up phase.
    const opponent = state.players.find(player => player.id !== activeId)!;
    const singleEdge = state.board.edges.find(edge => !edge.playerId)!;
    singleEdge.playerId = opponent.id;
    state.players.find(player => player.id === activeId)!.resources = { ...COSTS.sabotage };
    const oneRouteState = applyAction(state, activeId, { type: "sabotage-route", edgeId: singleEdge.id });
    expect(oneRouteState.phase).toEqual({ type: "actions" });
  });

  test("recalculates Longest Route when Sabotage breaks the holder's road", () => {
    let state = finishSetup();
    const activeId = state.activePlayerId;
    const opponent = state.players.find(player => player.id !== activeId)!;
    // Build a continuous 5-edge chain for opponent so they hold Longest Route.
    const startEdge = state.board.edges.find(edge => edge.playerId === opponent.id)!;
    const chain = [startEdge];
    let currentVertexId = startEdge.vertexIds[1];
    while (chain.length < 5) {
      const next = state.board.edges.find(edge =>
        !chain.includes(edge) && !edge.playerId && edge.vertexIds.includes(currentVertexId));
      if (!next) break;
      next.playerId = opponent.id;
      chain.push(next);
      currentVertexId = next.vertexIds[0] === currentVertexId ? next.vertexIds[1] : next.vertexIds[0];
    }
    expect(getLongestRoadLength(state, opponent.id)).toBeGreaterThanOrEqual(5);
    state.awards.longestRoad = opponent.id;
    state.phase = { type: "actions" };
    state.players.find(player => player.id === activeId)!.resources = { ...COSTS.sabotage };
    state = applyAction(state, activeId, { type: "sabotage-route", edgeId: chain[2]!.id });
    expect(getLongestRoadLength(state, opponent.id)).toBeLessThan(5);
    expect(state.awards.longestRoad).toBeNull();
  });

  test("computers play and finish a Custom World game with Sabotage enabled", () => {
    const random = randomFromSeed(19);
    let state = createGame(
      profiles.map(profile => ({ ...profile, control: "computer" })),
      random,
      undefined,
      "custom-world",
      12,
      configWith({ sabotage: true }),
    );
    let actions = 0;
    while (!state.winnerId && actions < 10000) {
      const decision = state.players.map(player => ({ playerId: player.id, action: chooseComputerAction(state, player.id) }))
        .find(decision => decision.action);
      expect(decision).toBeDefined();
      if (!decision?.action) break;
      state = applyAction(state, decision.playerId, decision.action, random);
      actions++;
    }
    expect(state.winnerId).not.toBeNull();
    expect(getScore(state, state.winnerId!).total).toBeGreaterThanOrEqual(12);
  }, 30000);

  test("multiplayer host validates and resolves Sabotage build mode on the shared board", () => {
    const room = new HostRoom("sabotage-secret");
    room.setVariant("custom-world");
    room.setCustomMapConfig(configWith({ sabotage: true }));
    room.join("phone-1", { type: "join", secret: "sabotage-secret", name: "Alex" });
    room.admit("phone-1");
    room.addComputer();
    room.addComputer();
    room.start();
    // Advance past setup using scripted placements.
    while (room.game!.phase.type.startsWith("setup")) {
      const current = room.game!.players.find(player => player.id === room.game!.activePlayerId)!;
      if (current.control === "computer") {
        room.performComputer();
      } else if (room.game!.phase.type === "setup-settlement") {
        room.performBoard({ type: "place-settlement", vertexId: room.snapshot().boardTargets.vertices[0]! });
      } else if (room.game!.phase.type === "setup-road") {
        room.performBoard({ type: "place-road", edgeId: room.snapshot().boardTargets.edges[0]! });
      }
    }
    const humanId = room.snapshot("phone-1").playerId!;
    room.game!.activePlayerId = humanId;
    room.game!.phase = { type: "actions" };
    room.game!.turnNumber = 2;
    room.game!.players.find(player => player.id === humanId)!.resources = { ...COSTS.sabotage };
    room.game!.bank = { wood: 18, brick: 18, wool: 18, grain: 18, ore: 18 };
    room.version++;

    // Phone selects Sabotage build mode.
    const selectResult = room.command("phone-1", {
      type: "select-build", requestId: "req-select", version: room.version, piece: "sabotage",
    });
    expect(selectResult.error).toBeNull();
    const sabotageSnapshot = room.snapshot("phone-1");
    expect(sabotageSnapshot.buildMode).toBe("sabotage");
    expect(sabotageSnapshot.game!.sabotageEnabled).toBe(true);
    expect(sabotageSnapshot.boardTargets.edges.length).toBeGreaterThan(0);
    expect(sabotageSnapshot.boardTargets.vertices.length).toBeGreaterThan(0);
    expect(parseServerMessage({ type: "snapshot", snapshot: sabotageSnapshot })).toEqual({ type: "snapshot", snapshot: sabotageSnapshot });

    // Phone cannot execute board sabotage directly.
    const phoneSabotage = room.command("phone-1", {
      type: "action", requestId: "req-illegal", version: room.version,
      action: { type: "sabotage-building", vertexId: sabotageSnapshot.boardTargets.vertices[0]! },
    });
    expect(phoneSabotage.error).not.toBeNull();

    // Shared board resolves Sabotage building destruction and spends 1 of each resource.
    const targetVertexId = sabotageSnapshot.boardTargets.vertices[0]!;
    room.performBoard({ type: "sabotage-building", vertexId: targetVertexId });
    expect(room.game!.board.vertices.find(vertex => vertex.id === targetVertexId)!.building).toBeNull();
    expect(room.game!.players.find(player => player.id === humanId)!.resources).toEqual({ wood: 0, brick: 0, wool: 0, grain: 0, ore: 0 });
    expect(room.game!.players.find(player => player.id === humanId)!.sabotagesPlayed).toBe(1);
    expect(room.game!.phase).toEqual({ type: "actions" });
    expect(room.buildMode).toBeNull();

    const afterSabotageSnapshot = room.snapshot("phone-1");
    expect(afterSabotageSnapshot.game!.players.find(player => player.id === humanId)!.sabotagesPlayed).toBe(1);
    expect(afterSabotageSnapshot.privatePlayer!.sabotagesPlayed).toBe(1);
    expect(afterSabotageSnapshot.game!.awards.masterSaboteur).toBeNull();
    expect(parseServerMessage({ type: "snapshot", snapshot: afterSabotageSnapshot })).toEqual({ type: "snapshot", snapshot: afterSabotageSnapshot });
  });

  test("tracks sabotagesPlayed and awards Master Saboteur (+2 VP) at 3 sabotages with tie and transfer rules", () => {
    let state = finishSetup();
    const firstId = state.activePlayerId;
    const secondId = state.players.find(player => player.id !== firstId)!.id;
    const firstPlayer = () => state.players.find(player => player.id === firstId)!;
    const secondPlayer = () => state.players.find(player => player.id === secondId)!;

    expect(firstPlayer().sabotagesPlayed).toBe(0);
    expect(state.awards.masterSaboteur).toBeNull();
    expect(getScore(state, firstId).masterSaboteur).toBe(0);

    // Ensure plenty of opponent targets exist for 7 sabotages total.
    const thirdId = state.players.find(player => player.id !== firstId && player.id !== secondId)!.id;
    for (const edge of state.board.edges.filter(edge => !edge.playerId).slice(0, 8)) {
      edge.playerId = thirdId;
    }

    state.phase = { type: "actions" };
    const scoreBefore = getScore(state, firstId).public;

    // 1st and 2nd sabotages increment count without awarding Master Saboteur.
    for (let step = 1; step <= 2; step++) {
      firstPlayer().resources = { ...COSTS.sabotage };
      const targetEdgeId = legalSabotageEdges(state, firstId)[0]!;
      state = applyAction(state, firstId, { type: "sabotage-route", edgeId: targetEdgeId });
      expect(firstPlayer().sabotagesPlayed).toBe(step);
      expect(state.awards.masterSaboteur).toBeNull();
      expect(getScore(state, firstId).public).toBe(scoreBefore);
    }

    // 3rd sabotage claims Master Saboteur (+2 VP).
    firstPlayer().resources = { ...COSTS.sabotage };
    state = applyAction(state, firstId, { type: "sabotage-route", edgeId: legalSabotageEdges(state, firstId)[0]! });
    expect(firstPlayer().sabotagesPlayed).toBe(3);
    expect(state.awards.masterSaboteur).toBe(firstId);
    expect(getScore(state, firstId).masterSaboteur).toBe(2);
    expect(getScore(state, firstId).public).toBe(scoreBefore + 2);
    expect(state.log.some(entry => entry.key === "{player} takes {award}." && entry.parameters?.award === "Master Saboteur")).toBe(true);

    // Second player reaching 3 sabotages ties and does NOT take the award.
    state.activePlayerId = secondId;
    secondPlayer().sabotagesPlayed = 2;
    secondPlayer().resources = { ...COSTS.sabotage };
    state = applyAction(state, secondId, { type: "sabotage-route", edgeId: legalSabotageEdges(state, secondId)[0]! });
    expect(secondPlayer().sabotagesPlayed).toBe(3);
    expect(state.awards.masterSaboteur).toBe(firstId);
    expect(getScore(state, secondId).masterSaboteur).toBe(0);

    // Second player reaching 4 sabotages surpasses and steals Master Saboteur (+2 VP).
    const secondScoreBefore = getScore(state, secondId).public;
    secondPlayer().resources = { ...COSTS.sabotage };
    state = applyAction(state, secondId, { type: "sabotage-route", edgeId: legalSabotageEdges(state, secondId)[0]! });
    expect(secondPlayer().sabotagesPlayed).toBe(4);
    expect(state.awards.masterSaboteur).toBe(secondId);
    expect(getScore(state, firstId).masterSaboteur).toBe(0);
    expect(getScore(state, secondId).masterSaboteur).toBe(2);
    expect(getScore(state, secondId).public).toBe(secondScoreBefore + 2);
  });

  test("claiming Master Saboteur on the 3rd sabotage can immediately win the game", () => {
    let state = finishSetup();
    const activeId = state.activePlayerId;
    const activePlayer = state.players.find(player => player.id === activeId)!;
    state.victoryPointsToWin = 4; // Player has 2 settlements (2 VP) -> +2 VP from Master Saboteur wins.
    state.phase = { type: "actions" };
    activePlayer.sabotagesPlayed = 2;
    activePlayer.resources = { ...COSTS.sabotage };
    state = applyAction(state, activeId, { type: "sabotage-route", edgeId: legalSabotageEdges(state, activeId)[0]! });
    expect(state.awards.masterSaboteur).toBe(activeId);
    expect(getScore(state, activeId).total).toBe(4);
    expect(state.winnerId).toBe(activeId);
    expect(state.phase).toEqual({ type: "finished" });
  });
});
