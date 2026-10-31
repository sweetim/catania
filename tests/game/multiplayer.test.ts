import { describe, expect, test } from "bun:test";
import { emptyResources, getScore, legalRoadEdges } from "../../src/game/engine";
import type { GameAction, GamePhase, GameState, Resources } from "../../src/game/types";
import { parseAction, parseClientMessage, parseServerMessage } from "../../src/multiplayer/protocol";
import { HostRoom, publicGame } from "../../src/multiplayer/state";

const secret = "invitation-secret";
const names = ["Ada", "Grace", "Linus", "Margaret"];
const resources = (values: Partial<Resources> = {}): Resources => ({ ...emptyResources(), ...values });
function lobby(count = 3) {
  const room = new HostRoom(secret);
  const credentials = names.slice(0, count).map((name, index) => {
    room.join(`connection-${index + 1}`, { type: "join", name, secret });
    return room.admit(`connection-${index + 1}`);
  });
  return { room, credentials };
}
function started(count = 3) {
  const result = lobby(count);
  result.room.start();
  return result;
}
function connectionFor(playerId: string): string { return playerId.replace("player-", "connection-"); }
function activeConnection(room: HostRoom): string { return connectionFor(room.game!.activePlayerId); }
function send(room: HostRoom, connectionId: string, action: GameAction, version = room.version, requestId: string = crypto.randomUUID()) {
  return room.command(connectionId, { type: "action", requestId, version, action });
}
function give(game: GameState, playerId: string, amounts: Partial<Resources>) {
  const player = game.players.find(player => player.id === playerId)!;
  for (const [resource, amount] of Object.entries(amounts) as [keyof Resources, number][]) {
    player.resources[resource] += amount;
    game.bank[resource] -= amount;
  }
}

