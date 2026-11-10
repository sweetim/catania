import { describe, expect, mock, spyOn, test } from "bun:test";
import { EventEmitter } from "node:events";
import { chooseComputerAction, getComputerActionDelay } from "../../src/game/computer";
import { createBoard, seededRandom } from "../../src/game/board";
import { emptyResources, getScore, legalRoadEdges, resourceTotal } from "../../src/game/engine";
import { formatGameMessage } from "../../src/game/messages";
import { GAME_VARIANTS, type GameAction, type GamePhase, type GameState, type MonopolyEvent, type Resources } from "../../src/game/types";
import { ACTIVE_PROFILE_STORAGE_KEY, PROFILES_STORAGE_KEY } from "../../src/profile";
import { parseAction, parseClientMessage, parseServerMessage } from "../../src/multiplayer/protocol";
import { parseInvitationUrl } from "../../src/multiplayer/invitation";
import type { TradeIdentity } from "../../src/multiplayer/protocol";
import { HostRoom, publicGame } from "../../src/multiplayer/state";
import type { MultiplayerSession, SessionView } from "../../src/multiplayer/types";

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
function send(room: HostRoom, connectionId: string, action: GameAction, version = room.version, trade?: TradeIdentity, requestId: string = crypto.randomUUID()) {
  return room.command(connectionId, { type: "action", requestId, version, action, ...(trade ? { trade } : {}) });
}
function give(game: GameState, playerId: string, amounts: Partial<Resources>) {
  const player = game.players.find(player => player.id === playerId)!;
  for (const [resource, amount] of Object.entries(amounts) as [keyof Resources, number][]) {
    player.resources[resource] += amount;
    game.bank[resource] -= amount;
  }
}
function mixedRoom() {
  const { room, credentials } = lobby(1);
  room.addComputer();
  room.addComputer();
  room.start();
  return { room, credentials };
}

describe("host lobby board preview", () => {
  test.each([0, 1, 2])("starts on the exact preview after %s shuffles, preserving ports, robber and seat identities", shuffles => {
    const { room } = lobby();
    room.addComputer();
    room.removePlayer("player-2");
    for (let index = 0; index < shuffles; index++) {
      const before = room.snapshot();
      room.shuffleBoard();
      expect(room.version).toBe(before.version + 1);
      expect(room.snapshot().players).toEqual(before.players);
      expect(room.snapshot().previewBoard).not.toEqual(before.previewBoard);
    }
    const preview = room.snapshot().previewBoard!;
    expect(preview.tiles).toHaveLength(19);
    expect(preview.ports).toHaveLength(9);
    room.start();
    expect(room.game!.board).toEqual(preview);
    expect(room.game!.board.ports).toEqual(preview.ports);
    expect(room.game!.robberTileId).toBe(preview.tiles.find(tile => tile.terrain === "desert")!.id);
    expect(room.game!.players.map(player => player.id).toSorted()).toEqual(["player-1", "player-3", "player-4"]);
    expect(room.snapshot()).not.toHaveProperty("previewBoard");
    expect(room.snapshot("connection-1")).not.toHaveProperty("previewBoard");
    expect(room.snapshot("connection-1").game!.board).toEqual(preview);
    const started = room.snapshot();
    expect(() => room.shuffleBoard()).toThrow("lobby");
    expect(room.snapshot()).toEqual(started);
  });

  test("roster changes, renames, disconnects and reconnects do not regenerate the preview", () => {
    const { room, credentials } = lobby(1);
    const preview = room.snapshot().previewBoard;
    for (const operation of [
      () => room.join("connection-2", { type: "join", secret, name: "Grace" }),
      () => room.admit("connection-2"),
      () => room.addComputer(),
      () => room.renameComputer("player-3", "Rover"),
      () => room.disconnect("connection-1"),
      () => room.join("replacement", { type: "join", secret, name: "Ada", credential: credentials[0]! }),
      () => room.join("pending", { type: "join", secret, name: "Linus" }),
      () => room.reject("pending"),
      () => room.removePlayer("player-2"),
    ]) {
      operation();
      expect(room.snapshot().previewBoard).toEqual(preview);
    }
    expect(() => room.start()).toThrow("three or four");
    expect(room.snapshot().previewBoard).toEqual(preview);
  });

  test("snapshot edits cannot alter the authoritative preview or starting board", () => {
    const { room } = lobby();
    const original = room.snapshot().previewBoard!;
    const exposed = room.snapshot().previewBoard!;
    exposed.tiles[0]!.terrain = "desert";
    exposed.tiles[0]!.number = 12;
    exposed.vertices[0]!.building = { playerId: "player-1", kind: "city" };
    exposed.edges[0]!.playerId = "player-1";
    exposed.ports[0]!.edgeId = "edge-99";
    expect(room.snapshot().previewBoard).toEqual(original);
    room.start();
    expect(room.game!.board).toEqual(original);
    original.tiles[0]!.x += 100;
    expect(room.game!.board).not.toEqual(original);
  });

  test("preview stays local to the host and the guest protocol rejects preview fields and shuffle commands", () => {
    const { room } = lobby(1);
    room.join("pending", { type: "join", secret, name: "Grace" });
    const previewBoard = room.snapshot().previewBoard;
    expect(previewBoard).toBeDefined();
    for (const connectionId of ["connection-1", "pending", "outsider"]) {
      const snapshot = room.snapshot(connectionId);
      expect(snapshot).not.toHaveProperty("previewBoard");
      expect(() => parseServerMessage({ type: "snapshot", snapshot })).not.toThrow();
      expect(() => parseServerMessage({ type: "snapshot", snapshot: { ...snapshot, previewBoard } })).toThrow();
    }
    expect(() => parseClientMessage({ type: "shuffle-board", requestId: "request", version: room.version })).toThrow();
    expect(() => parseClientMessage({ type: "join", secret, name: "Linus", previewBoard })).toThrow();
  });
});

describe("multiplayer victory target", () => {
  test.each(GAME_VARIANTS)("%s defaults and version changes use the scenario target", variant => {
    const { room } = lobby();
    room.setVictoryPointsToWin(3);
    if (variant === "original") room.setVariant("seafarers");
    room.setVariant(variant);
    const target = variant === "original" ? 10 : variant === "seafarers" ? 13 : 12;
    expect(room.snapshot().victoryPointsToWin).toBe(target);
    expect(room.snapshot("connection-1").victoryPointsToWin).toBe(target);
    room.start();
    expect(room.game!.victoryPointsToWin).toBe(target);
  });

  test("accepts every integer from 3 to 13 without changing the map or seats", () => {
    const { room } = lobby();
    const initial = room.snapshot();
    for (let points = 3; points <= 13; points++) {
      const version = room.version;
      room.setVictoryPointsToWin(points);
      expect(room.version).toBe(version + 1);
      const snapshot = room.snapshot();
      expect(snapshot.victoryPointsToWin).toBe(points);
      expect(snapshot.previewBoard).toEqual(initial.previewBoard);
      expect(snapshot.mapSeed).toBe(initial.mapSeed);
      expect(snapshot.players).toEqual(initial.players);
      const phone = room.snapshot("connection-1");
      expect(phone.victoryPointsToWin).toBe(points);
      expect(parseServerMessage({ type: "snapshot", snapshot: phone })).toMatchObject({ snapshot: { victoryPointsToWin: points } });
      room.setVictoryPointsToWin(points);
      expect(room.version).toBe(version + 1);
    }
  });

  test.each([2, 14, 3.5, NaN, Infinity, -1])("rejects invalid target %s without changing the room", points => {
    const { room } = lobby();
    const before = room.snapshot();
    expect(() => room.setVictoryPointsToWin(points)).toThrow("3 to 13");
    expect(room.snapshot()).toEqual(before);
  });

  test("preserves the custom target through map changes, reset and rematch and locks it during play", () => {
    const { room } = lobby();
    room.setVictoryPointsToWin(7);
    room.setVariant("original");
    room.shuffleBoard();
    room.useMapSeed("ABCDEFGH");
    expect(room.snapshot().victoryPointsToWin).toBe(7);
    room.start();
    const initial = room.snapshot();
    expect(() => room.setVictoryPointsToWin(8)).toThrow("lobby");
    expect(room.snapshot()).toEqual(initial);
    expect(room.game!.victoryPointsToWin).toBe(7);
    room.resetGame();
    expect(room.game!.victoryPointsToWin).toBe(7);
    room.endGame();
    expect(room.snapshot().victoryPointsToWin).toBe(7);
    room.start();
    expect(room.snapshot("connection-1").game!.victoryPointsToWin).toBe(7);
  });

  for (const variant of GAME_VARIANTS) {
    test.each([3, 7, 13])(`${variant} wins at the selected %s points, not before`, points => {
      const { room } = lobby();
      room.setVariant(variant);
      room.setVictoryPointsToWin(points);
      room.start();
      const game = room.game!;
      game.phase = { type: "actions" };
      game.turnNumber = 3;
      const player = game.players.find(player => player.id === game.activePlayerId)!;
      player.developmentCards = Array.from({ length: points - 2 }, (_, index) =>
        ({ id: `development-${index + 1}`, kind: "victory-point", purchasedTurn: 0 }));
      game.developmentDeck = ["victory-point", "victory-point"];
      give(game, player.id, { wool: 2, grain: 2, ore: 2 });
      expect(send(room, activeConnection(room), { type: "buy-development" }).error).toBeNull();
      expect(getScore(room.game!, player.id).total).toBe(points - 1);
      expect(room.game!.winnerId).toBeNull();
      expect(send(room, activeConnection(room), { type: "buy-development" }).error).toBeNull();
      expect(getScore(room.game!, player.id).total).toBe(points);
      expect(room.game!.winnerId).toBe(player.id);
      expect(room.game!.phase.type).toBe("finished");
      const phone = room.snapshot(connectionFor(player.id));
      expect(phone.game!.victoryPointsToWin).toBe(points);
      expect(() => parseServerMessage({ type: "snapshot", snapshot: phone })).not.toThrow();
    });
  }

  test("the phone protocol rejects invalid or inconsistent targets and target-changing commands", () => {
    const { room } = started();
    const snapshot = room.snapshot("connection-1");
    for (const points of [2, 14, 3.5, null, "7", undefined]) {
      expect(() => parseServerMessage({ type: "snapshot", snapshot: { ...snapshot, victoryPointsToWin: points } })).toThrow();
      expect(() => parseServerMessage({ type: "snapshot", snapshot: {
        ...snapshot, game: { ...snapshot.game!, victoryPointsToWin: points },
      } })).toThrow();
    }
    expect(() => parseServerMessage({ type: "snapshot", snapshot: { ...snapshot, victoryPointsToWin: 7 } })).toThrow();
    expect(() => parseClientMessage({ type: "set-victory-points-to-win", requestId: "request", version: room.version, points: 7 })).toThrow();
  });
});

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

  test("host has no seat; requires three or four seats with connected humans and preserves player IDs after shuffle", () => {
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
    expect(send(room, previousConnection, { type: "roll" }).error?.key).toContain("not bound");
    const version = room.version;
    room.disconnect(previousConnection);
    expect(room.version).toBe(version);
    expect(send(room, "replacement", { type: "roll" }).error).toBeNull();
  });
});

