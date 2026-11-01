import { describe, expect, test } from "bun:test";
import { createBoard } from "../../src/game/board";
import { formatGameMessage } from "../../src/game/messages";
import {
  applyAction, blockedSettlementVertices, COSTS, createGame, emptyResources, getLongestRoadLength, getScore, getTradeRatio,
  legalCityVertices, legalRoadEdges, legalSettlementVertices, RESOURCES, resourceTotal,
} from "../../src/game/engine";
import type { Building, DevelopmentKind, GameAction, GameState, Player, Resources, Vertex } from "../../src/game/types";

const profiles: Pick<Player, "name" | "color" | "control">[] = [
  { name: "Ada", color: "red", control: "human" }, { name: "Grace", color: "blue", control: "human" },
  { name: "Linus", color: "white", control: "human" }, { name: "Margaret", color: "orange", control: "human" },
];
const firstPlayer = "player-1";
const secondPlayer = "player-2";
const thirdPlayer = "player-3";
const resources = (values: Partial<Resources> = {}): Resources => ({ ...emptyResources(), ...values });
const newGame = (count = 3): GameState => createGame(profiles.slice(0, count), () => 0.999999);

function finishSetup(count = 3): GameState {
  let state = newGame(count);
  while (state.phase.type === "setup-settlement" || state.phase.type === "setup-road") {
    state = applyAction(state, state.activePlayerId, state.phase.type === "setup-settlement"
      ? { type: "place-settlement", vertexId: legalSettlementVertices(state, state.activePlayerId)[0]! }
      : { type: "place-road", edgeId: legalRoadEdges(state, state.activePlayerId)[0]! });
  }
  return state;
}

function actionState(): GameState {
  const state = newGame();
  state.phase = { type: "actions" };
  state.turnNumber = 5;
  state.setupIndex = state.setupOrder.length;
  return state;
}

function give(state: GameState, playerId: string, values: Partial<Resources>): void {
  const player = state.players.find(player => player.id === playerId)!;
  for (const resource of RESOURCES) {
    const amount = values[resource] ?? 0;
    player.resources[resource] += amount;
    state.bank[resource] -= amount;
  }
}

function card(state: GameState, kind: DevelopmentKind, playerId = firstPlayer, purchasedTurn = 1): string {
  const player = state.players.find(player => player.id === playerId)!;
  const id = `${playerId}-${kind}-${player.developmentCards.length}`;
  player.developmentCards.push({ id, kind, purchasedTurn });
  return id;
}

function reject(state: GameState, action: GameAction, message: string, playerId = state.activePlayerId): void {
  const before = structuredClone(state);
  expect(() => applyAction(state, playerId, action)).toThrow(message);
  expect(state).toEqual(before);
}

function assertConservation(state: GameState): void {
  for (const resource of RESOURCES) {
    expect(state.bank[resource] + state.players.reduce((total, player) => total + player.resources[resource], 0)).toBe(19);
    expect(state.bank[resource]).toBeGreaterThanOrEqual(0);
    expect(state.players.every(player => Number.isInteger(player.resources[resource]) && player.resources[resource] >= 0)).toBe(true);
  }
}

function graphState(paths: { playerId: string | null; vertices: string[] }[], buildings: Record<string, Building> = {}): GameState {
  const state = actionState();
  const vertices = new Map<string, Vertex>();
  const edges: GameState["board"]["edges"] = [];
  for (const id of [...paths.flatMap(path => path.vertices), ...Object.keys(buildings)]) {
    if (!vertices.has(id)) vertices.set(id, { id, x: vertices.size, y: 0, tileIds: [], edgeIds: [], building: buildings[id] ?? null });
  }
  for (const path of paths) {
    for (let index = 1; index < path.vertices.length; index++) {
      const edge = { id: `edge-${edges.length}`, vertexIds: [path.vertices[index - 1]!, path.vertices[index]!] as [string, string], playerId: path.playerId };
      edges.push(edge);
      for (const vertexId of edge.vertexIds) vertices.get(vertexId)!.edgeIds.push(edge.id);
    }
  }
  state.board = { tiles: [], vertices: [...vertices.values()], edges, ports: [] };
  return state;
}

function refreshAwards(state: GameState): GameState {
  state.phase = { type: "roll" };
  return applyAction(state, state.activePlayerId, { type: "roll" }, () => 0);
}

function productionState(): GameState {
  const state = actionState();
  state.phase = { type: "roll" };
  for (const tile of state.board.tiles) tile.number = null;
  const tile = state.board.tiles.find(tile => tile.terrain === "wood")!;
  tile.number = 6;
  state.board.vertices.find(vertex => vertex.id === tile.vertexIds[0])!.building = { playerId: firstPlayer, kind: "city" };
  state.board.vertices.find(vertex => vertex.id === tile.vertexIds[3])!.building = { playerId: secondPlayer, kind: "settlement" };
  return state;
}

describe("initialization and snake setup", () => {
  test("uses an independent copy of the selected island and starts its robber on the desert", () => {
    const preview = createBoard(() => 0);
    const original = structuredClone(preview);
    const state = createGame(profiles, () => 0.999999, preview);
    expect(state.board).toEqual(preview);
    expect(state.board).not.toBe(preview);
    expect(state.robberTileId).toBe(preview.tiles.find(tile => tile.terrain === "desert")!.id);
    expect(createGame(profiles, () => 0.999999).board).not.toEqual(preview);

    state.board.vertices[0]!.building = { playerId: state.activePlayerId, kind: "settlement" };
    state.board.edges[0]!.playerId = state.activePlayerId;
    state.board.tiles[0]!.number = 12;
    state.board.ports[0]!.resource = "ore";
    expect(preview).toEqual(original);
  });

  test("requires three or four named players with distinct colors", () => {
    expect(() => createGame(profiles.slice(0, 2))).toThrow("three or four");
    expect(() => createGame([...profiles, profiles[0]!])).toThrow("three or four");
    expect(() => createGame([{ name: " ", color: "red", control: "human" }, ...profiles.slice(1, 3)])).toThrow("name and color");
    expect(() => createGame([profiles[0]!, profiles[0]!, profiles[2]!])).toThrow("different color");
  });

  test("randomizes order, preserves identity, and supplies the exact bank and development deck", () => {
    const state = createGame(profiles, () => 0);
    expect(state.players.map(player => player.id)).not.toEqual(profiles.map((_, index) => `player-${index + 1}`));
    for (const player of state.players) {
      expect(player.name).toBe(profiles[Number(player.id.split("-")[1]) - 1]!.name);
      expect(player.resources).toEqual(emptyResources());
      expect(player.developmentCards).toHaveLength(0);
    }
    const order = state.players.map(player => player.id);
    expect(state.setupOrder).toEqual([...order, ...order.toReversed()]);
    expect(state.activePlayerId).toBe(order[0]!);
    expect(state.developmentDeck).toHaveLength(25);
    for (const [kind, count] of [["knight", 14], ["victory-point", 5], ["road-building", 2], ["year-of-plenty", 2], ["monopoly", 2]] as const) {
      expect(state.developmentDeck.filter(card => card === kind)).toHaveLength(count);
    }
    expect(state.bank).toEqual({ wood: 19, brick: 19, wool: 19, grain: 19, ore: 19 });
    expect(state.board.tiles.find(tile => tile.id === state.robberTileId)!.terrain).toBe("desert");
    expect(state.dice).toBeNull();
    expect(state.turnNumber).toBe(0);
    expect(state.thefts).toEqual([]);
  });

  test.each([3, 4])("completes the exact free %s-player forward/reverse setup with second-settlement resources", count => {
    let state = newGame(count);
    const order = [...state.setupOrder];
    for (let index = 0; index < order.length; index++) {
      expect(state.activePlayerId).toBe(order[index]!);
      expect(state.phase.type).toBe("setup-settlement");
      const vertexId = legalSettlementVertices(state, state.activePlayerId)[0]!;
      const vertex = state.board.vertices.find(vertex => vertex.id === vertexId)!;
      const expected = resources();
      if (index >= count) {
        for (const tileId of vertex.tileIds) {
          const tile = state.board.tiles.find(tile => tile.id === tileId)!;
          if (tile.terrain !== "desert") expected[tile.terrain]++;
        }
      }
      const actingPlayer = state.activePlayerId;
      const original = structuredClone(state);
      state = applyAction(state, actingPlayer, { type: "place-settlement", vertexId });
      expect(original.board.vertices.find(vertex => vertex.id === vertexId)!.building).toBeNull();
      expect(state.players.find(player => player.id === actingPlayer)!.resources).toEqual(expected);
      expect(state.phase).toEqual({ type: "setup-road", vertexId });
      const roads = legalRoadEdges(state, actingPlayer);
      expect(roads.length).toBeGreaterThan(0);
      for (const edgeId of roads) expect(state.board.edges.find(edge => edge.id === edgeId)!.vertexIds).toContain(vertexId);
      state = applyAction(state, actingPlayer, { type: "place-road", edgeId: roads[0]! });
      assertConservation(state);
    }
    expect(state.phase).toEqual({ type: "roll" });
    expect(state.activePlayerId).toBe(order[0]!);
    expect(state.turnNumber).toBe(1);
    for (const player of state.players) {
      expect(getScore(state, player.id).settlements).toBe(2);
      expect(state.board.edges.filter(edge => edge.playerId === player.id)).toHaveLength(2);
    }
  });

  test("distance rule applies to every player's buildings, even in setup", () => {
    let state = newGame();
    const vertexId = legalSettlementVertices(state, firstPlayer)[0]!;
    state = applyAction(state, firstPlayer, { type: "place-settlement", vertexId });
    const adjacent = state.board.edges.find(edge => edge.vertexIds.includes(vertexId))!;
    const neighbor = adjacent.vertexIds.find(id => id !== vertexId)!;
    state = applyAction(state, firstPlayer, { type: "place-road", edgeId: adjacent.id });
    expect(legalSettlementVertices(state, secondPlayer)).not.toContain(vertexId);
    expect(legalSettlementVertices(state, secondPlayer)).not.toContain(neighbor);
    reject(state, { type: "place-settlement", vertexId: neighbor }, "empty legal intersection");
  });

  test("setup forbids arbitrary roads, cities, roll, end turn, trades and development", () => {
    let state = newGame();
    reject(state, { type: "roll" }, "roll once");
    reject(state, { type: "buy-development" }, "Roll the dice");
    reject(state, { type: "end-turn" }, "Roll the dice");
    reject(state, { type: "place-city", vertexId: state.board.vertices[0]!.id }, "Upgrade");
    reject(state, { type: "bank-trade", give: "wood", receive: "ore" }, "Roll the dice");
    const vertexId = legalSettlementVertices(state, firstPlayer)[0]!;
    state = applyAction(state, firstPlayer, { type: "place-settlement", vertexId });
    const remote = state.board.edges.find(edge => !edge.vertexIds.includes(vertexId))!;
    reject(state, { type: "place-road", edgeId: remote.id }, "empty edge");
  });
});

