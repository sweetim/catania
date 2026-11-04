import type { GameVariant } from "../game/types";
import { useTranslation } from "../localization";
import { seafarersTranslations } from "../translations/seafarers";

export function GameVariantSelector({ value, onChange, disabled = false }: {
  value: GameVariant;
  onChange: (variant: GameVariant) => void;
  disabled?: boolean;
}) {
  const translateText = useTranslation(seafarersTranslations);
  return <label className="min-w-0 text-[10px] font-semibold text-muted sm:text-[11px]">
    <span className="mb-1.5 block">{translateText("Game version")}</span>
    <select className="field !min-h-[52px] !px-1 !text-[10px] text-ink sm:!px-2 sm:!text-xs" value={value} disabled={disabled}
      onChange={event => onChange(event.target.value as GameVariant)}>
      <option value="original">{translateText("Original")}</option>
      <option value="seafarers">{translateText("Seafarers")}</option>
    </select>
  </label>;
}
