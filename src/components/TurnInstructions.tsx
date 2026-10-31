import { match } from "ts-pattern";
import type { GamePhase } from "../game/types";

export function getPhaseInstructions({
  phase,
  secondSettlement,
  pendingKnight = Boolean(phase.type === "robber" && phase.pendingKnight),
  sharedBoard = false,
}: {
  phase: GamePhase;
  secondSettlement: boolean;
  pendingKnight?: boolean;
  sharedBoard?: boolean;
}) {
  return match(phase)
    .with({ type: "setup-settlement" }, () => ({
      title: "Find a place to call home.",
      description: `Place your ${secondSettlement ? "second" : "first"} settlement on a highlighted intersection${sharedBoard ? " on the shared board" : ""}. Leave at least two edges between settlements.`,
    }))
    .with({ type: "setup-road" }, () => ({
      title: "Every journey starts here.",
      description: `Choose a highlighted edge connected to your new settlement${sharedBoard ? " on the shared board" : ""}, then confirm your road.`,
    }))
    .with({ type: "roll" }, () => ({
      title: "Let the dice decide.",
      description: "Roll two dice to gather resources. You may play an eligible development card before rolling.",
    }))
    .with({ type: "actions" }, () => ({
      title: "Make your next move.",
      description: "Trade with the bank or another player, build your island, or invest in a development card.",
    }))
    .with({ type: "discard" }, () => ({
      title: "Make room in your hand.",
      description: "A seven was rolled. Players with more than seven resource cards must return half, rounded down, to the bank.",
    }))
    .with({ type: "robber" }, () => ({
      title: pendingKnight ? "Move the robber." : "The robber is on the move.",
      description: pendingKnight
        ? `Confirm a new hex${sharedBoard ? " on the shared board" : ""} or cancel Knight.`
        : `Select a different hex${sharedBoard ? " on the shared board" : ""}. The robber stops that hex from producing until it moves again.`,
    }))
    .with({ type: "steal" }, () => ({
      title: "Choose a neighboring player.",
      description: "Choose an opponent beside the robber. Take one random resource if they have any; an empty hand gives you nothing.",
    }))
    .with({ type: "road-building" }, phase => ({
      title: "Take the road less traveled.",
      description: `Place ${phase.remaining} more road${phase.remaining === 1 ? "" : "s"} for free. Confirm each placement on the ${sharedBoard ? "shared " : ""}board.`,
    }))
    .with({ type: "finished" }, () => ({
      title: "An island. A new legend.",
      description: "The first player to reach ten victory points on their turn wins.",
    }))
    .exhaustive();
}

export function TurnInstructions({
  title,
  description,
  computerActivity,
  onCancelKnight,
  disabled,
}: {
  title: string;
  description: string;
  computerActivity?: boolean;
  onCancelKnight?: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="turn-card rounded-2xl bg-forest text-ink">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <h1 className="turn-title font-serif text-xl leading-tight">
            {title}
          </h1>
          <p role={computerActivity ? "status" : undefined} aria-label={computerActivity ? "Computer activity" : undefined} className="turn-description text-xs leading-4 text-ink/70">
            {description}
          </p>
        </div>
        {onCancelKnight && (
          <button className="button-secondary shrink-0 px-3 text-xs" disabled={disabled} onClick={onCancelKnight}>
            Cancel Knight
          </button>
        )}
      </div>
    </div>
  );
}
