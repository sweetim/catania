import { describe, expect, test } from "bun:test";
import { createBoard, generateMapSeed, normalizeMapSeed, pirateStartTileId, seededRandom } from "../../src/game/board";

function randomFromSeed(seed: number): () => number {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
}

describe("standard board", () => {
  test("has the exact island topology, reciprocal graph links, and pointy-top geometry", () => {
    const board = createBoard(randomFromSeed(123));
    expect(board.tiles).toHaveLength(19);
    expect(board.vertices).toHaveLength(54);
    expect(board.edges).toHaveLength(72);
    expect(new Set(board.vertices.map(vertex => `${vertex.x},${vertex.y}`)).size).toBe(54);
    expect(new Set(board.edges.map(edge => [...edge.vertexIds].sort().join(","))).size).toBe(72);
    for (const tile of board.tiles) {
      expect(tile.vertexIds).toHaveLength(6);
      for (const vertexId of tile.vertexIds) {
        const vertex = board.vertices.find(vertex => vertex.id === vertexId)!;
        expect(vertex.tileIds).toContain(tile.id);
        expect(Math.hypot(vertex.x - tile.x, vertex.y - tile.y)).toBeCloseTo(60, 5);
      }
      const top = board.vertices.find(vertex => vertex.id === tile.vertexIds[0])!;
      expect(top.x).toBeCloseTo(tile.x, 5);
      expect(top.y).toBeCloseTo(tile.y - 60, 5);
    }
    for (const vertex of board.vertices) {
      expect(Math.abs(vertex.x)).toBeLessThan(350);
      expect(Math.abs(vertex.y)).toBeLessThan(350);
      expect(vertex.edgeIds.length).toBeGreaterThanOrEqual(2);
      expect(vertex.edgeIds.length).toBeLessThanOrEqual(3);
      expect(vertex.building).toBeNull();
      for (const edgeId of vertex.edgeIds) {
        expect(board.edges.find(edge => edge.id === edgeId)!.vertexIds).toContain(vertex.id);
      }
    }
    for (const edge of board.edges) {
      const [first, second] = edge.vertexIds.map(id => board.vertices.find(vertex => vertex.id === id)!);
      expect(Math.hypot(first!.x - second!.x, first!.y - second!.y)).toBeCloseTo(60, 5);
      expect(edge.playerId).toBeNull();
    }
  });

  test("100 deterministic boards have exact terrain/tokens, separated red numbers, and nine legal ports", () => {
    for (let seed = 1; seed <= 100; seed++) {
      const board = createBoard(randomFromSeed(seed));
      const counts = Object.fromEntries(["wood", "brick", "wool", "grain", "ore", "desert"].map(terrain =>
        [terrain, board.tiles.filter(tile => tile.terrain === terrain).length]));
      expect(counts).toEqual({ wood: 4, brick: 3, wool: 4, grain: 4, ore: 3, desert: 1 });
      expect(board.tiles.find(tile => tile.terrain === "desert")!.number).toBeNull();
      expect(board.tiles.flatMap(tile => tile.number === null ? [] : [tile.number]).sort((first, second) => first - second))
        .toEqual([2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12]);
      const red = board.tiles.filter(tile => tile.number === 6 || tile.number === 8);
      for (const first of red) {
        for (const second of red) {
          if (first !== second) expect(first.vertexIds.filter(id => second.vertexIds.includes(id)).length).toBeLessThan(2);
        }
      }
      expect(board.ports).toHaveLength(9);
      expect(board.ports.map(port => port.resource).sort()).toEqual(["any", "any", "any", "any", "brick", "grain", "ore", "wood", "wool"]);
      const portVertices: string[] = [];
      for (const port of board.ports) {
        const edge = board.edges.find(edge => edge.id === port.edgeId)!;
        expect(board.tiles.filter(tile => edge.vertexIds.every(id => tile.vertexIds.includes(id)))).toHaveLength(1);
        portVertices.push(...edge.vertexIds);
      }
      expect(new Set(portVertices).size).toBe(18);
    }
  });

  test("is reproducible, varies with the seed, and terminates with constant randomness", () => {
    expect(createBoard(randomFromSeed(7))).toEqual(createBoard(randomFromSeed(7)));
    expect(createBoard(randomFromSeed(7))).not.toEqual(createBoard(randomFromSeed(8)));
    expect(createBoard(() => 0).tiles).toHaveLength(19);
    expect(createBoard(() => 0.999999).tiles).toHaveLength(19);
  });

  test("uses the production crypto source without requiring an injected generator", () => {
    expect(createBoard().tiles).toHaveLength(19);
  });

  test.each([NaN, Infinity, -0.1, 1])("rejects invalid random samples: %s", value => {
    expect(() => createBoard(() => value)).toThrow("Random source");
  });
});

