import type { Board, Edge, Resource, Terrain, Tile, Vertex } from "./types";

export function secureRandom(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]! / 0x100000000;
}

export function randomInteger(limit: number, random: () => number): number {
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new Error("Random source must return a number from 0 (inclusive) to 1 (exclusive).");
  }
  return Math.floor(value * limit);
}

export function shuffle<Value>(values: Value[], random: () => number): Value[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index--) {
    const other = randomInteger(index + 1, random);
    [result[index], result[other]] = [result[other]!, result[index]!];
  }
  return result;
}

export function createBoard(random: () => number = secureRandom): Board {
  const terrain = shuffle<Terrain>([
    "wood", "wood", "wood", "wood", "brick", "brick", "brick",
    "wool", "wool", "wool", "wool", "grain", "grain", "grain", "grain",
    "ore", "ore", "ore", "desert",
  ], random);
  const tiles: Tile[] = [];
  const vertices: Vertex[] = [];
  const edges: Edge[] = [];
  const vertexByPosition = new Map<string, Vertex>();
  const edgeByVertices = new Map<string, Edge>();
  const edgeTileCounts = new Map<string, number>();

  for (let column = -2; column <= 2; column++) {
    for (let row = -2; row <= 2; row++) {
      if (Math.abs(column + row) > 2) continue;
      const tile: Tile = {
        id: `tile-${tiles.length}`,
        x: 60 * Math.sqrt(3) * (column + row / 2),
        y: 90 * row,
        terrain: terrain[tiles.length]!,
        number: null,
        vertexIds: [],
      };
      for (let corner = 0; corner < 6; corner++) {
        const angle = (corner * 60 - 90) * Math.PI / 180;
        const x = Math.round((tile.x + 60 * Math.cos(angle)) * 1000000) / 1000000;
        const y = Math.round((tile.y + 60 * Math.sin(angle)) * 1000000) / 1000000;
        const position = `${x},${y}`;
        let vertex = vertexByPosition.get(position);
        if (!vertex) {
          vertex = { id: `vertex-${vertices.length}`, x, y, tileIds: [], edgeIds: [], building: null };
          vertexByPosition.set(position, vertex);
          vertices.push(vertex);
        }
        vertex.tileIds.push(tile.id);
        tile.vertexIds.push(vertex.id);
      }
      for (let corner = 0; corner < 6; corner++) {
        const vertexIds: [string, string] = [tile.vertexIds[corner]!, tile.vertexIds[(corner + 1) % 6]!];
        const key = [...vertexIds].sort().join(",");
        let edge = edgeByVertices.get(key);
        if (!edge) {
          edge = { id: `edge-${edges.length}`, vertexIds, playerId: null };
          edgeByVertices.set(key, edge);
          edges.push(edge);
          for (const vertexId of vertexIds) vertices.find(vertex => vertex.id === vertexId)!.edgeIds.push(edge.id);
        }
        edgeTileCounts.set(edge.id, (edgeTileCounts.get(edge.id) ?? 0) + 1);
      }
      tiles.push(tile);
    }
  }

  const producingTiles = shuffle(tiles.filter(tile => tile.terrain !== "desert"), random);
  // Backtracking terminates even with a constant injected random source, unlike reshuffle-until-valid.
  const redTiles: Tile[] = [];
  function selectRedTiles(start: number): boolean {
    if (redTiles.length === 4) return true;
    for (let index = start; index < producingTiles.length; index++) {
      const candidate = producingTiles[index]!;
      if (redTiles.some(tile => tile.vertexIds.filter(id => candidate.vertexIds.includes(id)).length === 2)) continue;
      redTiles.push(candidate);
      if (selectRedTiles(index + 1)) return true;
      redTiles.pop();
    }
    return false;
  }
  if (!selectRedTiles(0)) throw new Error("Unable to arrange nonadjacent red number tokens.");
  const redNumbers = shuffle([6, 6, 8, 8], random);
  const otherNumbers = shuffle([2, 3, 3, 4, 4, 5, 5, 9, 9, 10, 10, 11, 11, 12], random);
  for (const tile of producingTiles) tile.number = redTiles.includes(tile) ? redNumbers.pop()! : otherNumbers.pop()!;

  const boundary = edges.filter(edge => edgeTileCounts.get(edge.id) === 1);
  const angleOf = (edge: Edge) => {
    const first = vertices.find(vertex => vertex.id === edge.vertexIds[0])!;
    const second = vertices.find(vertex => vertex.id === edge.vertexIds[1])!;
    return Math.atan2(first.y + second.y, first.x + second.x);
  };
  boundary.sort((first, second) => angleOf(first) - angleOf(second));
  const portResources = shuffle<Resource | "any">([
    "any", "any", "any", "any", "wood", "brick", "wool", "grain", "ore",
  ], random);
  const offset = randomInteger(boundary.length, random);
  const ports = portResources.map((resource, index) => ({
    edgeId: boundary[(offset + Math.floor(index * boundary.length / 9)) % boundary.length]!.id,
    resource,
  }));
  return { tiles, vertices, edges, ports };
}
