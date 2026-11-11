import type { GameMessage } from "./messages";

export type Resource = "wood" | "brick" | "wool" | "grain" | "ore";
export const GAME_VARIANTS = ["original", "seafarers", "four-islands", "fog-islands", "foggy-world"] as const;
export type GameVariant = typeof GAME_VARIANTS[number];
export function isGameVariant(value: unknown): value is GameVariant {
  return GAME_VARIANTS.some(variant => variant === value);
}
export function isVictoryPointsToWin(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 3 && value <= 13;
}
export function isSeafarers(variant: GameVariant | undefined): boolean {
  return variant !== undefined && variant !== "original";
}
export type Resources = Record<Resource, number>;
export type Terrain = Resource | "desert" | "sea" | "gold" | "fog";
export type DevelopmentKind =
  | "knight"
  | "victory-point"
  | "road-building"
  | "year-of-plenty"
  | "monopoly";

export type Building = { playerId: string; kind: "settlement" | "city" };
export type Tile = {
  id: string;
  x: number;
  y: number;
  terrain: Terrain;
  number: number | null;
  vertexIds: string[];
  islandId?: string;
};
export type Vertex = {
  id: string;
  x: number;
  y: number;
  tileIds: string[];
  edgeIds: string[];
  building: Building | null;
};
export type Edge = {
  id: string;
  vertexIds: [string, string];
  playerId: string | null;
  kind?: "road" | "ship";
};
export type Port = { edgeId: string; resource: Resource | "any"; awaitingCoast?: boolean };
export type FogDiscovery = { terrain: Resource | "sea" | "gold" | "desert"; number: number | null };
export type Board = {
  tiles: Tile[];
  vertices: Vertex[];
  edges: Edge[];
  ports: Port[];
  variant?: GameVariant;
  fogDiscoveryDeck?: FogDiscovery[];
  fogDiscoveriesByTileId?: Record<string, FogDiscovery>;
};

export type Player = {
  id: string;
  name: string;
  color: string;
  control: "human" | "computer";
  resources: Resources;
  developmentCards: { id: string; kind: DevelopmentKind; purchasedTurn: number }[];
  knightsPlayed: number;
};
export type ExplorationResumePhase =
  | { type: "setup-settlement"; tileId?: string }
  | { type: "setup-reveal" }
  | { type: "setup-road"; vertexId: string }
  | { type: "roll" }
  | { type: "actions" }
  | { type: "road-building"; remaining: number; returnPhase: "roll" | "actions" };
export type GamePhase =
  | { type: "setup-settlement"; tileId?: string }
  | { type: "setup-reveal" }
  | { type: "setup-road"; vertexId: string }
  | { type: "roll" }
  | { type: "actions" }
  | { type: "discard"; required: Record<string, number> }
  | { type: "gold"; required: Record<string, number>; resumePhase?: ExplorationResumePhase; resumePlayerId?: string }
  | {
      type: "robber";
      returnPhase: "roll" | "actions";
      pendingKnight?: {
        card: Player["developmentCards"][number];
        cardIndex: number;
        previousLargestArmy: string | null;
      };
    }
  | { type: "steal"; victimIds: string[]; returnPhase: "roll" | "actions" }
  | { type: "road-building"; remaining: number; returnPhase: "roll" | "actions" }
  | { type: "finished" };
export type TradeOffer = {
  offeredBy: string;
  give: Resources | null;
  receive: Resources;
  responses: Record<string, Resources | false>;
  expiresAt?: number;
};
export type TheftEvent = { id: number; thiefId: string; victimId: string; resource: Resource };
export type MonopolyEvent = { id: number; playerId: string; resource: Resource; losses: Record<string, number> };
export type GameState = {
  variant: GameVariant;
  victoryPointsToWin: number;
  board: Board;
  players: Player[];
  bank: Resources;
  developmentDeck: DevelopmentKind[];
  activePlayerId: string;
  phase: GamePhase;
  setupIndex: number;
  setupOrder: string[];
  startingIslandIds?: Record<string, string[]>;
  turnNumber: number;
  dice: [number, number] | null;
  robberTileId: string;
  pirateTileId: string | null;
  shipMoved: boolean;
  shipsBuiltThisTurn: string[];
  awards: { longestRoad: string | null; largestArmy: string | null };
  winnerId: string | null;
  log: GameMessage[];
  thefts: TheftEvent[];
  monopolies: MonopolyEvent[];
  trade: TradeOffer | null;
  computerTradeRequested: boolean;
  developmentPlayed: boolean;
};
export type GameAction =
  | { type: "place-settlement"; vertexId: string }
  | { type: "reveal-tile"; tileId: string }
  | { type: "place-city"; vertexId: string }
  | { type: "place-road"; edgeId: string }
  | { type: "place-ship"; edgeId: string }
  | { type: "move-ship"; edgeId: string; destinationEdgeId: string }
  | { type: "roll" }
  | { type: "end-turn" }
  | { type: "discard"; resources: Resources }
  | { type: "choose-gold"; resources: Resources }
  | { type: "move-robber"; tileId: string }
  | { type: "move-pirate"; tileId: string | null }
  | { type: "cancel-knight" }
  | { type: "steal"; playerId: string }
  | { type: "bank-trade"; give: Resource; receive: Resource }
  | { type: "offer-trade"; give: Resources; receive: Resources }
  | { type: "request-trade"; receive: Resources }
  | { type: "propose-trade"; price: Resources }
  | { type: "respond-trade"; accept: boolean }
  | { type: "complete-trade"; playerId: string }
  | { type: "cancel-trade" }
  | { type: "buy-development" }
  | { type: "play-development"; cardId: string; resource?: Resource; resources?: Resources }
  | { type: "skip-roads" };
