import {
  CUSTOM_LAND_MINIMUM,
  CUSTOM_MAP_COUNT_FIELDS,
  CUSTOM_MAP_TILES,
  customMapConfigLandCount,
  isCustomMapConfig,
  type CustomMapConfig,
  type CustomMapCountField,
} from "../game/types";
import { resourceName } from "../i18n";
import { useLanguage, useTranslation } from "../localization";
import { boardTranslations } from "../translations/board";
import { customMapTranslations } from "../translations/customMap";

const TERRAIN_LABELS: Record<CustomMapCountField, "wood" | "brick" | "wool" | "grain" | "ore" | "Gold" | "Desert" | "Sea"> = {
  wood: "wood", brick: "brick", wool: "wool", grain: "grain", ore: "ore",
  gold: "Gold", desert: "Desert", sea: "Sea",
};

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
      <p className="mb-2 text-[11px] font-semibold text-muted">{translateText("Customize the map")}</p>
      <div className="grid grid-cols-1 gap-1.5 min-[360px]:grid-cols-2 sm:grid-cols-4">
        {CUSTOM_MAP_COUNT_FIELDS.map(field => (
          <div key={field} className="flex items-center justify-between gap-2 rounded-lg border border-line bg-white/40 px-2 py-1.5 min-[360px]:block" role="group" aria-label={terrainName(field)}>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">{terrainName(field)}</p>
            <div className="flex items-center justify-between gap-1 min-[360px]:mt-1">
              <button
                type="button"
                aria-label={translateText("Decrease {terrain} tiles", { terrain: terrainName(field) })}
                disabled={disabled || value[field] === 0}
                onClick={() => adjust(field, -1)}
                className="flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center rounded-md border border-line bg-paper text-base font-bold text-ink disabled:cursor-not-allowed disabled:opacity-40 sm:h-8 sm:w-8 sm:text-sm"
              >−</button>
              <span className="min-w-6 text-center text-sm font-bold tabular-nums" aria-label={terrainName(field)}>{value[field]}</span>
              <button
                type="button"
                aria-label={translateText("Increase {terrain} tiles", { terrain: terrainName(field) })}
                disabled={disabled || remaining === 0}
                onClick={() => adjust(field, 1)}
                className="flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center rounded-md border border-line bg-paper text-base font-bold text-ink disabled:cursor-not-allowed disabled:opacity-40 sm:h-8 sm:w-8 sm:text-sm"
              >+</button>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-xs font-semibold text-ink">
          <input
            type="checkbox"
            checked={value.fog}
            disabled={disabled}
            onChange={event => onChange({ ...value, fog: event.target.checked })}
            className="h-4 w-4 accent-[#477c91]"
          />
          {translateBoardText("Fog")}
        </label>
        <p className={`text-xs font-semibold ${isCustomMapConfig(value) ? "text-forest" : "text-clay"}`} role="status">
          {remaining > 0
            ? translateText(remaining === 1 ? "{count} tile left to assign." : "{count} tiles left to assign.", { count: remaining })
            : land < CUSTOM_LAND_MINIMUM
              ? translateText("Add at least {count} land tiles.", { count: CUSTOM_LAND_MINIMUM - land })
              : translateText("All 42 tiles assigned.")}
        </p>
      </div>
      <p className="mt-1 text-[10px] leading-4 text-muted">{translateText("Fog hides the whole map until discovered.")}</p>
    </section>
  );
}