describe("settlement distance markers", () => {
  test("an island without buildings has no blocked vertices", () => {
    expect(blockedSettlementVertices(newGame().board)).toEqual([]);
  });

  test("marks empty one-edge neighbors once for every player's settlements and cities, not occupied or two-edge vertices", () => {
    const state = graphState([
      { playerId: null, vertices: ["own", "shared", "opponent", "near", "far"] },
      { playerId: null, vertices: ["own", "third", "other-near", "other-far"] },
    ], {
      own: { playerId: firstPlayer, kind: "settlement" },
      opponent: { playerId: secondPlayer, kind: "city" },
      third: { playerId: thirdPlayer, kind: "settlement" },
    });
    expect(blockedSettlementVertices(state.board)).toEqual(["shared", "near", "other-near"]);
    state.phase = { type: "setup-settlement" };
    expect(legalSettlementVertices(state, firstPlayer)).toEqual(["far", "other-far"]);
  });

  test("recomputes after buildings are placed or upgraded", () => {
    const state = graphState([{ playerId: null, vertices: ["first", "neighbor", "second", "beyond"] }]);
    const first = state.board.vertices.find(vertex => vertex.id === "first")!;
    first.building = { playerId: firstPlayer, kind: "settlement" };
    expect(blockedSettlementVertices(state.board)).toEqual(["neighbor"]);
    first.building.kind = "city";
    expect(blockedSettlementVertices(state.board)).toEqual(["neighbor"]);
    state.board.vertices.find(vertex => vertex.id === "second")!.building = { playerId: secondPlayer, kind: "settlement" };
    expect(blockedSettlementVertices(state.board)).toEqual(["neighbor", "beyond"]);
  });

  test("depends only on distance, not roads, phase, turn, resources or settlement supply", () => {
    const state = graphState([{ playerId: null, vertices: ["own", "near", "remote"] }], {
      own: { playerId: firstPlayer, kind: "settlement" },
      extra1: { playerId: firstPlayer, kind: "settlement" }, extra2: { playerId: firstPlayer, kind: "settlement" },
      extra3: { playerId: firstPlayer, kind: "settlement" }, extra4: { playerId: firstPlayer, kind: "settlement" },
    });
    expect(blockedSettlementVertices(state.board)).toEqual(["near"]);
    state.phase = { type: "roll" };
    state.activePlayerId = secondPlayer;
    give(state, firstPlayer, COSTS.settlement);
    for (const edge of state.board.edges) edge.playerId = firstPlayer;
    expect(blockedSettlementVertices(state.board)).toEqual(["near"]);
    state.board.vertices.find(vertex => vertex.id === "extra4")!.building!.kind = "city";
    expect(blockedSettlementVertices(state.board)).toEqual(["near"]);
  });
});

describe("construction and pieces", () => {
  test("exports exact standard costs and independent empty resource objects", () => {
    expect(COSTS.road).toEqual(resources({ wood: 1, brick: 1 }));
    expect(COSTS.settlement).toEqual(resources({ wood: 1, brick: 1, wool: 1, grain: 1 }));
    expect(COSTS.city).toEqual(resources({ grain: 2, ore: 3 }));
    expect(COSTS.development).toEqual(resources({ wool: 1, grain: 1, ore: 1 }));
    expect(emptyResources()).not.toBe(emptyResources());
    expect(resourceTotal(resources({ ore: 2, grain: 3 }))).toBe(5);
  });

  test("roads cost resources and extend from own buildings or roads, not opponents", () => {
    let state = graphState([
      { playerId: firstPlayer, vertices: ["a", "b"] },
      { playerId: null, vertices: ["b", "c", "d"] },
      { playerId: null, vertices: ["b", "opponent", "beyond"] },
      { playerId: null, vertices: ["island", "remote"] },
    ], { opponent: { playerId: secondPlayer, kind: "settlement" } });
    give(state, firstPlayer, { wood: 2, brick: 2 });
    expect(legalRoadEdges(state, firstPlayer)).toEqual(["edge-1", "edge-3"]);
    reject(state, { type: "place-road", edgeId: "edge-2" }, "empty edge");
    reject(state, { type: "place-road", edgeId: "edge-5" }, "empty edge");
    state = applyAction(state, firstPlayer, { type: "place-road", edgeId: "edge-3" });
    expect(legalRoadEdges(state, firstPlayer)).not.toContain("edge-4");
    state = applyAction(state, firstPlayer, { type: "place-road", edgeId: "edge-1" });
    expect(legalRoadEdges(state, firstPlayer)).toContain("edge-2");
    expect(state.players[0]!.resources).toEqual(emptyResources());
    reject(state, { type: "place-road", edgeId: "edge-2" }, "resources required");
    reject(state, { type: "place-road", edgeId: "edge-0" }, "empty edge");
    assertConservation(state);
  });

  test("own settlements connect roads, opposing settlements block only their endpoint", () => {
    let state = graphState([
      { playerId: null, vertices: ["own", "middle", "opponent"] },
      { playerId: firstPlayer, vertices: ["opponent", "past"] },
      { playerId: null, vertices: ["past", "further"] },
    ], { own: { playerId: firstPlayer, kind: "city" }, opponent: { playerId: secondPlayer, kind: "city" } });
    expect(legalRoadEdges(state, firstPlayer)).toEqual(["edge-0", "edge-3"]);
    give(state, firstPlayer, COSTS.road);
    state = applyAction(state, firstPlayer, { type: "place-road", edgeId: "edge-0" });
    expect(legalRoadEdges(state, firstPlayer)).toContain("edge-1");
  });

  test("normal settlements require an own road, distance and the exact cost", () => {
    let state = graphState([
      { playerId: firstPlayer, vertices: ["own", "near", "site"] },
      { playerId: secondPlayer, vertices: ["elsewhere", "remote"] },
    ], { own: { playerId: firstPlayer, kind: "settlement" } });
    expect(legalSettlementVertices(state, firstPlayer)).toEqual(["site"]);
    reject(state, { type: "place-settlement", vertexId: "remote" }, "empty legal intersection");
    reject(state, { type: "place-settlement", vertexId: "site" }, "resources required");
    give(state, firstPlayer, COSTS.settlement);
    state = applyAction(state, firstPlayer, { type: "place-settlement", vertexId: "site" });
    expect(state.board.vertices.find(vertex => vertex.id === "site")!.building).toEqual({ playerId: firstPlayer, kind: "settlement" });
    expect(state.players[0]!.resources).toEqual(emptyResources());
    assertConservation(state);
  });

  test("city upgrades only own settlements, costs two grain/three ore, and returns the settlement piece", () => {
    let state = graphState([{ playerId: firstPlayer, vertices: ["site", "middle", "new-site"] }], {
      site: { playerId: firstPlayer, kind: "settlement" },
      other: { playerId: secondPlayer, kind: "settlement" },
      extra1: { playerId: firstPlayer, kind: "settlement" }, extra2: { playerId: firstPlayer, kind: "settlement" },
      extra3: { playerId: firstPlayer, kind: "settlement" }, extra4: { playerId: firstPlayer, kind: "settlement" },
    });
    expect(legalSettlementVertices(state, firstPlayer)).toEqual([]);
    reject(state, { type: "place-city", vertexId: "other" }, "Upgrade");
    reject(state, { type: "place-city", vertexId: "new-site" }, "Upgrade");
    give(state, firstPlayer, COSTS.city);
    state = applyAction(state, firstPlayer, { type: "place-city", vertexId: "site" });
    expect(getScore(state, firstPlayer)).toMatchObject({ settlements: 4, cities: 2, public: 6 });
    expect(legalSettlementVertices(state, firstPlayer)).toContain("new-site");
    reject(state, { type: "place-city", vertexId: "site" }, "Upgrade");
    assertConservation(state);
  });

  test("limits players to fifteen roads and four cities", () => {
    const state = graphState([
      { playerId: firstPlayer, vertices: Array.from({ length: 16 }, (_, index) => `road-${index}`) },
      { playerId: null, vertices: ["road-15", "extra"] },
    ], {
      city1: { playerId: firstPlayer, kind: "city" }, city2: { playerId: firstPlayer, kind: "city" },
      city3: { playerId: firstPlayer, kind: "city" }, city4: { playerId: firstPlayer, kind: "city" },
      settlement: { playerId: firstPlayer, kind: "settlement" },
    });
    expect(legalRoadEdges(state, firstPlayer)).toEqual([]);
    expect(legalCityVertices(state, firstPlayer)).toEqual([]);
    reject(state, { type: "place-road", edgeId: "edge-15" }, "fifteen roads");
    reject(state, { type: "place-city", vertexId: "settlement" }, "four cities");
  });

  test("legal placement previews obey phases and active identity, not affordability", () => {
    const state = finishSetup();
    expect(legalRoadEdges(state, firstPlayer)).toEqual([]);
    expect(legalSettlementVertices(state, firstPlayer)).toEqual([]);
    expect(legalCityVertices(state, firstPlayer)).toEqual([]);
    state.phase = { type: "actions" };
    state.players[0]!.resources = emptyResources();
    expect(legalRoadEdges(state, firstPlayer).length).toBeGreaterThan(0);
    expect(legalCityVertices(state, firstPlayer)).toHaveLength(2);
    expect(legalRoadEdges(state, secondPlayer)).toEqual([]);
    expect(legalCityVertices(state, secondPlayer)).toEqual([]);
    expect(legalSettlementVertices(state, "stranger")).toEqual([]);
  });
});

