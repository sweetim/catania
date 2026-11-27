import { useId, type ReactNode } from "react";
import { match } from "ts-pattern";
import {
  CUSTOM_LAND_MINIMUM,
  CUSTOM_MAP_COUNT_FIELDS,
  CUSTOM_MAP_TILES,
  customMapConfigLandCount,
  isCustomMapConfig,
  isCustomSabotageEnabled,
  type CustomMapConfig,
  type CustomMapCountField,
} from "../game/types";
import { resourceName } from "../i18n";
import { useLanguage, useTranslation } from "../localization";
import { useBoardTheme, type BoardTheme } from "../themes";
import { boardTranslations } from "../translations/board";
import { customMapTranslations } from "../translations/customMap";
import { Dialog, PieceIcon, ResourceIcon } from "./GameUi";
import { DesertIcon, FogIcon, GoldIcon, MinusIcon, PlusIcon, SeaIcon } from "./Icons";

const TERRAIN_LABELS: Record<CustomMapCountField, "wood" | "brick" | "wool" | "grain" | "ore" | "Gold" | "Volcano" | "Desert" | "Sea"> = {
  wood: "wood", brick: "brick", wool: "wool", grain: "grain", ore: "ore",
  gold: "Gold", volcano: "Volcano", desert: "Desert", sea: "Sea",
};

function terrainBarColor(theme: BoardTheme, field: CustomMapCountField): string {
  return match(field)
    .with("wood", "brick", "wool", "grain", "ore", resource => theme.resources[resource])
    .with("gold", () => theme.terrain.gold.fill)
    .with("volcano", () => theme.terrain.volcano.fill)
    .with("desert", () => theme.terrain.desert.fill)
    .with("sea", () => theme.sea[2])
    .exhaustive();
}

