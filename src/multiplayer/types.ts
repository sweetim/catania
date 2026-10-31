import type { GameAction, GamePhase, GameState, Player } from "../game/types";

export type BuildMode = "road" | "settlement" | "city" | null;

export type RoomPlayer = Pick<Player, "id" | "name" | "color"> & {
  connected: boolean;
};

export type PublicPlayer = RoomPlayer & {
  resourceCount: number;
  developmentCount: number;
  knightsPlayed: number;
  longestRoad: number;
  score: number;
};

export type PublicGame = Pick<GameState,
  "board" | "bank" | "activePlayerId" | "turnNumber" | "dice" |
  "robberTileId" | "awards" | "winnerId" | "log" | "trade" | "developmentPlayed"
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
  version: number;
  players: RoomPlayer[];
  pendingPlayers?: { connectionId: string; name: string }[];
  game: PublicGame | null;
  playerId: string | null;
  privatePlayer: Player | null;
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
  error: string;
  pending: boolean;
};

export type MultiplayerSession = {
  startGame: () => void;
  admit: (connectionId: string) => void;
  reject: (connectionId: string) => void;
  perform: (action: GameAction, expectedVersion?: number) => void;
  selectBuild: (piece: BuildMode, expectedVersion?: number) => void;
  reconnect: () => void;
  close: () => void;
};
