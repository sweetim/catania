import { GameError } from "./messages";
import { isSeafarers } from "./types";
import type { Board, Edge, FogDiscovery, GameVariant, Resource, Terrain, Tile, Vertex } from "./types";

export function isResource(terrain: Terrain): terrain is Resource {
  return terrain !== "desert" && terrain !== "sea" && terrain !== "gold" && terrain !== "fog";
}

export function isLand(terrain: Terrain): boolean {
  return terrain !== "sea" && terrain !== "fog";
}

export function edgeTiles(board: Board, edge: Edge): Tile[] {
  return board.tiles.filter(tile => edge.vertexIds.every(id => tile.vertexIds.includes(id)));
}

export function secureRandom(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]! / 0x100000000;
}

export function randomInteger(limit: number, random: () => number): number {
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new GameError("Random source must return a number from 0 (inclusive) to 1 (exclusive).");
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

const HEX_NEIGHBOR_OFFSETS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]];

/** Picks a random connected subset of a six-hex island region, so shuffles vary each island's footprint. */
function islandShape(region: [number, number][], size: number, random: () => number): [number, number][] {
  const shapes: [number, number][][] = [];
  for (let mask = 1; mask < 1 << region.length; mask++) {
    const tiles = region.filter((_, index) => (mask & (1 << index)) !== 0);
    if (tiles.length !== size) continue;
    const pending = new Set(tiles);
    const reachable: [number, number][] = [tiles[0]!];
    while (reachable.length > 0) {
      const [column, row] = reachable.pop()!;
      for (const tile of [...pending]) {
        if (HEX_NEIGHBOR_OFFSETS.some(([offsetColumn, offsetRow]) =>
          tile[0] === column + offsetColumn && tile[1] === row + offsetRow)) {
          pending.delete(tile);
          reachable.push(tile);
        }
      }
    }
    if (pending.size === 0) shapes.push(tiles);
  }
  return shapes[randomInteger(shapes.length, random)]!;
}

const FOUR_ISLAND_NUMBERS = [2, 3, 3, 4, 4, 4, 5, 5, 5, 9, 9, 9, 10, 10, 11, 11, 12, 12];
const FOUR_ISLAND_NUMBER_TRIMS = [9, 4, 12, 5, 10, 3];

/** Every axial center where the 19-hex continent fits inside the fixed 42-hex Seafarers frame. */
const FOG_ISLAND_CENTERS: [number, number][] = [[0, 0], [1, -2], [1, -1], [1, 0], [2, -2], [2, -1], [2, 0], [3, -2]];

/** Scales the non-red token pool to the island hex count, keeping the 23-hex list unchanged. */
function fourIslandsOtherNumbers(needed: number): number[] {
  const numbers = [...FOUR_ISLAND_NUMBERS];
  for (const value of FOUR_ISLAND_NUMBER_TRIMS.slice(0, FOUR_ISLAND_NUMBERS.length - needed)) {
    numbers.splice(numbers.indexOf(value), 1);
  }
  return numbers;
}

const MAP_SEED_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const MAP_SEED_PATTERN = new RegExp(`^[${MAP_SEED_ALPHABET}]{8}$`);

/** Generates a random 8-character map code; entering the code later rebuilds the exact island. */
export function generateMapSeed(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map(byte => MAP_SEED_ALPHABET[byte % MAP_SEED_ALPHABET.length]!).join("");
}

/** Normalizes user-entered map codes (trim and uppercase); null when the code is not a valid seed. */
export function normalizeMapSeed(value: string): string | null {
  const seed = value.trim().toUpperCase();
  return MAP_SEED_PATTERN.test(seed) ? seed : null;
}

function hashSeed(seed: string): number {
  let hash = 1779033703 ^ seed.length;
  for (let index = 0; index < seed.length; index++) {
    hash = Math.imul(hash ^ seed.charCodeAt(index), 3432918353);
    hash = (hash << 13) | (hash >>> 19);
  }
  return hash >>> 0;
}

