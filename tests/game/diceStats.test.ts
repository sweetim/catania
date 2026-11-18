import { describe, expect, test } from "bun:test";
import { diceRollCounts } from "../../src/game/engine";
import type { GameMessage } from "../../src/game/messages";

function roll(first: number, second: number): GameMessage {
  return { key: "{player} rolls {first} + {second} = {total}.", parameters: { player: "Ada", first, second, total: first + second } };
}

describe("diceRollCounts", () => {
  test("returns eleven zeroes for a log without rolls", () => {
    const log: GameMessage[] = [{ key: "{player} begins the first settlement placement.", parameters: { player: "Ada" } }];
    expect(diceRollCounts(log)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  test("counts each roll total from 2 through 12 and ignores other messages", () => {
    const log: GameMessage[] = [
      { key: "{player} begins a turn.", parameters: { player: "Ada" } },
      roll(1, 1),
      roll(3, 4),
      roll(3, 4),
      roll(6, 6),
      { key: "{player} builds a settlement.", parameters: { player: "Grace" } },
    ];
    expect(diceRollCounts(log)).toEqual([1, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1]);
  });

  test("ignores roll messages without a usable total", () => {
    const log: GameMessage[] = [
      { key: "{player} rolls {first} + {second} = {total}." },
      { key: "{player} rolls {first} + {second} = {total}.", parameters: { player: "Ada", first: 6, second: 7, total: 13 } },
    ];
    expect(diceRollCounts(log)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  test("does not mutate the log", () => {
    const log = [roll(2, 5)];
    const before = structuredClone(log);
    diceRollCounts(log);
    expect(log).toEqual(before);
  });
});
