import { RESOURCES, resourceTotal } from "../game/engine";
import type { GameAction, Player, Resources, TradeOffer } from "../game/types";
import { Arrow, CardStack, RESOURCE_NAMES, ResourceCardStepper } from "./GameUi";

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
}: {
  trade: TradeOffer;
  viewer: Pick<Player, "id" | "resources">;
  players: Pick<Player, "id" | "name" | "color" | "control">[];
  chosenResources: Resources;
  onChangeResources: (resources: Resources) => void;
  onComplete: (playerId: string, price: Resources) => void;
  onEdit: () => void;
  onWithdraw: () => void;
  onRespond: (action: GameAction) => void;
  onPass?: (playerId: string) => void;
  disabled?: boolean;
}) {
  const canAfford = (resources: Resources) => RESOURCES.every(resource => viewer.resources[resource] >= resources[resource]);

  return (
    <>
      {viewer.id !== trade.offeredBy && <p className="mt-1 text-xs text-muted">
        From {players.find(player => player.id === trade.offeredBy)?.name}
      </p>}
      <div className="my-3 flex items-center justify-center gap-4 rounded-xl bg-moss/70 p-3">
        {trade.give ? <>
          <CardStack label="You give" resources={viewer.id === trade.offeredBy ? trade.give : trade.receive} />
          <Arrow className="h-5 w-5 shrink-0 text-forest" />
          <CardStack label="You receive" resources={viewer.id === trade.offeredBy ? trade.receive : trade.give} />
        </> : <CardStack label={viewer.id === trade.offeredBy ? "You receive" : "You give"} resources={trade.receive} />}
      </div>
      {viewer.id === trade.offeredBy ? (
        <div className="space-y-2">
          {players.filter(player => player.id !== viewer.id).map(player => {
            const response = trade.responses[player.id];
            const status = response ? trade.give ? "accepted" : null
              : response === false ? "declined" : "not answered";
            const missingCards = response ? RESOURCES
              .filter(resource => response[resource] > viewer.resources[resource])
              .map(resource => `${response[resource] - viewer.resources[resource]} ${RESOURCE_NAMES[resource]}`)
              .join(", ") : "";
            return (
              <div
                key={player.id}
                role="group"
                aria-label={`${player.name}'s trade response`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-white/40 px-3 py-2"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: player.color }} />
                  <span className="truncate text-xs font-semibold">{player.name}</span>
                </span>
                {status && <span
                  className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${response ? "bg-forest text-ink" : response === false ? "bg-ink/10 text-muted" : "border border-line text-muted"}`}
                >
                  {status}
                </span>}
                {response ? (
                  <div className="flex w-full flex-wrap items-center justify-between gap-3 pt-1">
                    {!trade.give && <CardStack label="You give" resources={response} />}
                    <div className="ml-auto flex min-w-0 max-w-full flex-col items-end gap-1.5">
                      <button
                        className="button-primary !min-h-11 !px-3 !text-xs"
                        disabled={disabled || !canAfford(response)}
                        aria-describedby={missingCards ? `trade-missing-${player.id}` : undefined}
                        onClick={() => onComplete(player.id, response)}
                      >
                        Complete trade
                      </button>
                      {missingCards && <p id={`trade-missing-${player.id}`} className="text-right text-xs text-clay">
                        Missing {missingCards}
                      </p>}
                    </div>
                  </div>
                ) : player.control === "human" && onPass ? (
                  <button
                    className="min-h-11 text-xs font-semibold underline"
                    disabled={disabled}
                    onClick={() => onPass(player.id)}
                  >
                    Pass to {player.name}
                  </button>
                ) : null}
              </div>
            );
          })}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <button
              className="button-secondary !min-h-11 !px-3 !text-xs"
              aria-haspopup="dialog"
              disabled={disabled}
              onClick={onEdit}
            >
              Change offer
            </button>
            <button
              className="min-h-11 text-xs text-clay underline"
              disabled={disabled}
              onClick={onWithdraw}
            >
              {trade.give ? "Withdraw offer" : "Withdraw request"}
            </button>
          </div>
        </div>
      ) : (
        <>
          {!trade.give && (
            <fieldset disabled={disabled} className="mb-4 space-y-3">
              <ResourceCardStepper label="You want in return" values={chosenResources} onChange={onChangeResources} />
              <p className="text-xs leading-5 text-muted">
                Choose different cards in return.
              </p>
              {!canAfford(trade.receive) && (
                <p className="text-xs text-clay">You do not have all the requested cards to offer this trade.</p>
              )}
            </fieldset>
          )}
          <div className="grid grid-cols-2 gap-2">
            <button
              className="button-secondary"
              disabled={disabled}
              onClick={() => onRespond({ type: "respond-trade", accept: false })}
            >
              Decline
            </button>
            <button
              className="button-primary"
              disabled={disabled || !canAfford(trade.receive) || (!trade.give && (
                !resourceTotal(chosenResources) || RESOURCES.some(resource =>
                  chosenResources[resource] > 0 && trade.receive[resource] > 0)
              ))}
              onClick={() => onRespond(trade.give
                ? { type: "respond-trade", accept: true }
                : { type: "propose-trade", price: chosenResources })}
            >
              {trade.give ? "Accept offer" : "Propose price"}
            </button>
          </div>
        </>
      )}
    </>
  );
}
