import { describe, expect, test } from "bun:test";
import { createBoard } from "../../src/game/board";

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
