import { useLayoutEffect, useRef, type ReactNode } from "react";
import { match } from "ts-pattern";
import type { Resource, Resources } from "../game/types";

export const RESOURCE_NAMES: Record<Resource, string> = {
  wood: "Wood",
  brick: "Brick",
  wool: "Wool",
  grain: "Grain",
  ore: "Ore",
};

export const RESOURCE_COLORS: Record<Resource, string> = {
  wood: "#426c4f",
  brick: "#b96d51",
  wool: "#8a9c64",
  grain: "#c6a14b",
  ore: "#788789",
};

export function ResourceIcon({
  resource,
  className = "h-6 w-6",
}: {
  resource: Resource;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={className}
      aria-hidden="true"
      fill="none"
    >
      {resource === "wood" && (
        <>
          <path d="M16 3 6 17h5l-6 8h22l-6-8h5L16 3Z" fill="currentColor" />
          <path d="M16 24v6" stroke="currentColor" strokeWidth="3" />
        </>
      )}
      {resource === "brick" && (
        <>
          <path d="m3 16 17-8 10 6-17 9-10-7Z" fill="currentColor" />
          <path
            d="M3 19v5l10 6 17-9v-5l-17 9-10-6Z"
            fill="currentColor"
            opacity=".7"
          />
        </>
      )}
      {resource === "wool" && (
        <>
          <path
            d="M8 24a6 6 0 0 1-2-11 6 6 0 0 1 10-6 7 7 0 0 1 11 8 5 5 0 0 1-1 9H8Z"
            fill="currentColor"
          />
          <path d="M10 24v5m12-5v5" stroke="currentColor" strokeWidth="3" />
          <path d="M25 17h4v6h-4z" fill="currentColor" />
        </>
      )}
      {resource === "grain" && (
        <>
          <path d="M16 5v25" stroke="currentColor" strokeWidth="2" />
          {[7, 13, 19].map((position) => (
            <g key={position}>
              <path
                d={`M16 ${position + 7}Q4 ${position + 5} 6 ${position - 1}Q15 ${position} 16 ${position + 7}`}
                fill="currentColor"
              />
              <path
                d={`M16 ${position + 7}Q28 ${position + 5} 26 ${position - 1}Q17 ${position} 16 ${position + 7}`}
                fill="currentColor"
              />
            </g>
          ))}
        </>
      )}
      {resource === "ore" && (
        <>
          <path d="m3 24 8-17 10-3 9 20-14 5L3 24Z" fill="currentColor" />
          <path
            d="m11 7 5 22 5-25"
            stroke="white"
            strokeOpacity=".45"
            strokeWidth="1.5"
          />
        </>
      )}
    </svg>
  );
}

export function Logo() {
  return (
    <span className="flex items-center gap-2.5">
      <svg aria-hidden="true" viewBox="0 0 40 44" className="h-9 w-9">
        <path d="m20 1 18 10v22L20 43 2 33V11Z" fill="#315e49" />
        <path d="m9 28 8-15 5 9 4-6 6 12H9Z" fill="#f1e4bc" />
        <path d="m13 28 4-8 5 8" fill="#a4b788" />
      </svg>
      <span className="font-serif text-3xl tracking-[-.06em]">
        catania<span className="text-clay">.</span>
      </span>
    </span>
  );
}

export function Arrow({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <path d="M4 12h15m-6-6 6 6-6 6" />
    </svg>
  );
}

export function PieceIcon({ piece }: { piece: "road" | "settlement" | "city" }) {
  return (
    <svg className="piece-icon h-8 w-8 shrink-0" data-piece={piece} viewBox="0 0 32 32" aria-hidden="true" fill="none">
      {match(piece)
        .with("road", () => (
          <>
            <path d="m3 20 20-12 6 3L9 23Z" fill="currentColor" />
            <path d="M3 20v5l6 3v-5m0 0 20-12v5L9 28" fill="currentColor" opacity=".65" />
            <path d="m6 21 20-12" stroke="white" strokeOpacity=".4" />
          </>
        ))
        .with("settlement", () => (
          <>
            <path d="M5 15 15 6l10 9v13H5Z" fill="currentColor" />
            <path d="m15 6 5-3 10 9v13l-5 3V15Z" fill="currentColor" opacity=".65" />
            <path d="m7 16 8-7 8 7" stroke="white" strokeOpacity=".45" />
            <path d="M13 20h5v8h-5Z" fill="black" opacity=".2" />
          </>
        ))
        .with("city", () => (
          <>
            <path d="M3 16 10 9l7 7v-6l5-5 7 5v18H3Z" fill="currentColor" />
            <path d="m22 5 4-3 5 5v18l-2 3V10Z" fill="currentColor" opacity=".65" />
            <path d="m5 17 5-5 5 5m4-6 3-3 5 3" stroke="white" strokeOpacity=".45" />
            <path d="M8 21h5v7H8Zm13-6h4v4h-4Z" fill="black" opacity=".2" />
          </>
        ))
        .exhaustive()}
    </svg>
  );
}