describe("multiplayer admission and reconnect identity", () => {
  test("requires the invitation secret before exposing roster or storing a pending request", () => {
    const { room } = lobby();
    const before = room.snapshot();
    expect(() => room.join("intruder", { type: "join", name: "Eve", secret: "wrong-secret" })).toThrow("invitation");
    expect(room.snapshot()).toEqual(before);
  });

  test("waiting guests receive public roster only; only the host sees exact admission connections", () => {
    const { room } = lobby(1);
    room.join("first-request", { type: "join", name: "Grace", secret });
    room.join("second-request", { type: "join", name: "Linus", secret });
    const waiting = room.snapshot("first-request");
    expect(waiting.players.map(player => player.name)).toEqual(["Ada"]);
    expect(waiting.game).toBeNull();
    expect(waiting.playerId).toBeNull();
    expect(waiting.privatePlayer).toBeNull();
    expect(waiting.privateScore).toBeNull();
    expect(waiting).not.toHaveProperty("pendingPlayers");
    expect(JSON.stringify(waiting)).not.toContain("second-request");
    expect(JSON.stringify(waiting)).not.toContain("Linus");
    expect(room.snapshot().pendingPlayers).toEqual([
      { connectionId: "first-request", name: "Grace" }, { connectionId: "second-request", name: "Linus" },
    ]);
    expect(parseServerMessage({ type: "snapshot", snapshot: waiting })).toEqual({ type: "snapshot", snapshot: waiting });
  });

  test("admission is tied to the exact live connection rather than a claimed name", () => {
    const room = new HostRoom(secret);
    room.join("old", { type: "join", name: "Ada", secret });
    room.disconnect("old");
    room.join("new", { type: "join", name: "Ada", secret });
    expect(() => room.admit("old")).toThrow("exact join request");
    expect(room.snapshot("new").playerId).toBeNull();
    room.admit("new");
    expect(room.snapshot("new").playerId).toBe("player-1");
  });

  test.each(["", " ", "a".repeat(21), "Ada\n", "Ada\u0000"])("rejects invalid name %j", name => {
    expect(() => new HostRoom(secret).join("connection", { type: "join", name, secret })).toThrow("name");
  });

  test("normalizes names and rejects case-insensitive duplicates across seats and pending requests", () => {
    const room = new HostRoom(secret);
    room.join("first", { type: "join", name: " Ada ", secret });
    expect(() => room.join("second", { type: "join", name: "ADA", secret })).toThrow("different name");
    room.admit("first");
    expect(() => room.join("third", { type: "join", name: "ada", secret })).toThrow("different name");
    expect(room.snapshot().players[0]!.name).toBe("Ada");
  });

  test("host has no seat; requires three or four connected human players and preserves player IDs after shuffle", () => {
    const { room } = lobby(2);
    expect(() => room.start()).toThrow("three or four");
    room.join("connection-3", { type: "join", name: "Linus", secret });
    const credential = room.admit("connection-3");
    room.disconnect("connection-3");
    expect(() => room.start()).toThrow("connected");
    room.join("connection-3", { type: "join", name: "Linus", secret, credential });
    room.start();
    for (const player of room.game!.players) {
      expect(player.name).toBe(names[Number(player.id.split("-")[1]) - 1]!);
      expect(player.control).toBe("human");
    }
    expect(room.snapshot().playerId).toBeNull();
    expect(room.snapshot().privatePlayer).toBeNull();
    expect(room.snapshot().privateScore).toBeNull();
    expect(() => room.start()).toThrow("already started");
  });

  test("enforces four seats, rejects new joins after start, and clears unadmitted requests", () => {
    const four = lobby(4).room;
    expect(() => four.join("extra", { type: "join", name: "Eve", secret })).toThrow("four players");
    const { room } = lobby();
    room.join("waiting", { type: "join", name: "Margaret", secret });
    room.start();
    expect(room.snapshot().pendingPlayers).toEqual([]);
    expect(() => room.admit("waiting")).toThrow("after the game starts");
    expect(() => room.join("late", { type: "join", name: "Margaret", secret })).toThrow("started");
    expect(room.snapshot("waiting").game).toBeNull();
  });

  test("reconnect credentials are random, room-scoped, never in snapshots, and not name-based", () => {
    const { room, credentials } = started();
    expect(new Set(credentials).size).toBe(3);
    expect(credentials.every(value => /^[0-9a-f-]{36}$/.test(value))).toBe(true);
    const before = room.snapshot();
    expect(() => room.join("forged", { type: "join", name: "Ada", secret, credential: "invented" })).toThrow("credential");
    expect(() => new HostRoom(secret).join("other-room", { type: "join", name: "Ada", secret, credential: credentials[0]! })).toThrow("credential");
    expect(room.snapshot()).toEqual(before);
    for (const connectionId of [undefined, "connection-1", "outsider"]) {
      const serialized = JSON.stringify(room.snapshot(connectionId));
      expect(serialized).not.toContain(secret);
      for (const credential of credentials) expect(serialized).not.toContain(credential);
    }
  });

  test("valid reconnect revokes the old binding before actions, and late old disconnect cannot unbind the new connection", () => {
    const { room, credentials } = started();
    room.game!.phase = { type: "roll" };
    const actor = room.game!.activePlayerId;
    const previousConnection = activeConnection(room);
    const credential = credentials[Number(actor.split("-")[1]) - 1]!;
    const joined = room.join("replacement", { type: "join", name: "Changed name", secret, credential });
    expect(joined.revokedConnectionId).toBe(previousConnection);
    expect(joined.credential).toBe(credential);
    expect(room.snapshot("replacement").playerId).toBe(actor);
    expect(room.snapshot("replacement").privatePlayer!.name).not.toBe("Changed name");
    expect(room.snapshot(previousConnection).privatePlayer).toBeNull();
    expect(send(room, previousConnection, { type: "roll" }).error).toContain("not bound");
    const version = room.version;
    room.disconnect(previousConnection);
    expect(room.version).toBe(version);
    expect(send(room, "replacement", { type: "roll" }).error).toBe("");
  });
});

