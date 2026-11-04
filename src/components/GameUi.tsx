import { useLayoutEffect, useRef, type ComponentProps, type ReactNode } from "react";
import { match } from "ts-pattern";
import type { DevelopmentKind, Resource, Resources } from "../game/types";
import { resourceName } from "../i18n";
import { useLanguage, useTranslation } from "../localization";
import { gameplayTranslations } from "../translations/gameplay";
import { useBoardTheme } from "../themes";
import { ResourceArtwork } from "./ThemeArtwork";

export const RESOURCE_NAMES: Record<Resource, string> = {
  wood: "Wood",
  brick: "Brick",
  wool: "Wool",
  grain: "Grain",
  ore: "Ore",
};

export function ResourceIcon({
  resource,
  className = "h-6 w-6",
}: {
  resource: Resource;
  className?: string;
}) {
  const theme = useBoardTheme();
  return (
    <svg
      data-theme={theme.id}
      viewBox="0 0 32 32"
      className={className}
      aria-hidden="true"
      fill="none"
    >
      {theme.id !== "illustrated" ? <ResourceArtwork resource={resource} theme={theme} /> : <>
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
      </>}
    </svg>
  );
}

export function Logo() {
  return (
    <span className="flex items-center gap-2.5">
      <svg aria-hidden="true" viewBox="0 0 40 44" className="h-9 w-9">
        <path d="m20 1 18 10v22L20 43 2 33V11Z" fill="var(--color-forest)" />
        <path d="m9 28 8-15 5 9 4-6 6 12H9Z" fill="var(--color-ink)" />
        <path d="m13 28 4-8 5 8" fill="var(--color-forest)" />
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

export function PieceIcon({ piece }: { piece: "road" | "ship" | "settlement" | "city" }) {
  return (
    <svg className="piece-icon h-8 w-8 shrink-0" data-piece={piece} viewBox="0 0 32 32" aria-hidden="true" fill="none">
      {match(piece)
        .with("ship", () => <><path d="M3 23h26l-5 7H8Z" fill="currentColor" /><path d="M15 3v20M17 5l11 15H17ZM12 9 4 20h8Z" stroke="currentColor" strokeWidth="2" fill="currentColor" fillOpacity=".5" /></>)
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

export function IslandIcon({ className = "h-6 w-5 shrink-0" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 28" className={className} aria-hidden="true" fill="none">
      <path d="M4.5 22.5c2.4-1.9 12.6-1.9 15 0-1.3 2.3-4.2 3.5-7.5 3.5s-6.2-1.2-7.5-3.5Z" fill="currentColor" />
      <path d="M12 22.5c.6-4.6.4-9-.6-13.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M11.5 9.5C9.8 6.7 6.3 6 3.6 7.5c1.2-3.1 5.5-3.7 7.4-1.1L11.5 9.5Z" fill="currentColor" />
      <path d="M12.5 9.5c1.7-2.8 5.2-3.5 7.9-2-1.2-3.1-5.5-3.7-7.4-1.1l-.5 3.1Z" fill="currentColor" />
      <path d="M11.8 9.2C10.8 6.4 11.4 3.6 13.5 1.5c.3 3-.1 5.5-1.4 7.4l-.3.3Z" fill="currentColor" />
    </svg>
  );
}

export function CardTypeIcon({ kind }: { kind: "resource" | "development" }) {
  return (
    <svg viewBox="0 0 24 28" className="h-6 w-5 shrink-0" aria-hidden="true" fill="none">
      <rect x="2" y="2" width="16" height="22" rx="3" fill="currentColor" opacity=".25" />
      <rect x="6" y="5" width="16" height="22" rx="3" fill="currentColor" />
      {kind === "resource"
        ? <path d="M14 9c-7 1-7 9-1 10m1-10c7 4 5 10-1 10m0 0v4m0-6 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
        : <path d="m14 10 1.7 3.5 3.8.5-2.7 2.7.7 3.8-3.5-1.8-3.5 1.8.7-3.8L8.5 14l3.8-.5Z" fill="white" />}
    </svg>
  );
}

export function DevelopmentCardIcon({ kind }: { kind: DevelopmentKind }) {
  return (
    <svg className="h-8 w-8 shrink-0" data-development-kind={kind} viewBox="0 0 32 32" aria-hidden="true" fill="none">
      {match(kind)
        .with("knight", () => (
          <>
            <path d="m16 3 11 4v9c0 6-6 10-11 13C11 26 5 22 5 16V7Z" fill="currentColor" />
            <path d="M16 8v15m-5-9h10m-8 7h6" stroke="white" strokeWidth="2" strokeLinecap="round" />
          </>
        ))
        .with("victory-point", () => (
          <>
            <path d="m16 3 4 8 9 1-6.5 6.5L24 28l-8-4.5L8 28l1.5-9.5L3 12l9-1Z" fill="currentColor" />
            <path d="m13 14 3-2v8m-3 0h6" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </>
        ))
        .with("road-building", () => (
          <>
            <path d="M10 3h12l-2 8 10 18H2l10-18Z" fill="currentColor" />
            <path d="M16 5v5m0 5v4m0 5v4" stroke="white" strokeWidth="2" strokeLinecap="round" />
          </>
        ))
        .with("year-of-plenty", () => (
          <>
            <path d="M5 19h22l-3 10H8Z" fill="currentColor" />
            <path d="M11 19V6m0 7C5 13 4 9 5 6c4 0 6 3 6 7m0-3c0-4 3-6 6-6 1 3-1 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
            <circle cx="22" cy="14" r="4" fill="currentColor" />
            <path d="M9 23h14" stroke="white" strokeWidth="2" strokeLinecap="round" />
          </>
        ))
        .with("monopoly", () => (
          <>
            <path d="M4 16v9c0 5 24 5 24 0v-9" fill="currentColor" opacity=".65" />
            <ellipse cx="16" cy="16" rx="12" ry="5" fill="currentColor" />
            <circle cx="16" cy="9" r="7" fill="currentColor" stroke="white" strokeWidth="1.5" />
            <path d="m16 5 3 4-3 4-3-4Z" fill="white" />
          </>
        ))
        .exhaustive()}
    </svg>
  );
}

export function BankSupply({ resources, developmentCards }: { resources: Resources; developmentCards: number }) {
  const theme = useBoardTheme();
  const { language } = useLanguage();
  const translateText = useTranslation(gameplayTranslations);
  return (
    <section className="bank-tray" aria-label={translateText("Resource bank")}>
      <h2 className="eyebrow">{translateText("Bank")}</h2>
      <ul className="bank-supply" aria-label={translateText("Bank resources")}>
        {(Object.keys(RESOURCE_NAMES) as Resource[]).map(resource => (
          <li key={resource} aria-label={translateText("{resource}: {count} in bank", { resource: resourceName(language, resource), count: resources[resource] })} title={translateText("{count} {resource} in bank", { count: resources[resource], resource: resourceName(language, resource) })}>
            <span aria-hidden="true" data-theme={theme.id} className="bank-card resource-card inline-flex h-10 w-8 rounded-xl p-[3px] shadow-sm" style={{ backgroundColor: theme.resources[resource] }}>
              <span className="flex h-full w-full flex-col items-center justify-center gap-px rounded-lg border border-white/50 text-white">
                <ResourceIcon resource={resource} className="h-4 w-4" />
                <strong className="w-full rounded-sm bg-paper/95 text-center text-xs font-bold leading-3 text-ink tabular-nums">{resources[resource]}</strong>
              </span>
            </span>
          </li>
        ))}
      </ul>
      <span className="bank-development" role="img" aria-label={translateText("{count} development cards in bank", { count: developmentCards })} title={translateText("{count} development cards in bank", { count: developmentCards })}>
        <CardTypeIcon kind="development" />
        <strong>{developmentCards}</strong>
      </span>
    </section>
  );
}

export function Dialog({
  title,
  eyebrow,
  children,
  onClose,
  wide = false,
  summary,
}: {
  title: string;
  eyebrow?: ReactNode;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  summary?: ReactNode;
}) {
  const translateText = useTranslation(gameplayTranslations);
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
          <div className="min-w-0">
            {eyebrow && <div className="mb-1">{eyebrow}</div>}
            <h2 className="font-serif text-2xl">{title}</h2>
          </div>
          <button
            onClick={onClose}
            aria-label={translateText("Close dialog")}
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
  const theme = useBoardTheme();
  const { language } = useLanguage();
  return (
    <span
      aria-hidden="true"
      data-theme={theme.id}
      className={`resource-card relative inline-flex flex-col items-center justify-center rounded-xl p-[3px] shadow-sm ${selected ? "ring-2 ring-forest ring-offset-2" : ""} ${className}`}
      style={{ backgroundColor: theme.resources[resource] }}
    >
      <span className="flex h-full w-full flex-col items-center justify-center gap-1 rounded-lg border border-white/50 px-0.5">
        <ResourceIcon
          resource={resource}
          className={`${iconClassName} text-white`}
        />
        {!compact && (
          <span className="w-full truncate text-center text-[7px] font-bold uppercase tracking-[.12em] text-white">
            {resourceName(language, resource)}
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
  const { language } = useLanguage();
  const translateText = useTranslation(gameplayTranslations);
  const totalResources = Object.values(resources).reduce((total, count) => total + count, 0);
  return (
    <section className="resource-inventory" aria-label={translateText("Your current resources")}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold">{translateText("Your hand")}</h3>
        <strong className={`shrink-0 rounded-md px-2 py-1 text-sm text-ink tabular-nums ${totalResources > 7 ? "card-count-at-risk bg-clay/30" : "bg-moss"}`}>
          {translateText("{count} cards", { count: totalResources })}
        </strong>
      </div>
      <ul aria-label={translateText("Cards in hand")} className="grid grid-cols-5 gap-2">
        {(Object.keys(RESOURCE_NAMES) as Resource[]).map(resource => (
          <li key={resource} aria-label={translateText("{resource}: {count} in hand", { resource: resourceName(language, resource), count: resources[resource] })} className="flex min-w-0 flex-col items-center gap-1">
            <ResourceCard resource={resource} count={resources[resource]} compact iconClassName="h-5 w-5" className="h-11 w-9" />
            <span className="text-[10px] font-semibold">{resourceName(language, resource)}</span>
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
  action: "Give" | "Receive";
  count?: number;
  caption: string;
  countLabel?: "In hand" | "In bank";
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const { language } = useLanguage();
  const translateText = useTranslation(gameplayTranslations);
  const name = resourceName(language, resource);
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={translateText(action === "Give" ? "Give {resource}" : "Receive {resource}", { resource: name })}
      aria-description={countLabel && count !== undefined ? translateText("{countLabel}: {count}. {caption}", { countLabel: translateText(countLabel), count, caption }) : caption}
      title={countLabel && count !== undefined ? translateText("{resource} / {countLabel}: {count}", { resource: name, countLabel: translateText(countLabel), count }) : name}
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
      {caption && <span className="text-[10px] font-semibold text-muted">{caption}</span>}
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
  const { language } = useLanguage();
  const translateText = useTranslation(gameplayTranslations);
  return (
    <fieldset>
      <legend className="mb-3 text-sm font-semibold">{label}</legend>
      <div className="grid grid-cols-5 gap-1 sm:gap-2">
        {(Object.keys(RESOURCE_NAMES) as Resource[]).map((resource) => (
          <div
            key={resource}
            role="group"
            aria-label={translateText("{resource} selection", { resource: resourceName(language, resource) })}
            aria-description={maximum
              ? translateText(maximumLabel === "In hand"
                ? "In hand {maximum}. Selected {selected}. Remaining {remaining}."
                : "In bank {maximum}. Selected {selected}. Remaining {remaining}.", {
                maximum: maximum[resource], selected: values[resource], remaining: maximum[resource] - values[resource],
              })
              : translateText("Selected {count}.", { count: values[resource] })}
            className="flex min-w-0 flex-col items-center gap-1.5"
          >
            <div className="relative w-full">
              <button
                type="button"
                className="resource-select-card relative block min-h-11 w-full rounded-xl"
                aria-label={translateText("Add {resource} to {label}", { resource: resourceName(language, resource), label })}
                disabled={values[resource] >= (maximum?.[resource] ?? 19)}
                onClick={() =>
                  onChange({ ...values, [resource]: values[resource] + 1 })
                }
              >
                <ResourceCard resource={resource} selected={values[resource] > 0} compact className="aspect-[3/4] w-full" />
                <span aria-hidden="true" className="absolute bottom-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-paper text-base font-bold leading-none text-forest">+</span>
              </button>
              <output aria-label={translateText("{resource} selected", { resource: resourceName(language, resource) })} className="selected-resource-count">{values[resource]}</output>
            </div>
            <button
              type="button"
              className="flex h-11 w-full items-center justify-center rounded-lg bg-moss text-lg font-bold text-ink"
              aria-label={translateText("Remove {resource} from {label}", { resource: resourceName(language, resource), label })}
              disabled={!values[resource]}
              onClick={() => onChange({ ...values, [resource]: values[resource] - 1 })}
            >
              &minus;
            </button>
          </div>
        ))}
      </div>
    </fieldset>
  );
}

export function CardStack({
  resources,
  emptyText,
  label,
  available,
}: {
  resources: Resources;
  emptyText?: string;
  label?: string;
  available?: Resources;
}) {
  const { language } = useLanguage();
  const translateText = useTranslation(gameplayTranslations);
  const entries = (Object.keys(RESOURCE_NAMES) as Resource[]).filter(
    (resource) => resources[resource] > 0,
  );
  if (!entries.length) {
    return (
      <span className="text-[10px] font-semibold uppercase tracking-[.15em] text-muted">
        {emptyText ?? translateText("No cards")}
      </span>
    );
  }
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label ? translateText("{label}: {resources}", { label, resources: entries.map(resource => translateText("{count} {resource}", { count: resources[resource], resource: resourceName(language, resource) })).join(language === "ja" ? "、" : ", ") }) : undefined}
      className="inline-flex min-w-0 flex-col items-center gap-2"
    >
      {label && <span className="text-[10px] font-semibold uppercase tracking-[.1em] text-muted">{label}</span>}
      <span className="inline-flex flex-wrap items-center justify-center gap-1.5">
        {entries.map((resource) => (
          <ResourceCard
            key={resource}
            resource={resource}
            count={resources[resource]}
            compact
            iconClassName="h-5 w-5"
            className={`h-13 w-9${available !== undefined && available[resource] < resources[resource] ? " blur-[1.5px] opacity-50" : ""}`}
          />
        ))}
      </span>
    </span>
  );
}

export function BuildButton({ piece, color, resources, ...buttonProperties }: ComponentProps<"button"> & {
  piece: "road" | "ship" | "settlement" | "city" | "development";
  color: string;
  resources: Resources;
}) {
  const translateText = useTranslation(gameplayTranslations);
  return (
    <button
      {...buttonProperties}
      className={`flex min-h-14 w-full items-center justify-between gap-2 rounded-xl border px-2.5 text-left text-xs ${buttonProperties["aria-pressed"] === true || buttonProperties["aria-pressed"] === "true" ? "border-forest bg-moss" : "border-line bg-white/40"}`}
    >
      <span className="flex min-w-0 items-center gap-2" style={{ color }}>
        {piece === "development" ? <span className="flex h-8 w-8 shrink-0 items-center justify-center"><CardTypeIcon kind="development" /></span> : <PieceIcon piece={piece} />}
        <span className="font-semibold text-ink">
          {match(piece)
            .with("ship", () => translateText("Build ship"))
            .with("development", () => translateText("Buy a card"))
            .with("city", () => translateText("Upgrade to city"))
            .with("road", () => translateText("Build road"))
            .with("settlement", () => translateText("Build settlement"))
            .exhaustive()}
        </span>
      </span>
      <span className="build-cost shrink-0"><Cost resources={resources} /></span>
    </button>
  );
}

export function Cost({ resources }: { resources: Resources }) {
  const theme = useBoardTheme();
  const { language } = useLanguage();
  const translateText = useTranslation(gameplayTranslations);
  return (
    <span className="inline-flex items-center gap-1">
      {(Object.keys(RESOURCE_NAMES) as Resource[])
        .filter((resource) => resources[resource] > 0)
        .map((resource) => (
          <span
            key={resource}
            data-theme={theme.id}
            className="resource-card relative inline-flex h-9 w-7 items-center justify-center rounded-md shadow-sm"
            style={{ backgroundColor: theme.resources[resource] }}
            title={translateText("{count} {resource}", { count: resources[resource], resource: resourceName(language, resource) })}
          >
            <ResourceIcon resource={resource} className="h-4 w-4 text-white" />
            {resources[resource] > 1 && (
              <span className="absolute bottom-0 right-0 rounded-tl-md bg-black/40 px-1 text-[9px] font-bold leading-4 text-white">
                {resources[resource]}
              </span>
            )}
            <span className="sr-only">
              {translateText("{count} {resource}", { count: resources[resource], resource: resourceName(language, resource) })}
            </span>
          </span>
        ))}
    </span>
  );
}
