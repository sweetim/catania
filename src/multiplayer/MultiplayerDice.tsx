import { useEffect, useRef, useState } from "react";
import { Dice } from "../components/RollSummary";
import { useTranslation } from "../localization";
import { multiplayerUiTranslations } from "../translations/multiplayer-ui";
import type { PublicGame } from "./types";

export function MultiplayerDice({ game }: { game: PublicGame }) {
  const translateText = useTranslation(multiplayerUiTranslations);
  const dice = game.dice;
  const rollIdentity = dice ? `${game.turnNumber}:${game.activePlayerId}:${dice[0]}:${dice[1]}` : null;
  // A first snapshot is already settled, including when reconnecting.
  const lastRoll = useRef(rollIdentity);
  const [rollingIdentity, setRollingIdentity] = useState<string | null>(null);
  const rolling = rollIdentity !== null && rollingIdentity === rollIdentity;
  const playerName = game.players.find(player => player.id === game.activePlayerId)!.name;
  const result = dice ? `${dice[0]} + ${dice[1]} = ${dice[0] + dice[1]}` : "";

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

  return (
    <>
      <p role="status" aria-label={translateText("Roll announcement")} aria-atomic="true" className="sr-only">
        {dice && <span key={rollIdentity}>{translateText("{name} rolled {result}.", { name: playerName, result })}</span>}
      </p>
      <section aria-label={translateText(dice ? "Roll result" : "Dice tray")} data-stage={dice ? rolling ? "rolling" : "complete" : "idle"} className="roll-summary">
        <Dice key={rollIdentity} dice={dice} rolling={rolling} />
        <div className="roll-summary-content">
          {dice && <p className="roll-summary-label">{translateText("{name} rolled", { name: playerName })}</p>}
          <p className="roll-summary-title">{dice ? result : translateText("Waiting for the next roll.")}</p>
        </div>
      </section>
    </>
  );
}