describe("public and private multiplayer projections", () => {
  test("allowlist excludes opponents' resources, cards, deck, setup order and pending Knight card", () => {
    const { room } = started();
    const game = room.game!;
    game.turnNumber = 5;
    give(game, "player-1", { wood: 3 });
    give(game, "player-2", { ore: 2 });
    game.players.find(player => player.id === "player-1")!.developmentCards.push({ id: "development-1", kind: "victory-point", purchasedTurn: 1 });
    game.players.find(player => player.id === "player-2")!.developmentCards.push({ id: "development-2", kind: "monopoly", purchasedTurn: 2 });
    game.phase = { type: "robber", returnPhase: "actions", pendingKnight: {
      card: { id: "development-3", kind: "knight", purchasedTurn: 1 }, cardIndex: 1, previousLargestArmy: null,
    } };
    const host = room.snapshot();
    const guest = room.snapshot("connection-1");
    expect(Object.keys(host.game!).sort()).toEqual([
      "activePlayerId", "awards", "bank", "board", "canCancelKnight", "developmentPlayed", "developmentRemaining", "dice", "log", "phase", "players", "robberTileId", "trade", "turnNumber", "winnerId",
    ].sort());
    expect(host.game!.phase).toEqual({ type: "robber", returnPhase: "actions" });
    expect(host.game!.canCancelKnight).toBe(true);
    expect(host.game!.players.every(player => !("resources" in player) && !("developmentCards" in player))).toBe(true);
    expect(host.game!.players.find(player => player.id === "player-2")!.resourceCount).toBe(2);
    expect(host.game!.players.find(player => player.id === "player-2")!.developmentCount).toBe(1);
    expect(guest.privatePlayer!.id).toBe("player-1");
    expect(guest.privatePlayer!.resources.wood).toBe(3);
    expect(guest.privateScore).toBe(1);
    expect(guest.game!.players.find(player => player.id === "player-1")!.score).toBe(0);
    const serialized = JSON.stringify(guest);
    for (const hidden of ["developmentDeck", "setupOrder", "setupIndex", "pendingKnight", "cardIndex", "development-2", "development-3", "monopoly"]) expect(serialized).not.toContain(hidden);
    expect(guest).not.toHaveProperty("pendingPlayers");
    expect(() => parseServerMessage({ type: "snapshot", snapshot: guest })).not.toThrow();
    game.phase = { type: "finished" };
    expect(room.snapshot().game!.players.find(player => player.id === "player-1")!.score).toBe(1);
  });

  test("snapshots do not share mutable private state or board references with authority", () => {
    const { room } = started();
    const snapshot = room.snapshot("connection-1");
    snapshot.privatePlayer!.resources.wood = 19;
    snapshot.players[0]!.name = "Changed";
    snapshot.game!.board.vertices[0]!.building = { playerId: "player-1", kind: "city" };
    expect(room.game!.players.find(player => player.id === "player-1")!.resources.wood).toBe(0);
    expect(room.snapshot().players[0]!.name).toBe("Ada");
    expect(room.game!.board.vertices[0]!.building).toBeNull();
  });

  test.each<GamePhase>([
    { type: "setup-settlement" }, { type: "setup-road", vertexId: "vertex-1" }, { type: "roll" }, { type: "actions" },
    { type: "discard", required: { "player-1": 4 } }, { type: "robber", returnPhase: "roll" },
    { type: "steal", victimIds: ["player-2"], returnPhase: "actions" },
    { type: "road-building", remaining: 2, returnPhase: "roll" }, { type: "finished" },
  ])("serializes and validates public phase %j", phase => {
    const { room } = started();
    room.game!.phase = phase;
    const snapshot = room.snapshot("connection-1");
    expect(snapshot.game!.phase).toEqual(phase);
    expect(() => parseServerMessage({ type: "snapshot", snapshot })).not.toThrow();
  });

  test("audit log exposes neither development draw kind nor stolen resource identity", () => {
    const { room } = started();
    const game = room.game!;
    game.phase = { type: "actions" };
    game.turnNumber = 2;
    game.developmentDeck = ["victory-point"];
    give(game, game.activePlayerId, { wool: 1, grain: 1, ore: 1 });
    expect(send(room, activeConnection(room), { type: "buy-development" }).error).toBe("");
    expect(room.snapshot().game!.log.at(-1)).toContain("buys a development card");
    expect(JSON.stringify(room.snapshot().game)).not.toContain("victory-point");
    const victim = room.game!.players.find(player => player.id !== room.game!.activePlayerId)!;
    give(room.game!, victim.id, { brick: 1 });
    room.game!.phase = { type: "steal", victimIds: [victim.id], returnPhase: "actions" };
    expect(send(room, activeConnection(room), { type: "steal", playerId: victim.id }).error).toBe("");
    expect(room.snapshot().game!.log.at(-1)).toContain("steals one resource card");
    expect(room.snapshot().game!.log.at(-1)).not.toContain("brick");
  });
});

