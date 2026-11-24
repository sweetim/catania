import { match } from "ts-pattern";
import { isResource } from "../game/board";
import { emptyResources, RESOURCES, resourceTotal } from "../game/engine";
import type { DevelopmentKind, Resource, Resources } from "../game/types";
import type { SabotageNoticeEvent, TradeOutcomeEvent } from "../components/PrivateNotices";
import type { PublicGame } from "./types";

export type SharedPublicEvent =
  | { id: number; kind: "award"; award: "longest-road" | "largest-army" | "islands"; playerName: string; playerColor: string; previousHolderName?: string }
  | { id: number; kind: "development"; cardKind: DevelopmentKind; playerName: string; playerColor: string }
  | { id: number; kind: "robbery"; thiefName: string; victimName: string; emptyHand: boolean; playerColor: string }
  | { id: number; kind: "shortage"; resources: Resource[] }
  | { id: number; kind: "sabotage"; pieceKind: "road" | "ship" | "settlement" | "city"; actorName: string; victimName: string; playerColor: string };

export type SharedRollProduction = {
  producingTileIds: string[];
  shortages: Resource[];
};

export function computeSharedRollProduction(previous: PublicGame, next: PublicGame): SharedRollProduction {
  if (!next.dice) return { producingTileIds: [], shortages: [] };
  const rolledNumber = next.dice[0] + next.dice[1];
  if (rolledNumber === 7) return { producingTileIds: [], shortages: [] };

  const paid = emptyResources();
  const demand = emptyResources();
  for (const resource of RESOURCES) {
    paid[resource] = Math.max(0, previous.bank[resource] - next.bank[resource]);
  }

  const producingTileIds: string[] = [];
  for (const tile of next.board.tiles) {
    if (tile.number !== rolledNumber || tile.id === next.robberTileId) continue;
    if (!isResource(tile.terrain) && tile.terrain !== "gold") continue;
    let hasAdjacentBuilding = false;
    for (const vertexId of tile.vertexIds) {
      const vertex = next.board.vertices.find(candidate => candidate.id === vertexId);
      if (!vertex?.building) continue;
      hasAdjacentBuilding = true;
      if (isResource(tile.terrain)) {
        demand[tile.terrain] += vertex.building.kind === "city" ? 2 : 1;
      }
    }
    if (!hasAdjacentBuilding) continue;
    if (tile.terrain === "gold" || paid[tile.terrain] > 0) {
      producingTileIds.push(tile.id);
    }
  }

  const shortages = RESOURCES.filter(resource => demand[resource] > paid[resource]);
  return { producingTileIds, shortages };
}

function newLogEntries(previous: PublicGame, next: PublicGame): PublicGame["log"] {
  if (previous.gameId !== next.gameId) return [];
  if (next.log.length > previous.log.length) {
    return next.log.slice(previous.log.length);
  }
  if (next.log.length === 0) return [];
  const previousLast = previous.log.at(-1);
  const nextLast = next.log.at(-1);
  if (previousLast && nextLast && JSON.stringify(previousLast) !== JSON.stringify(nextLast)) {
    return [nextLast];
  }
  return [];
}

function isDevelopmentKind(value: unknown): value is DevelopmentKind {
  return value === "knight" || value === "victory-point" || value === "road-building" || value === "year-of-plenty" || value === "monopoly";
}

export function detectSharedPublicEvents(
  previous: PublicGame,
  next: PublicGame,
  allocateId: () => number,
): SharedPublicEvent[] {
  if (previous.gameId !== next.gameId || next.winnerId) return [];
  const events: SharedPublicEvent[] = [];

  if (next.awards.longestRoad && next.awards.longestRoad !== previous.awards.longestRoad) {
    const winner = next.players.find(player => player.id === next.awards.longestRoad);
    const previousHolder = previous.awards.longestRoad
      ? next.players.find(player => player.id === previous.awards.longestRoad)
      : undefined;
    if (winner) {
      events.push({
        id: allocateId(),
        kind: "award",
        award: "longest-road",
        playerName: winner.name,
        playerColor: winner.color,
        ...(previousHolder ? { previousHolderName: previousHolder.name } : {}),
      });
    }
  }

  if (next.awards.largestArmy && next.awards.largestArmy !== previous.awards.largestArmy) {
    const winner = next.players.find(player => player.id === next.awards.largestArmy);
    const previousHolder = previous.awards.largestArmy
      ? next.players.find(player => player.id === previous.awards.largestArmy)
      : undefined;
    if (winner) {
      events.push({
        id: allocateId(),
        kind: "award",
        award: "largest-army",
        playerName: winner.name,
        playerColor: winner.color,
        ...(previousHolder ? { previousHolderName: previousHolder.name } : {}),
      });
    }
  }

  for (const player of next.players) {
    const previousPlayer = previous.players.find(candidate => candidate.id === player.id);
    if ((player.islands ?? 0) > (previousPlayer?.islands ?? 0)) {
      events.push({
        id: allocateId(),
        kind: "award",
        award: "islands",
        playerName: player.name,
        playerColor: player.color,
      });
    }
  }

  for (const entry of newLogEntries(previous, next)) {
    const actorName = typeof entry.parameters?.player === "string" ? entry.parameters.player : "";
    const victimName = typeof entry.parameters?.victim === "string" ? entry.parameters.victim : "";
    const actor = next.players.find(player => player.name === actorName);
    const playerColor = actor?.color ?? "#497562";

    match(entry.key)
      .with("{player} plays {kind}.", () => {
        const cardKind = entry.parameters?.kind;
        if (actorName && isDevelopmentKind(cardKind)) {
          events.push({ id: allocateId(), kind: "development", cardKind, playerName: actorName, playerColor });
        }
      })
      .with("{player} steals one resource card from {victim}.", () => {
        if (actorName && victimName) {
          events.push({ id: allocateId(), kind: "robbery", thiefName: actorName, victimName, emptyHand: false, playerColor });
        }
      })
      .with("{player} cannot steal a resource from {victim}'s empty hand.", () => {
        if (actorName && victimName) {
          events.push({ id: allocateId(), kind: "robbery", thiefName: actorName, victimName, emptyHand: true, playerColor });
        }
      })
      .with("{player} destroys {victim}'s road.", () => {
        if (actorName && victimName) {
          events.push({ id: allocateId(), kind: "sabotage", pieceKind: "road", actorName, victimName, playerColor });
        }
      })
      .with("{player} destroys {victim}'s ship.", () => {
        if (actorName && victimName) {
          events.push({ id: allocateId(), kind: "sabotage", pieceKind: "ship", actorName, victimName, playerColor });
        }
      })
      .with("{player} destroys {victim}'s settlement.", () => {
        if (actorName && victimName) {
          events.push({ id: allocateId(), kind: "sabotage", pieceKind: "settlement", actorName, victimName, playerColor });
        }
      })
      .with("{player} reduces {victim}'s city to a settlement.", () => {
        if (actorName && victimName) {
          events.push({ id: allocateId(), kind: "sabotage", pieceKind: "city", actorName, victimName, playerColor });
        }
      })
      .otherwise(() => {});
  }

  return events;
}