describe("multiplayer computer seats", () => {
  for (const count of [3, 4]) {
    test.each(Array.from({ length: count + 1 }, (_, index) => index))(`${count} seats start with %s humans and preserve mixed control after shuffle`, humans => {
      const { room } = lobby(humans);
      for (let index = humans; index < count; index++) room.addComputer();
      const players = room.snapshot().players;
      expect(players.every(player => player.connected)).toBe(true);
      room.start();
      for (const player of room.game!.players) {
        const { connected, ...profile } = players.find(seat => seat.id === player.id)!;
        expect(player).toMatchObject(profile);
      }
      expect(room.game!.players.filter(player => player.control === "human")).toHaveLength(humans);
      expect(room.snapshot().privatePlayer).toBeNull();
    });
  }

  test("computer names avoid seated and pending humans, case-insensitively", () => {
    const room = new HostRoom(secret);
    room.join("first", { type: "join", secret, name: " COMPUTER 1 " });
    room.admit("first");
    room.join("pending", { type: "join", secret, name: "computer 2" });
    room.addComputer();
    room.addComputer();
    expect(room.snapshot().players.map(player => player.name)).toEqual(["COMPUTER 1", "Computer 3", "Computer 4"]);
    expect(() => room.join("duplicate", { type: "join", secret, name: "computer 3" })).toThrow("different name");
    room.admit("pending");
    expect(room.snapshot("pending").players).toHaveLength(4);
  });

  test("capacity includes computers, pending admission rechecks it, and players can only be removed in the lobby", () => {
    const { room } = lobby(1);
    room.join("pending", { type: "join", secret, name: "Grace" });
    for (let index = 0; index < 3; index++) room.addComputer();
    const before = room.snapshot();
    expect(() => room.addComputer()).toThrow("four players");
    expect(() => room.admit("pending")).toThrow("four players");
    expect(() => room.join("late", { type: "join", secret, name: "Linus" })).toThrow("four players");
    expect(() => room.removePlayer("unknown")).toThrow("player");
    expect(room.snapshot()).toEqual(before);
    expect(room.removePlayer("player-2")).toBeNull();
    room.removePlayer("player-3");
    expect(() => room.start()).toThrow("three or four");
    room.addComputer();
    room.start();
    expect(() => room.addComputer()).toThrow("lobby");
    expect(() => room.removePlayer("player-4")).toThrow("lobby");
    expect(() => room.removePlayer("player-1")).toThrow("lobby");
    expect(() => room.renameComputer("player-4", "New name")).toThrow("lobby");
  });

  test("removed slots can be reused by humans and computers without changing remaining identities or colors", () => {
    const { room } = lobby(1);
    for (let index = 0; index < 3; index++) room.addComputer();
    const original = room.snapshot().players;
    room.removePlayer("player-2");
    room.join("replacement", { type: "join", secret, name: "Grace" });
    room.admit("replacement");
    room.removePlayer("player-3");
    room.addComputer();
    const players = room.snapshot().players;
    expect(new Set(players.map(player => player.id)).size).toBe(4);
    expect(new Set(players.map(player => player.color)).size).toBe(4);
    expect(players.find(player => player.id === "player-1")).toEqual(original[0]!);
    expect(players.find(player => player.id === "player-4")).toEqual(original[3]!);
    expect(players.find(player => player.id === "player-2")).toMatchObject({ name: "Grace", control: "human", color: original[1]!.color });
    room.start();
    expect(room.snapshot("replacement").privatePlayer).toMatchObject({ id: "player-2", name: "Grace", color: original[1]!.color, control: "human" });
  });

  test("starting with an unfilled ID gap preserves roster, active player and snake setup identities", () => {
    const { room } = lobby(1);
    for (let index = 0; index < 3; index++) room.addComputer();
    room.removePlayer("player-2");
    const players = room.snapshot().players;
    room.start();
    for (const player of room.game!.players) {
      const { connected, ...profile } = players.find(seat => seat.id === player.id)!;
      expect(player).toMatchObject(profile);
    }
    const order = room.game!.players.map(player => player.id);
    expect(room.game!.activePlayerId).toBe(order[0]!);
    expect(room.game!.setupOrder).toEqual([...order, ...order.toReversed()]);
    expect(order.toSorted()).toEqual(["player-1", "player-3", "player-4"]);
  });

  test("human disconnects still block start, never convert to computers, and leave computer availability unchanged", () => {
    const { room, credentials } = lobby(1);
    room.addComputer();
    room.addComputer();
    room.disconnect("connection-1");
    expect(() => room.start()).toThrow("connected");
    expect(room.snapshot().players.map(player => player.connected)).toEqual([false, true, true]);
    room.join("replacement", { type: "join", secret, name: "Ada", credential: credentials[0]! });
    room.start();
    room.disconnect("replacement");
    room.game!.activePlayerId = "player-1";
    room.game!.phase = { type: "roll" };
    expect(room.performComputer()).toBe(false);
    expect(room.snapshot().game!.players.find(player => player.id === "player-1")).toMatchObject({ control: "human", connected: false });
    expect(room.snapshot().players.filter(player => player.control === "computer").every(player => player.connected)).toBe(true);
  });
});

describe("lobby removal and computer names", () => {
  test.each([true, false])("removing a human with connected=%s revokes credentials and permits safe seat reuse", connected => {
    const { room, credentials } = lobby();
    const original = room.snapshot().players;
    if (!connected) room.disconnect("connection-2");
    const version = room.version;
    expect(room.removePlayer("player-2")).toBe(connected ? "connection-2" : null);
    expect(room.version).toBe(version + 1);
    expect(room.snapshot().players).toEqual([original[0]!, original[2]!]);
    expect(room.snapshot("connection-2").playerId).toBeNull();
    expect(send(room, "connection-2", { type: "roll" }).error?.key).toContain("not bound");
    expect(() => room.join("revoked", { type: "join", secret, name: "Grace", credential: credentials[1]! })).toThrow("credential");
    expect(room.snapshot().pendingPlayers).toEqual([]);

    room.addComputer();
    expect(room.snapshot().players.find(player => player.id === "player-2")).toMatchObject({ color: original[1]!.color, control: "computer" });
    expect(() => room.join("revoked", { type: "join", secret, name: "Grace", credential: credentials[1]! })).toThrow("credential");
    room.removePlayer("player-2");
    room.join("fresh", { type: "join", secret, name: "Grace" });
    expect(room.snapshot("fresh").playerId).toBeNull();
    const credential = room.admit("fresh");
    expect(credential).not.toBe(credentials[1]!);
    room.disconnect("connection-2");
    expect(room.snapshot("fresh").players.toSorted((first, second) => first.id.localeCompare(second.id))).toEqual(original);
    expect(room.join("other-phone", { type: "join", secret, name: "Linus", credential: credentials[2]! }).credential).toBe(credentials[2]!);
    room.start();
    expect(room.snapshot("fresh").privatePlayer).toMatchObject({ id: "player-2", name: "Grace", color: original[1]!.color });
    expect(room.snapshot("connection-2").privatePlayer).toBeNull();
    expect(() => room.join("revoked", { type: "join", secret, name: "Grace", credential: credentials[1]! })).toThrow("credential");
  });

  test("removing a human leaves existing identities unchanged through game start", () => {
    const { room } = lobby(4);
    room.removePlayer("player-2");
    room.start();
    expect(room.game!.players.map(player => player.id).toSorted()).toEqual(["player-1", "player-3", "player-4"]);
    for (const player of room.game!.players) {
      expect(player.name).toBe(names[Number(player.id.split("-")[1]) - 1]!);
      expect(room.snapshot(connectionFor(player.id)).privatePlayer!.id).toBe(player.id);
    }
  });

  test.each(["", " ", "a".repeat(21), "a".repeat(81), "Name\n", "Name\u0000", "Name\u200b"])("invalid computer name %j cannot mutate the lobby", name => {
    const { room } = lobby(1);
    room.addComputer();
    const before = room.snapshot();
    expect(() => room.renameComputer("player-2", name)).toThrow("name");
    expect(room.snapshot()).toEqual(before);
  });

  test("computer renaming normalizes NFC, preserves identity, and avoids all seated and pending names", () => {
    const { room } = lobby(1);
    room.addComputer();
    room.addComputer();
    room.join("pending", { type: "join", secret, name: "Zo\u00eb" });
    const original = room.snapshot().players[1]!;
    const version = room.version;
    room.renameComputer(original.id, " e\u0301mile ");
    expect(room.version).toBe(version + 1);
    const renamed = { ...original, name: "\u00e9mile" };
    for (const connectionId of [undefined, "connection-1", "pending"]) {
      expect(room.snapshot(connectionId).players[1]).toEqual(renamed);
    }
    room.renameComputer(original.id, " \u00e9mile ");
    expect(room.version).toBe(version + 1);
    for (const name of [" ADA ", "computer 2", " ZOE\u0308 "]) {
      expect(() => room.renameComputer(original.id, name)).toThrow("different name");
    }
    expect(() => room.renameComputer("player-1", "Human renamed")).toThrow("computer");
    expect(() => room.renameComputer("missing", "Missing renamed")).toThrow("computer");
    expect(room.version).toBe(version + 1);
    expect(() => room.join("duplicate", { type: "join", secret, name: "E\u0301MILE" })).toThrow("different name");
    room.addComputer();
    expect(room.snapshot().players[3]!.name).toBe("Computer 1");
    room.start();
    expect(room.game!.players.find(player => player.id === original.id)).toMatchObject({ id: original.id, color: original.color, control: "computer", name: "\u00e9mile" });
    expect(room.snapshot("connection-1").game!.players.find(player => player.id === original.id)!.name).toBe("\u00e9mile");
    expect(() => room.renameComputer(original.id, "Too late")).toThrow("lobby");
  });
});

