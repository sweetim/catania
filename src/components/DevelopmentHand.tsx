import type { Player } from "../game/types";
import { useLanguage, useTranslation } from "../localization";
import { gameplayTranslations } from "../translations/gameplay";
import { Arrow, DevelopmentCardIcon } from "./GameUi";
import { getDevelopmentDescriptions, getDevelopmentNames } from "./GameplayDialogs";

export function DevelopmentHand({
  cards,
  turnNumber,
  inert,
  onSelect,
}: {
  cards: Player["developmentCards"];
  turnNumber: number;
  inert?: boolean;
  onSelect: (cardId: string) => void;
}) {
  const { language } = useLanguage();
  const translateText = useTranslation(gameplayTranslations);
  const developmentNames = getDevelopmentNames(language);
  const developmentDescriptions = getDevelopmentDescriptions(language);
  if (cards.length === 0) return null;

  return (
    <section
      inert={inert}
      className="development-hand"
      aria-label={translateText("Your development cards")}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-xs font-medium">{translateText("Your development cards")}</h2>
        <span className="rounded-md bg-moss px-2 py-1 text-xs">
          {cards.length}
        </span>
      </div>
      <ul className="flex flex-col gap-2">
        {[...new Set(cards.map(card => card.kind))].map(kind => {
          const groupedCards = cards.filter(card => card.kind === kind);
          const card = groupedCards.find(card => card.purchasedTurn < turnNumber) ?? groupedCards[0]!;
          return (
            <li key={kind}>
              <button
                className="flex min-h-16 w-full items-center gap-3 rounded-xl border border-line bg-white/40 px-3 py-2 text-left hover:bg-moss/60"
                aria-haspopup="dialog"
                onClick={() => onSelect(card.id)}
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-moss text-forest">
                  <DevelopmentCardIcon kind={kind} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold">{developmentNames[kind]}</span>
                    <span className="shrink-0 rounded-md bg-moss px-2 py-1 text-xs tabular-nums">
                      <span aria-hidden="true">{groupedCards.length}</span><span className="sr-only">{translateText(groupedCards.length === 1 ? "{count} card" : "{count} cards", { count: groupedCards.length })}</span>
                    </span>
                  </span>
                  <span className="mt-1 line-clamp-2 text-xs leading-5 text-muted">
                    {developmentDescriptions[kind]}
                  </span>
                </span>
                <Arrow className="h-4 w-4 shrink-0 text-muted" />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
