import { useId, useState } from "react";
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
import { useBoardTheme } from "../themes";
import { boardTranslations } from "../translations/board";
import { customMapTranslations } from "../translations/customMap";
import { PieceIcon, ResourceIcon } from "./GameUi";
import { ChevronDownIcon, DesertIcon, FogIcon, GoldIcon, MinusIcon, PlusIcon, SeaIcon } from "./Icons";

const TERRAIN_LABELS: Record<CustomMapCountField, "wood" | "brick" | "wool" | "grain" | "ore" | "Gold" | "Desert" | "Sea"> = {
  wood: "wood", brick: "brick", wool: "wool", grain: "grain", ore: "ore",
  gold: "Gold", desert: "Desert", sea: "Sea",
};

function TerrainFieldIcon({ field }: { field: CustomMapCountField }) {
  const theme = useBoardTheme();
  return match(field)
    .with("wood", "brick", "wool", "grain", "ore", resource => (
      <span
        aria-hidden="true"
        className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-white"
        style={{ backgroundColor: theme.resources[resource] }}
      >
        <ResourceIcon resource={resource} compact className="h-3 w-3" />
      </span>
    ))
    .with("gold", () => <GoldIcon className="h-3.5 w-3.5 shrink-0 text-[#b58a2d]" />)
    .with("desert", () => <DesertIcon className="h-3.5 w-3.5 shrink-0 text-[#9c6f33]" />)
    .with("sea", () => <SeaIcon className="h-3.5 w-3.5 shrink-0 text-[#477c91]" />)
    .exhaustive();
}

export function CustomMapConfigPanel({ value, onChange, disabled = false }: {
  value: CustomMapConfig;
  onChange: (config: CustomMapConfig) => void;
  disabled?: boolean;
}) {
  const { language } = useLanguage();
  const translateText = useTranslation(customMapTranslations);
  const translateBoardText = useTranslation(boardTranslations);
  const assigned = CUSTOM_MAP_COUNT_FIELDS.reduce((total, field) => total + value[field], 0);
  const remaining = CUSTOM_MAP_TILES - assigned;
  const land = customMapConfigLandCount(value);
  const sabotageEnabled = isCustomSabotageEnabled(value);
  const [expanded, setExpanded] = useState(true);
  const contentId = useId();
  const statusClassName = `text-xs font-semibold ${isCustomMapConfig(value) ? "text-forest" : "text-clay"}`;
  const statusText = remaining > 0
    ? translateText(remaining === 1 ? "{count} tile left to assign." : "{count} tiles left to assign.", { count: remaining })
    : land < CUSTOM_LAND_MINIMUM
      ? translateText("Add at least {count} land tiles.", { count: CUSTOM_LAND_MINIMUM - land })
      : translateText("All 42 tiles assigned.");

  function terrainName(field: CustomMapCountField): string {
    const label = TERRAIN_LABELS[field];
    return label === "Gold" || label === "Desert" || label === "Sea"
      ? translateBoardText(label)
      : resourceName(language, label);
  }

  function adjust(field: CustomMapCountField, delta: number) {
    if (disabled) return;
    const next = { ...value, [field]: Math.max(0, Math.min(CUSTOM_MAP_TILES, value[field] + delta)) };
    if (CUSTOM_MAP_COUNT_FIELDS.reduce((total, name) => total + next[name], 0) > CUSTOM_MAP_TILES) return;
    onChange(next);
  }

  return (
    <section aria-label={translateText("Customize the map")} className="rounded-xl border border-line bg-paper/70 p-3">
      <button
        type="button"
        className={`flex min-h-9 w-full cursor-pointer items-center gap-2 text-left text-[11px] font-semibold text-muted ${expanded ? "mb-2" : ""}`}
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={() => setExpanded(!expanded)}
      >
        <span className="min-w-0 flex-1 truncate">{translateText("Customize the map")}</span>
        {!expanded && <span className={`${statusClassName} truncate`} role="status">{statusText}</span>}
        <ChevronDownIcon className={`h-3.5 w-3.5 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>
      <div id={contentId} hidden={!expanded}>
      <div className="grid grid-cols-1 gap-1.5 min-[360px]:grid-cols-2 sm:grid-cols-4">
        {CUSTOM_MAP_COUNT_FIELDS.map(field => (
          <div key={field} className="flex items-center justify-between gap-2 rounded-lg border border-line bg-white/40 px-2 py-1.5 min-[360px]:block" role="group" aria-label={terrainName(field)}>
            <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
              <TerrainFieldIcon field={field} />
              <span className="truncate">{terrainName(field)}</span>
            </p>
            <div className="flex items-center justify-between gap-1 min-[360px]:mt-1">
              <button
                type="button"
                aria-label={translateText("Decrease {terrain} tiles", { terrain: terrainName(field) })}
                disabled={disabled || value[field] === 0}
                onClick={() => adjust(field, -1)}
                className="flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center rounded-md border border-line bg-paper text-ink disabled:cursor-not-allowed disabled:opacity-40 sm:h-8 sm:w-8"
              ><MinusIcon className="h-3.5 w-3.5" /></button>
              <span className="min-w-6 text-center text-sm font-bold tabular-nums" aria-label={terrainName(field)}>{value[field]}</span>
              <button
                type="button"
                aria-label={translateText("Increase {terrain} tiles", { terrain: terrainName(field) })}
                disabled={disabled || remaining === 0}
                onClick={() => adjust(field, 1)}
                className="flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center rounded-md border border-line bg-paper text-ink disabled:cursor-not-allowed disabled:opacity-40 sm:h-8 sm:w-8"
              ><PlusIcon className="h-3.5 w-3.5" /></button>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex min-h-11 cursor-pointer items-center gap-1.5 text-xs font-semibold text-ink">
            <input
              type="checkbox"
              checked={value.fog}
              disabled={disabled}
              onChange={event => onChange({ ...value, fog: event.target.checked })}
              className="h-4 w-4 accent-[#477c91]"
            />
            <FogIcon className="h-3.5 w-3.5 shrink-0 text-[#477c91]" />
            {translateBoardText("Fog")}
          </label>
          <label className="flex min-h-11 cursor-pointer items-center gap-1.5 text-xs font-semibold text-ink">
            <input
              type="checkbox"
              checked={sabotageEnabled}
              disabled={disabled}
              onChange={event => onChange({ ...value, sabotage: event.target.checked })}
              className="h-4 w-4 accent-[#8a2f22]"
            />
            <span aria-hidden="true" className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-[#8a2f22] [&>svg]:h-4 [&>svg]:w-4">
              <PieceIcon piece="sabotage" />
            </span>
            {translateText("Sabotage")}
          </label>
        </div>
        <p className={statusClassName} role="status">{statusText}</p>
      </div>
      <p className="mt-1 text-[10px] leading-4 text-muted">
        {translateText("Fog hides the whole map until discovered.")} {translateText("Sabotage spends 1 of each resource to destroy 1 opponent road or ship, destroy a settlement, or reduce a city.")}
      </p>
      </div>
    </section>
  );
}