describe("host-authoritative computer actions", () => {
  function computerRequestRoom() {
    const { room } = mixedRoom();
    const game = room.game!;
    game.activePlayerId = "player-2";
    game.phase = { type: "actions" };
    game.board.vertices[0]!.building = { playerId: "player-2", kind: "settlement" };
    give(game, "player-2", { wood: 4, grain: 2, ore: 2 });
    give(game, "player-1", { ore: 1 });
    game.board.ports = [];
    return room;
  }

  test("computers initiate requests, wait for a phone price, and complete trades without exposing their hand", () => {
    const clock = spyOn(Date, "now").mockReturnValue(1000);
    try {
      const room = computerRequestRoom();
      expect(room.performComputer()).toBe(true);
      expect(room.game!.trade).toMatchObject({ offeredBy: "player-2", give: null, receive: resources({ ore: 1 }), expiresAt: 16_000 });
      expect(room.performComputer()).toBe(true);
      expect(room.game!.trade!.responses["player-3"]).toBe(false);
      const version = room.version;
      expect(room.performComputer()).toBe(false);
      expect(room.version).toBe(version);
      expect(getComputerActionDelay(room.game!)).toBe(15_000);
      const snapshot = room.snapshot("connection-1");
      expect(parseServerMessage({ type: "snapshot", snapshot })).toMatchObject({ snapshot: { game: { trade: { expiresAt: 16_000 } } } });
      expect(snapshot.game).not.toHaveProperty("computerTradeRequested");
      expect(snapshot.game!.players.find(player => player.id === "player-2")).not.toHaveProperty("resources");
      expect(send(room, "connection-1", { type: "propose-trade", price: resources({ wood: 1 }) }).error).toBeNull();
      const bank = { ...room.game!.bank };
      expect(room.performComputer()).toBe(true);
      expect(room.game!.trade).toBeNull();
      expect(room.game!.bank).toEqual(bank);
      expect(room.snapshot("connection-1").privatePlayer!.resources).toEqual(resources({ wood: 1 }));
      expect(room.performComputer()).toBe(true);
      expect(room.game!.board.vertices[0]!.building?.kind).toBe("city");
    } finally {
      clock.mockRestore();
    }
  });

  test("unanswered computer requests expire at their original deadline and resume bank trading", () => {
    const clock = spyOn(Date, "now").mockReturnValue(1000);
    try {
      const room = computerRequestRoom();
      expect(room.performComputer()).toBe(true);
      clock.mockReturnValue(6000);
      expect(room.performComputer()).toBe(true);
      expect(room.game!.trade!.expiresAt).toBe(16_000);
      expect(getComputerActionDelay(room.game!)).toBe(10_000);
      expect(room.performComputer()).toBe(false);
      clock.mockReturnValue(15_999);
      expect(room.performComputer()).toBe(false);
      clock.mockReturnValue(16_000);
      expect(room.performComputer()).toBe(true);
      expect(room.game!.trade).toBeNull();
      expect(room.game!.computerTradeRequested).toBe(true);
      expect(chooseComputerAction(room.game!, "player-2")).toEqual({ type: "bank-trade", give: "wood", receive: "ore" });
      expect(room.performComputer()).toBe(true);
      expect(room.game!.trade).toBeNull();
      const snapshot = room.snapshot("connection-1");
      snapshot.game!.trade = { offeredBy: "player-2", give: null, receive: resources({ ore: 1 }), responses: {}, expiresAt: -1 };
      expect(() => parseServerMessage({ type: "snapshot", snapshot })).toThrow();
    } finally {
      clock.mockRestore();
    }
  });

  test("mixed setup uses legal computer choices and rejects manual computer placements and build choices", () => {
    const { room } = mixedRoom();
    let steps = 0;
    while (room.game!.phase.type.startsWith("setup")) {
      const game = room.game!;
      if (game.players.find(player => player.id === game.activePlayerId)!.control === "computer") {
        const action = chooseComputerAction(game, game.activePlayerId)!;
        const before = room.snapshot();
        expect(before.boardTargets).toEqual({ vertices: [], edges: [], tiles: [] });
        expect(() => room.performBoard(action)).toThrow("computer");
        expect(() => room.selectBuild(null)).toThrow("computer");
        expect(room.snapshot()).toEqual(before);
        expect(room.performComputer()).toBe(true);
      } else {
        expect(room.performComputer()).toBe(false);
        const targets = room.snapshot().boardTargets;
        room.performBoard(game.phase.type === "setup-settlement"
          ? { type: "place-settlement", vertexId: targets.vertices[0]! }
          : { type: "place-road", edgeId: targets.edges[0]! });
      }
      steps++;
    }
    expect(steps).toBe(12);
    expect(room.game!.phase.type).toBe("roll");
    for (const player of room.game!.players) {
      expect(room.game!.board.vertices.filter(vertex => vertex.building?.playerId === player.id)).toHaveLength(2);
      expect(room.game!.board.edges.filter(edge => edge.playerId === player.id)).toHaveLength(2);
    }
  });

  test("computer turns advance once per current version and stop for humans or a finished game", () => {
    const { room } = mixedRoom();
    room.game!.activePlayerId = "player-2";
    room.game!.phase = { type: "roll" };
    const version = room.version;
    expect(room.performComputer(version)).toBe(true);
    expect(room.version).toBe(version + 1);
    expect(room.game!.dice).not.toBeNull();
    expect(() => room.performComputer(version)).toThrow("game changed");
    room.game!.phase = { type: "actions" };
    expect(() => room.selectBuild("road")).toThrow("computer");
    expect(room.performComputer()).toBe(true);
    expect(room.game!.activePlayerId).not.toBe("player-2");
    room.game!.activePlayerId = "player-1";
    room.game!.phase = { type: "roll" };
    expect(room.performComputer()).toBe(false);
    room.game!.activePlayerId = "player-2";
    room.game!.phase = { type: "finished" };
    expect(room.performComputer()).toBe(false);
  });

  test.each(["player-1", "player-2"])("computers discard with %s active even while a human obligation remains first", activePlayerId => {
    const { room } = mixedRoom();
    room.game!.activePlayerId = activePlayerId;
    give(room.game!, "player-1", { wood: 8 });
    give(room.game!, "player-2", { brick: 8 });
    give(room.game!, "player-3", { ore: 10 });
    room.game!.phase = { type: "discard", required: { "player-1": 4, "player-2": 4, "player-3": 5 } };
    expect(room.performComputer()).toBe(true);
    expect(room.performComputer()).toBe(true);
    expect(room.performComputer()).toBe(false);
    expect(room.game!.phase).toEqual({ type: "discard", required: { "player-1": 4 } });
    expect(resourceTotal(room.game!.players.find(player => player.id === "player-2")!.resources)).toBe(4);
    expect(resourceTotal(room.game!.players.find(player => player.id === "player-3")!.resources)).toBe(5);
    expect(send(room, "connection-1", { type: "discard", resources: resources({ wood: 4 }) }).error).toBeNull();
    expect(room.snapshot().game!.phase).toEqual({ type: "robber", returnPhase: "actions" });
    if (activePlayerId === "player-2") {
      const previousTile = room.game!.robberTileId;
      const action = chooseComputerAction(room.game!, activePlayerId)!;
      expect(room.snapshot().boardTargets).toEqual({ vertices: [], edges: [], tiles: [] });
      expect(() => room.performBoard(action)).toThrow("computer");
      expect(room.performComputer()).toBe(true);
      expect(room.game!.robberTileId).not.toBe(previousTile);
    }
  });

  test.each(["offer-trade", "request-trade"] as const)("off-turn computers answer %s once without advancing or taking over the human turn", type => {
    const { room } = mixedRoom();
    room.game!.activePlayerId = "player-1";
    room.game!.phase = { type: "actions" };
    give(room.game!, "player-1", { wool: 1 });
    give(room.game!, "player-2", { wood: 1, grain: 1, ore: 1 });
    const action: GameAction = type === "offer-trade"
      ? { type, give: resources({ wool: 1 }), receive: resources({ wood: 1 }) }
      : { type, receive: resources({ wood: 1 }) };
    expect(send(room, "connection-1", action).error).toBeNull();
    const hands = structuredClone(room.game!.players);
    expect(room.performComputer()).toBe(true);
    expect(room.performComputer()).toBe(true);
    expect(room.performComputer()).toBe(false);
    expect(room.game!.trade!.responses["player-2"]).toEqual(resources({ wool: 1 }));
    expect(room.game!.trade!.responses["player-3"]).toBe(false);
    expect(room.game!.players).toEqual(hands);
    expect(room.game!.activePlayerId).toBe("player-1");
    expect(send(room, "connection-1", { type: "complete-trade", playerId: "player-2" }).error).toBeNull();
  });

  test("computer hands stay private, no reconnect credential binds a computer, and phones cannot take its turn", () => {
    const { room } = mixedRoom();
    const computer = room.game!.players.find(player => player.id === "player-2")!;
    give(room.game!, computer.id, { ore: 3 });
    computer.developmentCards.push({ id: "development-9", kind: "victory-point", purchasedTurn: 0 });
    room.game!.activePlayerId = computer.id;
    room.game!.phase = { type: "roll" };
    for (const connectionId of [undefined, "connection-1", computer.id, "outsider"]) {
      const snapshot = room.snapshot(connectionId);
      expect(snapshot.privatePlayer?.control).not.toBe("computer");
      expect(snapshot.game?.players.find(player => player.id === computer.id)).not.toHaveProperty("resources");
      expect(JSON.stringify(snapshot)).not.toContain("development-9");
      expect(JSON.stringify(snapshot)).not.toContain("victory-point");
    }
    expect(room.snapshot("connection-1").game!.players.find(player => player.id === computer.id)).toMatchObject({ control: "computer", resourceCount: 3, developmentCount: 1, score: 0 });
    expect(() => room.join("takeover", { type: "join", secret, name: computer.name, credential: computer.id })).toThrow("credential");
    expect(send(room, computer.id, { type: "roll" }).error?.key).toContain("not bound");
    expect(send(room, "connection-1", { type: "roll" }).error?.key).toContain("Wait for your turn");
    expect(send(room, "connection-1", { type: "roll", playerId: computer.id } as GameAction).error?.key).toContain("unexpected fields");
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
      "activePlayerId", "awards", "bank", "board", "canCancelKnight", "developmentPlayed", "developmentRemaining", "dice", "gameId", "log", "phase", "players", "robberTileId", "pirateTileId", "variant", "victoryPointsToWin", "shipMoved", "shipsBuiltThisTurn", "trade", "turnNumber", "winnerId",
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
    expect(send(room, activeConnection(room), { type: "buy-development" }).error).toBeNull();
    expect(formatGameMessage("en", room.snapshot().game!.log.at(-1)!)).toContain("buys a development card");
    expect(JSON.stringify(room.snapshot().game)).not.toContain("victory-point");
    const victim = room.game!.players.find(player => player.id !== room.game!.activePlayerId)!;
    give(room.game!, victim.id, { brick: 1 });
    room.game!.phase = { type: "steal", victimIds: [victim.id], returnPhase: "actions" };
    expect(send(room, activeConnection(room), { type: "steal", playerId: victim.id }).error).toBeNull();
    expect(formatGameMessage("en", room.snapshot().game!.log.at(-1)!)).toContain("steals one resource card");
    expect(JSON.stringify(room.snapshot().game!.log.at(-1))).not.toContain("brick");
  });
});

describe("victory results and lobby return", () => {
  test("finished games broadcast each player's full score breakdown; unfinished games keep it private", () => {
    const { room } = started();
    const game = room.game!;
    game.phase = { type: "actions" };
    expect(room.snapshot("connection-1").game!.players.every(player => !("scoreBreakdown" in player))).toBe(true);

    game.board.vertices[0]!.building = { playerId: "player-1", kind: "city" };
    game.players.find(player => player.id === "player-1")!.developmentCards.push({ id: "development-1", kind: "victory-point", purchasedTurn: 1 });
    game.phase = { type: "finished" };
    game.winnerId = "player-1";
    const snapshot = room.snapshot("connection-1");
    const winner = snapshot.game!.players.find(player => player.id === "player-1")!;
    expect(winner.score).toBe(getScore(game, "player-1").total);
    expect(winner.scoreBreakdown).toEqual(getScore(game, "player-1"));
    expect(() => parseServerMessage({ type: "snapshot", snapshot })).not.toThrow();

    for (const scoreBreakdown of [
      null, "1", {}, { ...winner.scoreBreakdown!, total: 99 },
      { ...winner.scoreBreakdown!, public: winner.scoreBreakdown!.public + 1 },
      { ...winner.scoreBreakdown!, extra: true },
    ]) {
      const players = snapshot.game!.players.map(player => ({ ...player, ...(player.id === "player-1" ? { scoreBreakdown } : {}) }));
      expect(() => parseServerMessage({ type: "snapshot", snapshot: { ...snapshot, game: { ...snapshot.game!, players } } })).toThrow();
    }
  });

  test("endGame works mid-game and returns every screen to the lobby with the same island and seats", () => {
    expect(() => lobby().room.endGame()).toThrow("not started");
    const { room, credentials } = started();
    // Progress does not block the return: hands, phases, and build modes are abandoned.
    give(room.game!, room.game!.activePlayerId, { wood: 1, brick: 1 });
    room.game!.phase = { type: "actions" };
    room.buildMode = "road";
    const mapSeed = room.snapshot().mapSeed!;
    const version = room.version;
    room.endGame();
    expect(room.version).toBe(version + 1);
    expect(room.game).toBeNull();
    expect(room.buildMode).toBeNull();
    // The lobby returns with its preview, connected seats and reconnectable credentials.
    const preview = room.snapshot().previewBoard!;
    expect(preview).toBeDefined();
    expect(room.snapshot().mapSeed).toBe(mapSeed);
    expect(room.snapshot().players.map(player => player.name)).toEqual(["Ada", "Grace", "Linus"]);
    const phone = room.snapshot("connection-1");
    expect(phone.game).toBeNull();
    expect(phone.privatePlayer).toBeNull();
    expect(phone.privateScore).toBeNull();
    expect(phone.playerId).toBe("player-1");
    expect(() => parseServerMessage({ type: "snapshot", snapshot: phone })).not.toThrow();
    room.disconnect("connection-1");
    room.join("replacement", { type: "join", secret, name: "Reconnected", credential: credentials[0]! });
    room.start();
    // The restarted game uses the same island with the same seats.
    expect(room.game).not.toBeNull();
    expect(room.game!.board).toEqual(preview);
    expect(room.snapshot().mapSeed).toBe(mapSeed);
    expect(room.snapshot("replacement").game!.players.map(player => player.name).toSorted()).toEqual(["Ada", "Grace", "Linus"]);
  });
});

