import { describe, expect, test } from "bun:test";
import { createBoard, seededRandom } from "../../src/game/board";
import { chooseComputerAction } from "../../src/game/computer";
import {
  applyAction, createGame, legalSettlementVertices, legalSetupRevealTiles, getScore, RESOURCES,
} from "../../src/game/engine";
import {
  CUSTOM_MAP_COUNT_FIELDS, DEFAULT_CUSTOM_MAP_CONFIG, isCustomMapConfig, isCustomMapConfigDraft,
  type CustomMapConfig, type Player,
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
