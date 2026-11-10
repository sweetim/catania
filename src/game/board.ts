import { GameError } from "./messages";
import { isSeafarers } from "./types";
import type { Board, Edge, FogDiscovery, GameVariant, Port, Resource, Terrain, Tile, Vertex } from "./types";

export function isResource(terrain: Terrain): terrain is Resource {
  return terrain !== "desert" && terrain !== "sea" && terrain !== "gold" && terrain !== "fog";
}

export function isLand(terrain: Terrain): boolean {
  return terrain !== "sea" && terrain !== "fog";
}

export function edgeTiles(board: Board, edge: Edge): Tile[] {
  return board.tiles.filter(tile => edge.vertexIds.every(id => tile.vertexIds.includes(id)));
}

/** Locates a harbor's walkway start (coast-edge midpoint) and its label anchor at sea. */
export function portAnchor(board: Board, port: Port): { x: number; y: number; portX: number; portY: number } {
  const edge = board.edges.find(edge => edge.id === port.edgeId)!;
  const first = board.vertices.find(vertex => vertex.id === edge.vertexIds[0])!;
  const second = board.vertices.find(vertex => vertex.id === edge.vertexIds[1])!;
  const x = (first.x + second.x) / 2;
  const y = (first.y + second.y) / 2;
  const distance = Math.hypot(x, y);
  const land = edgeTiles(board, edge).find(tile => tile.terrain !== "sea" && tile.terrain !== "fog");
  // A Foggy World harbor may sit beside unrevealed fog; point its label away from the board center instead.
  const coastDistance = land === undefined ? distance : Math.hypot(x - land.x, y - land.y);
  const directionX = land !== undefined && isSeafarers(board.variant) ? (x - land.x) / coastDistance : x / distance;
  const directionY = land !== undefined && isSeafarers(board.variant) ? (y - land.y) / coastDistance : y / distance;
  return { x, y, portX: x + directionX * 51, portY: y + directionY * 51 };
}

/** The land-side hex a harbor sits on, or its initial fog anchor before placement. */
export function portHexId(board: Board, port: Port): string {
  const edge = board.edges.find(edge => edge.id === port.edgeId)!;
  const tiles = edgeTiles(board, edge);
  return (tiles.find(tile => tile.terrain !== "sea" && tile.terrain !== "fog") ?? tiles.find(tile => tile.islandId === "main"))!.id;
}

function isRevealedCoast(board: Board, edge: Edge): boolean {
  const tiles = edgeTiles(board, edge);
  return tiles.filter(tile => isLand(tile.terrain)).length === 1 &&
    tiles.every(tile => tile.terrain !== "fog");
}

/** Foggy World harbors need a placed, revealed land-sea coast, including the outer map edge. */
export function isPortRevealed(board: Board, port: Port): boolean {
  return board.variant !== "foggy-world" ||
    (!port.awaitingCoast && isRevealedCoast(board, board.edges.find(edge => edge.id === port.edgeId)!));
}

export function relocateFoggyWorldPorts(board: Board): void {
  if (board.variant !== "foggy-world") return;
  const coastEdges = board.edges.filter(edge => isRevealedCoast(board, edge));
  const establishedPorts = new Set(board.ports.filter(port => isPortRevealed(board, port)));
  const occupiedVertices = new Set(board.ports.filter(port => establishedPorts.has(port))
    .flatMap(port => board.edges.find(edge => edge.id === port.edgeId)!.vertexIds));
  const verticesById = new Map(board.vertices.map(vertex => [vertex.id, vertex]));
  const midpoint = (edge: Edge) => {
    const first = verticesById.get(edge.vertexIds[0])!;
    const second = verticesById.get(edge.vertexIds[1])!;
    return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
  };
  for (const port of board.ports) {
    if (establishedPorts.has(port)) continue;
    const origin = midpoint(board.edges.find(edge => edge.id === port.edgeId)!);
    const distance = (edge: Edge) => {
      const position = midpoint(edge);
      return Math.hypot(position.x - origin.x, position.y - origin.y);
    };
    const destination = coastEdges.filter(edge => edge.vertexIds.every(id => !occupiedVertices.has(id)))
      .sort((first, second) => distance(first) - distance(second))[0];
    if (destination === undefined) {
      // Retain the old edge only as a deterministic relocation origin, never as an active harbor.
      port.awaitingCoast = true;
      continue;
    }
    port.edgeId = destination.id;
    delete port.awaitingCoast;
    destination.vertexIds.forEach(id => occupiedVertices.add(id));
  }
}

