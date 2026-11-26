import { describe, expect, test } from "bun:test";
import { createBoard, seededRandom } from "../../src/game/board";
import { chooseComputerAction } from "../../src/game/computer";
import {
  applyAction, createGame, getScore, legalRobberOrPirateTiles, legalSettlementVertices, RESOURCES,
} from "../../src/game/engine";
import { DEFAULT_CUSTOM_MAP_CONFIG, type CustomMapConfig, type GameState, type Player } from "../../src/game/types";
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

function finishSetup(variant: "volcano-islands" | "custom-world", seed = 11, customConfig?: CustomMapConfig): GameState {
  const random = randomFromSeed(seed);
  let state = createGame(profiles, random, undefined, variant, 12, customConfig);
  while (state.phase.type.startsWith("setup")) {
    const playerId = state.activePlayerId;
    if (state.phase.type === "setup-settlement") {
      state = applyAction(state, playerId, { type: "place-settlement", vertexId: legalSettlementVertices(state, playerId)[0]! }, random);
    } else if (state.phase.type === "setup-road") {
      const vertexId = (state.phase as { type: "setup-road"; vertexId: string }).vertexId;
      const edgeId = state.board.edges.find(edge => !edge.playerId && edge.vertexIds.includes(vertexId))!.id;
      state = applyAction(state, playerId, { type: "place-road", edgeId }, random);
    }
  }
  return state;
}

