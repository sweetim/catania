export type Resource = "wood" | "brick" | "wool" | "grain" | "ore";
export type Resources = Record<Resource, number>;
export type Terrain = Resource | "desert";
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
};
export type Port = { edgeId: string; resource: Resource | "any" };
export type Board = { tiles: Tile[]; vertices: Vertex[]; edges: Edge[]; ports: Port[] };

export type Player = {
  id: string;
  name: string;
  color: string;
  control: "human" | "computer";
  resources: Resources;
  developmentCards: { id: string; kind: DevelopmentKind; purchasedTurn: number }[];
  knightsPlayed: number;
};
export type GamePhase =
  | { type: "setup-settlement" }
  | { type: "setup-road"; vertexId: string }
  | { type: "roll" }
  | { type: "actions" }
  | { type: "discard"; required: Record<string, number> }
  | { type: "robber"; returnPhase: "roll" | "actions" }
  | { type: "steal"; victimIds: string[]; returnPhase: "roll" | "actions" }
  | { type: "road-building"; remaining: number; returnPhase: "roll" | "actions" }
  | { type: "finished" };
export type TradeOffer = {
  offeredBy: string;
  give: Resources | null;
  receive: Resources;
  responses: Record<string, Resources | false>;
};
export type GameState = {
  board: Board;
  players: Player[];
  bank: Resources;
  developmentDeck: DevelopmentKind[];
  activePlayerId: string;
  phase: GamePhase;
  setupIndex: number;
  setupOrder: string[];
  turnNumber: number;
  dice: [number, number] | null;
  robberTileId: string;
  awards: { longestRoad: string | null; largestArmy: string | null };
  winnerId: string | null;
  log: string[];
  trade: TradeOffer | null;
  developmentPlayed: boolean;
};
export type GameAction =
  | { type: "place-settlement"; vertexId: string }
  | { type: "place-city"; vertexId: string }
  | { type: "place-road"; edgeId: string }
  | { type: "roll" }
  | { type: "end-turn" }
  | { type: "discard"; resources: Resources }
  | { type: "move-robber"; tileId: string }
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