describe("dice and finite production", () => {
  test("produces one per settlement, two per city, to every owner, with immutable input", () => {
    const state = productionState();
    const before = structuredClone(state);
    const result = applyAction(state, firstPlayer, { type: "roll" }, () => 0.4);
    expect(state).toEqual(before);
    expect(result.dice).toEqual([3, 3]);
    expect(result.phase.type).toBe("actions");
    expect(result.players[0]!.resources.wood).toBe(2);
    expect(result.players[1]!.resources.wood).toBe(1);
    expect(result.bank.wood).toBe(16);
    assertConservation(result);
    reject(result, { type: "roll" }, "roll once");
  });

  test("robber blocks its hex, while deserts never produce", () => {
    const state = productionState();
    state.robberTileId = state.board.tiles.find(tile => tile.number === 6)!.id;
    const desert = state.board.tiles.find(tile => tile.terrain === "desert")!;
    desert.number = 6;
    state.board.vertices.find(vertex => vertex.id === desert.vertexIds[0])!.building = { playerId: thirdPlayer, kind: "city" };
    const result = applyAction(state, firstPlayer, { type: "roll" }, () => 0.4);
    expect(result.players.every(player => resourceTotal(player.resources) === 0)).toBe(true);
    assertConservation(result);
  });

  test("shortage pays nobody when multiple players claim the resource", () => {
    const state = productionState();
    give(state, thirdPlayer, { wood: 17 });
    const result = applyAction(state, firstPlayer, { type: "roll" }, () => 0.4);
    expect(result.players[0]!.resources.wood).toBe(0);
    expect(result.players[1]!.resources.wood).toBe(0);
    expect(result.bank.wood).toBe(2);
    expect(result.log).toContainEqual({ key: "The bank cannot supply {resource}; nobody receives that resource this roll.", parameters: { resource: "wood" } });
    expect(result.log.some(entry => entry.key === "The bank has only {count} {resource} left; {player} receives less than earned this roll.")).toBe(false);
    assertConservation(result);
  });

  test("one recipient receives all remaining cards even if its demand exceeds supply", () => {
    const state = productionState();
    for (const vertex of state.board.vertices) if (vertex.building?.playerId === secondPlayer) vertex.building.playerId = firstPlayer;
    give(state, thirdPlayer, { wood: 17 });
    const result = applyAction(state, firstPlayer, { type: "roll" }, () => 0.4);
    expect(result.players[0]!.resources.wood).toBe(2);
    expect(result.bank.wood).toBe(0);
    expect(result.log).toContainEqual({ key: "The bank has only {count} {resource} left; {player} receives less than earned this roll.", parameters: { count: 2, resource: "wood", player: state.players[0]!.name } });
    assertConservation(result);
  });

  test("shortage of one resource does not suppress other resource production", () => {
    const state = productionState();
    const wool = state.board.tiles.find(tile => tile.terrain === "wool" && tile.vertexIds.every(id => !state.board.vertices.find(vertex => vertex.id === id)!.building))!;
    wool.number = 6;
    state.board.vertices.find(vertex => vertex.id === wool.vertexIds[0])!.building = { playerId: thirdPlayer, kind: "settlement" };
    give(state, thirdPlayer, { wood: 17 });
    const result = applyAction(state, firstPlayer, { type: "roll" }, () => 0.4);
    expect(result.players[0]!.resources.wood).toBe(0);
    expect(result.players[2]!.resources.wool).toBe(1);
    assertConservation(result);
  });

  test("dice sample independent values and invalid randomness cannot partially change state", () => {
    const state = productionState();
    let draw = 0;
    const result = applyAction(state, firstPlayer, { type: "roll" }, () => draw++ === 0 ? 0 : 0.999999);
    expect(result.dice).toEqual([1, 6]);
    const before = structuredClone(state);
    draw = 0;
    expect(() => applyAction(state, firstPlayer, { type: "roll" }, () => draw++ === 0 ? 0 : NaN)).toThrow("Random source");
    expect(state).toEqual(before);
  });
});

describe("seven, discards, robber and theft", () => {
  test("seven records exact obligations, allows any obligated player to discard, and waits for everyone", () => {
    let state = actionState();
    state.phase = { type: "roll" };
    give(state, firstPlayer, { wood: 9 });
    give(state, secondPlayer, { brick: 8 });
    give(state, thirdPlayer, { ore: 7 });
    let draw = 0;
    state = applyAction(state, firstPlayer, { type: "roll" }, () => draw++ === 0 ? 0 : 0.99);
    expect(state.phase).toEqual({ type: "discard", required: { [firstPlayer]: 4, [secondPlayer]: 4 } });
    reject(state, { type: "discard", resources: resources({ ore: 3 }) }, "no remaining discard", thirdPlayer);
    reject(state, { type: "discard", resources: resources({ wood: 3 }) }, "exactly 4");
    reject(state, { type: "discard", resources: resources({ ore: 4 }) }, "do not own");
    reject(state, { type: "move-robber", tileId: state.board.tiles[0]!.id }, "only after");
    reject(state, { type: "end-turn" }, "mandatory choices");
    reject(state, { type: "bank-trade", give: "wood", receive: "ore" }, "mandatory choices");
    state = applyAction(state, secondPlayer, { type: "discard", resources: resources({ brick: 4 }) });
    expect(state.phase).toEqual({ type: "discard", required: { [firstPlayer]: 4 } });
    reject(state, { type: "discard", resources: resources({ brick: 4 }) }, "no remaining discard", secondPlayer);
    state = applyAction(state, firstPlayer, { type: "discard", resources: resources({ wood: 4 }) });
    expect(state.phase).toEqual({ type: "robber", returnPhase: "actions" });
    expect(state.players[0]!.resources.wood).toBe(5);
    assertConservation(state);
  });

  test("large hands discard once, rounded down, even when more than seven remain", () => {
    let state = actionState();
    give(state, firstPlayer, { wood: 19 });
    state.phase = { type: "discard", required: { [firstPlayer]: 9 } };
    state = applyAction(state, firstPlayer, { type: "discard", resources: resources({ wood: 9 }) });
    expect(state.players[0]!.resources.wood).toBe(10);
    expect(state.phase.type).toBe("robber");
    reject(state, { type: "discard", resources: resources({ wood: 5 }) }, "no discard");
  });

  test("seven without large hands directly enters robber movement", () => {
    const state = productionState();
    let draw = 0;
    const result = applyAction(state, firstPlayer, { type: "roll" }, () => draw++ === 0 ? 0 : 0.99);
    expect(result.phase).toEqual({ type: "robber", returnPhase: "actions" });
    expect(result.players.every(player => resourceTotal(player.resources) === 0)).toBe(true);
  });

  test("robber must move, may choose desert, and lists adjacent opponents once, including empty hands", () => {
    let state = actionState();
    state.phase = { type: "robber", returnPhase: "actions" };
    const desert = state.board.tiles.find(tile => tile.terrain === "desert")!;
    reject(state, { type: "move-robber", tileId: desert.id }, "different land hex");
    reject(state, { type: "move-robber", tileId: "ocean" }, "different land hex");
    state.robberTileId = state.board.tiles.find(tile => tile.id !== desert.id)!.id;
    const owners = [firstPlayer, secondPlayer, secondPlayer, thirdPlayer];
    owners.forEach((playerId, index) => {
      state.board.vertices.find(vertex => vertex.id === desert.vertexIds[index])!.building = { playerId, kind: "settlement" };
    });
    give(state, secondPlayer, { wood: 1, ore: 3 });
    state = applyAction(state, firstPlayer, { type: "move-robber", tileId: desert.id });
    expect(state.phase).toEqual({ type: "steal", victimIds: [secondPlayer, thirdPlayer], returnPhase: "actions" });
    reject(state, { type: "steal", playerId: firstPlayer }, "opponent with a building");
    const emptyVictim = applyAction(state, firstPlayer, { type: "steal", playerId: thirdPlayer }, () => { throw new Error("No draw for an empty hand"); });
    expect(emptyVictim.phase.type).toBe("actions");
    expect(emptyVictim.players[0]!.resources).toEqual(emptyResources());
    expect(emptyVictim.thefts).toEqual([]);
    reject(state, { type: "end-turn" }, "mandatory choices");
    const before = structuredClone(state);
    state = applyAction(state, firstPlayer, { type: "steal", playerId: secondPlayer }, () => 0.3);
    expect(state.players[0]!.resources.ore).toBe(1);
    expect(state.players[1]!.resources).toEqual(resources({ wood: 1, ore: 2 }));
    expect(before.players[1]!.resources.ore).toBe(3);
    expect(before.thefts).toEqual([]);
    expect(state.thefts).toEqual([{ id: 1, thiefId: firstPlayer, victimId: secondPlayer, resource: "ore" }]);
    expect(state.phase).toEqual({ type: "actions" });
    expect(JSON.stringify(state.log.at(-1))).not.toContain("ore");
    expect(JSON.stringify(state.log.at(-1))).not.toContain("wood");
    assertConservation(state);
  });

  test("theft is weighted by cards, not resource types", () => {
    const state = actionState();
    state.phase = { type: "steal", victimIds: [secondPlayer], returnPhase: "roll" };
    give(state, secondPlayer, { wood: 1, ore: 3 });
    const low = applyAction(state, firstPlayer, { type: "steal", playerId: secondPlayer }, () => 0);
    const high = applyAction(state, firstPlayer, { type: "steal", playerId: secondPlayer }, () => 0.999999);
    expect(low.players[0]!.resources.wood).toBe(1);
    expect(high.players[0]!.resources.ore).toBe(1);
    expect(low.thefts).toEqual([{ id: 1, thiefId: firstPlayer, victimId: secondPlayer, resource: "wood" }]);
    expect(high.thefts).toEqual([{ id: 1, thiefId: firstPlayer, victimId: secondPlayer, resource: "ore" }]);
    expect(high.phase).toEqual({ type: "roll" });
  });

  test("no eligible victims returns immediately to the saved phase", () => {
    const state = actionState();
    state.phase = { type: "robber", returnPhase: "roll" };
    const tile = state.board.tiles.find(tile => tile.id !== state.robberTileId)!;
    const result = applyAction(state, firstPlayer, { type: "move-robber", tileId: tile.id });
    expect(result.phase).toEqual({ type: "roll" });
    expect(result.thefts).toEqual([]);
    reject(result, { type: "steal", playerId: secondPlayer }, "before choosing");
  });

  test("theft events have consecutive IDs across thieves and retain only the latest 100", () => {
    let state = actionState();
    give(state, secondPlayer, { wood: 1 });
    for (let id = 1; id <= 102; id++) {
      const thiefId = id % 2 === 1 ? firstPlayer : secondPlayer;
      const victimId = id % 2 === 1 ? secondPlayer : firstPlayer;
      state.activePlayerId = thiefId;
      state.phase = { type: "steal", victimIds: [victimId], returnPhase: "actions" };
      state = applyAction(state, thiefId, { type: "steal", playerId: victimId }, () => 0);
      expect(state.thefts.at(-1)).toEqual({ id, thiefId, victimId, resource: "wood" });
      expect(state.thefts).toHaveLength(Math.min(id, 100));
    }
    expect(state.thefts.map(theft => theft.id)).toEqual(Array.from({ length: 100 }, (_, index) => index + 3));
    expect(state.log).toHaveLength(100);
    assertConservation(state);
  });

  test("empty hands, spending, trades, discards and ordinary actions retain theft history", () => {
    let state = actionState();
    give(state, secondPlayer, { brick: 1 });
    state.phase = { type: "steal", victimIds: [secondPlayer], returnPhase: "actions" };
    state = applyAction(state, firstPlayer, { type: "steal", playerId: secondPlayer }, () => 0);
    const thefts = structuredClone(state.thefts);
    state.phase = { type: "steal", victimIds: [secondPlayer], returnPhase: "actions" };
    state = applyAction(state, firstPlayer, { type: "steal", playerId: secondPlayer });
    expect(state.thefts).toEqual(thefts);

    give(state, firstPlayer, { wood: 5, wool: 1, grain: 1, ore: 1 });
    state.board.vertices[0]!.building = { playerId: firstPlayer, kind: "settlement" };
    for (const action of [
      { type: "place-road", edgeId: legalRoadEdges(state, firstPlayer)[0]! },
      { type: "buy-development" },
      { type: "bank-trade", give: "wood", receive: "ore" },
    ] satisfies GameAction[]) {
      state = applyAction(state, firstPlayer, action);
      expect(state.thefts).toEqual(thefts);
    }
    state.phase = { type: "discard", required: { [firstPlayer]: 1 } };
    state = applyAction(state, firstPlayer, { type: "discard", resources: resources({ ore: 1 }) });
    expect(state.thefts).toEqual(thefts);
    state = applyAction(state, firstPlayer, { type: "move-robber", tileId: state.board.tiles.find(tile => tile.id !== state.robberTileId)!.id });
    expect(state.thefts).toEqual(thefts);
    state = applyAction(state, firstPlayer, { type: "end-turn" });
    expect(state.thefts).toEqual(thefts);
    state = applyAction(state, state.activePlayerId, { type: "roll" }, () => 0);
    expect(state.thefts).toEqual(thefts);
    assertConservation(state);
  });
});

