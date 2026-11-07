import { useState } from "react";
import { emptyResources, RESOURCES, resourceTotal } from "../game/engine";
import { isSeafarers, type DevelopmentKind, type GameAction, type GamePhase, type GameVariant, type Player, type Resource, type Resources } from "../game/types";
import { resourceName, translate, type Language } from "../i18n";
import { useLanguage, useTranslation } from "../localization";
import { gameplayTranslations } from "../translations/gameplay";
import { Arrow, CardStack, DevelopmentCardIcon, Dialog, ResourceCardStepper, ResourceInventory } from "./GameUi";

export const DEVELOPMENT_NAMES = {
  knight: "Knight",
  "victory-point": "Victory point",
  "road-building": "Road building",
  "year-of-plenty": "Year of plenty",
  monopoly: "Monopoly",
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
} as const satisfies Record<DevelopmentKind, string>;

export function getDevelopmentNames(language: Language): Record<DevelopmentKind, string> {
  return Object.fromEntries(Object.entries(DEVELOPMENT_NAMES).map(([kind, name]) =>
    [kind, translate(language, gameplayTranslations, name)],
  )) as Record<DevelopmentKind, string>;
}

export function getDevelopmentDescriptions(language: Language, variant: GameVariant = "original"): Record<DevelopmentKind, string> {
  const descriptions = Object.fromEntries(Object.entries(DEVELOPMENT_DESCRIPTIONS).map(([kind, description]) =>
    [kind, translate(language, gameplayTranslations, description)],
  )) as Record<DevelopmentKind, string>;
  if (isSeafarers(variant)) {
    descriptions.knight = translate(language, gameplayTranslations, "Move the robber or pirate and steal one random resource from an adjacent opponent. Played Knights count toward Largest Army.");
    descriptions["victory-point"] = translate(language, gameplayTranslations, "One hidden victory point. Counts automatically toward victory on your turn, including when purchased.");
    descriptions["road-building"] = translate(language, gameplayTranslations, "Place two roads or ships for free, following the usual connection and piece-limit rules.");
  }
  return descriptions;
}

export function DevelopmentDialog({
  variant = "original",
  player,
  bank,
  turnNumber,
  phaseType,
  developmentPlayed,
  active,
  disabled = false,
  initialCardId = null,
  error,
  onClose,
  onSubmit,
  onClearError,
}: {
  variant?: GameVariant;
  player: Player;
  bank: Resources;
  turnNumber: number;
  phaseType: GamePhase["type"];
  developmentPlayed: boolean;
  active: boolean;
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
  const developmentDescriptions = getDevelopmentDescriptions(language, variant);
  const [developmentCardId, setDevelopmentCardId] = useState(initialCardId);
  const [chosenResources, setChosenResources] = useState(emptyResources);
  const [chosenResource, setChosenResource] = useState<Resource>("wood");
  const developmentCard = player.developmentCards.find(card => card.id === developmentCardId);

  return (
    <Dialog
      title={translateText("A card up your sleeve")}
      summary={developmentCard?.kind === "year-of-plenty" || developmentCard?.kind === "monopoly" ? <ResourceInventory resources={player.resources} /> : undefined}
      onClose={onClose}
    >
      <div className="space-y-3">
        {player.developmentCards.map((card) => (
          <button
            key={card.id}
            className={`w-full rounded-xl border p-4 text-left ${developmentCardId === card.id ? "border-forest bg-moss" : "border-line"}`}
            aria-pressed={developmentCardId === card.id}
            onClick={() => {
              setDevelopmentCardId(card.id);
              setChosenResources(emptyResources());
              onClearError?.();
            }}
          >
            <span className="flex justify-between gap-3">
              <span className="flex items-center gap-2 font-serif text-xl">
                <span className="text-forest"><DevelopmentCardIcon kind={card.kind} /></span>
                {developmentNames[card.kind]}
              </span>
              {card.kind === "victory-point" && (
                <span className="text-[10px] text-muted">{translateText("+1 hidden point")}</span>
              )}
            </span>
            <span className="mt-2 block text-xs leading-6 text-muted">
              {developmentDescriptions[card.kind]}
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
                {translateText("Selected {selected} of {required}", { selected: resourceTotal(chosenResources), required: Math.min(2, resourceTotal(bank)) })}
              </p>
            </>
          )}
          {developmentCard.kind === "monopoly" && (
            <label className="text-sm">
              {translateText("Claim every card of this resource")}
              <select
                className="field mt-2"
                value={chosenResource}
                disabled={disabled}
                onChange={(event) => setChosenResource(event.target.value as Resource)}
              >
                {RESOURCES.map((resource) => (
                  <option value={resource} key={resource}>
                    {resourceName(language, resource)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            className="button-primary mt-4 w-full"
            disabled={!active || disabled || !["roll", "actions"].includes(phaseType) ||
              developmentPlayed || developmentCard.purchasedTurn >= turnNumber ||
              (developmentCard.kind === "year-of-plenty" && (
                resourceTotal(bank) === 0 ||
                resourceTotal(chosenResources) !== Math.min(2, resourceTotal(bank)) ||
                RESOURCES.some(resource => chosenResources[resource] > bank[resource])
              ))}
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
  exchange,
  resources,
  disabled = false,
  error,
  onClose,
  onConfirm,
}: {
  title: string;
  player?: { name: string; color: string };
  description?: string;
  exchange?: { give: Resources; receive: Resources };
  resources?: Resources;
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
      </div> : <p className="text-sm leading-7 text-muted">
        {description}
      </p>}
      {error && <p role="alert" className="mt-3 text-sm text-clay">{error}</p>}
      <div className="mt-6 flex justify-end gap-3">
        <button className="button-secondary" onClick={onClose}>
          {translateText("Cancel")}
        </button>
        <button className="button-primary" disabled={disabled} onClick={onConfirm}>
          {translateText("Confirm")}
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
