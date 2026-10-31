import { describe, expect, test } from "bun:test";
import { chooseComputerAction, getController } from "../../src/game/computer";
import {
  applyAction, createGame, emptyResources, getScore, getTradeRatio, RESOURCES, resourceTotal,
} from "../../src/game/engine";
import type { DevelopmentKind, GameAction, GameState, Player, Resources } from "../../src/game/types";

const profiles: Pick<Player, "name" | "color" | "control">[] = [
  { name: "Ada", color: "red", control: "computer" },
  { name: "Grace", color: "blue", control: "computer" },
  { name: "Linus", color: "white", control: "computer" },
  { name: "Margaret", color: "orange", control: "computer" },
];
const resources = (values: Partial<Resources> = {}): Resources => ({ ...emptyResources(), ...values });

function seededRandom(initial: number): () => number {
  let seed = initial;
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
}

function settledGame(): GameState {
  let state = createGame(profiles.slice(0, 3), seededRandom(2813));
  while (state.phase.type.startsWith("setup")) {
    state = applyAction(state, state.activePlayerId, chooseComputerAction(state, state.activePlayerId)!);
  }
  state.turnNumber = 8;
  return state;
}

function setResources(state: GameState, playerId: string, inventory: Resources): void {
  const player = state.players.find(player => player.id === playerId)!;
  for (const resource of RESOURCES) state.bank[resource] += player.resources[resource] - inventory[resource];
  player.resources = inventory;
}

function chooseAndApply(state: GameState, playerId = state.activePlayerId): { action: GameAction; state: GameState } {
  const before = structuredClone(state);
  const action = chooseComputerAction(state, playerId);
  expect(state).toEqual(before);
  expect(action).not.toBeNull();
  const result = applyAction(state, playerId, action!, () => 0);
  expect(state).toEqual(before);
  return { action: action!, state: result };
}

describe("computer identity and authority", () => {
  test("control is required and travels with each profile through the seat shuffle", () => {
    const mixed = profiles.map((profile, index) => ({ ...profile, control: index === 0 ? "human" as const : "computer" as const }));
    const state = createGame(mixed, () => 0);
    expect(state.players[0]!.id).not.toBe("player-1");
    for (const player of state.players) {
      const profile = mixed[Number(player.id.split("-")[1]) - 1]!;
      expect(player.control).toBe(profile.control);
      expect(player.name).toBe(profile.name);
      expect(player.color).toBe(profile.color);
    }
    expect(() => createGame(mixed.map(profile => ({ ...profile, control: undefined })) as unknown as typeof mixed)).toThrow("control");
  });

  test("controller selects the first positive discard obligation, otherwise the active seat", () => {
    const state = settledGame();
    const other = state.players.find(player => player.id !== state.activePlayerId)!;
    expect(getController(state)).toBe(state.activePlayerId);
    state.phase = { type: "discard", required: { [state.activePlayerId]: 0, [other.id]: 3 } };
    expect(getController(state)).toBe(other.id);
    state.phase = { type: "discard", required: { [other.id]: 0 } };
    expect(getController(state)).toBe(state.activePlayerId);
  });

  test("humans, unknown seats, finished games and unrelated off-turn computers never act", () => {
    const state = settledGame();
    const active = state.players.find(player => player.id === state.activePlayerId)!;
    const other = state.players.find(player => player.id !== active.id)!;
    expect(chooseComputerAction(state, "unknown")).toBeNull();
    for (const phase of [
      { type: "roll" }, { type: "actions" }, { type: "setup-settlement" },
      { type: "setup-road", vertexId: state.board.vertices[0]!.id },
      { type: "robber", returnPhase: "roll" }, { type: "steal", returnPhase: "roll", victimIds: [other.id] },
      { type: "road-building", remaining: 2, returnPhase: "roll" }, { type: "discard", required: { [active.id]: 2 } },
    ] satisfies GameState["phase"][]) {
      state.phase = phase;
      expect(chooseComputerAction(state, other.id)).toBeNull();
      active.control = "human";
      expect(chooseComputerAction(state, active.id)).toBeNull();
      active.control = "computer";
    }
    state.phase = { type: "finished" };
    expect(chooseComputerAction(state, active.id)).toBeNull();
  });

  test("an obligated computer discards off-turn even when another player is first", () => {
    const state = settledGame();
    const other = state.players.find(player => player.id !== state.activePlayerId)!;
    setResources(state, other.id, resources({ wood: 7, grain: 2, ore: 1 }));
    state.phase = { type: "discard", required: { [state.activePlayerId]: 4, [other.id]: 5 } };
    const result = chooseAndApply(state, other.id);
    expect(result.action.type).toBe("discard");
    expect(resourceTotal(result.state.players.find(player => player.id === other.id)!.resources)).toBe(5);
    expect(getController(result.state)).toBe(state.activePlayerId);
    expect(chooseComputerAction(result.state, other.id)).toBeNull();
  });
});

