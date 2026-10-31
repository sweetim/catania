import { useLayoutEffect, useRef, type ReactNode } from "react";
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

export function Dialog({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
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
      <div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-line bg-paper px-6 py-4">
        <h2 className="font-serif text-2xl">{title}</h2>
        <button
          onClick={onClose}
          aria-label="Close dialog"
          className="flex h-11 w-11 items-center justify-center rounded-full border border-line hover:bg-moss"
        >
          <span aria-hidden="true">&times;</span>
        </button>
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
        <strong className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-ink px-1 text-[10px] font-bold leading-none text-white shadow">
          {count}
        </strong>
      ) : null}
    </span>
  );
}

export function SelectableResourceCard({
  resource,
  action,
  count,
  caption,
  selected,
  disabled,
  onClick,
}: {
  resource: Resource;
  action: string;
  count?: number;
  caption: string;
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={`${action} ${RESOURCE_NAMES[resource]}`}
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
      <span className="text-[10px] font-semibold text-muted">{caption}</span>
    </button>
  );
}

export function ResourceCardStepper({
  label,
  values,
  maximum,
  onChange,
}: {
  label: string;
  values: Resources;
  maximum?: Resources;
  onChange: (values: Resources) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-3 text-sm font-semibold">{label}</legend>
      <div className="grid grid-cols-5 gap-1.5 sm:gap-2">
        {(Object.keys(RESOURCE_NAMES) as Resource[]).map((resource) => (
          <div key={resource} className="flex flex-col items-center gap-1.5">
            <ResourceCard
              resource={resource}
              count={values[resource]}
              className="aspect-[3/4] w-full"
            />
            <div className="flex w-full gap-1">
              <button
                type="button"
                className="flex h-7 flex-1 items-center justify-center rounded-lg bg-moss pb-0.5 text-base font-bold text-forest"
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
                className="flex h-7 flex-1 items-center justify-center rounded-lg bg-moss pb-0.5 text-base font-bold text-forest"
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
