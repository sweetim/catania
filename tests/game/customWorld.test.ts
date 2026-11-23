import { describe, expect, test } from "bun:test";
import { createBoard, seededRandom } from "../../src/game/board";
import { chooseComputerAction } from "../../src/game/computer";
import {
  applyAction, createGame, getLongestRoadLength, getScore, hasLegalSabotageTarget, legalSabotageEdges,
  legalSabotageVertices, legalSettlementVertices, legalSetupRevealTiles, RESOURCES,
} from "../../src/game/engine";
import {
  CUSTOM_MAP_COUNT_FIELDS, CUSTOM_SABOTAGE_CARDS_MAXIMUM, DEFAULT_CUSTOM_MAP_CONFIG, isCustomMapConfig,
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
    expect(isCustomMapConfig({ ...visibleConfig, sabotageCards: 0 })).toBe(true);
    expect(isCustomMapConfig({ ...visibleConfig, sabotageCards: CUSTOM_SABOTAGE_CARDS_MAXIMUM })).toBe(true);
    expect(isCustomMapConfig({ ...visibleConfig, sabotageCards: -1 })).toBe(false);
    expect(isCustomMapConfig({ ...visibleConfig, sabotageCards: CUSTOM_SABOTAGE_CARDS_MAXIMUM + 1 })).toBe(false);
    expect(isCustomMapConfig({ ...visibleConfig, sabotageCards: 1.5 })).toBe(false);
    expect(isCustomMapConfig({ ...visibleConfig, sabotageCards: "2" as unknown as number })).toBe(false);
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

describe("Custom World Sabotage development card", () => {
  function finishSetup(config: CustomMapConfig = configWith({ sabotageCards: 2 }), seed = 21): GameState {
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

  test("adds the configured Sabotage cards to the Custom World deck with unique valid IDs", () => {
    const defaultGame = createGame(profiles, randomFromSeed(1), undefined, "custom-world", 12, DEFAULT_CUSTOM_MAP_CONFIG);
    expect(defaultGame.developmentDeck).toHaveLength(27);
    expect(defaultGame.developmentDeck.filter(kind => kind === "sabotage")).toHaveLength(2);

    const zeroGame = createGame(profiles, randomFromSeed(1), undefined, "custom-world", 12, configWith({ sabotageCards: 0 }));
    expect(zeroGame.developmentDeck).toHaveLength(25);
    expect(zeroGame.developmentDeck.filter(kind => kind === "sabotage")).toHaveLength(0);

    const originalGame = createGame(profiles, randomFromSeed(1), undefined, "original");
    expect(originalGame.developmentDeck).toHaveLength(25);
    expect(originalGame.developmentDeck.filter(kind => kind === "sabotage")).toHaveLength(0);

    let maxGame = finishSetup(configWith({ sabotageCards: CUSTOM_SABOTAGE_CARDS_MAXIMUM }), 22);
    expect(maxGame.developmentDeck).toHaveLength(31);
    maxGame.phase = { type: "actions" };
    const buyerId = maxGame.activePlayerId;
    for (let index = 0; index < 31; index++) {
      const buyer = maxGame.players.find(player => player.id === buyerId)!;
      buyer.resources = { wood: 0, brick: 0, wool: 1, grain: 1, ore: 1 };
      maxGame = applyAction(maxGame, buyerId, { type: "buy-development" });
    }
    const ids = maxGame.players.find(player => player.id === buyerId)!.developmentCards.map(card => card.id);
    expect(ids).toHaveLength(31);
    expect(new Set(ids).size).toBe(31);
    expect(ids.every(id => /^development-[0-9]{1,3}$/.test(id))).toBe(true);
  });

  test("follows standard timing rules and destroys up to two opponent roads or ships", () => {
    let state = finishSetup();
    const activeId = state.activePlayerId;
    const opponent = state.players.find(player => player.id !== activeId)!;
    const activePlayer = state.players.find(player => player.id === activeId)!;

    // Cannot play on the turn it was purchased.
    activePlayer.developmentCards.push({ id: "development-99", kind: "sabotage", purchasedTurn: state.turnNumber });
    expect(() => applyAction(state, activeId, { type: "play-development", cardId: "development-99" }))
      .toThrow("You cannot play a development card bought this turn.");

    // Playable before rolling when bought on an earlier turn; turn it into a mature card.
    activePlayer.developmentCards = [{ id: "development-99", kind: "sabotage", purchasedTurn: 0 }];
    // Convert one of opponent's roads into a ship so both road and ship destruction are verified.
    const opponentEdges = state.board.edges.filter(edge => edge.playerId === opponent.id);
    expect(opponentEdges.length).toBeGreaterThanOrEqual(2);
    opponentEdges[1]!.kind = "ship";
    const ownEdge = state.board.edges.find(edge => edge.playerId === activeId)!;

    state = applyAction(state, activeId, { type: "play-development", cardId: "development-99" });
    expect(state.phase).toEqual({ type: "sabotage", remainingRoutes: 2, canTargetBuilding: true, returnPhase: "roll" });
    expect(state.developmentPlayed).toBe(true);
    expect(legalSabotageEdges(state, activeId)).not.toContain(ownEdge.id);
    expect(() => applyAction(state, activeId, { type: "sabotage-route", edgeId: ownEdge.id }))
      .toThrow("Choose an opponent's road or ship to destroy.");

    // Destroy opponent's road first; second pick is locked to routes only.
    state = applyAction(state, activeId, { type: "sabotage-route", edgeId: opponentEdges[0]!.id });
    expect(state.board.edges.find(edge => edge.id === opponentEdges[0]!.id)!.playerId).toBeNull();
    expect(state.phase).toEqual({ type: "sabotage", remainingRoutes: 1, canTargetBuilding: false, returnPhase: "roll" });
    expect(legalSabotageVertices(state, activeId)).toEqual([]);
    const opponentSettlement = state.board.vertices.find(vertex => vertex.building?.playerId === opponent.id)!;
    expect(() => applyAction(state, activeId, { type: "sabotage-building", vertexId: opponentSettlement.id }))
      .toThrow("Choose an opponent's city or non-final settlement to sabotage.");

    // Destroy opponent's ship second; returns to pre-roll phase.
    state = applyAction(state, activeId, { type: "sabotage-route", edgeId: opponentEdges[1]!.id });
    expect(state.board.edges.find(edge => edge.id === opponentEdges[1]!.id)!.playerId).toBeNull();
    expect(state.board.edges.find(edge => edge.id === opponentEdges[1]!.id)!.kind).toBeUndefined();
    expect(state.phase).toEqual({ type: "roll" });
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
    state.players.find(player => player.id === activeId)!.developmentCards = [
      { id: "development-90", kind: "sabotage", purchasedTurn: 0 },
    ];
    state = applyAction(state, activeId, { type: "play-development", cardId: "development-90" });
    const legalBuildings = legalSabotageVertices(state, activeId);
    expect(legalBuildings).not.toContain(firstBuildings[0]!.id);
    expect(legalBuildings).toContain(secondBuildings[0]!.id);
    expect(() => applyAction(state, activeId, { type: "sabotage-building", vertexId: firstBuildings[0]!.id }))
      .toThrow("Choose an opponent's city or non-final settlement to sabotage.");

    // Reducing secondOpponent's city to a settlement ends the sabotage phase and lowers score by 1.
    const scoreBefore = getScore(state, secondOpponent.id).public;
    state = applyAction(state, activeId, { type: "sabotage-building", vertexId: secondBuildings[0]!.id });
    expect(state.board.vertices.find(vertex => vertex.id === secondBuildings[0]!.id)!.building)
      .toEqual({ playerId: secondOpponent.id, kind: "settlement" });
    expect(getScore(state, secondOpponent.id).public).toBe(scoreBefore - 1);
    expect(state.phase).toEqual({ type: "actions" });

    // Destroying a non-final settlement removes it completely and ends the sabotage phase.
    let settlementState = finishSetup();
    const actor = settlementState.activePlayerId;
    const victim = settlementState.players.find(player => player.id !== actor)!;
    const victimSettlement = settlementState.board.vertices.find(vertex => vertex.building?.playerId === victim.id)!;
    settlementState.phase = { type: "actions" };
    settlementState.players.find(player => player.id === actor)!.developmentCards = [
      { id: "development-91", kind: "sabotage", purchasedTurn: 0 },
    ];
    settlementState = applyAction(settlementState, actor, { type: "play-development", cardId: "development-91" });
    expect(legalSabotageVertices(settlementState, actor)).toContain(victimSettlement.id);
    settlementState = applyAction(settlementState, actor, { type: "sabotage-building", vertexId: victimSettlement.id });
    expect(settlementState.board.vertices.find(vertex => vertex.id === victimSettlement.id)!.building).toBeNull();
    expect(settlementState.phase).toEqual({ type: "actions" });
  });

  test("rejects Sabotage with no legal targets and ends early after the last opponent route", () => {
    const state = finishSetup();
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
    state.players.find(player => player.id === activeId)!.developmentCards = [
      { id: "development-92", kind: "sabotage", purchasedTurn: 0 },
    ];
    expect(() => applyAction(state, activeId, { type: "play-development", cardId: "development-92" }))
      .toThrow("There are no opponent pieces available to sabotage.");

    // Give one opponent a single road: playing Sabotage has canTargetBuilding=false and finishes after destroying that 1 road.
    const opponent = state.players.find(player => player.id !== activeId)!;
    const singleEdge = state.board.edges.find(edge => !edge.playerId)!;
    singleEdge.playerId = opponent.id;
    let oneRouteState = applyAction(state, activeId, { type: "play-development", cardId: "development-92" });
    expect(oneRouteState.phase).toEqual({ type: "sabotage", remainingRoutes: 2, canTargetBuilding: false, returnPhase: "roll" });
    oneRouteState = applyAction(oneRouteState, activeId, { type: "sabotage-route", edgeId: singleEdge.id });
    expect(oneRouteState.phase).toEqual({ type: "roll" });
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
    state.players.find(player => player.id === activeId)!.developmentCards = [
      { id: "development-93", kind: "sabotage", purchasedTurn: 0 },
    ];
    state = applyAction(state, activeId, { type: "play-development", cardId: "development-93" });
    state = applyAction(state, activeId, { type: "sabotage-route", edgeId: chain[2]!.id });
    expect(getLongestRoadLength(state, opponent.id)).toBeLessThan(5);
    expect(state.awards.longestRoad).toBeNull();
  });

  test("computers play and finish a Custom World game with 6 Sabotage cards enabled", () => {
    const random = randomFromSeed(19);
    let state = createGame(
      profiles.map(profile => ({ ...profile, control: "computer" })),
      random,
      undefined,
      "custom-world",
      12,
      configWith({ sabotageCards: CUSTOM_SABOTAGE_CARDS_MAXIMUM }),
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

  test("multiplayer host validates and resolves Sabotage on the shared board", () => {
    const room = new HostRoom("sabotage-secret");
    room.setVariant("custom-world");
    room.setCustomMapConfig(configWith({ sabotageCards: 4 }));
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
    room.game!.players.find(player => player.id === humanId)!.developmentCards.push({
      id: "development-30", kind: "sabotage", purchasedTurn: 1,
    });
    room.version++;

    // Phone snapshot with Sabotage card & >25 deck validates cleanly through protocol.
    const beforeSnapshot = room.snapshot("phone-1");
    expect(parseServerMessage({ type: "snapshot", snapshot: beforeSnapshot })).toEqual({ type: "snapshot", snapshot: beforeSnapshot });

    // Phone plays Sabotage.
    const playResult = room.command("phone-1", {
      type: "action", requestId: "req-play", version: room.version,
      action: { type: "play-development", cardId: "development-30" },
    });
    expect(playResult.error).toBeNull();
    const sabotageSnapshot = room.snapshot("phone-1");
    expect(sabotageSnapshot.game!.phase.type).toBe("sabotage");
    expect(sabotageSnapshot.boardTargets.edges.length).toBeGreaterThan(0);
    expect(sabotageSnapshot.boardTargets.vertices.length).toBeGreaterThan(0);
    expect(parseServerMessage({ type: "snapshot", snapshot: sabotageSnapshot })).toEqual({ type: "snapshot", snapshot: sabotageSnapshot });

    // Phone cannot execute board sabotage directly.
    const phoneSabotage = room.command("phone-1", {
      type: "action", requestId: "req-illegal", version: room.version,
      action: { type: "sabotage-building", vertexId: sabotageSnapshot.boardTargets.vertices[0]! },
    });
    expect(phoneSabotage.error).not.toBeNull();

    // Shared board resolves Sabotage building destruction.
    const targetVertexId = sabotageSnapshot.boardTargets.vertices[0]!;
    room.performBoard({ type: "sabotage-building", vertexId: targetVertexId });
    expect(room.game!.board.vertices.find(vertex => vertex.id === targetVertexId)!.building).toBeNull();
    expect(room.game!.phase).toEqual({ type: "actions" });
  });
});