describe("computer setup and mandatory phases", () => {
  test.each([3, 4])("completes productive %s-seat snake setup using only legal roads from the new settlement", count => {
    let state = createGame(profiles.slice(0, count), seededRandom(59));
    let steps = 0;
    while (state.phase.type.startsWith("setup")) {
      const phase = state.phase;
      const result = chooseAndApply(state);
      if (phase.type === "setup-road" && result.action.type === "place-road") {
        const edgeId = result.action.edgeId;
        expect(state.board.edges.find(edge => edge.id === edgeId)!.vertexIds).toContain(phase.vertexId);
      }
      state = result.state;
      steps++;
    }
    expect(steps).toBe(count * 4);
    expect(state.phase.type).toBe("roll");
    for (const vertex of state.board.vertices.filter(vertex => vertex.building)) {
      expect(vertex.tileIds.some(id => state.board.tiles.find(tile => tile.id === id)!.number !== null)).toBe(true);
    }
  });

  test.each(["roll", "actions"] as const)("robber movement and theft return to %s, including empty victims", returnPhase => {
    let state = settledGame();
    for (const player of state.players) setResources(state, player.id, resources());
    state.phase = { type: "robber", returnPhase };
    const originalRobber = state.robberTileId;
    const moved = chooseAndApply(state);
    expect(moved.action.type).toBe("move-robber");
    expect(moved.state.robberTileId).not.toBe(originalRobber);
    state = moved.state;
    expect(state.phase.type).toBe("steal");
    const stolen = chooseAndApply(state);
    expect(stolen.action.type).toBe("steal");
    expect(stolen.state.phase).toEqual({ type: returnPhase });
  });

  test("rolls once, then ends an unaffordable turn instead of returning no action", () => {
    let state = settledGame();
    setResources(state, state.activePlayerId, resources());
    expect(chooseAndApply(state).action).toEqual({ type: "roll" });
    state.phase = { type: "actions" };
    const ended = chooseAndApply(state);
    expect(ended.action).toEqual({ type: "end-turn" });
    expect(ended.state.activePlayerId).not.toBe(state.activePlayerId);
  });

  test("expands toward a reachable settlement instead of a productive but blocked dead end", () => {
    let state = settledGame();
    state.phase = { type: "actions" };
    const playerId = state.activePlayerId;
    const opponentId = state.players.find(player => player.id !== playerId)!.id;
    const connections = [["root", "dead"], ["dead", "opponent"], ["root", "path"], ["path", "site"]] as const;
    state.board = {
      vertices: ["root", "dead", "opponent", "path", "site"].map(id => ({
        id, x: 0, y: 0, tileIds: id === "dead" ? ["tempting"] : id === "site" ? ["productive"] : [],
        edgeIds: connections.flatMap(([first, second], index) => first === id || second === id ? [`road-${index}`] : []),
        building: id === "root" ? { playerId, kind: "settlement" } : id === "opponent" ? { playerId: opponentId, kind: "settlement" } : null,
      })),
      edges: connections.map(([first, second], index) => ({ id: `road-${index}`, vertexIds: [first, second], playerId: null })),
      tiles: [
        { id: "tempting", x: 0, y: 0, terrain: "wood", number: 6, vertexIds: ["dead"] },
        { id: "productive", x: 0, y: 0, terrain: "ore", number: 8, vertexIds: ["site"] },
      ],
      ports: [],
    };
    for (const edgeId of ["road-2", "road-3"]) {
      setResources(state, playerId, resources({ wood: 1, brick: 1 }));
      const result = chooseAndApply(state);
      expect(result.action).toEqual({ type: "place-road", edgeId });
      state = result.state;
    }
    setResources(state, playerId, resources({ wood: 1, brick: 1, wool: 1, grain: 1 }));
    expect(chooseAndApply(state).action).toEqual({ type: "place-settlement", vertexId: "site" });
  });

  test("free roads honor the last piece and can skip only when no legal road remains", () => {
    const state = settledGame();
    for (const edge of state.board.edges) edge.playerId = null;
    for (const edge of state.board.edges.slice(0, 14)) edge.playerId = state.activePlayerId;
    state.phase = { type: "road-building", remaining: 2, returnPhase: "roll" };
    const built = chooseAndApply(state);
    expect(built.action.type).toBe("place-road");
    expect(built.state.phase).toEqual({ type: "roll" });
    built.state.phase = { type: "road-building", remaining: 1, returnPhase: "actions" };
    const skipped = chooseAndApply(built.state);
    expect(skipped.action).toEqual({ type: "skip-roads" });
    expect(skipped.state.phase).toEqual({ type: "actions" });
  });
});

