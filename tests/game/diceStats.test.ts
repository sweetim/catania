import { describe, expect, test } from "bun:test";
import { applyAction, createGame, diceRollCounts } from "../../src/game/engine";
import { seededRandom } from "../../src/game/board";
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

  test("GameState.diceRollTotals retains every roll even after state.log trims past 100 entries", () => {
    let state = createGame([
      { name: "Ada", color: "#b85d47", control: "human" },
      { name: "Grace", color: "#477c91", control: "human" },
      { name: "Lin", color: "#c1953d", control: "human" },
    ], seededRandom("dice-stats-seed"));
    state.phase = { type: "roll" };
    state.turnNumber = 1;
    const totalRolls = 60;
    for (let turn = 0; turn < totalRolls; turn++) {
      // Force non-7 rolls (1 + 2 = 3) so each turn rolls and ends cleanly.
      const dice = [0, 1 / 6];
      let cursor = 0;
      state = applyAction(state, state.activePlayerId, { type: "roll" }, () => dice[cursor++]!);
      state = applyAction(state, state.activePlayerId, { type: "end-turn" });
    }
    expect(state.log.length).toBe(100);
    // Log-only counting loses early rolls once state.log trims to 100 entries.
    expect(diceRollCounts(state.log).reduce((sum, count) => sum + count, 0)).toBeLessThan(totalRolls);
    // Cumulative diceRollTotals preserves every roll across the full game.
    expect(state.diceRollTotals.reduce((sum, count) => sum + count, 0)).toBe(totalRolls);
    expect(state.diceRollTotals[3 - 2]).toBe(totalRolls);
  });
});