describe("four islands board", () => {
  test("rerolls connected islands of four to six hexes with scaled terrain, tokens, and ports", () => {
    const numberPool = [2, 3, 3, 4, 4, 4, 5, 5, 5, 9, 9, 9, 10, 10, 11, 11, 12, 12];
    const numberTrims = [9, 4, 12, 5, 10, 3];
    const sizeTuples = new Set<string>();
    for (let seed = 0; seed < 30; seed++) {
      const board = createBoard(randomFromSeed(seed), "four-islands");
      expect(board.variant).toBe("four-islands");
      expect(board.tiles).toHaveLength(42);
      const landTiles = board.tiles.filter(tile => tile.terrain !== "sea");
      const sizes = [1, 2, 3, 4].map(index => {
        const islandTiles = board.tiles.filter(tile => tile.islandId === `island-${index}`);
        const pending = new Set(islandTiles);
        const reachable = [islandTiles[0]!];
        pending.delete(islandTiles[0]!);
        while (reachable.length > 0) {
          const tile = reachable.pop()!;
          for (const other of [...pending]) {
            if (other.vertexIds.filter(id => tile.vertexIds.includes(id)).length === 2) {
              pending.delete(other);
              reachable.push(other);
            }
          }
        }
        expect(pending.size).toBe(0);
        expect(islandTiles.length).toBeGreaterThanOrEqual(4);
        expect(islandTiles.length).toBeLessThanOrEqual(6);
        return islandTiles.length;
      });
      sizeTuples.add(sizes.join(","));
      const landCount = sizes.reduce((total, size) => total + size, 0);
      expect(landTiles).toHaveLength(landCount);
      expect(board.tiles.filter(tile => tile.terrain === "sea")).toHaveLength(42 - landCount);
      const base = Math.floor(landCount / 5);
      const extras = landCount % 5;
      expect(Object.fromEntries(["wood", "wool", "grain", "brick", "ore"].map(resource =>
        [resource, landTiles.filter(tile => tile.terrain === resource).length])))
        .toEqual(Object.fromEntries(["wood", "wool", "grain", "brick", "ore"].map((resource, index) =>
          [resource, base + (index < extras ? 1 : 0)])));
      const redTarget = Math.round(landCount * 6 / 23);
      const expectedNumbers = [...numberPool];
      for (const value of numberTrims.slice(0, numberPool.length - (landCount - redTarget))) {
        expectedNumbers.splice(expectedNumbers.indexOf(value), 1);
      }
      expectedNumbers.push(...Array(Math.ceil(redTarget / 2)).fill(6), ...Array(Math.floor(redTarget / 2)).fill(8));
      expect(board.tiles.flatMap(tile => tile.number === null ? [] : [tile.number]).sort((first, second) => first - second))
        .toEqual(expectedNumbers.sort((first, second) => first - second));
      const red = board.tiles.filter(tile => tile.number === 6 || tile.number === 8);
      expect(red).toHaveLength(redTarget);
      for (const first of red) {
        for (const second of red) {
          if (first !== second) expect(first.vertexIds.filter(id => second.vertexIds.includes(id)).length).toBeLessThan(2);
        }
      }
      const portVertices: string[] = [];
      for (const port of board.ports) {
        const edge = board.edges.find(edge => edge.id === port.edgeId)!;
        expect(board.tiles.filter(tile => tile.terrain !== "sea" && edge.vertexIds.every(id => tile.vertexIds.includes(id)))).toHaveLength(1);
        portVertices.push(...edge.vertexIds);
      }
      expect(board.ports).toHaveLength(9);
      expect(new Set(portVertices).size).toBe(18);
    }
    expect(sizeTuples.size).toBeGreaterThan(1);
    const allSizes = new Set<number>();
    for (let seed = 0; seed < 100; seed++) {
      for (let index = 1; index <= 4; index++) {
        allSizes.add(createBoard(randomFromSeed(seed), "four-islands").tiles.filter(tile => tile.islandId === `island-${index}`).length);
      }
    }
    expect([...allSizes].sort()).toEqual([4, 5, 6]);
  });

  test("is reproducible from a map code and terminates with constant randomness", () => {
    expect(createBoard(seededRandom("ABCD2345"), "four-islands")).toEqual(createBoard(seededRandom("ABCD2345"), "four-islands"));
    expect(createBoard(seededRandom("ABCD2345"), "four-islands")).not.toEqual(createBoard(seededRandom("WXYZ789P"), "four-islands"));
    expect(createBoard(() => 0, "four-islands").tiles).toHaveLength(42);
    expect(createBoard(() => 0.999999, "four-islands").tiles).toHaveLength(42);
  });
});

