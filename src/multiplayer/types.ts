import type { Board, GameAction, GamePhase, GameState, GameVariant, MonopolyEvent, Player, TheftEvent } from "../game/types";
import type { Language } from "../i18n";
import type { GameMessage } from "../game/messages";

export type BuildMode = "road" | "ship" | "move-ship" | "settlement" | "city" | null;

export type RoomPlayer = Pick<Player, "id" | "name" | "color" | "control"> & {
  connected: boolean;
};

export type PublicPlayer = RoomPlayer & {
  resourceCount: number;
  developmentCount: number;
  knightsPlayed: number;
  longestRoad: number;
  score: number;
  scoreBreakdown?: ScoreBreakdown;
};

export type ScoreBreakdown = {
  public: number;
  total: number;
  settlements: number;
  cities: number;
  longestRoad: number;
  largestArmy: number;
  hidden: number;
  islands?: number;
};

export type PublicGame = Pick<GameState,
  "board" | "bank" | "activePlayerId" | "turnNumber" | "dice" |
  "robberTileId" | "pirateTileId" | "variant" | "shipMoved" | "shipsBuiltThisTurn" |
  "awards" | "winnerId" | "log" | "trade" | "developmentPlayed"
> & {
  players: PublicPlayer[];
  phase: Exclude<GamePhase, { type: "robber" }> | {
    type: "robber";
    returnPhase: "roll" | "actions";
  };
  canCancelKnight: boolean;
  developmentRemaining: number;
};

export type RoomSnapshot = {
  variant: GameVariant;
  version: number;
  players: RoomPlayer[];
  pendingPlayers?: { connectionId: string; name: string }[];
  previewBoard?: Board;
  game: PublicGame | null;
  playerId: string | null;
  privatePlayer: Player | null;
  privateThefts: TheftEvent[];
  privateMonopolies: MonopolyEvent[];
  privateScore: number | null;
  buildMode: BuildMode;
  boardTargets: { vertices: string[]; edges: string[]; tiles: string[] };
};

export type Invitation = { hostId: string; secret: string };

export type SessionView = {
  role: "host" | "player";
  status: "connecting" | "connected" | "disconnected" | "closed";
  invitationUrl: string | null;
  snapshot: RoomSnapshot | null;
  error: GameMessage | null;
  pending: boolean;
};

export type MultiplayerSession = {
  setVariant: (variant: GameVariant) => void;
  startGame: () => void;
  endGame: () => void;
  shuffleBoard: () => void;
  admit: (connectionId: string) => void;
  reject: (connectionId: string) => void;
  addComputer: (language?: Language) => void;
  removePlayer: (playerId: string) => void;
  renameComputer: (playerId: string, name: string) => void;
  perform: (action: GameAction, expectedVersion?: number) => void;
  selectBuild: (piece: BuildMode, expectedVersion?: number) => void;
  reconnect: () => void;
  close: () => void;
};
