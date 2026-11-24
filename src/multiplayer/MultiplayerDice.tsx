import { useEffect, useRef, useState } from "react";
import { ResourceCard } from "../components/GameUi";
import { Dice } from "../components/RollSummary";
import { RESOURCES } from "../game/engine";
import type { Resources } from "../game/types";
import { resourceName } from "../i18n";
import { useLanguage, useTranslation } from "../localization";
import { multiplayerUiTranslations } from "../translations/multiplayer-ui";
import type { PublicGame } from "./types";

export function useDiceRollAnimation(rollIdentity: string | null): boolean {
  // A first snapshot is already settled, including when reconnecting.
  const lastRoll = useRef(rollIdentity);
  const [rollingIdentity, setRollingIdentity] = useState<string | null>(null);

  useEffect(() => {
    if (rollIdentity === null || rollIdentity === lastRoll.current) {
      setRollingIdentity(null);
      return;
    }
    lastRoll.current = rollIdentity;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reducedMotion.matches) {
      setRollingIdentity(null);
      return;
    }
    setRollingIdentity(rollIdentity);
    const timer = window.setTimeout(() => setRollingIdentity(null), 500);
    function settleOnReducedMotion() {
      if (!reducedMotion.matches) return;
      window.clearTimeout(timer);
      setRollingIdentity(null);
    }
    reducedMotion.addEventListener("change", settleOnReducedMotion);
    return () => {
      window.clearTimeout(timer);
      reducedMotion.removeEventListener("change", settleOnReducedMotion);
    };
  }, [rollIdentity]);

  return rollIdentity !== null && rollingIdentity === rollIdentity;
}

export function SharedBoardDice({ game }: { game: PublicGame }) {
  const translateText = useTranslation(multiplayerUiTranslations);
  const dice = game.dice;
  const rollIdentity = dice ? `${game.gameId}:${game.turnNumber}:${game.activePlayerId}:${dice[0]}:${dice[1]}` : null;
  const rolling = useDiceRollAnimation(rollIdentity);
  const sevenRolled = Boolean(dice && !rolling && dice[0] + dice[1] === 7);
  return (
    <div
      className="shared-board-dice"
      role="group"
      aria-label={translateText("Shared dice")}
      data-stage={dice ? rolling ? "rolling" : "complete" : "idle"}
      data-seven={sevenRolled ? "true" : undefined}
    >
      <Dice key={rollIdentity} dice={dice} rolling={rolling} />
    </div>
  );
}

export function MultiplayerDice({ game, gains, rollSettled = false }: {
  game: PublicGame;
  gains?: Resources | null;
  rollSettled?: boolean;
}) {
  const { language } = useLanguage();
  const translateText = useTranslation(multiplayerUiTranslations);
  const dice = game.dice;
  const rollIdentity = dice ? `${game.gameId}:${game.turnNumber}:${game.activePlayerId}:${dice[0]}:${dice[1]}` : null;
  const rolling = useDiceRollAnimation(rollIdentity);
  const playerName = game.players.find(player => player.id === game.activePlayerId)!.name;
  const total = dice ? dice[0] + dice[1] : null;
  const sevenRolled = Boolean(dice && !rolling && total === 7);
  const result = dice ? `${dice[0]} + ${dice[1]} = ${total}` : "";
  const gainedResources = dice && total !== 7 && gains ? RESOURCES.filter(resource => gains[resource] > 0) : [];

  return (
    <>
      <p role="status" aria-label={translateText("Roll announcement")} aria-atomic="true" className="sr-only">
        {dice && <span key={rollIdentity}>{translateText("{name} rolled {result}.", { name: playerName, result })}</span>}
      </p>
      <section
        aria-label={translateText(dice ? "Roll result" : "Dice tray")}
        data-stage={dice ? rolling ? "rolling" : "complete" : "idle"}
        data-seven={sevenRolled ? "true" : undefined}
        className="roll-summary"
      >
        <Dice key={rollIdentity} dice={dice} rolling={rolling} />
        <div className="roll-summary-content">
          {!rolling && gainedResources.length > 0 && gains ? (
            <div className="roll-summary-private">
              <p className="roll-summary-label">{translateText("You received")}</p>
              <ul className="roll-summary-rewards" aria-label={translateText("Your roll rewards")}>
                {gainedResources.map(resource => (
                  <li key={resource} aria-label={translateText("{resource} +{count}", { resource: resourceName(language, resource), count: gains[resource] })} title={translateText("You received +{count} {resource}", { count: gains[resource], resource: resourceName(language, resource) })}>
                    <ResourceCard resource={resource} compact iconClassName="h-4 w-4" className="roll-summary-resource" />
                    <strong aria-hidden="true" className="roll-summary-gain">+{gains[resource]}</strong>
                  </li>
                ))}
              </ul>
            </div>
          ) : sevenRolled ? (
            <>
              <p className="roll-summary-label">{translateText("{name} rolled {result}", { name: playerName, result })}</p>
              <p className="roll-summary-title text-clay">{translateText("Robber activates!")}</p>
            </>
          ) : !rolling && dice && rollSettled && total !== 7 ? (
            <>
              <p className="roll-summary-label">{translateText("{name} rolled {result}", { name: playerName, result })}</p>
              <p className="roll-summary-title">{translateText("No resources received.")}</p>
            </>
          ) : (
            <>
              {dice && <p className="roll-summary-label">{translateText("{name} rolled", { name: playerName })}</p>}
              <p className="roll-summary-title">{dice ? (rolling ? translateText("Rolling...") : result) : translateText("Waiting for the next roll.")}</p>
            </>
          )}
        </div>
      </section>
    </>
  );
}
