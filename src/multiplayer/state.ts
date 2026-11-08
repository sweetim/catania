import { match } from "ts-pattern";
import { createBoard, generateMapSeed, normalizeMapSeed, seededRandom } from "../game/board";
import { chooseComputerAction } from "../game/computer";
import {
  applyAction, COSTS, createGame, getLongestRoadLength, getScore, legalCityVertices,
  legalRoadEdges, legalSettlementVertices, legalShipEdges, legalShipDestinations, movableShipEdges, RESOURCES, resourceTotal,
} from "../game/engine";
import { isGameVariant, isSeafarers, type Board, type GameAction, type GameState, type GameVariant } from "../game/types";
import { GameError, gameErrorMessage } from "../game/messages";
import type { GameMessage } from "../game/messages";
import { defaultComputerName, type Language } from "../i18n";
import type { ProfileStats } from "../profile";
import { parseAction, validName } from "./protocol";
import type { Command, CommandResult, JoinMessage } from "./protocol";
import type { BuildMode, PublicGame, RoomPlayer, RoomSnapshot } from "./types";

const PLAYER_COLORS = ["#b85d47", "#477c91", "#c1953d", "#76608c"];
const BOARD_ACTIONS = new Set(["place-settlement", "place-road", "place-ship", "move-ship", "place-city", "move-robber", "move-pirate", "reveal-tile"]);

function requireRoom(condition: unknown, message: GameMessage["key"]): asserts condition {
  if (!condition) throw new GameError(message);
}

function publicBoard(board: Board): PublicGame["board"] {
  const { fogDiscoveryDeck, ...visibleBoard } = board;
  return visibleBoard;
}

export function publicGame(game: GameState, players: RoomPlayer[], gameId: string): PublicGame {
  const phase = match(game.phase)
    .with({ type: "setup-settlement" }, () => ({ type: "setup-settlement" } as const))
    .with({ type: "setup-road" }, phase => ({ type: "setup-road", vertexId: phase.vertexId } as const))
    .with({ type: "reveal" }, () => ({ type: "reveal" } as const))
    .with({ type: "roll" }, () => ({ type: "roll" } as const))
    .with({ type: "actions" }, () => ({ type: "actions" } as const))
    .with({ type: "discard" }, phase => ({ type: "discard", required: { ...phase.required } } as const))
    .with({ type: "gold" }, phase => ({ type: "gold", required: { ...phase.required } } as const))
    .with({ type: "robber" }, phase => ({ type: "robber", returnPhase: phase.returnPhase } as const))
    .with({ type: "steal" }, phase => ({ type: "steal" as const, victimIds: [...phase.victimIds], returnPhase: phase.returnPhase }))
    .with({ type: "road-building" }, phase => ({ type: "road-building", remaining: phase.remaining, returnPhase: phase.returnPhase } as const))
    .with({ type: "finished" }, () => ({ type: "finished" } as const))
    .exhaustive();
  return structuredClone({
    variant: game.variant, gameId, pirateTileId: game.pirateTileId, shipMoved: game.shipMoved, shipsBuiltThisTurn: game.shipsBuiltThisTurn,
    board: publicBoard(game.board), bank: game.bank, activePlayerId: game.activePlayerId,
    turnNumber: game.turnNumber, dice: game.dice, robberTileId: game.robberTileId,
    awards: game.awards, winnerId: game.winnerId, trade: game.trade,
    // Engine logs describe public events, never drawn cards, discarded kinds, or stolen resources.
    log: game.log, developmentPlayed: game.developmentPlayed,
    players: game.players.map(player => {
      const score = getScore(game, player.id);
      return {
        id: player.id, name: player.name, color: player.color, control: player.control,
        connected: players.some(seat => seat.id === player.id && seat.connected),
        resourceCount: resourceTotal(player.resources), developmentCount: player.developmentCards.length,
        knightsPlayed: player.knightsPlayed, longestRoad: getLongestRoadLength(game, player.id),
        score: game.phase.type === "finished" ? score.total : score.public,
        // Publish bonus points, not the host's starting-island bookkeeping.
        ...(game.variant === "seafarers" || game.variant === "four-islands" ? { islands: score.islands } : {}),
        // The game is over: revealed victory points are public and each screen shows the full breakdown.
        ...(game.phase.type === "finished" ? { scoreBreakdown: score } : {}),
      };
    }),
    phase, canCancelKnight: game.phase.type === "robber" && !!game.phase.pendingKnight,
    developmentRemaining: game.developmentDeck.length,
  });
}

