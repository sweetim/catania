import { chooseComputerAction as baselineAction } from "./computer-baseline";
import { chooseComputerAction as challengerAction } from "./computer-challenger";
import { applyAction, createGame, getScore } from "../src/game/engine";
import { DEFAULT_CUSTOM_MAP_CONFIG, isGameVariant } from "../src/game/types";
import type { GameState, GameVariant, Player } from "../src/game/types";

type Chooser = typeof baselineAction;

const trackedActions = ["place-city", "place-settlement", "place-road", "place-ship", "buy-development",
  "play-development", "bank-trade", "complete-trade", "request-trade", "offer-trade"] as const;

type GameResult = {
  winner: string;
  steps: number;
  turns: number;
  scores: Map<string, number>;
  counts: Map<string, Map<string, number>>;
};

// splitmix32: a small, fast PRNG without the LCG serial correlation that
// skews createGame's seat shuffle across seeds.
function seededRandom(initial: number): () => number {
  let seed = (initial >>> 0) || 0x9e3779b9;
  return () => {
    seed = (seed + 0x9e3779b9) >>> 0;
    let mixed = seed;
    mixed = Math.imul(mixed ^ (mixed >>> 16), 0x21f0aaad);
    mixed = Math.imul(mixed ^ (mixed >>> 15), 0x735a2d97);
    return ((mixed ^ (mixed >>> 15)) >>> 0) / 0x100000000;
  };
}

function playGame(
  seed: number,
  profiles: Pick<Player, "name" | "color" | "control">[],
  chooser: (name: string) => Chooser,
  variant: GameVariant,
): GameResult | null {
  const random = seededRandom(seed);
  let state: GameState = variant === "custom-world"
    ? createGame(profiles, random, undefined, variant, undefined, DEFAULT_CUSTOM_MAP_CONFIG)
    : createGame(profiles, random, undefined, variant);
  let steps = 0;
  const counts = new Map(state.players.map(player => [player.name, new Map<string, number>()]));
  while (!state.winnerId && steps < 5000) {
    const now = 1_000_000 + steps;
    const decision = state.players
      .map(player => ({ player, action: chooser(player.name)(state, player.id, now) }))
      .find(decision => decision.action);
    if (!decision) throw new Error(`Seed ${seed} (${variant}) deadlocked at step ${steps}, phase ${state.phase.type}`);
    state = applyAction(state, decision.player.id, decision.action!, random, now);
    const playerCounts = counts.get(decision.player.name)!;
    playerCounts.set(decision.action!.type, (playerCounts.get(decision.action!.type) ?? 0) + 1);
    steps++;
  }
  if (!state.winnerId) return null;
  return {
    winner: state.players.find(player => player.id === state.winnerId)!.name,
    steps,
    turns: state.turnNumber,
    scores: new Map(state.players.map(player => [player.name, getScore(state, player.id).total])),
    counts,
  };
}

function wilson(successes: number, total: number): [number, number] {
  const z = 1.96;
  const p = successes / total;
  const denominator = 1 + z * z / total;
  const center = (p + z * z / (2 * total)) / denominator;
  const spread = z * Math.sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / denominator;
  return [center - spread, center + spread];
}