describe("Volcano Islands", () => {
  test("generates a deterministic 42-hex board with 3 non-adjacent volcanoes and distinct juicy numbers", () => {
    const first = createBoard(seededRandom("23456789"), "volcano-islands");
    const second = createBoard(seededRandom("23456789"), "volcano-islands");
    expect(first).toEqual(second);
    expect(first.variant).toBe("volcano-islands");
    expect(first.tiles).toHaveLength(42);
    const volcanoes = first.tiles.filter(tile => tile.terrain === "volcano");
    expect(volcanoes).toHaveLength(3);
    const mainVolcano = volcanoes.find(tile => tile.islandId === "main")!;
    const remoteVolcanoes = volcanoes.filter(tile => tile.islandId !== "main");
    expect(mainVolcano).toBeDefined();
    expect([5, 9]).toContain(mainVolcano.number!);
    expect(remoteVolcanoes.map(tile => tile.number).sort((a, b) => a! - b!)).toEqual([6, 8]);
    // No two volcanoes share an edge.
    for (const volcano of volcanoes) {
      for (const other of volcanoes) {
        if (volcano === other) continue;
        expect(volcano.vertexIds.filter(id => other.vertexIds.includes(id)).length).toBeLessThan(2);
      }
    }
  });

  test("erupts on matching roll, hits struck corner, spares last building, grants gold to surviving neighbors, and forbids robber on volcanoes", () => {
    const state = finishSetup("volcano-islands", 17);
    const volcano = state.board.tiles.find(tile => tile.terrain === "volcano" && tile.number === 6)!;
    const [playerOne, playerTwo, playerThree] = state.players as [Player, Player, Player];
    // Clear existing buildings and place controlled test buildings on the volcano.
    for (const vertex of state.board.vertices) vertex.building = null;
    const struckVertex = state.board.vertices.find(vertex => vertex.id === volcano.vertexIds[0]!)!;
    const survivorVertex = state.board.vertices.find(vertex => vertex.id === volcano.vertexIds[2]!)!;
    struckVertex.building = { playerId: playerOne.id, kind: "city" };
    survivorVertex.building = { playerId: playerTwo.id, kind: "city" };
    state.activePlayerId = playerOne.id;
    state.phase = { type: "roll" };

    // Robber cannot be placed on a volcano tile.
    expect(legalRobberOrPirateTiles(state)).not.toContain(volcano.id);
    const robberState = structuredClone(state);
    robberState.phase = { type: "robber", returnPhase: "actions" };
    expect(() => applyAction(robberState, playerOne.id, { type: "move-robber", tileId: volcano.id }))
      .toThrow("The robber cannot be placed on a volcano.");

    // Deterministic dice roll = 3 + 3 = 6, struck corner = 0.
    const scriptedRolls = [2 / 6, 2 / 6, 0 / 6];
    let index = 0;
    const rolled = applyAction(state, playerOne.id, { type: "roll" }, () => scriptedRolls[index++]!);
    expect(rolled.lastEruption).toMatchObject({
      tileId: volcano.id,
      vertexId: struckVertex.id,
      affectedPlayerId: playerOne.id,
      effect: "downgraded",
    });
    expect(rolled.board.vertices.find(vertex => vertex.id === struckVertex.id)!.building)
      .toEqual({ playerId: playerOne.id, kind: "settlement" });
    expect(rolled.phase).toEqual({ type: "gold", required: { [playerTwo.id]: 2 } });

    // Sparing the player's last settlement on a struck corner.
    const spareState = structuredClone(state);
    spareState.board.vertices.find(vertex => vertex.id === struckVertex.id)!.building = { playerId: playerThree.id, kind: "settlement" };
    spareState.board.vertices.find(vertex => vertex.id === survivorVertex.id)!.building = null;
    index = 0;
    const spared = applyAction(spareState, playerOne.id, { type: "roll" }, () => scriptedRolls[index++]!);
    expect(spared.lastEruption?.effect).toBe("spared");
    expect(spared.board.vertices.find(vertex => vertex.id === struckVertex.id)!.building)
      .toEqual({ playerId: playerThree.id, kind: "settlement" });

    // Destroying a non-final settlement.
    const destroyState = structuredClone(spareState);
    const otherVertex = destroyState.board.vertices.find(vertex => !volcano.vertexIds.includes(vertex.id))!;
    otherVertex.building = { playerId: playerThree.id, kind: "settlement" };
    index = 0;
    const destroyed = applyAction(destroyState, playerOne.id, { type: "roll" }, () => scriptedRolls[index++]!);
    expect(destroyed.lastEruption?.effect).toBe("destroyed");
    expect(destroyed.board.vertices.find(vertex => vertex.id === struckVertex.id)!.building).toBeNull();
  });

  test("computers finish a Volcano Islands game and multiplayer snapshots validate", () => {
    const random = randomFromSeed(23);
    let state = createGame(profiles.map(profile => ({ ...profile, control: "computer" })), random, undefined, "volcano-islands");
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
    for (const resource of RESOURCES) expect(state.bank[resource]).toBeGreaterThanOrEqual(0);

    const room = new HostRoom("volcano-secret");
    room.setVariant("volcano-islands");
    room.join("phone-1", { type: "join", secret: "volcano-secret", name: "Alex" });
    room.admit("phone-1");
    room.addComputer();
    room.addComputer();
    room.start();
    const snapshot = room.snapshot("phone-1");
    expect(snapshot.game?.variant).toBe("volcano-islands");
    expect(parseServerMessage({ type: "snapshot", snapshot })).toEqual({ type: "snapshot", snapshot });
  }, 30000);
});

