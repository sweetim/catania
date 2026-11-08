import { match } from "ts-pattern";
import { victoryTarget } from "../game/engine";
import { isSeafarers, type GamePhase, type GameVariant } from "../game/types";
import { translate, type Language } from "../i18n";
import { useTranslation } from "../localization";
import { gameplayTranslations } from "../translations/gameplay";

export function getPhaseInstructions({
  phase,
  secondSettlement,
  pendingKnight = Boolean(phase.type === "robber" && phase.pendingKnight),
  sharedBoard = false,
  language = "en",
  variant = "original",
}: {
  phase: GamePhase;
  secondSettlement: boolean;
  pendingKnight?: boolean;
  sharedBoard?: boolean;
  language?: Language;
  variant?: GameVariant;
}) {
  const translateText = (message: keyof typeof gameplayTranslations, parameters?: Record<string, string | number>) =>
    translate(language, gameplayTranslations, message, parameters);
  return match(phase)
    .with({ type: "setup-settlement" }, () => ({
      title: translateText("Find a place to call home."),
      description: translateText(sharedBoard
        ? secondSettlement
          ? "Place your second settlement on a highlighted intersection on the shared board. Leave at least two edges between settlements."
          : "Place your first settlement on a highlighted intersection on the shared board. Leave at least two edges between settlements."
        : secondSettlement
          ? "Place your second settlement on a highlighted intersection. Leave at least two edges between settlements."
          : "Place your first settlement on a highlighted intersection. Leave at least two edges between settlements."),
    }))
    .with({ type: "setup-road" }, () => ({
      title: translateText("Every journey starts here."),
      description: isSeafarers(variant) ? translateText("Choose a road or ship beside your new settlement.") : translateText(sharedBoard
        ? "Choose a highlighted edge connected to your new settlement on the shared board, then confirm your road."
        : "Choose a highlighted edge connected to your new settlement, then confirm your road."),
    }))
    .with({ type: "reveal" }, () => ({
      title: translateText("Step into the fog."),
      description: translateText("Select a fog hex to reveal it. Sea grants nothing and lets you choose again; the first land reveal ends your selection."),
    }))
    .with({ type: "roll" }, () => ({
      title: translateText("Let the dice decide."),
      description: translateText("Roll two dice to gather resources. You may play an eligible development card before rolling."),
    }))
    .with({ type: "actions" }, () => ({
      title: translateText("Make your next move."),
      description: translateText("Trade with the bank or another player, build your island, or invest in a development card."),
    }))
    .with({ type: "discard" }, () => ({
      title: translateText("Make room in your hand."),
      description: translateText("A seven was rolled. Players with more than seven resource cards must return half, rounded down, to the bank."),
    }))
    .with({ type: "gold" }, () => ({
      title: translateText("Choose your gold resources"),
      description: translateText("Choose your gold resources"),
    }))
    .with({ type: "robber" }, () => ({
      title: translateText(isSeafarers(variant) ? "Move the robber or pirate." : pendingKnight ? "Move the robber." : "The robber is on the move."),
      description: isSeafarers(variant) ? translateText("Move the robber to revealed land or the pirate to revealed sea, then choose a victim. Neither may enter fog.") : translateText(pendingKnight
        ? sharedBoard
          ? "Confirm a new hex on the shared board or cancel Knight."
          : "Confirm a new hex or cancel Knight."
        : sharedBoard
          ? "Select a different hex on the shared board. The robber stops that hex from producing until it moves again."
          : "Select a different hex. The robber stops that hex from producing until it moves again."),
    }))
    .with({ type: "steal" }, () => ({
      title: translateText("Choose a neighboring player."),
      description: translateText(isSeafarers(variant) ? "Choose an opponent beside the robber or pirate." : "Choose an opponent beside the robber. Take one random resource if they have any; an empty hand gives you nothing."),
    }))
    .with({ type: "road-building" }, phase => ({
      title: translateText("Take the road less traveled."),
      description: isSeafarers(variant) ? translateText("Place {count} more roads or ships for free.", { count: phase.remaining }) : translateText(sharedBoard
        ? phase.remaining === 1
          ? "Place {count} more road for free. Confirm each placement on the shared board."
          : "Place {count} more roads for free. Confirm each placement on the shared board."
        : phase.remaining === 1
          ? "Place {count} more road for free. Confirm each placement on the board."
          : "Place {count} more roads for free. Confirm each placement on the board.", { count: phase.remaining }),
    }))
    .with({ type: "finished" }, () => ({
      title: translateText("An island. A new legend."),
      description: translateText("The first player to reach {points} victory points on their turn wins.", { points: victoryTarget(variant) }),
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
  const translateText = useTranslation(gameplayTranslations);
  return (
    <div className="turn-card rounded-2xl bg-forest text-ink">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <h1 className="turn-title font-serif text-xl leading-tight">
            {title}
          </h1>
          <p role={computerActivity ? "status" : undefined} aria-label={computerActivity ? translateText("Computer activity") : undefined} className="turn-description text-xs leading-4 text-ink/70">
            {description}
          </p>
        </div>
        {onCancelKnight && (
          <button className="button-secondary shrink-0 px-3 text-xs" disabled={disabled} onClick={onCancelKnight}>
            {translateText("Cancel Knight")}
          </button>
        )}
      </div>
    </div>
  );
}
