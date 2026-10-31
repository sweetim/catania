import { RESOURCES, resourceTotal } from "../game/engine";
import type { Resources } from "../game/types";
import { resourceName } from "../i18n";
import { useLanguage, useTranslation } from "../localization";
import { gameplayTranslations } from "../translations/gameplay";
import { ResourceCard } from "./GameUi";

export type ResourceReceipt = {
  id: number;
  playerId: string;
  gains: Resources;
};

export function ResourceCollection({ receipt, onDismiss }: {
  receipt: ResourceReceipt | null;
  onDismiss: () => void;
}) {
  const { language } = useLanguage();
  const translateText = useTranslation(gameplayTranslations);
  const resources = receipt ? RESOURCES.filter(resource => receipt.gains[resource] > 0) : [];
  const total = receipt ? resourceTotal(receipt.gains) : 0;
  const description = receipt
    ? translateText("You received {resources}.", { resources: resources.map(resource => translateText("+{count} {resource}", { count: receipt.gains[resource], resource: resourceName(language, resource) })).join(language === "ja" ? "、" : ", ") })
    : "";

  return (
    <>
      <p role="status" aria-label={translateText("Resource receipt")} aria-atomic="true" className="sr-only">
        <span key={receipt?.id ?? "empty"}>{description}</span>
      </p>
      {receipt && (
        <section
          key={receipt.id}
          aria-label={translateText("Resource collection")}
          className="resource-collection rounded-2xl border border-[#c2ad7c] bg-paper p-4 shadow-xl"
        >
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h2 className="font-serif text-xl text-ink">{translateText("Added to your hand")}</h2>
              <p className="mt-0.5 text-xs text-muted">{translateText(total === 1 ? "+{count} resource card" : "+{count} resource cards", { count: total })}</p>
            </div>
            <button
              type="button"
              onClick={onDismiss}
              aria-label={translateText("Dismiss resource collection")}
              className="pointer-events-auto -mr-2 -mt-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xl text-muted hover:bg-moss"
            >
              &times;
            </button>
          </div>
          <ul aria-label={translateText("Collected resources")} className="flex justify-center gap-2 pb-1 pt-2">
            {resources.map((resource, index) => (
              <li
                key={resource}
                aria-label={translateText("{resource} +{count}", { resource: resourceName(language, resource), count: receipt.gains[resource] })}
                className="resource-collection-card relative"
                style={{ animationDelay: `${index * 90}ms` }}
              >
                <ResourceCard resource={resource} compact className="h-18 w-10 sm:h-20 sm:w-12" />
                <span aria-hidden="true" className="mt-1 block text-center text-[10px] font-semibold text-ink">{resourceName(language, resource)}</span>
                <span aria-hidden="true" className="absolute -right-1.5 -top-2 rounded-full border-2 border-paper bg-forest px-1.5 py-0.5 text-xs font-bold text-ink">
                  +{receipt.gains[resource]}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
