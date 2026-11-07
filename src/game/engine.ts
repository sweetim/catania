import { match } from "ts-pattern";
import { createBoard, edgeTiles, isLand, isResource, pirateStartTileId, randomInteger, secureRandom, shuffle } from "./board";
import { isGameVariant, isSeafarers } from "./types";
import { GameError } from "./messages";
import type { GameMessage } from "./messages";
import type { Board, DevelopmentKind, GameAction, GameState, GameVariant, Player, Resource, Resources } from "./types";

export const RESOURCES: Resource[] = ["wood", "brick", "wool", "grain", "ore"];
export const COMPUTER_TRADE_RESPONSE_MILLISECONDS = 15_000;
export function emptyResources(): Resources {
  return { wood: 0, brick: 0, wool: 0, grain: 0, ore: 0 };
}
export const COSTS: Record<"road" | "ship" | "settlement" | "city" | "development", Resources> = {
  road: { wood: 1, brick: 1, wool: 0, grain: 0, ore: 0 },
  ship: { wood: 1, brick: 0, wool: 1, grain: 0, ore: 0 },
  settlement: { wood: 1, brick: 1, wool: 1, grain: 1, ore: 0 },
  city: { wood: 0, brick: 0, wool: 0, grain: 2, ore: 3 },
  development: { wood: 0, brick: 0, wool: 1, grain: 1, ore: 1 },
};
export function resourceTotal(resources: Resources): number {
  return RESOURCES.reduce((total, resource) => total + resources[resource], 0);
}

function requireRule(condition: unknown, key: GameMessage["key"], parameters?: GameMessage["parameters"]): asserts condition {
  if (!condition) throw new GameError(key, parameters);
}

function validateResources(resources: Resources): void {
  requireRule(resources && typeof resources === "object" && Object.keys(resources).length === RESOURCES.length &&
    RESOURCES.every(resource => Number.isSafeInteger(resources[resource]) && resources[resource] >= 0),
  "Specify a nonnegative whole number for each of the five resources.");
}

function playerFor(state: GameState, playerId: string): Player {
  const player = state.players.find(player => player.id === playerId);
  requireRule(player, "This player is not seated in the game.");
  return player;
}

function canPay(resources: Resources, cost: Resources): boolean {
  return RESOURCES.every(resource => resources[resource] >= cost[resource]);
}

function transfer(from: Resources, to: Resources, resources: Resources): void {
  for (const resource of RESOURCES) {
    from[resource] -= resources[resource];
    to[resource] += resources[resource];
  }
}

function pay(state: GameState, player: Player, cost: Resources): void {
  requireRule(canPay(player.resources, cost), "You do not have the resources required for this purchase.");
  transfer(player.resources, state.bank, cost);
}

export function createGame(profiles: Pick<Player, "name" | "color" | "control">[], random: () => number = secureRandom, selectedBoard?: Board, variant: GameVariant = selectedBoard?.variant ?? "original"): GameState {
  requireRule(isGameVariant(variant), "Choose a supported game version.");
  requireRule(!selectedBoard || (selectedBoard.variant ?? "original") === variant, "The board must match the selected game version.");
  requireRule(profiles.length === 3 || profiles.length === 4, "A standard game needs three or four players.");
  requireRule(profiles.every(profile => profile.name.trim() && profile.color.trim()), "Each player needs a name and color.");
  requireRule(profiles.every(profile => profile.control === "human" || profile.control === "computer"), "Each player needs human or computer control.");
  requireRule(new Set(profiles.map(profile => profile.color)).size === profiles.length, "Choose a different color for each player.");
  const players = shuffle(profiles.map((profile, index): Player => ({
    id: `player-${index + 1}`, name: profile.name.trim(), color: profile.color, control: profile.control,
    resources: emptyResources(), developmentCards: [], knightsPlayed: 0,
  })), random);
  const board = selectedBoard ? structuredClone(selectedBoard) : createBoard(random, variant);
  const developmentDeck = shuffle<DevelopmentKind>([
    ...Array<DevelopmentKind>(14).fill("knight"), ...Array<DevelopmentKind>(5).fill("victory-point"),
    "road-building", "road-building", "year-of-plenty", "year-of-plenty", "monopoly", "monopoly",
  ], random);
  return {
    variant, board, players, bank: { wood: 19, brick: 19, wool: 19, grain: 19, ore: 19 }, developmentDeck,
    activePlayerId: players[0]!.id, phase: { type: "setup-settlement" }, setupIndex: 0,
    setupOrder: [...players.map(player => player.id), ...players.map(player => player.id).reverse()],
    ...(variant === "four-islands" ? { startingIslandIds: Object.fromEntries(players.map(player => [player.id, []])) } : {}),
    turnNumber: 0, dice: null, robberTileId: board.tiles.find(tile => tile.terrain === "desert")?.id ?? "",
    pirateTileId: pirateStartTileId(board, random),
    shipMoved: false, shipsBuiltThisTurn: [],
    awards: { longestRoad: null, largestArmy: null }, winnerId: null,
    log: [{ key: "{player} begins the first settlement placement.", parameters: { player: players[0]!.name } }], thefts: [], monopolies: [], trade: null, computerTradeRequested: false, developmentPlayed: false,
  };
}

