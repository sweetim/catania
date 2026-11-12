import { isGameVariant, type GameVariant } from "../game/types";
import { useTranslation } from "../localization";
import { seafarersTranslations } from "../translations/seafarers";

export const GAME_VARIANT_LABELS = {
  original: "Original",
  seafarers: "Seafarers",
  "four-islands": "Four Islands",
  "fog-islands": "Fog Islands",
  "foggy-world": "Foggy World",
} as const satisfies Record<GameVariant, keyof typeof seafarersTranslations>;

export function GameVariantSelector({ value, onChange, disabled = false }: {
  value: GameVariant;
  onChange: (variant: GameVariant) => void;
  disabled?: boolean;
}) {
  const translateText = useTranslation(seafarersTranslations);
  return <label className="min-w-0 text-[10px] font-semibold text-muted sm:text-[11px]">
    <span className="mb-1.5 block">{translateText("Game version")}</span>
    <select className="field !min-h-[52px] !px-1 !text-[10px] text-ink sm:!px-2 sm:!text-xs" value={value} disabled={disabled}
      onChange={event => { if (isGameVariant(event.target.value)) onChange(event.target.value); }}>
      {Object.entries(GAME_VARIANT_LABELS).map(([variant, label]) =>
        <option key={variant} value={variant}>{translateText(label)}</option>)}
    </select>
  </label>;
}
