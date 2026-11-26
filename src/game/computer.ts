import { match } from "ts-pattern";
import {
  blockedSettlementVertices, COSTS, emptyResources, getLongestRoadLength, getPublicScore, getScore, getTradeRatio,
  hasLegalSabotageTarget, legalCityVertices, legalRoadEdges, legalRobberOrPirateTiles, legalSabotageEdges, legalSabotageVertices,
  legalSettlementVertices, legalShipDestinations, legalShipEdges, legalSetupRevealTiles, movableShipEdges,
  RESOURCES, resourceTotal,
} from "./engine";
import { edgeTiles, isLand, isPortRevealed, isResource } from "./board";
import { isFogBoard, isSeafarers } from "./types";
import type { GameAction, GameState, Resource, Resources, Tile } from "./types";

const PIP_MULTIPLIER_BY_TERRAIN: Record<Resource | "gold" | "volcano", number> = {
  gold: 2.5,
  volcano: 1.9,
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

  const opponents = state.players.filter(other => other.id !== playerId);
  const playerNameToId = new Map(state.players.map(candidate => [candidate.name, candidate.id]));
  const opponentUnplayedDevelopmentCount = new Map<string, number>(opponents.map(other => [other.id, 0]));
  for (const entry of state.log) {
    const actorName = entry.parameters?.player;
    const actorId = typeof actorName === "string" ? playerNameToId.get(actorName) : undefined;
    if (entry.key === "{player} buys a development card." && actorId && actorId !== playerId) {
      opponentUnplayedDevelopmentCount.set(actorId, (opponentUnplayedDevelopmentCount.get(actorId) ?? 0) + 1);
    } else if (entry.key === "{player} plays {kind}.") {
      if (actorId && actorId !== playerId) {
        opponentUnplayedDevelopmentCount.set(actorId, Math.max(0, (opponentUnplayedDevelopmentCount.get(actorId) ?? 0) - 1));
      }
    } else if (entry.key === "{player} cancels Knight.") {
      if (actorId && actorId !== playerId) {
        opponentUnplayedDevelopmentCount.set(actorId, (opponentUnplayedDevelopmentCount.get(actorId) ?? 0) + 1);
      }
    }
  }
  const ownVictoryPointCards = activePlayer.developmentCards.filter(card => card.kind === "victory-point").length;
  const totalOpponentUnplayedDevelopment = [...opponentUnplayedDevelopmentCount.values()].reduce((sum, count) => sum + count, 0);
  const remainingVictoryPointsInPool = Math.max(0, 5 - ownVictoryPointCards);
  const estimatedHiddenThreat = (otherId: string): number => {
    const unplayed = opponentUnplayedDevelopmentCount.get(otherId) ?? 0;
    if (unplayed === 0) return 0;
    const expectedHiddenPoints = Math.min(unplayed * 0.42, remainingVictoryPointsInPool);
    const otherPlayer = state.players.find(candidate => candidate.id === otherId)!;
    const armyThreat = state.awards.largestArmy !== otherId && otherPlayer.knightsPlayed >= 2 ? 0.65 : 0;
    return expectedHiddenPoints + armyThreat;
  };

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
        if (tile.terrain === "gold" || tile.terrain === "volcano") {
          for (const resource of RESOURCES) production[resource] += (yieldValue * (tile.terrain === "volcano" ? 0.8 : 1)) / RESOURCES.length;
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
      : tile.terrain === "volcano" ? 1.85
      : tile.terrain === "ore" || tile.terrain === "grain" ? 1.34
      : tradeRatios[tile.terrain] === 2 ? 1.28 : 1;
    return value + pipCount(tile.number) * engineWeight;
  }, 0);

  function islandBonusOnBoard(board: GameState["board"], vertexId: string): number {
    if ((state.variant !== "seafarers" && state.variant !== "four-islands") || inSetupPlacement) return 0;
    return new Set(vertices.get(vertexId)!.tileIds.map(id => tiles.get(id)!.islandId).filter(island =>
      island && (state.variant === "four-islands" ? !state.startingIslandIds?.[playerId]?.includes(island) : island !== "main") &&
      !board.vertices.some(vertex => vertex.building?.playerId === playerId &&
        vertex.tileIds.some(id => tiles.get(id)!.islandId === island)))).size * 2;
  }

  const islandBonus = (vertexId: string): number => islandBonusOnBoard(state.board, vertexId);

  const explorationValue = (vertexId: string): number => state.variant === "fog-islands" || isFogBoard(state.board)
    ? vertices.get(vertexId)!.tileIds.filter(id => tiles.get(id)!.terrain === "fog").length * 8 : 0;

  const bestVertex = (locations: string[], balance = true): string | undefined =>
    locations.toSorted((first, second) =>
      ((balance ? vertexValue(second, true) : cityValue(second)) + islandBonus(second) * 10) -
      ((balance ? vertexValue(first, true) : cityValue(first)) + islandBonus(first) * 10))[0];

  const isSecondSetup = state.setupIndex >= state.players.length;
  const blockedVerticesSet = new Set(blockedSettlementVertices(state.board));
  const adjacentVertexIds = new Map<string, string[]>(
    state.board.vertices.map(vertex => [
      vertex.id,
      vertex.edgeIds.map(edgeId => {
        const edge = edges.get(edgeId)!;
        return edge.vertexIds[0] === vertex.id ? edge.vertexIds[1] : edge.vertexIds[0];
      }),
    ]),
  );

  const setupExpansionPotential = (vertexId: string, excludedVertices: Set<string> = blockedVerticesSet): number => {
    if (state.board.edges.length === 0) return 0;
    const immediateNeighbors = new Set(adjacentVertexIds.get(vertexId) ?? []);
    let bestNearby = 0;
    let secondNearby = 0;
    for (const neighborId of immediateNeighbors) {
      for (const candidateId of adjacentVertexIds.get(neighborId) ?? []) {
        if (candidateId === vertexId || immediateNeighbors.has(candidateId)) continue;
        const candidate = vertices.get(candidateId)!;
        if (candidate.building || excludedVertices.has(candidateId)) continue;
        if (isSeafarers(state.variant) && !candidate.tileIds.some(id => isLand(tiles.get(id)!.terrain))) continue;
        const siteScore = vertexValue(candidateId);
        if (siteScore > bestNearby) {
          secondNearby = bestNearby;
          bestNearby = siteScore;
        } else if (siteScore > secondNearby) {
          secondNearby = siteScore;
        }
      }
    }
    return bestNearby * 0.14 + secondNearby * 0.04;
  };

  const evaluateSetupPair = (firstVertexId: string, secondVertexId: string): number => {
    const combined = emptyResources();
    const combinedNumbers = new Map<number, number>();
    const secondResources = new Set<Resource>();
    const pairVertices = [firstVertexId, secondVertexId];
    let weightedYield = 0;

    for (let placementIndex = 0; placementIndex < pairVertices.length; placementIndex++) {
      const currentVertexId = pairVertices[placementIndex]!;
      for (const tileId of vertices.get(currentVertexId)!.tileIds) {
        const tile = tiles.get(tileId)!;
        if (tile.terrain === "desert" || tile.terrain === "sea" || tile.terrain === "fog" || tile.number === null) continue;
        const pips = pipCount(tile.number);
        const terrainWeight = PIP_MULTIPLIER_BY_TERRAIN[tile.terrain] *
          (isResource(tile.terrain) ? scarcityWeight[tile.terrain] : 1);
        const existingNumberPips = combinedNumbers.get(tile.number) ?? 0;
        const numberDiversityFactor = 1 / (1 + existingNumberPips / 15);
        weightedYield += pips * terrainWeight * numberDiversityFactor;
        combinedNumbers.set(tile.number, existingNumberPips + pips);
        if (isResource(tile.terrain)) {
          combined[tile.terrain] += pips;
          if (placementIndex === 1) secondResources.add(tile.terrain);
        } else if (tile.terrain === "gold") {
          for (const resource of RESOURCES) combined[resource] += pips * 0.48;
        }
      }
    }

    const totalCombined = resourceTotal(combined);
    if (totalCombined === 0) return 0;

    const breadth = RESOURCES.reduce((sum, resource) => sum + Math.min(combined[resource], 3.5), 0);
    const missingCorePenalty = (combined.grain === 0 ? 3.2 : 0) + (combined.ore === 0 ? 2.4 : 0) +
      (combined.wood === 0 ? 1.1 : 0) + (combined.brick === 0 ? 1.1 : 0) + (combined.wool === 0 ? 0.9 : 0);
    const concentration = Math.max(...RESOURCES.map(resource => combined[resource])) / totalCombined;
    const concentrationPenalty = Math.max(0, concentration - 0.5) * totalCombined * 2.1;
    const roadSettlementSynergy = Math.min(combined.wood, combined.brick) * 0.28;
    const shipSynergy = isSeafarers(state.variant) ? Math.min(combined.wood, combined.wool) * 0.26 : 0;
    const cityDevelopmentSynergy = Math.min(combined.ore, combined.grain, combined.wool) * 0.34 +
      Math.min(combined.ore, combined.grain) * 0.22;
    const synergyBonus = Math.min(2.8, roadSettlementSynergy + shipSynergy + cityDevelopmentSynergy);
    const hasSeaLaunch = isSeafarers(state.variant) && !isFogBoard(state.board) && pairVertices.some(vertexId =>
      vertices.get(vertexId)!.tileIds.some(tileId => {
        const terrain = tiles.get(tileId)!.terrain;
        return terrain === "sea" || terrain === "fog";
      }));
    const seaLaunchBonus = hasSeaLaunch ? 0.75 : 0;

    let pairPortBonus = 0;
    const seenGeneralPort = { value: false };
    const seenSpecialtyPorts = new Set<Resource>();
    for (const currentVertexId of pairVertices) {
      for (const port of state.board.ports) {
        const edge = revealedPortEdges.has(port.edgeId) ? edges.get(port.edgeId) : undefined;
        if (!edge || !edge.vertexIds.includes(currentVertexId)) continue;
        if (port.resource === "any") {
          if (!seenGeneralPort.value) {
            seenGeneralPort.value = true;
            pairPortBonus += 1.1 + Math.min(2.2, totalCombined / 12);
          }
        } else if (!seenSpecialtyPorts.has(port.resource)) {
          seenSpecialtyPorts.add(port.resource);
          const supply = combined[port.resource];
          pairPortBonus += supply >= 5 ? Math.min(4.8, supply * 0.45) : supply * 0.16;
        }
      }
    }

    const startingRoadBonus = secondResources.has("wood") && secondResources.has("brick") ? 0.9 : 0;
    const startingVarietyBonus = secondResources.size * 0.22;
    const pairBlocked = new Set(blockedVerticesSet);
    for (const currentVertexId of pairVertices) {
      pairBlocked.add(currentVertexId);
      for (const neighborId of adjacentVertexIds.get(currentVertexId) ?? []) pairBlocked.add(neighborId);
    }
    const expansion = setupExpansionPotential(firstVertexId, pairBlocked) +
      setupExpansionPotential(secondVertexId, pairBlocked);
    const islands = (islandBonus(firstVertexId) + islandBonus(secondVertexId)) * 10;

    return weightedYield + breadth + synergyBonus + seaLaunchBonus + pairPortBonus + startingRoadBonus +
      startingVarietyBonus + expansion + islands - missingCorePenalty - concentrationPenalty;
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

  const singleSetupScore = (vertexId: string): number =>
    vertexValue(vertexId) + islandBonus(vertexId) * 10 + coverageValue(vertexId) + setupExpansionPotential(vertexId);

  const ownExistingSettlementIds = state.board.vertices
    .filter(vertex => vertex.building?.playerId === playerId)
    .map(vertex => vertex.id);

  const bestSetupVertex = (locations: string[]): string | undefined => {
    if (locations.length <= 1) return locations[0];

    // Second setup settlement: directly maximize the combined two-settlement portfolio.
    if (ownExistingSettlementIds.length === 1 && !isFogBoard(state.board)) {
      const firstSettlementId = ownExistingSettlementIds[0]!;
      return locations.toSorted((first, second) =>
        evaluateSetupPair(firstSettlementId, second) - evaluateSetupPair(firstSettlementId, first))[0];
    }

    // First setup settlement on visible boards: anticipate snake-draft return pick.
    if (!isSecondSetup && state.phase.type === "setup-settlement" && !isFogBoard(state.board) && state.board.edges.length > 0) {
      const sortedCandidates = locations.toSorted((first, second) => singleSetupScore(second) - singleSetupScore(first));
      const topFirstCandidates = sortedCandidates.slice(0, state.setupIndex === state.players.length - 1 ? 12 : 8);

      // Last picker in round 1 places two settlements back-to-back with no intervening opponents.
      if (state.setupIndex === state.players.length - 1) {
        let bestFirst = topFirstCandidates[0]!;
        let bestPairScore = -Infinity;
        for (const firstCandidate of topFirstCandidates) {
          const forbidden = new Set<string>([firstCandidate, ...(adjacentVertexIds.get(firstCandidate) ?? [])]);
          for (const secondCandidate of topFirstCandidates) {
            if (forbidden.has(secondCandidate)) continue;
            const pairScore = evaluateSetupPair(firstCandidate, secondCandidate);
            if (pairScore > bestPairScore) {
              bestPairScore = pairScore;
              bestFirst = firstCandidate;
            }
          }
        }
        return bestFirst;
      }

      // Earlier seats simulate greedy opponent picks until their own second placement.
      const interveningOpponentPicks = (state.players.length - 1 - state.setupIndex) * 2;
      const opponentBaseScore = new Map(sortedCandidates.map(vertexId => [vertexId, singleSetupScore(vertexId)]));
      let bestFirst = topFirstCandidates[0]!;
      let bestLookaheadScore = -Infinity;
      for (const firstCandidate of topFirstCandidates) {
        const unavailable = new Set<string>([firstCandidate, ...(adjacentVertexIds.get(firstCandidate) ?? [])]);
        let simulatedPicks = 0;
        for (const opponentChoice of sortedCandidates) {
          if (simulatedPicks >= interveningOpponentPicks) break;
          if (unavailable.has(opponentChoice)) continue;
          unavailable.add(opponentChoice);
          for (const neighborId of adjacentVertexIds.get(opponentChoice) ?? []) unavailable.add(neighborId);
          simulatedPicks++;
        }
        let bestSecondScore = -Infinity;
        let checkedSecond = 0;
        for (const secondCandidate of sortedCandidates) {
          if (unavailable.has(secondCandidate)) continue;
          const pairScore = evaluateSetupPair(firstCandidate, secondCandidate);
          if (pairScore > bestSecondScore) bestSecondScore = pairScore;
          checkedSecond++;
          if (checkedSecond >= 10) break;
        }
        const combinedScore = bestSecondScore === -Infinity
          ? opponentBaseScore.get(firstCandidate)!
          : bestSecondScore + opponentBaseScore.get(firstCandidate)! * 0.12;
        if (combinedScore > bestLookaheadScore) {
          bestLookaheadScore = combinedScore;
          bestFirst = firstCandidate;
        }
      }
      return bestFirst;
    }

    return locations.toSorted((first, second) => singleSetupScore(second) - singleSetupScore(first))[0];
  };

  const planningState: GameState = { ...state, activePlayerId: playerId, phase: { type: "actions" } };
  const publicScores = new Map(state.players.map(other => [other.id, getPublicScore(state, other.id).public]));
  const effectiveScores = new Map(state.players.map(other => [
    other.id,
    publicScores.get(other.id)! + (other.id === playerId ? 0 : estimatedHiddenThreat(other.id)),
  ]));
  const highestOpponentScore = Math.max(0, ...opponents.map(other => publicScores.get(other.id)!));
  const highestOpponentEffectiveScore = Math.max(0, ...opponents.map(other => effectiveScores.get(other.id)!));
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
    const canPlaceMoreSettlements = settlementCount < 5;
    const destinationSet = new Set(roadBoard.vertices.filter(vertex => !vertex.building && !blocked.has(vertex.id) &&
      (canPlaceMoreSettlements
        ? (!isSeafarers(state.variant) || vertex.tileIds.some(id => isLand(tiles.get(id)!.terrain)) || explorationValue(vertex.id) > 0)
        : explorationValue(vertex.id) > 0))
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

  function settlementRoadSplitImpact(vertexId: string): { bonus: number; gainedPoints: number } {
    const vertex = vertices.get(vertexId)!;
    const opponentEdgeCounts = new Map<string, number>();
    for (const edgeId of vertex.edgeIds) {
      const edge = edges.get(edgeId)!;
      if (edge.playerId && edge.playerId !== playerId) {
        opponentEdgeCounts.set(edge.playerId, (opponentEdgeCounts.get(edge.playerId) ?? 0) + 1);
      }
    }
    const splitTargets = [...opponentEdgeCounts.entries()].filter(([, count]) => count >= 2).map(([ownerId]) => ownerId);
    if (splitTargets.length === 0) return { bonus: 0, gainedPoints: 0 };

    const nextState: GameState = {
      ...planningState,
      board: {
        ...state.board,
        vertices: state.board.vertices.map(candidate =>
          candidate.id === vertexId ? { ...candidate, building: { playerId, kind: "settlement" } } : candidate),
      },
    };
    const ownRouteLength = getLongestRoadLength(nextState, playerId);
    let bonus = 0;
    let gainedPoints = 0;
    for (const ownerId of splitTargets) {
      const beforeLength = getLongestRoadLength(planningState, ownerId);
      const afterLength = getLongestRoadLength(nextState, ownerId);
      const lengthDrop = Math.max(0, beforeLength - afterLength);
      if (lengthDrop === 0) continue;
      if (state.awards.longestRoad === ownerId) {
        const otherMaximum = Math.max(0, ...opponents.filter(other => other.id !== ownerId).map(other => getLongestRoadLength(nextState, other.id)));
        if (ownRouteLength >= 5 && ownRouteLength > Math.max(afterLength, otherMaximum)) {
          gainedPoints = 2;
          bonus += 24;
        } else if (afterLength < 5 || afterLength <= otherMaximum) {
          bonus += 16;
        } else {
          bonus += lengthDrop * 3;
        }
      } else if (beforeLength >= 4) {
        bonus += lengthDrop * 2.5;
      }
    }
    return { bonus, gainedPoints };
  }

  function buildTargets(cachedRoad?: RouteCandidate | null): BuildTarget[] {
    const targets: BuildTarget[] = [];
    const legalSettlements = legalSettlementVertices(planningState, playerId);
    const settlementCandidates = legalSettlements.map(vertexId => {
      const split = settlementRoadSplitImpact(vertexId);
      return {
        vertexId,
        splitBonus: split.bonus,
        splitGainedPoints: split.gainedPoints,
        rankScore: vertexValue(vertexId) + islandBonus(vertexId) * 12 + split.bonus,
      };
    });
    const bestSettlementCandidate = settlementCandidates.toSorted((first, second) => second.rankScore - first.rankScore)[0];
    const settlement = bestSettlementCandidate?.vertexId;
    const city = bestVertex(legalCityVertices(planningState, playerId), false);
    const road = cachedRoad !== undefined ? cachedRoad : bestRoad(planningState, true, true);
    const settlementSiteValue = bestSettlementCandidate?.rankScore ?? 0;

    if (bestSettlementCandidate) {
      const earlyExpansionBoost = settlementCount + cityCount <= 3 ? 3.5 : 0;
      const settlementPoints = 1 + islandBonus(bestSettlementCandidate.vertexId) + bestSettlementCandidate.splitGainedPoints;
      targets.push({
        action: { type: "place-settlement", vertexId: bestSettlementCandidate.vertexId },
        cost: COSTS.settlement,
        value: winsWith(settlementPoints)
          ? 10000
          : 19.5 + vertexValue(bestSettlementCandidate.vertexId) * 0.56 +
            islandBonus(bestSettlementCandidate.vertexId) * 12 + bestSettlementCandidate.splitBonus * 0.8 + earlyExpansionBoost,
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
      (deficit(activePlayer.resources, comboCost) === 0 || maritimeAffordable(comboCost)),
    );
    if (road && ((road.expansion && !settlement) || road.points > 0 || road.defendsLongestRoad || roadOpensMuchBetterSite)) {
      const comboWins = canComboRoadAndSettlement && winsWith(1 + road.destinationIslandBonus);
      const lateSpeculativePenalty = road.points === 0 && !road.defendsLongestRoad && !canComboRoadAndSettlement &&
        !road.revealsFog && road.destinationIslandBonus === 0 && settlementCount + cityCount >= 4 ? -3.0 : 0;
      targets.push({
        action: { type: road.kind === "ship" ? "place-ship" : "place-road", edgeId: road.edgeId },
        cost: COSTS[road.kind],
        value: (road.points > 0 && winsWith(road.points)) || comboWins
          ? 10000
          : Math.max(4, 8 + road.value * 1.15 + road.points * 9 + (road.defendsLongestRoad ? 14 : 0) +
            (road.revealsFog ? 4 : 0) + (canComboRoadAndSettlement ? 12 : 0) + lateSpeculativePenalty),
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
      const estimatedRemainingVictoryPoints = Math.max(0, remainingVictoryPointsInPool - totalOpponentUnplayedDevelopment * 0.25);
      const immediateVictoryPointChance = score === state.victoryPointsToWin - 1
        ? Math.min(1, estimatedRemainingVictoryPoints / state.developmentDeck.length)
        : 0;
      const winningDrawBonus = immediateVictoryPointChance * 28;
      let developmentValue = 4.4 + 2.6 * state.developmentDeck.length / 25 + 8.0 * urgency +
        armyBonus + armyDefenseBonus + engineReadyBonus + winningDrawBonus;
      // Avoid spending ore and grain on a speculative development card when 1 producible card away from a city.
      const almostFinishedCity = !responding && cityTarget !== null && cityCount < 3 &&
        deficit(activePlayer.resources, COSTS.city) === 1 &&
        !(armyDistance === 1 && winsWith(2)) &&
        immediateVictoryPointChance < 0.25 &&
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
    if (state.sabotageEnabled && hasLegalSabotageTarget(planningState, playerId)) {
      const sabotageChoice = bestSabotageTarget(planningState);
      const urgentLeader = highestOpponentScore >= state.victoryPointsToWin - 2;
      if (sabotageChoice && (sabotageChoice.value >= 12 || urgentLeader)) {
        targets.push({
          action: sabotageChoice.action,
          cost: COSTS.sabotage,
          value: sabotageChoice.value,
        });
      }
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

    // Track public inflows and outflows from the game log without reading private opponent hands.
    const trackedByOpponent = new Map<string, Resources>(opponents.map(other => [other.id, emptyResources()]));
    let lastRobberMoveIndex = -1;
    for (let index = state.log.length - 1; index >= 0; index--) {
      if (state.log[index]!.key === "{player} moves the robber.") {
        lastRobberMoveIndex = index;
        break;
      }
    }

    let setupComplete = false;
    let freeRoadsRemaining = 0;
    let freeRoadOwnerId: string | null = null;
    const subtractCost = (bucket: Resources, spent: Resources): void => {
      for (const resource of RESOURCES) {
        bucket[resource] = Math.max(0, bucket[resource] - spent[resource]);
      }
    };

    const logStart = Math.max(0, state.log.length - state.players.length * 16);
    if (logStart > 0) setupComplete = true;
    for (let index = logStart; index < state.log.length; index++) {
      const entry = state.log[index]!;
      const actorName = entry.parameters?.player;
      const actorId = typeof actorName === "string" ? playerNameToId.get(actorName) : undefined;
      if (entry.key === "{player} begins a turn.") {
        setupComplete = true;
        freeRoadsRemaining = 0;
        freeRoadOwnerId = null;
        continue;
      }
      if (entry.key === "{player} rolls {first} + {second} = {total}.") {
        setupComplete = true;
        const total = entry.parameters?.total;
        if (typeof total !== "number" || total === 7) continue;
        for (const bucket of trackedByOpponent.values()) {
          for (const resource of RESOURCES) bucket[resource] *= 0.92;
        }
        const respectCurrentRobber = index > lastRobberMoveIndex;
        for (const tile of state.board.tiles) {
          if (tile.number !== total || !isResource(tile.terrain)) continue;
          if (respectCurrentRobber && tile.id === state.robberTileId) continue;
          for (const vertexId of tile.vertexIds) {
            const building = vertices.get(vertexId)!.building;
            if (!building || building.playerId === playerId) continue;
            const bucket = trackedByOpponent.get(building.playerId);
            if (bucket) bucket[tile.terrain] += building.kind === "city" ? 2 : 1;
          }
        }
        continue;
      }
      if (!actorId || actorId === playerId) continue;
      const bucket = trackedByOpponent.get(actorId);
      if (!bucket) continue;

      if (entry.key === "{player} plays {kind}.") {
        if (entry.parameters?.kind === "road-building") {
          freeRoadsRemaining = 2;
          freeRoadOwnerId = actorId;
        }
      } else if (setupComplete && entry.key === "{player} builds a settlement.") {
        subtractCost(bucket, COSTS.settlement);
      } else if (entry.key === "{player} upgrades a settlement to a city.") {
        subtractCost(bucket, COSTS.city);
      } else if (setupComplete && entry.key === "{player} builds a road.") {
        if (freeRoadOwnerId === actorId && freeRoadsRemaining > 0) freeRoadsRemaining--;
        else subtractCost(bucket, COSTS.road);
      } else if (setupComplete && entry.key === "{player} builds a ship.") {
        if (freeRoadOwnerId === actorId && freeRoadsRemaining > 0) freeRoadsRemaining--;
        else subtractCost(bucket, COSTS.ship);
      } else if (entry.key === "{player} buys a development card.") {
        subtractCost(bucket, COSTS.development);
      } else if (entry.key === "{player} destroys {victim}'s road." ||
        entry.key === "{player} destroys {victim}'s ship." ||
        entry.key === "{player} destroys {victim}'s settlement." ||
        entry.key === "{player} reduces {victim}'s city to a settlement.") {
        subtractCost(bucket, COSTS.sabotage);
      } else if (entry.key === "{player} trades {ratio} {give} for one {receive} with the bank.") {
        const ratio = entry.parameters?.ratio;
        const give = entry.parameters?.give;
        const receive = entry.parameters?.receive;
        if (typeof ratio === "number" && typeof give === "string" && RESOURCES.includes(give as Resource)) {
          const giveResource = give as Resource;
          bucket[giveResource] = Math.max(0, bucket[giveResource] - ratio);
        }
        if (typeof receive === "string" && RESOURCES.includes(receive as Resource)) {
          bucket[receive as Resource] += 1;
        }
      } else if (entry.key === "{player} discards {count} resource cards.") {
        const count = entry.parameters?.count;
        const trackedTotal = resourceTotal(bucket);
        if (typeof count === "number" && trackedTotal > 0) {
          const keepFraction = Math.max(0.2, (trackedTotal - count) / trackedTotal);
          for (const resource of RESOURCES) bucket[resource] *= keepFraction;
        }
      }
    }

    // Apply the most recent public Monopoly event if any occurred.
    const latestMonopoly = state.monopolies.at(-1);
    if (latestMonopoly) {
      for (const other of opponents) {
        const bucket = trackedByOpponent.get(other.id)!;
        if (other.id === latestMonopoly.playerId) {
          const gained = Object.values(latestMonopoly.losses).reduce((sum, count) => sum + count, 0);
          bucket[latestMonopoly.resource] += gained * 0.5;
        } else if (latestMonopoly.losses[other.id]) {
          bucket[latestMonopoly.resource] *= 0.2;
        }
      }
    }

    const estimated: Record<string, Resources> = {};
    for (const other of opponents) {
      const cardCount = resourceTotal(other.resources);
      const result = emptyResources();
      if (cardCount > 0) {
        const baseline = opponentProduction.get(other.id)!;
        const tracked = trackedByOpponent.get(other.id)!;
        const baselineTotal = resourceTotal(baseline);
        const trackedTotal = resourceTotal(tracked);
        const combined = emptyResources();
        for (const resource of RESOURCES) {
          const baselineShare = baselineTotal > 0 ? baseline[resource] / baselineTotal : 1 / RESOURCES.length;
          const trackedShare = trackedTotal > 0 ? tracked[resource] / trackedTotal : baselineShare;
          combined[resource] = trackedTotal > 0 ? baselineShare * 0.3 + trackedShare * 0.7 : baselineShare;
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
        const opponentScore = effectiveScores.get(building.playerId)!;
        const isLeader = opponentScore >= highestOpponentEffectiveScore - 0.01 && opponentScore >= 3;
        const contenderMultiplier = opponentScore >= state.victoryPointsToWin - 1 ? 3.2
          : opponentScore >= state.victoryPointsToWin - 2 ? 2.2
          : isLeader ? 1.4 : 1.0;
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
        const opponentScore = effectiveScores.get(ownerId)!;
        const isLeader = opponentScore >= highestOpponentEffectiveScore - 0.01 && opponentScore >= 3;
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

    const legalTiles = legalRobberOrPirateTiles(state).map(tileId => tiles.get(tileId)!);
    const bestLandTile = legalTiles.filter(tile => tile.terrain !== "sea")
      .toSorted((first, second) => tileValue(second) - tileValue(first))[0];
    const currentRobberTile = tiles.get(state.robberTileId);
    const unblockValue = (currentRobberTile?.vertexIds ?? []).reduce((total, vertexId) => {
      const building = vertices.get(vertexId)!.building;
      const number = currentRobberTile!.number;
      return total + (building?.playerId === playerId && number !== null
        ? 5.0 * pipCount(number) * (building.kind === "city" ? 2 : 1) : 0);
    }, 0);

    const bestPirateTile = legalTiles.filter(tile => tile.terrain === "sea")
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

    if (!bestLandTile) {
      if (bestPirateTile) return { action: { type: "move-pirate", tileId: bestPirateTile.tile.id }, value: bestPirateTile.value };
      return { action: { type: "move-pirate", tileId: null }, value: 0 };
    }
    if (bestPirateTile && bestPirateTile.value > tileValue(bestLandTile) + unblockValue) {
      return { action: { type: "move-pirate", tileId: bestPirateTile.tile.id }, value: bestPirateTile.value };
    }
    return { action: { type: "move-robber", tileId: bestLandTile.id }, value: tileValue(bestLandTile) + unblockValue };
  }

  function bestSabotageTarget(sabotageState: GameState): { action: GameAction; value: number } | null {
    const ownRouteLength = getLongestRoadLength(sabotageState, playerId);
    const opponentRouteLengths = new Map(opponents.map(other => [other.id, getLongestRoadLength(sabotageState, other.id)]));
    const contenderMultiplier = (ownerId: string): number => {
      const opponentScore = effectiveScores.get(ownerId) ?? 0;
      const isLeader = opponentScore >= highestOpponentEffectiveScore - 0.01 && opponentScore >= 3;
      return opponentScore >= state.victoryPointsToWin - 1 ? 3.0
        : opponentScore >= state.victoryPointsToWin - 2 ? 2.0
        : isLeader ? 1.4 : 1.0;
    };

    let bestChoice: { action: GameAction; value: number } | null = null;
    for (const vertexId of legalSabotageVertices(sabotageState, playerId)) {
      const vertex = vertices.get(vertexId)!;
      const building = vertex.building!;
      const pips = vertex.tileIds.reduce((total, tileId) => {
        const tile = tiles.get(tileId)!;
        if (tile.number === null) return total;
        return total + (isResource(tile.terrain) ? pipCount(tile.number) : tile.terrain === "gold" ? pipCount(tile.number) * 2.2 : 0);
      }, 0);
      let routeBonus = 0;
      if (building.kind === "settlement") {
        const nextState: GameState = {
          ...sabotageState,
          board: {
            ...sabotageState.board,
            vertices: sabotageState.board.vertices.map(candidate =>
              candidate.id === vertexId ? { ...candidate, building: null } : candidate),
          },
        };
        const nextOwnRoute = getLongestRoadLength(nextState, playerId);
        const maximumOpponentRoute = Math.max(0, ...opponents.map(other => getLongestRoadLength(nextState, other.id)));
        if (state.awards.longestRoad !== playerId && nextOwnRoute >= 5 && nextOwnRoute > maximumOpponentRoute) {
          routeBonus = winsWith(2) ? 10000 : 28;
        }
      }
      const value = routeBonus === 10000
        ? 10000
        : (12 + pips * 1.4 + (building.kind === "city" ? 3 : 0)) * contenderMultiplier(building.playerId) + routeBonus;
      if (!bestChoice || value > bestChoice.value) {
        bestChoice = { action: { type: "sabotage-building", vertexId }, value };
      }
    }

    for (const edgeId of legalSabotageEdges(sabotageState, playerId)) {
      const edge = edges.get(edgeId)!;
      const ownerId = edge.playerId!;
      const nextState: GameState = {
        ...sabotageState,
        board: {
          ...sabotageState.board,
          edges: sabotageState.board.edges.map(candidate =>
            candidate.id === edgeId ? { ...candidate, playerId: null, kind: undefined } : candidate),
        },
      };
      const previousLength = opponentRouteLengths.get(ownerId) ?? 0;
      const nextLength = getLongestRoadLength(nextState, ownerId);
      const lengthDrop = Math.max(0, previousLength - nextLength);
      const otherMaximum = Math.max(0, ...opponents.filter(other => other.id !== ownerId).map(other => opponentRouteLengths.get(other.id) ?? 0));
      let awardBonus = 0;
      if (state.awards.longestRoad === ownerId) {
        if (ownRouteLength >= 5 && ownRouteLength > Math.max(nextLength, otherMaximum)) {
          awardBonus = winsWith(2) ? 10000 : 34;
        } else if (nextLength < 5 || nextLength <= otherMaximum) {
          awardBonus = 24;
        }
      }
      const value = awardBonus === 10000
        ? 10000
        : (3 + lengthDrop * 4.5 + awardBonus) * contenderMultiplier(ownerId);
      if (!bestChoice || value > bestChoice.value) {
        bestChoice = { action: { type: "sabotage-route", edgeId }, value };
      }
    }

    return bestChoice;
  }

  function applyMaritimeTrades(
    inventory: Resources,
    bankInventory: Resources,
    ratios: Resources,
    cost: Resources,
  ): { hand: Resources; bank: Resources; firstTrade: { give: Resource; receive: Resource } | null } | null {
    const workingHand = { ...inventory };
    const workingBank = { ...bankInventory };
    let firstTrade: { give: Resource; receive: Resource } | null = null;
    for (let step = 0; step < 8; step++) {
      const missingResources = RESOURCES.filter(resource => workingHand[resource] < cost[resource]);
      if (missingResources.length === 0) return { hand: workingHand, bank: workingBank, firstTrade };
      if (missingResources.some(resource => workingBank[resource] <= 0)) return null;
      const receive = missingResources.toSorted((first, second) =>
        ((cost[second] - workingHand[second]) / (1 + production[second])) -
        ((cost[first] - workingHand[first]) / (1 + production[first])))[0]!;
      const giveCandidates = RESOURCES.filter(resource =>
        resource !== receive && workingHand[resource] - cost[resource] >= ratios[resource]);
      if (giveCandidates.length === 0) return null;
      const give = giveCandidates.toSorted((first, second) =>
        ratios[first] - ratios[second] ||
        ((workingHand[second] - cost[second]) / ratios[second]) - ((workingHand[first] - cost[first]) / ratios[first]) ||
        production[second] - production[first])[0]!;
      workingHand[give] -= ratios[give];
      workingBank[give] += ratios[give];
      workingBank[receive] -= 1;
      workingHand[receive] += 1;
      firstTrade ??= { give, receive };
    }
    return null;
  }

  type SimulationNode = {
    board: GameState["board"];
    hand: Resources;
    bank: Resources;
    deckRemaining: number;
    awards: GameState["awards"];
    boughtDevelopment: number;
    accumulatedDevelopmentValue: number;
    accumulatedSabotageValue: number;
    accumulatedRoadSplitBonus: number;
    accumulatedFogBonus: number;
    firstAction: GameAction | null;
  };

  function recomputeNodeLongestRoad(nodeState: GameState): string | null {
    const lengths = nodeState.players.map(candidate => ({
      id: candidate.id,
      length: getLongestRoadLength(nodeState, candidate.id),
    }));
    const maximum = Math.max(...lengths.map(entry => entry.length));
    const leaders = lengths.filter(entry => entry.length === maximum && entry.length >= 5);
    const previous = nodeState.awards.longestRoad;
    return leaders.some(entry => entry.id === previous)
      ? previous
      : leaders.length === 1 ? leaders[0]!.id : null;
  }

  function simulateNodeState(node: SimulationNode): GameState {
    return {
      ...planningState,
      board: node.board,
      bank: node.bank,
      awards: node.awards,
    };
  }

  const initialMaximumOpponentRouteLength = Math.max(0, ...opponents.map(other => getLongestRoadLength(planningState, other.id)));

  function evaluateTurnEndNode(
    node: SimulationNode,
    depth: number,
    opponentRoutesChanged: boolean,
    cachedRootRoute?: RouteCandidate | null,
  ): number {
    const nodeState = simulateNodeState(node);
    const nodeScore = getScore(nodeState, playerId).total;
    if (nodeScore >= state.victoryPointsToWin) {
      return 1_000_000 - depth * 10 + resourceTotal(node.hand) * 0.5;
    }

    const nodeRatios = Object.fromEntries(
      RESOURCES.map(resource => [resource, getTradeRatio(nodeState, playerId, resource)]),
    ) as Resources;
    const nodeProduction = emptyResources();
    const nodeNumbers = new Map<number, number>();
    let nodeSettlements = 0;
    let nodeCities = 0;
    let weightedProduction = 0;

    for (const vertex of node.board.vertices) {
      if (vertex.building?.playerId !== playerId) continue;
      const multiplier = vertex.building.kind === "city" ? 2 : 1;
      if (vertex.building.kind === "city") nodeCities++;
      else nodeSettlements++;
      for (const tileId of vertex.tileIds) {
        const tile = tiles.get(tileId)!;
        if (tile.number === null || tile.terrain === "desert" || tile.terrain === "sea" || tile.terrain === "fog") continue;
        const pips = pipCount(tile.number) * multiplier;
        const terrainWeight = PIP_MULTIPLIER_BY_TERRAIN[tile.terrain] *
          (isResource(tile.terrain) ? scarcityWeight[tile.terrain] : 1);
        const existingResource = isResource(tile.terrain) ? nodeProduction[tile.terrain] : 0;
        const balanceDivisor = isResource(tile.terrain) && nodeRatios[tile.terrain] === 2 ? 16 : 7.5;
        const balanceFactor = isResource(tile.terrain) ? 1 / (1 + existingResource / balanceDivisor) : 1;
        const numberFactor = 1 / (1 + (nodeNumbers.get(tile.number) ?? 0) / 18);
        weightedProduction += pips * terrainWeight * balanceFactor * numberFactor;
        nodeNumbers.set(tile.number, (nodeNumbers.get(tile.number) ?? 0) + pips);
        if (isResource(tile.terrain)) nodeProduction[tile.terrain] += pips;
        else if (tile.terrain === "gold") {
          for (const resource of RESOURCES) nodeProduction[resource] += pips / RESOURCES.length;
        }
      }
    }

    const totalNodeProduction = resourceTotal(nodeProduction);
    let portScore = 0;
    if (RESOURCES.every(resource => nodeRatios[resource] <= 3)) {
      portScore += 1.6 + Math.min(2.2, totalNodeProduction / 11);
    }
    for (const resource of RESOURCES) {
      if (nodeRatios[resource] === 2) {
        portScore += Math.min(5.5, nodeProduction[resource] * 0.55);
      }
    }

    const productionMultiplier = nodeScore <= 5 ? 1.45 : nodeScore <= 7 ? 1.25 : 0.95;
    const earlyCityBonus = nodeCities >= 1 ? 2.5 : 0;
    const scorePoints = nodeScore * 26 + (weightedProduction + portScore) * productionMultiplier + earlyCityBonus;

    // Evaluate route positioning: open settlement readiness, island/fog sea lanes, and Longest Road defense.
    const legalNodeSettlements = legalSettlementVertices(nodeState, playerId);
    const bestOpenSettlement = legalNodeSettlements.length > 0
      ? legalNodeSettlements.toSorted((first, second) =>
        (vertexValue(second) + islandBonusOnBoard(node.board, second) * 14) -
        (vertexValue(first) + islandBonusOnBoard(node.board, first) * 14))[0]
      : undefined;
    let routeValue = 0;
    const expansionBuildingCap = isSeafarers(state.variant) ? 5 : 3;
    const expansionMultiplier = nodeSettlements + nodeCities <= expansionBuildingCap ? 1.15 : 0.85;
    if (bestOpenSettlement) {
      const openIslandPoints = islandBonusOnBoard(node.board, bestOpenSettlement);
      const openValue = vertexValue(bestOpenSettlement);
      const islandMultiplier = openIslandPoints > 0 ? 1.15 : expansionMultiplier;
      routeValue = (14 + openValue * 0.85 + openIslandPoints * 22) / 1.5 * islandMultiplier;
    }
    const openAlreadyHasIsland = bestOpenSettlement !== undefined && islandBonusOnBoard(node.board, bestOpenSettlement) > 0;
    if (nodeSettlements < 5 && (!bestOpenSettlement || (isSeafarers(state.variant) && !openAlreadyHasIsland))) {
      const nextRoute = node.board === state.board && cachedRootRoute !== undefined
        ? cachedRootRoute
        : bestRoad(nodeState, false, false);
      if (nextRoute && nextRoute.expansion) {
        const hasIslandGoal = nextRoute.destinationIslandBonus > 0;
        const baseDestinationValue = Math.max(0, nextRoute.destinationValue - nextRoute.destinationIslandBonus * 12);
        const sitePotential = 14 + baseDestinationValue * 0.85 + nextRoute.destinationIslandBonus * 26;
        const routeMultiplier = hasIslandGoal || nextRoute.revealsFog ? 1.15 : expansionMultiplier;
        const candidateRouteValue = sitePotential / (nextRoute.distance + 1.5) * routeMultiplier;
        if (!bestOpenSettlement) {
          routeValue = candidateRouteValue;
        } else if (hasIslandGoal || nextRoute.revealsFog) {
          routeValue += candidateRouteValue * 0.65;
        }
      }
    }
    if (node.awards.longestRoad === playerId) {
      const ownLength = getLongestRoadLength(nodeState, playerId);
      const maximumOpponentLength = opponentRoutesChanged
        ? Math.max(0, ...opponents.map(other => getLongestRoadLength(nodeState, other.id)))
        : initialMaximumOpponentRouteLength;
      if (maximumOpponentLength >= Math.max(4, ownLength - 1)) {
        routeValue += Math.min(2, ownLength - maximumOpponentLength) * 5.0;
      }
    }

    // Evaluate remaining hand progress toward the best future build (always discounted below building now).
    const handSize = resourceTotal(node.hand);
    const futureCandidates: { cost: Resources; worth: number }[] = [];
    const legalNodeCities = legalCityVertices(nodeState, playerId);
    const bestFutureCity = legalNodeCities.length > 0 ? bestVertex(legalNodeCities, false) : undefined;
    if (bestFutureCity) {
      futureCandidates.push({
        cost: COSTS.city,
        worth: 26 + cityValue(bestFutureCity) * productionMultiplier * 0.85 + (nodeSettlements >= 5 ? 8 : 0) + (nodeCities === 0 ? 2.5 : 0),
      });
    }
    if (bestOpenSettlement) {
      futureCandidates.push({
        cost: COSTS.settlement,
        worth: 26 * (1 + islandBonusOnBoard(node.board, bestOpenSettlement)) + vertexValue(bestOpenSettlement) * productionMultiplier * 0.75,
      });
    }
    if (node.deckRemaining > 0) {
      futureCandidates.push({
        cost: COSTS.development,
        worth: 11 + (nodeScore >= state.victoryPointsToWin - 2 ? 5 : 0),
      });
    }

    let bestHandProgress = 0;
    for (const candidate of futureCandidates) {
      const missingCount = deficit(node.hand, candidate.cost);
      let waitRounds: number;
      if (missingCount === 0) {
        // Ending the turn without building delays value by at least one full round.
        waitRounds = 1.6;
      } else {
        const tradePlan = applyMaritimeTrades(node.hand, node.bank, nodeRatios, candidate.cost);
        if (tradePlan) {
          const cardsSpent = handSize - resourceTotal(tradePlan.hand) + missingCount;
          waitRounds = 1.6 + cardsSpent / 8;
        } else {
          waitRounds = 0.8 + missingCount * 0.5 + Math.max(...RESOURCES.map(resource =>
            Math.max(0, candidate.cost[resource] - node.hand[resource]) * 36 /
            ((0.35 + nodeProduction[resource]) * state.players.length)));
        }
      }
      const progressValue = candidate.worth * 0.62 / (1 + waitRounds * 0.42);
      if (progressValue > bestHandProgress) bestHandProgress = progressValue;
    }

    const sevenProbabilityBeforeNextTurn = 1 - Math.pow(5 / 6, Math.max(1, state.players.length - 1));
    const discardRiskPenalty = handSize > 7
      ? sevenProbabilityBeforeNextTurn * Math.floor(handSize / 2) * 5.2
      : 0;
    const rawCardValue = handSize * 0.85;

    return scorePoints + routeValue + node.accumulatedDevelopmentValue + node.accumulatedSabotageValue +
      node.accumulatedRoadSplitBonus + node.accumulatedFogBonus + bestHandProgress + rawCardValue - discardRiskPenalty;
  }

  function developmentCardScore(node: SimulationNode): number {
    const nodeState = simulateNodeState(node);
    const nodeScore = getScore(nodeState, playerId).total;
    const urgency = Math.max(0, 1 - (state.victoryPointsToWin - nodeScore) / 6);
    const unplayedKnights = activePlayer.developmentCards.filter(card => card.kind === "knight").length;
    const largestArmyThreshold = Math.max(3, highestOpponentKnights + 1);
    const armyDistance = node.awards.largestArmy === playerId
      ? Infinity
      : largestArmyThreshold - (knightsPlayed + unplayedKnights);
    const armyBonus = armyDistance === 1 ? (nodeScore + 2 >= state.victoryPointsToWin ? 14 : 8.5)
      : armyDistance === 2 ? 3.5
      : node.awards.largestArmy === null && state.turnNumber >= 10 ? 2.5 : 0;
    const armyDefenseBonus = node.awards.largestArmy === playerId && highestOpponentKnights >= Math.max(2, knightsPlayed - 1)
      ? 6.0 : 0;
    const engineReadyBonus = cityCount >= 2 ? 3.5
      : cityCount >= 1 || (production.ore >= 4 && production.grain >= 4 && production.wool >= 3) ? 2.4 : 0;
    const estimatedRemainingVictoryPoints = Math.max(0, remainingVictoryPointsInPool - totalOpponentUnplayedDevelopment * 0.25);
    const immediateVictoryPointChance = nodeScore === state.victoryPointsToWin - 1 && node.deckRemaining > 0
      ? Math.min(1, estimatedRemainingVictoryPoints / node.deckRemaining)
      : 0;
    const baseValue = 5.0 + 2.6 * node.deckRemaining / 25 + 8.0 * urgency +
      armyBonus + armyDefenseBonus + engineReadyBonus + immediateVictoryPointChance * 28;
    const stageScale = nodeScore >= state.victoryPointsToWin - 3 || armyDistance === 1
      ? 0.88
      : cityCount >= 1 ? 0.8 : 0.74;
    const repeatDiscount = Math.pow(0.84, node.boughtDevelopment);
    return baseValue * stageScale * repeatDiscount;
  }

  function payCost(inventory: Resources, bankInventory: Resources, cost: Resources): { hand: Resources; bank: Resources } {
    const nextHand = { ...inventory };
    const nextBank = { ...bankInventory };
    for (const resource of RESOURCES) {
      nextHand[resource] -= cost[resource];
      nextBank[resource] += cost[resource];
    }
    return { hand: nextHand, bank: nextBank };
  }

  function searchTurnPlan(
    initialNode: SimulationNode,
    maximumDepth: number,
    winsOnly: boolean,
    cachedRootRoute?: RouteCandidate | null,
  ): { action: GameAction | null; score: number } {
    let bestAction: GameAction | null = null;
    let bestScore = winsOnly ? -Infinity : evaluateTurnEndNode(initialNode, 0, false, cachedRootRoute);

    const explore = (node: SimulationNode, depth: number, opponentRoutesChanged: boolean): void => {
      if (depth > 0) {
        const nodeScore = evaluateTurnEndNode(node, depth, opponentRoutesChanged, cachedRootRoute);
        if (nodeScore > bestScore) {
          bestScore = nodeScore;
          bestAction = node.firstAction;
        }
        if (nodeScore >= 900_000 || depth >= maximumDepth) return;
      } else {
        const initialScore = getScore(simulateNodeState(node), playerId).total;
        if (initialScore >= state.victoryPointsToWin) {
          bestScore = 1_000_000;
          bestAction = node.firstAction;
          return;
        }
        if (depth >= maximumDepth) return;
      }

      const nodeState = simulateNodeState(node);
      const nodeRatios = Object.fromEntries(
        RESOURCES.map(resource => [resource, getTradeRatio(nodeState, playerId, resource)]),
      ) as Resources;
      const tryAction = (
        action: GameAction,
        cost: Resources,
        changesOpponentRoutes: boolean,
        applyEffect: (nextHand: Resources, nextBank: Resources, firstAction: GameAction) => SimulationNode,
      ): void => {
        const direct = deficit(node.hand, cost) === 0;
        let workingHand = node.hand;
        let workingBank = node.bank;
        let emittedFirstAction = node.firstAction ?? action;
        if (!direct) {
          const tradePlan = applyMaritimeTrades(node.hand, node.bank, nodeRatios, cost);
          if (!tradePlan || !tradePlan.firstTrade) return;
          workingHand = tradePlan.hand;
          workingBank = tradePlan.bank;
          emittedFirstAction = node.firstAction ?? {
            type: "bank-trade",
            give: tradePlan.firstTrade.give,
            receive: tradePlan.firstTrade.receive,
          };
        }
        const paid = payCost(workingHand, workingBank, cost);
        explore(applyEffect(paid.hand, paid.bank, emittedFirstAction), depth + 1, opponentRoutesChanged || changesOpponentRoutes);
      };

      const cityVertex = bestVertex(legalCityVertices(nodeState, playerId), false);
      if (cityVertex) {
        tryAction({ type: "place-city", vertexId: cityVertex }, COSTS.city, false, (nextHand, nextBank, firstAction) => ({
          ...node,
          board: {
            ...node.board,
            vertices: node.board.vertices.map(vertex =>
              vertex.id === cityVertex ? { ...vertex, building: { playerId, kind: "city" } } : vertex),
          },
          hand: nextHand,
          bank: nextBank,
          firstAction,
        }));
      }

      const legalSettlements = legalSettlementVertices(nodeState, playerId);
      if (legalSettlements.length > 0) {
        const chosenSettlement = legalSettlements
          .map(vertexId => ({
            vertexId,
            split: settlementRoadSplitImpact(vertexId),
            rank: vertexValue(vertexId) + islandBonusOnBoard(node.board, vertexId) * 14,
          }))
          .toSorted((first, second) => (second.rank + second.split.bonus) - (first.rank + first.split.bonus))[0]!;
        tryAction(
          { type: "place-settlement", vertexId: chosenSettlement.vertexId },
          COSTS.settlement,
          chosenSettlement.split.bonus > 0,
          (nextHand, nextBank, firstAction) => {
            const nextBoard = {
              ...node.board,
              vertices: node.board.vertices.map(vertex =>
                vertex.id === chosenSettlement.vertexId
                  ? { ...vertex, building: { playerId, kind: "settlement" as const } }
                  : vertex),
            };
            const nextState = { ...nodeState, board: nextBoard };
            return {
              ...node,
              board: nextBoard,
              hand: nextHand,
              bank: nextBank,
              awards: {
                ...node.awards,
                longestRoad: chosenSettlement.split.bonus > 0 ? recomputeNodeLongestRoad(nextState) : node.awards.longestRoad,
              },
              accumulatedRoadSplitBonus: node.accumulatedRoadSplitBonus + chosenSettlement.split.bonus * 0.5,
              firstAction,
            };
          },
        );
      }

      const routeCandidate = depth === 0 && node.board === state.board && cachedRootRoute !== undefined
        ? cachedRootRoute
        : bestRoad(nodeState, true, depth === 0);
      const shouldConsiderRoute = routeCandidate !== null && (
        routeCandidate.points > 0 ||
        routeCandidate.defendsLongestRoad ||
        routeCandidate.revealsFog ||
        routeCandidate.destinationIslandBonus > 0 ||
        (routeCandidate.expansion && (legalSettlements.length === 0 || routeCandidate.distance <= 2)) ||
        (!winsOnly && depth === 0 && resourceTotal(node.hand) > 7 && routeCandidate.expansion)
      );
      if (shouldConsiderRoute && routeCandidate) {
        const routeAction: GameAction = {
          type: routeCandidate.kind === "ship" ? "place-ship" : "place-road",
          edgeId: routeCandidate.edgeId,
        };
        tryAction(routeAction, COSTS[routeCandidate.kind], false, (nextHand, nextBank, firstAction) => {
          const nextBoard = {
            ...node.board,
            edges: node.board.edges.map(edge =>
              edge.id === routeCandidate.edgeId ? { ...edge, playerId, kind: routeCandidate.kind } : edge),
          };
          const nextState = { ...nodeState, board: nextBoard };
          return {
            ...node,
            board: nextBoard,
            hand: nextHand,
            bank: nextBank,
            awards: { ...node.awards, longestRoad: recomputeNodeLongestRoad(nextState) },
            accumulatedFogBonus: node.accumulatedFogBonus + (routeCandidate.revealsFog ? 5.5 : 0),
            firstAction,
          };
        });
      }

      if (!winsOnly && node.deckRemaining > 0) {
        const developmentMarginalValue = developmentCardScore(node);
        // Protect a nearly complete city when we produce the missing card and aren't chasing an immediate win.
        const protectsNearCity = cityVertex !== undefined && cityCount < 3 &&
          deficit(node.hand, COSTS.city) === 1 &&
          score < state.victoryPointsToWin - 1 &&
          resourceTotal(node.hand) <= 7 &&
          ((node.hand.ore < COSTS.city.ore && production.ore >= 3) ||
            (node.hand.grain < COSTS.city.grain && production.grain >= 3));
        if (!protectsNearCity) {
          tryAction({ type: "buy-development" }, COSTS.development, false, (nextHand, nextBank, firstAction) => ({
            ...node,
            hand: nextHand,
            bank: nextBank,
            deckRemaining: node.deckRemaining - 1,
            boughtDevelopment: node.boughtDevelopment + 1,
            accumulatedDevelopmentValue: node.accumulatedDevelopmentValue + developmentMarginalValue,
            firstAction,
          }));
        }
      }

      if (state.sabotageEnabled && depth === 0 && hasLegalSabotageTarget(nodeState, playerId)) {
        const sabotageChoice = bestSabotageTarget(nodeState);
        const highestOpponentSabotages = Math.max(0, ...opponents.map(other => other.sabotagesPlayed));
        const claimsMasterSaboteur = node.awards.masterSaboteur !== playerId &&
          activePlayer.sabotagesPlayed + 1 >= 3 && activePlayer.sabotagesPlayed + 1 > highestOpponentSabotages;
        const urgentLeader = highestOpponentEffectiveScore >= state.victoryPointsToWin - 2;
        if (sabotageChoice && (sabotageChoice.value >= 12 || urgentLeader || claimsMasterSaboteur || sabotageChoice.value === 10000)) {
          tryAction(sabotageChoice.action, COSTS.sabotage, true, (nextHand, nextBank, firstAction) => {
            const nextBoard = match(sabotageChoice.action)
              .with({ type: "sabotage-route" }, sabotageAction => ({
                ...node.board,
                edges: node.board.edges.map(edge =>
                  edge.id === sabotageAction.edgeId ? { ...edge, playerId: null, kind: undefined } : edge),
              }))
              .with({ type: "sabotage-building" }, sabotageAction => ({
                ...node.board,
                vertices: node.board.vertices.map(vertex =>
                  vertex.id === sabotageAction.vertexId
                    ? {
                      ...vertex,
                      building: vertex.building?.kind === "city"
                        ? { ...vertex.building, kind: "settlement" as const }
                        : null,
                    }
                    : vertex),
              }))
              .otherwise(() => node.board);
            const nextState = { ...nodeState, board: nextBoard };
            return {
              ...node,
              board: nextBoard,
              hand: nextHand,
              bank: nextBank,
              awards: {
                ...node.awards,
                longestRoad: recomputeNodeLongestRoad(nextState),
                ...(claimsMasterSaboteur ? { masterSaboteur: playerId } : {}),
              },
              accumulatedSabotageValue: node.accumulatedSabotageValue + Math.min(35, sabotageChoice.value * 0.75),
              firstAction,
            };
          });
        }
      }
    };

    explore(initialNode, 0, false);
    return { action: bestAction, score: bestScore };
  }

  function findImmediateWinningAction(): GameAction | null {
    const rootNode: SimulationNode = {
      board: state.board,
      hand: { ...activePlayer.resources },
      bank: { ...state.bank },
      deckRemaining: state.developmentDeck.length,
      awards: { ...state.awards },
      boughtDevelopment: 0,
      accumulatedDevelopmentValue: 0,
      accumulatedSabotageValue: 0,
      accumulatedRoadSplitBonus: 0,
      accumulatedFogBonus: 0,
      firstAction: null,
    };

    // Only run multi-action winning search when close enough to win this turn.
    if (score >= state.victoryPointsToWin - 4) {
      const directWin = searchTurnPlan(rootNode, 3, true);
      if (directWin.score >= 900_000 && directWin.action) return directWin.action;
    }

    if (state.developmentPlayed || score < state.victoryPointsToWin - 4) return null;

    // Check if playing a mature Knight (claiming Largest Army) + remaining builds wins immediately.
    const matureKnight = activePlayer.developmentCards.find(card => card.kind === "knight" && card.purchasedTurn < state.turnNumber);
    if (matureKnight && state.awards.largestArmy !== playerId &&
      activePlayer.knightsPlayed + 1 >= 3 && activePlayer.knightsPlayed + 1 > highestOpponentKnights) {
      const knightWin = searchTurnPlan({ ...rootNode, awards: { ...rootNode.awards, largestArmy: playerId } }, 2, true);
      if (knightWin.score >= 900_000) return { type: "play-development", cardId: matureKnight.id };
    }

    // Check if playing a mature Road Building + remaining builds wins immediately.
    const matureRoadBuilding = activePlayer.developmentCards.find(card => card.kind === "road-building" && card.purchasedTurn < state.turnNumber);
    if (matureRoadBuilding) {
      const firstRoad = bestRoad(planningState, true, true);
      if (firstRoad) {
        const boardAfterFirst = {
          ...state.board,
          edges: state.board.edges.map(edge =>
            edge.id === firstRoad.edgeId ? { ...edge, playerId, kind: firstRoad.kind } : edge),
        };
        const stateAfterFirst = { ...planningState, board: boardAfterFirst };
        const secondRoad = bestRoad(stateAfterFirst, true, false);
        const boardAfterSecond = secondRoad
          ? {
            ...boardAfterFirst,
            edges: boardAfterFirst.edges.map(edge =>
              edge.id === secondRoad.edgeId ? { ...edge, playerId, kind: secondRoad.kind } : edge),
          }
          : boardAfterFirst;
        const nextAwards = { ...rootNode.awards, longestRoad: recomputeNodeLongestRoad({ ...planningState, board: boardAfterSecond }) };
        const roadBuildingWin = searchTurnPlan({ ...rootNode, board: boardAfterSecond, awards: nextAwards }, 2, true);
        if (roadBuildingWin.score >= 900_000) return { type: "play-development", cardId: matureRoadBuilding.id };
      }
    }

    // Check if playing a mature Year of Plenty + remaining builds wins immediately.
    const matureYearOfPlenty = activePlayer.developmentCards.find(card => card.kind === "year-of-plenty" && card.purchasedTurn < state.turnNumber);
    if (matureYearOfPlenty && resourceTotal(state.bank) > 0) {
      const drawCount = Math.min(2, resourceTotal(state.bank));
      const drawPairs: Resources[] = [];
      if (drawCount === 1) {
        for (const resource of RESOURCES) {
          if (state.bank[resource] >= 1) drawPairs.push({ ...emptyResources(), [resource]: 1 });
        }
      } else {
        for (let firstIndex = 0; firstIndex < RESOURCES.length; firstIndex++) {
          const firstResource = RESOURCES[firstIndex]!;
          if (state.bank[firstResource] < 1) continue;
          for (let secondIndex = firstIndex; secondIndex < RESOURCES.length; secondIndex++) {
            const secondResource = RESOURCES[secondIndex]!;
            const needed = firstResource === secondResource ? 2 : 1;
            if (state.bank[secondResource] < needed) continue;
            const selection = emptyResources();
            selection[firstResource] += 1;
            selection[secondResource] += 1;
            drawPairs.push(selection);
          }
        }
      }
      for (const selection of drawPairs) {
        const nextHand = { ...rootNode.hand };
        const nextBank = { ...rootNode.bank };
        for (const resource of RESOURCES) {
          nextHand[resource] += selection[resource];
          nextBank[resource] -= selection[resource];
        }
        const plentyWin = searchTurnPlan({ ...rootNode, hand: nextHand, bank: nextBank }, 2, true);
        if (plentyWin.score >= 900_000) {
          return { type: "play-development", cardId: matureYearOfPlenty.id, resources: selection };
        }
      }
    }

    return null;
  }

  function isBlockedTradePartner(otherId: string): boolean {
    const publicScore = publicScores.get(otherId)!;
    return publicScore >= state.victoryPointsToWin - 1 ||
      (publicScore >= state.victoryPointsToWin - 2 && (opponentUnplayedDevelopmentCount.get(otherId) ?? 0) >= 2);
  }

  if (responding && state.trade) {
    const trade = state.trade;
    const targets = buildTargets();
    const before = Math.max(0, ...targets.map(target => priority(target)));
    const after = { ...activePlayer.resources };
    const partnerEffectiveScore = effectiveScores.get(trade.offeredBy)!;
    const partnerAhead = partnerEffectiveScore > score;
    const partnerIsDangerousLeader = partnerEffectiveScore >= state.victoryPointsToWin - 2 && partnerAhead;
    const partnerIsContender = partnerEffectiveScore >= state.victoryPointsToWin - 3 && partnerEffectiveScore >= score;
    if (trade.give === null) {
      if (isBlockedTradePartner(trade.offeredBy)) {
        return { type: "respond-trade", accept: false };
      }
      if (RESOURCES.some(resource => activePlayer.resources[resource] < trade.receive[resource])) {
        return { type: "respond-trade", accept: false };
      }
      let proposal: { price: Resources; value: number } | null = null;
      const resourcesByScarcity = RESOURCES.toSorted((first, second) => production[first] - production[second]);
      const requestedCount = resourceTotal(trade.receive);
      for (const target of targets) {
        const price = emptyResources();
        const inventory = { ...after };
        let remaining = requestedCount;
        for (const resource of RESOURCES) inventory[resource] -= trade.receive[resource];
        for (const resource of resourcesByScarcity) {
          if (trade.receive[resource] > 0) continue;
          price[resource] = Math.min(remaining, Math.max(0, target.cost[resource] - inventory[resource]));
          inventory[resource] += price[resource];
          remaining -= price[resource];
        }
        const value = priority(target, inventory);
        const completesTarget = deficit(inventory, target.cost) === 0;
        const requiredMargin = partnerIsDangerousLeader ? (completesTarget ? 0.5 : 2.5)
          : partnerIsContender && !completesTarget ? 1.1
          : 0;
        if (remaining === 0 && deficit(inventory, target.cost) < deficit(activePlayer.resources, target.cost) &&
          value > before + requiredMargin && (!proposal || value > proposal.value)) {
          proposal = { price, value };
        }
      }
      // If a dangerous leader asks for a card and 1:1 isn't worth giving them tempo, quote 2:1 for cards we need.
      if (!proposal && partnerIsDangerousLeader && requestedCount === 1) {
        for (const target of targets) {
          const price = emptyResources();
          const inventory = { ...after };
          for (const resource of RESOURCES) inventory[resource] -= trade.receive[resource];
          let remaining = 2;
          for (const resource of resourcesByScarcity) {
            if (trade.receive[resource] > 0) continue;
            const take = Math.min(remaining, Math.max(0, target.cost[resource] - inventory[resource]));
            price[resource] += take;
            inventory[resource] += take;
            remaining -= take;
          }
          if (remaining === 0) {
            const value = priority(target, inventory);
            if (value > before + 2.0 && (!proposal || value > proposal.value)) {
              proposal = { price, value };
            }
          }
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
    const minimumImprovement = partnerIsDangerousLeader && !completesTargetNow ? 2.4
      : partnerIsContender && !completesTargetNow ? 0.9
      : 0.1;
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
      const revealedSetup = settlementCount > 0;
      if (revealedSetup) {
        const openVertices = legalSettlementVertices(state, playerId);
        const bestOpenVertex = bestSetupVertex(openVertices);
        if (bestOpenVertex) {
          const openPips = vertices.get(bestOpenVertex)!.tileIds.reduce((sum, tileId) => {
            const tile = tiles.get(tileId)!;
            if (tile.number === null) return sum;
            return sum + (tile.terrain === "gold" ? pipCount(tile.number) * 2.2 : isResource(tile.terrain) ? pipCount(tile.number) : 0);
          }, 0);
          if (openPips >= 9) {
            return { type: "place-settlement", vertexId: bestOpenVertex };
          }
        }
      }
      const revealCandidates = legalSetupRevealTiles(state, playerId);
      if (revealCandidates.length > 0) {
        const averageX = state.board.tiles.reduce((sum, tile) => sum + tile.x, 0) / Math.max(1, state.board.tiles.length);
        const averageY = state.board.tiles.reduce((sum, tile) => sum + tile.y, 0) / Math.max(1, state.board.tiles.length);
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
            const distanceFromCenter = Math.hypot(tile.x - averageX, tile.y - averageY);
            return tileScore + openVertices * 1.2 - distanceFromCenter * 0.008;
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
    .with({ type: "setup-road" }, (phase): GameAction | null => {
      // On the first setup road, prefer forks and coastal port access since interior spots are often plowed during setup.
      if (!isSecondSetup && !isFogBoard(state.board)) {
        const roads = legalRoadEdges(state, playerId);
        const ships = legalShipEdges(state, playerId);
        const candidates: { edgeId: string; kind: "road" | "ship"; score: number }[] = [];
        for (const kind of ["road", "ship"] as const) {
          for (const edgeId of kind === "road" ? roads : ships) {
            const edge = edges.get(edgeId)!;
            const farVertexId = edge.vertexIds[0] === phase.vertexId ? edge.vertexIds[1] : edge.vertexIds[0];
            let bestTarget = 0;
            let openForks = 0;
            let portReachBonus = 0;
            for (const candidateId of adjacentVertexIds.get(farVertexId) ?? []) {
              if (candidateId === phase.vertexId) continue;
              const candidate = vertices.get(candidateId)!;
              if (candidate.building || blockedVerticesSet.has(candidateId)) continue;
              if (isSeafarers(state.variant) && !candidate.tileIds.some(id => isLand(tiles.get(id)!.terrain))) continue;
              const candidateScore = vertexValue(candidateId) + islandBonus(candidateId) * 12;
              bestTarget = Math.max(bestTarget, candidateScore);
              openForks++;
              portReachBonus = Math.max(portReachBonus, portValue(candidateId));
            }
            const forkBonus = openForks >= 2 ? 2.2 : 0;
            const fogBonus = edgeRevealsFog(edgeId) ? 5 : 0;
            candidates.push({ edgeId, kind, score: bestTarget + forkBonus + portReachBonus * 0.6 + fogBonus });
          }
        }
        const bestChoice = candidates.toSorted((first, second) => second.score - first.score)[0];
        if (bestChoice && bestChoice.score > 0) {
          return { type: bestChoice.kind === "ship" ? "place-ship" : "place-road", edgeId: bestChoice.edgeId };
        }
      }
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
      const requiredDiscard = phase.required[playerId]!;
      const held = activePlayer.resources;
      let bestDiscard: Resources | null = null;
      let bestHandScore = -Infinity;

      const scoreKeptHand = (kept: Resources): number => {
        let bestTargetScore = 0;
        let secondTargetScore = 0;
        let completesDirect = false;
        let completesMaritime = false;
        for (const candidate of targets) {
          const scoreValue = priority(candidate, kept);
          if (scoreValue > bestTargetScore) {
            secondTargetScore = bestTargetScore;
            bestTargetScore = scoreValue;
          } else if (scoreValue > secondTargetScore) {
            secondTargetScore = scoreValue;
          }
          if (deficit(kept, candidate.cost) === 0) completesDirect = true;
          else if (maritimeAffordable(candidate.cost, kept)) completesMaritime = true;
        }
        let tieBreaker = 0;
        for (const resource of RESOURCES) {
          const count = kept[resource];
          if (count === 0) continue;
          const portPairBonus = tradeRatios[resource] === 2 ? Math.floor(count / 2) * 1.4 : 0;
          tieBreaker += portPairBonus + count * (scarcityWeight[resource] * 0.45 - production[resource] * 0.04);
        }
        return bestTargetScore * 12 + secondTargetScore * 2.2 +
          (completesDirect ? 25 : completesMaritime ? 8 : 0) + tieBreaker;
      };

      const currentDiscard = emptyResources();
      const searchDiscards = (resourceIndex: number, remaining: number): void => {
        if (resourceIndex === RESOURCES.length - 1) {
          const lastResource = RESOURCES[resourceIndex]!;
          if (remaining > held[lastResource]) return;
          currentDiscard[lastResource] = remaining;
          const kept = emptyResources();
          for (const resource of RESOURCES) kept[resource] = held[resource] - currentDiscard[resource];
          const handScore = scoreKeptHand(kept);
          if (handScore > bestHandScore) {
            bestHandScore = handScore;
            bestDiscard = { ...currentDiscard };
          }
          currentDiscard[lastResource] = 0;
          return;
        }
        const resource = RESOURCES[resourceIndex]!;
        let maxRemainingAfter = 0;
        for (let nextIndex = resourceIndex + 1; nextIndex < RESOURCES.length; nextIndex++) {
          maxRemainingAfter += held[RESOURCES[nextIndex]!];
        }
        const minimumHere = Math.max(0, remaining - maxRemainingAfter);
        const maximumHere = Math.min(remaining, held[resource]);
        for (let count = minimumHere; count <= maximumHere; count++) {
          currentDiscard[resource] = count;
          searchDiscards(resourceIndex + 1, remaining - count);
        }
        currentDiscard[resource] = 0;
      };

      searchDiscards(0, requiredDiscard);
      return { type: "discard", resources: bestDiscard ?? emptyResources() };
    })
    .with({ type: "robber" }, (): GameAction => robberMove().action)
    .with({ type: "steal" }, (phase): GameAction => {
      const primaryTarget = buildTargets(null)[0];
      const neededResources = new Set(
        primaryTarget ? RESOURCES.filter(resource => activePlayer.resources[resource] < primaryTarget.cost[resource]) : [],
      );
      const opponentEstimates = neededResources.size > 0 ? estimateOpponentResourcesFromPublicInformation() : null;
      const victimScore = (victimId: string): number => {
        const handSize = resourceTotal(state.players.find(other => other.id === victimId)!.resources);
        if (handSize === 0) return -1000;
        let neededProbability = 0;
        if (opponentEstimates) {
          const estimate = opponentEstimates[victimId]!;
          for (const resource of neededResources) neededProbability += estimate[resource] / handSize;
        }
        return publicScores.get(victimId)! * 10 + effectiveScores.get(victimId)! * 2.5 +
          neededProbability * 3.5 + Math.min(1.5, handSize * 0.12);
      };
      return {
        type: "steal",
        playerId: phase.victimIds.toSorted((first, second) => victimScore(second) - victimScore(first))[0]!,
      };
    })
    .with({ type: "roll" }, { type: "actions" }, (phase): GameAction | null => {
      const plannedRoute = phase.type === "actions" ? bestRoad(planningState, true, true) : null;
      const targets = buildTargets(plannedRoute);
      const target = targets[0];
      const cost = target?.cost ?? COSTS.city;

      if (state.trade?.offeredBy === playerId && phase.type === "actions") {
        const trade = state.trade;
        let bestProposal: { otherId: string; score: number } | null = null;
        for (const [otherId, price] of Object.entries(trade.responses)) {
          if (!price || RESOURCES.some(resource => price[resource] > activePlayer.resources[resource]) ||
            isBlockedTradePartner(otherId)) continue;
          const priceTotal = resourceTotal(price);
          const receiveTotal = resourceTotal(trade.receive);
          const after = { ...activePlayer.resources };
          for (const resource of RESOURCES) after[resource] += trade.receive[resource] - price[resource];
          const completesWin = targets.some(candidate => candidate.value === 10000 && deficit(after, candidate.cost) === 0);
          const currentHandSize = resourceTotal(activePlayer.resources);
          const bankCost = target ? maritimeTradeCost(target.cost) : null;
          const beatsBankTrade = priceTotal === 2 && receiveTotal === 1 && target !== undefined &&
            deficit(after, target.cost) === 0 &&
            ((bankCost !== null && bankCost >= 3) || currentHandSize >= 8);
          if (priceTotal > receiveTotal && !completesWin && !beatsBankTrade) continue;
          const helpsAnyTarget = targets.some(candidate =>
            deficit(after, candidate.cost) < deficit(activePlayer.resources, candidate.cost) &&
            (candidate === target || deficit(after, candidate.cost) === 0));
          if (helpsAnyTarget) {
            const afterPriority = Math.max(0, ...targets.map(candidate => priority(candidate, after)));
            const abundancePreference = RESOURCES.reduce((sum, resource) => sum + price[resource] * production[resource], 0);
            const partnerScorePenalty = effectiveScores.get(otherId)! * 0.55;
            const extraCardPenalty = Math.max(0, priceTotal - receiveTotal) * 18;
            const proposalScore = afterPriority * 10 + abundancePreference * 0.2 - partnerScorePenalty - extraCardPenalty;
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
        const immediateWinAction = findImmediateWinningAction();
        if (immediateWinAction) return immediateWinAction;
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
            const blockedPips = (robberTile?.vertexIds ?? []).reduce((sum, id) => {
              const building = vertices.get(id)!.building;
              if (building?.playerId !== playerId || robberTile?.number === null || robberTile?.number === undefined) return sum;
              return sum + pipCount(robberTile.number) * (building.kind === "city" ? 2 : 1);
            }, 0);
            const army = state.awards.largestArmy !== playerId && activePlayer.knightsPlayed + 1 >= 3 &&
              activePlayer.knightsPlayed + 1 > highestOpponentKnights;
            const move = robberMove(target);
            const unplayedMatureKnights = activePlayer.developmentCards.filter(other =>
              other.kind === "knight" && other.purchasedTurn < state.turnNumber).length;
            const currentHandSize = resourceTotal(activePlayer.resources);
            // Avoid stealing an 8th card right before rolling a potential 7 unless winning or unblocking huge production.
            if (phase.type === "roll" && currentHandSize === 7 && !(army && winsWith(2)) && !(blocked && blockedPips >= 8)) {
              return null;
            }
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
            const comboTargets: { cost: Resources; value: number }[] = targets.map(candidate => ({
              cost: candidate.cost,
              value: candidate.value,
            }));
            if (plannedRoute && plannedRoute.expansion && plannedRoute.distance === 1 &&
              legalSettlementVertices(planningState, playerId).length === 0) {
              const roadAndSettlementCost: Resources = plannedRoute.kind === "ship"
                ? { wood: 2, brick: 1, wool: 2, grain: 1, ore: 0 }
                : { wood: 2, brick: 2, wool: 1, grain: 1, ore: 0 };
              comboTargets.push({
                cost: roadAndSettlementCost,
                value: winsWith(1 + plannedRoute.destinationIslandBonus)
                  ? 10000
                  : 24 + plannedRoute.destinationValue * 0.65,
              });
            }
            let bestPlan: { selected: Resources; value: number } | null = null;
            for (let targetIndex = 0; targetIndex < comboTargets.length; targetIndex++) {
              const candidate = comboTargets[targetIndex]!;
              const missing = deficit(activePlayer.resources, candidate.cost);
              if (missing === 0) continue;
              const selected = emptyResources();
              const secondaryCost = comboTargets[targetIndex === 0 ? 1 : 0]?.cost ?? COSTS.settlement;
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
              const isLeader = effectiveScores.get(other.id)! >= highestOpponentEffectiveScore - 0.01 && highestOpponentEffectiveScore >= 3;
              for (const resource of RESOURCES) {
                expected[resource] += estimate[resource];
                if (isLeader) leaderExpected[resource] += estimate[resource];
              }
            }
            const completesHighValueBuild = (resource: Resource): boolean => {
              const projectedGain = Math.floor(expected[resource] * 0.85);
              if (projectedGain <= 0) return false;
              const projectedHand = { ...activePlayer.resources, [resource]: activePlayer.resources[resource] + projectedGain };
              return targets.some(candidate =>
                candidate.value >= 18 &&
                deficit(activePlayer.resources, candidate.cost) > 0 &&
                (deficit(projectedHand, candidate.cost) === 0 || maritimeAffordable(candidate.cost, projectedHand)));
            };
            const scoreMonopoly = (resource: Resource): number => {
              const directGain = expected[resource];
              const neededBonus = Math.min(directGain, Math.max(0, cost[resource] - activePlayer.resources[resource])) * 2.2;
              const portBonus = tradeRatios[resource] === 2 ? directGain * 0.7 : tradeRatios[resource] === 3 ? directGain * 0.25 : 0;
              const leaderDenial = leaderExpected[resource] * 0.65;
              const completionBonus = completesHighValueBuild(resource) ? 3.5 : 0;
              return directGain + neededBonus + portBonus + leaderDenial + completionBonus;
            };
            const bestResource = RESOURCES.toSorted((first, second) => scoreMonopoly(second) - scoreMonopoly(first))[0]!;
            const minimumExpected = score >= state.victoryPointsToWin - 3 ? 2.2
              : completesHighValueBuild(bestResource) ? 2.5
              : 3.6;
            return expected[bestResource] >= minimumExpected
              ? { action: { type: "play-development", cardId: card.id, resource: bestResource }, value: scoreMonopoly(bestResource) * 2.4 }
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

      if (!state.computerTradeRequested && target && deficit(activePlayer.resources, target.cost) > 0) {
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

      const turnPlan = searchTurnPlan({
        board: state.board,
        hand: { ...activePlayer.resources },
        bank: { ...state.bank },
        deckRemaining: state.developmentDeck.length,
        awards: { ...state.awards },
        boughtDevelopment: 0,
        accumulatedDevelopmentValue: 0,
        accumulatedSabotageValue: 0,
        accumulatedRoadSplitBonus: 0,
        accumulatedFogBonus: 0,
        firstAction: null,
      }, 2, false, plannedRoute);
      if (turnPlan.action) return turnPlan.action;

      const handSize = resourceTotal(activePlayer.resources);
      // Reduce 7-roll discard exposure when holding more than 7 cards and no build sequence improved end-of-turn value.
      if (handSize > 7 && target) {
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