export function Dialog({
  title,
  children,
  onClose,
  wide = false,
  summary,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  summary?: ReactNode;
}) {
  const reference = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = reference.current!;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    return () => {
      // Close before removal so keyboard focus can return to the opener.
      dialog.close();
      if (trigger?.isConnected) trigger.focus();
    };
  }, []);
  return (
    <dialog
      ref={reference}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className={`m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] rounded-2xl border border-line bg-paper p-0 text-ink shadow-2xl backdrop:bg-ink/45 backdrop:backdrop-blur-sm ${wide ? "max-w-2xl" : "max-w-lg"}`}
      aria-label={title}
    >
      <div className="sticky top-0 z-10 border-b border-line bg-paper">
        <div className="flex items-center justify-between gap-4 px-6 py-4">
          <h2 className="font-serif text-2xl">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close dialog"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-line hover:bg-moss"
          >
            <span aria-hidden="true">&times;</span>
          </button>
        </div>
        {summary && <div className="px-6 pb-4">{summary}</div>}
      </div>
      <div className="p-6">{children}</div>
    </dialog>
  );
}

export function ResourceCard({
  resource,
  count,
  compact = false,
  selected = false,
  iconClassName = "h-7 w-7",
  className = "",
}: {
  resource: Resource;
  count?: number;
  compact?: boolean;
  selected?: boolean;
  iconClassName?: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`relative inline-flex flex-col items-center justify-center rounded-xl p-[3px] shadow-sm ${selected ? "ring-2 ring-forest ring-offset-2" : ""} ${className}`}
      style={{ background: RESOURCE_COLORS[resource] }}
    >
      <span className="flex h-full w-full flex-col items-center justify-center gap-1 rounded-lg border border-white/50 px-0.5">
        <ResourceIcon
          resource={resource}
          className={`${iconClassName} text-white`}
        />
        {!compact && (
          <span className="w-full truncate text-center text-[7px] font-bold uppercase tracking-[.12em] text-white">
            {RESOURCE_NAMES[resource]}
          </span>
        )}
      </span>
      {count !== undefined ? (
        <strong className="resource-count absolute -right-1 -top-1.5 flex h-7 min-w-7 items-center justify-center rounded-full border-2 border-paper bg-ink px-1 text-base font-bold leading-none text-white shadow tabular-nums">
          {count}
        </strong>
      ) : null}
    </span>
  );
}

