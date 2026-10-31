import { match } from "ts-pattern";
import {
  applyAction, COSTS, createGame, getLongestRoadLength, getScore, legalCityVertices,
  legalRoadEdges, legalSettlementVertices, RESOURCES, resourceTotal,
} from "../game/engine";
import type { GameAction, GameState } from "../game/types";
import { parseAction, validName } from "./protocol";
import type { Command, CommandResult, JoinMessage } from "./protocol";
import type { BuildMode, PublicGame, RoomPlayer, RoomSnapshot } from "./types";

const PLAYER_COLORS = ["#b85d47", "#477c91", "#c1953d", "#76608c"];
const BOARD_ACTIONS = new Set(["place-settlement", "place-road", "place-city", "move-robber"]);

function requireRoom(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function publicGame(game: GameState, players: RoomPlayer[]): PublicGame {
  const phase = match(game.phase)
    .with({ type: "setup-settlement" }, () => ({ type: "setup-settlement" } as const))
    .with({ type: "setup-road" }, phase => ({ type: "setup-road", vertexId: phase.vertexId } as const))
    .with({ type: "roll" }, () => ({ type: "roll" } as const))
    .with({ type: "actions" }, () => ({ type: "actions" } as const))
    .with({ type: "discard" }, phase => ({ type: "discard", required: { ...phase.required } } as const))
    .with({ type: "robber" }, phase => ({ type: "robber", returnPhase: phase.returnPhase } as const))
    .with({ type: "steal" }, phase => ({ type: "steal" as const, victimIds: [...phase.victimIds], returnPhase: phase.returnPhase }))
    .with({ type: "road-building" }, phase => ({ type: "road-building", remaining: phase.remaining, returnPhase: phase.returnPhase } as const))
    .with({ type: "finished" }, () => ({ type: "finished" } as const))
    .exhaustive();
  return structuredClone({
    board: game.board, bank: game.bank, activePlayerId: game.activePlayerId,
    turnNumber: game.turnNumber, dice: game.dice, robberTileId: game.robberTileId,
    awards: game.awards, winnerId: game.winnerId, trade: game.trade,
    // Engine logs describe public events, never drawn cards, discarded kinds, or stolen resources.
    log: game.log, developmentPlayed: game.developmentPlayed,
    players: game.players.map(player => ({
      id: player.id, name: player.name, color: player.color,
      connected: players.some(seat => seat.id === player.id && seat.connected),
      resourceCount: resourceTotal(player.resources), developmentCount: player.developmentCards.length,
      knightsPlayed: player.knightsPlayed, longestRoad: getLongestRoadLength(game, player.id),
      score: game.phase.type === "finished" ? getScore(game, player.id).total : getScore(game, player.id).public,
    })),
    phase, canCancelKnight: game.phase.type === "robber" && !!game.phase.pendingKnight,
    developmentRemaining: game.developmentDeck.length,
  });
}

type Seat = {
  player: Omit<RoomPlayer, "connected">;
  credential: string;
  connectionId: string | null;
  requests: Map<string, CommandResult>;
};

export class HostRoom {
  version = 0;
  game: GameState | null = null;
  buildMode: BuildMode = null;
  private readonly seats: Seat[] = [];
  private readonly waiting = new Map<string, string>();

  constructor(private readonly secret: string) {}

  join(connectionId: string, message: JoinMessage): { credential: string | null; revokedConnectionId: string | null } {
    requireRoom(message.secret === this.secret, "This invitation is not valid for this host.");
    requireRoom(!this.waiting.has(connectionId) && !this.seats.some(seat => seat.connectionId === connectionId), "This connection has already joined.");
    if (message.credential) {
      const seat = this.seats.find(seat => seat.credential === message.credential);
      requireRoom(seat, "This reconnect credential is not valid for this room.");
      const revokedConnectionId = seat.connectionId;
      // Revoke the old connection synchronously, before any further action can be processed.
      seat.connectionId = connectionId;
      this.version++;
      return { credential: seat.credential, revokedConnectionId };
    }
    requireRoom(!this.game, "This game has started. Only admitted players can reconnect.");
    requireRoom(this.seats.length < 4, "The room already has four players.");
    requireRoom(this.waiting.size < 16, "The host has too many pending requests. Try again later.");
    requireRoom(validName(message.name), "Choose a name with 1 to 20 characters and no control characters.");
    const name = message.name.trim().normalize("NFC");
    const names = [...this.seats.map(seat => seat.player.name), ...this.waiting.values()];
    requireRoom(!names.some(other => other.toLowerCase() === name.toLowerCase()), "Choose a different name; that name is already in the room.");
    this.waiting.set(connectionId, name);
    this.version++;
    return { credential: null, revokedConnectionId: null };
  }

  admit(connectionId: string): string {
    requireRoom(!this.game, "Players cannot be admitted after the game starts.");
    requireRoom(this.seats.length < 4, "The room already has four players.");
    const name = this.waiting.get(connectionId);
    requireRoom(name, "That exact join request is no longer connected.");
    const credential = crypto.randomUUID();
    this.seats.push({
      player: { id: `player-${this.seats.length + 1}`, name, color: PLAYER_COLORS[this.seats.length]! },
      credential, connectionId, requests: new Map(),
    });
    this.waiting.delete(connectionId);
    this.version++;
    return credential;
  }

  reject(connectionId: string): void {
    requireRoom(this.waiting.delete(connectionId), "That exact join request is no longer pending.");
    this.version++;
  }

  disconnect(connectionId: string): void {
    const seat = this.seats.find(seat => seat.connectionId === connectionId);
    const waiting = this.waiting.delete(connectionId);
    if (seat) seat.connectionId = null;
    if (seat || waiting) this.version++;
  }

  start(): void {
    requireRoom(!this.game, "The game has already started.");
    requireRoom(this.seats.length >= 3 && this.seats.length <= 4, "Admit three or four human players before starting.");
    requireRoom(this.seats.every(seat => seat.connectionId), "All admitted players must be connected before starting.");
    this.game = createGame(this.seats.map(seat => ({ ...seat.player, control: "human" })));
    this.waiting.clear();
    this.version++;
  }

  selectBuild(piece: BuildMode, connectionId?: string, expectedVersion = this.version): void {
    requireRoom(expectedVersion === this.version, "The game changed. Review the latest state and try again.");
    const game = this.game;
    requireRoom(game, "The game has not started.");
    requireRoom(connectionId === undefined || this.seats.some(seat => seat.connectionId === connectionId && seat.player.id === game.activePlayerId), "Only the active player may choose a build.");
    requireRoom(game.phase.type === "actions", "Finish the current phase before choosing a build.");
    requireRoom(piece === null || piece === "road" || piece === "settlement" || piece === "city", "Choose a valid build.");
    if (piece) {
      const player = game.players.find(player => player.id === game.activePlayerId)!;
      requireRoom(RESOURCES.every(resource => player.resources[resource] >= COSTS[piece][resource]), "Not enough resources for this build.");
    }
    this.buildMode = piece;
    this.version++;
  }

  performBoard(value: GameAction, expectedVersion = this.version): void {
    requireRoom(expectedVersion === this.version, "The game changed. Review the latest state and try again.");
    const action = parseAction(value);
    const game = this.game;
    requireRoom(game, "The game has not started.");
    requireRoom(BOARD_ACTIONS.has(action.type), "The shared board can only place pieces or move the robber. Use the active player's phone for other actions.");
    const targets = this.targets();
    const authorized = match(action)
      .with({ type: "place-settlement" }, action => (game.phase.type === "setup-settlement" || this.buildMode === "settlement") && targets.vertices.includes(action.vertexId))
      .with({ type: "place-city" }, action => this.buildMode === "city" && targets.vertices.includes(action.vertexId))
      .with({ type: "place-road" }, action => targets.edges.includes(action.edgeId))
      .with({ type: "move-robber" }, action => targets.tiles.includes(action.tileId))
      .otherwise(() => false);
    requireRoom(authorized, "Choose a highlighted board target for the current build or phase.");
    this.game = applyAction(game, game.activePlayerId, action);
    this.buildMode = null;
    this.version++;
  }

  command(connectionId: string, command: Command): CommandResult {
    const result: CommandResult = { type: "result", requestId: command.requestId, error: "" };
    const seat = this.seats.find(seat => seat.connectionId === connectionId);
    if (!seat) return { ...result, error: "This connection is not bound to an admitted player." };
    const previous = seat.requests.get(command.requestId);
    if (previous) return previous;
    try {
      requireRoom(command.version === this.version, "The game changed. Review the latest state and try again.");
      if (command.type === "select-build") this.selectBuild(command.piece, connectionId);
      else {
        const action = parseAction(command.action);
        requireRoom(!BOARD_ACTIONS.has(action.type), "Place pieces and move the robber on the shared board, not a phone.");
        requireRoom(this.game, "The game has not started.");
        this.game = applyAction(this.game, seat.player.id, action);
        this.buildMode = null;
        this.version++;
      }
    } catch (error) {
      result.error = error instanceof Error ? error.message : "The action could not be applied.";
    }
    seat.requests.set(command.requestId, result);
    if (seat.requests.size > 128) seat.requests.delete(seat.requests.keys().next().value!);
    return result;
  }

  private targets(): RoomSnapshot["boardTargets"] {
    const targets: RoomSnapshot["boardTargets"] = { vertices: [], edges: [], tiles: [] };
    const game = this.game;
    if (!game) return targets;
    if (game.phase.type === "setup-settlement" || (game.phase.type === "actions" && this.buildMode === "settlement")) {
      targets.vertices = legalSettlementVertices(game, game.activePlayerId);
    } else if (game.phase.type === "actions" && this.buildMode === "city") {
      targets.vertices = legalCityVertices(game, game.activePlayerId);
    } else if (game.phase.type === "setup-road" || game.phase.type === "road-building" || (game.phase.type === "actions" && this.buildMode === "road")) {
      targets.edges = legalRoadEdges(game, game.activePlayerId);
    } else if (game.phase.type === "robber") {
      targets.tiles = game.board.tiles.filter(tile => tile.id !== game.robberTileId).map(tile => tile.id);
    }
    return targets;
  }

  snapshot(connectionId?: string): RoomSnapshot {
    const seat = this.seats.find(seat => seat.connectionId === connectionId);
    const host = connectionId === undefined;
    const players = this.seats.map(seat => ({ ...seat.player, connected: seat.connectionId !== null }));
    const game = host || seat ? this.game : null;
    const privatePlayer = game?.players.find(player => player.id === seat?.player.id) ?? null;
    return structuredClone({
      version: this.version, players,
      ...(host ? { pendingPlayers: [...this.waiting].map(([connectionId, name]) => ({ connectionId, name })) } : {}),
      game: game ? publicGame(game, players) : null,
      playerId: seat?.player.id ?? null, privatePlayer,
      privateScore: game && privatePlayer ? getScore(game, privatePlayer.id).total : null,
      buildMode: game ? this.buildMode : null,
      boardTargets: game ? this.targets() : { vertices: [], edges: [], tiles: [] },
    });
  }
}