describe("computer development cards and limited supplies", () => {
  for (const phase of ["roll", "actions"] as const) {
    test.each(["knight", "road-building", "year-of-plenty", "monopoly"] satisfies DevelopmentKind[])(
      `plays mature %s legally during ${phase} and resolves its mandatory effect`, kind => {
        let state = settledGame();
        state.phase = { type: phase };
        const player = state.players.find(player => player.id === state.activePlayerId)!;
        player.developmentCards = [{ id: "chosen-card", kind, purchasedTurn: state.turnNumber - 1 }];
        const played = chooseAndApply(state);
        expect(played.action.type).toBe("play-development");
        state = played.state;
        let steps = 0;
        while (state.phase.type !== phase && steps < 4) {
          state = chooseAndApply(state).state;
          steps++;
        }
        expect(state.phase).toEqual({ type: phase });
        expect(state.developmentPlayed).toBe(true);
        expect(state.players.find(other => other.id === player.id)!.developmentCards).toHaveLength(0);
      },
    );
  }

  test("never plays hidden points, newly purchased cards, or a second card in a turn", () => {
    const state = settledGame();
    const player = state.players.find(player => player.id === state.activePlayerId)!;
    player.developmentCards = [
      { id: "point", kind: "victory-point", purchasedTurn: 0 },
      { id: "new-knight", kind: "knight", purchasedTurn: state.turnNumber },
    ];
    expect(chooseAndApply(state).action).toEqual({ type: "roll" });
    player.developmentCards.push({ id: "old-knight", kind: "knight", purchasedTurn: 0 });
    state.developmentPlayed = true;
    expect(chooseAndApply(state).action).toEqual({ type: "roll" });
  });

  test.each([0, 1, 2])("Year of Plenty respects a bank with %s cards remaining", count => {
    const state = settledGame();
    state.bank = resources({ ore: count });
    const player = state.players.find(player => player.id === state.activePlayerId)!;
    player.developmentCards = [{ id: "plenty", kind: "year-of-plenty", purchasedTurn: 0 }];
    const result = chooseAndApply(state);
    expect(result.action).toEqual(count === 0 ? { type: "roll" } : {
      type: "play-development", cardId: "plenty", resources: resources({ ore: count }),
    });
  });

  test("depleted pieces and development deck do not produce an illegal purchase or card play", () => {
    const state = settledGame();
    state.phase = { type: "actions" };
    state.developmentDeck = [];
    const player = state.players.find(player => player.id === state.activePlayerId)!;
    setResources(state, player.id, resources({ wood: 8, brick: 8, wool: 8, grain: 8, ore: 8 }));
    player.developmentCards = [{ id: "roads", kind: "road-building", purchasedTurn: 0 }];
    for (const vertex of state.board.vertices) vertex.building = null;
    for (const vertex of state.board.vertices.slice(0, 5)) vertex.building = { playerId: player.id, kind: "settlement" };
    for (const vertex of state.board.vertices.slice(5, 9)) vertex.building = { playerId: player.id, kind: "city" };
    for (const edge of state.board.edges) edge.playerId = null;
    for (const edge of state.board.edges.slice(0, 15)) edge.playerId = player.id;
    expect(chooseAndApply(state).action).toEqual({ type: "end-turn" });
  });

  test("automatic hidden points can win before rolling without attempting to play the point cards", () => {
    const state = settledGame();
    const player = state.players.find(player => player.id === state.activePlayerId)!;
    player.developmentCards = Array.from({ length: 8 }, (_, index) => ({ id: `point-${index}`, kind: "victory-point", purchasedTurn: 0 }));
    const result = chooseAndApply(state);
    expect(result.action).toEqual({ type: "roll" });
    expect(result.state.winnerId).toBe(player.id);
    expect(result.state.phase.type).toBe("finished");
  });
});