type PlacementState = Pick<GameState, "board" | "activePlayerId" | "phase"> & {
  players: Pick<Player, "id">[];
  pirateTileId?: string | null;
};

function pieceCount(state: Pick<GameState, "board">, playerId: string, kind: "road" | "ship" | "settlement" | "city"): number {
  return kind === "road" || kind === "ship"
    ? state.board.edges.filter(edge => edge.playerId === playerId && (edge.kind ?? "road") === kind).length
    : state.board.vertices.filter(vertex => vertex.building?.playerId === playerId && vertex.building.kind === kind).length;
}

export function blockedSettlementVertices(board: Board): string[] {
  return board.vertices.filter(vertex => {
    if (vertex.building) return false;
    const adjacentEdges = board.edges.filter(edge => vertex.edgeIds.includes(edge.id));
    return adjacentEdges.some(edge => edge.vertexIds.some(id => id !== vertex.id &&
      board.vertices.find(neighbor => neighbor.id === id)!.building));
  }).map(vertex => vertex.id);
}

export function legalSettlementVertices(state: PlacementState, playerId: string): string[] {
  if (state.activePlayerId !== playerId || !state.players.some(player => player.id === playerId) ||
    !["setup-settlement", "actions"].includes(state.phase.type) || pieceCount(state, playerId, "settlement") >= 5) return [];
  const blockedVertices = new Set(blockedSettlementVertices(state.board));
  return state.board.vertices.filter(vertex => {
    if (vertex.building || blockedVertices.has(vertex.id)) return false;
    const land = state.board.tiles.filter(tile => vertex.tileIds.includes(tile.id) && isLand(tile.terrain));
    if (isSeafarers(state.board.variant) && (land.length === 0 || (state.phase.type === "setup-settlement" &&
      state.board.variant !== "four-islands" && !land.some(tile => tile.islandId === "main")))) return false;
    const adjacentEdges = state.board.edges.filter(edge => vertex.edgeIds.includes(edge.id));
    return state.phase.type === "setup-settlement" || adjacentEdges.some(edge => edge.playerId === playerId);
  }).map(vertex => vertex.id);
}

export function legalCityVertices(state: PlacementState, playerId: string): string[] {
  if (state.phase.type !== "actions" || state.activePlayerId !== playerId || pieceCount(state, playerId, "city") >= 4) return [];
  return state.board.vertices.filter(vertex => vertex.building?.playerId === playerId && vertex.building.kind === "settlement")
    .map(vertex => vertex.id);
}

export function legalRoadEdges(state: PlacementState, playerId: string): string[] {
  return legalRouteEdges(state, playerId, "road");
}

export function legalShipEdges(state: PlacementState, playerId: string): string[] {
  if (!isSeafarers(state.board.variant)) return [];
  return legalRouteEdges(state, playerId, "ship");
}

function legalRouteEdges(state: PlacementState, playerId: string, kind: "road" | "ship"): string[] {
  if (state.activePlayerId !== playerId || !state.players.some(player => player.id === playerId) ||
    !["setup-road", "actions", "road-building"].includes(state.phase.type) || pieceCount(state, playerId, kind) >= 15) return [];
  return state.board.edges.filter(edge => {
    if (edge.playerId) return false;
    const tiles = edgeTiles(state.board, edge);
    if (kind === "road" ? isSeafarers(state.board.variant) && !tiles.some(tile => isLand(tile.terrain)) :
      !tiles.some(tile => tile.terrain === "sea" || tile.terrain === "fog") || tiles.some(tile => tile.id === state.pirateTileId)) return false;
    if (state.phase.type === "setup-road") return edge.vertexIds.includes(state.phase.vertexId);
    return edge.vertexIds.some(vertexId => {
      const vertex = state.board.vertices.find(vertex => vertex.id === vertexId)!;
      if (vertex.building) return vertex.building.playerId === playerId;
      return state.board.edges.some(road => vertex.edgeIds.includes(road.id) && road.playerId === playerId && (road.kind ?? "road") === kind);
    });
  }).map(edge => edge.id);
}

export function movableShipEdges(state: Pick<GameState, "board" | "activePlayerId" | "phase" | "pirateTileId" | "shipMoved" | "shipsBuiltThisTurn">, playerId: string): string[] {
  if (state.phase.type !== "actions" || state.activePlayerId !== playerId || state.shipMoved) return [];
  return state.board.edges.filter(edge => {
    if (edge.playerId !== playerId || edge.kind !== "ship" || state.shipsBuiltThisTurn.includes(edge.id) ||
      edgeTiles(state.board, edge).some(tile => tile.id === state.pirateTileId)) return false;
    return edge.vertexIds.some(vertexId => {
      const vertex = state.board.vertices.find(vertex => vertex.id === vertexId)!;
      return vertex.building?.playerId !== playerId && !state.board.edges.some(other =>
        other.id !== edge.id && other.kind === "ship" && other.playerId === playerId && other.vertexIds.includes(vertexId));
    });
  }).map(edge => edge.id);
}

