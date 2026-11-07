import { match } from "ts-pattern";
import {
  blockedSettlementVertices, COSTS, emptyResources, getLongestRoadLength, getPublicScore, getScore, getTradeRatio, legalCityVertices, legalRoadEdges, legalSettlementVertices, legalShipEdges,
  RESOURCES, resourceTotal, victoryTarget,
} from "./engine";
import { edgeTiles, isLand, isResource } from "./board";
import { isSeafarers } from "./types";
import type { GameAction, GameState, Resources } from "./types";

export function getController(state: GameState): string {
  return state.phase.type === "discard" || state.phase.type === "gold"
    ? Object.entries(state.phase.required).find(([, count]) => count > 0)?.[0] ?? state.activePlayerId
    : state.activePlayerId;
}

export function chooseComputerAction(state: GameState, playerId: string, now = Date.now()): GameAction | null {
  const player = state.players.find(player => player.id === playerId);
  if (player?.control !== "computer" || state.phase.type === "finished") return null;
  const responding = state.phase.type === "actions" && state.trade && state.trade.offeredBy !== playerId &&
    !Object.hasOwn(state.trade.responses, playerId);
  const discarding = state.phase.type === "discard" && (state.phase.required[playerId] ?? 0) > 0;
  const choosingGold = state.phase.type === "gold" && getController(state) === playerId;
  if (state.phase.type === "gold" && !choosingGold) return null;
  if (!responding && !discarding && !choosingGold && state.activePlayerId !== playerId) return null;

  const vertices = new Map(state.board.vertices.map(vertex => [vertex.id, vertex]));
  const edges = new Map(state.board.edges.map(edge => [edge.id, edge]));
  const tiles = new Map(state.board.tiles.map(tile => [tile.id, tile]));
  const production = emptyResources();
  const numberProduction = new Map<number, number>();
  for (const vertex of state.board.vertices) {
    if (vertex.building?.playerId !== playerId) continue;
    for (const tileId of vertex.tileIds) {
      const tile = tiles.get(tileId)!;
      if (tile.number !== null) {
        const yieldValue = (6 - Math.abs(tile.number - 7)) * (vertex.building.kind === "city" ? 2 : 1);
        if (isResource(tile.terrain)) production[tile.terrain] += yieldValue;
        if (tile.terrain === "gold") {
          for (const resource of RESOURCES) production[resource] += yieldValue / RESOURCES.length;
        }
        numberProduction.set(tile.number, (numberProduction.get(tile.number) ?? 0) + yieldValue);
      }
    }
  }
  const vertexValue = (vertexId: string, balance = true): number => vertices.get(vertexId)!.tileIds.reduce((value, tileId) => {
    const tile = tiles.get(tileId)!;
    if (tile.terrain === "desert" || tile.number === null) return value;
    return value + (6 - Math.abs(tile.number - 7)) *
      (tile.terrain === "gold" ? 1.8 : tile.terrain === "ore" || tile.terrain === "grain" ? 1.2 : 1) *
      (balance && isResource(tile.terrain) ? 1 / (1 + production[tile.terrain] / 6) : 1) *
      (balance ? 1 / (1 + (numberProduction.get(tile.number) ?? 0) / 18) : 1);
  }, 0) + (balance ? portValue(vertexId) : 0);
  function portValue(vertexId: string): number {
    const local = emptyResources();
    for (const tileId of vertices.get(vertexId)!.tileIds) {
      const tile = tiles.get(tileId)!;
      if (isResource(tile.terrain) && tile.number !== null) local[tile.terrain] += 6 - Math.abs(tile.number - 7);
    }
    return state.board.ports.reduce((bonus, port) => {
      const edge = edges.get(port.edgeId);
      if (!edge || !edge.vertexIds.includes(vertexId)) return bonus;
      if (port.resource === "any") return bonus + 0.8;
      const supply = production[port.resource] + local[port.resource];
      return bonus + 2 * Math.min(1, supply / 4);
    }, 0);
  }
  const islandBonus = (vertexId: string): number =>
    (state.variant === "seafarers" || state.variant === "four-islands") && !state.phase.type.startsWith("setup")
      ? new Set(vertices.get(vertexId)!.tileIds.map(id => tiles.get(id)!.islandId).filter(island =>
        island && (state.variant === "four-islands" ? !state.startingIslandIds?.[playerId]?.includes(island) : island !== "main") &&
        !state.board.vertices.some(vertex => vertex.building?.playerId === playerId &&
          vertex.tileIds.some(id => tiles.get(id)!.islandId === island)))).size * 2 : 0;
  const explorationValue = (vertexId: string): number => state.variant === "fog-islands"
    ? vertices.get(vertexId)!.tileIds.filter(id => tiles.get(id)!.terrain === "fog").length * 8 : 0;
  const bestVertex = (locations: string[], balance = true): string | undefined =>
    locations.toSorted((first, second) => (vertexValue(second, balance) + islandBonus(second) * 10) -
      (vertexValue(first, balance) + islandBonus(first) * 10))[0];
  const planningState: GameState = { ...state, activePlayerId: playerId, phase: { type: "actions" } };
  const publicScores = new Map(state.players.map(other => [other.id, getPublicScore(state, other.id).public]));
  const score = getScore(state, playerId).total;
  const winsWith = (points: number) => score + points >= victoryTarget(state.variant);

  function bestRoad(roadState: GameState): { edgeId: string; kind: "road" | "ship"; expansion: boolean; value: number; points: number } | null {
    const roads = legalRoadEdges(roadState, playerId);
    const ships = legalShipEdges(roadState, playerId);
    const legal = [...roads, ...ships];
    if (legal.length === 0) return null;
    const blocked = new Set(blockedSettlementVertices(state.board));
    const destinations = state.board.vertices.filter(vertex => !vertex.building && !blocked.has(vertex.id) &&
      (!isSeafarers(state.variant) || vertex.tileIds.some(id => isLand(tiles.get(id)!.terrain)) || explorationValue(vertex.id) > 0));
    type Path = { vertexId: string; kind: "road" | "ship"; distance: number; firstEdge: string; firstKind: "road" | "ship" };
    const distances = new Map<string, Path>();
    const pending = new Set<string>();
    for (const kind of ["road", "ship"] as const) {
      for (const edgeId of kind === "road" ? roads : ships) {
        for (const vertexId of edges.get(edgeId)!.vertexIds) {
          const key = `${vertexId}:${kind}`;
          distances.set(key, { vertexId, kind, distance: 1, firstEdge: edgeId, firstKind: kind });
          pending.add(key);
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
        const edge = edges.get(edgeId)!;
        if (edge.playerId && edge.playerId !== playerId) continue;
        for (const kind of ["road", "ship"] as const) {
          if (kind !== path.kind && vertex.building?.playerId !== playerId) continue;
          if (edge.playerId ? (edge.kind ?? "road") !== kind : kind === "road"
            ? isSeafarers(state.variant) && !edgeTiles(state.board, edge).some(tile => isLand(tile.terrain))
            : !isSeafarers(state.variant) || !edgeTiles(state.board, edge).some(tile => tile.terrain === "sea" || tile.terrain === "fog") ||
              edgeTiles(state.board, edge).some(tile => tile.id === state.pirateTileId)) continue;
          const next = edge.vertexIds.find(id => id !== path.vertexId)!;
          const nextKey = `${next}:${kind}`;
          const distance = path.distance + (edge.playerId ? 0 : 1);
          if (distance > 15 || distance >= (distances.get(nextKey)?.distance ?? Infinity)) continue;
          distances.set(nextKey, { ...path, vertexId: next, kind, distance });
          pending.add(nextKey);
        }
      }
    }
    const value = (path: Path) => (vertexValue(path.vertexId) + islandBonus(path.vertexId) * 10 + explorationValue(path.vertexId)) / (path.distance + 1);
    const reachable = [...distances.values()].filter(path => destinations.some(vertex => vertex.id === path.vertexId))
      .toSorted((first, second) => value(second) - value(first));
    const destination = reachable[0];
    const edgeId = destination?.firstEdge ?? legal.toSorted((first, second) =>
      Math.max(...edges.get(second)!.vertexIds.map(id => vertexValue(id))) -
      Math.max(...edges.get(first)!.vertexIds.map(id => vertexValue(id))))[0]!;
    if (state.awards.longestRoad !== playerId && state.board.edges.filter(edge => edge.playerId === playerId).length >= 4) {
      const threshold = Math.max(4, ...state.players.filter(other => other.id !== playerId).map(other => getLongestRoadLength(state, other.id)));
      for (const kind of ["road", "ship"] as const) {
        const candidates = kind === "road" ? roads : ships;
        for (const candidate of candidates.toSorted((first, second) => Number(second === edgeId) - Number(first === edgeId))) {
          const next = { ...state, board: { ...state.board, edges: state.board.edges.map(edge =>
            edge.id === candidate ? { ...edge, playerId, kind } : edge) } };
          if (getLongestRoadLength(next, playerId) > threshold) {
            return { edgeId: candidate, kind, expansion: candidate === destination?.firstEdge,
              value: candidate === destination?.firstEdge ? value(destination) : 0, points: 2 };
          }
        }
      }
    }
    return {
      edgeId, kind: destination?.firstKind ?? (roads.includes(edgeId) ? "road" : "ship"),
      expansion: Boolean(destination), value: destination ? value(destination) : 0, points: 0,
    };
  }

  const deficit = (inventory: Resources, cost: Resources): number =>
    RESOURCES.reduce((total, resource) => total + Math.max(0, cost[resource] - inventory[resource]), 0);
  const maritimeAffordable = (cost: Resources, inventory = player.resources): boolean => {
    const trades = RESOURCES.reduce((total, resource) => total +
      Math.floor(Math.max(0, inventory[resource] - cost[resource]) / getTradeRatio(state, playerId, resource)), 0);
    return trades >= deficit(inventory, cost) &&
      RESOURCES.every(resource => cost[resource] - inventory[resource] <= state.bank[resource]);
  };
  type BuildTarget = { action: GameAction; cost: Resources; value: number };
  const priority = (target: BuildTarget, inventory = player.resources): number => {
    const missing = deficit(inventory, target.cost);
    // Resources arrive in parallel; the slowest missing resource determines the expected wait in table rounds.
    const effort = maritimeAffordable(target.cost, inventory) ? missing / 4 : missing / 2 + Math.max(...RESOURCES.map(resource =>
      Math.max(0, target.cost[resource] - inventory[resource]) * 36 / ((1 + production[resource]) * state.players.length)));
    return target.value / (1 + effort);
  };
  function buildTargets(): BuildTarget[] {
    const targets: BuildTarget[] = [];
    const settlement = bestVertex(legalSettlementVertices(planningState, playerId));
    const city = bestVertex(legalCityVertices(planningState, playerId), false);
    const road = bestRoad(planningState);
    if (settlement) targets.push({
      action: { type: "place-settlement", vertexId: settlement }, cost: COSTS.settlement,
      value: winsWith(1 + islandBonus(settlement)) ? 10000 : 18 + vertexValue(settlement) / 3 + islandBonus(settlement) * 10,
    });
    if (city) targets.push({
      action: { type: "place-city", vertexId: city }, cost: COSTS.city,
      value: winsWith(1) ? 10000 : 18 + vertexValue(city, false) / 3,
    });
    if (road && ((road.expansion && !settlement) || road.points > 0)) targets.push({
      action: { type: road.kind === "ship" ? "place-ship" : "place-road", edgeId: road.edgeId }, cost: COSTS[road.kind],
      value: road.points > 0 && winsWith(road.points) ? 10000 : 8 + road.value + road.points * 4,
    });
    if (state.developmentDeck.length > 0) targets.push({
      action: { type: "buy-development" }, cost: COSTS.development,
      value: 3 + 3 * state.developmentDeck.length / 25,
    });
    return targets.toSorted((first, second) => priority(second) - priority(first));
  }

  function robberMove(): { action: GameAction; value: number } {
    const value = (tile: GameState["board"]["tiles"][number]): number => {
      const owners = new Set<string>();
      const blocking = tile.vertexIds.reduce((total, vertexId) => {
        const building = vertices.get(vertexId)!.building;
        if (!building) return total;
        if (building.playerId !== playerId) owners.add(building.playerId);
        return total + (building.playerId === playerId ? -4 : 1 + publicScores.get(building.playerId)! / 3) *
          (building.kind === "city" ? 2 : 1) * (tile.number === null ? 0 : 6 - Math.abs(tile.number - 7));
      }, 0);
      const stealable = tile.number === null ? 0 : [...owners].reduce((total, owner) =>
        total + 0.3 * resourceTotal(state.players.find(other => other.id === owner)!.resources), 0);
      return blocking + stealable;
    };
    const tile = state.board.tiles.filter(tile => isLand(tile.terrain) && tile.id !== state.robberTileId)
      .toSorted((first, second) => value(second) - value(first))[0]!;
    const robberTile = tiles.get(state.robberTileId);
    const unblock = (robberTile?.vertexIds ?? []).reduce((total, vertexId) => {
      const building = vertices.get(vertexId)!.building;
      const number = robberTile!.number;
      return total + (building?.playerId === playerId && number !== null
        ? 4 * (6 - Math.abs(number - 7)) * (building.kind === "city" ? 2 : 1) : 0);
    }, 0);
    const pirate = state.board.tiles.filter(tile => tile.terrain === "sea" && tile.id !== state.pirateTileId)
      .map(tile => ({ tile, value: state.board.edges.filter(edge => edge.kind === "ship" && edge.playerId &&
        edge.vertexIds.every(id => tile.vertexIds.includes(id))).reduce((total, edge) => total +
          (edge.playerId === playerId ? -4 : 2 + publicScores.get(edge.playerId!)! / 3), 0) }))
      .toSorted((first, second) => second.value - first.value)[0];
    if (pirate && pirate.value > value(tile) + unblock) return { action: { type: "move-pirate", tileId: pirate.tile.id }, value: pirate.value };
    return { action: { type: "move-robber", tileId: tile.id }, value: value(tile) + unblock };
  }

  if (responding && state.trade) {
    const trade = state.trade;
    const targets = buildTargets();
    const before = Math.max(0, ...targets.map(target => priority(target)));
    const after = { ...player.resources };
    if (trade.give === null) {
      if (publicScores.get(trade.offeredBy)! >= victoryTarget(state.variant) - 1) {
        return { type: "respond-trade", accept: false };
      }
      if (RESOURCES.some(resource => player.resources[resource] < trade.receive[resource])) {
        return { type: "respond-trade", accept: false };
      }
      let proposal: { price: Resources; value: number } | null = null;
      for (const target of targets) {
        const price = emptyResources();
        const inventory = { ...after };
        let remaining = resourceTotal(trade.receive);
        for (const resource of RESOURCES) {
          inventory[resource] -= trade.receive[resource];
          if (trade.receive[resource] > 0) continue;
          price[resource] = Math.min(remaining, Math.max(0, target.cost[resource] - inventory[resource]));
          inventory[resource] += price[resource];
          remaining -= price[resource];
        }
        const value = priority(target, inventory);
        if (remaining === 0 && deficit(inventory, target.cost) < deficit(player.resources, target.cost) &&
          value > before && (!proposal || value > proposal.value)) proposal = { price, value };
      }
      return proposal
        ? { type: "propose-trade", price: proposal.price }
        : { type: "respond-trade", accept: false };
    }
    for (const resource of RESOURCES) after[resource] += trade.give[resource] - trade.receive[resource];
    const improvement = Math.max(0, ...targets.map(target => priority(target, after))) - before;
    const contender = publicScores.get(trade.offeredBy)! >= victoryTarget(state.variant) - 1;
    return {
      type: "respond-trade",
      accept: !contender && RESOURCES.every(resource => player.resources[resource] >= trade.receive[resource]) &&
        resourceTotal(trade.give) >= resourceTotal(trade.receive) &&
        (improvement > 0.1 || (improvement === 0 && resourceTotal(trade.give) > resourceTotal(trade.receive))),
    };
  }

  return match(state.phase)
    .with({ type: "setup-settlement" }, (): GameAction | null => {
      const vertexId = bestVertex(legalSettlementVertices(state, playerId));
      return vertexId ? { type: "place-settlement", vertexId } : null;
    })
    .with({ type: "setup-road" }, (): GameAction | null => {
      const road = bestRoad(state);
      return road ? { type: road.kind === "ship" ? "place-ship" : "place-road", edgeId: road.edgeId } : null;
    })
    .with({ type: "road-building" }, (): GameAction => {
      const road = bestRoad(state);
      return road ? { type: road.kind === "ship" ? "place-ship" : "place-road", edgeId: road.edgeId } : { type: "skip-roads" };
    })
    .with({ type: "gold" }, (phase): GameAction => {
      const selected = emptyResources();
      const cost = buildTargets()[0]?.cost ?? COSTS.city;
      for (let index = 0; index < Math.min(phase.required[playerId]!, resourceTotal(state.bank)); index++) {
        const resource = RESOURCES.filter(resource => state.bank[resource] > selected[resource])
          .toSorted((first, second) => (cost[second] - player.resources[second] - selected[second]) -
            (cost[first] - player.resources[first] - selected[first]))[0]!;
        selected[resource]++;
      }
      return { type: "choose-gold", resources: selected };
    })
    .with({ type: "discard" }, (phase): GameAction | null => {
      if (!discarding) return null;
      const cost = buildTargets()[0]?.cost ?? COSTS.city;
      const discarded = emptyResources();
      for (let index = 0; index < phase.required[playerId]!; index++) {
        const available = RESOURCES.filter(resource => player.resources[resource] > discarded[resource]);
        const resource = available.toSorted((first, second) =>
          (player.resources[second] - discarded[second] - cost[second]) -
          (player.resources[first] - discarded[first] - cost[first]))[0]!;
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
      const targets = buildTargets();
      const cost = targets[0]?.cost ?? COSTS.city;
      if (state.trade?.offeredBy === playerId && phase.type === "actions") {
        const trade = state.trade;
        for (const [otherId, price] of Object.entries(trade.responses)) {
          if (!price || resourceTotal(price) > resourceTotal(trade.receive) ||
            RESOURCES.some(resource => price[resource] > player.resources[resource]) ||
            publicScores.get(otherId)! >= victoryTarget(state.variant) - 1) continue;
          const after = { ...player.resources };
          for (const resource of RESOURCES) after[resource] += trade.receive[resource] - price[resource];
          if (deficit(after, cost) < deficit(player.resources, cost)) {
            return { type: "complete-trade", playerId: otherId };
          }
        }
        const unanswered = state.players.some(other => other.id !== playerId && !Object.hasOwn(trade.responses, other.id));
        if (unanswered && trade.expiresAt !== undefined && now < trade.expiresAt) return null;
        return { type: "cancel-trade" };
      }
      const target = targets[0];
      if (phase.type === "actions" && target && target.value === 10000 && deficit(player.resources, cost) === 0) return target.action;
      const developmentActions: { action: GameAction; value: number }[] = [];
      for (const card of player.developmentCards) {
        if (state.developmentPlayed || card.purchasedTurn >= state.turnNumber ||
          (phase.type === "roll" && card.kind !== "knight")) continue;
        const choice = match(card.kind)
          .with("victory-point", () => null)
          .with("knight", (): typeof developmentActions[number] | null => {
            const blocked = tiles.get(state.robberTileId)?.vertexIds.some(id => vertices.get(id)!.building?.playerId === playerId) ?? false;
            const army = state.awards.largestArmy !== playerId && player.knightsPlayed + 1 >= 3 &&
              player.knightsPlayed + 1 > Math.max(0, ...state.players.filter(other => other.id !== playerId).map(other => other.knightsPlayed));
            if (!blocked && !army && (phase.type === "roll" || robberMove().value <= 0)) return null;
            return { action: { type: "play-development", cardId: card.id }, value: army ? (winsWith(2) ? 10000 : 40) : blocked ? 30 : 3 };
          })
          .with("road-building", (): typeof developmentActions[number] | null => {
            const road = bestRoad(planningState);
            return road && (road.expansion || road.points > 0)
              ? { action: { type: "play-development", cardId: card.id },
                value: road.points > 0 && winsWith(road.points) ? 10000 : 8 + road.value + road.points * 10 } : null;
          })
          .with("year-of-plenty", (): typeof developmentActions[number] | null => {
            const selected = emptyResources();
            const count = Math.min(2, resourceTotal(state.bank));
            if (!target || count === 0 || deficit(player.resources, cost) === 0 || deficit(player.resources, cost) > count) return null;
            for (let index = 0; index < count; index++) {
              const available = RESOURCES.filter(resource => state.bank[resource] > selected[resource]);
              const resource = available.toSorted((first, second) =>
                (cost[second] - player.resources[second] - selected[second]) -
                (cost[first] - player.resources[first] - selected[first]))[0]!;
              selected[resource]++;
            }
            const after = { ...player.resources };
            for (const resource of RESOURCES) after[resource] += selected[resource];
            return deficit(after, cost) === 0
              ? { action: { type: "play-development", cardId: card.id, resources: selected }, value: target.value } : null;
          })
          .with("monopoly", (): typeof developmentActions[number] | null => {
            // Only public hand sizes and production inform this estimate, not hidden resource composition.
            const expected = emptyResources();
            for (const other of state.players.filter(other => other.id !== playerId)) {
              const visible = emptyResources();
              for (const vertex of state.board.vertices.filter(vertex => vertex.building?.playerId === other.id)) {
                for (const tileId of vertex.tileIds) {
                  const tile = tiles.get(tileId)!;
                  if (isResource(tile.terrain) && tile.number !== null) {
                    visible[tile.terrain] += (6 - Math.abs(tile.number - 7)) * (vertex.building!.kind === "city" ? 2 : 1);
                  }
                }
              }
              const total = resourceTotal(visible);
              for (const resource of RESOURCES) {
                expected[resource] += resourceTotal(other.resources) * (total > 0 ? visible[resource] / total : 1 / RESOURCES.length);
              }
            }
            const value = (resource: keyof Resources) => expected[resource] +
              Math.min(expected[resource], Math.max(0, cost[resource] - player.resources[resource])) * 2;
            const resource = RESOURCES.toSorted((first, second) => value(second) - value(first))[0]!;
            return expected[resource] >= 2
              ? { action: { type: "play-development", cardId: card.id, resource }, value: value(resource) } : null;
          })
          .exhaustive();
        if (choice) developmentActions.push(choice);
      }
      const development = developmentActions.toSorted((first, second) => second.value - first.value)[0];
      if (development) return development.action;
      if (phase.type === "roll") return { type: "roll" };
      if (target && deficit(player.resources, target.cost) === 0) return target.action;
      if (!state.computerTradeRequested && target) {
        const surplus = RESOURCES.reduce((total, resource) => total + Math.max(0, player.resources[resource] - target.cost[resource]), 0);
        if (surplus >= deficit(player.resources, target.cost)) {
          const receive = emptyResources();
          for (const resource of RESOURCES) receive[resource] = Math.max(0, target.cost[resource] - player.resources[resource]);
          return { type: "request-trade", receive };
        }
      }
      if (target && maritimeAffordable(target.cost)) {
        const receive = RESOURCES.find(resource => player.resources[resource] < target.cost[resource]);
        const give = RESOURCES.find(resource => player.resources[resource] - target.cost[resource] >= getTradeRatio(state, playerId, resource));
        // Preserve the selected cost: each trade reduces its deficit, and only trade toward an attainable purchase.
        if (give && receive) return { type: "bank-trade", give, receive };
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
