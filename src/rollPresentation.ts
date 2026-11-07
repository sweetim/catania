import { emptyResources, RESOURCES } from "./game/engine";
import { isResource } from "./game/board";
import type { GameState, Resource, Resources } from "./game/types";

export type RollOutcome = {
  id: string;
  playerName: string;
  dice: [number, number];
  gains: Record<string, Resources>;
  producingTileIds: string[];
  blockedTileIds: string[];
  shortages: Resource[];
  totalReceived: number;
  pendingGold?: number;
};

export function getRollOutcome(previous: GameState, next: GameState): RollOutcome {
  const gains: Record<string, Resources> = {};
  const paid = emptyResources();
  let totalReceived = 0;
  for (const player of next.players) {
    const previousPlayer = previous.players.find(previousPlayer => previousPlayer.id === player.id)!;
    const received = emptyResources();
    for (const resource of RESOURCES) {
      received[resource] = player.resources[resource] - previousPlayer.resources[resource];
      paid[resource] += received[resource];
      totalReceived += received[resource];
    }
    gains[player.id] = received;
  }

  const dice: [number, number] = [...next.dice!];
  const rolledNumber = dice[0] + dice[1];
  const demand = emptyResources();
  const producingTileIds: string[] = [];
  const blockedTileIds: string[] = [];
  if (rolledNumber !== 7) {
    for (const tile of next.board.tiles) {
      if (tile.number !== rolledNumber || (!isResource(tile.terrain) && tile.terrain !== "gold")) continue;
      if (tile.id === next.robberTileId) {
        blockedTileIds.push(tile.id);
        continue;
      }
      let produced = false;
      for (const vertexId of tile.vertexIds) {
        const building = next.board.vertices.find(vertex => vertex.id === vertexId)!.building;
        if (!building) continue;
        if (isResource(tile.terrain)) {
          demand[tile.terrain] += building.kind === "city" ? 2 : 1;
          if (gains[building.playerId]![tile.terrain] > 0) produced = true;
        } else {
          produced = true;
        }
      }
      if (produced) producingTileIds.push(tile.id);
    }
  }

  return {
    id: `${next.turnNumber}-${next.activePlayerId}`,
    playerName: next.players.find(player => player.id === next.activePlayerId)!.name,
    dice, gains, producingTileIds, blockedTileIds,
    shortages: RESOURCES.filter(resource => demand[resource] > paid[resource]),
    totalReceived,
    ...(next.phase.type === "gold" ? { pendingGold: Object.values(next.phase.required).reduce((total, count) => total + count, 0) } : {}),
  };
}