export function ResourceInventory({ resources }: { resources: Resources }) {
  return (
    <section className="resource-inventory" aria-label="Your current resources">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold">Currently in your hand</h3>
        <strong className="shrink-0 text-sm text-forest tabular-nums">
          {Object.values(resources).reduce((total, count) => total + count, 0)} cards
        </strong>
      </div>
      <ul aria-label="Cards in hand" className="grid grid-cols-5 gap-2">
        {(Object.keys(RESOURCE_NAMES) as Resource[]).map(resource => (
          <li key={resource} aria-label={`${RESOURCE_NAMES[resource]}: ${resources[resource]} in hand`} className="flex min-w-0 flex-col items-center gap-1">
            <ResourceCard resource={resource} count={resources[resource]} compact iconClassName="h-5 w-5" className="h-11 w-9" />
            <span className="text-[10px] font-semibold">{RESOURCE_NAMES[resource]}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function SelectableResourceCard({
  resource,
  action,
  count,
  caption,
  countLabel,
  selected,
  disabled,
  onClick,
}: {
  resource: Resource;
  action: string;
  count?: number;
  caption: string;
  countLabel?: string;
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={`${action} ${RESOURCE_NAMES[resource]}`}
      aria-description={countLabel && count !== undefined ? `${countLabel}: ${count}. ${caption}` : caption}
      disabled={disabled}
      onClick={onClick}
      className="group flex flex-col items-center gap-1.5"
    >
      <ResourceCard
        resource={resource}
        count={count}
        selected={selected}
        className="aspect-[3/4] w-full transition-transform group-enabled:group-hover:-translate-y-1"
      />
      {countLabel && <span className="text-center text-[10px] leading-3">{countLabel}: <strong>{count}</strong></span>}
      <span className="text-[10px] font-semibold text-muted">{caption}</span>
    </button>
  );
}

export function ResourceCardStepper({
  label,
  values,
  maximum,
  maximumLabel = "In hand",
  onChange,
}: {
  label: string;
  values: Resources;
  maximum?: Resources;
  maximumLabel?: "In hand" | "In bank";
  onChange: (values: Resources) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-3 text-sm font-semibold">{label}</legend>
      <div className="grid grid-cols-5 gap-1.5 sm:gap-2">
        {(Object.keys(RESOURCE_NAMES) as Resource[]).map((resource) => (
          <div key={resource} role="group" aria-label={`${RESOURCE_NAMES[resource]} selection`} className="flex min-w-0 flex-col items-center gap-1.5">
            <ResourceCard
              resource={resource}
              selected={values[resource] > 0}
              className="aspect-[3/4] w-full"
            />
            <div className="resource-selection-counts text-center text-[10px] leading-4 tabular-nums">
              {maximum && <p>{maximumLabel} <strong>{maximum[resource]}</strong></p>}
              <p className="font-semibold text-forest">Selected <strong>{values[resource]}</strong></p>
              {maximum && <p>Remaining <strong>{maximum[resource] - values[resource]}</strong></p>}
            </div>
            <div className="flex w-full gap-1">
              <button
                type="button"
                className="flex h-11 min-w-0 flex-1 items-center justify-center rounded-lg bg-moss pb-0.5 text-base font-bold text-forest"
                aria-label={`Remove ${RESOURCE_NAMES[resource]} from ${label}`}
                disabled={!values[resource]}
                onClick={() =>
                  onChange({ ...values, [resource]: values[resource] - 1 })
                }
              >
                &minus;
              </button>
              <button
                type="button"
                className="flex h-11 min-w-0 flex-1 items-center justify-center rounded-lg bg-moss pb-0.5 text-base font-bold text-forest"
                aria-label={`Add ${RESOURCE_NAMES[resource]} to ${label}`}
                disabled={values[resource] >= (maximum?.[resource] ?? 19)}
                onClick={() =>
                  onChange({ ...values, [resource]: values[resource] + 1 })
                }
              >
                +
              </button>
            </div>
          </div>
        ))}
      </div>
    </fieldset>
  );
}

export function CardStack({
  resources,
  emptyText = "No cards",
}: {
  resources: Resources;
  emptyText?: string;
}) {
  const entries = (Object.keys(RESOURCE_NAMES) as Resource[]).filter(
    (resource) => resources[resource] > 0,
  );
  if (!entries.length) {
    return (
      <span className="text-[10px] font-semibold uppercase tracking-[.15em] text-muted">
        {emptyText}
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center justify-center gap-1.5">
      {entries.map((resource) => (
        <ResourceCard
          key={resource}
          resource={resource}
          count={resources[resource]}
          compact
          iconClassName="h-5 w-5"
          className="h-13 w-9"
        />
      ))}
    </span>
  );
}

export function Cost({ resources }: { resources: Resources }) {
  return (
    <span className="inline-flex items-center gap-1">
      {(Object.keys(RESOURCE_NAMES) as Resource[])
        .filter((resource) => resources[resource] > 0)
        .map((resource) => (
          <span
            key={resource}
            className="relative inline-flex h-9 w-7 items-center justify-center rounded-md shadow-sm"
            style={{ background: RESOURCE_COLORS[resource] }}
            title={`${resources[resource]} ${RESOURCE_NAMES[resource]}`}
          >
            <ResourceIcon resource={resource} className="h-4 w-4 text-white" />
            {resources[resource] > 1 && (
              <span className="absolute bottom-0 right-0 rounded-tl-md bg-black/40 px-1 text-[9px] font-bold leading-4 text-white">
                {resources[resource]}
              </span>
            )}
            <span className="sr-only">
              {resources[resource]} {RESOURCE_NAMES[resource]}
            </span>
          </span>
        ))}
    </span>
  );
}