// Each seed plays a family of games on the identical board, dice stream, and
// development deck, with the challenger seated in complementary positions:
// - 4p: two games, pair-swapped, so every seat flips challenger/baseline.
// - 3p: three games, cyclically rotated, so the challenger holds each seat once.
// This cancels map and seat luck; only decision quality decides the win rate.
function seedFamilies(mode: string): Pick<Player, "name" | "color" | "control">[][] {
  if (mode === "3p") {
    return [
      [{ name: "New A", color: "red", control: "computer" }, { name: "Old A", color: "blue", control: "computer" }, { name: "Old B", color: "white", control: "computer" }],
      [{ name: "Old A", color: "blue", control: "computer" }, { name: "Old B", color: "white", control: "computer" }, { name: "New A", color: "red", control: "computer" }],
      [{ name: "Old B", color: "white", control: "computer" }, { name: "New A", color: "red", control: "computer" }, { name: "Old A", color: "blue", control: "computer" }],
    ];
  }
  return [
    [{ name: "New A", color: "red", control: "computer" }, { name: "Old A", color: "blue", control: "computer" }, { name: "New B", color: "white", control: "computer" }, { name: "Old B", color: "orange", control: "computer" }],
    [{ name: "Old A", color: "blue", control: "computer" }, { name: "New A", color: "red", control: "computer" }, { name: "Old B", color: "orange", control: "computer" }, { name: "New B", color: "white", control: "computer" }],
  ];
}

const seeds = Number(process.argv[2] ?? 100);
const offset = Number(process.argv[3] ?? 1);
const mode = process.argv[4] ?? "4p";
const sanity = process.argv[5] === "sanity";
const diag = process.argv[6] === "diag";
const variantArgument = process.argv[7] ?? "original";
const variant: GameVariant = isGameVariant(variantArgument) ? variantArgument : "original";
// Sanity mode plays the full seat-rotation families with the baseline AI in
// every seat: the "New" label then covers each seat exactly once per family,
// so its null win rate is exactly its seat share, and wins above that
// indicate harness bugs (deadlocks, nondeterminism, scoring errors).
const families = seedFamilies(mode);
const chooser = (name: string): Chooser => sanity
  ? baselineAction
  : name.startsWith("New") ? challengerAction : baselineAction;

const results: GameResult[] = [];
let timeouts = 0;
let familyWins = 0;
let familyLosses = 0;
let familyTies = 0;
let challengerFamilyWinsTotal = 0;
let familyGamesTotal = 0;
const started = performance.now();
for (let seed = offset; seed < offset + seeds; seed++) {
  let challengerFamilyWins = 0;
  let familyGames = 0;
  for (const profiles of families) {
    const result = playGame(seed, profiles, chooser, variant);
    if (!result) {
      timeouts++;
      continue;
    }
    results.push(result);
    familyGames++;
    if (result.winner.startsWith("New")) challengerFamilyWins++;
  }
  challengerFamilyWinsTotal += challengerFamilyWins;
  familyGamesTotal += familyGames;
  if (familyGames === 0) continue;
  const baselineFamilyWins = familyGames - challengerFamilyWins;
  if (challengerFamilyWins > baselineFamilyWins) familyWins++;
  else if (challengerFamilyWins < baselineFamilyWins) familyLosses++;
  else familyTies++;
}
const elapsed = (performance.now() - started) / 1000;
const finished = results.length;
const newWins = results.filter(result => result.winner.startsWith("New")).length;
const oldWins = finished - newWins;
const rate = finished > 0 ? newWins / finished : 0;
// Null win rate = the challenger's seat share in the family: identical AIs win
// exactly their share of seats (1/2 in 4p, 1/3 in 3p — including sanity mode,
// where only the label differs), never 1/2 in every mode.
const challengerSeatShare = families[0]!.filter(profile => profile.name.startsWith("New")).length / families[0]!.length;
const nullRate = challengerSeatShare;
const [low, high] = finished > 0 ? wilson(newWins, finished) : [0, 0];
const z = finished > 0 ? (newWins - finished * nullRate) / Math.sqrt(finished * nullRate * (1 - nullRate)) : 0;
const decisiveFamilies = familyWins + familyLosses;
const binomialP = finished > 0
  ? Math.min(1, 2 * Math.min(binomialTailAtMost(newWins, finished, nullRate), binomialTailAtLeast(newWins, finished, nullRate)))
  : 1;