describe("fog islands board", () => {
  test("slides the intact continent across all eight positions and hides every surrounding hex", () => {
    const centers = new Set<string>();
    for (let seed = 0; seed < 100; seed++) {
      const board = createBoard(randomFromSeed(seed), "fog-islands");
      expect(board.tiles).toHaveLength(42);
      expect(new Set(board.tiles.map(tile => `${tile.x},${tile.y}`)).size).toBe(42);
      const mainland = board.tiles.filter(tile => tile.islandId === "main");
      expect(mainland).toHaveLength(19);
      const coordinates = mainland.map(tile => {
        const row = Math.round(tile.y / 90 - 1);
        return { column: Math.round(tile.x / (60 * Math.sqrt(3)) - row / 2 + 1), row };
      });
      const centerColumn = coordinates.reduce((total, tile) => total + tile.column, 0) / 19;
      const centerRow = coordinates.reduce((total, tile) => total + tile.row, 0) / 19;
      centers.add(`${centerColumn},${centerRow}`);
      for (const { column, row } of coordinates) {
        expect(Math.max(Math.abs(column - centerColumn), Math.abs(row - centerRow),
          Math.abs(column + row - centerColumn - centerRow))).toBeLessThanOrEqual(2);
        expect(column).toBeGreaterThanOrEqual([1, 0, -1, -1, -2, -2, -2][row + 4]!);
        expect(column).toBeLessThanOrEqual([5, 5, 5, 4, 4, 3, 2][row + 4]!);
      }
      expect(board.tiles.filter(tile => tile.islandId !== "main")).toHaveLength(23);
      expect(board.tiles.filter(tile => tile.islandId !== "main").every(tile => tile.terrain === "fog" && tile.number === null)).toBe(true);
      expect(mainland.every(tile => tile.terrain !== "sea" && tile.terrain !== "fog")).toBe(true);
      expect(pirateStartTileId(board)).toBeNull();
      expect(mainland.flatMap(tile => tile.number === null ? [] : [tile.number]).sort((first, second) => first - second))
        .toEqual([2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12]);
      const portVertices = board.ports.flatMap(port => {
        const edge = board.edges.find(edge => edge.id === port.edgeId)!;
        expect(mainland.filter(tile => edge.vertexIds.every(id => tile.vertexIds.includes(id)))).toHaveLength(1);
        return edge.vertexIds;
      });
      expect(board.ports).toHaveLength(9);
      expect(new Set(portVertices).size).toBe(18);
      const discoveries = board.fogDiscoveryDeck!;
      expect(discoveries).toHaveLength(23);
      expect(Object.fromEntries(["wood", "brick", "wool", "grain", "ore", "gold", "sea"].map(terrain =>
        [terrain, discoveries.filter(discovery => discovery.terrain === terrain).length])))
        .toEqual({ wood: 2, brick: 1, wool: 2, grain: 2, ore: 1, gold: 2, sea: 13 });
      expect(discoveries.filter(discovery => discovery.terrain === "sea").every(discovery => discovery.number === null)).toBe(true);
      expect(discoveries.flatMap(discovery => discovery.number === null ? [] : [discovery.number]).sort((first, second) => first - second))
        .toEqual([2, 3, 4, 5, 6, 8, 9, 10, 11, 12]);
    }
    expect([...centers].sort()).toEqual(["0,0", "1,-1", "1,-2", "1,0", "2,-1", "2,-2", "2,0", "3,-2"]);
  });

  test("terminates with constant randomness and keeps all surrounding tiles concealed", () => {
    for (const random of [() => 0, () => 0.999999]) {
      const board = createBoard(random, "fog-islands");
      expect(board.tiles.filter(tile => tile.terrain === "fog")).toHaveLength(23);
      expect(board.fogDiscoveryDeck).toHaveLength(23);
    }
  });
});

describe("map codes", () => {
  test("generate 8-character codes from the unambiguous alphabet, distinct per map", () => {
    for (let index = 0; index < 32; index++) {
      expect(generateMapSeed()).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/);
    }
    expect(new Set([generateMapSeed(), generateMapSeed(), generateMapSeed(), generateMapSeed()]).size).toBe(4);
  });

  test.each([
    [" abcd2345 ", "ABCD2345"],
    ["abcd2345", "ABCD2345"],
    ["AbCd2345", "ABCD2345"],
  ])("normalize accepted map code %j to %j", (value, expected) => {
    expect(normalizeMapSeed(value)).toBe(expected);
  });

  test.each(["", " ", "abcd234", "abcd23456", "abc12345", "abcd234i", "abcd234l", "abcd234o", "abcd2340", "abcd2341", "abcd 2345", "abcd-2345"])("reject invalid map code %j", value => {
    expect(normalizeMapSeed(value)).toBeNull();
  });

  test("the same code rebuilds the identical island on every device, in every variant", () => {
    for (const variant of ["original", "seafarers", "four-islands", "fog-islands"] as const) {
      const first = createBoard(seededRandom("ABCD2345"), variant);
      const second = createBoard(seededRandom("ABCD2345"), variant);
      expect(first).toEqual(second);
      expect(createBoard(seededRandom("WXYZ789P"), variant)).not.toEqual(first);
    }
    for (let index = 0; index < 100; index++) {
      const value = seededRandom("ABCD2345")();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
    expect(seededRandom("ABCD2345")()).toBe(seededRandom("ABCD2345")());
    expect(seededRandom("ABCD2345")()).not.toBe(seededRandom("WXYZ789P")());
  });
});