describe("reset game", () => {
  test.each(["original", "seafarers"] as const)("restores the exact %s starting state and keeps seats and credentials", variant => {
    const { room, credentials } = lobby();
    room.addComputer();
    room.removePlayer("player-2");
    room.setVariant(variant);
    room.start();
    const initial = structuredClone(room.game!);
    const gameId = room.snapshot().game!.gameId;
    const mapSeed = room.snapshot().mapSeed;
    const playerId = initial.activePlayerId;
    const player = room.game!.players.find(player => player.id === playerId)!;
    give(room.game!, playerId, { wood: 3, grain: 2 });
    player.developmentCards.push({ id: "reset-card", kind: "knight", purchasedTurn: 1 });
    player.knightsPlayed = 3;
    room.game!.board.vertices[0]!.building = { playerId, kind: "city" };
    room.game!.board.edges[0]!.playerId = playerId;
    room.game!.board.edges[0]!.kind = variant === "seafarers" ? "ship" : "road";
    room.game!.developmentDeck.pop();
    room.game!.phase = { type: "actions" };
    room.game!.turnNumber = 5;
    room.game!.dice = [3, 4];
    room.game!.robberTileId = room.game!.board.tiles.find(tile => tile.id !== initial.robberTileId && tile.terrain !== "sea")!.id;
    room.game!.pirateTileId = null;
    room.game!.shipMoved = true;
    room.game!.shipsBuiltThisTurn = [room.game!.board.edges[0]!.id];
    room.game!.awards = { longestRoad: playerId, largestArmy: playerId };
    room.game!.trade = { offeredBy: playerId, give: resources({ wood: 1 }), receive: resources({ ore: 1 }), responses: {} };
    room.game!.thefts = [{ id: 1, thiefId: playerId, victimId: "player-3", resource: "grain" }];
    room.game!.monopolies = [{ id: 1, playerId, resource: "wood", losses: { "player-3": 1 } }];
    room.game!.developmentPlayed = true;
    room.buildMode = "road";
    room.disconnect("connection-3");
    const seats = room.snapshot().players;
    const version = room.version;

    room.resetGame();

    expect(room.game).toEqual(initial);
    expect(room.game).not.toBe(initial);
    expect(room.version).toBe(version + 1);
    expect(room.buildMode).toBeNull();
    expect(room.snapshot().mapSeed).toBe(mapSeed);
    expect(room.snapshot().game!.gameId).not.toBe(gameId);
    expect(room.snapshot().players).toEqual(seats);
    for (const connectionId of ["connection-1", "connection-3"]) {
      expect(() => parseServerMessage({ type: "snapshot", snapshot: room.snapshot(connectionId) })).not.toThrow();
    }
    expect(send(room, "connection-1", { type: "roll" }, version).error?.key).toContain("game changed");
    expect(() => room.performComputer(version)).toThrow("game changed");
    expect(room.game).toEqual(initial);
    room.join("reconnected", { type: "join", secret, name: "Linus", credential: credentials[2]! });
    expect(room.snapshot("reconnected").playerId).toBe("player-3");
    expect(room.snapshot("reconnected").privatePlayer!.resources).toEqual(emptyResources());
    room.resetGame();
    expect(room.game).toEqual(initial);
  });

  test("requires a started game and clears finished-game profile reports", () => {
    const { room } = lobby();
    expect(() => room.resetGame()).toThrow("not started");
    room.start();
    const initial = structuredClone(room.game);
    room.game!.phase = { type: "finished" };
    room.game!.winnerId = room.game!.activePlayerId;
    room.submitProfile("connection-1", { games: 1, wins: 1, totalPoints: 10 });
    room.resetGame();
    expect(room.game).toEqual(initial);
    expect(room.snapshot().profiles).toEqual({});
  });
});

describe("map codes", () => {
  test("every generated map has a host-only code and the preview rebuilds exactly from it", () => {
    const { room } = lobby();
    const initial = room.snapshot();
    expect(initial.mapSeed).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/);
    expect(initial.previewBoard).toEqual(createBoard(seededRandom(initial.mapSeed!)));
    expect(room.snapshot("connection-1")).not.toHaveProperty("mapSeed");
    expect(room.snapshot("connection-1")).not.toHaveProperty("profiles");

    room.shuffleBoard();
    const shuffled = room.snapshot();
    expect(shuffled.mapSeed).not.toBe(initial.mapSeed);
    expect(shuffled.previewBoard).toEqual(createBoard(seededRandom(shuffled.mapSeed!), "original"));

    const version = room.version;
    room.useMapSeed(" abcd2345 ");
    expect(room.snapshot().mapSeed).toBe("ABCD2345");
    expect(room.snapshot().previewBoard).toEqual(createBoard(seededRandom("ABCD2345"), "original"));
    expect(room.version).toBe(version + 1);
    room.useMapSeed("abcd2345");
    expect(room.version).toBe(version + 1);
    expect(() => room.useMapSeed("not-a-code")).toThrow("map code");

    room.start();
    expect(room.snapshot().game!.board).toEqual(createBoard(seededRandom("ABCD2345"), "original"));
    expect(() => room.useMapSeed("wxyz789k")).toThrow("lobby");
  });

  test("variant switches draw a fresh code and stay replayable, including across games", () => {
    const { room } = lobby(1);
    room.addComputer();
    room.addComputer();
    const original = room.snapshot().mapSeed!;
    room.setVariant("seafarers");
    const switched = room.snapshot();
    expect(switched.mapSeed).not.toBe(original);
    expect(switched.previewBoard).toEqual(createBoard(seededRandom(switched.mapSeed!), "seafarers"));
    room.useMapSeed(switched.mapSeed!);
    const version = room.version;
    room.setVariant("seafarers");
    expect(room.version).toBe(version);
    room.start();
    expect(room.snapshot().game!.board).toEqual(createBoard(seededRandom(switched.mapSeed!), "seafarers"));
  });
});