describe("domestic and maritime trade", () => {
  test("bank trades four of one resource for one different available resource", () => {
    let state = actionState();
    give(state, firstPlayer, { wood: 4 });
    expect(getTradeRatio(state, firstPlayer, "wood")).toBe(4);
    reject(state, { type: "bank-trade", give: "wood", receive: "wood" }, "different resource");
    state = applyAction(state, firstPlayer, { type: "bank-trade", give: "wood", receive: "ore" });
    expect(state.players[0]!.resources).toEqual(resources({ ore: 1 }));
    assertConservation(state);
    reject(state, { type: "bank-trade", give: "wood", receive: "ore" }, "need 4 wood");
  });

  test("generic and specific port ownership grants best ratio immediately, without roads or robber restrictions", () => {
    let state = actionState();
    const generic = state.board.ports.find(port => port.resource === "any")!;
    const specific = state.board.ports.find(port => port.resource === "wood")!;
    for (const port of [generic, specific]) {
      const edge = state.board.edges.find(edge => edge.id === port.edgeId)!;
      state.board.vertices.find(vertex => vertex.id === edge.vertexIds[0])!.building = { playerId: firstPlayer, kind: "settlement" };
    }
    expect(getTradeRatio(state, firstPlayer, "wood")).toBe(2);
    expect(getTradeRatio(state, firstPlayer, "ore")).toBe(3);
    expect(getTradeRatio(state, secondPlayer, "wood")).toBe(4);
    give(state, firstPlayer, { wood: 2, ore: 3 });
    state = applyAction(state, firstPlayer, { type: "bank-trade", give: "wood", receive: "grain" });
    state = applyAction(state, firstPlayer, { type: "bank-trade", give: "ore", receive: "wool" });
    expect(state.players[0]!.resources).toEqual(resources({ grain: 1, wool: 1 }));
    assertConservation(state);
  });

  test("empty bank and unavailable ratios reject atomically", () => {
    const state = actionState();
    give(state, firstPlayer, { wood: 4 });
    give(state, secondPlayer, { ore: 19 });
    reject(state, { type: "bank-trade", give: "wood", receive: "ore" }, "no ore");
  });

  test("only the proposer completes one accepted exchange, after revalidating both inventories", () => {
    let state = actionState();
    give(state, firstPlayer, { wood: 2 });
    give(state, secondPlayer, { ore: 1 });
    give(state, thirdPlayer, { ore: 1 });
    const giveOffer = resources({ wood: 2 });
    state = applyAction(state, firstPlayer, { type: "offer-trade", give: giveOffer, receive: resources({ ore: 1 }) });
    giveOffer.wood = 99;
    expect(state.trade!.give!.wood).toBe(2);
    expect(state.players[0]!.resources.wood).toBe(2);
    reject(state, { type: "respond-trade", accept: true }, "Only other players");
    reject(state, { type: "complete-trade", playerId: secondPlayer }, "accepted");
    state = applyAction(state, secondPlayer, { type: "respond-trade", accept: true });
    state = applyAction(state, thirdPlayer, { type: "respond-trade", accept: true });
    reject(state, { type: "complete-trade", playerId: firstPlayer }, "Wait for your turn", secondPlayer);
    const stale = structuredClone(state);
    stale.players[1]!.resources.ore = 0;
    reject(stale, { type: "complete-trade", playerId: secondPlayer }, "still hold");
    const bank = { ...state.bank };
    state = applyAction(state, firstPlayer, { type: "complete-trade", playerId: secondPlayer });
    expect(state.players[0]!.resources).toEqual(resources({ ore: 1 }));
    expect(state.players[1]!.resources).toEqual(resources({ wood: 2 }));
    expect(state.players[2]!.resources).toEqual(resources({ ore: 1 }));
    expect(state.bank).toEqual(bank);
    expect(state.trade).toBeNull();
    reject(state, { type: "complete-trade", playerId: thirdPlayer }, "no open trade");
    assertConservation(state);
  });

  test("forbids gifts, exchanging same resource, impossible offers, unowned acceptance and off-turn offers", () => {
    let state = actionState();
    give(state, firstPlayer, { wood: 1 });
    reject(state, { type: "offer-trade", give: resources(), receive: resources({ ore: 1 }) }, "gifts");
    reject(state, { type: "offer-trade", give: resources({ wood: 1 }), receive: resources() }, "gifts");
    reject(state, { type: "offer-trade", give: resources({ wood: 1 }), receive: resources({ wood: 1 }) }, "same resource");
    reject(state, { type: "offer-trade", give: resources({ wood: 2 }), receive: resources({ ore: 1 }) }, "do not own");
    reject(state, { type: "offer-trade", give: resources({ ore: 1 }), receive: resources({ wood: 1 }) }, "Wait for your turn", secondPlayer);
    state = applyAction(state, firstPlayer, { type: "offer-trade", give: resources({ wood: 1 }), receive: resources({ ore: 1 }) });
    reject(state, { type: "respond-trade", accept: true }, "resources requested", secondPlayer);
    state = applyAction(state, secondPlayer, { type: "respond-trade", accept: false });
    expect(state.trade!.responses[secondPlayer]).toBe(false);
  });

  test("resource requests collect different prices without transferring cards until one is confirmed", () => {
    let state = actionState();
    give(state, firstPlayer, { wood: 2, grain: 1 });
    give(state, secondPlayer, { ore: 1 });
    give(state, thirdPlayer, { ore: 1 });
    const inventories = state.players.map(player => ({ ...player.resources }));
    const requested = resources({ ore: 1 });
    state = applyAction(state, firstPlayer, { type: "request-trade", receive: requested });
    requested.ore = 9;
    expect(state.trade!.give).toBeNull();
    expect(state.trade!.receive.ore).toBe(1);
    reject(state, { type: "complete-trade", playerId: secondPlayer }, "proposed a price");
    const price = resources({ wood: 2 });
    state = applyAction(state, secondPlayer, { type: "propose-trade", price });
    price.wood = 99;
    state = applyAction(state, thirdPlayer, { type: "propose-trade", price: resources({ grain: 1 }) });
    expect(state.trade!.responses[secondPlayer]).toEqual(resources({ wood: 2 }));
    expect(state.players.map(player => player.resources)).toEqual(inventories);
    reject(state, { type: "complete-trade", playerId: firstPlayer }, "Wait for your turn", secondPlayer);
    const bank = { ...state.bank };
    state = applyAction(state, firstPlayer, { type: "complete-trade", playerId: thirdPlayer });
    expect(state.players[0]!.resources).toEqual(resources({ wood: 2, ore: 1 }));
    expect(state.players[1]!.resources).toEqual(inventories[1]!);
    expect(state.players[2]!.resources).toEqual(resources({ grain: 1 }));
    expect(state.bank).toEqual(bank);
    expect(state.trade).toBeNull();
    reject(state, { type: "complete-trade", playerId: secondPlayer }, "no open trade");
    assertConservation(state);
  });

  test("prices require a valid request, different resources, and a responder who can supply it", () => {
    let state = actionState();
    give(state, secondPlayer, { ore: 1 });
    reject(state, { type: "request-trade", receive: resources() }, "at least one");
    reject(state, { type: "request-trade", receive: resources({ ore: 1 }) }, "Wait for your turn", secondPlayer);
    reject(state, { type: "propose-trade", price: resources({ wood: 1 }) }, "open resource request", secondPlayer);
    state = applyAction(state, firstPlayer, { type: "request-trade", receive: resources({ ore: 1 }) });
    reject(state, { type: "propose-trade", price: resources({ wood: 1 }) }, "Only other players");
    reject(state, { type: "respond-trade", accept: true }, "Propose a price", secondPlayer);
    reject(state, { type: "propose-trade", price: resources() }, "gifts", secondPlayer);
    reject(state, { type: "propose-trade", price: resources({ ore: 1 }) }, "same resource", secondPlayer);
    reject(state, { type: "propose-trade", price: resources({ wood: 1 }) }, "resources requested", thirdPlayer);
    for (const value of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      reject(state, { type: "request-trade", receive: resources({ ore: value }) }, "nonnegative whole number");
      reject(state, { type: "propose-trade", price: resources({ wood: value }) }, "nonnegative whole number", secondPlayer);
    }
    state = applyAction(state, secondPlayer, { type: "propose-trade", price: resources({ wood: 1 }) });
    state = applyAction(state, secondPlayer, { type: "respond-trade", accept: false });
    expect(state.trade!.responses[secondPlayer]).toBe(false);
    reject(state, { type: "complete-trade", playerId: secondPlayer }, "proposed a price");
    state = applyAction(state, secondPlayer, { type: "propose-trade", price: resources({ brick: 1 }) });
    expect(state.trade!.responses[secondPlayer]).toEqual(resources({ brick: 1 }));
    state = applyAction(state, firstPlayer, { type: "request-trade", receive: resources({ wool: 1 }) });
    expect(state.trade!.responses).toEqual({});
    state = applyAction(state, firstPlayer, { type: "cancel-trade" });
    reject(state, { type: "propose-trade", price: resources({ wood: 1 }) }, "open resource request", secondPlayer);
  });

  test("prices do not expose the requester's hand and both inventories are rechecked at confirmation", () => {
    let state = actionState();
    give(state, secondPlayer, { ore: 1 });
    state = applyAction(state, firstPlayer, { type: "request-trade", receive: resources({ ore: 1 }) });
    state = applyAction(state, secondPlayer, { type: "propose-trade", price: resources({ wood: 2 }) });
    reject(state, { type: "complete-trade", playerId: secondPlayer }, "still hold");
    give(state, firstPlayer, { wood: 2 });
    const stale = structuredClone(state);
    stale.players[1]!.resources.ore = 0;
    reject(stale, { type: "complete-trade", playerId: secondPlayer }, "still hold");
    state = applyAction(state, firstPlayer, { type: "offer-trade", give: resources({ wood: 2 }), receive: resources({ ore: 1 }) });
    reject(state, { type: "propose-trade", price: resources({ wood: 1 }) }, "open resource request", secondPlayer);
  });

  test.each(["offer", "request"])("cancel, turn end, or another substantive action clears stale %s trades", mode => {
    let state = actionState();
    give(state, firstPlayer, { wood: 4 });
    const offer: GameAction = mode === "offer"
      ? { type: "offer-trade", give: resources({ wood: 1 }), receive: resources({ ore: 1 }) }
      : { type: "request-trade", receive: resources({ ore: 1 }) };
    state = applyAction(state, firstPlayer, offer);
    const cancelled = applyAction(state, firstPlayer, { type: "cancel-trade" });
    expect(cancelled.trade).toBeNull();
    expect(cancelled.log.at(-1)).toEqual({ key: "{player} withdraws the trade offer.", parameters: { player: state.players[0]!.name } });
    const ended = applyAction(state, firstPlayer, { type: "end-turn" });
    expect(ended.trade).toBeNull();
    expect(ended.log.some(entry => entry.key === "{player} withdraws the trade offer.")).toBe(false);
    const traded = applyAction(state, firstPlayer, { type: "bank-trade", give: "wood", receive: "ore" });
    expect(traded.trade).toBeNull();
    expect(traded.log.some(entry => entry.key === "{player} withdraws the trade offer.")).toBe(false);
    reject(state, { type: "cancel-trade" }, "Wait for your turn", secondPlayer);
    const expired = applyAction(state, firstPlayer, { type: "end-turn" });
    reject(expired, { type: "respond-trade", accept: true }, "Roll the dice", thirdPlayer);
    reject(expired, { type: "propose-trade", price: resources({ wood: 1 }) }, "Roll the dice", secondPlayer);
  });
});

