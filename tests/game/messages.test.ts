import { describe, expect, test } from "bun:test";
import { applyAction, createGame, emptyResources, legalSettlementVertices } from "../../src/game/engine";
import { formatGameMessage, GameError, gameErrorMessage, gameMessages, isGameMessage } from "../../src/game/messages";
import type { GameMessage } from "../../src/game/messages";
import type { GameAction, GameState } from "../../src/game/types";
import { parseServerMessage } from "../../src/multiplayer/protocol";
import { HostRoom } from "../../src/multiplayer/state";

function game(): GameState {
  return createGame([
    { name: "Ada", color: "#b85d47", control: "human" },
    { name: "Grace", color: "#477c91", control: "human" },
    { name: "太郎", color: "#c1953d", control: "human" },
  ], () => 0.999999);
}

function rejectedMessage(state: GameState, action: GameAction): GameMessage {
  try { applyAction(state, state.activePlayerId, action); }
  catch (error) {
    expect(error).toBeInstanceOf(GameError);
    return gameErrorMessage(error);
  }
  throw new Error("Expected a rejected game action");
}

describe("localizable runtime messages", () => {
  test("every catalog entry preserves placeholders, validates its schema and renders both languages", () => {
    const samples = {
      player: "Ada", victim: "Grace", other: "太郎", award: "Longest Road", points: 10,
      resource: "wood", give: "brick", receive: "ore", first: 2, second: 3, total: 5,
      count: 4, ratio: 4, kind: "knight", failureType: "network", iceState: "checking", gatheringState: "complete",
    };
    for (const [key, japanese] of Object.entries(gameMessages)) {
      const names = [...key.matchAll(/\{(\w+)\}/g)].map(match => match[1]!);
      expect([...japanese.matchAll(/\{(\w+)\}/g)].map(match => match[1]!).sort()).toEqual([...names].sort());
      const parameters = Object.fromEntries(names.map(name => [name, samples[name as keyof typeof samples]]));
      const message: GameMessage = { key: key as GameMessage["key"], ...(names.length ? { parameters } : {}) };
      expect(isGameMessage(message)).toBe(true);
      expect(formatGameMessage("en", message)).toBe(key.replace(/\{(\w+)\}/g, (_, name: string) => String(parameters[name])));
      expect(formatGameMessage("ja", message)).not.toMatch(/\{\w+\}/);
      expect(formatGameMessage("ja", message)).not.toBe(formatGameMessage("en", message));
    }
  });

  test("the same engine event renders independently for English and Japanese clients without mutation", () => {
    const state = game();
    const next = applyAction(state, state.activePlayerId, {
      type: "place-settlement", vertexId: legalSettlementVertices(state, state.activePlayerId)[0]!,
    });
    const event = next.log.at(-1)!;
    const serialized = JSON.stringify(event);
    const englishClient: GameMessage = JSON.parse(serialized);
    const japaneseClient: GameMessage = JSON.parse(serialized);
    expect(event).toEqual({ key: "{player} builds a settlement.", parameters: { player: "Ada" } });
    expect(formatGameMessage("en", englishClient)).toBe("Ada builds a settlement.");
    expect(formatGameMessage("ja", japaneseClient)).toBe("Adaが開拓地を建設しました。");
    expect(formatGameMessage("ja", englishClient)).toBe(formatGameMessage("ja", japaneseClient));
    expect(formatGameMessage("en", japaneseClient)).toBe(formatGameMessage("en", englishClient));
    expect(JSON.stringify(event)).toBe(serialized);
    expect(englishClient).toEqual(japaneseClient);
    expect(state.log).toHaveLength(1);
  });

  test("resource, award and development parameters localize without translating actual names or interpolating them again", () => {
    const player = "wood {resource} Knight";
    const event: GameMessage = {
      key: "{player} trades {ratio} {give} for one {receive} with the bank.",
      parameters: { player, ratio: 4, give: "wood", receive: "ore" },
    };
    expect(formatGameMessage("en", event)).toBe(`${player} trades 4 wood for one ore with the bank.`);
    expect(formatGameMessage("ja", event)).toBe(`${player}が銀行で木材4枚を鉱石1枚と交換しました。`);
    expect(formatGameMessage("ja", { key: "{player} takes {award}.", parameters: { player: "Longest Road", award: "Largest Army" } }))
      .toBe("Longest Roadが最大騎士力を獲得しました。");
    expect(formatGameMessage("ja", { key: "{player} plays {kind}.", parameters: { player: "knight", kind: "road-building" } }))
      .toBe("knightが街道建設を使用しました。");
    expect(event.parameters).toEqual({ player, ratio: 4, give: "wood", receive: "ore" });
  });

  test("dynamic discard errors retain their English Error.message and render Japanese from structured counts", () => {
    const state = game();
    state.phase = { type: "discard", required: { [state.activePlayerId]: 4 } };
    const action: GameAction = { type: "discard", resources: emptyResources() };
    expect(() => applyAction(state, state.activePlayerId, action)).toThrow("Select exactly 4 resource cards to discard.");
    const message = rejectedMessage(state, action);
    expect(message).toEqual({ key: "Select exactly {count} resource cards to discard.", parameters: { count: 4 } });
    expect(formatGameMessage("ja", message)).toBe("捨てる資源カードをちょうど4枚選んでください。");
  });

  test("dynamic maritime errors localize required resources and bank shortages", () => {
    const state = game();
    state.phase = { type: "actions" };
    const action: GameAction = { type: "bank-trade", give: "wood", receive: "ore" };
    expect(() => applyAction(state, state.activePlayerId, action)).toThrow("You need 4 wood for this trade.");
    const insufficient = rejectedMessage(state, action);
    expect(insufficient).toEqual({ key: "You need {ratio} {resource} for this trade.", parameters: { ratio: 4, resource: "wood" } });
    expect(formatGameMessage("ja", insufficient)).toBe("この交易には木材が4枚必要です。");
    state.players[0]!.resources.wood = 4;
    state.bank.ore = 0;
    expect(() => applyAction(state, state.activePlayerId, action)).toThrow("The bank has no ore available.");
    expect(formatGameMessage("ja", rejectedMessage(state, action))).toBe("銀行に鉱石がありません。");
  });

  test("Year of Plenty errors use the actual number of cards remaining in the bank", () => {
    const state = game();
    state.phase = { type: "actions" };
    state.turnNumber = 2;
    state.bank = { ...emptyResources(), wood: 1 };
    state.players[0]!.developmentCards.push({ id: "development-1", kind: "year-of-plenty", purchasedTurn: 1 });
    const action: GameAction = { type: "play-development", cardId: "development-1", resources: emptyResources() };
    expect(() => applyAction(state, state.activePlayerId, action)).toThrow("Choose exactly 1 available resource cards for Year of Plenty.");
    expect(formatGameMessage("ja", rejectedMessage(state, action))).toBe("収穫で受け取る資源を銀行からちょうど1枚選んでください。");
  });

  test("static errors preserve existing throw assertions and unknown failures use safe localized fallbacks", () => {
    const state = game();
    const message = rejectedMessage(state, { type: "roll" });
    expect(message).toEqual({ key: "You may roll once per turn, after completing any pre-roll card effect." });
    expect(() => { throw new GameError("The game has not started."); }).toThrow("The game has not started.");
    for (const error of [new Error("You need 4 wood for this trade."), new Error("private-credential"), null, "private-credential"]) {
      expect(gameErrorMessage(error)).toEqual({ key: "The operation failed." });
      expect(formatGameMessage("ja", gameErrorMessage(error, "The action could not be applied."))).toBe("操作を適用できませんでした。");
    }
  });
});