describe("computer trades and public information", () => {
  test.each(["any", "wood", null] as const)("maritime trading uses %s port ratios, then spends on its selected build", portResource => {
    let state = settledGame();
    state.phase = { type: "actions" };
    state.board.ports = [];
    const player = state.players.find(player => player.id === state.activePlayerId)!;
    if (portResource) {
      const vertex = state.board.vertices.find(vertex => vertex.building?.playerId === player.id)!;
      state.board.ports.push({ edgeId: vertex.edgeIds[0]!, resource: portResource });
    }
    const ratio = getTradeRatio(state, player.id, "wood");
    setResources(state, player.id, resources({ wood: ratio, grain: 2, ore: 2 }));
    const traded = chooseAndApply(state);
    expect(traded.action).toEqual({ type: "bank-trade", give: "wood", receive: "ore" });
    state = traded.state;
    expect(chooseAndApply(state).action.type).toBe("place-city");
  });

  test("never trades into a depleted bank or toward an unaffordable target", () => {
    const state = settledGame();
    state.phase = { type: "actions" };
    state.board.ports = [];
    setResources(state, state.activePlayerId, resources({ wood: 4, grain: 2, ore: 2 }));
    state.bank.ore = 0;
    const depleted = chooseAndApply(state);
    expect(depleted.action).not.toEqual({ type: "bank-trade", give: "wood", receive: "ore" });
    setResources(state, state.activePlayerId, resources({ wood: 4 }));
    const insufficient = chooseAndApply(state);
    expect(insufficient.action).toEqual({ type: "end-turn" });
  });

  test("successive bank trades monotonically close a build deficit and terminate in a purchase", () => {
    let state = settledGame();
    state.phase = { type: "actions" };
    state.board.ports = [];
    const playerId = state.activePlayerId;
    setResources(state, playerId, resources({ wood: 12, grain: 2 }));
    for (let index = 0; index < 3; index++) {
      const before = state.players.find(player => player.id === playerId)!.resources;
      const result = chooseAndApply(state);
      expect(result.action).toEqual({ type: "bank-trade", give: "wood", receive: "ore" });
      state = result.state;
      const after = state.players.find(player => player.id === playerId)!.resources;
      expect(after.ore).toBe(before.ore + 1);
      expect(resourceTotal(after)).toBe(resourceTotal(before) - 3);
    }
    const purchased = chooseAndApply(state);
    expect(purchased.action.type).toBe("place-city");
    expect(chooseAndApply(purchased.state).action).toEqual({ type: "end-turn" });
  });

  test("answers an unresponded human offer before turn work, accepts useful affordable offers, and does not answer twice", () => {
    let state = settledGame();
    state.phase = { type: "actions" };
    const human = state.players.find(player => player.id === state.activePlayerId)!;
    human.control = "human";
    const computer = state.players.find(player => player.id !== human.id)!;
    setResources(state, human.id, resources({ ore: 1 }));
    setResources(state, computer.id, resources({ wood: 1, ore: 2, grain: 2 }));
    state = applyAction(state, human.id, { type: "offer-trade", give: resources({ ore: 1 }), receive: resources({ wood: 1 }) });
    const result = chooseAndApply(state, computer.id);
    expect(result.action).toEqual({ type: "respond-trade", accept: true });
    expect(result.state.trade!.responses[computer.id]).toEqual(resources({ ore: 1 }));
    expect(chooseComputerAction(result.state, computer.id)).toBeNull();
    expect(chooseComputerAction(state, human.id)).toBeNull();
    const completed = applyAction(result.state, human.id, { type: "complete-trade", playerId: computer.id });
    expect(completed.players.find(player => player.id === computer.id)!.resources.ore).toBe(3);
  });

  test.each(["unaffordable", "unfavorable", "unhelpful"])("declines %s human offers rather than automatically accepting", reason => {
    let state = settledGame();
    state.phase = { type: "actions" };
    const computer = state.players.find(player => player.id !== state.activePlayerId)!;
    setResources(state, state.activePlayerId, resources({ ore: 1, wool: 1 }));
    setResources(state, computer.id, resources({ wood: reason === "unaffordable" ? 0 : 4, ore: 2, grain: 2 }));
    state = applyAction(state, state.activePlayerId, {
      type: "offer-trade", give: resources(reason === "unhelpful" ? { wool: 1 } : { ore: 1 }),
      receive: resources({ wood: reason === "unfavorable" ? 4 : 1 }),
    });
    expect(chooseAndApply(state, computer.id).action).toEqual({ type: "respond-trade", accept: false });
  });

  test.each([
    { name: "single-resource", receive: resources({ wood: 1 }), inventory: resources({ wood: 1, grain: 2, ore: 2 }), price: resources({ ore: 1 }) },
    { name: "mixed-resource", receive: resources({ wood: 1, brick: 1 }), inventory: resources({ wood: 1, brick: 1, grain: 1, ore: 2 }), price: resources({ grain: 1, ore: 1 }) },
  ])("quotes a fair useful price for a $name request and waits for confirmation", ({ receive, inventory, price }) => {
    let state = settledGame();
    state.phase = { type: "actions" };
    const human = state.players.find(player => player.id === state.activePlayerId)!;
    human.control = "human";
    const computer = state.players.find(player => player.id !== human.id)!;
    setResources(state, human.id, price);
    setResources(state, computer.id, inventory);
    state = applyAction(state, human.id, { type: "request-trade", receive });
    const result = chooseAndApply(state, computer.id);
    expect(result.action).toEqual({ type: "propose-trade", price });
    expect(result.state.trade!.responses[computer.id]).toEqual(price);
    expect(result.state.players).toEqual(state.players);
    expect(chooseComputerAction(result.state, computer.id)).toBeNull();
    const completed = applyAction(result.state, human.id, { type: "complete-trade", playerId: computer.id });
    expect(completed.trade).toBeNull();
    expect(completed.players.find(player => player.id === human.id)!.resources).toEqual(receive);
    expect(completed.players.find(player => player.id === computer.id)!.resources).toEqual(resources({ grain: 2, ore: 3 }));
    expect(completed.bank).toEqual(state.bank);
  });

  test.each([
    { name: "unsuppliable", receive: resources({ wood: 2 }), inventory: resources({ wood: 1, grain: 2, ore: 2 }) },
    { name: "unhelpful", receive: resources({ wood: 1 }), inventory: resources({ wood: 1, grain: 2, ore: 3 }) },
    { name: "too large for useful payment", receive: resources({ wood: 2 }), inventory: resources({ wood: 2, grain: 2, ore: 2 }) },
    { name: "no net build improvement", receive: resources({ grain: 1 }), inventory: resources({ grain: 2, ore: 2 }) },
    { name: "only overlapping deficits", receive: resources({ ore: 1 }), inventory: resources({ grain: 2, ore: 2 }) },
  ])("declines a request with $name and does not respond again", ({ receive, inventory }) => {
    let state = settledGame();
    state.phase = { type: "actions" };
    const computer = state.players.find(player => player.id !== state.activePlayerId)!;
    setResources(state, computer.id, inventory);
    state = applyAction(state, state.activePlayerId, { type: "request-trade", receive });
    const result = chooseAndApply(state, computer.id);
    expect(result.action).toEqual({ type: "respond-trade", accept: false });
    expect(result.state.trade!.responses[computer.id]).toBe(false);
    expect(chooseComputerAction(result.state, computer.id)).toBeNull();
  });

  test("quotes without reading opponents' inventories even when the requester cannot afford the price", () => {
    let state = settledGame();
    state.phase = { type: "actions" };
    const computer = state.players.find(player => player.id !== state.activePlayerId)!;
    setResources(state, state.activePlayerId, resources({ wool: 1 }));
    setResources(state, computer.id, resources({ wood: 1, grain: 2, ore: 2 }));
    state = applyAction(state, state.activePlayerId, { type: "request-trade", receive: resources({ wood: 1 }) });
    const result = chooseAndApply(state, computer.id);
    expect(result.action).toEqual({ type: "propose-trade", price: resources({ ore: 1 }) });
    expect(() => applyAction(result.state, state.activePlayerId, { type: "complete-trade", playerId: computer.id })).toThrow("Both players");
    for (const opponent of state.players.filter(player => player.id !== computer.id)) {
      Object.defineProperty(opponent, "resources", { get() { throw new Error("Opponent resources are private"); } });
    }
    expect(chooseComputerAction(state, computer.id)).toEqual(result.action);
  });

  test.each(["setup-settlement", "actions", "roll", "robber", "steal", "discard"] as const)(
    "%s decisions ignore opponents' resource composition, development cards, hidden score and deck order", phase => {
      const state = settledGame();
      const player = state.players.find(player => player.id === state.activePlayerId)!;
      const opponents = state.players.filter(other => other.id !== player.id);
      for (const opponent of opponents) setResources(state, opponent.id, resources({ wood: 1, ore: 1, grain: 1 }));
      setResources(state, player.id, resources({ wood: 4, brick: 2, wool: 1, grain: 1, ore: 2 }));
      player.developmentCards = [{ id: "monopoly", kind: "monopoly", purchasedTurn: 0 }];
      state.phase = phase === "robber" ? { type: phase, returnPhase: "actions" }
        : phase === "steal" ? { type: phase, returnPhase: "roll", victimIds: opponents.map(other => other.id) }
        : phase === "discard" ? { type: phase, required: { [player.id]: 5 } } : { type: phase };
      const expected = chooseComputerAction(state, player.id);
      const hidden = structuredClone(state);
      hidden.players.filter(other => other.id !== player.id).forEach((opponent, index) => {
        opponent.resources = index === 0 ? resources({ wood: 2, grain: 1 }) : resources({ ore: 2, grain: 1 });
        Object.defineProperty(opponent, "developmentCards", { get() { throw new Error("Opponent cards are private"); } });
      });
      hidden.developmentDeck = new Proxy(hidden.developmentDeck.toReversed(), {
        get(target, property, receiver) {
          if (property !== "length") throw new Error("Deck ordering is private");
          return Reflect.get(target, property, receiver);
        },
      });
      expect(chooseComputerAction(hidden, player.id)).toEqual(expected);
    },
  );
});

