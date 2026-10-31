import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Player, TheftEvent } from "../game/types";
import { resourceName } from "../i18n";
import { useLanguage, useTranslation } from "../localization";
import { gameplayTranslations } from "../translations/gameplay";
import { ResourceCard } from "./GameUi";

export function TheftNotice({ thefts, playerId, players, target }: {
  thefts: TheftEvent[];
  playerId: string | null;
  players: Pick<Player, "id" | "name">[];
  target: HTMLDivElement | null;
}) {
  const { language } = useLanguage();
  const translateText = useTranslation(gameplayTranslations);
  // Keep acknowledgements per player even while the pass-and-play hand is hidden.
  const [dismissed, setDismissed] = useState<Record<string, number>>({});
  const notice = useRef<HTMLElement | null>(null);
  const pending = playerId ? thefts.filter(theft => theft.id > (dismissed[playerId] ?? 0) &&
    (theft.thiefId === playerId || theft.victimId === playerId)) : [];
  const theft = pending[0];
  const theftId = theft?.id;
  useEffect(() => {
    if (!playerId || theftId === undefined || !target || !notice.current) return;
    let timeout: number | undefined;
    // Do not expire a notice while its owner's hand or the notice itself is off-screen.
    const observer = new IntersectionObserver(([entry]) => {
      window.clearTimeout(timeout);
      if (entry && entry.intersectionRatio >= 0.5) {
        timeout = window.setTimeout(() => setDismissed(previous => ({ ...previous, [playerId]: theftId })), 5000);
      }
    }, { threshold: 0.5 });
    observer.observe(notice.current);
    return () => {
      observer.disconnect();
      window.clearTimeout(timeout);
    };
  }, [playerId, theftId, target]);
  if (!playerId || !target) return null;
  const lost = theft?.victimId === playerId;
  const otherPlayer = theft && players.find(player => player.id === (lost ? theft.thiefId : theft.victimId))!;
  const title = theft ? translateText(lost ? "{player} robbed you" : "You stole from {player}", { player: otherPlayer!.name }) : "";
  const description = theft ? translateText(lost
    ? "{player} robbed you of 1 {resource}."
    : "You stole 1 {resource} from {player}.", { player: otherPlayer!.name, resource: resourceName(language, theft.resource) }) : "";

  return createPortal(<>
    <p role="status" aria-label={translateText("Robbery result")} aria-atomic="true" className="sr-only">
      <span key={theft ? `${playerId}-${theft.id}` : "empty"}>{description}</span>
    </p>
    {theft && <section ref={notice} aria-label={translateText("Robbery notification")}
      className={`theft-notice rounded-2xl border bg-paper p-4 shadow-xl ${lost ? "border-clay" : "border-[#91ad9b]"}`}>
      <div className="flex items-start gap-3">
        <div className="shrink-0 pt-1" aria-hidden="true">
          <ResourceCard resource={theft.resource} compact className="h-20 w-14" />
          <span className={`mt-1 block text-center text-sm font-bold ${lost ? "text-[#934c36]" : "text-ink"}`}>
            {translateText("{count} {resource}", { count: lost ? "-1" : "+1", resource: resourceName(language, theft.resource) })}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="eyebrow">{translateText("Private theft")}</p>
          <h2 className="mt-1 break-words font-serif text-xl leading-tight">{title}</h2>
          <p className="mt-2 text-sm">{translateText(lost ? "Lost 1 {resource}" : "Received 1 {resource}", { resource: resourceName(language, theft.resource) })}</p>
          <p className="mt-1 text-xs text-muted">{translateText(lost ? "Removed from your hand." : "Added to your hand.")}</p>
          {pending.length > 1 && <p className="mt-2 text-xs text-muted">{translateText(pending.length === 2 ? "{count} more theft notice" : "{count} more theft notices", { count: pending.length - 1 })}</p>}
        </div>
        <button type="button" aria-label={translateText("Dismiss robbery notification")}
          className="-mr-2 -mt-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xl text-muted hover:bg-moss"
          onClick={() => setDismissed(previous => ({ ...previous, [playerId]: theft.id }))}>
          &times;
        </button>
      </div>
    </section>}
  </>, target);
}
