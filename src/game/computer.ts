import { match } from "ts-pattern";
import {
  blockedSettlementVertices, COSTS, emptyResources, getLongestRoadLength, getPublicScore, getScore, getTradeRatio,
  legalCityVertices, legalRoadEdges, legalSettlementVertices, legalShipDestinations, legalShipEdges,
  legalSetupRevealTiles, movableShipEdges, RESOURCES, resourceTotal,
} from "./engine";
import { edgeTiles, isLand, isPortRevealed, isResource } from "./board";
import { isFogBoard, isSeafarers } from "./types";
import type { GameAction, GameState, Resource, Resources, Tile } from "./types";

const PIP_MULTIPLIER_BY_TERRAIN: Record<Resource | "gold", number> = {
  gold: 2.5,
  grain: 1.28,
  ore: 1.25,
  brick: 1.03,
  wood: 1.02,
  wool: 0.94,
};

const TWO_ROADS_COST: Resources = { wood: 2, brick: 2, wool: 0, grain: 0, ore: 0 };

function pipCount(number: number | null): number {
  return number === null ? 0 : 6 - Math.abs(number - 7);
}

export function getController(state: GameState): string {
  return state.phase.type === "discard" || state.phase.type === "gold"
    ? Object.entries(state.phase.required).find(([, count]) => count > 0)?.[0] ?? state.activePlayerId
    : state.activePlayerId;
}