export function detectPlayerSabotages(
  previous: PublicGame,
  next: PublicGame,
  playerId: string,
  allocateId: () => number,
): SabotageNoticeEvent[] {
  if (previous.gameId !== next.gameId || next.activePlayerId === playerId) return [];
  const events: SabotageNoticeEvent[] = [];

  for (const previousVertex of previous.board.vertices) {
    if (previousVertex.building?.playerId !== playerId) continue;
    const nextVertex = next.board.vertices.find(candidate => candidate.id === previousVertex.id);
    if (!nextVertex?.building) {
      events.push({
        id: allocateId(),
        saboteurId: next.activePlayerId,
        victimId: playerId,
        kind: previousVertex.building.kind,
      });
    } else if (previousVertex.building.kind === "city" && nextVertex.building.kind === "settlement") {
      events.push({
        id: allocateId(),
        saboteurId: next.activePlayerId,
        victimId: playerId,
        kind: "city",
      });
    }
  }

  for (const previousEdge of previous.board.edges) {
    if (previousEdge.playerId !== playerId) continue;
    const nextEdge = next.board.edges.find(candidate => candidate.id === previousEdge.id);
    if (!nextEdge?.playerId) {
      events.push({
        id: allocateId(),
        saboteurId: next.activePlayerId,
        victimId: playerId,
        kind: previousEdge.kind === "ship" ? "ship" : "road",
      });
    }
  }

  return events;
}

export function detectTradeOutcome(
  previous: PublicGame,
  next: PublicGame,
  previousResources: Resources,
  nextResources: Resources,
  playerId: string,
  allocateId: () => number,
): TradeOutcomeEvent | null {
  if (previous.gameId !== next.gameId || !previous.trade || next.trade) return null;
  const entries = newLogEntries(previous, next);
  const completedEntry = entries.find(entry => entry.key === "{player} trades with {other}.");
  const withdrawnEntry = entries.find(entry => entry.key === "{player} withdraws the trade offer.");
  const offeringPlayer = next.players.find(player => player.id === previous.trade!.offeredBy);
  const self = next.players.find(player => player.id === playerId);

  if (completedEntry) {
    const actorName = typeof completedEntry.parameters?.player === "string"
      ? completedEntry.parameters.player
      : offeringPlayer?.name ?? "";
    const otherName = typeof completedEntry.parameters?.other === "string"
      ? completedEntry.parameters.other
      : "";
    const involved = self && (actorName === self.name || otherName === self.name);
    const partnerName = involved ? (actorName === self.name ? otherName : actorName) : undefined;
    const gave = emptyResources();
    const received = emptyResources();
    if (involved) {
      for (const resource of RESOURCES) {
        const delta = nextResources[resource] - previousResources[resource];
        if (delta > 0) received[resource] = delta;
        else if (delta < 0) gave[resource] = -delta;
      }
    }
    return {
      id: allocateId(),
      kind: "completed",
      actorName,
      otherName,
      ...(partnerName ? { partnerName } : {}),
      ...(involved && resourceTotal(gave) > 0 && resourceTotal(received) > 0 ? { gave, received } : {}),
    };
  }

  if (withdrawnEntry) {
    const actorName = typeof withdrawnEntry.parameters?.player === "string"
      ? withdrawnEntry.parameters.player
      : offeringPlayer?.name ?? "";
    // Do not show a withdrawal toast to the player who just clicked Withdraw themselves.
    if (previous.trade.offeredBy === playerId) return null;
    return {
      id: allocateId(),
      kind: "withdrawn",
      actorName,
    };
  }

  if (previous.trade.offeredBy === playerId) return null;
  return {
    id: allocateId(),
    kind: "closed",
    actorName: offeringPlayer?.name ?? "",
  };
}
