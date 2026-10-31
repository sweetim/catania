import { RESOURCES } from "../game/engine";
import { GameError, isGameMessage } from "../game/messages";
import type { GameMessage } from "../game/messages";
import type { GameAction } from "../game/types";
import type { BuildMode, RoomSnapshot } from "./types";

export type JoinMessage = { type: "join"; secret: string; name: string; credential?: string };
export type Command = { requestId: string; version: number } & (
  | { type: "action"; action: GameAction }
  | { type: "select-build"; piece: BuildMode }
);
export type CommandResult = { type: "result"; requestId: string; error: GameMessage | null };
export type ServerMessage =
  | { type: "snapshot"; snapshot: RoomSnapshot }
  | { type: "admitted"; credential: string }
  | CommandResult
  | { type: "error"; error: GameMessage; terminal: boolean };

type RecordValue = Record<string, unknown>;
function record(value: unknown): value is RecordValue {
  return !!value && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}
function fields(value: RecordValue, required: string[], optional: string[] = []): boolean {
  return required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
}
function integer(value: unknown, maximum = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}
function token(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(value);
}
export function validName(value: unknown): value is string {
  return typeof value === "string" && value.length <= 80 && [...value.trim().normalize("NFC")].length >= 1 && [...value.trim().normalize("NFC")].length <= 20 && !/\p{C}/u.test(value);
}
function resource(value: unknown): boolean {
  return RESOURCES.includes(value as never);
}
function resources(value: unknown): boolean {
  return record(value) && fields(value, RESOURCES) && RESOURCES.every(resource => integer(value[resource], 19));
}
function identifier(value: unknown, kind: "player" | "vertex" | "edge" | "tile" | "development"): value is string {
  return typeof value === "string" && (kind === "player" ? /^player-[1-4]$/ : new RegExp(`^${kind}-[0-9]{1,2}$`)).test(value);
}
function buildMode(value: unknown): value is BuildMode {
  return value === null || value === "road" || value === "settlement" || value === "city";
}
function messageRecord(value: unknown, maximum: number): RecordValue {
  if (!record(value)) throw new GameError("Invalid network message.");
  let size: number;
  try { size = new TextEncoder().encode(JSON.stringify(value)).byteLength; }
  catch { throw new GameError("Invalid network message."); }
  if (size > maximum) throw new GameError("Network message is too large.");
  return value;
}

export function parseAction(value: unknown): GameAction {
  if (!record(value)) throw new GameError("Invalid game action.");
  let valid = false;
  switch (value.type) {
    case "roll": case "end-turn": case "cancel-knight": case "cancel-trade": case "buy-development": case "skip-roads":
      valid = fields(value, ["type"]); break;
    case "place-settlement": case "place-city":
      valid = fields(value, ["type", "vertexId"]) && identifier(value.vertexId, "vertex"); break;
    case "place-road":
      valid = fields(value, ["type", "edgeId"]) && identifier(value.edgeId, "edge"); break;
    case "move-robber":
      valid = fields(value, ["type", "tileId"]) && identifier(value.tileId, "tile"); break;
    case "steal": case "complete-trade":
      valid = fields(value, ["type", "playerId"]) && identifier(value.playerId, "player"); break;
    case "discard":
      valid = fields(value, ["type", "resources"]) && resources(value.resources); break;
    case "bank-trade":
      valid = fields(value, ["type", "give", "receive"]) && resource(value.give) && resource(value.receive); break;
    case "offer-trade":
      valid = fields(value, ["type", "give", "receive"]) && resources(value.give) && resources(value.receive); break;
    case "request-trade":
      valid = fields(value, ["type", "receive"]) && resources(value.receive); break;
    case "propose-trade":
      valid = fields(value, ["type", "price"]) && resources(value.price); break;
    case "respond-trade":
      valid = fields(value, ["type", "accept"]) && typeof value.accept === "boolean"; break;
    case "play-development":
      valid = fields(value, ["type", "cardId"], ["resource", "resources"]) && identifier(value.cardId, "development") &&
        (!Object.hasOwn(value, "resource") || resource(value.resource)) && (!Object.hasOwn(value, "resources") || resources(value.resources)); break;
  }
  if (!valid) throw new GameError("Invalid game action or unexpected fields.");
  return value as GameAction;
}