/** Lists number-carrying tiles covered by a harbor label, so the board can offer a press-and-hold peek. */
export function hiddenNumberTileIds(board: Board): string[] {
  const anchors = board.ports.filter(port => isPortRevealed(board, port)).map(port => portAnchor(board, port));
  return board.tiles
    .filter(tile => tile.terrain !== "fog" && tile.number !== null)
    .filter(tile => anchors.some(anchor => {
      const nearestX = Math.max(anchor.portX - 27, Math.min(tile.x, anchor.portX + 27));
      const nearestY = Math.max(anchor.portY - 17, Math.min(tile.y + 2, anchor.portY + 17));
      return Math.hypot(tile.x - nearestX, tile.y + 2 - nearestY) < 19;
    }))
    .map(tile => tile.id);
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

const SEAFARERS_ROW_RANGES: [number, number][] = [[1, 5], [0, 5], [-1, 5], [-1, 4], [-2, 4], [-2, 3], [-2, 2]];

/** Grows 19 starting land hexes within separated regions, then reflects the layout within the frame. */
function fogIslandLayout(random: () => number): [number, number][] {
  const frame = SEAFARERS_ROW_RANGES.flatMap(([firstColumn, lastColumn], index) =>
    Array.from({ length: lastColumn - firstColumn + 1 }, (_, offset): [number, number] => [firstColumn + offset, index - 4]));
  const islandCount = 1 + randomInteger(4, random);
  let regions: [number, number][][];
  let sizes: number[];
  if (islandCount === 1) {
    regions = [frame];
    sizes = [19];
  } else if (islandCount === 2) {
    regions = randomInteger(2, random) === 0
      ? [frame.filter(([, row]) => row <= -2), frame.filter(([, row]) => row >= 0)]
      : [frame.filter(([column]) => column <= 0), frame.filter(([column]) => column >= 2)];
    const firstSize = 8 + randomInteger(4, random);
    sizes = [firstSize, 19 - firstSize];
  } else if (islandCount === 3) {
    regions = [frame.filter(([, row]) => row <= -2),
      frame.filter(([column, row]) => row >= 0 && column <= 0),
      frame.filter(([column, row]) => row >= 0 && column >= 2)];
    const leftSize = 5 + randomInteger(4, random);
    const rightSize = 4 + randomInteger(3, random);
    sizes = [19 - leftSize - rightSize, leftSize, rightSize];
  } else {
    regions = [
      [[1, -4], [2, -4], [0, -3], [1, -3], [0, -2], [1, -2]],
      [[4, -4], [5, -4], [4, -3], [5, -3], [4, -2], [5, -2]],
      [[-2, 0], [-1, 0], [-2, 1], [-1, 1], [-2, 2], [-1, 2]],
      [[2, 0], [3, 0], [2, 1], [3, 1], [1, 2], [2, 2]],
    ];
    sizes = [4, 4, 4, 4];
    for (let extra = 0; extra < 3; extra++) {
      const available = [0, 1, 2, 3].filter(index => sizes[index]! < 6);
      const islandIndex = available[randomInteger(available.length, random)]!;
      sizes[islandIndex] = sizes[islandIndex]! + 1;
    }
  }
  const reflection = randomInteger(4, random);
  return regions.flatMap((region, index) => {
    const island = [region[randomInteger(region.length, random)]!];
    while (island.length < sizes[index]!) {
      const frontier = region.filter(position => !island.includes(position) && island.some(([column, row]) =>
        HEX_NEIGHBOR_OFFSETS.some(([offsetColumn, offsetRow]) =>
          position[0] === column + offsetColumn && position[1] === row + offsetRow)));
      island.push(frontier[randomInteger(frontier.length, random)]!);
    }
    return island.map(([column, row]): [number, number] => {
      if (reflection & 1) column = 2 - row - column;
      if (reflection & 2) [column, row] = [column + row + 1, -2 - row];
      return [column, row];
    });
  });
}

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
  let fogDiscoveriesByTileId: Record<string, FogDiscovery> | undefined;
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
      for (const [column, row] of fogIslandLayout(random)) {
        positions.push({ column, row, islandId: "main" });
      }
      const discoveryNumbers = shuffle([2, 3, 4, 5, 6, 8, 9, 10, 11, 12], random);
      fogDiscoveryDeck = shuffle<FogDiscovery["terrain"]>([
        "wood", "wood", "brick", "wool", "wool", "grain", "grain", "ore", "gold", "gold",
        ...Array<FogDiscovery["terrain"]>(13).fill("sea"),
      ], random).map(terrain => ({ terrain, number: terrain === "sea" ? null : discoveryNumbers.pop()! }));
    } else if (variant === "foggy-world") {
      positions.length = 0;
      terrain.length = 0;
      // The hidden island only anchors the harbors; its hexes stay fog like the rest of the world.
      for (const [column, row] of fogIslandLayout(random)) {
        positions.push({ column, row, islandId: "main" });
        terrain.push("fog");
      }
      const discoveryNumbers = shuffle([2, 3, 3, 4, 4, 5, 5, 9, 9, 10, 10, 11, 11, 12, 6, 6, 8, 8,
        2, 3, 4, 5, 6, 8, 9, 10, 11, 12], random);
      fogDiscoveriesByTileId = Object.fromEntries(shuffle<FogDiscovery["terrain"]>([
        "wood", "wood", "wood", "wood", "wood", "wood",
        "brick", "brick", "brick", "brick",
        "wool", "wool", "wool", "wool", "wool", "wool",
        "grain", "grain", "grain", "grain", "grain", "grain",
        "ore", "ore", "ore", "ore",
        "gold", "gold", "desert",
        ...Array<FogDiscovery["terrain"]>(13).fill("sea"),
      ], random).map((terrain, index) => [`tile-${index}`, {
        terrain, number: terrain === "sea" || terrain === "desert" ? null : discoveryNumbers.pop()!,
      }]));
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
    for (const [index, range] of SEAFARERS_ROW_RANGES.entries()) {
      const row = index - 4;
      for (let column = range[0]!; column <= range[1]!; column++) {
        if (positions.some(position => position.column === column && position.row === row)) continue;
        positions.push({ column, row });
        terrain.push(variant === "fog-islands" || variant === "foggy-world" ? "fog" : "sea");
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
    : variant === "four-islands" ? Math.round(producingTiles.length * 6 / 23)
    : variant === "foggy-world" ? 0 : 4;
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
    const edge = variant === "four-islands" || variant === "fog-islands" || variant === "foggy-world"
      ? [...boundary.slice(start), ...boundary.slice(0, start)].find(edge => edge.vertexIds.every(id => !portVertices.has(id)))!
      : boundary[start]!;
    edge.vertexIds.forEach(id => portVertices.add(id));
    return { edgeId: edge.id, resource };
  });
  return { tiles, vertices, edges, ports, ...(isSeafarers(variant) ? { variant } : {}),
    ...(fogDiscoveryDeck ? { fogDiscoveryDeck } : {}),
    ...(fogDiscoveriesByTileId ? { fogDiscoveriesByTileId } : {}) };
}

/** Picks the pirate ship's starting sea tile, so it varies with every shuffle. */
export function pirateStartTileId(board: Board, random: () => number = secureRandom): string | null {
  const seaTiles = board.tiles.filter(tile => tile.terrain === "sea");
  return seaTiles.length === 0 ? null : seaTiles[randomInteger(seaTiles.length, random)]!.id;
}