describe("seeded complete computer games", () => {
  for (const count of [3, 4]) {
    test.each([1, 59, 2813, 90210])(`${count} computers finish seed %s using only legal, finite actions`, seed => {
      const random = seededRandom(seed);
      let state = createGame(profiles.slice(0, count), random);
      let steps = 0;
      let turnSteps = 0;
      const actions = new Set<GameAction["type"]>();
      while (!state.winnerId && steps < 5000) {
        const playerId = getController(state);
        const action = chooseComputerAction(state, playerId);
        expect(action).not.toBeNull();
        expect(action!.type).not.toBe("offer-trade");
        const previousTurn = state.turnNumber;
        state = applyAction(state, playerId, action!, random);
        actions.add(action!.type);
        steps++;
        turnSteps = state.turnNumber === previousTurn ? turnSteps + 1 : 0;
        expect(turnSteps).toBeLessThan(100);
        for (const resource of RESOURCES) {
          expect(state.bank[resource]).toBeGreaterThanOrEqual(0);
          expect(state.bank[resource] + state.players.reduce((total, player) => total + player.resources[resource], 0)).toBe(19);
        }
        for (const player of state.players) {
          expect(state.board.edges.filter(edge => edge.playerId === player.id).length).toBeLessThanOrEqual(15);
          expect(state.board.vertices.filter(vertex => vertex.building?.playerId === player.id && vertex.building.kind === "settlement").length).toBeLessThanOrEqual(5);
          expect(state.board.vertices.filter(vertex => vertex.building?.playerId === player.id && vertex.building.kind === "city").length).toBeLessThanOrEqual(4);
        }
      }
      expect(steps).toBeLessThan(5000);
      expect(state.phase.type).toBe("finished");
      expect(getScore(state, state.winnerId!).total).toBeGreaterThanOrEqual(10);
      for (const type of ["place-settlement", "place-road", "roll", "move-robber", "bank-trade", "end-turn"] as const) {
        expect([...actions]).toContain(type);
      }
      expect(chooseComputerAction(state, state.activePlayerId)).toBeNull();
    }, 30000);
  }
});