describe("player profile stats", () => {
  test("profile protocol messages validate strictly in both directions", () => {
    const stats = { games: 1, wins: 0, totalPoints: 7 };
    expect(parseClientMessage({ type: "profile-stats", stats })).toEqual({ type: "profile-stats", stats });
    for (const invalid of [
      { type: "profile-stats" },
      { type: "profile-stats", stats: {} },
      { type: "profile-stats", stats: { ...stats, games: -1 } },
      { type: "profile-stats", stats: { ...stats, wins: 1.5 } },
      { type: "profile-stats", stats: { ...stats, extra: 1 } },
      { type: "profile-stats", stats: { games: "1", wins: 0, totalPoints: 0 } },
      { type: "profile-stats", stats, requestId: "request" },
    ]) {
      expect(() => parseClientMessage(invalid)).toThrow();
    }
    expect(parseServerMessage({ type: "request-profile" })).toEqual({ type: "request-profile" });
    for (const invalid of [{ type: "request-profile", extra: true }, { type: "request-profile", requestId: "request" }]) {
      expect(() => parseServerMessage(invalid)).toThrow();
    }
  });

  test("each game carries a token-safe id that changes between games and is guest-validated", () => {
    const { room } = started();
    const snapshot = room.snapshot("connection-1");
    expect(snapshot.game!.gameId).toMatch(/^[a-zA-Z0-9_-]{1,80}$/);
    expect(() => parseServerMessage({ type: "snapshot", snapshot })).not.toThrow();
    expect(() => parseServerMessage({ type: "snapshot", snapshot: { ...snapshot, game: { ...snapshot.game!, gameId: "not a token" } } })).toThrow();
    expect(() => parseServerMessage({ type: "snapshot", snapshot: { ...snapshot, game: { ...snapshot.game!, gameId: undefined } } })).toThrow();

    room.game!.phase = { type: "finished" };
    room.game!.winnerId = room.game!.activePlayerId;
    room.endGame();
    room.start();
    expect(room.snapshot("connection-1").game!.gameId).not.toBe(snapshot.game!.gameId);
  });

  test("the host asks connected humans without stats after the finish and stores replies on their seats", () => {
    const { room, credentials } = started();
    expect(room.profileRequestConnectionIds()).toEqual([]);
    room.game!.phase = { type: "finished" };
    room.game!.winnerId = "player-1";
    expect(room.profileRequestConnectionIds().toSorted()).toEqual(["connection-1", "connection-2", "connection-3"]);
    room.disconnect("connection-2");
    expect(room.profileRequestConnectionIds().toSorted()).toEqual(["connection-1", "connection-3"]);

    expect(() => room.submitProfile("connection-1", { games: 4, wins: 2, totalPoints: 33 })).not.toThrow();
    expect(room.profileRequestConnectionIds()).toEqual(["connection-3"]);
    expect(() => room.submitProfile("outsider", { games: 1, wins: 0, totalPoints: 0 })).toThrow("not bound");

    const host = room.snapshot();
    expect(host.profiles).toEqual({ "player-1": { games: 4, wins: 2, totalPoints: 33 } });
    expect(room.snapshot("connection-1")).not.toHaveProperty("profiles");
    expect(() => parseServerMessage({ type: "snapshot", snapshot: room.snapshot("connection-1") })).not.toThrow();

    const version = room.version;
    room.submitProfile("connection-1", { games: 4, wins: 2, totalPoints: 33 });
    expect(room.version).toBe(version);
    room.submitProfile("connection-1", { games: 5, wins: 2, totalPoints: 40 });
    expect(room.version).toBe(version + 1);
    expect(room.snapshot().profiles!["player-1"]).toEqual({ games: 5, wins: 2, totalPoints: 40 });

    // A rematch clears the stored stats: the next finish requests them again.
    room.join("connection-2", { type: "join", secret, name: "Grace", credential: credentials[1]! });
    room.endGame();
    room.start();
    expect(room.snapshot().profiles).toEqual({});
    room.game!.phase = { type: "finished" };
    room.game!.winnerId = "player-1";
    expect(room.profileRequestConnectionIds().toSorted()).toEqual(["connection-1", "connection-2", "connection-3"]);
  });

  test("stats arrive only after the game finishes", () => {
    const { room } = started();
    room.game!.phase = { type: "actions" };
    expect(() => room.submitProfile("connection-1", { games: 1, wins: 1, totalPoints: 10 })).toThrow("finish");
    expect(room.snapshot().profiles).toEqual({});
  });

  test("finished phone snapshots include a valid replay map code without sharing profile history", () => {
    const { room } = started();
    expect(room.snapshot("connection-1")).not.toHaveProperty("mapSeed");
    room.game!.phase = { type: "finished" };
    room.game!.winnerId = "player-1";
    const snapshot = room.snapshot("connection-1");
    expect(snapshot.mapSeed).toBe(room.snapshot().mapSeed);
    expect(snapshot).not.toHaveProperty("profiles");
    expect(parseServerMessage({ type: "snapshot", snapshot })).toEqual({ type: "snapshot", snapshot });
    expect(() => parseServerMessage({ type: "snapshot", snapshot: { ...snapshot, mapSeed: "invalid" } })).toThrow();
  });

  test("guests record each finished game once into the local profile and reply with their totals", async () => {
    const OriginalPeer = (await import("peerjs")).default;
    const connection = Object.assign(new EventEmitter(), { open: true, send: mock(() => {}), close: mock(() => {}) });
    const peers: EventEmitter[] = [];
    class TestPeer extends EventEmitter {
      open = true;
      destroyed = false;
      disconnected = false;
      constructor() { super(); peers.push(this); }
      connect() { return connection; }
      destroy() { this.destroyed = true; }
    }
    type Timer = ReturnType<typeof setTimeout>;
    const timers = new Map<Timer, { callback: () => void; delay: number }>();
    let timerNumber = 0;
    const schedule = spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay: number) => {
      const timer = ++timerNumber as unknown as Timer;
      timers.set(timer, { callback, delay });
      return timer;
    }) as typeof setTimeout);
    const cancel = spyOn(globalThis, "clearTimeout").mockImplementation(timer => { timers.delete(timer as Timer); });
    const values = new Map<string, string>([
      [PROFILES_STORAGE_KEY, JSON.stringify([
        { id: "profile-1", name: "Ada", games: 0, wins: 0, totalPoints: 0, lastRecordedGameId: null },
      ])],
      [ACTIVE_PROFILE_STORAGE_KEY, "profile-1"],
    ]);
    Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: { getItem: () => null, setItem: () => {} } });
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => { values.set(key, value); },
        removeItem: (key: string) => { values.delete(key); },
      },
    });
    let guest: MultiplayerSession | undefined;
    mock.module("peerjs", () => ({ default: TestPeer }));
    try {
      const { joinSession } = await import("../../src/multiplayer/session");
      function finishedSnapshot(won: boolean): Parameters<typeof connection.emit>[1] {
        const room = new HostRoom(secret);
        for (const index of [0, 1, 2]) {
          room.join(`connection-${index + 1}`, { type: "join", secret, name: names[index]! });
          room.admit(`connection-${index + 1}`);
        }
        room.start();
        for (const index of won ? [0, 1, 2, 3, 4] : [0]) {
          room.game!.board.vertices[index]!.building = { playerId: "player-1", kind: "city" };
        }
        room.game!.phase = { type: "finished" };
        room.game!.winnerId = won ? "player-1" : "player-2";
        return room.snapshot("connection-1");
      }

      guest = joinSession({ hostId: "host-id", secret }, "Ada", () => {});
      peers.at(-1)!.emit("open");
      connection.emit("open");
      expect(connection.send).toHaveBeenCalledTimes(1);

      connection.emit("data", { type: "snapshot", snapshot: finishedSnapshot(false) });
      connection.emit("data", { type: "request-profile" });
      const reply = (connection.send as ReturnType<typeof mock>).mock.calls.at(-1)![0] as { type: string; stats: unknown };
      expect(reply).toEqual({ type: "profile-stats", stats: { games: 1, wins: 0, totalPoints: 2 } });
      const stored = JSON.parse(values.get(PROFILES_STORAGE_KEY)!)[0] as Record<string, unknown>;
      expect(stored).toEqual({
        id: "profile-1", name: "Ada", games: 1, wins: 0, totalPoints: 2,
        lastRecordedGameId: expect.any(String),
        history: [{
          gameId: stored.lastRecordedGameId,
          mapCode: expect.stringMatching(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/),
          variant: "original", won: false, points: 2, turnCount: expect.any(Number), completedAt: expect.any(String),
        }],
      });

      // The host retries the request; the same finished game still counts exactly once.
      connection.emit("data", { type: "request-profile" });
      expect((connection.send as ReturnType<typeof mock>).mock.calls.at(-1)![0]).toEqual({
        type: "profile-stats", stats: { games: 1, wins: 0, totalPoints: 2 },
      });

      // A new game accumulates: this time the phone's player wins with ten points.
      connection.emit("data", { type: "snapshot", snapshot: finishedSnapshot(true) });
      connection.emit("data", { type: "request-profile" });
      expect((connection.send as ReturnType<typeof mock>).mock.calls.at(-1)![0]).toEqual({
        type: "profile-stats", stats: { games: 2, wins: 1, totalPoints: 12 },
      });
      guest.close();
      expect(timers.size).toBe(0);
    } finally {
      guest?.close();
      schedule.mockRestore();
      cancel.mockRestore();
      mock.module("peerjs", () => ({ default: OriginalPeer }));
    }
  });
});

describe("private theft feedback", () => {
  test("host, admitted players, pending guests and outsiders have no theft events in the lobby", () => {
    const { room } = lobby();
    room.join("pending", { type: "join", secret, name: "Margaret" });
    for (const connectionId of [undefined, "connection-1", "pending", "outsider"]) {
      expect(room.snapshot(connectionId).privateThefts).toEqual([]);
    }
  });

  test("only each thief and victim receive the actual resources, without public or unrelated-player leaks", () => {
    const { room } = started(4);
    give(room.game!, "player-2", { ore: 1 });
    give(room.game!, "player-4", { wool: 1 });
    for (const [thiefId, victimId] of [["player-1", "player-2"], ["player-3", "player-4"], ["player-2", "player-1"]] as const) {
      room.game!.activePlayerId = thiefId;
      room.game!.phase = { type: "steal", victimIds: [victimId], returnPhase: "actions" };
      expect(send(room, connectionFor(thiefId), { type: "steal", playerId: victimId }).error).toBeNull();
    }
    const thefts: GameState["thefts"] = [
      { id: 1, thiefId: "player-1", victimId: "player-2", resource: "ore" },
      { id: 2, thiefId: "player-3", victimId: "player-4", resource: "wool" },
      { id: 3, thiefId: "player-2", victimId: "player-1", resource: "ore" },
    ];
    expect(room.game!.thefts).toEqual(thefts);
    for (const connectionId of [undefined, "outsider", "connection-1", "connection-2", "connection-3", "connection-4"]) {
      const snapshot = room.snapshot(connectionId);
      const expected = connectionId === "connection-1" || connectionId === "connection-2" ? [thefts[0]!, thefts[2]!]
        : connectionId === "connection-3" || connectionId === "connection-4" ? [thefts[1]!] : [];
      expect(snapshot.privateThefts).toEqual(expected);
      expect(snapshot.game).not.toHaveProperty("thefts");
      expect(snapshot.game).not.toHaveProperty("privateThefts");
      expect(JSON.stringify(snapshot.game)).not.toContain("thiefId");
      if (connectionId !== undefined) expect(() => parseServerMessage({ type: "snapshot", snapshot })).not.toThrow();
    }
    for (const entry of room.snapshot().game!.log.slice(-3)) {
      expect(formatGameMessage("en", entry)).toContain("steals one resource card");
      expect(JSON.stringify(entry)).not.toContain("ore");
      expect(JSON.stringify(entry)).not.toContain("wool");
    }
    room.snapshot("connection-1").privateThefts[0]!.resource = "brick";
    expect(room.game!.thefts).toEqual(thefts);
  });

  test("only losing players receive monopoly events, without public or monopolist leaks", () => {
    const { room } = started(4);
    give(room.game!, "player-2", { ore: 3 });
    give(room.game!, "player-4", { ore: 1 });
    room.game!.activePlayerId = "player-1";
    room.game!.phase = { type: "actions" };
    room.game!.turnNumber = 5;
    room.game!.players.find(player => player.id === "player-1")!.developmentCards.push({ id: "development-1", kind: "monopoly", purchasedTurn: 1 });
    expect(send(room, "connection-1", { type: "play-development", cardId: "development-1", resource: "ore" }).error).toBeNull();
    const event: MonopolyEvent = { id: 1, playerId: "player-1", resource: "ore", losses: { "player-2": 3, "player-4": 1 } };
    expect(room.game!.monopolies).toEqual([event]);
    for (const connectionId of [undefined, "outsider", "connection-1", "connection-2", "connection-3", "connection-4"]) {
      const snapshot = room.snapshot(connectionId);
      expect(snapshot.privateMonopolies).toEqual(connectionId === "connection-2" || connectionId === "connection-4" ? [event] : []);
      expect(snapshot.game).not.toHaveProperty("monopolies");
      expect(snapshot.game).not.toHaveProperty("privateMonopolies");
      expect(JSON.stringify(snapshot.game)).not.toContain("losses");
      if (connectionId !== undefined) expect(() => parseServerMessage({ type: "snapshot", snapshot })).not.toThrow();
    }
    room.snapshot("connection-2").privateMonopolies[0]!.losses["player-2"] = 19;
    expect(room.game!.monopolies).toEqual([event]);
  });

  test.each(["player-2", "player-4"])("reconnect retains monopoly history for losing player %s", playerId => {
    const { room, credentials } = started(4);
    room.game!.activePlayerId = "player-1";
    room.game!.phase = { type: "actions" };
    room.game!.turnNumber = 5;
    give(room.game!, playerId, { ore: 2 });
    room.game!.players.find(player => player.id === "player-1")!.developmentCards.push({ id: "development-1", kind: "monopoly", purchasedTurn: 1 });
    expect(send(room, "connection-1", { type: "play-development", cardId: "development-1", resource: "ore" }).error).toBeNull();
    const original = room.snapshot(connectionFor(playerId)).privateMonopolies;
    expect(original).toEqual([{ id: 1, playerId: "player-1", resource: "ore", losses: { [playerId]: 2 } }]);
    room.disconnect(connectionFor(playerId));
    expect(room.snapshot(connectionFor(playerId)).privateMonopolies).toEqual([]);
    const credential = credentials[Number(playerId.split("-")[1]) - 1]!;
    room.join("replacement", { type: "join", secret, name: "Reconnected", credential });
    const snapshot = room.snapshot("replacement");
    expect(snapshot.privateMonopolies).toEqual(original);
    expect(() => parseServerMessage({ type: "snapshot", snapshot })).not.toThrow();
  });

  test.each(["player-1", "player-2"])("reconnect retains theft history for %s and revokes the old connection", playerId => {
    const { room, credentials } = started();
    room.game!.activePlayerId = "player-1";
    room.game!.phase = { type: "steal", victimIds: ["player-2"], returnPhase: "actions" };
    give(room.game!, "player-2", { brick: 1 });
    expect(send(room, "connection-1", { type: "steal", playerId: "player-2" }).error).toBeNull();
    const original = room.snapshot(connectionFor(playerId)).privateThefts;
    expect(original).toEqual([{ id: 1, thiefId: "player-1", victimId: "player-2", resource: "brick" }]);
    room.disconnect(connectionFor(playerId));
    expect(room.snapshot(connectionFor(playerId)).privateThefts).toEqual([]);
    const credential = credentials[Number(playerId.split("-")[1]) - 1]!;
    room.join("replacement", { type: "join", secret, name: "Reconnected", credential });
    const snapshot = room.snapshot("replacement");
    expect(snapshot.privateThefts).toEqual(original);
    expect(room.snapshot(connectionFor(playerId)).privateThefts).toEqual([]);
    expect(() => parseServerMessage({ type: "snapshot", snapshot })).not.toThrow();
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
    expect(result.error).toBeNull();
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
    expect(send(room, connectionFor(actor), { type: "offer-trade", give: resources({ wood: 1 }), receive: resources({ brick: 1 }) }).error).toBeNull();
    const oldVersion = room.version;
    expect(send(room, connectionFor(actor), { type: "offer-trade", give: resources({ wood: 2 }), receive: resources({ brick: 2 }) }).error).toBeNull();
    const before = structuredClone(room.game);
    expect(send(room, connectionFor(opponent), { type: "respond-trade", accept: true }, oldVersion).error?.key).toContain("game changed");
    expect(send(room, connectionFor(opponent), { type: "respond-trade", accept: true }, room.version,
      { offeredBy: actor, give: resources({ wood: 1 }), receive: resources({ brick: 1 }) }).error?.key).toContain("game changed");
    expect(room.game).toEqual(before);
    expect(send(room, connectionFor(opponent), { type: "respond-trade", accept: true }).error).toBeNull();
  });

  test("trade responses survive unrelated version bumps but still target the same open trade", () => {
    const { room } = started();
    room.game!.phase = { type: "actions" };
    const actor = room.game!.activePlayerId;
    const others = room.game!.players.filter(player => player.id !== actor).map(player => player.id);
    const [responder, rival] = others;
    give(room.game!, responder!, { wood: 1 });
    expect(send(room, connectionFor(actor), { type: "request-trade", receive: resources({ wood: 1 }) }).error).toBeNull();
    const viewedVersion = room.version;
    const identity = { offeredBy: actor, give: null as Resources | null, receive: resources({ wood: 1 }) };
    // Another responder answers first, bumping the room version while the phone still shows the old snapshot.
    expect(send(room, connectionFor(rival!), { type: "respond-trade", accept: false }).error).toBeNull();
    expect(room.version).toBeGreaterThan(viewedVersion);
    expect(send(room, connectionFor(responder!), { type: "respond-trade", accept: false }, viewedVersion).error?.key).toContain("game changed");
    expect(send(room, connectionFor(responder!), { type: "respond-trade", accept: false }, viewedVersion, identity).error).toBeNull();
    expect(room.game!.trade!.responses[responder!]).toBe(false);
    // A trade identity is ignored for actions other than trade responses, so version checks still apply.
    expect(send(room, connectionFor(actor), { type: "end-turn" }, viewedVersion, identity).error?.key).toContain("game changed");
  });

  test("binds actor to the connection, never action payload playerId", () => {
    const { room } = started();
    room.game!.phase = { type: "roll" };
    const other = room.game!.players.find(player => player.id !== room.game!.activePlayerId)!.id;
    expect(send(room, connectionFor(other), { type: "roll" }).error?.key).toContain("Wait for your turn");
    expect(send(room, connectionFor(other), { type: "roll", playerId: room.game!.activePlayerId } as GameAction).error?.key).toContain("unexpected fields");
    expect(send(room, "not-admitted", { type: "roll" }).error?.key).toContain("not bound");
    expect(room.game!.phase.type).toBe("roll");
  });

  test("phone board commands are rejected even for active player; host acts only on authorized targets", () => {
    const { room } = started();
    const vertexId = room.snapshot().boardTargets.vertices[0]!;
    const actor = room.game!.activePlayerId;
    expect(send(room, activeConnection(room), { type: "place-settlement", vertexId }).error?.key).toContain("shared board");
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
    expect(room.command(connectionFor(other), { type: "select-build", piece: "road", requestId: "other-build", version: room.version }).error?.key).toContain("active player");
    const version = room.version;
    expect(room.command(connectionFor(actor), { type: "select-build", piece: "road", requestId: "own-build", version }).error).toBeNull();
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
    expect(send(room, activeConnection(room), { type: "move-robber", tileId: targets.tiles[0]! }).error?.key).toContain("shared board");
    room.performBoard({ type: "move-robber", tileId: targets.tiles[0]! });
    expect(room.game!.robberTileId).toBe(targets.tiles[0]!);
  });

  test("all accepted phone actions still pass engine rules and errors never mutate authority", () => {
    const { room } = started();
    const before = structuredClone(room.game);
    const version = room.version;
    expect(send(room, activeConnection(room), { type: "buy-development" }).error?.key).toContain("Roll the dice");
    expect(room.game).toEqual(before);
    expect(room.version).toBe(version);
    expect(getScore(room.game!, room.game!.activePlayerId).total).toBe(0);
  });
});

