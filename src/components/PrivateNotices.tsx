import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { MonopolyEvent, Player, TheftEvent } from "../game/types";
import { resourceName } from "../i18n";
import { useLanguage, useTranslation } from "../localization";
import { gameplayTranslations } from "../translations/gameplay";
import { ResourceCard } from "./GameUi";

type PendingNotice =
  | { kind: "theft"; id: number; theft: TheftEvent }
  | { kind: "monopoly"; id: number; monopoly: MonopolyEvent };

export function PrivateNotices({ thefts, monopolies, playerId, players, target }: {
  thefts: TheftEvent[];
  monopolies: MonopolyEvent[];
  playerId: string | null;
  players: Pick<Player, "id" | "name">[];
  target: HTMLDivElement | null;
}) {
  const { language } = useLanguage();
  const translateText = useTranslation(gameplayTranslations);
  // Keep acknowledgements per player even while the pass-and-play hand is hidden.
  const [dismissedThefts, setDismissedThefts] = useState<Record<string, number>>({});
  const [dismissedMonopolies, setDismissedMonopolies] = useState<Record<string, number>>({});
  const notice = useRef<HTMLElement | null>(null);
  const pendingThefts = playerId ? thefts.filter(theft => theft.id > (dismissedThefts[playerId] ?? 0) &&
    (theft.thiefId === playerId || theft.victimId === playerId)) : [];
  const pendingMonopolies = playerId ? monopolies.filter(monopoly => monopoly.id > (dismissedMonopolies[playerId] ?? 0) &&
    monopoly.playerId !== playerId && (monopoly.losses[playerId] ?? 0) > 0) : [];
  const pending: PendingNotice[] = [
    ...pendingThefts.map(theft => ({ kind: "theft" as const, id: theft.id, theft })),
    ...pendingMonopolies.map(monopoly => ({ kind: "monopoly" as const, id: monopoly.id, monopoly })),
  ].sort((first, second) => first.id - second.id);
  const head = pending[0];
  const headKind = head?.kind;
  const headId = head?.id;
  useEffect(() => {
    if (!playerId || headKind === undefined || headId === undefined || !target || !notice.current) return;
    let timeout: number | undefined;
    // Do not expire a notice while its owner's hand or the notice itself is off-screen.
    const observer = new IntersectionObserver(([entry]) => {
      window.clearTimeout(timeout);
      if (entry && entry.intersectionRatio >= 0.5) {
        timeout = window.setTimeout(() => {
          if (headKind === "theft") setDismissedThefts(previous => ({ ...previous, [playerId]: headId }));
          else setDismissedMonopolies(previous => ({ ...previous, [playerId]: headId }));
        }, 5000);
      }
    }, { threshold: 0.5 });
    observer.observe(notice.current);
    return () => {
      observer.disconnect();
      window.clearTimeout(timeout);
    };
  }, [playerId, headKind, headId, target]);
  if (!playerId || !target) return null;
  const theft = head?.kind === "theft" ? head.theft : undefined;
  const monopoly = head?.kind === "monopoly" ? head.monopoly : undefined;
  const lostResources = theft ? theft.victimId === playerId : true;
  const theftPlayer = theft && players.find(player => player.id === (lostResources ? theft.thiefId : theft.victimId));
  const monopolist = monopoly && players.find(player => player.id === monopoly.playerId);
  const stolenCount = theft ? (lostResources ? "-1" : "+1") : "";
  const lostCount = monopoly && playerId ? monopoly.losses[playerId] ?? 0 : 0;
  const theftDescription = theft && theftPlayer
    ? translateText(lostResources ? "{player} robbed you of 1 {resource}." : "You stole 1 {resource} from {player}.", { player: theftPlayer.name, resource: resourceName(language, theft.resource) })
    : "";
  const monopolyDescription = monopoly && monopolist
    ? translateText("You lost {count} {resource} to {player}'s Monopoly.", { count: lostCount, resource: resourceName(language, monopoly.resource), player: monopolist.name })
    : "";
  const remainingCount = pendingThefts.length + pendingMonopolies.length - (head ? 1 : 0);
  const footer = remainingCount > 0
    ? <p className="mt-1 text-xs text-muted">{translateText("{count} more", { count: remainingCount })}</p>
    : null;

  return createPortal(<>
    <p role="status" aria-label={translateText("Robbery result")} aria-atomic="true" className="sr-only">
      <span key={theft ? `${playerId}-theft-${theft.id}` : "empty"}>{theftDescription}</span>
    </p>
    <p role="status" aria-label={translateText("Monopoly result")} aria-atomic="true" className="sr-only">
      <span key={monopoly ? `${playerId}-monopoly-${monopoly.id}` : "empty"}>{monopolyDescription}</span>
    </p>
    {theft && theftPlayer && <section ref={notice} aria-label={translateText("Robbery notification")}
      className={`private-notice rounded-xl border bg-paper p-4 shadow-lg ${lostResources ? "border-clay" : "border-[#91ad9b]"}`}>
      <div className="flex items-start justify-between gap-2">
        <h2 className="min-w-0 break-words font-serif text-xl leading-tight">{translateText(lostResources ? "{player} robbed you" : "You stole from {player}", { player: theftPlayer.name })}</h2>
        <button type="button" aria-label={translateText("Dismiss robbery notification")}
          className="-mr-2 -mt-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xl text-muted hover:bg-moss"
          onClick={() => setDismissedThefts(previous => ({ ...previous, [playerId]: theft.id }))}>
          &times;
        </button>
      </div>
      <div className="mt-2 flex items-center justify-between gap-3">
        <ResourceCard resource={theft.resource} compact iconClassName="h-6 w-6" className="h-16 w-11" />
        <span aria-hidden="true" className={`text-3xl font-bold leading-none tabular-nums ${lostResources ? "text-[#934c36]" : "text-ink"}`}>
          {stolenCount}
        </span>
      </div>
      {footer}
    </section>}
    {monopoly && monopolist && <section ref={notice} aria-label={translateText("Monopoly notification")}
      className="private-notice rounded-xl border border-clay bg-paper p-4 shadow-lg">
      <div className="flex items-start justify-between gap-2">
        <h2 className="min-w-0 break-words font-serif text-xl leading-tight">{translateText("{player}'s Monopoly", { player: monopolist.name })}</h2>
        <button type="button" aria-label={translateText("Dismiss Monopoly notification")}
          className="-mr-2 -mt-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xl text-muted hover:bg-moss"
          onClick={() => setDismissedMonopolies(previous => ({ ...previous, [playerId]: monopoly.id }))}>
          &times;
        </button>
      </div>
      <div className="mt-2 flex items-center justify-between gap-3">
        <ResourceCard resource={monopoly.resource} compact iconClassName="h-6 w-6" className="h-16 w-11" />
        <span aria-hidden="true" className="text-3xl font-bold leading-none tabular-nums text-[#934c36]">
          {`-${lostCount}`}
        </span>
      </div>
      {footer}
    </section>}
  </>, target);
}