describe("development cards", () => {
  test("purchase charges the cost, privately draws the next card, and assigns unique purchase timing", () => {
    let state = actionState();
    give(state, firstPlayer, { wool: 2, grain: 2, ore: 2 });
    const next = state.developmentDeck.at(-1)!;
    state = applyAction(state, firstPlayer, { type: "buy-development" });
    state = applyAction(state, firstPlayer, { type: "buy-development" });
    const cards = state.players[0]!.developmentCards;
    expect(cards[0]!.kind).toBe(next);
    expect(cards[0]!.purchasedTurn).toBe(5);
    expect(cards[0]!.id).not.toBe(cards[1]!.id);
    expect(state.developmentDeck).toHaveLength(23);
    expect(state.players[0]!.resources).toEqual(emptyResources());
    expect(JSON.stringify(state.log.at(-1))).not.toContain(next);
    reject(state, { type: "buy-development" }, "resources required");
    state.developmentDeck = [];
    reject(state, { type: "buy-development" }, "deck is empty");
    assertConservation(state);
  });

  test("newly purchased cards, others' cards and victory-point cards cannot be played", () => {
    const state = actionState();
    const bought = card(state, "knight", firstPlayer, state.turnNumber);
    const other = card(state, "knight", secondPlayer);
    const victory = card(state, "victory-point");
    reject(state, { type: "play-development", cardId: bought }, "bought this turn");
    reject(state, { type: "play-development", cardId: other }, "own hand");
    reject(state, { type: "play-development", cardId: victory }, "count automatically");
    expect(getScore(state, firstPlayer)).toMatchObject({ public: 0, hidden: 1, total: 1 });
  });

  test("an older copy remains playable when another copy was bought this turn", () => {
    const state = actionState();
    card(state, "monopoly", firstPlayer, state.turnNumber);
    const older = card(state, "monopoly");
    const result = applyAction(state, firstPlayer, { type: "play-development", cardId: older, resource: "ore" });
    expect(result.players[0]!.developmentCards).toHaveLength(1);
    expect(result.players[0]!.developmentCards[0]!.purchasedTurn).toBe(state.turnNumber);
  });

  test("pre-roll Knight moves and steals without discards, returns to roll, and consumes the turn's card allowance", () => {
    let state = actionState();
    state.phase = { type: "roll" };
    give(state, secondPlayer, { wood: 9 });
    const knight = card(state, "knight");
    const secondKnight = card(state, "knight");
    const target = state.board.tiles.find(tile => tile.id !== state.robberTileId)!;
    state.board.vertices.find(vertex => vertex.id === target.vertexIds[0])!.building = { playerId: secondPlayer, kind: "settlement" };
    state = applyAction(state, firstPlayer, { type: "play-development", cardId: knight });
    expect(state.phase).toMatchObject({ type: "robber", returnPhase: "roll" });
    expect(state.players[0]!.knightsPlayed).toBe(1);
    reject(state, { type: "roll" }, "roll once");
    reject(state, { type: "play-development", cardId: secondKnight }, "mandatory choices");
    state = applyAction(state, firstPlayer, { type: "move-robber", tileId: target.id });
    state = applyAction(state, firstPlayer, { type: "steal", playerId: secondPlayer }, () => 0);
    expect(state.players[1]!.resources.wood).toBe(8);
    expect(state.phase.type).toBe("roll");
    reject(state, { type: "play-development", cardId: secondKnight }, "one development card");
    state = applyAction(state, firstPlayer, { type: "roll" }, () => 0);
    reject(state, { type: "play-development", cardId: secondKnight }, "one development card");
    state = applyAction(state, firstPlayer, { type: "end-turn" });
    expect(state.developmentPlayed).toBe(false);
    assertConservation(state);
  });

  test("Knight may be played after resolving a seven to move the robber again", () => {
    let state = actionState();
    const knight = card(state, "knight");
    state.phase = { type: "robber", returnPhase: "actions" };
    const target = state.board.tiles.find(tile => tile.id !== state.robberTileId)!;
    state = applyAction(state, firstPlayer, { type: "move-robber", tileId: target.id });
    state = applyAction(state, firstPlayer, { type: "play-development", cardId: knight });
    expect(state.phase).toMatchObject({ type: "robber", returnPhase: "actions" });
  });

  test.each(["roll", "actions"] as const)("cancel Knight restores the hand and %s phase before moving the robber", phase => {
    const original = actionState();
    original.phase = { type: phase };
    original.dice = phase === "actions" ? [2, 3] : null;
    card(original, "victory-point");
    const knight = card(original, "knight");
    const monopoly = card(original, "monopoly");
    const pending = applyAction(original, firstPlayer, { type: "play-development", cardId: knight });
    const beforeCancel = structuredClone(pending);
    const restored = applyAction(pending, firstPlayer, { type: "cancel-knight" });
    expect(pending).toEqual(beforeCancel);
    expect({ ...restored, log: original.log }).toEqual(original);
    expect(formatGameMessage("en", restored.log.at(-1)!)).toBe("Ada cancels Knight.");
    reject(restored, { type: "cancel-knight" }, "no Knight");
    const replayed = applyAction(restored, firstPlayer, { type: "play-development", cardId: knight });
    expect(replayed.players[0]!.knightsPlayed).toBe(1);
    expect(replayed.developmentPlayed).toBe(true);
    const different = applyAction(restored, firstPlayer, { type: "play-development", cardId: monopoly, resource: "ore" });
    expect(different.players[0]!.developmentCards.some(card => card.id === knight)).toBe(true);
    expect(different.developmentPlayed).toBe(true);
    assertConservation(restored);
  });

  test.each([null, firstPlayer, secondPlayer])("cancel Knight restores Largest Army to %s, including a previous tied holder", previousHolder => {
    const original = actionState();
    original.players[0]!.knightsPlayed = previousHolder === null ? 2 : 3;
    original.players[1]!.knightsPlayed = previousHolder === null ? 2 : 3;
    original.awards.largestArmy = previousHolder;
    const knight = card(original, "knight");
    const pending = applyAction(original, firstPlayer, { type: "play-development", cardId: knight });
    expect(pending.awards.largestArmy).toBe(firstPlayer);
    const restored = applyAction(pending, firstPlayer, { type: "cancel-knight" });
    expect(restored.awards).toEqual(original.awards);
    expect(restored.players).toEqual(original.players);
    expect(getScore(restored, firstPlayer)).toEqual(getScore(original, firstPlayer));
    expect(getScore(restored, secondPlayer)).toEqual(getScore(original, secondPlayer));
  });

  test("cancel Knight rejects other players, ordinary robber moves, and other development effects", () => {
    const original = actionState();
    const knight = card(original, "knight");
    const pending = applyAction(original, firstPlayer, { type: "play-development", cardId: knight });
    reject(pending, { type: "cancel-knight" }, "Wait for your turn", secondPlayer);
    original.phase = { type: "roll" };
    let diceIndex = 0;
    const seven = applyAction(original, firstPlayer, { type: "roll" }, () => ([3, 4][diceIndex++]! - 0.5) / 6);
    expect(seven.phase.type).toBe("robber");
    reject(seven, { type: "cancel-knight" }, "no Knight");
    give(original, secondPlayer, { wood: 8 });
    diceIndex = 0;
    const discard = applyAction(original, firstPlayer, { type: "roll" }, () => ([3, 4][diceIndex++]! - 0.5) / 6);
    reject(discard, { type: "cancel-knight" }, "no Knight");
    const afterDiscard = applyAction(discard, secondPlayer, { type: "discard", resources: resources({ wood: 4 }) });
    reject(afterDiscard, { type: "cancel-knight" }, "no Knight");
    original.phase = { type: "road-building", remaining: 2, returnPhase: "roll" };
    reject(original, { type: "cancel-knight" }, "no Knight");
  });

  test.each([false, true])("cancel Knight is unavailable after confirming a robber move (victim: %s)", hasVictim => {
    const original = actionState();
    const knight = card(original, "knight");
    const target = original.board.tiles.find(tile => tile.id !== original.robberTileId)!;
    if (hasVictim) {
      original.board.vertices.find(vertex => vertex.id === target.vertexIds[0])!.building = { playerId: secondPlayer, kind: "settlement" };
      give(original, secondPlayer, { wood: 1 });
    }
    const pending = applyAction(original, firstPlayer, { type: "play-development", cardId: knight });
    reject(pending, { type: "move-robber", tileId: original.robberTileId }, "different land hex");
    expect(applyAction(pending, firstPlayer, { type: "cancel-knight" }).players).toEqual(original.players);
    let committed = applyAction(pending, firstPlayer, { type: "move-robber", tileId: target.id });
    expect(committed.phase.type).toBe(hasVictim ? "steal" : "actions");
    reject(committed, { type: "cancel-knight" }, "no Knight");
    if (hasVictim) {
      committed = applyAction(committed, firstPlayer, { type: "steal", playerId: secondPlayer }, () => 0);
      reject(committed, { type: "cancel-knight" }, "no Knight");
    }
    expect(committed.players[0]!.developmentCards).toHaveLength(0);
    expect(committed.players[0]!.knightsPlayed).toBe(1);
    expect(committed.developmentPlayed).toBe(true);
  });

  test("Year of Plenty takes exactly two available cards of the same or different resources, even before rolling", () => {
    const state = actionState();
    state.phase = { type: "roll" };
    const development = card(state, "year-of-plenty");
    reject(state, { type: "play-development", cardId: development, resources: resources({ wood: 1 }) }, "exactly 2");
    const same = applyAction(state, firstPlayer, { type: "play-development", cardId: development, resources: resources({ ore: 2 }) });
    expect(same.players[0]!.resources.ore).toBe(2);
    expect(same.phase).toEqual({ type: "roll" });
    const different = applyAction(state, firstPlayer, { type: "play-development", cardId: development, resources: resources({ wood: 1, brick: 1 }) });
    expect(different.players[0]!.resources).toEqual(resources({ wood: 1, brick: 1 }));
    assertConservation(different);
  });

  test("Year of Plenty respects exhausted resource stacks and the one-card bank exception", () => {
    const state = actionState();
    const development = card(state, "year-of-plenty");
    give(state, secondPlayer, { ore: 19 });
    reject(state, { type: "play-development", cardId: development, resources: resources({ ore: 2 }) }, "available in the bank");
    give(state, secondPlayer, { wood: 19, brick: 19, wool: 19, grain: 18 });
    const result = applyAction(state, firstPlayer, { type: "play-development", cardId: development, resources: resources({ grain: 1 }) });
    expect(result.players[0]!.resources.grain).toBe(1);
    assertConservation(result);
    give(state, secondPlayer, { grain: 1 });
    reject(state, { type: "play-development", cardId: development, resources: resources() }, "no resources available");
  });

  test("Monopoly takes every chosen card from all opponents but none from the bank, even pre-roll", () => {
    const state = actionState();
    state.phase = { type: "roll" };
    const development = card(state, "monopoly");
    give(state, firstPlayer, { ore: 1 });
    give(state, secondPlayer, { ore: 3, wood: 2 });
    give(state, thirdPlayer, { ore: 5 });
    reject(state, { type: "play-development", cardId: development }, "Choose the resource");
    const result = applyAction(state, firstPlayer, { type: "play-development", cardId: development, resource: "ore" });
    expect(result.players[0]!.resources.ore).toBe(9);
    expect(result.players[1]!.resources).toEqual(resources({ wood: 2 }));
    expect(result.players[2]!.resources.ore).toBe(0);
    expect(result.bank).toEqual(state.bank);
    expect(result.phase.type).toBe("roll");
    expect(result.monopolies).toEqual([{ id: 1, playerId: firstPlayer, resource: "ore", losses: { [secondPlayer]: 3, [thirdPlayer]: 5 } }]);
    assertConservation(result);
  });

  test("Monopoly may choose a resource nobody owns", () => {
    const state = actionState();
    const development = card(state, "monopoly");
    const result = applyAction(state, firstPlayer, { type: "play-development", cardId: development, resource: "ore" });
    expect(result.players[0]!.resources).toEqual(emptyResources());
    expect(result.developmentPlayed).toBe(true);
    expect(result.monopolies).toEqual([]);
  });

  test("monopoly events have consecutive IDs across players, survive ordinary actions, and retain only the latest 100", () => {
    let state = actionState();
    for (let id = 1; id <= 102; id++) {
      const monopolist = id % 2 === 1 ? firstPlayer : secondPlayer;
      const victim = id % 2 === 1 ? secondPlayer : firstPlayer;
      const victimPlayer = state.players.find(player => player.id === victim)!;
      if (victimPlayer.resources.ore === 0) give(state, victim, { ore: 1 });
      state.activePlayerId = monopolist;
      state.developmentPlayed = false;
      state = applyAction(state, monopolist, { type: "play-development", cardId: card(state, "monopoly", monopolist), resource: "ore" });
      expect(state.monopolies.at(-1)).toEqual({ id, playerId: monopolist, resource: "ore", losses: { [victim]: 1 } });
      expect(state.monopolies).toHaveLength(Math.min(id, 100));
    }
    expect(state.monopolies.map(monopoly => monopoly.id)).toEqual(Array.from({ length: 100 }, (_, index) => index + 3));
    const monopolies = structuredClone(state.monopolies);
    state = applyAction(state, state.activePlayerId, { type: "end-turn" });
    state = applyAction(state, state.activePlayerId, { type: "roll" }, () => 0);
    expect(state.monopolies).toEqual(monopolies);
    assertConservation(state);
  });

  test("Road Building places two free roads sequentially with normal connectivity and restores pre-roll", () => {
    let state = graphState([
      { playerId: firstPlayer, vertices: ["a", "b"] }, { playerId: null, vertices: ["b", "c", "d"] },
    ]);
    state.phase = { type: "roll" };
    const development = card(state, "road-building");
    state = applyAction(state, firstPlayer, { type: "play-development", cardId: development });
    expect(state.phase).toEqual({ type: "road-building", remaining: 2, returnPhase: "roll" });
    reject(state, { type: "place-road", edgeId: "edge-2" }, "empty edge");
    reject(state, { type: "roll" }, "roll once");
    state = applyAction(state, firstPlayer, { type: "place-road", edgeId: "edge-1" });
    expect(state.phase).toEqual({ type: "road-building", remaining: 1, returnPhase: "roll" });
    state = applyAction(state, firstPlayer, { type: "place-road", edgeId: "edge-2" });
    expect(state.phase).toEqual({ type: "roll" });
    expect(state.players[0]!.resources).toEqual(emptyResources());
    expect(getLongestRoadLength(state, firstPlayer)).toBe(3);
    assertConservation(state);
  });

  test("Road Building handles one piece left, no pieces left, no sites, and rejects skipping legal roads", () => {
    let state = graphState([
      { playerId: firstPlayer, vertices: Array.from({ length: 15 }, (_, index) => `road-${index}`) },
      { playerId: null, vertices: ["road-14", "last", "unreachable"] },
    ]);
    let development = card(state, "road-building");
    state = applyAction(state, firstPlayer, { type: "play-development", cardId: development });
    expect(state.phase).toEqual({ type: "road-building", remaining: 1, returnPhase: "actions" });
    state = applyAction(state, firstPlayer, { type: "place-road", edgeId: "edge-14" });
    expect(state.phase).toEqual({ type: "actions" });
    state.developmentPlayed = false;
    development = card(state, "road-building");
    reject(state, { type: "play-development", cardId: development }, "road piece remaining");
    state = graphState([{ playerId: firstPlayer, vertices: ["a", "b"] }]);
    development = card(state, "road-building");
    const noSites = applyAction(state, firstPlayer, { type: "play-development", cardId: development });
    expect(noSites.phase).toEqual({ type: "actions" });
    state = graphState([{ playerId: firstPlayer, vertices: ["a", "b"] }, { playerId: null, vertices: ["b", "c", "d"] }]);
    development = card(state, "road-building");
    state = applyAction(state, firstPlayer, { type: "play-development", cardId: development });
    reject(state, { type: "skip-roads" }, "remaining free roads");
    state = applyAction(state, firstPlayer, { type: "place-road", edgeId: "edge-1" });
    reject(state, { type: "skip-roads" }, "remaining free roads");
    state = applyAction(state, firstPlayer, { type: "place-road", edgeId: "edge-2" });
    expect(state.phase).toEqual({ type: "actions" });
    expect(state.developmentPlayed).toBe(true);
    reject(state, { type: "skip-roads" }, "no free roads");
  });

  test("Road Building finishes automatically when the final legal site is used", () => {
    let state = graphState([{ playerId: firstPlayer, vertices: ["a", "b"] }, { playerId: null, vertices: ["b", "c"] }]);
    const development = card(state, "road-building");
    state = applyAction(state, firstPlayer, { type: "play-development", cardId: development });
    state = applyAction(state, firstPlayer, { type: "place-road", edgeId: "edge-1" });
    expect(state.phase).toEqual({ type: "actions" });
  });
});

