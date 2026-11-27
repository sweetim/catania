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

  test("erupts on 1 to half the corners, destroys connected roads without touching ships, spares last building across multiple strikes, grants gold to surviving neighbors, and forbids robber on volcanoes", () => {
    const state = finishSetup("volcano-islands", 17);
    const volcano = state.board.tiles.find(tile => tile.terrain === "volcano" && tile.number === 6)!;
    const [playerOne, playerTwo, playerThree] = state.players as [Player, Player, Player];
    // Clear existing buildings and routes and place controlled test pieces on the volcano.
    for (const vertex of state.board.vertices) vertex.building = null;
    for (const edge of state.board.edges) {
      edge.playerId = null;
      delete edge.kind;
    }
    const struckVertex = state.board.vertices.find(vertex => vertex.id === volcano.vertexIds[0]!)!;
    const secondStruckVertex = state.board.vertices.find(vertex => vertex.id === volcano.vertexIds[1]!)!;
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

    // Deterministic dice roll = 3 + 3 = 6, strike count = 1 (0/3 -> 1), struck corner = index 0.
    const singleStrikeRolls = [2 / 6, 2 / 6, 0 / 3, 0 / 6];
    let index = 0;
    const rolled = applyAction(state, playerOne.id, { type: "roll" }, () => singleStrikeRolls[index++]!);
    expect(rolled.lastEruption).toMatchObject({
      tileId: volcano.id,
      strikes: [{
        vertexId: struckVertex.id,
        affectedPlayerId: playerOne.id,
        effect: "downgraded",
      }],
      destroyedRoads: [],
    });
    expect(rolled.board.vertices.find(vertex => vertex.id === struckVertex.id)!.building)
      .toEqual({ playerId: playerOne.id, kind: "settlement" });
    expect(rolled.phase).toEqual({ type: "gold", required: { [playerTwo.id]: 2 } });

    // Multi-strike eruption (max = 6 / 2 = 3 corners): strikes indices 0, 1, 2 -> destroys connected roads, spares ships, and leaves surviving corners with gold.
    const multiStrikeState = structuredClone(state);
    const sharedEdge = multiStrikeState.board.edges.find(edge =>
      edge.vertexIds.includes(struckVertex.id) && edge.vertexIds.includes(secondStruckVertex.id))!;
    const outwardRoadEdge = multiStrikeState.board.edges.find(edge =>
      edge.vertexIds.includes(struckVertex.id) && edge.id !== sharedEdge.id && !edge.vertexIds.includes(volcano.vertexIds[5]!))!;
    const coastalShipEdge = multiStrikeState.board.edges.find(edge =>
      edge.vertexIds.includes(secondStruckVertex.id) && edge.id !== sharedEdge.id)!;
    const thirdStruckVertex = multiStrikeState.board.vertices.find(vertex => vertex.id === volcano.vertexIds[3]!)!;
    const untouchedVertex = multiStrikeState.board.vertices.find(vertex => vertex.id === volcano.vertexIds[4]!)!;
    sharedEdge.playerId = playerOne.id;
    outwardRoadEdge.playerId = playerTwo.id;
    coastalShipEdge.playerId = playerThree.id;
    coastalShipEdge.kind = "ship";
    multiStrikeState.board.vertices.find(vertex => vertex.id === struckVertex.id)!.building = null;
    multiStrikeState.board.vertices.find(vertex => vertex.id === survivorVertex.id)!.building = null;
    multiStrikeState.board.vertices.find(vertex => vertex.id === thirdStruckVertex.id)!.building = { playerId: playerThree.id, kind: "settlement" };
    multiStrikeState.board.vertices.find(vertex => vertex.id === untouchedVertex.id)!.building = { playerId: playerThree.id, kind: "settlement" };
    // Strike count draw = 2/3 -> 3 strikes; remaining picks: 0 (vertex 0), 0 (vertex 1), 1 (vertex 3).
    const threeStrikeRolls = [2 / 6, 2 / 6, 2 / 3, 0 / 6, 0 / 5, 1 / 4];
    index = 0;
    const multiRolled = applyAction(multiStrikeState, playerOne.id, { type: "roll" }, () => threeStrikeRolls[index++]!);
    expect(multiRolled.lastEruption?.strikes).toEqual([
      { vertexId: struckVertex.id, affectedPlayerId: null, effect: "none" },
      { vertexId: secondStruckVertex.id, affectedPlayerId: null, effect: "none" },
      { vertexId: thirdStruckVertex.id, affectedPlayerId: playerThree.id, effect: "destroyed" },
    ]);
    // Both roads connected to struck corners are destroyed once; the ship is untouched.
    expect(multiRolled.lastEruption?.destroyedRoads.map(road => road.edgeId).sort())
      .toEqual([sharedEdge.id, outwardRoadEdge.id].sort());
    expect(multiRolled.board.edges.find(edge => edge.id === sharedEdge.id)!.playerId).toBeNull();
    expect(multiRolled.board.edges.find(edge => edge.id === outwardRoadEdge.id)!.playerId).toBeNull();
    expect(multiRolled.board.edges.find(edge => edge.id === coastalShipEdge.id)!).toMatchObject({
      playerId: playerThree.id,
      kind: "ship",
    });
    // Untouched corner still harvests gold.
    expect(multiRolled.phase).toEqual({ type: "gold", required: { [playerThree.id]: 1 } });
    // Road destruction logs appear and harmless message does not.
    expect(multiRolled.log.some(entry => entry.key === "Volcano eruption destroys {victim}'s road.")).toBe(true);
    expect(multiRolled.log.some(entry => entry.key === "A volcano erupts harmlessly.")).toBe(false);

    // Road-only hit (no buildings hit) is NOT logged as harmless and updates Longest Route.
    const roadOnlyState = structuredClone(state);
    for (const vertex of roadOnlyState.board.vertices) vertex.building = null;
    // Build a 5-road chain starting at struckVertex so playerTwo holds Longest Route.
    const chainEdges: typeof roadOnlyState.board.edges = [];
    let currentVertexId = struckVertex.id;
    const visitedVertices = new Set([currentVertexId]);
    for (let step = 0; step < 5; step++) {
      const nextEdge = roadOnlyState.board.edges.find(edge =>
        !chainEdges.includes(edge) &&
        edge.vertexIds.includes(currentVertexId) &&
        edge.vertexIds.some(id => !visitedVertices.has(id)),
      )!;
      chainEdges.push(nextEdge);
      nextEdge.playerId = playerTwo.id;
      currentVertexId = nextEdge.vertexIds.find(id => id !== currentVertexId)!;
      visitedVertices.add(currentVertexId);
    }
    roadOnlyState.awards.longestRoad = playerTwo.id;
    index = 0;
    const roadOnlyRolled = applyAction(roadOnlyState, playerOne.id, { type: "roll" }, () => singleStrikeRolls[index++]!);
    expect(roadOnlyRolled.lastEruption?.destroyedRoads).toEqual([{ edgeId: chainEdges[0]!.id, playerId: playerTwo.id }]);
    expect(roadOnlyRolled.board.edges.find(edge => edge.id === chainEdges[0]!.id)!.playerId).toBeNull();
    expect(roadOnlyRolled.awards.longestRoad).toBeNull();
    expect(roadOnlyRolled.log.some(entry =>
      entry.key === "Volcano eruption destroys {victim}'s road." && entry.parameters?.victim === playerTwo.name,
    )).toBe(true);
    expect(roadOnlyRolled.log.some(entry => entry.key === "A volcano erupts harmlessly.")).toBe(false);

    // Sparing the player's last settlement even when 2 of their settlements are struck in the same eruption.
    const doubleStrikeState = structuredClone(state);
    for (const vertex of doubleStrikeState.board.vertices) vertex.building = null;
    doubleStrikeState.board.vertices.find(vertex => vertex.id === struckVertex.id)!.building = { playerId: playerThree.id, kind: "settlement" };
    doubleStrikeState.board.vertices.find(vertex => vertex.id === secondStruckVertex.id)!.building = { playerId: playerThree.id, kind: "settlement" };
    // Strike count draw = 1/3 -> 2 strikes; picks: vertex 0, vertex 1.
    const twoStrikeRolls = [2 / 6, 2 / 6, 1 / 3, 0 / 6, 0 / 5];
    index = 0;
    const doubleStruck = applyAction(doubleStrikeState, playerOne.id, { type: "roll" }, () => twoStrikeRolls[index++]!);
    expect(doubleStruck.lastEruption?.strikes).toEqual([
      { vertexId: struckVertex.id, affectedPlayerId: playerThree.id, effect: "destroyed" },
      { vertexId: secondStruckVertex.id, affectedPlayerId: playerThree.id, effect: "spared" },
    ]);
    expect(doubleStruck.board.vertices.find(vertex => vertex.id === struckVertex.id)!.building).toBeNull();
    expect(doubleStruck.board.vertices.find(vertex => vertex.id === secondStruckVertex.id)!.building)
      .toEqual({ playerId: playerThree.id, kind: "settlement" });

    // Random strike counts always stay within 1..(max vertex / 2) = 1..3 and hit distinct corners.
    const observedCounts = new Set<number>();
    const countRandom = randomFromSeed(101);
    for (let trial = 0; trial < 40; trial++) {
      const trialState = structuredClone(state);
      let step = 0;
      const trialRolled = applyAction(trialState, playerOne.id, { type: "roll" }, () => step++ < 2 ? 2 / 6 : countRandom());
      const strikes = trialRolled.lastEruption!.strikes;
      expect(strikes.length).toBeGreaterThanOrEqual(1);
      expect(strikes.length).toBeLessThanOrEqual(volcano.vertexIds.length / 2);
      expect(new Set(strikes.map(strike => strike.vertexId)).size).toBe(strikes.length);
      observedCounts.add(strikes.length);
    }
    expect(observedCounts).toEqual(new Set([1, 2, 3]));
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

    // Validate multiplayer snapshot protocol with a populated multi-strike + road-destruction eruption.
    const populatedSnapshot = structuredClone(snapshot);
    const volcanoTile = populatedSnapshot.game!.board.tiles.find(tile => tile.terrain === "volcano")!;
    const struckEdge = populatedSnapshot.game!.board.edges.find(edge => edge.vertexIds.includes(volcanoTile.vertexIds[0]!))!;
    populatedSnapshot.game!.lastEruption = {
      id: 1,
      tileId: volcanoTile.id,
      turnNumber: 3,
      strikes: [
        { vertexId: volcanoTile.vertexIds[0]!, affectedPlayerId: "player-1", effect: "destroyed" },
        { vertexId: volcanoTile.vertexIds[2]!, affectedPlayerId: null, effect: "none" },
      ],
      destroyedRoads: [{ edgeId: struckEdge.id, playerId: "player-1" }],
    };
    expect(parseServerMessage({ type: "snapshot", snapshot: populatedSnapshot }))
      .toEqual({ type: "snapshot", snapshot: populatedSnapshot });

    const invalidEmptyStrikes = structuredClone(populatedSnapshot);
    invalidEmptyStrikes.game!.lastEruption!.strikes = [];
    expect(() => parseServerMessage({ type: "snapshot", snapshot: invalidEmptyStrikes })).toThrow();
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