describe("untrusted multiplayer protocol", () => {
  test("requires bounded, strictly ordered theft events with exact fields and valid resources and identities", () => {
    const { room } = started();
    const snapshot = room.snapshot("connection-1");
    const theft = { id: 1, thiefId: "player-1", victimId: "player-2", resource: "ore" };
    for (const privateThefts of [[], [theft], [theft, { ...theft, id: 3 }], Array.from({ length: 100 }, (_, index) => ({ ...theft, id: index + 1 }))]) {
      expect(() => parseServerMessage({ type: "snapshot", snapshot: { ...snapshot, privateThefts } })).not.toThrow();
    }
    const missing = { ...snapshot };
    Reflect.deleteProperty(missing, "privateThefts");
    expect(() => parseServerMessage({ type: "snapshot", snapshot: missing })).toThrow();
    for (const privateThefts of [
      undefined, null, {}, "theft", [null], [{}],
      ...[0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "1"].map(id => [{ ...theft, id }]),
      ...[undefined, null, "gold", "desert"].map(resource => [{ ...theft, resource }]),
      [{ ...theft, thiefId: "player-9" }], [{ ...theft, victimId: "player-9" }],
      [{ ...theft, victimId: "player-1" }], [{ ...theft, thiefId: "player-2", victimId: "player-3" }],
      [{ ...theft, thiefId: "player-4" }], [{ ...theft, victimId: "player-4" }],
      [{ ...theft, extra: true }], [{ id: 1, thiefId: "player-1", victimId: "player-2" }],
      [theft, theft], [{ ...theft, id: 2 }, theft],
      Array.from({ length: 101 }, (_, index) => ({ ...theft, id: index + 1 })),
    ]) {
      expect(() => parseServerMessage({ type: "snapshot", snapshot: { ...snapshot, privateThefts } })).toThrow();
    }
  });

  test("rejects thefts without a private owner or game, foreign participants, and public theft fields", () => {
    const { room } = started();
    const snapshot = room.snapshot("connection-1");
    const privateThefts = [{ id: 1, thiefId: "player-1", victimId: "player-2", resource: "wood" }];
    for (const invalid of [
      { ...snapshot, privateThefts, privatePlayer: null },
      { ...snapshot, privateThefts, playerId: null, privatePlayer: null },
      { ...snapshot, privateThefts, game: null },
      { ...snapshot, privateThefts, game: { ...snapshot.game, players: snapshot.game!.players.filter(player => player.id !== "player-2") } },
      { ...snapshot, privateThefts, game: { ...snapshot.game, players: snapshot.game!.players.filter(player => player.id !== "player-1") } },
      { ...snapshot, game: { ...snapshot.game, thefts: privateThefts } },
      { ...snapshot, game: { ...snapshot.game, privateThefts } },
      { ...lobby().room.snapshot("connection-1"), privateThefts },
      { ...room.snapshot("outsider"), privateThefts },
    ]) {
      expect(() => parseServerMessage({ type: "snapshot", snapshot: invalid })).toThrow();
    }
  });

  test("requires bounded, strictly ordered monopoly events with exact fields, victim-only ownership, and positive losses", () => {
    const { room } = started();
    const snapshot = room.snapshot("connection-1");
    const monopoly: MonopolyEvent = { id: 1, playerId: "player-3", resource: "ore", losses: { "player-1": 2, "player-2": 3 } };
    for (const privateMonopolies of [[], [monopoly], [monopoly, { ...monopoly, id: 3 }], Array.from({ length: 100 }, (_, index) => ({ ...monopoly, id: index + 1 }))]) {
      expect(() => parseServerMessage({ type: "snapshot", snapshot: { ...snapshot, privateMonopolies } })).not.toThrow();
    }
    const missing = { ...snapshot };
    Reflect.deleteProperty(missing, "privateMonopolies");
    expect(() => parseServerMessage({ type: "snapshot", snapshot: missing })).toThrow();
    for (const privateMonopolies of [
      undefined, null, {}, "monopoly", [null], [{}],
      ...[0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "1"].map(id => [{ ...monopoly, id }]),
      ...[undefined, null, "gold", "desert"].map(resource => [{ ...monopoly, resource }]),
      [{ ...monopoly, playerId: "player-9" }], [{ ...monopoly, playerId: "player-1", losses: { "player-2": 3 } }], [{ ...monopoly, playerId: "player-1" }], [{ ...monopoly, losses: { "player-2": 3 } }],
      [{ ...monopoly, losses: {} }], [{ ...monopoly, losses: { "player-2": 0 } }], [{ ...monopoly, losses: { "player-2": -1 } }],
      [{ ...monopoly, losses: { "player-2": 20 } }], [{ ...monopoly, losses: { "player-2": 1.5 } }],
      [{ ...monopoly, losses: { "player-9": 1 } }], [{ ...monopoly, losses: { "player-3": 1 } }],
      [{ ...monopoly, extra: true }], [{ id: 1, playerId: "player-1", resource: "ore" }],
      [monopoly, monopoly], [{ ...monopoly, id: 2 }, monopoly],
      Array.from({ length: 101 }, (_, index) => ({ ...monopoly, id: index + 1 })),
    ]) {
      expect(() => parseServerMessage({ type: "snapshot", snapshot: { ...snapshot, privateMonopolies } })).toThrow();
    }
    for (const invalid of [
      { ...snapshot, privateMonopolies: [monopoly], privatePlayer: null },
      { ...snapshot, privateMonopolies: [monopoly], playerId: null, privatePlayer: null },
      { ...snapshot, privateMonopolies: [monopoly], game: null },
      { ...snapshot, privateMonopolies: [monopoly], game: { ...snapshot.game, players: snapshot.game!.players.filter(player => player.id !== "player-3") } },
      { ...snapshot, game: { ...snapshot.game, monopolies: [monopoly] } },
      { ...snapshot, game: { ...snapshot.game, privateMonopolies: [monopoly] } },
    ]) {
      expect(() => parseServerMessage({ type: "snapshot", snapshot: invalid })).toThrow();
    }
  });

  test("requires public human/computer control and rejects computer private hands or ownership", () => {
    const { room } = mixedRoom();
    const snapshot = room.snapshot("connection-1");
    expect(() => parseServerMessage({ type: "snapshot", snapshot })).not.toThrow();
    for (const control of [undefined, null, "remote", false]) {
      const invalid = structuredClone(snapshot);
      Object.assign(invalid.players[0]!, { control });
      expect(() => parseServerMessage({ type: "snapshot", snapshot: invalid })).toThrow();
      const invalidGame = structuredClone(snapshot);
      Object.assign(invalidGame.game!.players[0]!, { control });
      expect(() => parseServerMessage({ type: "snapshot", snapshot: invalidGame })).toThrow();
    }
    const computer = room.game!.players.find(player => player.control === "computer")!;
    expect(() => parseServerMessage({ type: "snapshot", snapshot: { ...snapshot, playerId: computer.id, privatePlayer: computer } })).toThrow();
    expect(() => parseServerMessage({ type: "snapshot", snapshot: { ...snapshot, playerId: computer.id, privatePlayer: null } })).toThrow();
    expect(() => parseServerMessage({ type: "snapshot", snapshot: { ...snapshot, privatePlayer: { ...snapshot.privatePlayer, control: "computer" } } })).toThrow();
  });

  test("computer lobby operations and computer actions are not client protocol commands", () => {
    for (const type of ["add-computer", "remove-player", "rename-computer", "computer-action"]) {
      expect(() => parseClientMessage({ type, requestId: "request", version: 0 })).toThrow();
    }
    expect(() => parseClientMessage({ type: "join", secret, name: "Computer 1", control: "computer" })).toThrow();
  });

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

  test("action commands accept one well-formed trade identity and reject forged or malformed ones", () => {
    const decline = { type: "action", requestId: "request", version: 0, action: { type: "respond-trade", accept: false } } as const;
    const trade = { offeredBy: "player-1", give: null, receive: resources({ wood: 1 }) };
    expect(parseClientMessage({ ...decline, trade })).toEqual({ ...decline, trade });
    const offer = { offeredBy: "player-2", give: resources({ brick: 1 }), receive: resources({ wood: 1 }) };
    expect((parseClientMessage({ ...decline, action: { type: "propose-trade", price: resources({ brick: 1 }) }, trade: offer }) as { trade?: TradeIdentity }).trade).toEqual(offer);
    expect(() => parseClientMessage({ ...decline, trade: { ...trade, offeredBy: "player-9" } })).toThrow();
    expect(() => parseClientMessage({ ...decline, trade: { offeredBy: "player-1" } })).toThrow();
    expect(() => parseClientMessage({ ...decline, trade: { ...trade, receive: { wood: 1 } } })).toThrow();
    expect(() => parseClientMessage({ ...decline, trade: { ...trade, give: "wood" } })).toThrow();
    expect(() => parseClientMessage({ ...decline, trade: { ...trade, responses: {} } })).toThrow();
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
    const projection = publicGame(room.game!, snapshot.players, "projection-game");
    expect(() => parseServerMessage({ type: "snapshot", snapshot: { ...snapshot, game: projection } })).not.toThrow();
  });
});

