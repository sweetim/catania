import { useEffect, useState } from "react";
import { RESOURCES, resourceTotal } from "../game/engine";
import type { GameAction, Player, Resources, TradeOffer } from "../game/types";
import { resourceName } from "../i18n";
import { useLanguage, useTranslation } from "../localization";
import { gameplayTranslations } from "../translations/gameplay";
import { Arrow, CardStack, ResourceCardStepper } from "./GameUi";
import { WarningIcon } from "./Icons";
import { DisconnectedIcon } from "./PlayerSeat";

export function OpenTrade({
  trade,
  viewer,
  players,
  chosenResources,
  onChangeResources,
  onComplete,
  onEdit,
  onWithdraw,
  onRespond,
  onPass,
  disabled = false,
  error,
}: {
  trade: TradeOffer;
  viewer: Pick<Player, "id" | "resources">;
  players: (Pick<Player, "id" | "name" | "color" | "control"> & {
    connected?: boolean;
    resourceCount?: number;
  })[];
  chosenResources: Resources;
  onChangeResources: (resources: Resources) => void;
  onComplete: (playerId: string, price: Resources) => void;
  onEdit: () => void;
  onWithdraw: () => void;
  onRespond: (action: GameAction) => void;
  onPass?: (playerId: string) => void;
  disabled?: boolean;
  error?: string;
}) {
  const { language } = useLanguage();
  const translateText = useTranslation(gameplayTranslations);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (trade.expiresAt === undefined) return;
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(interval);
  }, [trade.expiresAt]);
  const secondsRemaining = trade.expiresAt !== undefined
    ? Math.max(0, Math.ceil((trade.expiresAt - now) / 1000))
    : null;
  const responding = viewer.id !== trade.offeredBy;
  const offeringPlayer = players.find(player => player.id === trade.offeredBy);
  const myResponse = responding ? trade.responses[viewer.id] : undefined;
  const canAfford = (resources: Resources) => RESOURCES.every(resource => viewer.resources[resource] >= resources[resource]);
  const formatMissing = (resources: Resources) => RESOURCES
    .filter(resource => resources[resource] > viewer.resources[resource])
    .map(resource => translateText("{count} {resource}", { count: resources[resource] - viewer.resources[resource], resource: resourceName(language, resource) }))
    .join(language === "ja" ? "、" : ", ");
  const hasChosenResources = resourceTotal(chosenResources) > 0;
  const hasOverlap = RESOURCES.some(resource => chosenResources[resource] > 0 && trade.receive[resource] > 0);
  const missingRequested = responding ? formatMissing(trade.receive) : "";
  const overlapHint = !missingRequested && !trade.give && hasOverlap
    ? translateText("Choose different resources than the ones you give.")
    : "";
  const showReturnPreview = Boolean(trade.give || (responding && !missingRequested));

  return (
    <>
      {responding && (
        <div className="mb-2.5 flex flex-wrap items-center gap-2 text-xs font-semibold text-ink">
          <span className="flex min-w-0 items-center gap-2">
            {offeringPlayer && (
              <span
                aria-hidden="true"
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: offeringPlayer.color }}
              />
            )}
            <span className="truncate">{translateText("From {player}", { player: offeringPlayer?.name ?? "" })}</span>
          </span>
          {offeringPlayer?.resourceCount !== undefined && (
            <span className="shrink-0 rounded-full bg-moss px-2 py-0.5 text-[11px] font-medium text-muted tabular-nums">
              {translateText(offeringPlayer.resourceCount === 1 ? "{count} card" : "{count} cards", { count: offeringPlayer.resourceCount })}
            </span>
          )}
          {secondsRemaining !== null && (
            <span
              role="timer"
              aria-label={translateText("Expires in {seconds}s", { seconds: secondsRemaining })}
              className={`ml-auto shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${secondsRemaining <= 5 ? "border border-clay/35 bg-clay/15 text-clay" : "bg-moss text-ink/80"}`}
            >
              {translateText("{seconds}s left", { seconds: secondsRemaining })}
            </span>
          )}
        </div>
      )}
      {responding && myResponse !== undefined && (
        <div
          role="status"
          className={`mb-2.5 flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs font-semibold ${
            myResponse === false
              ? "border-line bg-ink/5 text-muted"
              : "border-forest/40 bg-forest/20 text-ink"
          }`}
        >
          <span>
            {myResponse === false
              ? translateText("You declined this trade.")
              : trade.give
                ? translateText("You accepted this offer.")
                : translateText("Your proposed price")}
          </span>
          {myResponse && !trade.give && (
            <CardStack resources={myResponse} />
          )}
        </div>
      )}
      <div className={`my-2.5 rounded-xl border bg-moss/65 px-3 py-2.5 ${missingRequested ? "border-clay/35" : "border-line/70"}`}>
        <div className={showReturnPreview ? "grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center justify-items-center gap-2" : "flex items-center justify-center"}>
          {trade.give ? <>
            <CardStack label={translateText("You give")} resources={responding ? trade.receive : trade.give} available={responding ? viewer.resources : undefined} />
            <Arrow className="h-4 w-4 shrink-0 text-ink/60" />
            <CardStack label={translateText("You receive")} resources={responding ? trade.give : trade.receive} />
          </> : responding && !missingRequested ? <>
            <CardStack label={translateText("You give")} resources={trade.receive} available={viewer.resources} />
            <Arrow className={`h-4 w-4 shrink-0 transition-colors ${hasChosenResources ? "text-ink" : "text-ink/35"}`} />
            {hasChosenResources ? (
              <CardStack label={translateText("You receive")} resources={chosenResources} />
            ) : (
              <span className="inline-flex min-w-0 flex-col items-center gap-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-[.1em] text-muted">
                  {translateText("You receive")}
                </span>
                <span className="flex h-12 items-center justify-center rounded-lg border border-dashed border-ink/25 bg-paper/70 px-2.5 text-center text-[11px] font-medium text-muted">
                  {translateText("Choose below")}
                </span>
              </span>
            )}
          </> : responding ? (
            <CardStack label={translateText("You give")} resources={trade.receive} available={viewer.resources} />
          ) : <CardStack label={translateText("You receive")} resources={trade.receive} />}
        </div>
        {missingRequested && (
          <div className="mt-2.5 flex justify-center border-t border-clay/20 pt-2">
            <p
              id="trade-missing-requested"
              className="inline-flex items-center gap-1.5 rounded-full border border-clay/30 bg-clay/10 px-2.5 py-1 text-xs font-semibold text-clay"
            >
              <WarningIcon />
              {translateText("Missing {resources}", { resources: missingRequested })}
            </p>
          </div>
        )}
      </div>
      {viewer.id === trade.offeredBy ? (
        <>
          <div className="space-y-2">
            {players.filter(player => player.id !== viewer.id).map(player => {
              const response = trade.responses[player.id];
              const disconnected = player.control === "human" && player.connected === false;
              const status = response ? trade.give ? "accepted" : null
                : response === false ? "declined" : disconnected ? "disconnected" : "not answered";
              const missingCards = response ? formatMissing(response) : "";
              return (
                <div
                  key={player.id}
                  role="group"
                  aria-label={translateText("{player}'s trade response", { player: player.name })}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-white/40 px-3 py-2"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: player.color }} />
                    <span className="truncate text-xs font-semibold">{player.name}</span>
                  </span>
                  {status && <span
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold ${
                      response ? "bg-forest text-ink"
                        : response === false ? "bg-ink/10 text-muted"
                          : disconnected ? "border border-clay/30 bg-clay/10 text-clay"
                            : "border border-line text-muted"
                    }`}
                  >
                    {disconnected && !response && response !== false && <DisconnectedIcon className="h-3 w-3 shrink-0" />}
                    {translateText(status)}
                  </span>}
                  {response ? (
                    <div className="flex w-full flex-wrap items-center justify-between gap-3 pt-1">
                      {!trade.give && <CardStack label={translateText("You give")} resources={response} available={viewer.resources} />}
                      <div className="ml-auto flex min-w-0 max-w-full flex-col items-end gap-1.5">
                        <button
                          className="button-primary !min-h-11 !px-3 !text-xs"
                          disabled={disabled || !canAfford(response)}
                          aria-describedby={missingCards ? `trade-missing-${player.id}` : undefined}
                          onClick={() => onComplete(player.id, response)}
                        >
                          {translateText("Complete trade")}
                        </button>
                        {missingCards && (
                          <p
                            id={`trade-missing-${player.id}`}
                            className="inline-flex items-center gap-1.5 rounded-full border border-clay/30 bg-clay/10 px-2.5 py-0.5 text-xs font-semibold text-clay"
                          >
                            <WarningIcon />
                            {translateText("Missing {resources}", { resources: missingCards })}
                          </p>
                        )}
                      </div>
                    </div>
                  ) : player.control === "human" && onPass ? (
                    <button
                      className="min-h-11 text-xs font-semibold underline"
                      disabled={disabled}
                      onClick={() => onPass(player.id)}
                    >
                      {translateText("Pass to {player}", { player: player.name })}
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
          <div className="open-trade-actions mt-3 space-y-2">
            {error && <p role="alert" className="text-xs font-medium text-clay">{error}</p>}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button
                className="button-secondary !min-h-11 !px-3 !text-xs"
                aria-haspopup="dialog"
                disabled={disabled}
                onClick={onEdit}
              >
                {translateText("Change offer")}
              </button>
              <button
                className="min-h-11 text-xs text-clay underline"
                disabled={disabled}
                onClick={onWithdraw}
              >
                {translateText(trade.give ? "Withdraw offer" : "Withdraw request")}
              </button>
            </div>
          </div>
        </>
      ) : (
        <>
          {!trade.give && !missingRequested && (
            <fieldset disabled={disabled} className="mt-3">
              <ResourceCardStepper label={translateText("You want in return")} values={chosenResources} onChange={onChangeResources} />
            </fieldset>
          )}
          <div className="open-trade-actions mt-3 space-y-2">
            {error && <p role="alert" className="text-xs font-medium text-clay">{error}</p>}
            {overlapHint && (
              <p
                id="trade-overlap-hint"
                className="flex items-center justify-center gap-1.5 rounded-lg border border-clay/30 bg-clay/10 px-3 py-1.5 text-center text-xs font-semibold text-clay"
              >
                <WarningIcon />
                {overlapHint}
              </p>
            )}
            <div className="grid grid-cols-2 gap-2.5">
              <button
                className={missingRequested ? "button-primary" : "button-secondary"}
                disabled={disabled}
                onClick={() => onRespond({ type: "respond-trade", accept: false })}
              >
                {translateText("Decline")}
              </button>
              <button
                className={missingRequested ? "button-secondary" : "button-primary"}
                aria-describedby={missingRequested ? "trade-missing-requested" : overlapHint ? "trade-overlap-hint" : undefined}
                disabled={disabled || !canAfford(trade.receive) || (!trade.give && (
                  !hasChosenResources || hasOverlap
                ))}
                onClick={() => onRespond(trade.give
                  ? { type: "respond-trade", accept: true }
                  : { type: "propose-trade", price: chosenResources })}
              >
                {translateText(trade.give ? "Accept offer" : myResponse && typeof myResponse === "object" ? "Update price" : "Propose price")}
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
