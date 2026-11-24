import { useEffect, useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { match } from "ts-pattern";
import type { DevelopmentKind, Player, Resource, Resources } from "../game/types";
import { resourceName } from "../i18n";
import { useLanguage, useTranslation } from "../localization";
import { gameplayTranslations } from "../translations/gameplay";
import { useBoardTheme } from "../themes";
import { ArrowRightIcon, CloseIcon, MinusIcon, PlusIcon, WarningIcon } from "./Icons";
import { ResourceArtwork } from "./ThemeArtwork";

export const RESOURCE_NAMES: Record<Resource, string> = {
  wood: "Wood",
  brick: "Brick",
  wool: "Wool",
  grain: "Grain",
  ore: "Ore",
};

export function getPlayerLabel(player: Pick<Player, "name" | "control">, number: number): string | number {
  return player.control === "human" ? Array.from(player.name.trim())[0]?.toUpperCase() ?? number : number;
}

export function ResourceIcon({
  resource,
  className = "h-6 w-6",
  compact = false,
}: {
  resource: Resource;
  className?: string;
  compact?: boolean;
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
      <ResourceArtwork resource={resource} theme={theme} compact={compact} />
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
  return <ArrowRightIcon className={className} />;
}

export function PieceIcon({ piece }: { piece: "road" | "ship" | "settlement" | "city" | "sabotage" }) {
  return (
    <svg className="piece-icon h-8 w-8 shrink-0" data-piece={piece} viewBox="0 0 32 32" aria-hidden="true" fill="none">
      {match(piece)
        .with("ship", () => (
          <>
            <path d="M3 22.5h26l-4.5 6.5H7.5Z" fill="currentColor" />
            <path d="M5.5 26h21l-2 3H7.5Z" fill="black" opacity=".18" />
            <path d="M14.5 4v18.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            <path d="M16.5 5.5C23 9.5 26.5 14.5 27 20H16.5Z" fill="currentColor" opacity=".88" />
            <path d="M12.5 9.5C8.5 13 6 16.5 5.5 20h7Z" fill="currentColor" opacity=".55" />
            <path d="M16.5 5.5C20 8.5 22 12 22.5 16" stroke="white" strokeOpacity=".4" strokeWidth="1.1" strokeLinecap="round" />
          </>
        ))
        .with("road", () => (
          <>
            <path d="m3 22.5 20.5-15 5.5 3.3L8.5 25.8Z" fill="currentColor" />
            <path d="M3 22.5v3l5.5 3.3v-3M8.5 25.8 29 10.8v3L8.5 28.8" fill="currentColor" opacity=".62" />
            <path d="m8.2 21.6 3.5-2.6m3-2.2 3.5-2.6m3-2.2 3.5-2.6" stroke="white" strokeOpacity=".58" strokeWidth="1.5" strokeLinecap="round" />
          </>
        ))
        .with("settlement", () => (
          <>
            <path d="M5 27V15.5L13 7.5 21 15.5V27Z" fill="currentColor" />
            <path d="M21 15.5 27 12.5V24L21 27Z" fill="currentColor" opacity=".6" />
            <path d="M13 6.5 19 3.5 28.5 13 22.5 16Z" fill="currentColor" opacity=".82" />
            <path d="M21.5 5.2H24.5V10.2L21.5 7.2Z" fill="currentColor" opacity=".72" />
            <path d="M3.5 16 13 6.5 22.5 16" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M4.8 15 13 6.8 19 3.8" stroke="white" strokeOpacity=".5" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M10.2 27V21.2A2.8 2.8 0 0 1 15.8 21.2V27Z" fill="white" fillOpacity=".62" />
          </>
        ))
        .with("city", () => (
          <>
            <path d="M3 28V17L9.5 10.5 16 17V28Z" fill="currentColor" />
            <path d="M9.5 9.8 14.5 7.3 16 9V17Z" fill="currentColor" opacity=".8" />
            <path d="M1.8 17.5 9.5 9.8 16 16.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M16 28V5.5H18.4V8.4H19.6V5.5H21.8V8.4H23V5.5H25.2V28Z" fill="currentColor" />
            <path d="M25.2 5.5 27 4.6V7.1L28.4 6.4V3.9L30 3V25.5L25.2 28Z" fill="currentColor" opacity=".6" />
            <path d="M2.6 16.8 9.5 10 14.5 7.5M16.6 6H24.6" stroke="white" strokeOpacity=".48" strokeWidth="1.2" strokeLinecap="round" />
            <path d="M7.1 28V22.4A2.4 2.4 0 0 1 11.9 22.4V28Z" fill="white" fillOpacity=".62" />
            <path d="M19 16.2V13.2A1.6 1.6 0 0 1 22.2 13.2V16.2Z" fill="white" fillOpacity=".72" />
            <path d="M19.3 23V20.2A1.3 1.3 0 0 1 21.9 20.2V23Z" fill="white" fillOpacity=".72" />
          </>
        ))
        .with("sabotage", () => (
          <>
            <path d="M5 27V13l5-5 4 4-3 5 5 2-4 8H5Z" fill="currentColor" />
            <path d="M27 27H16l4-7-5-2 3-5 4-5 5 5v14Z" fill="currentColor" opacity=".76" />
            <path d="m17.5 3.5-4.5 8.5 5 2-5.5 11.5" stroke="currentColor" strokeWidth="4.2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="m17.5 3.5-4.5 8.5 5 2-5.5 11.5" stroke="white" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
          </>
        ))
        .exhaustive()}
    </svg>
  );
}

export function IslandIcon({ className = "h-6 w-5 shrink-0" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 28" className={className} aria-hidden="true" fill="none">
      <path d="M4 22.5c2.5-2 13.5-2 16 0-1.4 2.4-4.4 3.6-8 3.6s-6.6-1.2-8-3.6Z" fill="currentColor" />
      <path d="M12 22.2c.8-4.5.6-8.6-.4-12.7" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
      <path d="M11.2 9.8C9.2 6.8 5.6 6.1 3 8c1.4-3.4 5.9-4 8-1.1l.2 2.9Z" fill="currentColor" />
      <path d="M12.6 9.8c2-3 5.6-3.7 8.4-1.8-1.4-3.4-5.9-4-8-1.1l-.4 2.9Z" fill="currentColor" />
      <path d="M11.8 9.2C10.5 6 11.2 3.2 13.7 1.4c.5 3 0 5.5-1.5 7.5l-.4.3Z" fill="currentColor" />
    </svg>
  );
}

export function CardTypeIcon({ kind }: { kind: "resource" | "development" }) {
  return (
    <svg viewBox="0 0 24 28" className="h-6 w-5 shrink-0" aria-hidden="true" fill="none">
      <rect x="2" y="2" width="16" height="22" rx="3" fill="currentColor" opacity=".25" />
      <rect x="6" y="5" width="16" height="22" rx="3" fill="currentColor" />
      {kind === "resource"
        ? <path d="m14 9.8 5 2.9v5.6L14 21.2l-5-2.9v-5.6Z" fill="white" />
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
            <path d="m16 3 11 4v9c0 6.2-5.6 10.4-11 13C10.6 26.4 5 22.2 5 16V7Z" fill="currentColor" />
            <path d="M16 7.5 22 10v5.2c0 3.8-2.8 6.8-6 8.6" fill="white" fillOpacity=".18" />
            <path d="M16 8.5v13.5m-4.5-4.5h9" stroke="white" strokeWidth="2.2" strokeLinecap="round" />
            <path d="M16 8.5 13.5 12h5Z" fill="white" />
          </>
        ))
        .with("victory-point", () => (
          <>
            <path d="m16 3 4 8 9 1.2-6.5 6.3 1.6 9-8.1-4.3-8.1 4.3 1.6-9L3 12.2l9-1.2Z" fill="currentColor" />
            <path d="m16 8.2 2.1 4.2 4.6.6-3.3 3.2.8 4.6-4.2-2.2-4.2 2.2.8-4.6-3.3-3.2 4.6-.6Z" fill="white" fillOpacity=".35" />
          </>
        ))
        .with("road-building", () => (
          <>
            <path d="m3 16 14-10 4.5 2.7-14 10Z" fill="currentColor" />
            <path d="m3 16 0 2.8 4.5 2.7 14-10V8.7l-14 10Z" fill="currentColor" opacity=".62" />
            <path d="m10.5 22.5 14-10 4.5 2.7-14 10Z" fill="currentColor" />
            <path d="m10.5 22.5 0 2.8 4.5 2.7 14-10v-2.8l-14 10Z" fill="currentColor" opacity=".62" />
            <path d="m8 14.5 8-5.7M15.5 21l8-5.7" stroke="white" strokeOpacity=".55" strokeWidth="1.4" strokeLinecap="round" />
          </>
        ))
        .with("year-of-plenty", () => (
          <>
            <path d="M5 18h22l-3 10.5H8Z" fill="currentColor" />
            <path d="M9.5 22h13m-11 3.5h9" stroke="white" strokeOpacity=".55" strokeWidth="1.6" strokeLinecap="round" />
            <path d="M12 18V7.5m0 5.5C7 13 6 9.5 7 7c3.5 0 5 2.5 5 6Zm0-2.5C12 7 14.5 5 17 5c.5 3-1 5.5-5 5.5Z" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M21 18V9m0 5c4.5 0 5.5-3 4.5-5.5-3 0-4.5 2-4.5 5.5Z" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="16.5" cy="14" r="3" fill="currentColor" />
          </>
        ))
        .with("monopoly", () => (
          <>
            <path d="M6 19.5 8 10l4.5 4.2L16 8l3.5 6.2L24 10l2 9.5Z" fill="currentColor" />
            <rect x="6" y="21.5" width="20" height="4" rx="1.8" fill="currentColor" />
            <path d="M16 2.5v3M8 4.5l2 2M24 4.5l-2 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <circle cx="16" cy="15.2" r="2" fill="white" />
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
  const previousReference = useRef<{ resources: Resources; developmentCards: number } | null>(null);
  const [changedResources, setChangedResources] = useState<Partial<Record<Resource, number>>>({});
  const [developmentChangedGeneration, setDevelopmentChangedGeneration] = useState(0);

  useEffect(() => {
    const previous = previousReference.current;
    if (previous) {
      const nextChanges: Partial<Record<Resource, number>> = {};
      let anyResourceChanged = false;
      for (const resource of Object.keys(RESOURCE_NAMES) as Resource[]) {
        if (resources[resource] !== previous.resources[resource]) {
          nextChanges[resource] = Date.now();
          anyResourceChanged = true;
        }
      }
      if (anyResourceChanged) {
        setChangedResources(current => {
          const updated = { ...current };
          for (const resource of Object.keys(nextChanges) as Resource[]) {
            updated[resource] = (current[resource] ?? 0) + 1;
          }
          return updated;
        });
      }
      if (developmentCards !== previous.developmentCards) {
        setDevelopmentChangedGeneration(current => current + 1);
      }
    }
    previousReference.current = { resources: { ...resources }, developmentCards };
  }, [resources.wood, resources.brick, resources.wool, resources.grain, resources.ore, developmentCards]);

  return (
    <section className="bank-tray" aria-label={translateText("Resource bank")}>
      <h2 className="eyebrow">{translateText("Bank")}</h2>
      <ul className="bank-supply" aria-label={translateText("Bank resources")}>
        {(Object.keys(RESOURCE_NAMES) as Resource[]).map(resource => {
          const count = resources[resource];
          const generation = changedResources[resource] ?? 0;
          return (
            <li key={resource} aria-label={translateText("{resource}: {count} in bank", { resource: resourceName(language, resource), count })} title={translateText("{count} {resource} in bank", { count, resource: resourceName(language, resource) })}>
              <span aria-hidden="true" data-theme={theme.id} data-empty={count === 0 ? "true" : undefined} className={`bank-card resource-card inline-flex h-10 w-8 rounded-xl p-[3px] shadow-sm ${count === 0 ? "bank-card-empty" : ""}`} style={{ backgroundColor: theme.resources[resource] }}>
                <span className="flex h-full w-full flex-col items-center justify-center gap-px rounded-lg border border-white/50 text-white">
                  <ResourceIcon resource={resource} compact className="h-4 w-4" />
                  <strong className="w-full rounded-sm bg-paper/95 text-center text-xs font-bold leading-3 text-ink tabular-nums">
                    <span key={generation} className={generation > 0 ? "bank-count-changed" : undefined}>{count}</span>
                  </strong>
                </span>
              </span>
            </li>
          );
        })}
      </ul>
      <span className={`bank-development ${developmentCards === 0 ? "bank-card-empty" : ""}`} data-empty={developmentCards === 0 ? "true" : undefined} role="img" aria-label={translateText("{count} development cards in bank", { count: developmentCards })} title={translateText("{count} development cards in bank", { count: developmentCards })}>
        <CardTypeIcon kind="development" />
        <strong>
          <span key={developmentChangedGeneration} className={developmentChangedGeneration > 0 ? "bank-count-changed" : undefined}>{developmentCards}</span>
        </strong>
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
      className={`game-dialog m-auto max-h-[90dvh] w-[calc(100%_-_1.5rem)] overflow-y-auto overscroll-contain rounded-2xl border border-line bg-paper p-0 text-ink shadow-2xl backdrop:bg-ink/45 backdrop:backdrop-blur-sm sm:w-[calc(100%_-_2rem)] ${wide ? "max-w-2xl" : "max-w-lg"}`}
      aria-label={title}
    >
      <div className="dialog-header sticky top-0 z-10 border-b border-line bg-paper">
        <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6 sm:py-4">
          <div className="min-w-0">
            {eyebrow && <div className="mb-1">{eyebrow}</div>}
            <h2 className="font-serif text-xl sm:text-2xl">{title}</h2>
          </div>
          <button
            onClick={onClose}
            aria-label={translateText("Close dialog")}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-line hover:bg-moss"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>
        {summary && <div className="px-4 pb-3 sm:px-6 sm:pb-4">{summary}</div>}
      </div>
      <div className="dialog-body px-4 py-3.5 sm:px-6 sm:py-5">{children}</div>
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
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-muted">{translateText("Your hand")}</h3>
        <strong className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold text-ink tabular-nums ${totalResources > 7 ? "card-count-at-risk bg-clay/25" : "bg-moss"}`}>
          {totalResources > 7 && <WarningIcon className="h-3.5 w-3.5 shrink-0 text-clay" />}
          {translateText("{count} cards", { count: totalResources })}
        </strong>
      </div>
      <ul aria-label={translateText("Cards in hand")} className="grid grid-cols-5 gap-1.5 sm:gap-2">
        {(Object.keys(RESOURCE_NAMES) as Resource[]).map(resource => (
          <li key={resource} aria-label={translateText("{resource}: {count} in hand", { resource: resourceName(language, resource), count: resources[resource] })} className="flex min-w-0 flex-col items-center gap-0.5">
            <ResourceCard resource={resource} count={resources[resource]} compact iconClassName="h-4 w-4 sm:h-5 sm:w-5" className={`h-10 w-8 sm:h-11 sm:w-9 ${resources[resource] === 0 ? "grayscale" : ""}`} />
            <span className="max-w-full truncate text-[10px] font-semibold leading-tight text-ink/90">{resourceName(language, resource)}</span>
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
  action: "Give" | "Receive" | "Claim";
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
  const actionLabel = match(action)
    .with("Give", () => translateText("Give {resource}", { resource: name }))
    .with("Receive", () => translateText("Receive {resource}", { resource: name }))
    .with("Claim", () => translateText("Claim {resource}", { resource: name }))
    .exhaustive();
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={actionLabel}
      aria-description={countLabel && count !== undefined ? translateText("{countLabel}: {count}. {caption}", { countLabel: translateText(countLabel), count, caption }) : caption || undefined}
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
      <legend className="mb-2 text-sm font-semibold">{label}</legend>
      <div className="grid grid-cols-5 gap-1.5 sm:gap-2">
        {(Object.keys(RESOURCE_NAMES) as Resource[]).map((resource) => {
          const selected = values[resource];
          const name = resourceName(language, resource);
          return (
            <div
              key={resource}
              role="group"
              aria-label={translateText("{resource} selection", { resource: name })}
              aria-description={maximum
                ? translateText(maximumLabel === "In hand"
                  ? "In hand {maximum}. Selected {selected}. Remaining {remaining}."
                  : "In bank {maximum}. Selected {selected}. Remaining {remaining}.", {
                  maximum: maximum[resource], selected, remaining: maximum[resource] - selected,
                })
                : translateText("Selected {count}.", { count: selected })}
              className="flex min-w-0 flex-col items-center gap-1"
            >
              <div className="relative w-full">
                <button
                  type="button"
                  className="resource-select-card relative block min-h-11 w-full rounded-xl transition-transform active:scale-[0.97]"
                  aria-label={translateText("Add {resource} to {label}", { resource: name, label })}
                  disabled={selected >= (maximum?.[resource] ?? 19)}
                  onClick={() =>
                    onChange({ ...values, [resource]: selected + 1 })
                  }
                >
                  <ResourceCard resource={resource} selected={selected > 0} compact iconClassName="h-6 w-6" className="h-14 w-full sm:h-16" />
                  {maximum !== undefined && (
                    <span aria-hidden="true" className="absolute bottom-1 left-1 rounded bg-paper/95 px-1 text-[10px] font-bold leading-4 text-ink/85 tabular-nums shadow-xs">
                      /{maximum[resource]}
                    </span>
                  )}
                  <span aria-hidden="true" className="absolute bottom-1 right-1 flex h-4.5 w-4.5 items-center justify-center rounded-full bg-paper/95 text-ink shadow-xs">
                    <PlusIcon className="h-3 w-3" />
                  </span>
                </button>
                <output
                  aria-label={translateText("{resource} selected", { resource: name })}
                  data-empty={selected === 0 ? "true" : undefined}
                  className="selected-resource-count"
                >
                  {selected}
                </output>
              </div>
              <span className="max-w-full truncate text-[10px] font-semibold leading-tight text-ink/90">{name}</span>
              <button
                type="button"
                className="flex h-9 w-full items-center justify-center rounded-lg border border-line bg-white/75 text-ink transition-colors hover:bg-moss disabled:border-transparent disabled:bg-moss/50"
                aria-label={translateText("Remove {resource} from {label}", { resource: name, label })}
                disabled={!selected}
                onClick={() => onChange({ ...values, [resource]: selected - 1 })}
              >
                <MinusIcon className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
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
      className="card-stack inline-flex min-w-0 flex-col items-center gap-1.5"
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
            className={`h-12 w-9${available !== undefined && available[resource] < resources[resource] ? " opacity-50" : ""}`}
          />
        ))}
      </span>
    </span>
  );
}

export function BuildButton({ piece, color, resources, available, layout = "row", ...buttonProperties }: ComponentProps<"button"> & {
  piece: "road" | "ship" | "settlement" | "city" | "sabotage" | "development";
  color: string;
  resources: Resources;
  available?: Resources;
  layout?: "row" | "tile";
}) {
  const translateText = useTranslation(gameplayTranslations);
  const pressed = buttonProperties["aria-pressed"] === true || buttonProperties["aria-pressed"] === "true";
  const label = match(piece)
    .with("ship", () => translateText("Build ship"))
    .with("development", () => translateText("Buy a card"))
    .with("city", () => translateText("Upgrade to city"))
    .with("road", () => translateText("Build road"))
    .with("settlement", () => translateText("Build settlement"))
    .with("sabotage", () => translateText("Sabotage"))
    .exhaustive();
  if (layout === "tile") {
    return (
      <button
        {...buttonProperties}
        className={`build-tile flex min-h-[70px] w-full flex-col justify-between gap-1.5 rounded-xl border px-2.5 py-2 text-left text-xs transition-all ${pressed ? "border-forest bg-moss ring-2 ring-forest/50" : "border-[#cfc3a6] bg-white/90 shadow-[0_2px_0_#d8ccb0,0_3px_8px_#253b3610] hover:bg-white"}`}
      >
        <span className="flex min-w-0 items-center gap-1.5" style={{ color }}>
          {piece === "development" ? <span className="flex h-6 w-6 shrink-0 items-center justify-center [&>svg]:h-5 [&>svg]:w-5"><CardTypeIcon kind="development" /></span> : <span className="flex h-6 w-6 shrink-0 items-center justify-center [&>svg]:h-6 [&>svg]:w-6"><PieceIcon piece={piece} /></span>}
          <span className="min-w-0 text-[12px] font-semibold leading-tight text-ink">
            {label}
          </span>
        </span>
        <span className="build-cost shrink-0 self-end"><Cost resources={resources} available={available} /></span>
      </button>
    );
  }
  return (
    <button
      {...buttonProperties}
      className={`flex min-h-14 w-full items-center justify-between gap-2 rounded-xl border px-2.5 text-left text-xs ${pressed ? "border-forest bg-moss" : "border-line bg-white/40"}`}
    >
      <span className="flex min-w-0 items-center gap-2" style={{ color }}>
        {piece === "development" ? <span className="flex h-8 w-8 shrink-0 items-center justify-center"><CardTypeIcon kind="development" /></span> : <PieceIcon piece={piece} />}
        <span className="font-semibold text-ink">
          {label}
        </span>
      </span>
      <span className="build-cost shrink-0"><Cost resources={resources} available={available} /></span>
    </button>
  );
}

export function Cost({ resources, available }: { resources: Resources; available?: Resources }) {
  const theme = useBoardTheme();
  const { language } = useLanguage();
  const translateText = useTranslation(gameplayTranslations);
  return (
    <span className="inline-flex items-center gap-1">
      {(Object.keys(RESOURCE_NAMES) as Resource[])
        .filter((resource) => resources[resource] > 0)
        .map((resource) => {
          const missing = available !== undefined && available[resource] < resources[resource];
          return (
            <span
              key={resource}
              data-theme={theme.id}
              className={`resource-card relative inline-flex h-9 w-7 items-center justify-center rounded-md shadow-sm ${missing ? "cost-pip-missing" : ""}`}
              style={{ backgroundColor: theme.resources[resource] }}
              title={translateText("{count} {resource}", { count: resources[resource], resource: resourceName(language, resource) })}
            >
              <ResourceIcon resource={resource} compact className="h-4 w-4 text-white" />
              {resources[resource] > 1 && (
                <span className="absolute bottom-0 right-0 rounded-tl-md bg-black/40 px-1 text-[9px] font-bold leading-4 text-white">
                  {resources[resource]}
                </span>
              )}
              <span className="sr-only">
                {translateText("{count} {resource}", { count: resources[resource], resource: resourceName(language, resource) })}
              </span>
            </span>
          );
        })}
    </span>
  );
}