test("host session schedules one computer action, discards stale work, cleans timers on close, and guest lobby methods send nothing", async () => {
  const OriginalPeer = (await import("peerjs")).default;
  const connection = Object.assign(new EventEmitter(), { open: true, send: mock(() => {}), close: mock(() => {}) });
  const peers: EventEmitter[] = [];
  class TestPeer extends EventEmitter {
    open = true;
    destroyed = false;
    disconnected = false;
    constructor() { super(); peers.push(this); }
    connect() { return connection; }
    destroy() { this.destroyed = true; }
  }
  type Timer = ReturnType<typeof setTimeout>;
  const timers = new Map<Timer, { callback: () => void; delay: number }>();
  let timerNumber = 0;
  const schedule = spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay: number) => {
    const timer = ++timerNumber as unknown as Timer;
    timers.set(timer, { callback, delay });
    return timer;
  }) as typeof setTimeout);
  const cancel = spyOn(globalThis, "clearTimeout").mockImplementation(timer => { timers.delete(timer as Timer); });
  const views: SessionView[] = [];
  let host: MultiplayerSession | undefined;
  let guest: MultiplayerSession | undefined;
  mock.module("peerjs", () => ({ default: TestPeer }));
  try {
    const { hostSession, joinSession } = await import("../../src/multiplayer/session");
    host = hostSession(view => views.push(view));
    const initialPreview = views.at(-1)!.snapshot!.previewBoard;
    expect(initialPreview).toBeDefined();
    const initialVersion = views.at(-1)!.snapshot!.version;
    const initialUpdates = views.length;
    host.shuffleBoard();
    expect(views).toHaveLength(initialUpdates + 1);
    expect(views.at(-1)!.snapshot!.version).toBe(initialVersion + 1);
    expect(views.at(-1)!.snapshot!.previewBoard).not.toEqual(initialPreview);
    host.addComputer();
    expect(views.at(-1)!.snapshot!.players).toHaveLength(1);
    host.renameComputer("player-1", "New name");
    expect(views.at(-1)!.snapshot!.players[0]!.name).toBe("New name");
    host.removePlayer("player-1");
    expect(views.at(-1)!.snapshot!.players).toHaveLength(0);
    for (let index = 0; index < 3; index++) host.addComputer();
    const startingBoard = views.at(-1)!.snapshot!.previewBoard!;
    host.setVictoryPointsToWin(7);
    expect(views.at(-1)!.snapshot!.victoryPointsToWin).toBe(7);
    host.startGame();
    expect(views.at(-1)!.snapshot!.game!.victoryPointsToWin).toBe(7);
    expect(views.at(-1)!.snapshot).not.toHaveProperty("previewBoard");
    expect(views.at(-1)!.snapshot!.game!.board).toEqual(startingBoard);
    host.shuffleBoard();
    expect(views.at(-1)!.error?.key).toContain("lobby");
    expect(views.at(-1)!.snapshot!.game!.board).toEqual(startingBoard);
    const version = views.at(-1)!.snapshot!.version;
    const first = [...timers].find(([, timer]) => timer.delay === 450)!;
    expect(first).toBeDefined();
    expect([...timers.values()].filter(timer => timer.delay === 450)).toHaveLength(1);
    expect(views.at(-1)!.snapshot!.game!.phase.type).toBe("setup-settlement");
    timers.delete(first[0]);
    first[1].callback();
    expect(views.at(-1)!.snapshot!.version).toBe(version + 1);
    expect(views.at(-1)!.snapshot!.game!.phase.type).toBe("setup-road");
    const published = views.length;
    first[1].callback();
    expect(views).toHaveLength(published);
    const next = [...timers.values()].find(timer => timer.delay === 450)!;
    const beforeReset = views.at(-1)!.snapshot!;
    host.resetGame();
    const reset = views.at(-1)!.snapshot!;
    expect(reset.version).toBe(beforeReset.version + 1);
    expect(reset.game!.gameId).not.toBe(beforeReset.game!.gameId);
    expect(reset.game!.phase.type).toBe("setup-settlement");
    expect(reset.game!.board).toEqual(startingBoard);
    expect([...timers.values()].filter(timer => timer.delay === 450)).toHaveLength(1);
    const resetUpdates = views.length;
    next.callback();
    expect(views).toHaveLength(resetUpdates);
    const resetTimer = [...timers.values()].find(timer => timer.delay === 450)!;
    host.close();
    const closed = views.length;
    expect(timers.size).toBe(0);
    resetTimer.callback();
    host.addComputer();
    host.removePlayer("player-1");
    host.renameComputer("player-1", "New name");
    host.shuffleBoard();
    expect(views).toHaveLength(closed);
    expect(views.at(-1)!.status).toBe("closed");

    guest = joinSession({ hostId: "host-id", secret }, "Ada", view => views.push(view));
    peers.at(-1)!.emit("open");
    connection.emit("open");
    expect(connection.send).toHaveBeenCalledTimes(1);
    for (const operation of [() => guest!.addComputer(), () => guest!.removePlayer("player-2"), () => guest!.renameComputer("player-2", "New name"), () => guest!.shuffleBoard(), () => guest!.resetGame(), () => guest!.setVictoryPointsToWin(7)]) {
      operation();
      expect(views.at(-1)!.error?.key).toContain("Only the shared host");
      expect(connection.send).toHaveBeenCalledTimes(1);
    }
    const { room } = started();
    connection.emit("data", { type: "snapshot", snapshot: room.snapshot("connection-1") });
    guest.perform({ type: "roll" });
    expect(views.at(-1)!.pending).toBe(true);
    room.resetGame();
    connection.emit("data", { type: "snapshot", snapshot: room.snapshot("connection-1") });
    expect(views.at(-1)).toMatchObject({ status: "connected", pending: false, error: null });
    expect(views.at(-1)!.snapshot!.game!.gameId).toBe(room.snapshot().game!.gameId);
    guest.close();
    expect(timers.size).toBe(0);
  } finally {
    host?.close();
    guest?.close();
    schedule.mockRestore();
    cancel.mockRestore();
    mock.module("peerjs", () => ({ default: OriginalPeer }));
  }
});

test.each([
  ["answer", "Timed out waiting for the host's connection answer"],
  ["direct", "The host answered, but the direct WebRTC connection timed out"],
  ["state", "Connected to the host, but timed out waiting for the initial game state"],
  ["ice-failure", "The direct WebRTC connection failed or was interrupted"],
  ["unavailable", "The target device is unavailable through PeerJS signaling"],
])("connection diagnostics identify %s failures, use STUN without relays, and reset on retry", async (stage, expectedError) => {
  const OriginalPeer = (await import("peerjs")).default;
  class TestConnection extends EventEmitter {
    open = false;
    peerConnection = {
      remoteDescription: null as RTCSessionDescriptionInit | null,
      iceConnectionState: "new" as RTCIceConnectionState,
      iceGatheringState: "complete" as RTCIceGatheringState,
    };
    send = mock(() => {});
    close() { this.open = false; }
  }
  const peers: TestPeer[] = [];
  class TestPeer extends EventEmitter {
    open = true;
    destroyed = false;
    disconnected = false;
    connections: TestConnection[] = [];
    constructor(_identifier: string, readonly options: { config: RTCConfiguration }) { super(); peers.push(this); }
    connect() { const connection = new TestConnection(); this.connections.push(connection); return connection; }
    destroy() { this.destroyed = true; }
  }
  type Timer = ReturnType<typeof setTimeout>;
  const timers = new Map<Timer, { callback: () => void; delay: number }>();
  let timerNumber = 0;
  const schedule = spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay: number) => {
    const timer = ++timerNumber as unknown as Timer;
    timers.set(timer, { callback, delay });
    return timer;
  }) as typeof setTimeout);
  const cancel = spyOn(globalThis, "clearTimeout").mockImplementation(timer => { timers.delete(timer as Timer); });
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: { getItem: () => null } });
  const views: SessionView[] = [];
  let guest: MultiplayerSession | undefined;
  mock.module("peerjs", () => ({ default: TestPeer }));
  try {
    const { hostSession, joinSession } = await import("../../src/multiplayer/session");
    hostSession(() => {}).close();
    guest = joinSession({ hostId: "private-host-identifier", secret }, "Ada", view => views.push(view));
    const peer = peers.at(-1)!;
    peer.emit("open");
    const first = peer.connections[0]!;
    const initialTimeout = [...timers.values()].find(timer => timer.delay === 15000)!;
    if (stage === "direct" || stage === "state" || stage === "ice-failure") {
      first.peerConnection.remoteDescription = { type: "answer", sdp: "private-session-description" };
      first.peerConnection.iceConnectionState = "checking";
    }
    if (stage === "state") {
      first.open = true;
      first.peerConnection.iceConnectionState = "connected";
      first.emit("open");
      expect(first.send).toHaveBeenCalledTimes(1);
    }
    if (stage === "ice-failure") {
      first.peerConnection.iceConnectionState = "failed";
      first.emit("iceStateChanged", "failed");
    } else if (stage === "unavailable") peer.emit("error", { type: "peer-unavailable" });
    else initialTimeout.callback();
    expect(views.at(-1)!.status).toBe("disconnected");
    expect(formatGameMessage("en", views.at(-1)!.error!)).toContain(expectedError!);
    if (stage !== "unavailable") expect(formatGameMessage("en", views.at(-1)!.error!)).toContain(`ICE ${first.peerConnection.iceConnectionState}; gathering complete`);
    for (const privateValue of [secret, "private-host-identifier", "private-session-description"]) expect(JSON.stringify(views.at(-1)!.error)).not.toContain(privateValue);

    const retry = [...timers].find(([, timer]) => timer.delay === 2000)!;
    timers.delete(retry[0]);
    retry[1].callback();
    expect(peer.connections).toHaveLength(2);
    expect(views.at(-1)).toMatchObject({ status: "connecting", error: null });
    const updates = views.length;
    initialTimeout.callback();
    first.emit("close");
    expect(views).toHaveLength(updates);

    peer.connections.at(-1)!.emit("close");
    guest.reconnect();
    expect(peer.connections).toHaveLength(3);
    expect(views.at(-1)).toMatchObject({ status: "connecting", error: null });
    peer.destroyed = true;
    guest.reconnect();
    const recreatedPeer = peers.at(-1)!;
    expect(recreatedPeer).not.toBe(peer);
    recreatedPeer.emit("open");
    for (const createdPeer of peers) expect(createdPeer.options.config.iceServers).toEqual([{ urls: "stun:stun.l.google.com:19302" }]);

    const recovered = recreatedPeer.connections[0]!;
    recovered.open = true;
    recovered.emit("open");
    const room = new HostRoom(secret);
    room.join("connection", { type: "join", name: "Ada", secret });
    recovered.emit("data", { type: "snapshot", snapshot: room.snapshot("connection") });
    expect(views.at(-1)).toMatchObject({ status: "connected", error: null });
    expect(views.at(-1)!.snapshot!.playerId).toBeNull();
    expect(timers.size).toBe(0);
    guest.close();
    expect(timers.size).toBe(0);
  } finally {
    guest?.close();
    schedule.mockRestore();
    cancel.mockRestore();
    if (previousStorage) Object.defineProperty(globalThis, "sessionStorage", previousStorage);
    else Reflect.deleteProperty(globalThis, "sessionStorage");
    mock.module("peerjs", () => ({ default: OriginalPeer }));
  }
});