type Seat = {
  player: Omit<RoomPlayer, "connected">;
  credential: string | null;
  connectionId: string | null;
  requests: Map<string, CommandResult>;
  profile: ProfileStats | null;
};

export class HostRoom {
  variant: GameVariant = "original";
  version = 0;
  game: GameState | null = null;
  buildMode: BuildMode = null;
  private mapSeed = generateMapSeed();
  private gameId: string | null = null;
  private initialGame: GameState | null = null;
  private readonly seats: Seat[] = [];
  private readonly waiting = new Map<string, string>();
  private previewBoard = createBoard(seededRandom(this.mapSeed));

  constructor(private readonly secret: string) {}

  setVariant(variant: GameVariant): void {
    requireRoom(!this.game, "The game version can only be changed in the lobby.");
    requireRoom(isGameVariant(variant), "Choose a supported game version.");
    if (variant === this.variant) return;
    this.mapSeed = generateMapSeed();
    this.previewBoard = createBoard(seededRandom(this.mapSeed), variant);
    this.variant = variant;
    this.version++;
  }

  shuffleBoard(): void {
    requireRoom(!this.game, "The board can only be shuffled in the lobby.");
    this.mapSeed = generateMapSeed();
    this.previewBoard = createBoard(seededRandom(this.mapSeed), this.variant);
    this.version++;
  }

  /** Rebuilds the preview from a map code so a noted island can be replayed; lobby only. */
  useMapSeed(seed: string): void {
    requireRoom(!this.game, "The board can only be shuffled in the lobby.");
    const normalized = normalizeMapSeed(seed);
    requireRoom(normalized, "Enter a valid 8-character map code.");
    if (normalized === this.mapSeed) return;
    this.mapSeed = normalized;
    this.previewBoard = createBoard(seededRandom(normalized), this.variant);
    this.version++;
  }

  private addSeat(name: string, control: RoomPlayer["control"], connectionId: string | null = null): Seat {
    const index = PLAYER_COLORS.findIndex(color => !this.seats.some(seat => seat.player.color === color));
    const seat: Seat = {
      player: { id: `player-${index + 1}`, name, color: PLAYER_COLORS[index]!, control },
      credential: control === "human" ? crypto.randomUUID() : null, connectionId, requests: new Map(),
      profile: null,
    };
    this.seats.push(seat);
    this.version++;
    return seat;
  }

  addComputer(language: Language = "en"): void {
    requireRoom(!this.game, "Computers can only be added in the lobby.");
    requireRoom(this.seats.length < 4, "The room already has four players.");
    const names = [...this.seats.map(seat => seat.player.name), ...this.waiting.values()];
    let number = 1;
    while (names.some(name => name.toLowerCase() === defaultComputerName(language, number).toLowerCase())) number++;
    this.addSeat(defaultComputerName(language, number), "computer");
  }

  removePlayer(playerId: string): string | null {
    requireRoom(!this.game, "Players can only be removed in the lobby.");
    const index = this.seats.findIndex(seat => seat.player.id === playerId);
    requireRoom(index !== -1, "Choose a player in this lobby to remove.");
    const [seat] = this.seats.splice(index, 1);
    this.version++;
    return seat!.connectionId;
  }

