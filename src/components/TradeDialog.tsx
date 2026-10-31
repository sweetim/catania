import { useState } from "react";
import { emptyResources, getTradeRatio, RESOURCES, resourceTotal } from "../game/engine";
import type { Board, GameAction, Player, Resource, Resources, TradeOffer } from "../game/types";
import {
  Arrow,
  CardStack,
  Dialog,
  RESOURCE_NAMES,
  ResourceCard,
  ResourceCardStepper,
  ResourceInventory,
  SelectableResourceCard,
} from "./GameUi";

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
  const [tradeMode, setTradeMode] = useState<"bank" | "players">(() => initialOffer ? "players" : initialMode);
  const [playerTradeMode, setPlayerTradeMode] = useState<"request" | "offer">(() => initialOffer ? "offer" : "request");
  const [giveResource, setGiveResource] = useState<Resource>("wood");
  const [receiveResource, setReceiveResource] = useState<Resource>("brick");
  const [giveResources, setGiveResources] = useState(() => ({ ...(initialOffer?.give ?? emptyResources()) }));
  const [receiveResources, setReceiveResources] = useState(() => ({ ...(initialOffer?.receive ?? emptyResources()) }));
  const ratio = getTradeRatio(game, player.id, giveResource);
  const canExchange = giveResource !== receiveResource &&
    player.resources[giveResource] >= ratio && game.bank[receiveResource] > 0;

  return (
    <Dialog
      title="A fair exchange"
      summary={tradeMode === "players" ? <ResourceInventory resources={player.resources} /> : undefined}
      onClose={onClose}
    >
      <div className="mb-6 flex rounded-xl bg-moss p-1">
        {(["bank", "players"] as const).map((mode) => (
          <button
            key={mode}
            aria-pressed={tradeMode === mode}
            className={`min-h-10 flex-1 rounded-lg text-sm ${tradeMode === mode ? "bg-white shadow-sm" : "text-muted"}`}
            onClick={() => {
              setTradeMode(mode);
              onModeChange?.(mode);
            }}
          >
            {mode === "bank" ? "Bank & ports" : "Player trade"}
          </button>
        ))}
      </div>
      {tradeMode === "bank" ? (
        <>
          <p className="mb-5 text-sm leading-6 text-muted">
            Your best bank or port rate is shown on each card.
          </p>
          <fieldset className="mb-5" disabled={disabled}>
            <legend className="mb-3 text-sm font-semibold">
              You give
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
              Take 1 from the bank
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
            <p role="status" aria-label="Hand after exchange" className="mb-4 text-xs leading-5 text-ink">
              After exchange: {player.resources[giveResource] - ratio} {RESOURCE_NAMES[giveResource]}, {player.resources[receiveResource] + 1} {RESOURCE_NAMES[receiveResource]} in your hand. Other cards stay the same.
            </p>
          )}
          <button
            className="button-primary w-full"
            disabled={disabled || !canExchange}
            onClick={() => onSubmit({ type: "bank-trade", give: giveResource, receive: receiveResource })}
          >
            Confirm exchange
          </button>
          <p className="mt-3 text-xs text-muted">
            Choose different resources and enough cards to make the
            exchange.
          </p>
        </>
      ) : (
        <>
          <div role="group" aria-label="Player trade type" className="mb-5 flex rounded-xl bg-moss p-1">
            {(["request", "offer"] as const).map(mode => (
              <button
                key={mode}
                aria-pressed={playerTradeMode === mode}
                className={`min-h-10 flex-1 rounded-lg text-sm ${playerTradeMode === mode ? "bg-white shadow-sm" : "text-muted"}`}
                onClick={() => setPlayerTradeMode(mode)}
              >
                {mode === "request" ? "Request cards" : "Exact offer"}
              </button>
            ))}
          </div>
          <fieldset disabled={disabled} className="space-y-5">
            {playerTradeMode === "offer" && <>
            <ResourceCardStepper
              label="You offer"
              values={giveResources}
              maximum={player.resources}
              onChange={setGiveResources}
            />
            <div
              className="flex items-center justify-center gap-4 rounded-xl bg-moss p-4"
              aria-hidden="true"
            >
              <CardStack resources={giveResources} emptyText="Nothing offered" />
              <Arrow className="h-5 w-5 shrink-0 text-forest" />
              <CardStack resources={receiveResources} emptyText="Nothing asked" />
            </div>
            </>}
            <ResourceCardStepper
              label="You ask for"
              values={receiveResources}
              onChange={setReceiveResources}
            />
          </fieldset>
          <p className="my-4 text-xs leading-6 text-muted">
            {playerTradeMode === "request"
              ? "Players name a price. You choose whether to trade."
              : "No cards move until you confirm a trade."}
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
            {playerTradeMode === "request" ? "Ask for these cards" : "Put the offer on the table"}
          </button>
        </>
      )}
      {error && (
        <p role="alert" className="mt-4 text-sm text-clay">
          {error}
        </p>
      )}
    </Dialog>
  );
}
