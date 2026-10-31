import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Player, TheftEvent } from "../game/types";
import { ResourceCard, RESOURCE_NAMES } from "./GameUi";

export function TheftNotice({ thefts, playerId, players, target }: {
  thefts: TheftEvent[];
  playerId: string | null;
  players: Pick<Player, "id" | "name">[];
  target: HTMLDivElement | null;
}) {
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
  const title = theft ? lost ? `${otherPlayer!.name} robbed you` : `You stole from ${otherPlayer!.name}` : "";
  const description = theft ? lost
    ? `${otherPlayer!.name} robbed you of 1 ${RESOURCE_NAMES[theft.resource]}.`
    : `You stole 1 ${RESOURCE_NAMES[theft.resource]} from ${otherPlayer!.name}.` : "";

  return createPortal(<>
    <p role="status" aria-label="Robbery result" aria-atomic="true" className="sr-only">
      <span key={theft ? `${playerId}-${theft.id}` : "empty"}>{description}</span>
    </p>
    {theft && <section ref={notice} aria-label="Robbery notification"
      className={`theft-notice rounded-2xl border bg-paper p-4 shadow-xl ${lost ? "border-clay" : "border-[#91ad9b]"}`}>
      <div className="flex items-start gap-3">
        <div className="shrink-0 pt-1" aria-hidden="true">
          <ResourceCard resource={theft.resource} compact className="h-20 w-14" />
          <span className={`mt-1 block text-center text-sm font-bold ${lost ? "text-[#934c36]" : "text-ink"}`}>
            {lost ? "-1" : "+1"} {RESOURCE_NAMES[theft.resource]}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="eyebrow">Private theft</p>
          <h2 className="mt-1 break-words font-serif text-xl leading-tight">{title}</h2>
          <p className="mt-2 text-sm">{lost ? "Lost" : "Received"} 1 {RESOURCE_NAMES[theft.resource]}</p>
          <p className="mt-1 text-xs text-muted">{lost ? "Removed from" : "Added to"} your hand.</p>
          {pending.length > 1 && <p className="mt-2 text-xs text-muted">{pending.length - 1} more theft notice{pending.length === 2 ? "" : "s"}</p>}
        </div>
        <button type="button" aria-label="Dismiss robbery notification"
          className="-mr-2 -mt-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xl text-muted hover:bg-moss"
          onClick={() => setDismissed(previous => ({ ...previous, [playerId]: theft.id }))}>
          &times;
        </button>
      </div>
    </section>}
  </>, target);
}