  renameComputer(playerId: string, value: string): void {
    requireRoom(!this.game, "Computers can only be renamed in the lobby.");
    const seat = this.seats.find(seat => seat.player.id === playerId && seat.player.control === "computer");
    requireRoom(seat, "Choose a computer in this lobby to rename.");
    requireRoom(validName(value), "Choose a name with 1 to 20 characters and no control characters.");
    const name = value.trim().normalize("NFC");
    const names = [...this.seats.filter(other => other !== seat).map(other => other.player.name), ...this.waiting.values()];
    requireRoom(!names.some(other => other.toLowerCase() === name.toLowerCase()), "Choose a different name; that name is already in the room.");
    if (name === seat.player.name) return;
    seat.player.name = name;
    this.version++;
  }

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
    const seat = this.addSeat(name, "human", connectionId);
    this.waiting.delete(connectionId);
    return seat.credential!;
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
    requireRoom(this.seats.length >= 3 && this.seats.length <= 4, "Add three or four players before starting.");
    requireRoom(this.seats.every(seat => seat.player.control === "computer" || seat.connectionId), "All admitted human players must be connected before starting.");
    this.game = createGame(this.seats.map(seat => seat.player), undefined, this.previewBoard);
    // Each game gets a stable identity for player-profile recording, and per-game profile stats start fresh.
    this.gameId = crypto.randomUUID();
    for (const seat of this.seats) seat.profile = null;
    // The engine numbers input profiles; preserve lobby identity when removed players leave gaps.
    const playerIds = new Map(this.seats.map((seat, index) => [`player-${index + 1}`, seat.player.id]));
    for (const player of this.game.players) player.id = playerIds.get(player.id)!;
    this.game.activePlayerId = playerIds.get(this.game.activePlayerId)!;
    this.game.setupOrder = this.game.setupOrder.map(playerId => playerIds.get(playerId)!);
    if (this.game.startingIslandIds) {
      this.game.startingIslandIds = Object.fromEntries(Object.entries(this.game.startingIslandIds)
        .map(([playerId, islands]) => [playerIds.get(playerId)!, islands]));
    }
    this.initialGame = structuredClone(this.game);
    this.waiting.clear();
    this.version++;
  }

  resetGame(): void {
    requireRoom(this.game && this.initialGame, "The game has not started.");
    this.game = structuredClone(this.initialGame);
    this.gameId = crypto.randomUUID();
    this.buildMode = null;
    for (const seat of this.seats) seat.profile = null;
    this.version++;
  }

  endGame(): void {
    // Any started game can be abandoned this way: the lobby keeps the same island and seats.
    requireRoom(this.game, "The game has not started.");
    this.game = null;
    this.gameId = null;
    this.initialGame = null;
    this.buildMode = null;
    this.version++;
  }

  /** Stores self-reported profile stats from a phone after that phone's game finished. */
  submitProfile(connectionId: string, stats: ProfileStats): void {
    const seat = this.seats.find(seat => seat.connectionId === connectionId);
    requireRoom(seat, "This connection is not bound to an admitted player.");
    requireRoom(this.game?.phase.type === "finished", "Profile stats are shared only after the game finishes.");
    if (seat.profile?.games === stats.games && seat.profile.wins === stats.wins && seat.profile.totalPoints === stats.totalPoints) return;
    seat.profile = { games: stats.games, wins: stats.wins, totalPoints: stats.totalPoints };
    this.version++;
  }

  /** Connections of connected human seats in a finished game that have not reported profile stats yet. */
  profileRequestConnectionIds(): string[] {
    if (this.game?.phase.type !== "finished") return [];
    return this.seats
      .filter(seat => seat.player.control === "human" && seat.connectionId !== null && seat.profile === null)
      .map(seat => seat.connectionId!);
  }

  selectBuild(piece: BuildMode, connectionId?: string, expectedVersion = this.version): void {
    requireRoom(expectedVersion === this.version, "The game changed. Review the latest state and try again.");
    const game = this.game;
    requireRoom(game, "The game has not started.");
    requireRoom(game.players.find(player => player.id === game.activePlayerId)?.control === "human", "The computer controls its own turn.");
    requireRoom(connectionId === undefined || this.seats.some(seat => seat.connectionId === connectionId && seat.player.id === game.activePlayerId), "Only the active player may choose a build.");
    requireRoom(game.phase.type === "actions" || (isSeafarers(game.variant) && (game.phase.type === "setup-road" || game.phase.type === "road-building") &&
      (piece === "road" || piece === "ship")), "Finish the current phase before choosing a build.");
    requireRoom(piece === null || piece === "road" || piece === "settlement" || piece === "city" ||
      (isSeafarers(game.variant) && (piece === "ship" || piece === "move-ship")), "Choose a valid build.");
    if (piece && piece !== "move-ship" && game.phase.type === "actions") {
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
    requireRoom(game.players.find(player => player.id === game.activePlayerId)?.control === "human", "The computer controls its own turn.");
    requireRoom(BOARD_ACTIONS.has(action.type), "The shared board can only place pieces or move the robber. Use the active player's phone for other actions.");
    const targets = this.targets();
    const authorized = match(action)
      .with({ type: "place-settlement" }, action => (game.phase.type === "setup-settlement" || this.buildMode === "settlement") && targets.vertices.includes(action.vertexId))
      .with({ type: "place-city" }, action => this.buildMode === "city" && targets.vertices.includes(action.vertexId))
      .with({ type: "place-road" }, action => (this.buildMode === null || this.buildMode === "road") &&
        targets.edges.includes(action.edgeId) && legalRoadEdges(game, game.activePlayerId).includes(action.edgeId))
      .with({ type: "place-ship" }, action => (this.buildMode === null || this.buildMode === "ship") &&
        targets.edges.includes(action.edgeId) && legalShipEdges(game, game.activePlayerId).includes(action.edgeId))
      .with({ type: "move-ship" }, action => this.buildMode === "move-ship" &&
        legalShipDestinations(game, game.activePlayerId, action.edgeId).includes(action.destinationEdgeId))
      .with({ type: "move-robber" }, action => targets.tiles.includes(action.tileId))
      .with({ type: "reveal-tile" }, action => game.phase.type === "reveal" && targets.tiles.includes(action.tileId))
      .with({ type: "move-pirate" }, action => action.tileId === null
        ? isSeafarers(game.variant) && game.phase.type === "robber" && game.pirateTileId !== null
        : targets.tiles.includes(action.tileId))
      .otherwise(() => false);
    requireRoom(authorized, "Choose a highlighted board target for the current build or phase.");
    this.game = applyAction(game, game.activePlayerId, action);
    this.buildMode = null;
    this.version++;
  }

  performComputer(expectedVersion = this.version): boolean {
    requireRoom(expectedVersion === this.version, "The game changed. Review the latest state and try again.");
    if (!this.game) return false;
    for (const player of this.game.players) {
      const action = chooseComputerAction(this.game, player.id);
      if (!action) continue;
      this.game = applyAction(this.game, player.id, action);
      this.buildMode = null;
      this.version++;
      return true;
    }
    return false;
  }

  command(connectionId: string, command: Command): CommandResult {
    const result: CommandResult = { type: "result", requestId: command.requestId, error: null };
    const seat = this.seats.find(seat => seat.connectionId === connectionId);
    if (!seat) return { ...result, error: { key: "This connection is not bound to an admitted player." } };
    const previous = seat.requests.get(command.requestId);
    if (previous) return previous;
    try {
      const action = command.type === "action" ? parseAction(command.action) : null;
      // A trade response may race unrelated version bumps (another responder, a computer move);
      // it is accepted whenever it targets the same open trade the player saw.
      const tradeResponse = command.type === "action" && command.trade !== undefined &&
        action !== null && (action.type === "respond-trade" || action.type === "propose-trade");
      const trade = this.game?.trade ?? null;
      const sameTrade = tradeResponse && command.trade !== undefined && trade !== null &&
        trade.offeredBy === command.trade.offeredBy &&
        JSON.stringify(trade.give) === JSON.stringify(command.trade.give) &&
        JSON.stringify(trade.receive) === JSON.stringify(command.trade.receive);
      requireRoom(!tradeResponse ? command.version === this.version : sameTrade,
        "The game changed. Review the latest state and try again.");
      if (command.type === "select-build") this.selectBuild(command.piece, connectionId);
      else {
        requireRoom(!BOARD_ACTIONS.has(action!.type), isSeafarers(this.game?.variant)
          ? "Place pieces and move the robber or pirate on the shared board, not a phone."
          : "Place pieces and move the robber on the shared board, not a phone.");
        requireRoom(this.game, "The game has not started.");
        this.game = applyAction(this.game, seat.player.id, action!);
        this.buildMode = null;
        this.version++;
      }
    } catch (error) {
      result.error = gameErrorMessage(error, "The action could not be applied.");
    }
    seat.requests.set(command.requestId, result);
    if (seat.requests.size > 128) seat.requests.delete(seat.requests.keys().next().value!);
    return result;
  }

  private targets(): RoomSnapshot["boardTargets"] {
    const targets: RoomSnapshot["boardTargets"] = { vertices: [], edges: [], tiles: [] };
    const game = this.game;
    if (!game || game.players.find(player => player.id === game.activePlayerId)?.control === "computer") return targets;
    if (game.phase.type === "setup-settlement" || (game.phase.type === "actions" && this.buildMode === "settlement")) {
      targets.vertices = legalSettlementVertices(game, game.activePlayerId);
    } else if (game.phase.type === "actions" && this.buildMode === "city") {
      targets.vertices = legalCityVertices(game, game.activePlayerId);
    } else if (game.phase.type === "actions" && this.buildMode === "move-ship") {
      targets.edges = movableShipEdges(game, game.activePlayerId).filter(id => legalShipDestinations(game, game.activePlayerId, id).length);
    } else if (game.phase.type === "setup-road" || game.phase.type === "road-building") {
      targets.edges = this.buildMode === "ship" ? legalShipEdges(game, game.activePlayerId)
        : this.buildMode === "road" ? legalRoadEdges(game, game.activePlayerId)
        : [...legalRoadEdges(game, game.activePlayerId), ...legalShipEdges(game, game.activePlayerId)];
    } else if (game.phase.type === "actions" && (this.buildMode === "road" || this.buildMode === "ship")) {
      targets.edges = this.buildMode === "ship" ? legalShipEdges(game, game.activePlayerId) : legalRoadEdges(game, game.activePlayerId);
    } else if (game.phase.type === "robber") {
      targets.tiles = game.board.tiles.filter(tile => tile.terrain !== "fog" && (tile.terrain === "sea"
        ? isSeafarers(game.variant) && tile.id !== game.pirateTileId
        : tile.id !== game.robberTileId)).map(tile => tile.id);
    } else if (game.phase.type === "reveal") {
      targets.tiles = game.board.tiles.filter(tile => tile.terrain === "fog").map(tile => tile.id);
    }
    return targets;
  }

  snapshot(connectionId?: string): RoomSnapshot {
    const seat = this.seats.find(seat => seat.connectionId === connectionId);
    const host = connectionId === undefined;
    const players = this.seats.map(seat => ({ ...seat.player, connected: seat.player.control === "computer" || seat.connectionId !== null }));
    const game = host || seat ? this.game : null;
    const privatePlayer = game?.players.find(player => player.id === seat?.player.id) ?? null;
    return structuredClone({
      version: this.version, players, variant: this.variant,
      ...(host || game?.winnerId ? { mapSeed: this.mapSeed } : {}),
      ...(host ? { profiles: Object.fromEntries(this.seats.filter(seat => seat.profile).map(seat => [seat.player.id, seat.profile!])) } : {}),
      ...(host ? { pendingPlayers: [...this.waiting].map(([connectionId, name]) => ({ connectionId, name })) } : {}),
      ...(host && !this.game ? { previewBoard: publicBoard(this.previewBoard) } : {}),
      game: game ? publicGame(game, players, this.gameId!) : null,
      playerId: seat?.player.id ?? null, privatePlayer,
      privateThefts: game && privatePlayer ? game.thefts.filter(theft => theft.thiefId === privatePlayer.id || theft.victimId === privatePlayer.id) : [],
      privateMonopolies: game && privatePlayer ? game.monopolies.filter(monopoly => (monopoly.losses[privatePlayer.id] ?? 0) > 0) : [],
      privateScore: game && privatePlayer ? getScore(game, privatePlayer.id).total : null,
      buildMode: game ? this.buildMode : null,
      boardTargets: game ? this.targets() : { vertices: [], edges: [], tiles: [] },
    });
  }
}
