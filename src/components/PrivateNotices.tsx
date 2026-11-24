import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { match } from "ts-pattern";
import type { MonopolyEvent, Player, Resources, TheftEvent } from "../game/types";
import { resourceName } from "../i18n";
import { useLanguage, useTranslation } from "../localization";
import { gameplayTranslations } from "../translations/gameplay";
import { Arrow, CardStack, DevelopmentCardIcon, PieceIcon, ResourceCard } from "./GameUi";
import { CloseIcon, RobberIcon, TradeIcon } from "./Icons";

export type TradeOutcomeEvent = {
  id: number;
  kind: "completed" | "withdrawn" | "closed";
  actorName: string;
  otherName?: string;
  partnerName?: string;
  gave?: Resources;
  received?: Resources;
};

export type SabotageNoticeEvent = {
  id: number;
  saboteurId: string;
  victimId: string;
  kind: "road" | "ship" | "settlement" | "city";
};

type PendingNotice =
  | { kind: "theft"; id: number; theft: TheftEvent }
  | { kind: "monopoly"; id: number; monopoly: MonopolyEvent }
  | { kind: "sabotage"; id: number; sabotage: SabotageNoticeEvent }
  | { kind: "trade"; id: number; outcome: TradeOutcomeEvent };

export function PrivateNotices({ thefts, monopolies, sabotages = [], tradeOutcomes = [], playerId, players, target }: {
  thefts: TheftEvent[];
  monopolies: MonopolyEvent[];
  sabotages?: SabotageNoticeEvent[];
  tradeOutcomes?: TradeOutcomeEvent[];
  playerId: string | null;
  players: Pick<Player, "id" | "name">[];
  target: HTMLDivElement | null;
}) {
  const { language } = useLanguage();
  const translateText = useTranslation(gameplayTranslations);
  // Keep acknowledgements per player even while the pass-and-play hand is hidden.
  const [dismissedThefts, setDismissedThefts] = useState<Record<string, number>>({});
  const [dismissedMonopolies, setDismissedMonopolies] = useState<Record<string, number>>({});
  const [dismissedSabotages, setDismissedSabotages] = useState<Record<string, number>>({});
  const [dismissedTradeOutcomes, setDismissedTradeOutcomes] = useState<Record<string, number>>({});
  const [noticeVisible, setNoticeVisible] = useState(false);
  const notice = useRef<HTMLElement | null>(null);
  const pendingThefts = playerId ? thefts.filter(theft => theft.id > (dismissedThefts[playerId] ?? 0) &&
    (theft.thiefId === playerId || theft.victimId === playerId)) : [];
  const pendingMonopolies = playerId ? monopolies.filter(monopoly => monopoly.id > (dismissedMonopolies[playerId] ?? 0) &&
    monopoly.playerId !== playerId && (monopoly.losses[playerId] ?? 0) > 0) : [];
  const pendingSabotages = playerId ? sabotages.filter(sabotage => sabotage.id > (dismissedSabotages[playerId] ?? 0) &&
    sabotage.victimId === playerId) : [];
  const pendingTradeOutcomes = playerId ? tradeOutcomes.filter(outcome => outcome.id > (dismissedTradeOutcomes[playerId] ?? 0)) : [];
  const pending: PendingNotice[] = [
    ...[
      ...pendingThefts.map(theft => ({ kind: "theft" as const, id: theft.id, theft })),
      ...pendingMonopolies.map(monopoly => ({ kind: "monopoly" as const, id: monopoly.id, monopoly })),
    ].sort((first, second) => first.id - second.id),
    ...pendingSabotages.map(sabotage => ({ kind: "sabotage" as const, id: sabotage.id, sabotage })),
    ...pendingTradeOutcomes.map(outcome => ({ kind: "trade" as const, id: outcome.id, outcome })),
  ];
  const head = pending[0];
  const headKind = head?.kind;
  const headId = head?.id;
  useEffect(() => {
    setNoticeVisible(false);
    if (!playerId || headKind === undefined || headId === undefined || !target || !notice.current) return;
    let timeout: number | undefined;
    // Do not expire a notice while its owner's hand or the notice itself is off-screen.
    const observer = new IntersectionObserver(([entry]) => {
      window.clearTimeout(timeout);
      const visible = Boolean(entry && entry.intersectionRatio >= 0.5);
      setNoticeVisible(visible);
      if (visible) {
        timeout = window.setTimeout(() => {
          match(headKind)
            .with("theft", () => setDismissedThefts(previous => ({ ...previous, [playerId]: headId })))
            .with("monopoly", () => setDismissedMonopolies(previous => ({ ...previous, [playerId]: headId })))
            .with("sabotage", () => setDismissedSabotages(previous => ({ ...previous, [playerId]: headId })))
            .with("trade", () => setDismissedTradeOutcomes(previous => ({ ...previous, [playerId]: headId })))
            .exhaustive();
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
  const sabotage = head?.kind === "sabotage" ? head.sabotage : undefined;
  const tradeOutcome = head?.kind === "trade" ? head.outcome : undefined;
  const lostResources = theft ? theft.victimId === playerId : true;
  const theftPlayer = theft && players.find(player => player.id === (lostResources ? theft.thiefId : theft.victimId));
  const monopolist = monopoly && players.find(player => player.id === monopoly.playerId);
  const saboteur = sabotage && players.find(player => player.id === sabotage.saboteurId);
  const stolenCount = theft ? (lostResources ? "-1" : "+1") : "";
  const lostCount = monopoly && playerId ? monopoly.losses[playerId] ?? 0 : 0;
  const theftDescription = theft && theftPlayer
    ? translateText(lostResources ? "{player} robbed you of 1 {resource}." : "You stole 1 {resource} from {player}.", { player: theftPlayer.name, resource: resourceName(language, theft.resource) })
    : "";
  const monopolyDescription = monopoly && monopolist
    ? translateText("You lost {count} {resource} to {player}'s Monopoly.", { count: lostCount, resource: resourceName(language, monopoly.resource), player: monopolist.name })
    : "";
  const sabotageDescription = sabotage && saboteur
    ? match(sabotage.kind)
      .with("road", () => translateText("{player} sabotaged your road.", { player: saboteur.name }))
      .with("ship", () => translateText("{player} sabotaged your ship.", { player: saboteur.name }))
      .with("settlement", () => translateText("{player} sabotaged your settlement.", { player: saboteur.name }))
      .with("city", () => translateText("{player} reduced your city to a settlement.", { player: saboteur.name }))
      .exhaustive()
    : "";
  const tradeOutcomeTitle = tradeOutcome
    ? tradeOutcome.kind === "completed"
      ? tradeOutcome.partnerName
        ? translateText("Traded with {player}", { player: tradeOutcome.partnerName })
        : translateText("{player} traded with {other}", { player: tradeOutcome.actorName, other: tradeOutcome.otherName ?? "" })
      : tradeOutcome.kind === "withdrawn"
        ? translateText("{player} withdrew the trade", { player: tradeOutcome.actorName })
        : translateText("Trade closed")
    : "";
  const tradeOutcomeDescription = tradeOutcome
    ? tradeOutcome.kind === "completed"
      ? tradeOutcome.partnerName
        ? translateText("You completed a trade with {player}.", { player: tradeOutcome.partnerName })
        : translateText("{player} completed a trade with {other}.", { player: tradeOutcome.actorName, other: tradeOutcome.otherName ?? "" })
      : tradeOutcome.kind === "withdrawn"
        ? translateText("{player} withdrew the open trade.", { player: tradeOutcome.actorName })
        : translateText("The open trade ended.")
    : "";
  const remainingCount = pendingThefts.length + pendingMonopolies.length + pendingSabotages.length + pendingTradeOutcomes.length - (head ? 1 : 0);
  const footer = remainingCount > 0
    ? <p className="mt-1 text-xs text-muted">{translateText("{count} more", { count: remainingCount })}</p>
    : null;
  const progressBar = (
    <span aria-hidden="true" className="private-notice-track">
      {noticeVisible && <span key={`${headKind}-${headId}`} className="private-notice-progress" />}
    </span>
  );

  return createPortal(<>
    <p role="status" aria-label={translateText("Robbery result")} aria-atomic="true" className="sr-only">
      <span key={theft ? `${playerId}-theft-${theft.id}` : "empty"}>{theftDescription}</span>
    </p>
    <p role="status" aria-label={translateText("Monopoly result")} aria-atomic="true" className="sr-only">
      <span key={monopoly ? `${playerId}-monopoly-${monopoly.id}` : "empty"}>{monopolyDescription}</span>
    </p>
    <p role="status" aria-label={translateText("Sabotage result")} aria-atomic="true" className="sr-only">
      <span key={sabotage ? `${playerId}-sabotage-${sabotage.id}` : "empty"}>{sabotageDescription}</span>
    </p>
    <p role="status" aria-label={translateText("Trade result")} aria-atomic="true" className="sr-only">
      <span key={tradeOutcome ? `${playerId}-trade-${tradeOutcome.id}` : "empty"}>{tradeOutcomeDescription}</span>
    </p>
    {theft && theftPlayer && <section ref={notice} aria-label={translateText("Robbery notification")}
      className={`private-notice overflow-hidden rounded-xl border bg-paper p-4 shadow-lg ${lostResources ? "border-clay" : "border-[#91ad9b]"}`}>
      <div className="flex items-start justify-between gap-2">
        <h2 className="flex min-w-0 items-center gap-2 break-words font-serif text-xl leading-tight">
          <RobberIcon className={`h-5 w-5 shrink-0 ${lostResources ? "text-clay" : "text-ink"}`} />
          <span className="min-w-0">{translateText(lostResources ? "{player} robbed you" : "You stole from {player}", { player: theftPlayer.name })}</span>
        </h2>
        <button type="button" aria-label={translateText("Dismiss robbery notification")}
          className="-mr-2 -mt-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-moss"
          onClick={() => setDismissedThefts(previous => ({ ...previous, [playerId]: theft.id }))}>
          <CloseIcon className="h-4 w-4" />
        </button>
      </div>
      <div key={`theft-${theft.id}`} className="private-notice-body">
        <div className="mt-2 flex items-center justify-between gap-3">
          <ResourceCard resource={theft.resource} compact iconClassName="h-6 w-6" className="h-16 w-11" />
          <span aria-hidden="true" className={`text-3xl font-bold leading-none tabular-nums ${lostResources ? "text-[#934c36]" : "text-ink"}`}>
            {stolenCount}
          </span>
        </div>
        {footer}
      </div>
      {progressBar}
    </section>}
    {monopoly && monopolist && <section ref={notice} aria-label={translateText("Monopoly notification")}
      className="private-notice overflow-hidden rounded-xl border border-clay bg-paper p-4 shadow-lg">
      <div className="flex items-start justify-between gap-2">
        <h2 className="flex min-w-0 items-center gap-2 break-words font-serif text-xl leading-tight">
          <span aria-hidden="true" className="inline-flex h-5 w-5 shrink-0 items-center justify-center text-clay [&>svg]:h-5 [&>svg]:w-5">
            <DevelopmentCardIcon kind="monopoly" />
          </span>
          <span className="min-w-0">{translateText("{player}'s Monopoly", { player: monopolist.name })}</span>
        </h2>
        <button type="button" aria-label={translateText("Dismiss Monopoly notification")}
          className="-mr-2 -mt-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-moss"
          onClick={() => setDismissedMonopolies(previous => ({ ...previous, [playerId]: monopoly.id }))}>
          <CloseIcon className="h-4 w-4" />
        </button>
      </div>
      <div key={`monopoly-${monopoly.id}`} className="private-notice-body">
        <div className="mt-2 flex items-center justify-between gap-3">
          <ResourceCard resource={monopoly.resource} compact iconClassName="h-6 w-6" className="h-16 w-11" />
          <span aria-hidden="true" className="text-3xl font-bold leading-none tabular-nums text-[#934c36]">
            {`-${lostCount}`}
          </span>
        </div>
        {footer}
      </div>
      {progressBar}
    </section>}
    {sabotage && saboteur && <section ref={notice} aria-label={translateText("Sabotage notification")}
      className="private-notice overflow-hidden rounded-xl border border-clay bg-paper p-4 shadow-lg">
      <div className="flex items-start justify-between gap-2">
        <h2 className="min-w-0 break-words font-serif text-xl leading-tight">{translateText("{player} sabotaged you", { player: saboteur.name })}</h2>
        <button type="button" aria-label={translateText("Dismiss sabotage notification")}
          className="-mr-2 -mt-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-moss"
          onClick={() => setDismissedSabotages(previous => ({ ...previous, [playerId]: sabotage.id }))}>
          <CloseIcon className="h-4 w-4" />
        </button>
      </div>
      <div key={`sabotage-${sabotage.id}`} className="private-notice-body">
        <div className="mt-2 flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-clay/15 text-clay">
            <PieceIcon piece={sabotage.kind} />
          </span>
          <p className="min-w-0 text-sm leading-5 text-ink">{sabotageDescription}</p>
        </div>
        {footer}
      </div>
      {progressBar}
    </section>}
    {tradeOutcome && <section ref={notice} aria-label={translateText("Trade notification")}
      className={`private-notice overflow-hidden rounded-xl border bg-paper px-3.5 py-2.5 shadow-lg ${tradeOutcome.kind === "completed" && tradeOutcome.partnerName ? "border-[#91ad9b]" : "border-line"}`}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex min-w-0 items-center gap-2 break-words font-serif text-lg leading-tight">
          <TradeIcon className="h-4 w-4 shrink-0 text-muted" />
          <span className="min-w-0">{tradeOutcomeTitle}</span>
        </h2>
        <button type="button" aria-label={translateText("Dismiss trade notification")}
          className="-mr-1.5 -my-1.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-moss"
          onClick={() => setDismissedTradeOutcomes(previous => ({ ...previous, [playerId]: tradeOutcome.id }))}>
          <CloseIcon className="h-4 w-4" />
        </button>
      </div>
      <div key={`trade-${tradeOutcome.id}`} className="private-notice-body">
        {tradeOutcome.gave && tradeOutcome.received ? (
          <div className="mt-1.5 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center justify-items-center gap-2 rounded-lg bg-moss/65 px-2.5 py-1.5">
            <CardStack label={translateText("You give")} resources={tradeOutcome.gave} />
            <Arrow className="h-4 w-4 shrink-0 text-ink/60" />
            <CardStack label={translateText("You receive")} resources={tradeOutcome.received} />
          </div>
        ) : (
          <p className="mt-1 text-xs text-muted">{tradeOutcomeDescription}</p>
        )}
        {footer}
      </div>
      {progressBar}
    </section>}
  </>, target);
}
