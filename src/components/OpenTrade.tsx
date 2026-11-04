import { RESOURCES, resourceTotal } from "../game/engine";
import type { GameAction, Player, Resources, TradeOffer } from "../game/types";
import { resourceName } from "../i18n";
import { useLanguage, useTranslation } from "../localization";
import { gameplayTranslations } from "../translations/gameplay";
import { Arrow, CardStack, ResourceCardStepper } from "./GameUi";

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
  const { language } = useLanguage();
  const translateText = useTranslation(gameplayTranslations);
  const responding = viewer.id !== trade.offeredBy;
  const canAfford = (resources: Resources) => RESOURCES.every(resource => viewer.resources[resource] >= resources[resource]);

  return (
    <>
      {responding && <p className="mt-1 text-xs text-muted">
        {translateText("From {player}", { player: players.find(player => player.id === trade.offeredBy)?.name ?? "" })}
      </p>}
      {trade.expiresAt !== undefined && (
        <p className="mt-1 text-xs text-muted">{translateText("Computer players wait up to 15 seconds for prices.")}</p>
      )}
      <div className="my-3 flex items-center justify-center gap-4 rounded-xl bg-moss/70 p-3">
        {trade.give ? <>
          <CardStack label={translateText("You give")} resources={responding ? trade.receive : trade.give} available={responding ? viewer.resources : undefined} />
          <Arrow className="h-5 w-5 shrink-0 text-forest" />
          <CardStack label={translateText("You receive")} resources={responding ? trade.give : trade.receive} />
        </> : <CardStack label={translateText(responding ? "You give" : "You receive")} resources={trade.receive} available={responding ? viewer.resources : undefined} />}
      </div>
      {viewer.id === trade.offeredBy ? (
        <div className="space-y-2">
          {players.filter(player => player.id !== viewer.id).map(player => {
            const response = trade.responses[player.id];
            const status = response ? trade.give ? "accepted" : null
              : response === false ? "declined" : "not answered";
            const missingCards = response ? RESOURCES
              .filter(resource => response[resource] > viewer.resources[resource])
              .map(resource => translateText("{count} {resource}", { count: response[resource] - viewer.resources[resource], resource: resourceName(language, resource) }))
              .join(language === "ja" ? "、" : ", ") : "";
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
                  className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${response ? "bg-forest text-ink" : response === false ? "bg-ink/10 text-muted" : "border border-line text-muted"}`}
                >
                  {translateText(status)}
                </span>}
                {response ? (
                  <div className="flex w-full flex-wrap items-center justify-between gap-3 pt-1">
                    {!trade.give && <CardStack label={translateText("You give")} resources={response} />}
                    <div className="ml-auto flex min-w-0 max-w-full flex-col items-end gap-1.5">
                      <button
                        className="button-primary !min-h-11 !px-3 !text-xs"
                        disabled={disabled || !canAfford(response)}
                        aria-describedby={missingCards ? `trade-missing-${player.id}` : undefined}
                        onClick={() => onComplete(player.id, response)}
                      >
                        {translateText("Complete trade")}
                      </button>
                      {missingCards && <p id={`trade-missing-${player.id}`} className="text-right text-xs text-clay">
                        {translateText("Missing {resources}", { resources: missingCards })}
                      </p>}
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
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
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
      ) : (
        <>
          {!trade.give && (
            <fieldset disabled={disabled} className="mb-4 space-y-3">
              <ResourceCardStepper label={translateText("You want in return")} values={chosenResources} onChange={onChangeResources} />
            </fieldset>
          )}
          <div className="grid grid-cols-2 gap-2">
            <button
              className="button-secondary"
              disabled={disabled}
              onClick={() => onRespond({ type: "respond-trade", accept: false })}
            >
              {translateText("Decline")}
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
              {translateText(trade.give ? "Accept offer" : "Propose price")}
            </button>
          </div>
        </>
      )}
    </>
  );
}
