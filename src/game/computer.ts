import { match } from "ts-pattern";
import {
  blockedSettlementVertices, COSTS, emptyResources, getTradeRatio, legalCityVertices, legalRoadEdges, legalSettlementVertices, legalShipEdges,
  RESOURCES, resourceTotal,
} from "./engine";
import { edgeTiles, isResource } from "./board";
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
  for (const vertex of state.board.vertices) {
    if (vertex.building?.playerId !== playerId) continue;
    for (const tileId of vertex.tileIds) {
      const tile = tiles.get(tileId)!;
      if (isResource(tile.terrain) && tile.number !== null) {
        production[tile.terrain] += (6 - Math.abs(tile.number - 7)) * (vertex.building.kind === "city" ? 2 : 1);
      }
    }
  }
  const vertexValue = (vertexId: string): number => vertices.get(vertexId)!.tileIds.reduce((value, tileId) => {
    const tile = tiles.get(tileId)!;
    if (tile.terrain === "desert" || tile.number === null) return value;
    return value + (6 - Math.abs(tile.number - 7)) *
      (tile.terrain === "gold" ? 1.8 : tile.terrain === "ore" || tile.terrain === "grain" ? 1.2 : 1) *
      (isResource(tile.terrain) && production[tile.terrain] === 0 ? 1.5 : 1);
  }, 0);
  const bestVertex = (locations: string[]): string | undefined =>
    locations.toSorted((first, second) => vertexValue(second) - vertexValue(first))[0];
  const planningState: GameState = { ...state, activePlayerId: playerId, phase: { type: "actions" } };

  function bestRoad(roadState: GameState): { edgeId: string; kind: "road" | "ship"; expansion: boolean } | null {
    const roads = legalRoadEdges(roadState, playerId);
    const ships = legalShipEdges(roadState, playerId);
    const legal = [...roads, ...ships];
    if (legal.length === 0) return null;
    const blocked = new Set(blockedSettlementVertices(state.board));
    const destinations = state.board.vertices.filter(vertex => !vertex.building && !blocked.has(vertex.id) &&
      (state.variant !== "seafarers" || vertex.tileIds.some(id => tiles.get(id)!.terrain !== "sea")));
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
            ? state.variant === "seafarers" && !edgeTiles(state.board, edge).some(tile => tile.terrain !== "sea")
            : state.variant !== "seafarers" || !edgeTiles(state.board, edge).some(tile => tile.terrain === "sea") ||
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
    const value = (path: Path) => (vertexValue(path.vertexId) +
      (state.variant === "seafarers" && vertices.get(path.vertexId)!.tileIds.some(id => {
        const island = tiles.get(id)!.islandId;
        return island && island !== "main" && !state.board.vertices.some(vertex =>
          vertex.building?.playerId === playerId && vertex.tileIds.some(id => tiles.get(id)!.islandId === island));
      }) ? 10 : 0)) / (path.distance + 1);
    const reachable = [...distances.values()].filter(path => destinations.some(vertex => vertex.id === path.vertexId))
      .toSorted((first, second) => value(second) - value(first));
    if (reachable[0]) return { edgeId: reachable[0].firstEdge, kind: reachable[0].firstKind, expansion: true };
    const edgeId = legal.toSorted((first, second) =>
      Math.max(...edges.get(second)!.vertexIds.map(vertexValue)) - Math.max(...edges.get(first)!.vertexIds.map(vertexValue)))[0]!;
    return {
      edgeId, kind: roads.includes(edgeId) ? "road" : "ship",
      expansion: false,
    };
  }

  function buildTargets(): { action: GameAction; cost: Resources }[] {
    const targets: { action: GameAction; cost: Resources }[] = [];
    const settlement = bestVertex(legalSettlementVertices(planningState, playerId));
    const city = bestVertex(legalCityVertices(planningState, playerId));
    const road = bestRoad(planningState);
    if (settlement) targets.push({ action: { type: "place-settlement", vertexId: settlement }, cost: COSTS.settlement });
    if (city) targets.push({ action: { type: "place-city", vertexId: city }, cost: COSTS.city });
    if (road?.expansion && !settlement) targets.push({ action: { type: road.kind === "ship" ? "place-ship" : "place-road", edgeId: road.edgeId }, cost: COSTS[road.kind] });
    if (state.developmentDeck.length > 0) targets.push({ action: { type: "buy-development" }, cost: COSTS.development });
    return targets;
  }
  const deficit = (inventory: Resources, cost: Resources): number =>
    RESOURCES.reduce((total, resource) => total + Math.max(0, cost[resource] - inventory[resource]), 0);

  if (responding && state.trade) {
    const trade = state.trade;
    const cost = buildTargets()[0]?.cost ?? COSTS.city;
    const after = { ...player.resources };
    if (trade.give === null) {
      if (RESOURCES.some(resource => player.resources[resource] < trade.receive[resource])) {
        return { type: "respond-trade", accept: false };
      }
      const price = emptyResources();
      let remaining = resourceTotal(trade.receive);
      for (const resource of RESOURCES) {
        after[resource] -= trade.receive[resource];
        if (trade.receive[resource] > 0) continue;
        price[resource] = Math.min(remaining, Math.max(0, cost[resource] - after[resource]));
        after[resource] += price[resource];
        remaining -= price[resource];
      }
      return remaining === 0 && deficit(after, cost) < deficit(player.resources, cost)
        ? { type: "propose-trade", price }
        : { type: "respond-trade", accept: false };
    }
    for (const resource of RESOURCES) after[resource] += trade.give[resource] - trade.receive[resource];
    const improvement = deficit(player.resources, cost) - deficit(after, cost);
    return {
      type: "respond-trade",
      accept: RESOURCES.every(resource => player.resources[resource] >= trade.receive[resource]) &&
        resourceTotal(trade.give) >= resourceTotal(trade.receive) &&
        (improvement > 0 || (improvement === 0 && resourceTotal(trade.give) > resourceTotal(trade.receive))),
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
    .with({ type: "robber" }, (): GameAction => {
      const value = (tile: GameState["board"]["tiles"][number]): number => tile.vertexIds.reduce((total, vertexId) => {
        const building = vertices.get(vertexId)!.building;
        if (!building) return total;
        return total + (building.playerId === playerId ? -4 : 1) * (building.kind === "city" ? 2 : 1) *
          (tile.number === null ? 0 : 6 - Math.abs(tile.number - 7));
      }, 0);
      const tile = state.board.tiles.filter(tile => tile.terrain !== "sea" && tile.id !== state.robberTileId)
        .toSorted((first, second) => value(second) - value(first))[0]!;
      const pirate = state.board.tiles.filter(tile => tile.terrain === "sea" && tile.id !== state.pirateTileId)
        .map(tile => ({ tile, value: state.board.edges.filter(edge => edge.kind === "ship" &&
          edge.vertexIds.every(id => tile.vertexIds.includes(id))).reduce((total, edge) => total + (edge.playerId === playerId ? -4 : 2), 0) }))
        .toSorted((first, second) => second.value - first.value)[0];
      if (pirate && pirate.value > value(tile)) return { type: "move-pirate", tileId: pirate.tile.id };
      return { type: "move-robber", tileId: tile.id };
    })
    .with({ type: "steal" }, (phase): GameAction => ({
      type: "steal",
      playerId: phase.victimIds.toSorted((first, second) =>
        resourceTotal(state.players.find(other => other.id === second)!.resources) -
        resourceTotal(state.players.find(other => other.id === first)!.resources))[0]!,
    }))
    .with({ type: "roll" }, { type: "actions" }, (phase): GameAction | null => {
      const targets = buildTargets();
      const cost = targets[0]?.cost ?? COSTS.city;
      if (state.trade?.offeredBy === playerId && phase.type === "actions") {
        const trade = state.trade;
        for (const [otherId, price] of Object.entries(trade.responses)) {
          if (!price || resourceTotal(price) > resourceTotal(trade.receive) ||
            RESOURCES.some(resource => price[resource] > player.resources[resource])) continue;
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
      for (const card of player.developmentCards) {
        if (state.developmentPlayed || card.purchasedTurn >= state.turnNumber) continue;
        const action = match(card.kind)
          .with("victory-point", () => null)
          .with("knight", (): GameAction => ({ type: "play-development", cardId: card.id }))
          .with("road-building", (): GameAction | null => legalRoadEdges(planningState, playerId).length + legalShipEdges(planningState, playerId).length > 0
            ? { type: "play-development", cardId: card.id } : null)
          .with("year-of-plenty", (): GameAction | null => {
            const selected = emptyResources();
            const count = Math.min(2, resourceTotal(state.bank));
            if (count === 0) return null;
            for (let index = 0; index < count; index++) {
              const available = RESOURCES.filter(resource => state.bank[resource] > selected[resource]);
              const resource = available.toSorted((first, second) =>
                (cost[second] - player.resources[second] - selected[second]) -
                (cost[first] - player.resources[first] - selected[first]))[0]!;
              selected[resource]++;
            }
            return { type: "play-development", cardId: card.id, resources: selected };
          })
          .with("monopoly", (): GameAction => {
            // Estimate demand from the target and visible production, never opponents' resource composition.
            const expected = emptyResources();
            for (const tile of state.board.tiles) {
              if (!isResource(tile.terrain) || tile.number === null) continue;
              for (const vertexId of tile.vertexIds) {
                const building = vertices.get(vertexId)!.building;
                if (building && building.playerId !== playerId) {
                  expected[tile.terrain] += (6 - Math.abs(tile.number - 7)) * (building.kind === "city" ? 2 : 1);
                }
              }
            }
            const value = (resource: keyof Resources) => expected[resource] + 3 * Math.max(0, cost[resource] - player.resources[resource]);
            const resource = RESOURCES.toSorted((first, second) => value(second) - value(first))[0]!;
            return { type: "play-development", cardId: card.id, resource };
          })
          .exhaustive();
        if (action) return action;
      }
      if (phase.type === "roll") return { type: "roll" };
      const affordable = targets.find(target => deficit(player.resources, target.cost) === 0);
      if (affordable) return affordable.action;
      if (!state.computerTradeRequested && targets[0]) {
        const target = targets[0];
        const surplus = RESOURCES.reduce((total, resource) => total + Math.max(0, player.resources[resource] - target.cost[resource]), 0);
        if (surplus >= deficit(player.resources, target.cost)) {
          const receive = emptyResources();
          for (const resource of RESOURCES) receive[resource] = Math.max(0, target.cost[resource] - player.resources[resource]);
          return { type: "request-trade", receive };
        }
      }
      for (const target of targets) {
        const needed = deficit(player.resources, target.cost);
        const surplusTrades = RESOURCES.reduce((total, resource) => total +
          Math.floor(Math.max(0, player.resources[resource] - target.cost[resource]) / getTradeRatio(state, playerId, resource)), 0);
        if (surplusTrades < needed || RESOURCES.some(resource => target.cost[resource] - player.resources[resource] > state.bank[resource])) continue;
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