export function parseClientMessage(value: unknown): JoinMessage | Command {
  const message = messageRecord(value, 8192);
  if (message.type === "join" && fields(message, ["type", "secret", "name"], ["credential"]) && token(message.secret) && validName(message.name) &&
    (!Object.hasOwn(message, "credential") || token(message.credential))) return message as JoinMessage;
  if (token(message.requestId) && integer(message.version)) {
    if (message.type === "action" && fields(message, ["type", "requestId", "version", "action"])) {
      return { type: "action", requestId: message.requestId, version: message.version, action: parseAction(message.action) };
    }
    if (message.type === "select-build" && fields(message, ["type", "requestId", "version", "piece"]) && buildMode(message.piece)) {
      return { type: "select-build", requestId: message.requestId, version: message.version, piece: message.piece };
    }
  }
  throw new GameError("Invalid network message or unexpected fields.");
}

function array(value: unknown, maximum: number, check: (value: unknown) => boolean): boolean {
  return Array.isArray(value) && value.length <= maximum && value.every(check);
}
function roomPlayer(value: unknown, publicPlayer = false): boolean {
  if (!record(value) || !fields(value, publicPlayer
    ? ["id", "name", "color", "control", "connected", "resourceCount", "developmentCount", "knightsPlayed", "longestRoad", "score"]
    : ["id", "name", "color", "control", "connected"])) return false;
  return identifier(value.id, "player") && validName(value.name) && typeof value.color === "string" && /^#[a-f0-9]{6}$/i.test(value.color) &&
    (value.control === "human" || value.control === "computer") &&
    typeof value.connected === "boolean" && (!publicPlayer || ["resourceCount", "developmentCount", "knightsPlayed", "longestRoad", "score"].every(key => integer(value[key], 95)));
}
function privatePlayer(value: unknown): boolean {
  return record(value) && fields(value, ["id", "name", "color", "control", "resources", "developmentCards", "knightsPlayed"]) &&
    roomPlayer({ id: value.id, name: value.name, color: value.color, control: value.control, connected: true }) && value.control === "human" && resources(value.resources) && integer(value.knightsPlayed, 14) &&
    array(value.developmentCards, 25, card => record(card) && fields(card, ["id", "kind", "purchasedTurn"]) && identifier(card.id, "development") && integer(card.purchasedTurn) &&
      ["knight", "victory-point", "road-building", "year-of-plenty", "monopoly"].includes(card.kind as string));
}
function phase(value: unknown): boolean {
  if (!record(value)) return false;
  switch (value.type) {
    case "setup-settlement": case "roll": case "actions": case "finished": return fields(value, ["type"]);
    case "setup-road": return fields(value, ["type", "vertexId"]) && identifier(value.vertexId, "vertex");
    case "discard": return fields(value, ["type", "required"]) && record(value.required) && Object.entries(value.required).every(([key, count]) => identifier(key, "player") && integer(count, 47));
    case "robber": return fields(value, ["type", "returnPhase"]) && ["roll", "actions"].includes(value.returnPhase as string);
    case "steal": return fields(value, ["type", "victimIds", "returnPhase"]) && array(value.victimIds, 3, value => identifier(value, "player")) && ["roll", "actions"].includes(value.returnPhase as string);
    case "road-building": return fields(value, ["type", "remaining", "returnPhase"]) && integer(value.remaining, 2) && ["roll", "actions"].includes(value.returnPhase as string);
    default: return false;
  }
}
function board(value: unknown): boolean {
  const position = (value: RecordValue) => typeof value.x === "number" && Number.isFinite(value.x) && typeof value.y === "number" && Number.isFinite(value.y);
  return record(value) && fields(value, ["tiles", "vertices", "edges", "ports"]) &&
    array(value.tiles, 19, tile => record(tile) && fields(tile, ["id", "x", "y", "terrain", "number", "vertexIds"]) && identifier(tile.id, "tile") && position(tile) &&
      (resource(tile.terrain) || tile.terrain === "desert") && (tile.number === null || integer(tile.number, 12)) && array(tile.vertexIds, 6, value => identifier(value, "vertex"))) &&
    array(value.vertices, 54, vertex => record(vertex) && fields(vertex, ["id", "x", "y", "tileIds", "edgeIds", "building"]) && identifier(vertex.id, "vertex") && position(vertex) &&
      array(vertex.tileIds, 3, value => identifier(value, "tile")) && array(vertex.edgeIds, 3, value => identifier(value, "edge")) &&
      (vertex.building === null || (record(vertex.building) && fields(vertex.building, ["playerId", "kind"]) && identifier(vertex.building.playerId, "player") && ["settlement", "city"].includes(vertex.building.kind as string)))) &&
    array(value.edges, 72, edge => record(edge) && fields(edge, ["id", "vertexIds", "playerId"]) && identifier(edge.id, "edge") && Array.isArray(edge.vertexIds) && edge.vertexIds.length === 2 &&
      edge.vertexIds.every(value => identifier(value, "vertex")) && (edge.playerId === null || identifier(edge.playerId, "player"))) &&
    array(value.ports, 9, port => record(port) && fields(port, ["edgeId", "resource"]) && identifier(port.edgeId, "edge") && (port.resource === "any" || resource(port.resource)));
}
function publicGame(value: unknown): boolean {
  if (!record(value) || !fields(value, ["board", "bank", "activePlayerId", "turnNumber", "dice", "robberTileId", "awards", "winnerId", "trade", "log", "developmentPlayed", "players", "phase", "canCancelKnight", "developmentRemaining"])) return false;
  const trade = value.trade;
  return board(value.board) && resources(value.bank) && identifier(value.activePlayerId, "player") && integer(value.turnNumber) &&
    (value.dice === null || (Array.isArray(value.dice) && value.dice.length === 2 && value.dice.every(value => integer(value, 6) && value >= 1))) && identifier(value.robberTileId, "tile") &&
    record(value.awards) && fields(value.awards, ["longestRoad", "largestArmy"]) && Object.values(value.awards).every(value => value === null || identifier(value, "player")) &&
    (value.winnerId === null || identifier(value.winnerId, "player")) &&
    (trade === null || (record(trade) && fields(trade, ["offeredBy", "give", "receive", "responses"]) && identifier(trade.offeredBy, "player") &&
      (trade.give === null || resources(trade.give)) && resources(trade.receive) && record(trade.responses) && Object.entries(trade.responses).every(([key, value]) => identifier(key, "player") && (value === false || resources(value))))) &&
    array(value.log, 100, isGameMessage) && typeof value.developmentPlayed === "boolean" &&
    array(value.players, 4, value => roomPlayer(value, true)) && phase(value.phase) && typeof value.canCancelKnight === "boolean" && integer(value.developmentRemaining, 25);
}
function snapshot(value: unknown): value is RoomSnapshot {
  if (!record(value) || !fields(value, ["version", "players", "game", "playerId", "privatePlayer", "privateThefts", "privateScore", "buildMode", "boardTargets"])) return false;
  let previousTheftId = 0;
  return integer(value.version) && array(value.players, 4, value => roomPlayer(value)) && (value.game === null || publicGame(value.game)) &&
    (value.playerId === null || (identifier(value.playerId, "player") && (value.players as RecordValue[]).some(player => player.id === value.playerId && player.control === "human"))) &&
    (value.privatePlayer === null || (privatePlayer(value.privatePlayer) && (value.privatePlayer as RecordValue).id === value.playerId)) &&
    array(value.privateThefts, 100, theft => {
      if (!record(theft) || !fields(theft, ["id", "thiefId", "victimId", "resource"]) || !integer(theft.id) || theft.id <= previousTheftId ||
        !identifier(theft.thiefId, "player") || !identifier(theft.victimId, "player") || theft.thiefId === theft.victimId || !resource(theft.resource) ||
        !record(value.privatePlayer) || !record(value.game)) return false;
      if ((theft.thiefId !== value.privatePlayer.id && theft.victimId !== value.privatePlayer.id) ||
        !(value.game.players as RecordValue[]).some(player => player.id === theft.thiefId) ||
        !(value.game.players as RecordValue[]).some(player => player.id === theft.victimId)) return false;
      previousTheftId = theft.id;
      return true;
    }) &&
    (value.privateScore === null || integer(value.privateScore, 30)) && buildMode(value.buildMode) && record(value.boardTargets) && fields(value.boardTargets, ["vertices", "edges", "tiles"]) &&
    array(value.boardTargets.vertices, 54, value => identifier(value, "vertex")) && array(value.boardTargets.edges, 72, value => identifier(value, "edge")) && array(value.boardTargets.tiles, 19, value => identifier(value, "tile"));
}

export function parseServerMessage(value: unknown): ServerMessage {
  const message = messageRecord(value, 131072);
  if (message.type === "snapshot" && fields(message, ["type", "snapshot"]) && snapshot(message.snapshot)) return message as ServerMessage;
  if (message.type === "admitted" && fields(message, ["type", "credential"]) && token(message.credential)) return message as ServerMessage;
  if (message.type === "result" && fields(message, ["type", "requestId", "error"]) && token(message.requestId) &&
    (message.error === null || isGameMessage(message.error))) return message as ServerMessage;
  if (message.type === "error" && fields(message, ["type", "error", "terminal"]) && isGameMessage(message.error) && typeof message.terminal === "boolean") return message as ServerMessage;
  throw new GameError("The host sent an invalid network message.");
}