export function chooseComputerAction(state: GameState, playerId: string, now = Date.now()): GameAction | null {
  const foundPlayer = state.players.find(candidate => candidate.id === playerId);
  if (!foundPlayer || foundPlayer.control !== "computer" || state.phase.type === "finished") return null;
  const activePlayer = foundPlayer;
  const responding = state.phase.type === "actions" && state.trade && state.trade.offeredBy !== playerId &&
    !Object.hasOwn(state.trade.responses, playerId);
  const discarding = state.phase.type === "discard" && (state.phase.required[playerId] ?? 0) > 0;
  const choosingGold = state.phase.type === "gold" && getController(state) === playerId;
  if (state.phase.type === "gold" && !choosingGold) return null;
  if (!responding && !discarding && !choosingGold && state.activePlayerId !== playerId) return null;

  const vertices = new Map(state.board.vertices.map(vertex => [vertex.id, vertex]));
  const edges = new Map(state.board.edges.map(edge => [edge.id, edge]));
  const tiles = new Map(state.board.tiles.map(tile => [tile.id, tile]));
  const tradeRatios = Object.fromEntries(
    RESOURCES.map(resource => [resource, getTradeRatio(state, playerId, resource)]),
  ) as Resources;

  const boardProduction = emptyResources();
  for (const tile of state.board.tiles) {
    if (isResource(tile.terrain) && tile.number !== null) {
      boardProduction[tile.terrain] += pipCount(tile.number);
    }
  }
  const totalBoardProduction = resourceTotal(boardProduction);
  const averageBoardProduction = totalBoardProduction / RESOURCES.length;
  const scarcityWeight = Object.fromEntries(RESOURCES.map(resource => [
    resource,
    totalBoardProduction > 0
      ? Math.min(1.12, Math.max(0.93, averageBoardProduction / Math.max(5, boardProduction[resource])))
      : 1,
  ])) as Resources;

  const production = emptyResources();
  const numberProduction = new Map<number, number>();
  let settlementCount = 0;
  let cityCount = 0;
  for (const vertex of state.board.vertices) {
    if (vertex.building?.playerId !== playerId) continue;
    if (vertex.building.kind === "city") cityCount++;
    else settlementCount++;
    const buildingMultiplier = vertex.building.kind === "city" ? 2 : 1;
    for (const tileId of vertex.tileIds) {
      const tile = tiles.get(tileId)!;
      if (tile.number !== null) {
        const yieldValue = pipCount(tile.number) * buildingMultiplier;
        if (isResource(tile.terrain)) production[tile.terrain] += yieldValue;
        if (tile.terrain === "gold") {
          for (const resource of RESOURCES) production[resource] += yieldValue / RESOURCES.length;
        }
        numberProduction.set(tile.number, (numberProduction.get(tile.number) ?? 0) + yieldValue);
      }
    }
  }
  const totalProduction = resourceTotal(production);
  const inSetupPlacement = state.phase.type === "setup-settlement" || state.phase.type === "setup-reveal";

  const revealedPortEdges = new Set(
    state.board.ports.filter(port => isPortRevealed(state.board, port)).map(port => port.edgeId),
  );
  function portValue(vertexId: string): number {
    const localProduction = emptyResources();
    for (const tileId of vertices.get(vertexId)!.tileIds) {
      const tile = tiles.get(tileId)!;
      if (isResource(tile.terrain) && tile.number !== null) {
        localProduction[tile.terrain] += pipCount(tile.number);
      }
    }
    const localTotal = resourceTotal(localProduction);
    return state.board.ports.reduce((bonus, port) => {
      const edge = revealedPortEdges.has(port.edgeId) ? edges.get(port.edgeId) : undefined;
      if (!edge || !edge.vertexIds.includes(vertexId)) return bonus;
      if (port.resource === "any") {
        const alreadyHasGeneralPort = RESOURCES.every(resource => tradeRatios[resource] <= 3);
        if (alreadyHasGeneralPort) return bonus;
        return bonus + (inSetupPlacement ? 0.65 : 1.4 + Math.min(2.2, (totalProduction + localTotal) / 10));
      }
      if (tradeRatios[port.resource] <= 2) return bonus;
      const supply = production[port.resource] + localProduction[port.resource];
      if (inSetupPlacement) return bonus + (supply >= 5 ? Math.min(2.3, supply * 0.3) : supply * 0.16);
      return bonus + (supply >= 4 ? Math.min(5.8, supply * 0.58) : supply * 0.32);
    }, 0);
  }

  const vertexValue = (vertexId: string, balance = true): number => vertices.get(vertexId)!.tileIds.reduce((value, tileId) => {
    const tile = tiles.get(tileId)!;
    if (tile.terrain === "desert" || tile.terrain === "sea" || tile.terrain === "fog" || tile.number === null) return value;
    const baseWeight = PIP_MULTIPLIER_BY_TERRAIN[tile.terrain] * (isResource(tile.terrain) ? scarcityWeight[tile.terrain] : 1);
    const balanceDivisor = inSetupPlacement ? 7 : isResource(tile.terrain) && tradeRatios[tile.terrain] === 2 ? 16 : 6.5;
    const balanceFactor = balance && isResource(tile.terrain)
      ? 1 / (1 + production[tile.terrain] / balanceDivisor)
      : 1;
    const numberDiversityFactor = balance ? 1 / (1 + (numberProduction.get(tile.number) ?? 0) / 16) : 1;
    return value + pipCount(tile.number) * baseWeight * balanceFactor * numberDiversityFactor;
  }, 0) + (balance ? portValue(vertexId) : 0);

  const cityValue = (vertexId: string): number => vertices.get(vertexId)!.tileIds.reduce((value, tileId) => {
    const tile = tiles.get(tileId)!;
    if (tile.terrain === "desert" || tile.terrain === "sea" || tile.terrain === "fog" || tile.number === null) return value;
    const engineWeight = tile.terrain === "gold" ? 2.5
      : tile.terrain === "ore" || tile.terrain === "grain" ? 1.34
      : tradeRatios[tile.terrain] === 2 ? 1.28 : 1;
    return value + pipCount(tile.number) * engineWeight;
  }, 0);

  const islandBonus = (vertexId: string): number =>
    (state.variant === "seafarers" || state.variant === "four-islands") && !inSetupPlacement
      ? new Set(vertices.get(vertexId)!.tileIds.map(id => tiles.get(id)!.islandId).filter(island =>
        island && (state.variant === "four-islands" ? !state.startingIslandIds?.[playerId]?.includes(island) : island !== "main") &&
        !state.board.vertices.some(vertex => vertex.building?.playerId === playerId &&
          vertex.tileIds.some(id => tiles.get(id)!.islandId === island)))).size * 2 : 0;

  const explorationValue = (vertexId: string): number => state.variant === "fog-islands" || isFogBoard(state.board)
    ? vertices.get(vertexId)!.tileIds.filter(id => tiles.get(id)!.terrain === "fog").length * 8 : 0;

  const bestVertex = (locations: string[], balance = true): string | undefined =>
    locations.toSorted((first, second) =>
      ((balance ? vertexValue(second, true) : cityValue(second)) + islandBonus(second) * 10) -
      ((balance ? vertexValue(first, true) : cityValue(first)) + islandBonus(first) * 10))[0];

  const isSecondSetup = state.setupIndex >= state.players.length;
  const blockedVerticesSet = new Set(blockedSettlementVertices(state.board));

  const setupExpansionPotential = (vertexId: string): number => {
    if (state.board.edges.length === 0) return 0;
    const origin = vertices.get(vertexId)!;
    const immediateNeighbors = new Set<string>();
    for (const edgeId of origin.edgeIds) {
      const edge = edges.get(edgeId)!;
      immediateNeighbors.add(edge.vertexIds[0] === vertexId ? edge.vertexIds[1] : edge.vertexIds[0]);
    }
    let bestNearby = 0;
    for (const neighborId of immediateNeighbors) {
      const neighbor = vertices.get(neighborId)!;
      for (const edgeId of neighbor.edgeIds) {
        const edge = edges.get(edgeId)!;
        const candidateId = edge.vertexIds[0] === neighborId ? edge.vertexIds[1] : edge.vertexIds[0];
        if (candidateId === vertexId || immediateNeighbors.has(candidateId)) continue;
        const candidate = vertices.get(candidateId)!;
        if (candidate.building || blockedVerticesSet.has(candidateId)) continue;
        if (isSeafarers(state.variant) && !candidate.tileIds.some(id => isLand(tiles.get(id)!.terrain))) continue;
        bestNearby = Math.max(bestNearby, vertexValue(candidateId));
      }
    }
    return bestNearby * 0.08;
  };

  const coverageValue = (vertexId: string): number => {
    const spot = emptyResources();
    const adjacentResources = new Set<Resource>();
    for (const tileId of vertices.get(vertexId)!.tileIds) {
      const tile = tiles.get(tileId)!;
      if (tile.number === null) continue;
      if (isResource(tile.terrain)) {
        spot[tile.terrain] += pipCount(tile.number);
        adjacentResources.add(tile.terrain);
      }
      if (tile.terrain === "gold") {
        for (const resource of RESOURCES) spot[resource] += pipCount(tile.number) * 0.48;
      }
    }
    const combined = Object.fromEntries(RESOURCES.map(resource => [resource, production[resource] + spot[resource]])) as Resources;
    const total = resourceTotal(combined);
    if (total === 0) return 0;
    const breadth = RESOURCES.reduce((sum, resource) => sum + Math.min(combined[resource], 3), 0);
    const concentration = Math.max(...RESOURCES.map(resource => combined[resource])) / total;
    const concentrationPenalty = Math.max(0, concentration - 0.55) * total * 2;
    const coreResourceBonus = isSecondSetup ? (combined.grain > 0 ? 0.9 : 0) + (combined.ore > 0 ? 0.8 : 0) : 0;
    const synergyBonus = isSecondSetup
      ? Math.min(1.1, Math.min(combined.wood, combined.brick) * 0.22 + Math.min(combined.ore, combined.grain, combined.wool) * 0.28)
      : 0;
    const startingRoadBonus = isSecondSetup && adjacentResources.has("wood") && adjacentResources.has("brick") ? 0.5 : 0;
    return breadth + coreResourceBonus + synergyBonus + startingRoadBonus - concentrationPenalty;
  };

  const bestSetupVertex = (locations: string[]): string | undefined =>
    locations.toSorted((first, second) =>
      (vertexValue(second) + islandBonus(second) * 10 + coverageValue(second) + setupExpansionPotential(second)) -
      (vertexValue(first) + islandBonus(first) * 10 + coverageValue(first) + setupExpansionPotential(first)))[0];

  const planningState: GameState = { ...state, activePlayerId: playerId, phase: { type: "actions" } };
  const publicScores = new Map(state.players.map(other => [other.id, getPublicScore(state, other.id).public]));
  const opponents = state.players.filter(other => other.id !== playerId);
  const highestOpponentScore = Math.max(0, ...opponents.map(other => publicScores.get(other.id)!));
  const highestOpponentKnights = Math.max(0, ...opponents.map(other => other.knightsPlayed));
  const knightsPlayed = activePlayer.knightsPlayed;
  const score = getScore(state, playerId).total;
  const winsWith = (points: number) => score + points >= state.victoryPointsToWin;

  const opponentContestedVertices = new Set<string>();
  for (const edge of state.board.edges) {
    if (edge.playerId && edge.playerId !== playerId) {
      for (const endpointId of edge.vertexIds) {
        opponentContestedVertices.add(endpointId);
        for (const adjacentEdgeId of vertices.get(endpointId)!.edgeIds) {
          const adjacentEdge = edges.get(adjacentEdgeId)!;
          for (const nearbyId of adjacentEdge.vertexIds) opponentContestedVertices.add(nearbyId);
        }
      }
    }
  }

  const deficit = (inventory: Resources, cost: Resources): number =>
    RESOURCES.reduce((total, resource) => total + Math.max(0, cost[resource] - inventory[resource]), 0);

  function maritimeTradeCost(cost: Resources, inventory = activePlayer.resources): number | null {
    const missing = deficit(inventory, cost);
    if (missing === 0) return 0;
    if (!RESOURCES.every(resource => cost[resource] - inventory[resource] <= state.bank[resource])) return null;
    const ratiosByCost = RESOURCES.toSorted((first, second) => tradeRatios[first] - tradeRatios[second]);
    let remainingNeeded = missing;
    let cardsSpent = 0;
    for (const resource of ratiosByCost) {
      const availableTrades = Math.floor(Math.max(0, inventory[resource] - cost[resource]) / tradeRatios[resource]);
      const usedTrades = Math.min(remainingNeeded, availableTrades);
      cardsSpent += usedTrades * tradeRatios[resource];
      remainingNeeded -= usedTrades;
    }
    return remainingNeeded === 0 ? cardsSpent : null;
  }

  const maritimeAffordable = (cost: Resources, inventory = activePlayer.resources): boolean =>
    maritimeTradeCost(cost, inventory) !== null;

  type RouteCandidate = {
    edgeId: string;
    kind: "road" | "ship";
    expansion: boolean;
    value: number;
    points: number;
    defendsLongestRoad: boolean;
    distance: number;
    destinationValue: number;
    destinationIslandBonus: number;
    revealsFog: boolean;
  };

  function edgeRevealsFog(edgeId: string): boolean {
    if (!state.board.fogDiscoveryDeck && !isFogBoard(state.board)) return false;
    const edge = edges.get(edgeId)!;
    return edge.vertexIds.some(vertexId => vertices.get(vertexId)!.tileIds.some(tileId => tiles.get(tileId)!.terrain === "fog"));
  }

  function bestRoad(roadState: GameState, checkLongestRoad = true, allowTwoStepLongestRoad = false): RouteCandidate | null {
    const roads = legalRoadEdges(roadState, playerId);
    const ships = legalShipEdges(roadState, playerId);
    const legal = [...roads, ...ships];
    if (legal.length === 0) return null;
    const roadBoard = roadState.board;
    const roadEdgesById = new Map(roadBoard.edges.map(edge => [edge.id, edge]));
    const blocked = new Set(blockedSettlementVertices(roadBoard));
    const destinationSet = new Set(roadBoard.vertices.filter(vertex => !vertex.building && !blocked.has(vertex.id) &&
      (!isSeafarers(state.variant) || vertex.tileIds.some(id => isLand(tiles.get(id)!.terrain)) || explorationValue(vertex.id) > 0))
      .map(vertex => vertex.id));

    type Path = { vertexId: string; kind: "road" | "ship"; distance: number; firstEdge: string; firstKind: "road" | "ship" };
    const distances = new Map<string, Path>();
    const pending = new Set<string>();
    for (const kind of ["road", "ship"] as const) {
      for (const edgeId of kind === "road" ? roads : ships) {
        for (const vertexId of roadEdgesById.get(edgeId)!.vertexIds) {
          const key = `${vertexId}:${kind}`;
          if (!distances.has(key)) {
            distances.set(key, { vertexId, kind, distance: 1, firstEdge: edgeId, firstKind: kind });
            pending.add(key);
          }
        }
      }
    }
    while (pending.size > 0) {
      const key = [...pending].sort((first, second) => distances.get(first)!.distance - distances.get(second)!.distance)[0]!;
      pending.delete(key);
      const path = distances.get(key)!;
      const vertex = vertices.get(path.vertexId)!;
      if (vertex.building && vertex.building.playerId !== playerId) continue;
      for (const edgeId of vertex.edgeIds) {
        const edge = roadEdgesById.get(edgeId)!;
        if (edge.playerId && edge.playerId !== playerId) continue;
        for (const kind of ["road", "ship"] as const) {
          if (kind !== path.kind && vertex.building?.playerId !== playerId) continue;
          if (edge.playerId ? (edge.kind ?? "road") !== kind : kind === "road"
            ? isSeafarers(state.variant) && !edgeTiles(roadBoard, edge).some(tile => isLand(tile.terrain))
            : !isSeafarers(state.variant) || !edgeTiles(roadBoard, edge).some(tile => tile.terrain === "sea" || tile.terrain === "fog") ||
              edgeTiles(roadBoard, edge).some(tile => tile.id === state.pirateTileId)) continue;
          const next = edge.vertexIds.find(id => id !== path.vertexId)!;
          const nextKey = `${next}:${kind}`;
          const distance = path.distance + (edge.playerId ? 0 : 1);
          if (distance > 15 || distance >= (distances.get(nextKey)?.distance ?? Infinity)) continue;
          distances.set(nextKey, { ...path, vertexId: next, kind, distance });
          pending.add(nextKey);
        }
      }
    }

    const rawSiteValue = (vertexId: string) =>
      vertexValue(vertexId) + islandBonus(vertexId) * 12 + explorationValue(vertexId);
    const pathValue = (path: Path) => {
      const site = rawSiteValue(path.vertexId);
      const contestedBonus = opponentContestedVertices.has(path.vertexId) && path.distance <= 3 ? 1.18 : 1;
      const fogBonus = edgeRevealsFog(path.firstEdge) ? 3.8 : 0;
      return (site * contestedBonus + fogBonus) / (path.distance + 1);
    };
    const reachable = [...distances.values()].filter(path => destinationSet.has(path.vertexId))
      .toSorted((first, second) => pathValue(second) - pathValue(first));
    const destination = reachable[0];
    const edgeId = destination?.firstEdge ?? legal.toSorted((first, second) =>
      (Number(edgeRevealsFog(second)) - Number(edgeRevealsFog(first))) ||
      Math.max(...roadEdgesById.get(second)!.vertexIds.map(id => vertexValue(id))) -
      Math.max(...roadEdgesById.get(first)!.vertexIds.map(id => vertexValue(id))))[0]!;
    const defaultKind = destination?.firstKind ?? (roads.includes(edgeId) ? "road" : "ship");

    const ownEdgeCount = roadBoard.edges.filter(edge => edge.playerId === playerId).length;
    if (checkLongestRoad && ownEdgeCount >= 3) {
      const ownRouteLength = getLongestRoadLength(roadState, playerId);
      const maximumOpponentRouteLength = Math.max(0, ...opponents.map(other => getLongestRoadLength(roadState, other.id)));
      const threshold = Math.max(4, maximumOpponentRouteLength);
      if (state.awards.longestRoad !== playerId && ownEdgeCount >= 4) {
        for (const kind of ["road", "ship"] as const) {
          const candidates = kind === "road" ? roads : ships;
          for (const candidate of candidates.toSorted((first, second) => Number(second === edgeId) - Number(first === edgeId))) {
            const nextState: GameState = {
              ...roadState,
              board: {
                ...roadBoard,
                edges: roadBoard.edges.map(edge => edge.id === candidate ? { ...edge, playerId, kind } : edge),
              },
            };
            if (getLongestRoadLength(nextState, playerId) > threshold) {
              return {
                edgeId: candidate, kind, expansion: candidate === destination?.firstEdge,
                value: candidate === destination?.firstEdge ? pathValue(destination) : 0,
                points: 2, defendsLongestRoad: false,
                distance: candidate === destination?.firstEdge ? destination.distance : 0,
                destinationValue: candidate === destination?.firstEdge ? rawSiteValue(destination.vertexId) : 0,
                destinationIslandBonus: destination ? islandBonus(destination.vertexId) : 0,
                revealsFog: edgeRevealsFog(candidate),
              };
            }
          }
        }
      } else if (state.awards.longestRoad === playerId && maximumOpponentRouteLength >= Math.max(4, ownRouteLength - 1)) {
        for (const kind of ["road", "ship"] as const) {
          const candidates = kind === "road" ? roads : ships;
          for (const candidate of candidates.toSorted((first, second) => Number(second === edgeId) - Number(first === edgeId))) {
            const nextState: GameState = {
              ...roadState,
              board: {
                ...roadBoard,
                edges: roadBoard.edges.map(edge => edge.id === candidate ? { ...edge, playerId, kind } : edge),
              },
            };
            if (getLongestRoadLength(nextState, playerId) > ownRouteLength) {
              return {
                edgeId: candidate, kind, expansion: candidate === destination?.firstEdge,
                value: candidate === destination?.firstEdge ? pathValue(destination) : 0,
                points: 0, defendsLongestRoad: true,
                distance: candidate === destination?.firstEdge ? destination.distance : 0,
                destinationValue: candidate === destination?.firstEdge ? rawSiteValue(destination.vertexId) : 0,
                destinationIslandBonus: destination ? islandBonus(destination.vertexId) : 0,
                revealsFog: edgeRevealsFog(candidate),
              };
            }
          }
        }
      }

      // Detect an immediate two-road Longest Road takeover when winning or closing out the game.
      if (allowTwoStepLongestRoad && state.awards.longestRoad !== playerId &&
        (winsWith(2) || score >= state.victoryPointsToWin - 3) && ownRouteLength >= threshold - 1 &&
        (deficit(activePlayer.resources, TWO_ROADS_COST) === 0 || (winsWith(2) && maritimeAffordable(TWO_ROADS_COST)))) {
        for (const firstCandidate of roads.toSorted((first, second) => Number(second === edgeId) - Number(first === edgeId))) {
          const afterFirst: GameState = {
            ...roadState,
            board: {
              ...roadBoard,
              edges: roadBoard.edges.map(edge => edge.id === firstCandidate ? { ...edge, playerId, kind: "road" } : edge),
            },
          };
          if (getLongestRoadLength(afterFirst, playerId) <= ownRouteLength) continue;
          const secondRoads = legalRoadEdges(afterFirst, playerId);
          for (const secondCandidate of secondRoads) {
            const afterSecond: GameState = {
              ...afterFirst,
              board: {
                ...afterFirst.board,
                edges: afterFirst.board.edges.map(edge => edge.id === secondCandidate ? { ...edge, playerId, kind: "road" } : edge),
              },
            };
            if (getLongestRoadLength(afterSecond, playerId) > threshold) {
              return {
                edgeId: firstCandidate, kind: "road", expansion: firstCandidate === destination?.firstEdge,
                value: firstCandidate === destination?.firstEdge ? pathValue(destination) : 0,
                points: 2, defendsLongestRoad: false,
                distance: firstCandidate === destination?.firstEdge ? destination.distance : 0,
                destinationValue: firstCandidate === destination?.firstEdge ? rawSiteValue(destination.vertexId) : 0,
                destinationIslandBonus: destination ? islandBonus(destination.vertexId) : 0,
                revealsFog: edgeRevealsFog(firstCandidate),
              };
            }
          }
        }
      }
    }

    return {
      edgeId,
      kind: defaultKind,
      expansion: Boolean(destination),
      value: destination ? pathValue(destination) : 0,
      points: 0,
      defendsLongestRoad: false,
      distance: destination ? destination.distance : 0,
      destinationValue: destination ? rawSiteValue(destination.vertexId) : 0,
      destinationIslandBonus: destination ? islandBonus(destination.vertexId) : 0,
      revealsFog: edgeRevealsFog(edgeId),
    };
  }

  function bestShipMove(plannedRoute: RouteCandidate | null): { action: GameAction; value: number } | null {
    if (!isSeafarers(state.variant) || state.shipMoved || state.phase.type !== "actions") return null;
    const movable = movableShipEdges(state, playerId);
    if (movable.length === 0) return null;

    const currentSettlementVertices = new Set(legalSettlementVertices(planningState, playerId));
    const currentRouteLength = getLongestRoadLength(state, playerId);
    const maximumOpponentRouteLength = Math.max(0, ...opponents.map(other => getLongestRoadLength(state, other.id)));
    const holdsLongestRoute = state.awards.longestRoad === playerId;
    const needRouteCheck = currentRouteLength >= 4 || maximumOpponentRouteLength >= 4;
    const desiredShipEdgeId = plannedRoute?.kind === "ship" ? plannedRoute.edgeId : null;

    let bestChoice: { action: GameAction; value: number } | null = null;
    for (const sourceEdgeId of movable) {
      const sourceEdge = edges.get(sourceEdgeId)!;
      const destinations = legalShipDestinations(state, playerId, sourceEdgeId);
      if (destinations.length === 0) continue;

      const sourceLostSiteValue = sourceEdge.vertexIds.reduce((maximum, vertexId) => {
        if (!currentSettlementVertices.has(vertexId)) return maximum;
        const stillConnected = vertices.get(vertexId)!.edgeIds.some(otherEdgeId =>
          otherEdgeId !== sourceEdgeId && edges.get(otherEdgeId)!.playerId === playerId);
        if (stillConnected) return maximum;
        return Math.max(maximum, vertexValue(vertexId) + islandBonus(vertexId) * 12);
      }, 0);

      for (const destinationEdgeId of destinations) {
        const destinationEdge = edges.get(destinationEdgeId)!;
        const fogReveals = new Set(
          destinationEdge.vertexIds.flatMap(vertexId =>
            vertices.get(vertexId)!.tileIds.filter(tileId => tiles.get(tileId)!.terrain === "fog")),
        ).size;

        const gainedSiteValue = destinationEdge.vertexIds.reduce((maximum, vertexId) => {
          const vertex = vertices.get(vertexId)!;
          if (vertex.building || blockedVerticesSet.has(vertexId) || currentSettlementVertices.has(vertexId)) return maximum;
          if (!vertex.tileIds.some(tileId => isLand(tiles.get(tileId)!.terrain))) return maximum;
          return Math.max(maximum, vertexValue(vertexId) + islandBonus(vertexId) * 14);
        }, 0);

        // Moving an idle open-ended ship onto the exact next sea edge in our expansion plan saves wood + wool for free.
        const advancesPlannedLane = desiredShipEdgeId !== null && destinationEdgeId === desiredShipEdgeId &&
          sourceLostSiteValue === 0 && plannedRoute !== null &&
          (plannedRoute.destinationIslandBonus > 0 || plannedRoute.revealsFog || plannedRoute.value >= 5);
        const laneBonus = advancesPlannedLane ? 6 + Math.min(8, plannedRoute!.value) : 0;

        let routeScore = 0;
        if (needRouteCheck) {
          const nextState: GameState = {
            ...state,
            board: {
              ...state.board,
              edges: state.board.edges.map(edge =>
                edge.id === sourceEdgeId ? { ...edge, playerId: null, kind: undefined }
                  : edge.id === destinationEdgeId ? { ...edge, playerId, kind: "ship" } : edge),
            },
          };
          const nextRouteLength = getLongestRoadLength(nextState, playerId);
          if (holdsLongestRoute && nextRouteLength < currentRouteLength) {
            if (nextRouteLength <= maximumOpponentRouteLength || nextRouteLength < 5) continue;
            routeScore -= 14;
          } else if (!holdsLongestRoute && nextRouteLength > Math.max(4, maximumOpponentRouteLength)) {
            routeScore += winsWith(2) ? 10000 : 35;
          } else if (nextRouteLength > currentRouteLength) {
            routeScore += 4;
          }
        }

        const totalValue = fogReveals * 18 + (gainedSiteValue - sourceLostSiteValue) + laneBonus + routeScore;
        if (totalValue > 2.5 && (!bestChoice || totalValue > bestChoice.value)) {
          bestChoice = {
            action: { type: "move-ship", edgeId: sourceEdgeId, destinationEdgeId },
            value: totalValue,
          };
        }
      }
    }
    return bestChoice;
  }

  function selectBankTrade(cost: Resources, inventory = activePlayer.resources): { give: Resource; receive: Resource; ratio: number } | null {
    const missingResources = RESOURCES.filter(resource => inventory[resource] < cost[resource] && state.bank[resource] > 0);
    if (missingResources.length === 0) return null;
    const receive = missingResources.toSorted((first, second) =>
      ((cost[second] - inventory[second]) / (1 + production[second])) -
      ((cost[first] - inventory[first]) / (1 + production[first])))[0]!;
    const giveCandidates = RESOURCES.filter(resource =>
      resource !== receive && inventory[resource] - cost[resource] >= tradeRatios[resource]);
    if (giveCandidates.length === 0) return null;
    const give = giveCandidates.toSorted((first, second) =>
      tradeRatios[first] - tradeRatios[second] ||
      ((inventory[second] - cost[second]) / tradeRatios[second]) - ((inventory[first] - cost[first]) / tradeRatios[first]) ||
      production[second] - production[first])[0]!;
    return { give, receive, ratio: tradeRatios[give] };
  }

  type BuildTarget = { action: GameAction; cost: Resources; value: number };
  const priority = (target: BuildTarget, inventory = activePlayer.resources): number => {
    const missing = deficit(inventory, target.cost);
    const maritimeCards = maritimeTradeCost(target.cost, inventory);
    // Resources arrive in parallel; the slowest missing resource determines the expected wait in table rounds.
    const effort = maritimeCards !== null
      ? maritimeCards / 12
      : missing / 2 + Math.max(...RESOURCES.map(resource =>
        Math.max(0, target.cost[resource] - inventory[resource]) * 36 / ((1 + production[resource]) * state.players.length)));
    return target.value / (1 + effort);
  };

  function buildTargets(cachedRoad?: RouteCandidate | null): BuildTarget[] {
    const targets: BuildTarget[] = [];
    const settlement = bestVertex(legalSettlementVertices(planningState, playerId));
    const city = bestVertex(legalCityVertices(planningState, playerId), false);
    const road = cachedRoad !== undefined ? cachedRoad : bestRoad(planningState, true, true);
    const settlementSiteValue = settlement ? vertexValue(settlement) + islandBonus(settlement) * 12 : 0;

    if (settlement) {
      const earlyExpansionBoost = settlementCount + cityCount <= 3 ? 3.5 : 0;
      targets.push({
        action: { type: "place-settlement", vertexId: settlement },
        cost: COSTS.settlement,
        value: winsWith(1 + islandBonus(settlement))
          ? 10000
          : 19.5 + vertexValue(settlement) * 0.56 + islandBonus(settlement) * 12 + earlyExpansionBoost,
      });
    }
    let cityTarget: BuildTarget | null = null;
    if (city) {
      const pieceLimitBoost = settlementCount >= 5 ? 8 : 0;
      const firstCityBoost = cityCount === 0 ? 2.0 : 0;
      cityTarget = {
        action: { type: "place-city", vertexId: city },
        cost: COSTS.city,
        value: winsWith(1) ? 10000 : 21.5 + cityValue(city) * 0.62 + pieceLimitBoost + firstCityBoost,
      };
      targets.push(cityTarget);
    }
    const roadOpensMuchBetterSite = Boolean(
      road && road.expansion && settlement &&
      road.distance <= 2 && road.destinationValue > settlementSiteValue * 1.45 + 3,
    );
    const comboCost: Resources | null = road
      ? road.kind === "ship"
        ? { wood: 2, brick: 1, wool: 2, grain: 1, ore: 0 }
        : { wood: 2, brick: 2, wool: 1, grain: 1, ore: 0 }
      : null;
    const canComboRoadAndSettlement = Boolean(
      road && comboCost && road.expansion && !settlement && road.distance === 1 &&
      deficit(activePlayer.resources, comboCost) === 0,
    );
    if (road && ((road.expansion && !settlement) || road.points > 0 || road.defendsLongestRoad || roadOpensMuchBetterSite)) {
      const comboWins = canComboRoadAndSettlement && winsWith(1 + road.destinationIslandBonus);
      targets.push({
        action: { type: road.kind === "ship" ? "place-ship" : "place-road", edgeId: road.edgeId },
        cost: COSTS[road.kind],
        value: (road.points > 0 && winsWith(road.points)) || comboWins
          ? 10000
          : 8 + road.value * 1.15 + road.points * 9 + (road.defendsLongestRoad ? 14 : 0) +
            (road.revealsFog ? 4 : 0) + (canComboRoadAndSettlement ? 12 : 0),
      });
    }
    if (state.developmentDeck.length > 0) {
      const urgency = Math.max(0, 1 - (state.victoryPointsToWin - score) / 6);
      const unplayedKnights = activePlayer.developmentCards.filter(card => card.kind === "knight").length;
      const largestArmyThreshold = Math.max(3, highestOpponentKnights + 1);
      const armyDistance = state.awards.largestArmy === playerId
        ? Infinity
        : largestArmyThreshold - (knightsPlayed + unplayedKnights);
      const armyBonus = armyDistance === 1 ? (winsWith(2) ? 14 : 8.5)
        : armyDistance === 2 ? 3.5
        : state.awards.largestArmy === null && state.turnNumber >= 10 ? 2.5 : 0;
      const armyDefenseBonus = state.awards.largestArmy === playerId && highestOpponentKnights >= Math.max(2, knightsPlayed - 1)
        ? 6.0 : 0;
      const engineReadyBonus = cityCount >= 2 ? 3.5
        : cityCount >= 1 || (production.ore >= 4 && production.grain >= 4 && production.wool >= 3) ? 2.4 : 0;
      let developmentValue = 4.4 + 2.6 * state.developmentDeck.length / 25 + 8.0 * urgency +
        armyBonus + armyDefenseBonus + engineReadyBonus;
      // Avoid spending ore and grain on a speculative development card when 1 producible card away from a city.
      const almostFinishedCity = !responding && cityTarget !== null && cityCount < 3 &&
        deficit(activePlayer.resources, COSTS.city) === 1 &&
        !(armyDistance === 1 && winsWith(2)) &&
        ((activePlayer.resources.ore < COSTS.city.ore && production.ore >= 3) ||
          (activePlayer.resources.grain < COSTS.city.grain && production.grain >= 3));
      if (cityTarget && almostFinishedCity) {
        developmentValue = Math.min(developmentValue, priority(cityTarget) * 0.92);
      }
      targets.push({
        action: { type: "buy-development" },
        cost: COSTS.development,
        value: developmentValue,
      });
    }
    return targets.toSorted((first, second) => priority(second) - priority(first));
  }

  function estimateOpponentResourcesFromPublicInformation(): Record<string, Resources> {
    const opponentProduction = new Map<string, Resources>();
    for (const other of opponents) {
      const visible = emptyResources();
      for (const vertex of state.board.vertices) {
        if (vertex.building?.playerId !== other.id) continue;
        const multiplier = vertex.building.kind === "city" ? 2 : 1;
        for (const tileId of vertex.tileIds) {
          const tile = tiles.get(tileId)!;
          if (isResource(tile.terrain) && tile.number !== null) {
            visible[tile.terrain] += pipCount(tile.number) * multiplier;
          }
        }
      }
      opponentProduction.set(other.id, visible);
    }

    // Weight recent dice rolls from the public game log to sharpen Monopoly estimates without reading private hands.
    const recentRolls: number[] = [];
    for (let index = state.log.length - 1; index >= 0 && recentRolls.length < state.players.length * 3; index--) {
      const entry = state.log[index]!;
      if (entry.key === "{player} rolls {first} + {second} = {total}.") {
        const total = entry.parameters?.total;
        if (typeof total === "number" && total !== 7) recentRolls.push(total);
      }
    }

    const recentByOpponent = new Map<string, Resources>(opponents.map(other => [other.id, emptyResources()]));
    for (let rollIndex = 0; rollIndex < recentRolls.length; rollIndex++) {
      const rolledNumber = recentRolls[rollIndex]!;
      const recencyWeight = Math.pow(0.82, rollIndex);
      for (const tile of state.board.tiles) {
        if (tile.number !== rolledNumber || !isResource(tile.terrain)) continue;
        for (const vertexId of tile.vertexIds) {
          const building = vertices.get(vertexId)!.building;
          if (!building || building.playerId === playerId) continue;
          const bucket = recentByOpponent.get(building.playerId);
          if (bucket) bucket[tile.terrain] += (building.kind === "city" ? 2 : 1) * recencyWeight;
        }
      }
    }

    const estimated: Record<string, Resources> = {};
    for (const other of opponents) {
      const cardCount = resourceTotal(other.resources);
      const result = emptyResources();
      if (cardCount > 0) {
        const baseline = opponentProduction.get(other.id)!;
        const recent = recentByOpponent.get(other.id)!;
        const baselineTotal = resourceTotal(baseline);
        const recentTotal = resourceTotal(recent);
        const combined = emptyResources();
        for (const resource of RESOURCES) {
          const baselineShare = baselineTotal > 0 ? baseline[resource] / baselineTotal : 1 / RESOURCES.length;
          const recentShare = recentTotal > 0 ? recent[resource] / recentTotal : baselineShare;
          combined[resource] = recentTotal > 0 ? baselineShare * 0.45 + recentShare * 0.55 : baselineShare;
        }
        const combinedTotal = resourceTotal(combined);
        for (const resource of RESOURCES) {
          result[resource] = cardCount * (combinedTotal > 0 ? combined[resource] / combinedTotal : 1 / RESOURCES.length);
        }
      }
      estimated[other.id] = result;
    }
    return estimated;
  }

  function robberMove(primaryTargetOverride?: BuildTarget): { action: GameAction; value: number } {
    const primaryTarget = primaryTargetOverride !== undefined ? primaryTargetOverride : buildTargets(null)[0];
    const neededResources = new Set(
      primaryTarget ? RESOURCES.filter(resource => activePlayer.resources[resource] < primaryTarget.cost[resource]) : [],
    );

    const opponentResourceSources = new Map<string, Resources>();
    for (const other of opponents) {
      const totals = emptyResources();
      for (const vertex of state.board.vertices) {
        if (vertex.building?.playerId !== other.id) continue;
        const multiplier = vertex.building.kind === "city" ? 2 : 1;
        for (const tileId of vertex.tileIds) {
          const tile = tiles.get(tileId)!;
          if (isResource(tile.terrain) && tile.number !== null) {
            totals[tile.terrain] += pipCount(tile.number) * multiplier;
          }
        }
      }
      opponentResourceSources.set(other.id, totals);
    }

    const tileValue = (tile: Tile): number => {
      const owners = new Set<string>();
      const tilePips = pipCount(tile.number);
      const terrainPriority = tile.terrain === "gold" ? 1.55
        : tile.terrain === "ore" || tile.terrain === "grain" ? (state.turnNumber > 16 ? 1.25 : 1.1)
        : 1.0;

      const blocking = tile.vertexIds.reduce((total, vertexId) => {
        const building = vertices.get(vertexId)!.building;
        if (!building) return total;
        const buildingMultiplier = building.kind === "city" ? 2 : 1;
        if (building.playerId === playerId) {
          return total - 5.5 * buildingMultiplier * tilePips * terrainPriority;
        }
        owners.add(building.playerId);
        const opponentScore = publicScores.get(building.playerId)!;
        const isLeader = opponentScore === highestOpponentScore && opponentScore >= 3;
        const contenderMultiplier = opponentScore >= state.victoryPointsToWin - 1 ? 3.0
          : opponentScore >= state.victoryPointsToWin - 2 ? 2.1
          : isLeader ? 1.35 : 1.0;
        const opponentTotals = opponentResourceSources.get(building.playerId)!;
        const isBottleneck = isResource(tile.terrain) &&
          opponentTotals[tile.terrain] <= tilePips * buildingMultiplier * 1.1;
        const bottleneckMultiplier = isBottleneck ? 1.2 : 1.0;
        return total + (1 + opponentScore / 2.5) * contenderMultiplier * bottleneckMultiplier *
          buildingMultiplier * tilePips * terrainPriority;
      }, 0);

      // You steal at most 1 card from 1 adjacent opponent, so score the best stealable victim on this tile.
      let bestStealValue = 0;
      for (const ownerId of owners) {
        const owner = state.players.find(other => other.id === ownerId)!;
        const handSize = resourceTotal(owner.resources);
        if (handSize === 0) continue;
        const opponentScore = publicScores.get(ownerId)!;
        const isLeader = opponentScore === highestOpponentScore && opponentScore >= 3;
        const opponentTotals = opponentResourceSources.get(ownerId)!;
        const opponentTotalProduction = resourceTotal(opponentTotals);
        let neededChance = 0;
        if (opponentTotalProduction > 0) {
          for (const resource of neededResources) {
            neededChance += opponentTotals[resource] / opponentTotalProduction;
          }
        }
        const stealScore = 2.0 + opponentScore * 0.55 + (isLeader ? 2.0 : 0) + neededChance * 1.8 + Math.min(1.5, handSize * 0.15);
        bestStealValue = Math.max(bestStealValue, stealScore);
      }
      return blocking + bestStealValue;
    };

    const bestLandTile = state.board.tiles.filter(tile => isLand(tile.terrain) && tile.id !== state.robberTileId)
      .toSorted((first, second) => tileValue(second) - tileValue(first))[0]!;
    const currentRobberTile = tiles.get(state.robberTileId);
    const unblockValue = (currentRobberTile?.vertexIds ?? []).reduce((total, vertexId) => {
      const building = vertices.get(vertexId)!.building;
      const number = currentRobberTile!.number;
      return total + (building?.playerId === playerId && number !== null
        ? 5.0 * pipCount(number) * (building.kind === "city" ? 2 : 1) : 0);
    }, 0);

    const bestPirateTile = state.board.tiles.filter(tile => tile.terrain === "sea" && tile.id !== state.pirateTileId)
      .map(tile => {
        const adjacentShips = state.board.edges.filter(edge => edge.kind === "ship" && edge.playerId &&
          edge.vertexIds.every(id => tile.vertexIds.includes(id)));
        const ownShipPenalty = adjacentShips.some(edge => edge.playerId === playerId) ? -12 : 0;
        const opponentShipOwners = new Set(adjacentShips.filter(edge => edge.playerId !== playerId).map(edge => edge.playerId!));
        let value = ownShipPenalty;
        for (const ownerId of opponentShipOwners) {
          const opponentScore = publicScores.get(ownerId)!;
          const ownerHandSize = resourceTotal(state.players.find(other => other.id === ownerId)!.resources);
          value += 2.5 + opponentScore * 0.65 + (ownerHandSize > 0 ? 2.5 : 0);
        }
        return { tile, value };
      })
      .toSorted((first, second) => second.value - first.value)[0];

    if (bestPirateTile && bestPirateTile.value > tileValue(bestLandTile) + unblockValue) {
      return { action: { type: "move-pirate", tileId: bestPirateTile.tile.id }, value: bestPirateTile.value };
    }
    return { action: { type: "move-robber", tileId: bestLandTile.id }, value: tileValue(bestLandTile) + unblockValue };
  }

  function isBlockedTradePartner(otherId: string): boolean {
    return publicScores.get(otherId)! >= state.victoryPointsToWin - 1;
  }

  if (responding && state.trade) {
    const trade = state.trade;
    const targets = buildTargets();
    const before = Math.max(0, ...targets.map(target => priority(target)));
    const after = { ...activePlayer.resources };
    const partnerScore = publicScores.get(trade.offeredBy)!;
    const partnerIsDangerousLeader = partnerScore >= state.victoryPointsToWin - 2 && partnerScore > score;
    if (trade.give === null) {
      if (isBlockedTradePartner(trade.offeredBy)) {
        return { type: "respond-trade", accept: false };
      }
      if (RESOURCES.some(resource => activePlayer.resources[resource] < trade.receive[resource])) {
        return { type: "respond-trade", accept: false };
      }
      let proposal: { price: Resources; value: number } | null = null;
      const resourcesByScarcity = RESOURCES.toSorted((first, second) => production[first] - production[second]);
      for (const target of targets) {
        const price = emptyResources();
        const inventory = { ...after };
        let remaining = resourceTotal(trade.receive);
        for (const resource of RESOURCES) inventory[resource] -= trade.receive[resource];
        for (const resource of resourcesByScarcity) {
          if (trade.receive[resource] > 0) continue;
          price[resource] = Math.min(remaining, Math.max(0, target.cost[resource] - inventory[resource]));
          inventory[resource] += price[resource];
          remaining -= price[resource];
        }
        const value = priority(target, inventory);
        const completesTarget = deficit(inventory, target.cost) === 0;
        const meetsLeaderThreshold = !partnerIsDangerousLeader || completesTarget || value > before + 2.0;
        if (remaining === 0 && deficit(inventory, target.cost) < deficit(activePlayer.resources, target.cost) &&
          value > before && meetsLeaderThreshold && (!proposal || value > proposal.value)) {
          proposal = { price, value };
        }
      }
      return proposal
        ? { type: "propose-trade", price: proposal.price }
        : { type: "respond-trade", accept: false };
    }
    for (const resource of RESOURCES) after[resource] += trade.give[resource] - trade.receive[resource];
    const improvement = Math.max(0, ...targets.map(target => priority(target, after))) - before;
    const completesTargetNow = targets.some(target =>
      deficit(activePlayer.resources, target.cost) > 0 && deficit(after, target.cost) === 0);
    const minimumImprovement = partnerIsDangerousLeader && !completesTargetNow ? 1.8 : 0.1;
    return {
      type: "respond-trade",
      accept: !isBlockedTradePartner(trade.offeredBy) &&
        RESOURCES.every(resource => activePlayer.resources[resource] >= trade.receive[resource]) &&
        resourceTotal(trade.give) >= resourceTotal(trade.receive) &&
        (improvement > minimumImprovement || (improvement === 0 && resourceTotal(trade.give) > resourceTotal(trade.receive))),
    };
  }

  return match(state.phase)
    .with({ type: "setup-reveal" }, (): GameAction | null => {
      const revealCandidates = legalSetupRevealTiles(state, playerId);
      if (revealCandidates.length > 0) {
        const revealedSetup = settlementCount > 0;
        const bestRevealTileId = revealCandidates.toSorted((firstId, secondId) => {
          const scoreRevealTile = (tileId: string): number => {
            const tile = tiles.get(tileId)!;
            let tileScore = 0;
            let openVertices = 0;
            for (const vertexId of tile.vertexIds) {
              const vertex = vertices.get(vertexId)!;
              if (!vertex.building && !blockedVerticesSet.has(vertexId)) {
                openVertices++;
                if (revealedSetup) {
                  for (const neighborTileId of vertex.tileIds) {
                    if (neighborTileId === tileId) continue;
                    const neighborTile = tiles.get(neighborTileId)!;
                    if (isLand(neighborTile.terrain) && neighborTile.number !== null) {
                      tileScore += pipCount(neighborTile.number) * 1.4;
                    }
                  }
                }
              }
              if (vertex.building && vertex.building.playerId !== playerId) {
                tileScore -= 4;
              }
            }
            return tileScore + openVertices * 1.2;
          };
          return scoreRevealTile(secondId) - scoreRevealTile(firstId);
        })[0]!;
        return { type: "reveal-tile", tileId: bestRevealTileId };
      }
      const vertexId = bestSetupVertex(legalSettlementVertices(state, playerId));
      return vertexId ? { type: "place-settlement", vertexId } : null;
    })
    .with({ type: "setup-settlement" }, (): GameAction | null => {
      const vertexId = bestSetupVertex(legalSettlementVertices(state, playerId));
      return vertexId ? { type: "place-settlement", vertexId } : null;
    })
    .with({ type: "setup-road" }, (): GameAction | null => {
      const road = bestRoad(state, false);
      return road ? { type: road.kind === "ship" ? "place-ship" : "place-road", edgeId: road.edgeId } : null;
    })
    .with({ type: "road-building" }, (): GameAction => {
      const road = bestRoad(state);
      return road ? { type: road.kind === "ship" ? "place-ship" : "place-road", edgeId: road.edgeId } : { type: "skip-roads" };
    })
    .with({ type: "gold" }, (phase): GameAction => {
      const selected = emptyResources();
      const targets = buildTargets();
      const primaryCost = targets[0]?.cost ?? COSTS.city;
      const secondaryCost = targets[1]?.cost ?? COSTS.settlement;
      const requiredCount = Math.min(phase.required[playerId]!, resourceTotal(state.bank));
      for (let index = 0; index < requiredCount; index++) {
        const available = RESOURCES.filter(resource => state.bank[resource] > selected[resource]);
        const resource = available.toSorted((first, second) => {
          const scoreGoldResource = (candidate: Resource): number => {
            const held = activePlayer.resources[candidate] + selected[candidate];
            const primaryNeed = Math.max(0, primaryCost[candidate] - held);
            const secondaryNeed = Math.max(0, secondaryCost[candidate] - held);
            if (primaryNeed > 0) return 1000 + primaryNeed * 20 - production[candidate];
            if (secondaryNeed > 0) return 200 + secondaryNeed * 15 - production[candidate];
            const portCompletion = tradeRatios[candidate] === 2 && held % 2 === 1 ? 18 : 0;
            return portCompletion + (candidate === "ore" || candidate === "grain" ? 12 : 0) - production[candidate];
          };
          return scoreGoldResource(second) - scoreGoldResource(first);
        })[0]!;
        selected[resource]++;
      }
      return { type: "choose-gold", resources: selected };
    })
    .with({ type: "discard" }, (phase): GameAction | null => {
      if (!discarding) return null;
      const targets = buildTargets();
      const primaryCost = targets[0]?.cost ?? COSTS.city;
      const secondaryCost = targets[1]?.cost ?? COSTS.settlement;
      const discarded = emptyResources();
      for (let index = 0; index < phase.required[playerId]!; index++) {
        const available = RESOURCES.filter(resource => activePlayer.resources[resource] > discarded[resource]);
        const resource = available.toSorted((first, second) => {
          const keepScore = (candidate: Resource): number => {
            const remaining = activePlayer.resources[candidate] - discarded[candidate];
            const inPrimary = remaining <= primaryCost[candidate];
            const inSecondary = remaining <= secondaryCost[candidate];
            const primaryWeight = inPrimary ? 1000 : 0;
            const secondaryWeight = inSecondary ? 180 : 0;
            const portPairBonus = tradeRatios[candidate] === 2 && remaining === 2 ? 40 : 0;
            const scarcityBonus = scarcityWeight[candidate] * 12 - production[candidate] * 1.5;
            const duplicatePenalty = Math.max(0, remaining - primaryCost[candidate]) * 18;
            return primaryWeight + secondaryWeight + portPairBonus + scarcityBonus - duplicatePenalty;
          };
          return keepScore(first) - keepScore(second);
        })[0]!;
        discarded[resource]++;
      }
      return { type: "discard", resources: discarded };
    })
    .with({ type: "robber" }, (): GameAction => robberMove().action)
    .with({ type: "steal" }, (phase): GameAction => ({
      type: "steal",
      playerId: phase.victimIds.toSorted((first, second) => {
        const firstCount = resourceTotal(state.players.find(other => other.id === first)!.resources);
        const secondCount = resourceTotal(state.players.find(other => other.id === second)!.resources);
        return Number(secondCount > 0) - Number(firstCount > 0) ||
          publicScores.get(second)! - publicScores.get(first)! || secondCount - firstCount;
      })[0]!,
    }))
    .with({ type: "roll" }, { type: "actions" }, (phase): GameAction | null => {
      const plannedRoute = phase.type === "actions" ? bestRoad(planningState, true, true) : null;
      const targets = buildTargets(plannedRoute);
      const target = targets[0];
      const cost = target?.cost ?? COSTS.city;

      if (state.trade?.offeredBy === playerId && phase.type === "actions") {
        const trade = state.trade;
        let bestProposal: { otherId: string; score: number } | null = null;
        for (const [otherId, price] of Object.entries(trade.responses)) {
          if (!price || resourceTotal(price) > resourceTotal(trade.receive) ||
            RESOURCES.some(resource => price[resource] > activePlayer.resources[resource]) ||
            isBlockedTradePartner(otherId)) continue;
          const after = { ...activePlayer.resources };
          for (const resource of RESOURCES) after[resource] += trade.receive[resource] - price[resource];
          const helpsAnyTarget = targets.some(candidate =>
            deficit(after, candidate.cost) < deficit(activePlayer.resources, candidate.cost) &&
            (candidate === target || deficit(after, candidate.cost) === 0));
          if (helpsAnyTarget) {
            const afterPriority = Math.max(0, ...targets.map(candidate => priority(candidate, after)));
            const abundancePreference = RESOURCES.reduce((sum, resource) => sum + price[resource] * production[resource], 0);
            const partnerScorePenalty = publicScores.get(otherId)! * 0.5;
            const proposalScore = afterPriority * 10 + abundancePreference * 0.2 - partnerScorePenalty;
            if (!bestProposal || proposalScore > bestProposal.score) {
              bestProposal = { otherId, score: proposalScore };
            }
          }
        }
        if (bestProposal) return { type: "complete-trade", playerId: bestProposal.otherId };
        const unanswered = state.players.some(other => other.id !== playerId && !Object.hasOwn(trade.responses, other.id));
        if (unanswered && trade.expiresAt !== undefined && now < trade.expiresAt) return null;
        return { type: "cancel-trade" };
      }

      if (phase.type === "actions") {
        const immediateWin = targets.find(candidate => candidate.value === 10000 && deficit(activePlayer.resources, candidate.cost) === 0);
        if (immediateWin) return immediateWin.action;
      }

      const developmentActions: { action: GameAction; value: number }[] = [];
      for (const card of activePlayer.developmentCards) {
        if (state.developmentPlayed || card.purchasedTurn >= state.turnNumber ||
          (phase.type === "roll" && card.kind !== "knight")) continue;
        const choice = match(card.kind)
          .with("victory-point", () => null)
          .with("knight", (): typeof developmentActions[number] | null => {
            const robberTile = tiles.get(state.robberTileId);
            const blocked = robberTile?.vertexIds.some(id => vertices.get(id)!.building?.playerId === playerId) ?? false;
            const army = state.awards.largestArmy !== playerId && activePlayer.knightsPlayed + 1 >= 3 &&
              activePlayer.knightsPlayed + 1 > highestOpponentKnights;
            const move = robberMove(target);
            const unplayedMatureKnights = activePlayer.developmentCards.filter(other =>
              other.kind === "knight" && other.purchasedTurn < state.turnNumber).length;
            const aggressiveBeforeRoll = phase.type === "roll" && unplayedMatureKnights >= 2 && move.value >= 12;
            if (!blocked && !army && !aggressiveBeforeRoll && (phase.type === "roll" || move.value <= 0)) return null;
            return {
              action: { type: "play-development", cardId: card.id },
              value: army ? (winsWith(2) ? 10000 : 42) : blocked ? 30 : Math.max(4, move.value * 0.45),
            };
          })
          .with("road-building", (): typeof developmentActions[number] | null => {
            const firstRoad = plannedRoute ?? bestRoad(planningState);
            if (!firstRoad) return null;
            const boardAfterFirst = {
              ...state.board,
              edges: state.board.edges.map(edge =>
                edge.id === firstRoad.edgeId ? { ...edge, playerId, kind: firstRoad.kind } : edge),
            };
            const secondRoad = bestRoad({ ...planningState, board: boardAfterFirst });
            const takesLongestRoad = firstRoad.points > 0 || (secondRoad?.points ?? 0) > 0;
            const defendsLongestRoad = firstRoad.defendsLongestRoad || Boolean(secondRoad?.defendsLongestRoad);
            const expands = firstRoad.expansion || Boolean(secondRoad?.expansion);
            if (!expands && !takesLongestRoad && !defendsLongestRoad) return null;
            const totalRoadValue = firstRoad.value + (secondRoad?.value ?? 0) * 0.8;
            const unlocksAffordableSettlement = deficit(activePlayer.resources, COSTS.settlement) === 0 &&
              firstRoad.expansion && firstRoad.distance <= 2;
            return {
              action: { type: "play-development", cardId: card.id },
              value: takesLongestRoad && winsWith(2)
                ? 10000
                : 10 + totalRoadValue + (takesLongestRoad ? 24 : 0) + (defendsLongestRoad ? 16 : 0) +
                  (unlocksAffordableSettlement ? 12 : 0),
            };
          })
          .with("year-of-plenty", (): typeof developmentActions[number] | null => {
            const count = Math.min(2, resourceTotal(state.bank));
            if (count === 0) return null;
            let bestPlan: { selected: Resources; value: number } | null = null;
            for (let targetIndex = 0; targetIndex < targets.length; targetIndex++) {
              const candidate = targets[targetIndex]!;
              const missing = deficit(activePlayer.resources, candidate.cost);
              if (missing === 0) continue;
              const selected = emptyResources();
              const secondaryCost = targets[targetIndex === 0 ? 1 : 0]?.cost ?? COSTS.settlement;
              for (let step = 0; step < count; step++) {
                const available = RESOURCES.filter(resource => state.bank[resource] > selected[resource]);
                const resource = available.toSorted((first, second) => {
                  const firstPrimary = candidate.cost[first] - activePlayer.resources[first] - selected[first];
                  const secondPrimary = candidate.cost[second] - activePlayer.resources[second] - selected[second];
                  if (firstPrimary > 0 || secondPrimary > 0) return secondPrimary - firstPrimary;
                  const firstSecondary = secondaryCost[first] - activePlayer.resources[first] - selected[first];
                  const secondSecondary = secondaryCost[second] - activePlayer.resources[second] - selected[second];
                  if (firstSecondary > 0 || secondSecondary > 0) {
                    return secondSecondary - firstSecondary || production[first] - production[second];
                  }
                  return production[first] - production[second];
                })[0]!;
                selected[resource]++;
              }
              const after = { ...activePlayer.resources };
              for (const resource of RESOURCES) after[resource] += selected[resource];
              const finishesDirect = deficit(after, candidate.cost) === 0;
              const finishesWithBank = !finishesDirect && candidate.value >= 18 && maritimeAffordable(candidate.cost, after);
              if (!finishesDirect && !finishesWithBank) continue;
              const planValue = candidate.value - (finishesWithBank ? 3 : 0);
              if (!bestPlan || planValue > bestPlan.value) {
                bestPlan = { selected, value: planValue };
              }
            }
            return bestPlan
              ? { action: { type: "play-development", cardId: card.id, resources: bestPlan.selected }, value: bestPlan.value }
              : null;
          })
          .with("monopoly", (): typeof developmentActions[number] | null => {
            const opponentEstimates = estimateOpponentResourcesFromPublicInformation();
            const expected = emptyResources();
            const leaderExpected = emptyResources();
            for (const other of opponents) {
              const estimate = opponentEstimates[other.id]!;
              const isLeader = publicScores.get(other.id)! === highestOpponentScore && highestOpponentScore >= 3;
              for (const resource of RESOURCES) {
                expected[resource] += estimate[resource];
                if (isLeader) leaderExpected[resource] += estimate[resource];
              }
            }
            const scoreMonopoly = (resource: Resource): number => {
              const directGain = expected[resource];
              const neededBonus = Math.min(directGain, Math.max(0, cost[resource] - activePlayer.resources[resource])) * 2.2;
              const portBonus = tradeRatios[resource] === 2 ? directGain * 0.7 : tradeRatios[resource] === 3 ? directGain * 0.25 : 0;
              const leaderDenial = leaderExpected[resource] * 0.6;
              return directGain + neededBonus + portBonus + leaderDenial;
            };
            const bestResource = RESOURCES.toSorted((first, second) => scoreMonopoly(second) - scoreMonopoly(first))[0]!;
            const minimumExpected = score >= state.victoryPointsToWin - 3 || cost[bestResource] > activePlayer.resources[bestResource] ? 2.0 : 2.8;
            return expected[bestResource] >= minimumExpected
              ? { action: { type: "play-development", cardId: card.id, resource: bestResource }, value: scoreMonopoly(bestResource) * 2.2 }
              : null;
          })
          .exhaustive();
        if (choice) developmentActions.push(choice);
      }
      const development = developmentActions.toSorted((first, second) => second.value - first.value)[0];
      if (development) return development.action;
      if (phase.type === "roll") return { type: "roll" };

      const shipMove = bestShipMove(plannedRoute);
      if (shipMove) return shipMove.action;

      if (target && deficit(activePlayer.resources, target.cost) === 0) return target.action;

      if (target && target.value === 10000 && maritimeAffordable(target.cost)) {
        const winningTrade = selectBankTrade(target.cost);
        if (winningTrade) return { type: "bank-trade", give: winningTrade.give, receive: winningTrade.receive };
      }

      if (!state.computerTradeRequested && target) {
        const oneCardBuildTarget = deficit(activePlayer.resources, target.cost) > 1
          ? targets.find(candidate =>
            (candidate.action.type === "place-settlement" || candidate.action.type === "place-city") &&
            deficit(activePlayer.resources, candidate.cost) === 1 &&
            RESOURCES.reduce((total, resource) => total + Math.max(0, activePlayer.resources[resource] - candidate.cost[resource]), 0) >= 1)
          : undefined;
        const requestTarget = oneCardBuildTarget ?? target;
        const surplus = RESOURCES.reduce((total, resource) => total + Math.max(0, activePlayer.resources[resource] - requestTarget.cost[resource]), 0);
        if (surplus >= 1) {
          const missing = RESOURCES.filter(resource => requestTarget.cost[resource] > activePlayer.resources[resource]);
          // A single-card request lets any opponent holding the resource complete the trade.
          const scarce = missing.toSorted((first, second) =>
            (requestTarget.cost[second] - activePlayer.resources[second]) / (1 + production[second]) -
            (requestTarget.cost[first] - activePlayer.resources[first]) / (1 + production[first]))[0]!;
          const receive = emptyResources();
          receive[scarce] = 1;
          return { type: "request-trade", receive };
        }
      }

      if (target && maritimeAffordable(target.cost)) {
        const trade = selectBankTrade(target.cost);
        // Preserve the selected cost: each trade reduces its deficit, and only trade toward an attainable purchase.
        if (trade) return { type: "bank-trade", give: trade.give, receive: trade.receive };
      }

      const handSize = resourceTotal(activePlayer.resources);
      // Spend non-conflicting resources on a useful secondary build when it never touches cards reserved for the top plan.
      if (target) {
        const nonConflicting = targets.slice(1).find(secondary =>
          deficit(activePlayer.resources, secondary.cost) === 0 &&
          RESOURCES.every(resource => activePlayer.resources[resource] - secondary.cost[resource] >= Math.min(activePlayer.resources[resource], target.cost[resource])) &&
          (handSize > 6 || secondary.value >= 14));
        if (nonConflicting) return nonConflicting.action;
      }

      // Reduce 7-roll discard exposure when holding more than 7 cards at the end of a turn.
      if (handSize > 7) {
        const protectNearCity = target?.action.type === "place-city" && deficit(activePlayer.resources, COSTS.city) === 1 && handSize <= 8;
        const affordableSecondary = targets.slice(1).find(secondary =>
          deficit(activePlayer.resources, secondary.cost) === 0 &&
          !(protectNearCity && secondary.action.type === "buy-development"));
        if (affordableSecondary) return affordableSecondary.action;

        const maritimeSecondary = targets.slice(1).find(secondary =>
          secondary.value >= 12 && maritimeAffordable(secondary.cost));
        if (maritimeSecondary) {
          const trade = selectBankTrade(maritimeSecondary.cost);
          if (trade) return { type: "bank-trade", give: trade.give, receive: trade.receive };
        }

        if (target) {
          const protectiveTrade = selectBankTrade(target.cost);
          const tradeIsPositiveValue = protectiveTrade !== null && (
            (protectiveTrade.ratio === 2 && handSize >= 8) ||
            (protectiveTrade.ratio === 3 && handSize >= 9) ||
            (protectiveTrade.ratio === 4 && handSize >= 11)
          );
          if (protectiveTrade && tradeIsPositiveValue) {
            return { type: "bank-trade", give: protectiveTrade.give, receive: protectiveTrade.receive };
          }
        }
      }

      return { type: "end-turn" };
    })
    .exhaustive();
}

export function getComputerActionDelay(state: GameState, now = Date.now()): number | null {
  if (state.players.some(player => chooseComputerAction(state, player.id, now))) return 450;
  return state.phase.type === "actions" && state.trade?.expiresAt !== undefined &&
    state.players.some(player => player.id === state.trade!.offeredBy && player.control === "computer")
    ? Math.max(0, state.trade.expiresAt - now) : null;
}
