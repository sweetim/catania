// The challenger always mirrors the live AI in src/game/computer.ts.
// The baseline in scripts/computer-baseline.ts is a frozen snapshot of the
// previous AI, so ai-benchmark.ts measures real improvement against it.
export { chooseComputerAction, getComputerActionDelay } from "../src/game/computer";