test("host removal and renaming propagate while terminal clients clear revoked identity and require explicit readmission", async () => {
  const OriginalPeer = (await import("peerjs")).default;
  class TestConnection extends EventEmitter {
    open = true;
    serialization = "binary";
    messages: unknown[] = [];
    send = mock((message: unknown) => { this.messages.push(message); });
    close() { this.open = false; }
  }
  const peers: TestPeer[] = [];
  class TestPeer extends EventEmitter {
    open = true;
    destroyed = false;
    disconnected = false;
    connections: TestConnection[] = [];
    constructor() { super(); peers.push(this); }
    connect() { const connection = new TestConnection(); this.connections.push(connection); return connection; }
    destroy() { this.destroyed = true; }
  }
  type Timer = ReturnType<typeof setTimeout>;
  const timers = new Map<Timer, { callback: () => void; delay: number }>();
  let timerNumber = 0;
  const schedule = spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, delay: number) => {
    const timer = ++timerNumber as unknown as Timer;
    timers.set(timer, { callback, delay });
    return timer;
  }) as typeof setTimeout);
  const cancel = spyOn(globalThis, "clearTimeout").mockImplementation(timer => { timers.delete(timer as Timer); });
  const previousLocation = Object.getOwnPropertyDescriptor(globalThis, "location");
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, "location", { configurable: true, value: { origin: "https://catania.test", pathname: "/" } });
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); },
  } });
  const hostViews: SessionView[] = [];
  const guestViews: SessionView[] = [];
  let host: MultiplayerSession | undefined;
  let guest: MultiplayerSession | undefined;
  const deliver = (from: TestConnection, to: TestConnection) => {
    while (from.messages.length) to.emit("data", from.messages.shift());
  };
  const attachGuest = () => {
    const client = peers[1]!.connections.at(-1)!;
    const server = new TestConnection();
    peers[0]!.emit("connection", server);
    client.emit("open");
    deliver(client, server);
    return { client, server };
  };
  mock.module("peerjs", () => ({ default: TestPeer }));
  try {
    const { hostSession, joinSession } = await import("../../src/multiplayer/session");
    host = hostSession(view => hostViews.push(view));
    peers[0]!.emit("open");
    const invitationParameters = new URLSearchParams(new URL(hostViews.at(-1)!.invitationUrl!).hash.slice(1));
    const invitation = { hostId: invitationParameters.get("host")!, secret: invitationParameters.get("secret")! };
    const credentialKey = `catania:multiplayer:${invitation.hostId}`;
    const nameKey = `catania.multiplayer.name.${invitation.hostId}`;
    storage.set(nameKey, "Ada");
    storage.set("catania:multiplayer:other-room", "unrelated-credential");
    guest = joinSession(invitation, "Ada", view => guestViews.push(view));
    peers[1]!.emit("open");
    const first = attachGuest();
    host.admit(hostViews.at(-1)!.snapshot!.pendingPlayers![0]!.connectionId);
    deliver(first.server, first.client);
    const credential = storage.get(credentialKey)!;
    const originalPlayer = guestViews.at(-1)!.snapshot!.players[0]!;
    expect(guestViews.at(-1)!.snapshot!.playerId).toBe(originalPlayer.id);
    host.shuffleBoard();
    deliver(first.server, first.client);
    expect(hostViews.at(-1)!.snapshot!.previewBoard).toBeDefined();
    expect(guestViews.at(-1)!.snapshot).not.toHaveProperty("previewBoard");
    expect(guestViews.at(-1)!.status).toBe("connected");

    const otherPhone = new TestConnection();
    peers[0]!.emit("connection", otherPhone);
    otherPhone.emit("data", { type: "join", secret: invitation.secret, name: "Grace" });
    host.admit(hostViews.at(-1)!.snapshot!.pendingPlayers![0]!.connectionId);
    host.addComputer();
    host.renameComputer("player-3", " Rover ");
    deliver(first.server, first.client);
    expect(guestViews.at(-1)!.snapshot!.players.find(player => player.id === "player-3")!.name).toBe("Rover");
    const renamed = parseServerMessage(otherPhone.messages.at(-1));
    expect(renamed.type).toBe("snapshot");
    if (renamed.type === "snapshot") expect(renamed.snapshot.players.find(player => player.id === "player-3")!.name).toBe("Rover");

    guest.perform({ type: "roll" });
    expect(guestViews.at(-1)!.pending).toBe(true);
    host.removePlayer(originalPlayer.id);
    expect(first.server.messages.at(-1)).toEqual({ type: "error", terminal: true, error: { key: "The host removed you from the lobby. Use Reconnect to request a new seat." } });
    expect(hostViews.at(-1)!.snapshot!.players.map(player => player.id)).toEqual(["player-2", "player-3"]);
    deliver(first.server, first.client);
    expect(guestViews.at(-1)).toMatchObject({ status: "disconnected", snapshot: null, pending: false });
    expect(guestViews.at(-1)!.error?.key).toContain("host removed you");
    expect(storage.has(credentialKey)).toBe(false);
    expect(storage.get(nameKey)).toBe("Ada");
    expect(storage.get("catania:multiplayer:other-room")).toBe("unrelated-credential");
    expect([...timers.values()].some(timer => timer.delay === 2000)).toBe(false);
    peers[1]!.emit("open");
    expect(peers[1]!.connections).toHaveLength(1);

    guest.reconnect();
    const fresh = attachGuest();
    expect(fresh.client.send.mock.calls[0]![0]).toEqual({ type: "join", secret: invitation.secret, name: "Ada" });
    deliver(fresh.server, fresh.client);
    expect(guestViews.at(-1)!.snapshot!.playerId).toBeNull();
    host.admit(hostViews.at(-1)!.snapshot!.pendingPlayers![0]!.connectionId);
    deliver(fresh.server, fresh.client);
    const freshCredential = storage.get(credentialKey)!;
    expect(freshCredential).not.toBe(credential);
    expect(guestViews.at(-1)!.snapshot!.players.find(player => player.id === originalPlayer.id)).toEqual(originalPlayer);
    first.server.emit("close");
    expect(hostViews.at(-1)!.snapshot!.players.find(player => player.id === originalPlayer.id)!.connected).toBe(true);

    fresh.client.emit("close");
    fresh.server.emit("close");
    host.removePlayer(originalPlayer.id);
    expect(storage.get(credentialKey)).toBe(freshCredential);
    const retry = [...timers].find(([, timer]) => timer.delay === 2000)!;
    timers.delete(retry[0]);
    retry[1].callback();
    const rejected = attachGuest();
    expect(rejected.client.send.mock.calls[0]![0]).toEqual({ type: "join", secret: invitation.secret, name: "Ada", credential: freshCredential });
    expect(rejected.server.messages.at(-1)).toEqual({ type: "error", terminal: true, error: { key: "This reconnect credential is not valid for this room." } });
    expect(hostViews.at(-1)!.snapshot!.pendingPlayers).toEqual([]);
    deliver(rejected.server, rejected.client);
    expect(guestViews.at(-1)).toMatchObject({ status: "disconnected", snapshot: null, pending: false });
    expect(storage.has(credentialKey)).toBe(false);
    expect([...timers.values()].some(timer => timer.delay === 2000)).toBe(false);
    peers[1]!.emit("open");
    expect(peers[1]!.connections).toHaveLength(3);
    guest.reconnect();
    const readmission = attachGuest();
    expect(readmission.client.send.mock.calls[0]![0]).toEqual({ type: "join", secret: invitation.secret, name: "Ada" });
    deliver(readmission.server, readmission.client);
    expect(guestViews.at(-1)!.snapshot!.playerId).toBeNull();
    expect(hostViews.at(-1)!.snapshot!.pendingPlayers!.map(player => player.name)).toEqual(["Ada"]);
    expect(hostViews.at(-1)!.snapshot!.players.find(player => player.id === "player-2")).toMatchObject({ name: "Grace", connected: true });
    expect(otherPhone.messages.some(message => parseServerMessage(message).type === "error")).toBe(false);
    guest.close();
    host.close();
    expect(timers.size).toBe(0);
  } finally {
    guest?.close();
    host?.close();
    schedule.mockRestore();
    cancel.mockRestore();
    if (previousLocation) Object.defineProperty(globalThis, "location", previousLocation);
    else Reflect.deleteProperty(globalThis, "location");
    if (previousStorage) Object.defineProperty(globalThis, "sessionStorage", previousStorage);
    else Reflect.deleteProperty(globalThis, "sessionStorage");
    mock.module("peerjs", () => ({ default: OriginalPeer }));
  }
});

describe("invitation URLs", () => {
  test("parses host and secret from a Catania invitation link", () => {
    const invitation = parseInvitationUrl("https://catania.example/play?multiplayer=1#host=host-id&secret=secret-id");
    expect(invitation).toMatchObject({ hostId: "host-id", secret: "secret-id" });
    expect(invitation!.url.origin).toBe("https://catania.example");
  });

  test("rejects links without multiplayer routing, host, or secret, and non-URL text", () => {
    expect(parseInvitationUrl("https://catania.example/#host=host-id&secret=secret-id")).toBeNull();
    expect(parseInvitationUrl("https://catania.example/?multiplayer=1#host=host-id")).toBeNull();
    expect(parseInvitationUrl("https://catania.example/?multiplayer=1#secret=secret-id")).toBeNull();
    expect(parseInvitationUrl("catania")).toBeNull();
    expect(parseInvitationUrl("")).toBeNull();
  });
});