export function legalShipDestinations(state: GameState | (PlacementState & Pick<GameState, "shipMoved" | "shipsBuiltThisTurn">), playerId: string, edgeId: string): string[] {
  if (!movableShipEdges({ ...state, pirateTileId: state.pirateTileId ?? null }, playerId).includes(edgeId)) return [];
  const board = { ...state.board, edges: state.board.edges.map(edge => edge.id === edgeId ? { ...edge, playerId: null } : edge) };
  return legalShipEdges({ ...state, board }, playerId).filter(id => id !== edgeId);
}

export function victoryTarget(variant: GameVariant): number {
  return variant === "original" ? 10 : variant === "seafarers" ? 13 : 12;
}

export function getTradeRatio(state: { board: Board; players: Pick<Player, "id">[] }, playerId: string, resource: Resource): number {
  requireRule(state.players.some(player => player.id === playerId), "This player is not seated in the game.");
  requireRule(RESOURCES.includes(resource), "Choose a valid resource to trade.");
  let ratio = 4;
  for (const port of state.board.ports) {
    const edge = state.board.edges.find(edge => edge.id === port.edgeId)!;
    if (!edge.vertexIds.some(id => state.board.vertices.find(vertex => vertex.id === id)!.building?.playerId === playerId)) continue;
    if (port.resource === resource) ratio = 2;
    else if (port.resource === "any") ratio = Math.min(ratio, 3);
  }
  return ratio;
}

export function getLongestRoadLength(state: GameState, playerId: string): number {
  const roads = state.board.edges.filter(edge => edge.playerId === playerId);
  const vertices = new Map(state.board.vertices.map(vertex => [vertex.id, vertex]));
  const adjacent = new Map<string, typeof roads>();
  for (const road of roads) {
    for (const vertexId of road.vertexIds) {
      if (!adjacent.has(vertexId)) adjacent.set(vertexId, []);
      adjacent.get(vertexId)!.push(road);
    }
  }
  const used = new Set<string>();
  function walk(vertexId: string, previousKind?: "road" | "ship"): number {
    const building = vertices.get(vertexId)!.building;
    if (used.size > 0 && building && building.playerId !== playerId) return 0;
    let longest = 0;
    for (const road of adjacent.get(vertexId) ?? []) {
      if (used.has(road.id)) continue;
      const kind = road.kind ?? "road";
      if (previousKind && kind !== previousKind && building?.playerId !== playerId) continue;
      used.add(road.id);
      const next = road.vertexIds[0] === vertexId ? road.vertexIds[1] : road.vertexIds[0];
      longest = Math.max(longest, 1 + walk(next, kind));
      used.delete(road.id);
    }
    return longest;
  }
  // A trail may revisit an intersection (loops), but never a road, or pass an opposing building.
  return Math.max(0, ...Array.from(adjacent.keys(), vertexId => walk(vertexId)));
}

export function getPublicScore(state: GameState, playerId: string): {
  public: number; settlements: number; cities: number; longestRoad: number; largestArmy: number; islands?: number;
} {
  playerFor(state, playerId);
  const settlements = pieceCount(state, playerId, "settlement");
  const cities = pieceCount(state, playerId, "city") * 2;
  const longestRoad = state.awards.longestRoad === playerId ? 2 : 0;
  const largestArmy = state.awards.largestArmy === playerId ? 2 : 0;
  const islands = state.variant === "seafarers" || state.variant === "four-islands"
    ? new Set(state.board.tiles.filter(tile => tile.islandId &&
      (state.variant === "four-islands" ? !state.startingIslandIds?.[playerId]?.includes(tile.islandId) : tile.islandId !== "main") &&
      tile.vertexIds.some(id => state.board.vertices.find(vertex => vertex.id === id)!.building?.playerId === playerId),
    ).map(tile => tile.islandId)).size * 2 : 0;
  const publicPoints = settlements + cities + longestRoad + largestArmy + islands;
  return { public: publicPoints, settlements, cities, longestRoad, largestArmy,
    ...(isSeafarers(state.variant) ? { islands } : {}) };
}

export function getScore(state: GameState, playerId: string): ReturnType<typeof getPublicScore> & { total: number; hidden: number } {
  const score = getPublicScore(state, playerId);
  const hidden = playerFor(state, playerId).developmentCards.filter(card => card.kind === "victory-point").length;
  return { ...score, total: score.public + hidden, hidden };
}

