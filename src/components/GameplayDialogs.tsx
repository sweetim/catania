import { useState } from "react";
import { emptyResources, RESOURCES, resourceTotal, victoryTarget } from "../game/engine";
import { isSeafarers, type DevelopmentKind, type GameAction, type GamePhase, type GameVariant, type Player, type Resource, type Resources } from "../game/types";
import { translate, type Language } from "../i18n";
import { useLanguage, useTranslation } from "../localization";
import { gameplayTranslations } from "../translations/gameplay";
import { Arrow, CardStack, DevelopmentCardIcon, Dialog, ResourceCardStepper, ResourceInventory, SelectableResourceCard } from "./GameUi";

export const DEVELOPMENT_NAMES = {
  knight: "Knight",
  "victory-point": "Victory point",
  "road-building": "Road building",
  "year-of-plenty": "Year of plenty",
  monopoly: "Monopoly",
  sabotage: "Sabotage",
} as const satisfies Record<DevelopmentKind, string>;
export const DEVELOPMENT_DESCRIPTIONS = {
  knight:
    "Move the robber and steal one random resource from an adjacent opponent. Only played Knights count toward Largest Army (+2 points): at least three, and more than the current holder.",
  "victory-point":
    "One hidden victory point. Counted automatically toward your ten points on your turn, including when purchased.",
  "road-building":
    "Place two roads for free, following the usual connection and piece-limit rules.",
  "year-of-plenty":
    "Choose two resources from the bank, or all that remain if fewer than two are available.",
  monopoly:
    "Name a resource. Every other player gives you all of that resource from their hand.",
  sabotage:
    "Destroy up to two opponent roads or ships, destroy one opponent settlement (not their last building), or reduce one opponent city to a settlement.",
} as const satisfies Record<DevelopmentKind, string>;

export function getDevelopmentNames(language: Language): Record<DevelopmentKind, string> {
  return Object.fromEntries(Object.entries(DEVELOPMENT_NAMES).map(([kind, name]) =>
    [kind, translate(language, gameplayTranslations, name)],
  )) as Record<DevelopmentKind, string>;
}

export function getDevelopmentDescriptions(language: Language, variant: GameVariant = "original", victoryPointsToWin = victoryTarget(variant)): Record<DevelopmentKind, string> {
  const descriptions = Object.fromEntries(Object.entries(DEVELOPMENT_DESCRIPTIONS).map(([kind, description]) =>
    [kind, translate(language, gameplayTranslations, description)],
  )) as Record<DevelopmentKind, string>;
  if (isSeafarers(variant)) {
    descriptions.knight = translate(language, gameplayTranslations, "Move the robber or pirate and steal one random resource from an adjacent opponent. Played Knights count toward Largest Army.");
    descriptions["road-building"] = translate(language, gameplayTranslations, "Place two roads or ships for free, following the usual connection and piece-limit rules.");
  }
  if (isSeafarers(variant) || victoryPointsToWin !== 10) {
    descriptions["victory-point"] = translate(language, gameplayTranslations, "One hidden victory point. Counts automatically toward victory on your turn, including when purchased.");
  }
  return descriptions;
}

