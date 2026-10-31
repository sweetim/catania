import { RESOURCES, resourceTotal } from "../game/engine";
import type { Resources } from "../game/types";
import { ResourceCard, RESOURCE_NAMES } from "./GameUi";

export type ResourceReceipt = {
  id: number;
  playerId: string;
  gains: Resources;
};

export function ResourceCollection({ receipt, onDismiss }: {
  receipt: ResourceReceipt | null;
  onDismiss: () => void;
}) {
  const resources = receipt ? RESOURCES.filter(resource => receipt.gains[resource] > 0) : [];
  const total = receipt ? resourceTotal(receipt.gains) : 0;
  const description = receipt
    ? `You received ${resources.map(resource => `+${receipt.gains[resource]} ${RESOURCE_NAMES[resource]}`).join(", ")}.`
    : "";

  return (
    <>
      <p role="status" aria-label="Resource receipt" aria-atomic="true" className="sr-only">
        <span key={receipt?.id ?? "empty"}>{description}</span>
      </p>
      {receipt && (
        <section
          key={receipt.id}
          aria-label="Resource collection"
          className="resource-collection rounded-2xl border border-forest/30 bg-paper p-4 shadow-xl"
        >
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-forest">Added to your hand</h2>
              <p className="mt-0.5 text-xs text-muted">+{total} resource card{total === 1 ? "" : "s"}</p>
            </div>
            <button
              type="button"
              onClick={onDismiss}
              aria-label="Dismiss resource collection"
              className="pointer-events-auto -mr-2 -mt-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xl text-muted hover:bg-moss"
            >
              &times;
            </button>
          </div>
          <ul aria-label="Collected resources" className="flex justify-center gap-3 pb-1 pt-2">
            {resources.map((resource, index) => (
              <li
                key={resource}
                aria-label={`${RESOURCE_NAMES[resource]} +${receipt.gains[resource]}`}
                className="resource-collection-card relative"
                style={{ animationDelay: `${index * 90}ms` }}
              >
                <ResourceCard resource={resource} compact className="h-16 w-10 sm:h-20 sm:w-14" />
                <span aria-hidden="true" className="mt-1 block text-center text-[10px] font-semibold text-forest">{RESOURCE_NAMES[resource]}</span>
                <span aria-hidden="true" className="absolute -right-1.5 -top-2 rounded-full border-2 border-paper bg-forest px-1.5 py-0.5 text-xs font-bold text-white">
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