describe("longest road graph and award ties", () => {
  test("branches choose the longest trail, not total road count", () => {
    const state = graphState([
      { playerId: firstPlayer, vertices: ["a", "b", "center", "d", "e"] },
      { playerId: firstPlayer, vertices: ["center", "f", "g", "h"] },
    ]);
    expect(getLongestRoadLength(state, firstPlayer)).toBe(5);
    expect(getLongestRoadLength(state, secondPlayer)).toBe(0);
  });

  test("a loop counts every edge, with a stem but no repeated edges", () => {
    const state = graphState([
      { playerId: firstPlayer, vertices: ["a", "b", "c", "d", "e", "f", "a"] },
      { playerId: firstPlayer, vertices: ["a", "g", "h"] },
    ]);
    expect(getLongestRoadLength(state, firstPlayer)).toBe(8);
  });

  test("two loops joined by a bridge can form one edge-simple trail", () => {
    const state = graphState([
      { playerId: firstPlayer, vertices: ["a", "b", "c", "d", "e", "f", "a"] },
      { playerId: firstPlayer, vertices: ["a", "g"] },
      { playerId: firstPlayer, vertices: ["g", "h", "i", "j", "k", "l", "g"] },
    ]);
    expect(getLongestRoadLength(state, firstPlayer)).toBe(13);
  });

  test("a loop with two tails cannot count both tails and every loop edge", () => {
    const state = graphState([
      { playerId: firstPlayer, vertices: ["a", "b", "c", "d", "e", "f", "a"] },
      { playerId: firstPlayer, vertices: ["a", "g"] },
      { playerId: firstPlayer, vertices: ["d", "h"] },
    ]);
    expect(getLongestRoadLength(state, firstPlayer)).toBe(7);
  });

  test("opponent buildings stop traversal but roads may end there; own buildings do not block", () => {
    const state = graphState([{ playerId: firstPlayer, vertices: ["a", "b", "c", "d", "e", "f", "g"] }], {
      d: { playerId: secondPlayer, kind: "settlement" },
    });
    expect(getLongestRoadLength(state, firstPlayer)).toBe(3);
    state.board.vertices.find(vertex => vertex.id === "d")!.building!.playerId = firstPlayer;
    expect(getLongestRoadLength(state, firstPlayer)).toBe(6);
  });

  test("an opposing building on a ring leaves all six edges countable but blocks an attached tail", () => {
    const state = graphState([
      { playerId: firstPlayer, vertices: ["a", "b", "c", "d", "e", "f", "a"] },
      { playerId: firstPlayer, vertices: ["a", "tail"] },
    ], { a: { playerId: secondPlayer, kind: "city" } });
    expect(getLongestRoadLength(state, firstPlayer)).toBe(6);
  });

  test("disconnected segments and opponents' roads do not combine", () => {
    const state = graphState([
      { playerId: firstPlayer, vertices: ["a", "b", "c"] },
      { playerId: secondPlayer, vertices: ["c", "d"] },
      { playerId: firstPlayer, vertices: ["d", "e", "f", "g"] },
    ]);
    expect(getLongestRoadLength(state, firstPlayer)).toBe(3);
  });

  test("threshold is five; tied challengers cannot take the current holder's award", () => {
    let state = graphState([
      { playerId: firstPlayer, vertices: ["a", "b", "c", "d", "e", "f"] },
      { playerId: secondPlayer, vertices: ["g", "h", "i", "j", "k"] },
      { playerId: null, vertices: ["k", "l", "m"] },
    ]);
    state = refreshAwards(state);
    expect(state.awards.longestRoad).toBe(firstPlayer);
    expect(getScore(state, firstPlayer).longestRoad).toBe(2);
    state.activePlayerId = secondPlayer;
    give(state, secondPlayer, { wood: 2, brick: 2 });
    state = applyAction(state, secondPlayer, { type: "place-road", edgeId: "edge-9" });
    expect(state.awards.longestRoad).toBe(firstPlayer);
    state = applyAction(state, secondPlayer, { type: "place-road", edgeId: "edge-10" });
    expect(state.awards.longestRoad).toBe(secondPlayer);
    expect(getScore(state, firstPlayer).longestRoad).toBe(0);
  });

  test("no incumbent and a tie means no award", () => {
    const state = graphState([
      { playerId: firstPlayer, vertices: ["a", "b", "c", "d", "e", "f"] },
      { playerId: secondPlayer, vertices: ["g", "h", "i", "j", "k", "l"] },
    ]);
    expect(refreshAwards(state).awards.longestRoad).toBeNull();
  });

  test("breaking the holder's road clears the award when multiple challengers tie", () => {
    let state = graphState([
      { playerId: firstPlayer, vertices: ["a0", "a1", "a2", "a3", "a4", "a5", "a6", "a7"] },
      { playerId: secondPlayer, vertices: ["b0", "b1", "b2", "b3", "b4", "b5"] },
      { playerId: thirdPlayer, vertices: ["a3", "c1", "c2", "c3", "c4", "c5"] },
    ]);
    state = refreshAwards(state);
    expect(state.awards.longestRoad).toBe(firstPlayer);
    state.activePlayerId = thirdPlayer;
    give(state, thirdPlayer, COSTS.settlement);
    state = applyAction(state, thirdPlayer, { type: "place-settlement", vertexId: "a3" });
    expect(getLongestRoadLength(state, firstPlayer)).toBe(4);
    expect(state.awards.longestRoad).toBeNull();
  });

  test("breaking a road transfers the award to a unique qualifying challenger", () => {
    let state = graphState([
      { playerId: firstPlayer, vertices: ["a0", "a1", "a2", "a3", "a4", "a5", "a6", "a7"] },
      { playerId: secondPlayer, vertices: ["b0", "b1", "b2", "b3", "b4", "b5"] },
      { playerId: thirdPlayer, vertices: ["a3", "c1"] },
    ]);
    state = refreshAwards(state);
    state.activePlayerId = thirdPlayer;
    give(state, thirdPlayer, COSTS.settlement);
    state = applyAction(state, thirdPlayer, { type: "place-settlement", vertexId: "a3" });
    expect(state.awards.longestRoad).toBe(secondPlayer);
  });

  test("Largest Army needs three played knights, retains ties, and transfers only when surpassed", () => {
    let state = actionState();
    state.players[0]!.knightsPlayed = 2;
    state.players[1]!.knightsPlayed = 2;
    card(state, "knight", thirdPlayer);
    state = refreshAwards(state);
    expect(state.awards.largestArmy).toBeNull();
    const knight = card(state, "knight");
    state = applyAction(state, firstPlayer, { type: "play-development", cardId: knight });
    expect(state.awards.largestArmy).toBe(firstPlayer);
    expect(getScore(state, firstPlayer).largestArmy).toBe(2);
    state.players[1]!.knightsPlayed = 3;
    state = refreshAwards(state);
    expect(state.awards.largestArmy).toBe(firstPlayer);
    state.players[1]!.knightsPlayed = 4;
    state = refreshAwards(state);
    expect(state.awards.largestArmy).toBe(secondPlayer);
  });
});