function updateAwards(state: GameState): void {
  for (const award of ["longestRoad", "largestArmy"] as const) {
    const values = state.players.map(player => ({
      id: player.id, value: award === "longestRoad" ? getLongestRoadLength(state, player.id) : player.knightsPlayed,
    }));
    const maximum = Math.max(...values.map(player => player.value));
    const leaders = values.filter(player => player.value === maximum && player.value >= (award === "longestRoad" ? 5 : 3));
    const previous = state.awards[award];
    state.awards[award] = leaders.some(player => player.id === previous) ? previous : leaders.length === 1 ? leaders[0]!.id : null;
    if (state.awards[award] !== previous) {
      const label = award === "longestRoad" ? isSeafarers(state.variant) ? "Longest Route" : "Longest Road" : "Largest Army";
      state.log.push(state.awards[award]
        ? { key: "{player} takes {award}.", parameters: { player: playerFor(state, state.awards[award]!).name, award: label } }
        : { key: "{award} is unclaimed.", parameters: { award: label } });
    }
  }
}

function checkVictory(state: GameState): void {
  if (state.phase.type.startsWith("setup") || (state.phase.type === "gold" && state.phase.resumePhase) || state.winnerId) return;
  if (getScore(state, state.activePlayerId).total >= victoryTarget(state.variant)) {
    state.winnerId = state.activePlayerId;
    state.phase = { type: "finished" };
    state.trade = null;
    state.log.push({ key: "{player} wins with {points} points.", parameters: { player: playerFor(state, state.activePlayerId).name, points: getScore(state, state.activePlayerId).total } });
  }
}

function produce(state: GameState, number: number): Record<string, number> {
  const claims = Object.fromEntries(state.players.map(player => [player.id, emptyResources()]));
  const gold: Record<string, number> = {};
  for (const tile of state.board.tiles) {
    if (tile.id === state.robberTileId || tile.number !== number || (!isResource(tile.terrain) && tile.terrain !== "gold")) continue;
    for (const vertexId of tile.vertexIds) {
      const building = state.board.vertices.find(vertex => vertex.id === vertexId)!.building;
      if (building) {
        const amount = building.kind === "city" ? 2 : 1;
        if (tile.terrain === "gold") gold[building.playerId] = (gold[building.playerId] ?? 0) + amount;
        else claims[building.playerId]![tile.terrain] += amount;
      }
    }
  }
  for (const resource of RESOURCES) {
    const recipients = state.players.filter(player => claims[player.id]![resource] > 0);
    const demand = recipients.reduce((total, player) => total + claims[player.id]![resource], 0);
    if (demand > state.bank[resource] && recipients.length > 1) {
      state.log.push({ key: "The bank cannot supply {resource}; nobody receives that resource this roll.", parameters: { resource } });
      continue;
    }
    if (demand > state.bank[resource]) {
      state.log.push({ key: "The bank has only {count} {resource} left; {player} receives less than earned this roll.", parameters: { count: state.bank[resource], resource, player: recipients[0]!.name } });
    }
    for (const player of recipients) {
      const amount = Math.min(state.bank[resource], claims[player.id]![resource]);
      state.bank[resource] -= amount;
      player.resources[resource] += amount;
    }
  }
  const activeIndex = state.players.findIndex(player => player.id === state.activePlayerId);
  return Object.fromEntries([...state.players.slice(activeIndex), ...state.players.slice(0, activeIndex)]
    .filter(player => gold[player.id]).map(player => [player.id, gold[player.id]!]));
}

function exploreFog(state: GameState, playerId: string, edgeId: string): void {
  if (state.variant !== "fog-islands") return;
  const edge = state.board.edges.find(edge => edge.id === edgeId)!;
  const player = playerFor(state, playerId);
  let gold = 0;
  for (const tile of state.board.tiles) {
    if (tile.terrain !== "fog" || !tile.vertexIds.some(id => edge.vertexIds.includes(id))) continue;
    const discovery = state.board.fogDiscoveryDeck?.shift();
    requireRule(discovery, "The fog discovery deck is empty.");
    tile.terrain = discovery.terrain;
    tile.number = discovery.number;
    if (isResource(tile.terrain) && state.bank[tile.terrain] > 0) {
      state.bank[tile.terrain]--;
      player.resources[tile.terrain]++;
    } else if (tile.terrain === "gold") {
      gold++;
    }
    state.log.push({ key: "{player} explores a fog hex.", parameters: { player: player.name } });
  }
  if (gold > 0 && resourceTotal(state.bank) > 0) {
    const resumePhase = state.phase;
    requireRule(resumePhase.type === "actions" || resumePhase.type === "roll" || resumePhase.type === "road-building" ||
      resumePhase.type === "setup-settlement" || resumePhase.type === "setup-road", "Finish exploration before continuing.");
    state.phase = { type: "gold", required: { [playerId]: gold }, resumePhase, resumePlayerId: state.activePlayerId };
    state.activePlayerId = playerId;
  }
}