export function DevelopmentDialog({
  variant = "original",
  victoryPointsToWin = victoryTarget(variant),
  player,
  bank,
  turnNumber,
  phaseType,
  developmentPlayed,
  active,
  hasSabotageTarget = true,
  disabled = false,
  initialCardId = null,
  error,
  onClose,
  onSubmit,
  onClearError,
}: {
  variant?: GameVariant;
  victoryPointsToWin?: number;
  player: Player;
  bank: Resources;
  turnNumber: number;
  phaseType: GamePhase["type"];
  developmentPlayed: boolean;
  active: boolean;
  hasSabotageTarget?: boolean;
  disabled?: boolean;
  initialCardId?: string | null;
  error?: string;
  onClose: () => void;
  onSubmit: (action: GameAction) => void;
  onClearError?: () => void;
}) {
  const { language } = useLanguage();
  const translateText = useTranslation(gameplayTranslations);
  const developmentNames = getDevelopmentNames(language);
  const developmentDescriptions = getDevelopmentDescriptions(language, variant, victoryPointsToWin);
  const cardGroups = [...new Set(player.developmentCards.map(card => card.kind))].map(kind => {
    const cards = player.developmentCards.filter(card => card.kind === kind);
    const playableCard = cards.find(card => card.purchasedTurn < turnNumber);
    const readyCount = cards.filter(card => card.purchasedTurn < turnNumber).length;
    return {
      kind,
      cards,
      selectedCard: kind === "victory-point" ? cards[0]! : playableCard ?? cards[0]!,
      readyCount,
      newThisTurnCount: cards.length - readyCount,
    };
  });
  const [selectedKind, setSelectedKind] = useState<DevelopmentKind | null>(
    () => player.developmentCards.find(card => card.id === initialCardId)?.kind ?? cardGroups[0]?.kind ?? null,
  );
  const [chosenResources, setChosenResources] = useState(emptyResources);
  const [chosenResource, setChosenResource] = useState<Resource>("wood");
  const selectedGroup = cardGroups.find(group => group.kind === selectedKind) ?? null;
  const developmentCard = selectedGroup?.selectedCard;
  const yearOfPlentyRequired = Math.min(2, resourceTotal(bank));
  const yearOfPlentyRemaining = Math.max(0, yearOfPlentyRequired - resourceTotal(chosenResources));
  const blockedReason = !selectedGroup || selectedGroup.kind === "victory-point" ? null
    : !active ? translateText("Available on your turn.")
      : !["roll", "actions"].includes(phaseType) ? translateText("Finish the current step before playing a development card.")
        : developmentPlayed ? translateText("You already played an action card this turn.")
          : selectedGroup.readyCount === 0 ? translateText("Wait until your next turn to play this card.")
            : selectedGroup.kind === "year-of-plenty" && resourceTotal(bank) === 0 ? translateText("The bank has no resources left.")
              : selectedGroup.kind === "year-of-plenty" && yearOfPlentyRemaining > 0
                ? translateText(yearOfPlentyRemaining === 1 ? "Choose {count} more resource from the bank." : "Choose {count} more resources from the bank.", { count: yearOfPlentyRemaining })
                : selectedGroup.kind === "sabotage" && !hasSabotageTarget
                  ? translateText("There are no opponent pieces available to sabotage.")
                  : null;
  const confirmDisabled = !selectedGroup || !developmentCard || disabled || Boolean(blockedReason) ||
    (selectedGroup.kind === "year-of-plenty" && (
      resourceTotal(chosenResources) !== yearOfPlentyRequired ||
      RESOURCES.some(resource => chosenResources[resource] > bank[resource])
    ));

  return (
    <Dialog
      title={translateText("A card up your sleeve")}
      summary={developmentCard?.kind === "year-of-plenty" || developmentCard?.kind === "monopoly" ? <ResourceInventory resources={player.resources} /> : undefined}
      onClose={onClose}
    >
      <div className="space-y-3">
        {cardGroups.map((group) => (
          <button
            key={group.kind}
            className={`w-full rounded-xl border p-4 text-left ${selectedGroup?.kind === group.kind ? "border-forest bg-moss" : "border-line"}`}
            aria-pressed={selectedGroup?.kind === group.kind}
            onClick={() => {
              setSelectedKind(group.kind);
              setChosenResources(emptyResources());
              onClearError?.();
            }}
          >
            <span className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-2 font-serif text-xl">
                <span className="text-forest"><DevelopmentCardIcon kind={group.kind} /></span>
                {developmentNames[group.kind]}
              </span>
              <span className="flex flex-wrap items-center justify-end gap-1.5">
                {group.cards.length > 1 && (
                  <span className="rounded-md bg-paper/90 px-2 py-0.5 text-xs font-semibold tabular-nums text-ink border border-line">
                    <span aria-hidden="true">&times;{group.cards.length}</span>
                    <span className="sr-only">{translateText("{count} cards", { count: group.cards.length })}</span>
                  </span>
                )}
                {group.kind === "victory-point" ? (
                  <span className="rounded-md bg-moss px-2 py-0.5 text-[10px] font-semibold text-muted">
                    {group.cards.length === 1
                      ? translateText("+1 hidden point")
                      : translateText("+{count} hidden points", { count: group.cards.length })}
                  </span>
                ) : group.readyCount === 0 ? (
                  <span className="rounded-md bg-clay/15 px-2 py-0.5 text-[10px] font-semibold text-clay">
                    {translateText("Available next turn")}
                  </span>
                ) : group.newThisTurnCount > 0 ? (
                  <span className="rounded-md bg-forest/45 px-2 py-0.5 text-[10px] font-semibold text-ink">
                    {translateText("{count} ready", { count: group.readyCount })}
                  </span>
                ) : null}
              </span>
            </span>
            <span className="mt-2 block text-xs leading-6 text-muted">
              {developmentDescriptions[group.kind]}
            </span>
          </button>
        ))}
      </div>
      {developmentCard && developmentCard.kind !== "victory-point" && (
        <div className="mt-5 border-t border-line pt-5">
          {developmentCard.kind === "year-of-plenty" && (
            <>
              <fieldset disabled={disabled}>
                <ResourceCardStepper
                  label={translateText("Take from the bank")}
                  values={chosenResources}
                  maximum={bank}
                  maximumLabel="In bank"
                  onChange={setChosenResources}
                />
              </fieldset>
              <p className="mt-3 text-xs text-muted">
                {translateText("Selected {selected} of {required}", { selected: resourceTotal(chosenResources), required: yearOfPlentyRequired })}
              </p>
            </>
          )}
          {developmentCard.kind === "monopoly" && (
            <fieldset disabled={disabled}>
              <legend className="mb-3 text-sm font-semibold">
                {translateText("Claim every card of this resource")}
              </legend>
              <div className="grid grid-cols-5 gap-2 sm:gap-3">
                {RESOURCES.map((resource) => (
                  <SelectableResourceCard
                    key={resource}
                    resource={resource}
                    action="Claim"
                    caption=""
                    selected={chosenResource === resource}
                    disabled={disabled}
                    onClick={() => setChosenResource(resource)}
                  />
                ))}
              </div>
            </fieldset>
          )}
          {blockedReason && !error && (
            <p id="development-blocked-reason" className="mt-4 rounded-lg border border-line bg-moss/60 px-3 py-2 text-xs font-medium text-ink">
              {blockedReason}
            </p>
          )}
          <button
            className="button-primary mt-4 w-full"
            aria-describedby={blockedReason && !error ? "development-blocked-reason" : undefined}
            disabled={confirmDisabled}
            onClick={() => onSubmit({
              type: "play-development",
              cardId: developmentCard.id,
              resource: chosenResource,
              resources: chosenResources,
            })}
          >
            {translateText("Confirm {development}", { development: developmentNames[developmentCard.kind] })}
          </button>
          <p className="mt-3 text-xs leading-6 text-muted">
            {translateText("One action card per turn, before or after rolling. Newly bought action cards must wait until a later turn.")}
          </p>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-4 text-sm text-clay">
          {error}
        </p>
      )}
    </Dialog>
  );
}

