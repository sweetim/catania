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

export function ResourcePicker({
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
      <div className="space-y-2">
        {(Object.keys(RESOURCE_NAMES) as Resource[]).map((resource) => (
          <div
            className="flex items-center gap-3 rounded-xl border border-line bg-white/50 px-3 py-2"
            key={resource}
          >
            <span style={{ color: RESOURCE_COLORS[resource] }}>
              <ResourceIcon resource={resource} className="h-5 w-5" />
            </span>
            <label htmlFor={`${label}-${resource}`} className="flex-1 text-sm">
              {RESOURCE_NAMES[resource]}
            </label>
            <button
              className="h-9 w-9 rounded-lg bg-moss text-lg"
              aria-label={`Remove ${RESOURCE_NAMES[resource]} from ${label}`}
              disabled={!values[resource]}
              onClick={() =>
                onChange({ ...values, [resource]: values[resource] - 1 })
              }
            >
              -
            </button>
            <input
              id={`${label}-${resource}`}
              aria-label={`${label} ${RESOURCE_NAMES[resource]}`}
              type="number"
              min={0}
              max={maximum?.[resource] ?? 19}
              value={values[resource]}
              onChange={(event) =>
                onChange({
                  ...values,
                  [resource]: Math.max(
                    0,
                    Math.min(
                      maximum?.[resource] ?? 19,
                      Math.floor(Number(event.target.value) || 0),
                    ),
                  ),
                })
              }
              className="w-10 bg-transparent text-center text-sm tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
            />
            <button
              className="h-9 w-9 rounded-lg bg-moss text-lg"
              aria-label={`Add ${RESOURCE_NAMES[resource]} to ${label}`}
              disabled={values[resource] >= (maximum?.[resource] ?? 19)}
              onClick={() =>
                onChange({ ...values, [resource]: values[resource] + 1 })
              }
            >
              +
            </button>
          </div>
        ))}
      </div>
    </fieldset>
  );
}

export function Cost({ resources }: { resources: Resources }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {(Object.keys(RESOURCE_NAMES) as Resource[])
        .filter((resource) => resources[resource] > 0)
        .map((resource) => (
          <span
            key={resource}
            className="inline-flex items-center gap-0.5 text-xs"
            style={{ color: RESOURCE_COLORS[resource] }}
            title={`${resources[resource]} ${RESOURCE_NAMES[resource]}`}
          >
            <ResourceIcon resource={resource} className="h-3.5 w-3.5" />
            <span>{resources[resource]}</span>
            <span className="sr-only">{RESOURCE_NAMES[resource]}</span>
          </span>
        ))}
    </span>
  );
}