function TerrainFieldIcon({ field }: { field: CustomMapCountField }) {
  const theme = useBoardTheme();
  return match(field)
    .with("wood", "brick", "wool", "grain", "ore", resource => (
      <span
        aria-hidden="true"
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-white shadow-xs"
        style={{ backgroundColor: theme.resources[resource] }}
      >
        <ResourceIcon resource={resource} compact className="h-3.5 w-3.5" />
      </span>
    ))
    .with("gold", () => (
      <span aria-hidden="true" className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-[#b58a2d]/15 text-[#9a711e]">
        <GoldIcon className="h-3.5 w-3.5 shrink-0" />
      </span>
    ))
    .with("volcano", () => (
      <span aria-hidden="true" className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-[#b8563c]/15 text-[#b8563c]">
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0" aria-hidden="true" fill="none">
          <path d="M2 14 6 5h4l4 9H2Z" fill="currentColor" />
          <ellipse cx="8" cy="5" rx="2.4" ry="1" fill="#ff7426" />
          <path d="M7.2 5.8 6.5 9.5M8.8 5.8 9.6 10" stroke="#ffd859" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      </span>
    ))
    .with("desert", () => (
      <span aria-hidden="true" className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-[#9c6f33]/15 text-[#8a6128]">
        <DesertIcon className="h-3.5 w-3.5 shrink-0" />
      </span>
    ))
    .with("sea", () => (
      <span aria-hidden="true" className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-[#477c91]/15 text-[#3b6d80]">
        <SeaIcon className="h-3.5 w-3.5 shrink-0" />
      </span>
    ))
    .exhaustive();
}

function CustomMapOptionCard({
  icon,
  label,
  description,
  checked,
  disabled,
  onChange,
  accentClassName,
}: {
  icon: ReactNode;
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
  accentClassName: string;
}) {
  const descriptionId = useId();
  return (
    <div className="rounded-xl border border-line bg-white/55 p-2.5">
      <label className="flex min-h-7 cursor-pointer items-center justify-between gap-3 text-sm font-semibold text-ink">
        <span className="flex min-w-0 items-center gap-2">
          <span aria-hidden="true" className="shrink-0">{icon}</span>
          <span className="truncate">{label}</span>
        </span>
        <span className="relative inline-flex h-6 w-11 shrink-0">
          <input
            type="checkbox"
            checked={checked}
            disabled={disabled}
            onChange={event => onChange(event.currentTarget.checked)}
            aria-describedby={descriptionId}
            className="peer absolute inset-0 z-10 cursor-pointer opacity-0 disabled:cursor-not-allowed"
          />
          <span
            aria-hidden="true"
            className={`absolute inset-0 rounded-full bg-ink/20 transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-forest peer-disabled:opacity-50 ${accentClassName}`}
          />
          <span
            aria-hidden="true"
            className="absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5"
          />
        </span>
      </label>
      <p id={descriptionId} className="mt-1.5 text-xs leading-4 text-muted">{description}</p>
    </div>
  );
}

export function CustomMapConfigDialog({ value, onChange, onClose, disabled = false }: {
  value: CustomMapConfig;
  onChange: (config: CustomMapConfig) => void;
  onClose: () => void;
  disabled?: boolean;
}) {
  const { language } = useLanguage();
  const theme = useBoardTheme();
  const translateText = useTranslation(customMapTranslations);
  const translateBoardText = useTranslation(boardTranslations);
  const assigned = CUSTOM_MAP_COUNT_FIELDS.reduce((total, field) => total + value[field], 0);
  const remaining = CUSTOM_MAP_TILES - assigned;
  const land = customMapConfigLandCount(value);
  const valid = isCustomMapConfig(value);
  const sabotageEnabled = isCustomSabotageEnabled(value);
  const statusText = remaining > 0
    ? translateText(remaining === 1 ? "{count} tile left to assign." : "{count} tiles left to assign.", { count: remaining })
    : land < CUSTOM_LAND_MINIMUM
      ? translateText("Add at least {count} land tiles.", { count: CUSTOM_LAND_MINIMUM - land })
      : translateText("All 42 tiles assigned.");

  function terrainName(field: CustomMapCountField): string {
    const label = TERRAIN_LABELS[field];
    return label === "Gold" || label === "Volcano" || label === "Desert" || label === "Sea"
      ? translateBoardText(label)
      : resourceName(language, label);
  }

  function adjust(field: CustomMapCountField, delta: number) {
    if (disabled) return;
    const next = { ...value, [field]: Math.max(0, Math.min(CUSTOM_MAP_TILES, value[field] + delta)) };
    if (CUSTOM_MAP_COUNT_FIELDS.reduce((total, name) => total + next[name], 0) > CUSTOM_MAP_TILES) return;
    onChange(next);
  }

  const summary = (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={`text-xs font-semibold ${valid ? "text-[#2f6653]" : "text-clay"}`} role="status">
          {statusText}
        </p>
        <span
          aria-hidden="true"
          className={`rounded-full border px-2 py-0.5 text-[11px] font-bold tabular-nums ${valid ? "border-[#2f6653]/25 bg-moss text-ink" : "border-clay/35 bg-clay/10 text-clay"}`}
        >
          {assigned} / {CUSTOM_MAP_TILES}
        </span>
      </div>
      <div
        aria-hidden="true"
        className={`flex h-2 w-full overflow-hidden rounded-full ${valid ? "bg-ink/10" : "bg-clay/15 ring-1 ring-clay/35"}`}
      >
        {CUSTOM_MAP_COUNT_FIELDS.map(field => value[field] > 0 && (
          <div
            key={field}
            data-terrain-segment={field}
            title={`${terrainName(field)}: ${value[field]}`}
            className="h-full border-r border-paper/70 transition-[width] duration-150 last:border-r-0"
            style={{
              width: `${(value[field] / CUSTOM_MAP_TILES) * 100}%`,
              backgroundColor: terrainBarColor(theme, field),
            }}
          />
        ))}
      </div>
    </div>
  );

  return (
    <Dialog
      title={translateText("Customize the map")}
      eyebrow={<p className="eyebrow">{translateText("Custom World")}</p>}
      summary={summary}
      wide
      onClose={onClose}
    >
      <h3 className="eyebrow mb-1.5">{translateText("Tiles")}</h3>
      <div className="grid grid-cols-1 gap-1.5 min-[360px]:grid-cols-2 sm:grid-cols-3 sm:gap-2">
        {CUSTOM_MAP_COUNT_FIELDS.map(field => (
          <div
            key={field}
            className="flex items-center justify-between gap-2 rounded-xl border border-line bg-white/55 px-2.5 py-1.5 min-[360px]:block"
            role="group"
            aria-label={terrainName(field)}
          >
            <p className="flex min-w-0 items-center gap-2 text-xs font-semibold text-ink">
              <TerrainFieldIcon field={field} />
              <span className="truncate">{terrainName(field)}</span>
            </p>
            <div className="flex items-center justify-between gap-1.5 min-[360px]:mt-1.5">
              <button
                type="button"
                aria-label={translateText("Decrease {terrain} tiles", { terrain: terrainName(field) })}
                disabled={disabled || value[field] === 0}
                onClick={() => adjust(field, -1)}
                className="flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center rounded-lg border border-line bg-paper text-ink transition-colors hover:bg-moss disabled:cursor-not-allowed disabled:opacity-40 sm:h-8 sm:w-8"
              ><MinusIcon className="h-3.5 w-3.5" /></button>
              <span className="min-w-7 text-center text-base font-bold tabular-nums text-ink" aria-label={terrainName(field)}>{value[field]}</span>
              <button
                type="button"
                aria-label={translateText("Increase {terrain} tiles", { terrain: terrainName(field) })}
                disabled={disabled || remaining === 0}
                onClick={() => adjust(field, 1)}
                className="flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center rounded-lg border border-line bg-paper text-ink transition-colors hover:bg-moss disabled:cursor-not-allowed disabled:opacity-40 sm:h-8 sm:w-8"
              ><PlusIcon className="h-3.5 w-3.5" /></button>
            </div>
          </div>
        ))}
      </div>

      <h3 className="eyebrow mb-1.5 mt-3">{translateText("Options")}</h3>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <CustomMapOptionCard
          icon={<FogIcon className="h-4 w-4 text-[#477c91]" />}
          label={translateBoardText("Fog")}
          description={translateText("Fog hides the whole map until discovered.")}
          checked={value.fog}
          disabled={disabled}
          onChange={fog => onChange({ ...value, fog })}
          accentClassName="peer-checked:bg-[#477c91]"
        />
        <CustomMapOptionCard
          icon={<span className="inline-flex h-4 w-4 items-center justify-center text-[#8a2f22] [&>svg]:h-4 [&>svg]:w-4"><PieceIcon piece="sabotage" /></span>}
          label={translateText("Sabotage")}
          description={translateText("Sabotage spends 1 of each resource to destroy 1 opponent road or ship, destroy a settlement, or reduce a city.")}
          checked={sabotageEnabled}
          disabled={disabled}
          onChange={sabotage => onChange({ ...value, sabotage })}
          accentClassName="peer-checked:bg-[#8a2f22]"
        />
      </div>

      <div className="mt-3 flex justify-end border-t border-line pt-3">
        <button type="button" className="button-primary" onClick={onClose}>
          {translateText("Done")}
        </button>
      </div>
    </Dialog>
  );
}