export function PlayerBadge({ player }: { player: { name: string; color: string } }) {
  return (
    <span className="eyebrow flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: player.color }} />
      {player.name}
    </span>
  );
}

export function ActionConfirmation({
  title,
  player,
  description,
  cost,
  exchange,
  resources,
  confirmLabel,
  disabled = false,
  error,
  onClose,
  onConfirm,
}: {
  title: string;
  player?: { name: string; color: string };
  description?: string;
  cost?: Resources;
  exchange?: { give: Resources; receive: Resources };
  resources?: Resources;
  confirmLabel?: string;
  disabled?: boolean;
  error?: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const translateText = useTranslation(gameplayTranslations);
  return (
    <Dialog title={title} eyebrow={player ? <PlayerBadge player={player} /> : undefined} summary={resources ? <ResourceInventory resources={resources} /> : undefined} onClose={onClose}>
      {exchange ? <div className="flex items-center justify-center gap-4 rounded-xl bg-moss p-4">
        <CardStack label={translateText("You give")} resources={exchange.give} />
        <Arrow className="h-5 w-5 shrink-0 text-forest" />
        <CardStack label={translateText("You receive")} resources={exchange.receive} />
      </div> : cost ? <div className="flex items-center justify-center rounded-xl bg-moss p-4">
        <CardStack label={translateText("Cost")} resources={cost} />
      </div> : <p className="text-sm leading-7 text-muted">
        {description}
      </p>}
      {error && <p role="alert" className="mt-3 text-sm text-clay">{error}</p>}
      <div className="mt-6 flex justify-end gap-3">
        <button className="button-secondary" onClick={onClose}>
          {translateText("Cancel")}
        </button>
        <button className="button-primary" disabled={disabled} onClick={onConfirm}>
          {confirmLabel ?? translateText("Confirm")}
        </button>
      </div>
    </Dialog>
  );
}

export function DiscardSelection({
  resources,
  required,
  chosenResources,
  onChangeResources,
  disabled = false,
  onConfirm,
}: {
  resources: Resources;
  required: number;
  chosenResources: Resources;
  onChangeResources: (resources: Resources) => void;
  disabled?: boolean;
  onConfirm: () => void;
}) {
  const translateText = useTranslation(gameplayTranslations);
  return (
    <>
      <fieldset disabled={disabled}>
        <ResourceCardStepper
          label={translateText("Return to the bank")}
          values={chosenResources}
          maximum={resources}
          onChange={onChangeResources}
        />
      </fieldset>
      <p className="selection-progress mt-3 flex justify-between gap-2 text-xs text-muted" aria-live="polite">
        <strong className="text-ink">{translateText("Selected {selected} of {required}", { selected: resourceTotal(chosenResources), required })}</strong>
        <span>{translateText("{count} cards left", { count: resourceTotal(resources) - resourceTotal(chosenResources) })}</span>
      </p>
      <button
        className="button-primary mt-3 w-full"
        disabled={disabled || resourceTotal(chosenResources) !== required ||
          RESOURCES.some(resource => chosenResources[resource] > resources[resource])}
        onClick={onConfirm}
      >
        {translateText("Confirm discard")}
      </button>
    </>
  );
}

export function TheftChoices({
  players,
  disabled = false,
  onSelect,
}: {
  players: { id: string; name: string; color: string; number: number; resourceCount: number }[];
  disabled?: boolean;
  onSelect: (playerId: string) => void;
}) {
  const translateText = useTranslation(gameplayTranslations);
  return players.map(player => (
    <button
      key={player.id}
      className="button-secondary w-full justify-between"
      disabled={disabled}
      onClick={() => onSelect(player.id)}
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className="player-number flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white" style={{ background: player.color }}>{player.number}</span>
        <span className="truncate">{player.name}</span>
      </span>
      <span className="text-xs text-muted">{translateText("{count} resources", { count: player.resourceCount })}</span>
    </button>
  ));
}