describe("authoritative action permissions and ordering", () => {
  test("duplicate requests never re-run randomness, and deduplication survives reconnect", () => {
    const { room, credentials } = started();
    room.game!.phase = { type: "roll" };
    const actor = room.game!.activePlayerId;
    const command = { type: "action" as const, action: { type: "roll" as const }, version: room.version, requestId: "same-request" };
    const result = room.command(activeConnection(room), command);
    const after = structuredClone(room.game);
    const version = room.version;
    expect(result.error).toBe("");
    expect(room.command(activeConnection(room), command)).toEqual(result);
    expect(room.version).toBe(version);
    expect(room.game).toEqual(after);
    const credential = credentials[Number(actor.split("-")[1]) - 1]!;
    room.join("replacement", { type: "join", secret, name: "Ada", credential });
    expect(room.command("replacement", command)).toEqual(result);
    expect(room.game).toEqual(after);
  });

  test("stale actions cannot accept a replaced trade, including a changed render version", () => {
    const { room } = started();
    room.game!.phase = { type: "actions" };
    const actor = room.game!.activePlayerId;
    const opponent = room.game!.players.find(player => player.id !== actor)!.id;
    give(room.game!, actor, { wood: 2 });
    give(room.game!, opponent, { brick: 2 });
    expect(send(room, connectionFor(actor), { type: "offer-trade", give: resources({ wood: 1 }), receive: resources({ brick: 1 }) }).error).toBe("");
    const oldVersion = room.version;
    expect(send(room, connectionFor(actor), { type: "offer-trade", give: resources({ wood: 2 }), receive: resources({ brick: 2 }) }).error).toBe("");
    const before = structuredClone(room.game);
    expect(send(room, connectionFor(opponent), { type: "respond-trade", accept: true }, oldVersion).error).toContain("game changed");
    expect(room.game).toEqual(before);
    expect(send(room, connectionFor(opponent), { type: "respond-trade", accept: true }).error).toBe("");
  });

  test("binds actor to the connection, never action payload playerId", () => {
    const { room } = started();
    room.game!.phase = { type: "roll" };
    const other = room.game!.players.find(player => player.id !== room.game!.activePlayerId)!.id;
    expect(send(room, connectionFor(other), { type: "roll" }).error).toContain("Wait for your turn");
    expect(send(room, connectionFor(other), { type: "roll", playerId: room.game!.activePlayerId } as GameAction).error).toContain("unexpected fields");
    expect(send(room, "not-admitted", { type: "roll" }).error).toContain("not bound");
    expect(room.game!.phase.type).toBe("roll");
  });

  test("phone board commands are rejected even for active player; host acts only on authorized targets", () => {
    const { room } = started();
    const vertexId = room.snapshot().boardTargets.vertices[0]!;
    const actor = room.game!.activePlayerId;
    expect(send(room, activeConnection(room), { type: "place-settlement", vertexId }).error).toContain("shared board");
    expect(() => room.performBoard({ type: "place-road", edgeId: "edge-0" })).toThrow("highlighted");
    expect(() => room.performBoard({ type: "roll" })).toThrow("phone");
    expect(() => room.performBoard({ type: "end-turn" })).toThrow("phone");
    expect(() => room.performBoard({ type: "discard", resources: resources() })).toThrow("phone");
    const oldVersion = room.version;
    room.performBoard({ type: "place-settlement", vertexId }, oldVersion);
    expect(room.game!.board.vertices.find(vertex => vertex.id === vertexId)!.building!.playerId).toBe(actor);
    const edgeId = room.snapshot().boardTargets.edges[0]!;
    expect(() => room.performBoard({ type: "place-road", edgeId }, oldVersion)).toThrow("game changed");
    room.performBoard({ type: "place-road", edgeId });
    expect(room.game!.board.edges.find(edge => edge.id === edgeId)!.playerId).toBe(actor);
  });

  test("build intent must be active-player or public-host selection, with correct current version and payment", () => {
    const { room } = started();
    while (room.game!.phase.type === "setup-settlement" || room.game!.phase.type === "setup-road") {
      const targets = room.snapshot().boardTargets;
      room.performBoard(room.game!.phase.type === "setup-settlement"
        ? { type: "place-settlement", vertexId: targets.vertices[0]! }
        : { type: "place-road", edgeId: targets.edges[0]! });
    }
    room.game!.phase = { type: "actions" };
    const actor = room.game!.activePlayerId;
    const other = room.game!.players.find(player => player.id !== actor)!.id;
    give(room.game!, actor, { wood: 2, brick: 2 });
    expect(room.snapshot().boardTargets.edges).toEqual([]);
    const edgeId = legalRoadEdges(room.game!, actor)[0]!;
    expect(() => room.performBoard({ type: "place-road", edgeId })).toThrow("highlighted");
    expect(room.command(connectionFor(other), { type: "select-build", piece: "road", requestId: "other-build", version: room.version }).error).toContain("active player");
    const version = room.version;
    expect(room.command(connectionFor(actor), { type: "select-build", piece: "road", requestId: "own-build", version }).error).toBe("");
    expect(room.snapshot().boardTargets.edges).toContain(edgeId);
    expect(() => room.selectBuild("road", undefined, version)).toThrow("game changed");
    room.performBoard({ type: "place-road", edgeId });
    expect(room.buildMode).toBeNull();
    room.selectBuild("road");
    expect(room.buildMode).toBe("road");
    room.selectBuild(null);
    expect(room.snapshot().boardTargets.edges).toEqual([]);
  });

  test("robber board targets exclude current tile; phones choose victims rather than robber placement", () => {
    const { room } = started();
    room.game!.phase = { type: "robber", returnPhase: "actions" };
    const targets = room.snapshot().boardTargets;
    expect(targets.tiles).toHaveLength(18);
    expect(targets.tiles).not.toContain(room.game!.robberTileId);
    expect(send(room, activeConnection(room), { type: "move-robber", tileId: targets.tiles[0]! }).error).toContain("shared board");
    room.performBoard({ type: "move-robber", tileId: targets.tiles[0]! });
    expect(room.game!.robberTileId).toBe(targets.tiles[0]!);
  });

  test("all accepted phone actions still pass engine rules and errors never mutate authority", () => {
    const { room } = started();
    const before = structuredClone(room.game);
    const version = room.version;
    expect(send(room, activeConnection(room), { type: "buy-development" }).error).toContain("Roll the dice");
    expect(room.game).toEqual(before);
    expect(room.version).toBe(version);
    expect(getScore(room.game!, room.game!.activePlayerId).total).toBe(0);
  });
});