describe("Custom World Volcanoes", () => {
  test("supports configurable volcano tiles in visible and foggy Custom World, including all-volcano robber skip", () => {
    const volcanoCustomConfig: CustomMapConfig = {
      ...DEFAULT_CUSTOM_MAP_CONFIG,
      wood: 4,
      volcano: 2,
    };
    const visibleBoard = createBoard(seededRandom("23456789"), "custom-world", volcanoCustomConfig);
    expect(visibleBoard.tiles.filter(tile => tile.terrain === "volcano")).toHaveLength(2);

    const foggyBoard = createBoard(seededRandom("23456789"), "custom-world", { ...volcanoCustomConfig, fog: true });
    const hiddenVolcanoes = Object.values(foggyBoard.fogDiscoveriesByTileId!).filter(discovery => discovery.terrain === "volcano");
    expect(hiddenVolcanoes).toHaveLength(2);
    expect(hiddenVolcanoes.every(discovery => discovery.number !== null)).toBe(true);

    // An all-volcano land map with no sea skips the robber move cleanly on a 7.
    const allVolcanoConfig: CustomMapConfig = {
      wood: 0, brick: 0, wool: 0, grain: 0, ore: 0, gold: 0, volcano: 42, desert: 0, sea: 0, fog: false, sabotage: false,
    };
    const state = finishSetup("custom-world", 31, allVolcanoConfig);
    expect(state.lastEruption).toBeNull();
    expect(legalRobberOrPirateTiles(state)).toEqual([]);
    const rolledSeven = applyAction(state, state.activePlayerId, { type: "roll" }, (() => {
      const rolls = [3 / 6, 2 / 6]; // 4 + 3 = 7
      let index = 0;
      return () => rolls[index++]!;
    })());
    expect(rolledSeven.phase).toEqual({ type: "actions" });
  });

  test("computer never places the robber on a volcano and falls back to legal pirate moves when only volcanoes remain on land", () => {
    const state = finishSetup("volcano-islands", 17);
    const [computerPlayer, opponentOne, opponentTwo] = state.players as [Player, Player, Player];
    computerPlayer.control = "computer";
    const volcano = state.board.tiles.find(tile => tile.terrain === "volcano" && tile.number === 6)!;
    for (const vertex of state.board.vertices) vertex.building = null;
    // Make the volcano overwhelmingly attractive with opponent cities and cards.
    state.board.vertices.find(vertex => vertex.id === volcano.vertexIds[0]!)!.building = { playerId: opponentOne.id, kind: "city" };
    state.board.vertices.find(vertex => vertex.id === volcano.vertexIds[2]!)!.building = { playerId: opponentTwo.id, kind: "city" };
    opponentOne.resources.ore = 4;
    opponentTwo.resources.grain = 4;
    state.activePlayerId = computerPlayer.id;
    state.phase = { type: "robber", returnPhase: "actions" };

    const action = chooseComputerAction(state, computerPlayer.id);
    expect(action).not.toBeNull();
    if (action?.type === "move-robber") {
      expect(state.board.tiles.find(tile => tile.id === action.tileId)?.terrain).not.toBe("volcano");
    }
    const next = applyAction(state, computerPlayer.id, action!, randomFromSeed(19));
    expect(next.board.tiles.find(tile => tile.id === next.robberTileId)?.terrain).not.toBe("volcano");

    // When all land is volcano and only a single sea hex exists with the pirate on it, the computer removes the pirate cleanly.
    const volcanoAndOneSeaConfig: CustomMapConfig = {
      wood: 0, brick: 0, wool: 0, grain: 0, ore: 0, gold: 0, volcano: 41, desert: 0, sea: 1, fog: false, sabotage: false,
    };
    const pirateOnlyState = finishSetup("custom-world", 37, volcanoAndOneSeaConfig);
    const activeComputer = pirateOnlyState.players.find(player => player.id === pirateOnlyState.activePlayerId)!;
    activeComputer.control = "computer";
    const seaTile = pirateOnlyState.board.tiles.find(tile => tile.terrain === "sea")!;
    pirateOnlyState.pirateTileId = seaTile.id;
    pirateOnlyState.phase = { type: "robber", returnPhase: "actions" };

    const pirateAction = chooseComputerAction(pirateOnlyState, activeComputer.id);
    expect(pirateAction).toEqual({ type: "move-pirate", tileId: null });
    const afterPirate = applyAction(pirateOnlyState, activeComputer.id, pirateAction!, randomFromSeed(41));
    expect(afterPirate.pirateTileId).toBeNull();
    expect(afterPirate.phase).toEqual({ type: "actions" });
  });
});