describe("victory, turns and atomic validation", () => {
  test("newly purchased hidden victory points win immediately despite a card already played this turn", () => {
    const buildings = Object.fromEntries(Array.from({ length: 4 }, (_, index) => [`city${index}`, { playerId: firstPlayer, kind: "city" as const }]));
    let state = graphState([], { ...buildings, settlement: { playerId: firstPlayer, kind: "settlement" } });
    state.developmentPlayed = true;
    state.developmentDeck = ["victory-point"];
    give(state, firstPlayer, COSTS.development);
    state = applyAction(state, firstPlayer, { type: "buy-development" });
    expect(state.winnerId).toBe(firstPlayer);
    expect(state.phase).toEqual({ type: "finished" });
    expect(getScore(state, firstPlayer)).toEqual({ public: 9, total: 10, settlements: 1, cities: 8, hidden: 1, longestRoad: 0, largestArmy: 0 });
    reject(state, { type: "end-turn" }, "game is finished");
  });

  test("own-turn award victory is immediate without requiring remaining Knight choices", () => {
    const buildings = Object.fromEntries(Array.from({ length: 4 }, (_, index) => [`city${index}`, { playerId: firstPlayer, kind: "city" as const }]));
    let state = graphState([], buildings);
    state.phase = { type: "roll" };
    state.players[0]!.knightsPlayed = 2;
    const knight = card(state, "knight");
    state = applyAction(state, firstPlayer, { type: "play-development", cardId: knight });
    expect(state.winnerId).toBe(firstPlayer);
    expect(state.dice).toBeNull();
    expect(state.phase.type).toBe("finished");
    reject(state, { type: "cancel-knight" }, "game is finished");
  });

  test("off-turn road award does not win until that player's turn begins, before rolling", () => {
    const cities = Object.fromEntries(Array.from({ length: 4 }, (_, index) => [`city${index}`, { playerId: thirdPlayer, kind: "city" as const }]));
    let state = graphState([
      { playerId: firstPlayer, vertices: ["a0", "a1", "a2", "a3", "a4", "a5", "a6"] },
      { playerId: secondPlayer, vertices: ["a3", "junction"] },
      { playerId: thirdPlayer, vertices: ["b0", "b1", "b2", "b3", "b4", "b5"] },
    ], cities);
    state = refreshAwards(state);
    state.activePlayerId = secondPlayer;
    give(state, secondPlayer, COSTS.settlement);
    state = applyAction(state, secondPlayer, { type: "place-settlement", vertexId: "a3" });
    expect(state.awards.longestRoad).toBe(thirdPlayer);
    expect(getScore(state, thirdPlayer).total).toBe(10);
    expect(state.winnerId).toBeNull();
    state = applyAction(state, secondPlayer, { type: "end-turn" });
    expect(state.activePlayerId).toBe(thirdPlayer);
    expect(state.winnerId).toBe(thirdPlayer);
    expect(state.phase.type).toBe("finished");
  });

  test("turn advancement wraps order, resets dice and card use, and forbids ending before roll", () => {
    let state = finishSetup();
    reject(state, { type: "end-turn" }, "Roll the dice");
    for (let index = 0; index < 3; index++) {
      const active = state.activePlayerId;
      state = applyAction(state, active, { type: "roll" }, () => 0);
      state.developmentPlayed = true;
      state = applyAction(state, active, { type: "end-turn" });
      expect(state.turnNumber).toBe(index + 2);
      expect(state.dice).toBeNull();
      expect(state.developmentPlayed).toBe(false);
      expect(state.phase.type).toBe("roll");
    }
    expect(state.activePlayerId).toBe(firstPlayer);
  });

  test("all turn-only intents reject other players, and unknown seats reject every action", () => {
    const state = actionState();
    const actions: GameAction[] = [
      { type: "place-settlement", vertexId: "vertex-0" }, { type: "place-city", vertexId: "vertex-0" },
      { type: "place-road", edgeId: "edge-0" }, { type: "roll" }, { type: "end-turn" },
      { type: "move-robber", tileId: "tile-0" }, { type: "steal", playerId: thirdPlayer },
      { type: "bank-trade", give: "wood", receive: "ore" },
      { type: "offer-trade", give: resources({ wood: 1 }), receive: resources({ ore: 1 }) },
      { type: "complete-trade", playerId: thirdPlayer }, { type: "cancel-trade" },
      { type: "buy-development" }, { type: "play-development", cardId: "card" }, { type: "skip-roads" },
    ];
    for (const action of actions) {
      reject(state, action, "Wait for your turn", secondPlayer);
      reject(state, action, "not seated", "stranger");
    }
    reject(state, { type: "discard", resources: resources() }, "not seated", "stranger");
    reject(state, { type: "respond-trade", accept: true }, "not seated", "stranger");
  });

  test.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("malformed resource counts reject atomically: %s", value => {
    const state = actionState();
    give(state, firstPlayer, { wood: 2 });
    reject(state, { type: "offer-trade", give: resources({ wood: value }), receive: resources({ ore: 1 }) }, "nonnegative whole number");
    state.phase = { type: "discard", required: { [firstPlayer]: 1 } };
    reject(state, { type: "discard", resources: resources({ wood: value }) }, "nonnegative whole number");
  });

  test("missing fields, extra resource fields and invalid resource identities are rejected", () => {
    const state = actionState();
    reject(state, { type: "offer-trade", give: { wood: 1 } as Resources, receive: resources({ ore: 1 }) }, "nonnegative whole number");
    reject(state, { type: "offer-trade", give: { ...resources({ wood: 1 }), gold: 1 } as Resources, receive: resources({ ore: 1 }) }, "nonnegative whole number");
    reject(state, { type: "bank-trade", give: "gold", receive: "ore" } as unknown as GameAction, "different resource");
  });

  test("accepted state shares no mutable structures with its source or resource action payload", () => {
    const state = actionState();
    give(state, firstPlayer, { wood: 2 });
    const action: GameAction = { type: "offer-trade", give: resources({ wood: 1 }), receive: resources({ ore: 1 }) };
    const before = structuredClone(state);
    const result = applyAction(state, firstPlayer, action);
    result.board.tiles[0]!.terrain = "desert";
    result.players[0]!.resources.wood = 99;
    result.trade!.give!.wood = 99;
    expect(state).toEqual(before);
    expect(action.give.wood).toBe(1);
  });

  test.each([3, 4])("a complete deterministic %s-player legal match reaches victory without synthetic state mutations", count => {
    let seed = 2813;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    let state = createGame(profiles.slice(0, count), random);
    const actions = new Set<GameAction["type"]>();
    let steps = 0;
    const perform = (action: GameAction, playerId = state.activePlayerId) => {
      const before = structuredClone(state);
      const result = applyAction(state, playerId, action, random);
      expect(state).toEqual(before);
      state = result;
      actions.add(action.type);
      steps++;
      assertConservation(state);
      expect(state.log.length).toBeLessThanOrEqual(100);
      for (const player of state.players) {
        expect(state.board.edges.filter(edge => edge.playerId === player.id).length).toBeLessThanOrEqual(15);
        expect(state.board.vertices.filter(vertex => vertex.building?.playerId === player.id && vertex.building.kind === "settlement").length).toBeLessThanOrEqual(5);
        expect(state.board.vertices.filter(vertex => vertex.building?.playerId === player.id && vertex.building.kind === "city").length).toBeLessThanOrEqual(4);
      }
    };
    const vertexValue = (vertexId: string) => {
      const vertex = state.board.vertices.find(vertex => vertex.id === vertexId)!;
      return vertex.tileIds.reduce((value, tileId) => {
        const tile = state.board.tiles.find(tile => tile.id === tileId)!;
        return value + (tile.number === null ? 0 : 6 - Math.abs(tile.number - 7)) *
          (tile.terrain === "ore" || tile.terrain === "grain" ? 1.2 : 1);
      }, 0);
    };
    const bestRoad = () => legalRoadEdges(state, state.activePlayerId).sort((first, second) => {
      const score = (edgeId: string) => Math.max(...state.board.edges.find(edge => edge.id === edgeId)!.vertexIds.map(vertexValue));
      return score(second) - score(first);
    })[0];

    while (!state.winnerId && steps < 5000) {
      const active = state.players.find(player => player.id === state.activePlayerId)!;
      if (state.phase.type === "setup-settlement") {
        const locations = legalSettlementVertices(state, active.id).sort((first, second) => vertexValue(second) - vertexValue(first));
        perform({ type: "place-settlement", vertexId: locations[0]! });
      } else if (state.phase.type === "setup-road" || state.phase.type === "road-building") {
        const edgeId = bestRoad();
        expect(edgeId).toBeDefined();
        perform({ type: "place-road", edgeId: edgeId! });
      } else if (state.phase.type === "roll") {
        perform({ type: "roll" });
      } else if (state.phase.type === "discard") {
        const [playerId, count] = Object.entries(state.phase.required)[0]!;
        const player = state.players.find(player => player.id === playerId)!;
        const discard = emptyResources();
        for (let index = 0; index < count; index++) {
          const resource = [...RESOURCES].sort((first, second) => (player.resources[second] - discard[second]) - (player.resources[first] - discard[first]))[0]!;
          discard[resource]++;
        }
        perform({ type: "discard", resources: discard }, playerId);
      } else if (state.phase.type === "robber") {
        const targets = state.board.tiles.filter(tile => tile.id !== state.robberTileId).sort((first, second) => {
          const score = (tile: typeof first) => tile.vertexIds.reduce((value, id) => {
            const building = state.board.vertices.find(vertex => vertex.id === id)!.building;
            return value + (!building ? 0 : building.playerId === active.id ? -10 : 1);
          }, 0);
          return score(second) - score(first);
        });
        perform({ type: "move-robber", tileId: targets[0]!.id });
      } else if (state.phase.type === "steal") {
        const victims = [...state.phase.victimIds].sort((first, second) =>
          resourceTotal(state.players.find(player => player.id === second)!.resources) - resourceTotal(state.players.find(player => player.id === first)!.resources));
        perform({ type: "steal", playerId: victims[0]! });
      } else if (state.phase.type === "actions") {
        const development = !state.developmentPlayed && active.developmentCards.find(card =>
          card.kind !== "victory-point" && card.purchasedTurn < state.turnNumber &&
          (card.kind !== "road-building" || state.board.edges.filter(edge => edge.playerId === active.id).length < 15));
        if (development) {
          const selected = emptyResources();
          for (let index = 0; index < Math.min(2, resourceTotal(state.bank)); index++) {
            const available = RESOURCES.filter(resource => state.bank[resource] > selected[resource]);
            available.sort((first, second) => active.resources[first] + selected[first] - active.resources[second] - selected[second]);
            selected[available[0]!]++;
          }
          const monopoly = [...RESOURCES].sort((first, second) =>
            state.players.filter(player => player.id !== active.id).reduce((total, player) => total + player.resources[second] - player.resources[first], 0))[0]!;
          if (development.kind !== "year-of-plenty" || resourceTotal(selected) > 0) {
            perform({ type: "play-development", cardId: development.id, resources: selected, resource: monopoly });
            continue;
          }
        }
        const candidates: { action: GameAction; cost: Resources }[] = [];
        const settlement = legalSettlementVertices(state, active.id).sort((first, second) => vertexValue(second) - vertexValue(first))[0];
        const city = legalCityVertices(state, active.id).sort((first, second) => vertexValue(second) - vertexValue(first))[0];
        const road = bestRoad();
        if (settlement) candidates.push({ action: { type: "place-settlement", vertexId: settlement }, cost: COSTS.settlement });
        if (city) candidates.push({ action: { type: "place-city", vertexId: city }, cost: COSTS.city });
        if (state.developmentDeck.length > 0) candidates.push({ action: { type: "buy-development" }, cost: COSTS.development });
        if (road) candidates.push({ action: { type: "place-road", edgeId: road }, cost: COSTS.road });
        const affordable = candidates.find(candidate => RESOURCES.every(resource => active.resources[resource] >= candidate.cost[resource]));
        if (affordable) {
          perform(affordable.action);
          continue;
        }
        const target = candidates[0];
        let traded = false;
        if (target) {
          const needed = RESOURCES.find(resource => active.resources[resource] < target.cost[resource]);
          if (needed) {
            const surplus = RESOURCES.find(resource => active.resources[resource] - target.cost[resource] >= getTradeRatio(state, active.id, resource));
            if (surplus && state.bank[needed] > 0) {
              perform({ type: "bank-trade", give: surplus, receive: needed });
              traded = true;
            } else {
              const giveResource = RESOURCES.find(resource => active.resources[resource] > target.cost[resource]);
              const partner = state.players.find(player => player.id !== active.id && player.resources[needed] > 0);
              if (giveResource && partner) {
                perform({ type: "offer-trade", give: resources({ [giveResource]: 1 }), receive: resources({ [needed]: 1 }) });
                perform({ type: "respond-trade", accept: true }, partner.id);
                perform({ type: "complete-trade", playerId: partner.id });
                traded = true;
              }
            }
          }
        }
        if (!traded) perform({ type: "end-turn" });
      }
    }
    expect(steps).toBeLessThan(5000);
    expect(state.winnerId).not.toBeNull();
    expect(state.phase).toEqual({ type: "finished" });
    expect(getScore(state, state.winnerId!).total).toBeGreaterThanOrEqual(10);
    for (const type of ["place-settlement", "place-road", "place-city", "roll", "discard", "move-robber", "steal", "buy-development", "play-development", "offer-trade", "respond-trade", "complete-trade", "bank-trade", "end-turn"] as const) {
      expect(actions.has(type)).toBe(true);
    }
  }, 30000);
});