describe("untrusted multiplayer protocol", () => {
  test.each([
    null, [], "roll", { type: "unknown" }, { type: "roll", playerId: "player-1" },
    { type: "roll", secret: "secret" }, { type: "steal", playerId: "player-9" },
    { type: "move-robber", tileId: "__proto__" }, { type: "play-development", cardId: "other-card" },
    { type: "bank-trade", give: "gold", receive: "wood" }, { type: "respond-trade", accept: "yes" },
    { type: "discard", resources: { wood: 1 } }, { type: "discard", resources: resources({ wood: -1 }) },
    { type: "discard", resources: resources({ wood: 0.5 }) }, { type: "discard", resources: resources({ wood: 20 }) },
    { type: "discard", resources: { ...resources(), gold: 1 } },
  ].map(action => ({ action })))("rejects invalid or forged action %j", ({ action }) => expect(() => parseAction(action)).toThrow());

  test("rejects oversized messages, missing/invalid request metadata, actor fields and signaling-like credentials", () => {
    const valid = { type: "action", requestId: "request", version: 0, action: { type: "roll" } } as const;
    expect(parseClientMessage(valid)).toEqual(valid);
    expect(() => parseClientMessage({ ...valid, extra: "x".repeat(8192) })).toThrow("too large");
    expect(() => parseClientMessage({ ...valid, requestId: "" })).toThrow();
    expect(() => parseClientMessage({ ...valid, version: -1 })).toThrow();
    expect(() => parseClientMessage({ ...valid, playerId: "player-1" })).toThrow();
    expect(() => parseClientMessage({ type: "join", secret, name: "Ada", metadata: { secret } })).toThrow();
    expect(() => parseClientMessage({ type: "join", secret, name: "Ada", credential: null })).toThrow();
  });

  test("guest decoder rejects leaked private fields, malformed resources, pending names and wrong own-player identity", () => {
    const { room } = started();
    const snapshot = room.snapshot("connection-1");
    expect(() => parseServerMessage({ type: "snapshot", snapshot })).not.toThrow();
    expect(() => parseServerMessage({ type: "snapshot", snapshot: { ...snapshot, pendingPlayers: [] } })).toThrow();
    expect(() => parseServerMessage({ type: "snapshot", snapshot: { ...snapshot, game: { ...snapshot.game, developmentDeck: ["knight"] } } })).toThrow();
    expect(() => parseServerMessage({ type: "snapshot", snapshot: { ...snapshot, playerId: "player-2" } })).toThrow();
    expect(() => parseServerMessage({ type: "snapshot", snapshot: { ...snapshot, privatePlayer: { ...snapshot.privatePlayer, resources: { wood: 1 } } } })).toThrow();
    expect(() => parseServerMessage({ type: "error", error: "x".repeat(131072), terminal: false })).toThrow("too large");
    const projection = publicGame(room.game!, snapshot.players);
    expect(() => parseServerMessage({ type: "snapshot", snapshot: { ...snapshot, game: projection } })).not.toThrow();
  });
});