console.log(`mode=${mode} variant=${variant} sanity=${sanity} seeds=${seeds} (x${families.length} seat${families.length > 1 ? "s" : ""} each) seeds=${offset}..${offset + seeds - 1}`);
console.log(`finished=${finished} timeouts=${timeouts}`);
console.log(`new wins=${newWins} old wins=${oldWins} new win rate=${(rate * 100).toFixed(1)}% (null ${(nullRate * 100).toFixed(1)}%) 95% CI [${(low * 100).toFixed(1)}%, ${(high * 100).toFixed(1)}%] z=${z.toFixed(2)} p=${binomialP.toFixed(4)}`);
if (sanity) {
  console.log(`avg steps=${finished > 0 ? (results.reduce((total, r) => total + r.steps, 0) / finished).toFixed(0) : 0} avg turns=${finished > 0 ? (results.reduce((total, r) => total + r.turns, 0) / finished).toFixed(0) : 0} elapsed=${elapsed.toFixed(1)}s`);
} else if (mode === "3p") {
  console.log(`seat-rotated families: challenger wins ${familyGamesTotal > 0 ? (challengerFamilyWinsTotal / familyGamesTotal).toFixed(2) : 0} of ${families.length} games on average (null 1.00)`);
  console.log(`avg steps=${finished > 0 ? (results.reduce((total, r) => total + r.steps, 0) / finished).toFixed(0) : 0} avg turns=${finished > 0 ? (results.reduce((total, r) => total + r.turns, 0) / finished).toFixed(0) : 0} elapsed=${elapsed.toFixed(1)}s`);
} else {
  const signTestP = decisiveFamilies > 0
    ? 2 * Math.min(1, binomialTailAtMost(Math.min(familyWins, familyLosses), decisiveFamilies, 0.5))
    : 1;
  console.log(`seat-balanced families: new=${familyWins} old=${familyLosses} split=${familyTies} sign-test p=${signTestP.toFixed(4)}`);
  console.log(`avg steps=${finished > 0 ? (results.reduce((total, r) => total + r.steps, 0) / finished).toFixed(0) : 0} avg turns=${finished > 0 ? (results.reduce((total, r) => total + r.turns, 0) / finished).toFixed(0) : 0} elapsed=${elapsed.toFixed(1)}s`);
}
if (diag && finished > 0) {
  const winnerStats = new Map<string, number>(trackedActions.map(type => [type, 0]));
  const loserStats = new Map<string, number>(trackedActions.map(type => [type, 0]));
  let winnerScore = 0;
  let loserScore = 0;
  let loserSeats = 0;
  for (const result of results) {
    for (const [name, playerCounts] of result.counts) {
      const target = name === result.winner ? winnerStats : loserStats;
      if (name === result.winner) winnerScore += result.scores.get(name)!;
      else {
        loserScore += result.scores.get(name)!;
        loserSeats++;
      }
      for (const type of trackedActions) {
        target.set(type, target.get(type)! + (playerCounts.get(type) ?? 0));
      }
    }
  }
  console.log(`winner avg score=${(winnerScore / finished).toFixed(1)} loser avg score=${(loserScore / loserSeats).toFixed(1)}`);
  for (const type of trackedActions) {
    console.log(`  ${type.padEnd(18)} winners=${(winnerStats.get(type)! / finished).toFixed(2)} losers=${(loserStats.get(type)! / loserSeats).toFixed(2)}`);
  }
}

function binomialProbability(count: number, total: number, probability: number): number {
  let coefficient = 1;
  for (let index = 0; index < count; index++) coefficient = coefficient * (total - index) / (index + 1);
  return coefficient * probability ** count * (1 - probability) ** (total - count);
}

function binomialTailAtMost(atMost: number, total: number, probability: number): number {
  let tail = 0;
  for (let count = 0; count <= atMost; count++) tail += binomialProbability(count, total, probability);
  return tail;
}

function binomialTailAtLeast(atLeast: number, total: number, probability: number): number {
  let tail = 0;
  for (let count = atLeast; count <= total; count++) tail += binomialProbability(count, total, probability);
  return tail;
}