describe("structured message protocol", () => {
  test("host failures and activity remain language-neutral across validated snapshots and command results", () => {
    const room = new HostRoom("secret");
    for (const [index, name] of ["Ada", "Grace", "太郎"].entries()) {
      room.join(`connection-${index + 1}`, { type: "join", secret: "secret", name });
      room.admit(`connection-${index + 1}`);
    }
    room.start();
    const snapshot = room.snapshot("connection-1");
    expect(parseServerMessage({ type: "snapshot", snapshot })).toEqual({ type: "snapshot", snapshot });
    const event = snapshot.game!.log[0]!;
    expect(formatGameMessage("ja", event)).toContain("が最初の開拓地を配置します。");
    expect(formatGameMessage("en", event)).toContain(" begins the first settlement placement.");
    const result = room.command("outsider", { type: "action", requestId: "request", version: room.version, action: { type: "roll" } });
    expect(parseServerMessage(result)).toEqual(result);
    expect(formatGameMessage("ja", result.error!)).toBe("この接続は承認済みのプレイヤーに紐づいていません。");
    expect(formatGameMessage("en", result.error!)).toBe("This connection is not bound to an admitted player.");
  });

  test("accepts only explicit null success and structured errors with exact parameter types", () => {
    for (const message of [
      { type: "result", requestId: "request", error: null },
      { type: "result", requestId: "request", error: { key: "You need {ratio} {resource} for this trade.", parameters: { ratio: 4, resource: "wood" } } },
      { type: "error", error: { key: "The game has not started." }, terminal: false },
    ] as const) expect(parseServerMessage(message)).toEqual(message);
    for (const error of [null, "", "The game has not started.", undefined]) {
      expect(() => parseServerMessage({ type: "error", error, terminal: false })).toThrow("invalid network message");
    }
  });

  test("rejects unknown keys, missing or extra fields, wrong enums, unbounded names and invalid numbers in both logs and errors", () => {
    const room = new HostRoom("secret");
    room.join("connection", { type: "join", secret: "secret", name: "Ada" });
    room.admit("connection");
    room.addComputer();
    room.addComputer();
    room.start();
    const snapshot = room.snapshot("connection");
    const invalidMessages: unknown[] = [
      null, [], "Ada builds a road.", {}, { key: "Unknown message." }, { key: "constructor" }, { key: "__proto__" },
      { key: "The game has not started.", unexpected: true },
      { key: "The game has not started.", parameters: { secret: "private" } },
      { key: "The game has not started.", parameters: null },
      { key: "The game has not started.", parameters: [] },
      { key: "{player} builds a road." },
      { key: "{player} builds a road.", parameters: {} },
      { key: "{player} builds a road.", parameters: { player: 1 } },
      { key: "{player} builds a road.", parameters: { player: "" } },
      { key: "{player} builds a road.", parameters: { player: "a".repeat(81) } },
      { key: "{player} builds a road.", parameters: { player: "Ada\n" } },
      { key: "{player} builds a road.", parameters: Object.create({ player: "Ada" }) },
      { key: "{player} builds a road.", parameters: { player: { key: "The game has not started." } } },
      { key: "{player} steals one resource card from {victim}.", parameters: { player: "Ada", victim: "Grace", resource: "ore" } },
      { key: "{player} plays {kind}.", parameters: { player: "Ada", kind: "unknown" } },
      { key: "{award} is unclaimed.", parameters: { award: "constructor" } },
      { key: "The bank has no {resource} available.", parameters: { resource: "gold" } },
      ...[-1, 96, 1.5, NaN, Infinity, "4"].map(count => ({ key: "Select exactly {count} resource cards to discard.", parameters: { count } })),
      { key: "You need {ratio} {resource} for this trade.", parameters: { ratio: 5, resource: "wood" } },
      { key: "{player} rolls {first} + {second} = {total}.", parameters: { player: "Ada", first: 7, second: 1, total: 8 } },
      { key: "{player} wins with {points} points.", parameters: { player: "Ada", points: 31 } },
      { key: "PeerJS connection failed ({failureType}). Check internet access and keep both pages open.", parameters: { failureType: "x".repeat(81) } },
      { key: "Connection to the host was lost. Keep both pages open. Connection details: ICE {iceState}; gathering {gatheringState}. Reconnecting automatically.", parameters: { iceState: "secret", gatheringState: "complete" } },
    ];
    for (const message of invalidMessages) {
      expect(isGameMessage(message)).toBe(false);
      if (message !== null) expect(() => parseServerMessage({ type: "result", requestId: "request", error: message })).toThrow();
      expect(() => parseServerMessage({ type: "error", error: message, terminal: false })).toThrow();
      expect(() => parseServerMessage({ type: "snapshot", snapshot: { ...snapshot, game: { ...snapshot.game, log: [message] } } })).toThrow();
    }
    expect(() => parseServerMessage({ type: "snapshot", snapshot: { ...snapshot, game: { ...snapshot.game, log: Array(101).fill(snapshot.game!.log[0]) } } })).toThrow();
  });
});
