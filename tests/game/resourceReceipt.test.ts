import { describe, expect, test } from "bun:test";
import {
  applyAction, COSTS, createGame, emptyResources, legalRoadEdges, legalSettlementVertices, RESOURCES, resourceTotal,
} from "../../src/game/engine";
import type { DevelopmentKind, GameState, Player, Resources } from "../../src/game/types";
import { getResourceGains } from "../../src/resourceReceipt";
import { isResource } from "../../src/game/board";

const profiles: Pick<Player, "name" | "color" | "control">[] = [
  { name: "Ada", color: "red", control: "human" }, { name: "Grace", color: "blue", control: "human" },
  { name: "Linus", color: "white", control: "human" },
];
const firstPlayer = "player-1";
const secondPlayer = "player-2";
const thirdPlayer = "player-3";
const resources = (values: Partial<Resources> = {}): Resources => ({ ...emptyResources(), ...values });
const newGame = (): GameState => createGame(profiles, () => 0.999999);

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

function card(state: GameState, kind: DevelopmentKind): string {
  const id = `${firstPlayer}-${kind}`;
  state.players[0]!.developmentCards.push({ id, kind, purchasedTurn: 1 });
  return id;
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

describe("resource receipts", () => {
  test("reports starting resources only for each player's second setup settlement", () => {
    let previous = newGame();
    for (let index = 0; index < previous.setupOrder.length; index++) {
      const playerId = previous.activePlayerId;
      const vertexId = legalSettlementVertices(previous, playerId)[0]!;
      const vertex = previous.board.vertices.find(vertex => vertex.id === vertexId)!;
      const expected = emptyResources();
      if (index >= previous.players.length) {
        for (const tileId of vertex.tileIds) {
          const tile = previous.board.tiles.find(tile => tile.id === tileId)!;
          if (isResource(tile.terrain)) expected[tile.terrain]++;
        }
        expect(resourceTotal(expected)).toBeGreaterThan(0);
      }
      const next = applyAction(previous, playerId, { type: "place-settlement", vertexId });
      for (const player of previous.players) {
        expect(getResourceGains(player.resources, next.players.find(nextPlayer => nextPlayer.id === player.id)!.resources))
          .toEqual(player.id === playerId ? expected : emptyResources());
      }
      previous = applyAction(next, playerId, { type: "place-road", edgeId: legalRoadEdges(next, playerId)[0]! });
    }
    expect(previous.phase.type).toBe("roll");
  });

  test.each(RESOURCES)("reports actual dice gains of %s for city and settlement owners, not existing holdings", resource => {
    const previous = productionState();
    previous.board.tiles.find(tile => tile.number === 6)!.terrain = resource;
    give(previous, firstPlayer, { [resource]: 4 });
    const next = applyAction(previous, firstPlayer, { type: "roll" }, () => 0.4);

    expect(getResourceGains(previous.players[0]!.resources, next.players[0]!.resources)).toEqual(resources({ [resource]: 2 }));
    expect(getResourceGains(previous.players[1]!.resources, next.players[1]!.resources)).toEqual(resources({ [resource]: 1 }));
    expect(getResourceGains(previous.players[2]!.resources, next.players[2]!.resources)).toEqual(emptyResources());
  });

  test.each(["robber", "insufficient bank"])("reports no dice gains when production is blocked by %s", blocker => {
    const previous = productionState();
    if (blocker === "robber") previous.robberTileId = previous.board.tiles.find(tile => tile.number === 6)!.id;
    else give(previous, thirdPlayer, { wood: 17 });
    const next = applyAction(previous, firstPlayer, { type: "roll" }, () => 0.4);

    for (const [index, player] of previous.players.entries()) {
      expect(getResourceGains(player.resources, next.players[index]!.resources)).toEqual(emptyResources());
    }
  });

  test("reports the resource received from a bank trade despite a net loss of cards", () => {
    const previous = actionState();
    give(previous, firstPlayer, { wood: 4, ore: 2 });
    const next = applyAction(previous, firstPlayer, { type: "bank-trade", give: "wood", receive: "ore" });

    expect(resourceTotal(next.players[0]!.resources) - resourceTotal(previous.players[0]!.resources)).toBe(-3);
    expect(getResourceGains(previous.players[0]!.resources, next.players[0]!.resources)).toEqual(resources({ ore: 1 }));
  });

  test("reports both participants' player-trade receipts only after completion", () => {
    const initial = actionState();
    give(initial, firstPlayer, { wood: 2, brick: 1, ore: 3 });
    give(initial, secondPlayer, { wool: 1, grain: 1, ore: 1 });
    const offered = applyAction(initial, firstPlayer, {
      type: "offer-trade", give: resources({ wood: 2, brick: 1 }), receive: resources({ wool: 1, grain: 1 }),
    });
    const previous = applyAction(offered, secondPlayer, { type: "respond-trade", accept: true });
    for (const [index, player] of initial.players.entries()) {
      expect(getResourceGains(player.resources, offered.players[index]!.resources)).toEqual(emptyResources());
      expect(getResourceGains(offered.players[index]!.resources, previous.players[index]!.resources)).toEqual(emptyResources());
    }
    const next = applyAction(previous, firstPlayer, { type: "complete-trade", playerId: secondPlayer });

    expect(getResourceGains(previous.players[0]!.resources, next.players[0]!.resources)).toEqual(resources({ wool: 1, grain: 1 }));
    expect(getResourceGains(previous.players[1]!.resources, next.players[1]!.resources)).toEqual(resources({ wood: 2, brick: 1 }));
    expect(getResourceGains(previous.players[2]!.resources, next.players[2]!.resources)).toEqual(emptyResources());
  });

  test.each([0, 4])("reports theft only for the thief when the victim holds %s cards", heldCards => {
    const previous = actionState();
    previous.phase = { type: "steal", victimIds: [secondPlayer], returnPhase: "actions" };
    give(previous, firstPlayer, { ore: 2 });
    give(previous, secondPlayer, { ore: heldCards });
    const next = applyAction(previous, firstPlayer, { type: "steal", playerId: secondPlayer }, () => 0);

    expect(getResourceGains(previous.players[0]!.resources, next.players[0]!.resources))
      .toEqual(resources({ ore: heldCards > 0 ? 1 : 0 }));
    expect(getResourceGains(previous.players[1]!.resources, next.players[1]!.resources)).toEqual(emptyResources());
    expect(getResourceGains(previous.players[2]!.resources, next.players[2]!.resources)).toEqual(emptyResources());
  });

  test.each([resources({ ore: 2 }), resources({ wood: 1, brick: 1 })])("reports Year of Plenty gains %j", chosen => {
    const previous = actionState();
    previous.phase = { type: "roll" };
    give(previous, firstPlayer, { wood: 2, brick: 2, ore: 4 });
    const cardId = card(previous, "year-of-plenty");
    const next = applyAction(previous, firstPlayer, { type: "play-development", cardId, resources: chosen });

    expect(getResourceGains(previous.players[0]!.resources, next.players[0]!.resources)).toEqual(chosen);
    expect(getResourceGains(previous.players[1]!.resources, next.players[1]!.resources)).toEqual(emptyResources());
    expect(getResourceGains(previous.players[2]!.resources, next.players[2]!.resources)).toEqual(emptyResources());
  });

  test("reports Monopoly's combined gain, not existing holdings or opponents' losses", () => {
    const previous = actionState();
    give(previous, firstPlayer, { ore: 1 });
    give(previous, secondPlayer, { ore: 3, wood: 2 });
    give(previous, thirdPlayer, { ore: 5 });
    const cardId = card(previous, "monopoly");
    const next = applyAction(previous, firstPlayer, { type: "play-development", cardId, resource: "ore" });

    expect(getResourceGains(previous.players[0]!.resources, next.players[0]!.resources)).toEqual(resources({ ore: 8 }));
    expect(getResourceGains(previous.players[1]!.resources, next.players[1]!.resources)).toEqual(emptyResources());
    expect(getResourceGains(previous.players[2]!.resources, next.players[2]!.resources)).toEqual(emptyResources());
  });

  test("reports no gains for unchanged holdings, including the same input object", () => {
    const previous = actionState();
    give(previous, firstPlayer, { wood: 4, ore: 2 });
    const next = applyAction(previous, firstPlayer, { type: "end-turn" });

    expect(getResourceGains(previous.players[0]!.resources, next.players[0]!.resources)).toEqual(emptyResources());
    expect(getResourceGains(previous.players[0]!.resources, previous.players[0]!.resources)).toEqual(emptyResources());
  });

  test("reports no gains for resource spending", () => {
    const previous = actionState();
    give(previous, firstPlayer, { ...COSTS.development, wood: 3 });
    const next = applyAction(previous, firstPlayer, { type: "buy-development" });

    expect(getResourceGains(previous.players[0]!.resources, next.players[0]!.resources)).toEqual(emptyResources());
  });

  test("reports no gains when discarding after a seven", () => {
    const initial = actionState();
    initial.phase = { type: "roll" };
    give(initial, firstPlayer, { wood: 9 });
    let draw = 0;
    const previous = applyAction(initial, firstPlayer, { type: "roll" }, () => draw++ === 0 ? 0 : 0.999999);
    const next = applyAction(previous, firstPlayer, { type: "discard", resources: resources({ wood: 4 }) });

    expect(getResourceGains(previous.players[0]!.resources, next.players[0]!.resources)).toEqual(emptyResources());
  });

  test("does not mutate either input and returns independent receipt objects", () => {
    const previous = actionState();
    give(previous, firstPlayer, { wood: 4, ore: 2 });
    const next = applyAction(previous, firstPlayer, { type: "bank-trade", give: "wood", receive: "ore" });
    const previousResources = Object.freeze(previous.players[0]!.resources);
    const nextResources = Object.freeze(next.players[0]!.resources);
    const previousSnapshot = { ...previousResources };
    const nextSnapshot = { ...nextResources };

    const gains = getResourceGains(previousResources, nextResources);
    const repeated = getResourceGains(previousResources, nextResources);
    expect(gains).toEqual(resources({ ore: 1 }));
    expect(repeated).toEqual(gains);
    expect(repeated).not.toBe(gains);
    expect(gains).not.toBe(previousResources);
    expect(gains).not.toBe(nextResources);
    gains.ore = 99;
    expect(previousResources).toEqual(previousSnapshot);
    expect(nextResources).toEqual(nextSnapshot);
    expect(repeated).toEqual(resources({ ore: 1 }));
    expect(getResourceGains(previousResources, nextResources)).toEqual(resources({ ore: 1 }));
  });

  test("reports identical gains from consecutive actions independently", () => {
    const previous = actionState();
    give(previous, firstPlayer, { wood: 8 });
    const next = applyAction(previous, firstPlayer, { type: "bank-trade", give: "wood", receive: "ore" });
    const later = applyAction(next, firstPlayer, { type: "bank-trade", give: "wood", receive: "ore" });

    const firstGains = getResourceGains(previous.players[0]!.resources, next.players[0]!.resources);
    const laterGains = getResourceGains(next.players[0]!.resources, later.players[0]!.resources);
    expect(firstGains).toEqual(resources({ ore: 1 }));
    expect(laterGains).toEqual(firstGains);
    expect(laterGains).not.toBe(firstGains);
  });
});