/** Deterministic random source for a map code: the same code and variant rebuild the same island on every device. */
export function seededRandom(seed: string): () => number {
  let state = hashSeed(seed);
  return () => {
    state = (state + 0x6D2B79F5) | 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function createBoard(random: () => number = secureRandom, variant: GameVariant = "original"): Board {
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

  const positions: { column: number; row: number; islandId?: string }[] = [];
  for (let column = -2; column <= 2; column++) {
    for (let row = -2; row <= 2; row++) {
      if (Math.abs(column + row) <= 2) positions.push({ column, row, islandId: "main" });
    }
  }
  let fogDiscoveryDeck: FogDiscovery[] | undefined;
  if (isSeafarers(variant)) {
    if (variant === "four-islands") {
      positions.length = 0;
      terrain.length = 0;
      const regions: [number, number][][] = [
        [[1, -4], [2, -4], [0, -3], [1, -3], [0, -2], [1, -2]],
        [[4, -4], [5, -4], [4, -3], [5, -3], [4, -2], [5, -2]],
        [[-2, 0], [-1, 0], [-2, 1], [-1, 1], [-2, 2], [-1, 2]],
        [[2, 0], [3, 0], [2, 1], [3, 1], [1, 2], [2, 2]],
      ];
      const islandSizes = regions.map(() => 4 + randomInteger(3, random));
      const islandLandCount = islandSizes.reduce((total, size) => total + size, 0);
      const islandTerrain = shuffle<Terrain>((["wood", "wool", "grain", "brick", "ore"] as const).flatMap((resource, index) =>
        Array<Terrain>(Math.floor(islandLandCount / 5) + (index < islandLandCount % 5 ? 1 : 0)).fill(resource)), random);
      for (const [index, region] of regions.entries()) {
        for (const [column, row] of islandShape(region, islandSizes[index]!, random)) {
          positions.push({ column, row, islandId: `island-${index + 1}` });
          terrain.push(islandTerrain.shift()!);
        }
      }
    } else if (variant === "fog-islands") {
      positions.length = 0;
      const [centerColumn, centerRow] = FOG_ISLAND_CENTERS[randomInteger(FOG_ISLAND_CENTERS.length, random)]!;
      for (let column = centerColumn - 2; column <= centerColumn + 2; column++) {
        for (let row = centerRow - 2; row <= centerRow + 2; row++) {
          if (Math.abs(column + row - centerColumn - centerRow) <= 2) positions.push({ column, row, islandId: "main" });
        }
      }
      const discoveryNumbers = shuffle([2, 3, 4, 5, 6, 8, 9, 10, 11, 12], random);
      fogDiscoveryDeck = shuffle<FogDiscovery["terrain"]>([
        "wood", "wood", "brick", "wool", "wool", "grain", "grain", "ore", "gold", "gold",
        ...Array<FogDiscovery["terrain"]>(13).fill("sea"),
      ], random).map(terrain => ({ terrain, number: terrain === "sea" ? null : discoveryNumbers.pop()! }));
    } else {
      const islands = [
        [[1, -4], [2, -4]],
        [[4, -4], [4, -3], [5, -3], [4, -2], [4, -1]],
        [[3, 1], [2, 2]],
      ];
      const islandTerrain = shuffle<Terrain>(["ore", "wool", "gold", "brick", "ore", "wood", "gold", "brick", "grain"], random);
      for (const [index, island] of islands.entries()) {
        for (const [column, row] of island) {
          positions.push({ column: column!, row: row!, islandId: `island-${index + 1}` });
          terrain.push(islandTerrain.shift()!);
        }
      }
    }
    const rowRanges = [[1, 5], [0, 5], [-1, 5], [-1, 4], [-2, 4], [-2, 3], [-2, 2]];
    for (const [index, range] of rowRanges.entries()) {
      const row = index - 4;
      for (let column = range[0]!; column <= range[1]!; column++) {
        if (positions.some(position => position.column === column && position.row === row)) continue;
        positions.push({ column, row });
        terrain.push(variant === "fog-islands" ? "fog" : "sea");
      }
    }
  }
  for (const { column, row, islandId } of positions) {
      const tile: Tile = {
        id: `tile-${tiles.length}`,
        x: 60 * Math.sqrt(3) * (column + row / 2 - (isSeafarers(variant) ? 1 : 0)),
        y: 90 * (row + (isSeafarers(variant) ? 1 : 0)),
        terrain: terrain[tiles.length]!,
        number: null,
        vertexIds: [],
        ...(isSeafarers(variant) && islandId ? { islandId } : {}),
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

  const producingTiles = shuffle(tiles.filter(tile => isResource(tile.terrain) || tile.terrain === "gold"), random);
  // Backtracking terminates even with a constant injected random source, unlike reshuffle-until-valid.
  const redTileTarget = variant === "seafarers" ? 6
    : variant === "four-islands" ? Math.round(producingTiles.length * 6 / 23) : 4;
  const redTiles: Tile[] = [];
  function selectRedTiles(start: number): boolean {
    if (redTiles.length === redTileTarget) return true;
    for (let index = start; index < producingTiles.length; index++) {
      const candidate = producingTiles[index]!;
      if (variant === "seafarers" && redTiles.filter(tile => (tile.islandId === "main") === (candidate.islandId === "main")).length >=
        (candidate.islandId === "main" ? 4 : 2)) continue;
      if (redTiles.some(tile => tile.vertexIds.filter(id => candidate.vertexIds.includes(id)).length === 2)) continue;
      redTiles.push(candidate);
      if (selectRedTiles(index + 1)) return true;
      redTiles.pop();
    }
    return false;
  }
  if (!selectRedTiles(0)) throw new GameError("Unable to arrange nonadjacent red number tokens.");
  const redNumbers = shuffle(variant === "four-islands"
    ? [...Array<number>(Math.ceil(redTileTarget / 2)).fill(6), ...Array<number>(Math.floor(redTileTarget / 2)).fill(8)]
    : [6, 6, 8, 8], random);
  const otherNumbers = shuffle(variant === "four-islands"
    ? fourIslandsOtherNumbers(producingTiles.length - redTileTarget)
    : [2, 3, 3, 4, 4, 5, 5, 9, 9, 10, 10, 11, 11, 12], random);
  const islandRedNumbers = variant === "seafarers" ? shuffle([6, 8], random) : [];
  const islandOtherNumbers = variant === "seafarers" ? shuffle([2, 3, 4, 5, 9, 10, 11], random) : [];
  for (const tile of producingTiles) {
    const remote = variant === "seafarers" && tile.islandId !== "main";
    tile.number = redTiles.includes(tile)
      ? (remote ? islandRedNumbers : redNumbers).pop()!
      : (remote ? islandOtherNumbers : otherNumbers).pop()!;
  }

  const boundary = edges.filter(edge => isSeafarers(variant)
    ? tiles.filter(tile => (variant === "four-islands" ? isLand(tile.terrain) : tile.islandId === "main") &&
      edge.vertexIds.every(id => tile.vertexIds.includes(id))).length === 1
    : edgeTileCounts.get(edge.id) === 1);
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
  const portVertices = new Set<string>();
  const ports = portResources.map((resource, index) => {
    const start = (offset + Math.floor(index * boundary.length / 9)) % boundary.length;
    const edge = variant === "four-islands"
      ? [...boundary.slice(start), ...boundary.slice(0, start)].find(edge => edge.vertexIds.every(id => !portVertices.has(id)))!
      : boundary[start]!;
    edge.vertexIds.forEach(id => portVertices.add(id));
    return { edgeId: edge.id, resource };
  });
  return { tiles, vertices, edges, ports, ...(isSeafarers(variant) ? { variant } : {}),
    ...(fogDiscoveryDeck ? { fogDiscoveryDeck } : {}) };
}

/** Picks the pirate ship's starting sea tile, so it varies with every shuffle. */
export function pirateStartTileId(board: Board, random: () => number = secureRandom): string | null {
  const seaTiles = board.tiles.filter(tile => tile.terrain === "sea");
  return seaTiles.length === 0 ? null : seaTiles[randomInteger(seaTiles.length, random)]!.id;
}