export function applyAction(
  original: GameState, playerId: string, action: GameAction, random: () => number = secureRandom, now = Date.now(),
): GameState {
  playerFor(original, playerId);
  requireRule(original.phase.type !== "finished", "The game is finished. Start a new game to play again.");
  requireRule(action && typeof action.type === "string", "Choose a valid game action.");
  if (action.type !== "discard" && action.type !== "choose-gold" && action.type !== "respond-trade" && action.type !== "propose-trade") {
    requireRule(original.activePlayerId === playerId, "Wait for your turn to perform this action.");
  }
  // Every mutation, including multi-step effects and failed random draws, is confined to this copy.
  const state = structuredClone(original);
  const player = playerFor(state, playerId);
  const requireActions = () => requireRule(state.phase.type === "actions", "Roll the dice and finish mandatory choices before this action.");

  match(action)
    .with({ type: "place-settlement" }, action => {
      requireRule(legalSettlementVertices(state, playerId).includes(action.vertexId),
        "Choose an empty legal intersection, at least two edges from other buildings, connected to your road after setup; you have at most five settlements.");
      const setup = state.phase.type === "setup-settlement";
      if (!setup) pay(state, player, COSTS.settlement);
      const vertex = state.board.vertices.find(vertex => vertex.id === action.vertexId)!;
      vertex.building = { playerId, kind: "settlement" };
      if (setup) {
        if (state.variant === "four-islands") {
          state.startingIslandIds ??= {};
          const islands = state.startingIslandIds[playerId] ??= [];
          for (const tile of state.board.tiles) {
            if (vertex.tileIds.includes(tile.id) && tile.islandId && !islands.includes(tile.islandId)) islands.push(tile.islandId);
          }
        }
        if (state.setupIndex >= state.players.length) {
          for (const tileId of vertex.tileIds) {
            const tile = state.board.tiles.find(tile => tile.id === tileId)!;
            if (!isResource(tile.terrain)) continue;
            state.bank[tile.terrain]--;
            player.resources[tile.terrain]++;
          }
        }
        state.phase = { type: "setup-road", vertexId: vertex.id };
      }
      state.log.push({ key: "{player} builds a settlement.", parameters: { player: player.name } });
    })
    .with({ type: "place-city" }, action => {
      requireRule(legalCityVertices(state, playerId).includes(action.vertexId), "Upgrade one of your settlements after rolling; you have at most four cities.");
      pay(state, player, COSTS.city);
      state.board.vertices.find(vertex => vertex.id === action.vertexId)!.building = { playerId, kind: "city" };
      state.log.push({ key: "{player} upgrades a settlement to a city.", parameters: { player: player.name } });
    })
    .with({ type: "place-road" }, { type: "place-ship" }, action => {
      const ship = action.type === "place-ship";
      requireRule((ship ? legalShipEdges(state, playerId) : legalRoadEdges(state, playerId)).includes(action.edgeId), ship
        ? "Choose an empty sea or coastal edge connected to your ships or buildings, away from the pirate; you have at most fifteen ships."
        : "Choose an empty edge connected to your own network without passing an opponent's building; setup roads must touch the new settlement, and you have at most fifteen roads.");
      if (state.phase.type === "actions") pay(state, player, COSTS[ship ? "ship" : "road"]);
      const edge = state.board.edges.find(edge => edge.id === action.edgeId)!;
      edge.playerId = playerId;
      if (ship) {
        edge.kind = "ship";
        state.shipsBuiltThisTurn.push(edge.id);
      } else {
        delete edge.kind;
      }
      state.log.push({ key: ship ? "{player} builds a ship." : "{player} builds a road.", parameters: { player: player.name } });
      if (state.phase.type === "setup-road") {
        state.setupIndex++;
        if (state.setupIndex === state.setupOrder.length) {
          state.activePlayerId = state.players[0]!.id;
          state.phase = { type: "roll" };
          state.turnNumber = 1;
          state.shipsBuiltThisTurn = [];
        } else {
          state.activePlayerId = state.setupOrder[state.setupIndex]!;
          state.phase = { type: "setup-settlement" };
        }
      } else if (state.phase.type === "road-building") {
        state.phase.remaining--;
        if (state.phase.remaining === 0 || (legalRoadEdges(state, playerId).length === 0 && legalShipEdges(state, playerId).length === 0)) {
          state.phase = { type: state.phase.returnPhase };
        }
      }
      exploreFog(state, playerId, edge.id);
    })
    .with({ type: "move-ship" }, action => {
      requireActions();
      requireRule(legalShipDestinations(state, playerId, action.edgeId).includes(action.destinationEdgeId),
        "Move one open-ended ship per turn, not built this turn, to a connected sea edge away from the pirate.");
      const source = state.board.edges.find(edge => edge.id === action.edgeId)!;
      const destination = state.board.edges.find(edge => edge.id === action.destinationEdgeId)!;
      source.playerId = null;
      delete source.kind;
      destination.playerId = playerId;
      destination.kind = "ship";
      state.shipMoved = true;
      state.log.push({ key: "{player} moves a ship.", parameters: { player: player.name } });
      exploreFog(state, playerId, destination.id);
    })
    .with({ type: "roll" }, () => {
      requireRule(state.phase.type === "roll", "You may roll once per turn, after completing any pre-roll card effect.");
      state.dice = [randomInteger(6, random) + 1, randomInteger(6, random) + 1];
      const total = state.dice[0] + state.dice[1];
      state.log.push({ key: "{player} rolls {first} + {second} = {total}.", parameters: { player: player.name, first: state.dice[0], second: state.dice[1], total } });
      if (total === 7) {
        const required = Object.fromEntries(state.players.filter(player => resourceTotal(player.resources) > 7)
          .map(player => [player.id, Math.floor(resourceTotal(player.resources) / 2)]));
        state.phase = Object.keys(required).length > 0 ? { type: "discard", required } : { type: "robber", returnPhase: "actions" };
      } else {
        const required = produce(state, total);
        state.phase = Object.keys(required).length ? { type: "gold", required } : { type: "actions" };
      }
    })
    .with({ type: "choose-gold" }, action => {
      requireRule(state.phase.type === "gold" && Object.keys(state.phase.required)[0] === playerId,
        "Wait for your gold production choice.");
      validateResources(action.resources);
      const count = Math.min(state.phase.required[playerId]!, resourceTotal(state.bank));
      requireRule(resourceTotal(action.resources) === count && canPay(state.bank, action.resources),
        "Choose exactly {count} available resources for gold production.", { count });
      transfer(state.bank, player.resources, action.resources);
      delete state.phase.required[playerId];
      if (Object.keys(state.phase.required).length === 0) {
        const { resumePhase, resumePlayerId } = state.phase;
        state.phase = resumePhase ?? { type: "actions" };
        if (resumePlayerId) state.activePlayerId = resumePlayerId;
      }
      state.log.push({ key: "{player} collects gold production.", parameters: { player: player.name } });
    })
    .with({ type: "discard" }, action => {
      requireRule(state.phase.type === "discard", "There is no discard to resolve.");
      const required = state.phase.required[playerId];
      requireRule(required !== undefined, "You have no remaining discard obligation.");
      validateResources(action.resources);
      requireRule(resourceTotal(action.resources) === required, "Select exactly {count} resource cards to discard.", { count: required });
      requireRule(canPay(player.resources, action.resources), "You cannot discard resources you do not own.");
      transfer(player.resources, state.bank, action.resources);
      delete state.phase.required[playerId];
      state.log.push({ key: "{player} discards {count} resource cards.", parameters: { player: player.name, count: required } });
      if (Object.keys(state.phase.required).length === 0) state.phase = { type: "robber", returnPhase: "actions" };
    })
    .with({ type: "cancel-knight" }, () => {
      requireRule(state.phase.type === "robber" && state.phase.pendingKnight, "There is no Knight to cancel before moving the robber.");
      const { pendingKnight, returnPhase } = state.phase;
      player.developmentCards.splice(pendingKnight.cardIndex, 0, pendingKnight.card);
      player.knightsPlayed--;
      state.developmentPlayed = false;
      // Recomputing a tie alone would let the cancelled Knight retain Largest Army.
      state.awards.largestArmy = pendingKnight.previousLargestArmy;
      state.phase = { type: returnPhase };
      state.log.push({ key: "{player} cancels Knight.", parameters: { player: player.name } });
    })
    .with({ type: "move-robber" }, { type: "move-pirate" }, action => {
      requireRule(state.phase.type === "robber", "Move the robber only after a seven or a Knight card.");
      const pirate = action.type === "move-pirate";
      if (pirate && action.tileId === null) {
        requireRule(isSeafarers(state.variant) && state.pirateTileId !== null, "Move the pirate to a different sea hex.");
        state.pirateTileId = null;
        state.phase = { type: state.phase.returnPhase };
        state.log.push({ key: "{player} moves the pirate.", parameters: { player: player.name } });
        return;
      }
      const tile = state.board.tiles.find(tile => tile.id === action.tileId);
      requireRule(tile && (pirate
        ? isSeafarers(state.variant) && tile.terrain === "sea" && tile.id !== state.pirateTileId
        : isLand(tile.terrain) && tile.id !== state.robberTileId), pirate
          ? "Move the pirate to a different sea hex."
          : "Move the robber to a different land hex, including the desert.");
      if (pirate) state.pirateTileId = tile.id;
      else state.robberTileId = tile.id;
      const victims = pirate
        ? new Set(state.board.edges.filter(edge => edge.kind === "ship" && edge.vertexIds.every(id => tile.vertexIds.includes(id))).map(edge => edge.playerId))
        : new Set(tile.vertexIds.map(id => state.board.vertices.find(vertex => vertex.id === id)!.building?.playerId));
      const victimIds = state.players.filter(other => other.id !== playerId && victims.has(other.id))
        .map(other => other.id);
      state.phase = victimIds.length > 0 ? { type: "steal", victimIds, returnPhase: state.phase.returnPhase } : { type: state.phase.returnPhase };
      state.log.push({ key: pirate ? "{player} moves the pirate." : "{player} moves the robber.", parameters: { player: player.name } });
    })
    .with({ type: "steal" }, action => {
      requireRule(state.phase.type === "steal", "Move the robber before choosing a victim.");
      requireRule(state.phase.victimIds.includes(action.playerId), isSeafarers(state.variant)
        ? "Choose an eligible opponent beside the robber or pirate." : "Choose an opponent with a building adjacent to the robber.");
      const victim = playerFor(state, action.playerId);
      const total = resourceTotal(victim.resources);
      if (total > 0) {
        let selected = randomInteger(total, random);
        for (const resource of RESOURCES) {
          if (selected < victim.resources[resource]) {
            victim.resources[resource]--;
            player.resources[resource]++;
            state.thefts.push({ id: (state.thefts.at(-1)?.id ?? 0) + 1, thiefId: playerId, victimId: victim.id, resource });
            state.thefts = state.thefts.slice(-100);
            break;
          }
          selected -= victim.resources[resource];
        }
      }
      state.phase = { type: state.phase.returnPhase };
      state.log.push({ key: total > 0 ? "{player} steals one resource card from {victim}."
        : "{player} cannot steal a resource from {victim}'s empty hand.", parameters: { player: player.name, victim: victim.name } });
    })
    .with({ type: "bank-trade" }, action => {
      requireActions();
      requireRule(RESOURCES.includes(action.give) && RESOURCES.includes(action.receive) && action.give !== action.receive,
        "Choose two different resource types for a maritime trade.");
      const ratio = getTradeRatio(state, playerId, action.give);
      requireRule(player.resources[action.give] >= ratio, "You need {ratio} {resource} for this trade.", { ratio, resource: action.give });
      requireRule(state.bank[action.receive] > 0, "The bank has no {resource} available.", { resource: action.receive });
      player.resources[action.give] -= ratio;
      state.bank[action.give] += ratio;
      state.bank[action.receive]--;
      player.resources[action.receive]++;
      state.log.push({ key: "{player} trades {ratio} {give} for one {receive} with the bank.", parameters: { player: player.name, ratio, give: action.give, receive: action.receive } });
    })
    .with({ type: "offer-trade" }, action => {
      requireActions();
      validateResources(action.give);
      validateResources(action.receive);
      requireRule(resourceTotal(action.give) > 0 && resourceTotal(action.receive) > 0, "A trade must give and receive resources; gifts are not allowed.");
      requireRule(RESOURCES.every(resource => action.give[resource] === 0 || action.receive[resource] === 0),
        "Do not offer and request the same resource in a trade.");
      requireRule(canPay(player.resources, action.give), "You cannot offer resources you do not own.");
      state.trade = { offeredBy: playerId, give: { ...action.give }, receive: { ...action.receive }, responses: {} };
      state.log.push({ key: "{player} offers a trade.", parameters: { player: player.name } });
    })
    .with({ type: "request-trade" }, action => {
      requireActions();
      validateResources(action.receive);
      requireRule(resourceTotal(action.receive) > 0, "Request at least one resource.");
      state.trade = { offeredBy: playerId, give: null, receive: { ...action.receive }, responses: {} };
      if (player.control === "computer") {
        state.computerTradeRequested = true;
        state.trade.expiresAt = now + COMPUTER_TRADE_RESPONSE_MILLISECONDS;
      }
      state.log.push({ key: "{player} requests resources and invites prices.", parameters: { player: player.name } });
    })
    .with({ type: "propose-trade" }, action => {
      requireActions();
      requireRule(state.trade && state.trade.offeredBy !== playerId && state.trade.give === null,
        "Only other players may propose a price for an open resource request.");
      validateResources(action.price);
      requireRule(resourceTotal(action.price) > 0, "A trade must give and receive resources; gifts are not allowed.");
      requireRule(RESOURCES.every(resource => action.price[resource] === 0 || state.trade!.receive[resource] === 0),
        "Do not offer and request the same resource in a trade.");
      requireRule(canPay(player.resources, state.trade.receive), "You do not have the resources requested in this trade.");
      state.trade.responses[playerId] = { ...action.price };
    })
    .with({ type: "respond-trade" }, action => {
      requireActions();
      requireRule(state.trade && state.trade.offeredBy !== playerId, "Only other players may respond to the active player's trade offer.");
      requireRule(typeof action.accept === "boolean", "Choose accept or decline for this trade.");
      if (action.accept) {
        requireRule(state.trade.give !== null, "Propose a price before confirming this request.");
        requireRule(canPay(player.resources, state.trade.receive), "You do not have the resources requested in this trade.");
        state.trade.responses[playerId] = { ...state.trade.give };
      } else {
        state.trade.responses[playerId] = false;
      }
    })
    .with({ type: "complete-trade" }, action => {
      requireActions();
      requireRule(state.trade && state.trade.offeredBy === playerId, "You have no open trade offer to complete.");
      const price = state.trade.responses[action.playerId];
      requireRule(action.playerId !== playerId && price, "Choose an opponent who accepted this offer or proposed a price.");
      const other = playerFor(state, action.playerId);
      requireRule(canPay(player.resources, price) && canPay(other.resources, state.trade.receive),
        "Both players must still hold the offered resources. Make a new offer.");
      transfer(player.resources, other.resources, price);
      transfer(other.resources, player.resources, state.trade.receive);
      state.log.push({ key: "{player} trades with {other}.", parameters: { player: player.name, other: other.name } });
      state.trade = null;
    })
    .with({ type: "cancel-trade" }, () => {
      requireActions();
      requireRule(state.trade && state.trade.offeredBy === playerId, "You have no open trade offer to cancel.");
      state.trade = null;
      state.log.push({ key: "{player} withdraws the trade offer.", parameters: { player: player.name } });
    })
    .with({ type: "buy-development" }, () => {
      requireActions();
      requireRule(state.developmentDeck.length > 0, "The development-card deck is empty.");
      pay(state, player, COSTS.development);
      const kind = state.developmentDeck.pop()!;
      player.developmentCards.push({ id: `development-${25 - state.developmentDeck.length}`, kind, purchasedTurn: state.turnNumber });
      state.log.push({ key: "{player} buys a development card.", parameters: { player: player.name } });
    })
    .with({ type: "play-development" }, action => {
      requireRule(state.phase.type === "roll" || state.phase.type === "actions", "Finish mandatory choices before playing a development card.");
      const card = player.developmentCards.find(card => card.id === action.cardId);
      requireRule(card, "Choose a development card from your own hand.");
      requireRule(card.kind !== "victory-point", "Victory-point cards count automatically and are revealed only when you win.");
      requireRule(card.purchasedTurn < state.turnNumber, "You cannot play a development card bought this turn.");
      requireRule(!state.developmentPlayed, "You may play only one development card per turn.");
      const returnPhase = state.phase.type;
      match(card.kind)
        .with("knight", () => {
          player.knightsPlayed++;
          state.phase = {
            type: "robber", returnPhase,
            pendingKnight: {
              card, cardIndex: player.developmentCards.indexOf(card), previousLargestArmy: state.awards.largestArmy,
            },
          };
        })
        .with("road-building", () => {
          const remaining = 15 - pieceCount(state, playerId, "road") + (isSeafarers(state.variant) ? 15 - pieceCount(state, playerId, "ship") : 0);
          requireRule(remaining > 0, "You need at least one road piece remaining to play Road Building.");
          state.phase = { type: "road-building", remaining: Math.min(2, remaining), returnPhase };
          if (legalRoadEdges(state, playerId).length === 0 && legalShipEdges(state, playerId).length === 0) state.phase = { type: returnPhase };
        })
        .with("year-of-plenty", () => {
          validateResources(action.resources!);
          const count = Math.min(2, resourceTotal(state.bank));
          requireRule(count > 0, "The bank has no resources available for Year of Plenty.");
          requireRule(resourceTotal(action.resources!) === count, "Choose exactly {count} available resource cards for Year of Plenty.", { count });
          requireRule(canPay(state.bank, action.resources!), "Choose resources that are available in the bank.");
          transfer(state.bank, player.resources, action.resources!);
        })
        .with("monopoly", () => {
          requireRule(action.resource && RESOURCES.includes(action.resource), "Choose the resource to collect with Monopoly.");
          const losses: Record<string, number> = {};
          for (const other of state.players) {
            if (other.id === playerId) continue;
            if (other.resources[action.resource] > 0) losses[other.id] = other.resources[action.resource];
            player.resources[action.resource] += other.resources[action.resource];
            other.resources[action.resource] = 0;
          }
          if (Object.keys(losses).length > 0) {
            state.monopolies.push({ id: (state.monopolies.at(-1)?.id ?? 0) + 1, playerId, resource: action.resource, losses });
            state.monopolies = state.monopolies.slice(-100);
          }
        })
        .exhaustive();
      player.developmentCards = player.developmentCards.filter(other => other.id !== card.id);
      state.developmentPlayed = true;
      state.log.push({ key: "{player} plays {kind}.", parameters: { player: player.name, kind: card.kind } });
    })
    .with({ type: "skip-roads" }, () => {
      requireRule(state.phase.type === "road-building", "There are no free roads to finish placing.");
      requireRule(legalRoadEdges(state, playerId).length === 0 && legalShipEdges(state, playerId).length === 0, "Place the remaining free roads while legal locations and road pieces are available.");
      state.phase = { type: state.phase.returnPhase };
      state.log.push({ key: "{player} finishes Road Building.", parameters: { player: player.name } });
    })
    .with({ type: "end-turn" }, () => {
      requireActions();
      checkVictory(state);
      if (state.winnerId) return;
      const index = state.players.findIndex(player => player.id === playerId);
      state.activePlayerId = state.players[(index + 1) % state.players.length]!.id;
      state.turnNumber++;
      state.computerTradeRequested = false;
      state.developmentPlayed = false;
      state.shipMoved = false;
      state.shipsBuiltThisTurn = [];
      state.dice = null;
      state.phase = { type: "roll" };
      state.log.push({ key: "{player} begins a turn.", parameters: { player: playerFor(state, state.activePlayerId).name } });
    })
    .exhaustive();

  if (!["offer-trade", "request-trade", "propose-trade", "respond-trade", "complete-trade", "cancel-trade"].includes(action.type)) state.trade = null;
  updateAwards(state);
  checkVictory(state);
  state.log = state.log.slice(-100);
  return state;
}
