import { useState } from "react";
import { emptyResources, getTradeRatio, RESOURCES, resourceTotal } from "../game/engine";
import type { Board, GameAction, Player, Resource, Resources, TradeOffer } from "../game/types";
import { resourceName } from "../i18n";
import { useLanguage, useTranslation } from "../localization";
import { gameplayTranslations } from "../translations/gameplay";
import {
  Arrow,
  CardStack,
  Dialog,
  ResourceCard,
  ResourceCardStepper,
  ResourceInventory,
  SelectableResourceCard,
} from "./GameUi";
import { BankHarborIcon, TradeIcon } from "./Icons";

export function TradeDialog({
  game,
  player,
  initialOffer,
  initialMode = "bank",
  disabled = false,
  error,
  onClose,
  onSubmit,
  onModeChange,
}: {
  game: { board: Board; bank: Resources; players: Pick<Player, "id">[] };
  player: Pick<Player, "id" | "resources">;
  initialOffer?: TradeOffer | null;
  initialMode?: "bank" | "players";
  disabled?: boolean;
  error?: string;
  onClose: () => void;
  onSubmit: (action: GameAction) => void;
  onModeChange?: (mode: "bank" | "players") => void;
}) {
  const { language } = useLanguage();
  const translateText = useTranslation(gameplayTranslations);
  const [tradeMode, setTradeMode] = useState<"bank" | "players">(() => initialOffer ? "players" : initialMode);
  const [playerTradeMode, setPlayerTradeMode] = useState<"request" | "offer">(() => initialOffer?.give ? "offer" : "request");
  const [giveResource, setGiveResource] = useState<Resource>(() =>
    RESOURCES.find(resource => player.resources[resource] >= getTradeRatio(game, player.id, resource)) ?? "wood",
  );
  const [receiveResource, setReceiveResource] = useState<Resource>(() => {
    const initialGive = RESOURCES.find(resource => player.resources[resource] >= getTradeRatio(game, player.id, resource)) ?? "wood";
    return RESOURCES.find(resource => resource !== initialGive && game.bank[resource] > 0) ?? (initialGive === "brick" ? "wood" : "brick");
  });
  const [giveResources, setGiveResources] = useState(() => ({ ...(initialOffer?.give ?? emptyResources()) }));
  const [receiveResources, setReceiveResources] = useState(() => ({ ...(initialOffer?.receive ?? emptyResources()) }));
  const ratio = getTradeRatio(game, player.id, giveResource);
  const canExchange = giveResource !== receiveResource &&
    player.resources[giveResource] >= ratio && game.bank[receiveResource] > 0;

  return (
    <Dialog
      title={translateText("A fair exchange")}
      summary={tradeMode === "players" ? <ResourceInventory resources={player.resources} /> : undefined}
      onClose={onClose}
    >
      <div className="mb-6 flex rounded-xl bg-moss p-1">
        {(["bank", "players"] as const).map((mode) => (
          <button
            key={mode}
            aria-pressed={tradeMode === mode}
            className={`flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-lg text-sm ${tradeMode === mode ? "bg-white shadow-sm" : "text-muted"}`}
            onClick={() => {
              setTradeMode(mode);
              onModeChange?.(mode);
            }}
          >
            {mode === "bank" ? <BankHarborIcon /> : <TradeIcon />}
            {translateText(mode === "bank" ? "Bank & ports" : "Player trade")}
          </button>
        ))}
      </div>
      {tradeMode === "bank" ? (
        <>
          <p className="mb-4 text-sm leading-6 text-muted">
            {translateText("Your best bank or port rate is shown on each card.")}
          </p>
          {initialOffer && (
            <p className="mb-4 rounded-lg border border-clay/30 bg-clay/10 px-3 py-2 text-xs font-medium text-clay">
              {translateText("Confirming a bank exchange will withdraw your open player trade.")}
            </p>
          )}
          <fieldset className="mb-5" disabled={disabled}>
            <legend className="mb-3 text-sm font-semibold">
              {translateText("You give")}
            </legend>
            <div className="grid grid-cols-5 gap-2 sm:gap-3">
              {RESOURCES.map((resource) => (
                <SelectableResourceCard
                  key={resource}
                  resource={resource}
                  action="Give"
                  count={player.resources[resource]}
                  countLabel="In hand"
                  caption={`${getTradeRatio(game, player.id, resource)}:1`}
                  selected={giveResource === resource}
                  disabled={player.resources[resource] < getTradeRatio(game, player.id, resource)}
                  onClick={() => setGiveResource(resource)}
                />
              ))}
            </div>
          </fieldset>
          <fieldset disabled={disabled}>
            <legend className="mb-3 text-sm font-semibold">
              {translateText("Take 1 from the bank")}
            </legend>
            <div className="grid grid-cols-5 gap-2 sm:gap-3">
              {RESOURCES.map((resource) => (
                <SelectableResourceCard
                  key={resource}
                  resource={resource}
                  action="Receive"
                  count={game.bank[resource]}
                  countLabel="In bank"
                  caption=""
                  selected={receiveResource === resource}
                  disabled={game.bank[resource] < 1}
                  onClick={() => setReceiveResource(resource)}
                />
              ))}
            </div>
          </fieldset>
          <div
            className="my-5 flex items-center justify-center gap-2 rounded-xl bg-moss p-4"
            aria-hidden="true"
          >
            {Array.from({ length: ratio }, (_, index) => (
              <ResourceCard
                key={index}
                resource={giveResource}
                compact
                iconClassName="h-5 w-5"
                className="h-13 w-9"
              />
            ))}
            <Arrow className="h-5 w-5 shrink-0 text-forest" />
            <ResourceCard
              resource={receiveResource}
              compact
              iconClassName="h-5 w-5"
              className="h-13 w-9"
            />
          </div>
          {canExchange && (
            <p role="status" aria-label={translateText("Hand after exchange")} className="mb-3 text-xs leading-5 text-ink">
              {translateText("After exchange: {giveCount} {giveResource}, {receiveCount} {receiveResource} in your hand. Other cards stay the same.", {
                giveCount: player.resources[giveResource] - ratio,
                giveResource: resourceName(language, giveResource),
                receiveCount: player.resources[receiveResource] + 1,
                receiveResource: resourceName(language, receiveResource),
              })}
            </p>
          )}
          <div className="trade-dialog-actions mt-4 space-y-2">
            {error && (
              <p role="alert" className="text-xs font-medium text-clay">
                {error}
              </p>
            )}
            <button
              className="button-primary w-full"
              disabled={disabled || !canExchange}
              onClick={() => onSubmit({ type: "bank-trade", give: giveResource, receive: receiveResource })}
            >
              {translateText("Confirm exchange")}
            </button>
            <p className="text-xs text-muted">
              {translateText("Choose different resources and enough cards to make the exchange.")}
            </p>
          </div>
        </>
      ) : (
        <>
          <div role="group" aria-label={translateText("Player trade type")} className="mb-5 flex rounded-xl bg-moss p-1">
            {(["request", "offer"] as const).map(mode => (
              <button
                key={mode}
                aria-pressed={playerTradeMode === mode}
                className={`min-h-10 flex-1 rounded-lg text-sm ${playerTradeMode === mode ? "bg-white shadow-sm" : "text-muted"}`}
                onClick={() => setPlayerTradeMode(mode)}
              >
                {translateText(mode === "request" ? "Request cards" : "Exact offer")}
              </button>
            ))}
          </div>
          <fieldset disabled={disabled} className="space-y-5">
            {playerTradeMode === "offer" && <>
            <ResourceCardStepper
              label={translateText("You offer")}
              values={giveResources}
              maximum={player.resources}
              onChange={setGiveResources}
            />
            <div
              className="flex items-center justify-center gap-4 rounded-xl bg-moss p-4"
              aria-hidden="true"
            >
              <CardStack resources={giveResources} emptyText={translateText("Nothing offered")} />
              <Arrow className="h-5 w-5 shrink-0 text-forest" />
              <CardStack resources={receiveResources} emptyText={translateText("Nothing asked")} />
            </div>
            </>}
            <ResourceCardStepper
              label={translateText("You ask for")}
              values={receiveResources}
              onChange={setReceiveResources}
            />
          </fieldset>
          <div className="trade-dialog-actions mt-4 space-y-2">
            {error && (
              <p role="alert" className="text-xs font-medium text-clay">
                {error}
              </p>
            )}
            <p className="text-xs leading-5 text-muted">
              {translateText(playerTradeMode === "request"
                ? "Players name a price. You choose whether to trade."
                : "No cards move until you confirm a trade.")}
            </p>
            <button
              className="button-primary w-full"
              disabled={disabled || !resourceTotal(receiveResources) ||
                (playerTradeMode === "offer" && (!resourceTotal(giveResources) || RESOURCES.some(
                  resource => giveResources[resource] > player.resources[resource] ||
                    (giveResources[resource] > 0 && receiveResources[resource] > 0),
                )))}
              onClick={() => onSubmit(playerTradeMode === "request" ? {
                type: "request-trade",
                receive: receiveResources,
              } : {
                type: "offer-trade",
                give: giveResources,
                receive: receiveResources,
              })}
            >
              {translateText(playerTradeMode === "request" ? "Ask for these cards" : "Put the offer on the table")}
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
}
