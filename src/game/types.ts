import type { GameMessage } from "./messages";

export type Resource = "wood" | "brick" | "wool" | "grain" | "ore";
export const GAME_VARIANTS = ["original", "seafarers", "four-islands", "fog-islands", "foggy-world", "mystery-world", "custom-world"] as const;
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
/** Fog World variants hide the entire map under fog with fixed per-cell discoveries. */
export function isFogWorld(variant: GameVariant | undefined): boolean {
  return variant === "foggy-world" || variant === "mystery-world";
}
export const CUSTOM_MAP_TILES = 42;
export const CUSTOM_LAND_MINIMUM = 8;
export const CUSTOM_MAP_COUNT_FIELDS = ["wood", "brick", "wool", "grain", "ore", "gold", "desert", "sea"] as const;
export type CustomMapCountField = typeof CUSTOM_MAP_COUNT_FIELDS[number];
export type CustomMapConfig = Record<CustomMapCountField, number> & { fog: boolean };
export const DEFAULT_CUSTOM_MAP_CONFIG: CustomMapConfig = {
  wood: 6, brick: 4, wool: 6, grain: 6, ore: 4, gold: 2, desert: 1, sea: 13, fog: false,
};

function customMapCounts(value: unknown): Record<CustomMapCountField, number> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype) return null;
  const candidate = value as Record<string, unknown>;
  if (Object.keys(candidate).length !== CUSTOM_MAP_COUNT_FIELDS.length + 1 || typeof candidate.fog !== "boolean") return null;
  const counts = {} as Record<CustomMapCountField, number>;
  for (const field of CUSTOM_MAP_COUNT_FIELDS) {
    const count = candidate[field];
    if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0 || count > CUSTOM_MAP_TILES) return null;
    counts[field] = count;
  }
  return counts;
}

/** Accepts in-progress Custom World setups whose counts have not filled all 42 hexes yet. */
export function isCustomMapConfigDraft(value: unknown): value is CustomMapConfig {
  const counts = customMapCounts(value);
  return counts !== null &&
    CUSTOM_MAP_COUNT_FIELDS.reduce((total, field) => total + counts[field], 0) <= CUSTOM_MAP_TILES;
}

export function customMapConfigLandCount(config: CustomMapConfig): number {
  return CUSTOM_MAP_COUNT_FIELDS.reduce((total, field) => total + config[field], 0) - config.sea;
}

/** A playable Custom World setup fills exactly 42 hexes with enough land for the starting settlements. */
export function isCustomMapConfig(value: unknown): value is CustomMapConfig {
  const counts = customMapCounts(value);
  if (counts === null) return false;
  const assigned = CUSTOM_MAP_COUNT_FIELDS.reduce((total, field) => total + counts[field], 0);
  return assigned === CUSTOM_MAP_TILES && assigned - counts.sea >= CUSTOM_LAND_MINIMUM;
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
  fogWorld?: boolean;
  fogDiscoveryDeck?: FogDiscovery[];
  fogDiscoveriesByTileId?: Record<string, FogDiscovery>;
};

/** True when the board plays the full-map fog rules (Foggy/Mystery World, or Custom World with fog enabled). */
export function isFogBoard(board: Pick<Board, "variant" | "fogWorld"> | undefined): boolean {
  return board !== undefined && (isFogWorld(board.variant) || board.fogWorld === true);
}

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
