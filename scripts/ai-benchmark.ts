import { chooseComputerAction as baselineAction } from "./computer-baseline";
import { chooseComputerAction as challengerAction } from "./computer-challenger";
import { applyAction, createGame, getScore } from "../src/game/engine";
import type { GameState, Player } from "../src/game/types";

type Chooser = typeof baselineAction;
const profilesFour: Pick<Player, "name" | "color" | "control">[] = [
  { name: "New A", color: "red", control: "computer" },
  { name: "Old A", color: "blue", control: "computer" },
  { name: "New B", color: "white", control: "computer" },
  { name: "Old B", color: "orange", control: "computer" },
];
const profilesThree: Pick<Player, "name" | "color" | "control">[] = [
  { name: "New A", color: "red", control: "computer" },
  { name: "Old A", color: "blue", control: "computer" },
  { name: "Old B", color: "white", control: "computer" },
];

const trackedActions = ["place-city", "place-settlement", "place-road", "place-ship", "buy-development",
  "play-development", "bank-trade", "complete-trade", "request-trade", "offer-trade"] as const;

type GameResult = {
  winner: string;
  steps: number;
  turns: number;
  scores: Map<string, number>;
  counts: Map<string, Map<string, number>>;
};

function seededRandom(initial: number): () => number {
  let seed = initial >>> 0;
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
}

function playGame(
  seed: number,
  profiles: Pick<Player, "name" | "color" | "control">[],
  chooser: (name: string) => Chooser,
): GameResult | null {
  const random = seededRandom(seed);
  let state: GameState = createGame(profiles, random);
  let steps = 0;
  const counts = new Map(state.players.map(player => [player.name, new Map<string, number>()]));
  while (!state.winnerId && steps < 5000) {
    const now = 1_000_000 + steps;
    const decision = state.players
      .map(player => ({ player, action: chooser(player.name)(state, player.id, now) }))
      .find(decision => decision.action);
    if (!decision) throw new Error(`Seed ${seed} deadlocked at step ${steps}, phase ${state.phase.type}`);
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

const games = Number(process.argv[2] ?? 150);
const offset = Number(process.argv[3] ?? 1);
const mode = process.argv[4] ?? "4p";
const sanity = process.argv[5] === "sanity";
const diag = process.argv[6] === "diag";
const profiles = mode === "3p" ? profilesThree : profilesFour;
const chooser = (name: string): Chooser => sanity
  ? baselineAction
  : name.startsWith("New") ? challengerAction : baselineAction;

const results: GameResult[] = [];
let timeouts = 0;
const started = performance.now();
for (let seed = offset; seed < offset + games; seed++) {
  const result = playGame(seed, profiles, chooser);
  if (result) results.push(result);
  else timeouts++;
}
const elapsed = (performance.now() - started) / 1000;
const finished = results.length;
const newWins = results.filter(result => result.winner.startsWith("New")).length;
const oldWins = finished - newWins;
const rate = finished > 0 ? newWins / finished : 0;
const [low, high] = finished > 0 ? wilson(newWins, finished) : [0, 0];
const z = finished > 0 ? (newWins - finished / 2) / Math.sqrt(finished / 4) : 0;
console.log(`mode=${mode} sanity=${sanity} games=${games} seeds=${offset}..${offset + games - 1}`);
console.log(`finished=${finished} timeouts=${timeouts}`);
console.log(`new wins=${newWins} old wins=${oldWins} new win rate=${(rate * 100).toFixed(1)}% 95% CI [${(low * 100).toFixed(1)}%, ${(high * 100).toFixed(1)}%] z=${z.toFixed(2)}`);
console.log(`avg steps=${finished > 0 ? (results.reduce((total, r) => total + r.steps, 0) / finished).toFixed(0) : 0} avg turns=${finished > 0 ? (results.reduce((total, r) => total + r.turns, 0) / finished).toFixed(0) : 0} elapsed=${elapsed.toFixed(1)}s`);
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
