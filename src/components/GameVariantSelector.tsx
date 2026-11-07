import { isGameVariant, type GameVariant } from "../game/types";
import { useTranslation } from "../localization";
import { seafarersTranslations } from "../translations/seafarers";

export const GAME_VARIANT_LABELS = {
  original: "Original",
  seafarers: "Seafarers",
  "four-islands": "Four Islands",
  "fog-islands": "Fog Islands",
} as const satisfies Record<GameVariant, keyof typeof seafarersTranslations>;

const SCENARIO_DESCRIPTIONS = {
  seafarers: "Main island setup. Discover three islands. First to 13 points wins.",
  "four-islands": "Start on any of four islands. Earn 2 bonus points per island not occupied by your starting settlements. First to 12 points wins.",
  "fog-islands": "Start on any revealed starting island. Explore fog with roads and ships and collect discovery resources. No island bonuses. First to 12 points wins.",
} as const;

export function GameVariantSummary({ variant }: { variant: GameVariant }) {
  const translateText = useTranslation(seafarersTranslations);
  if (variant === "original") return null;
  return <><strong>{translateText(variant === "seafarers" ? "Heading for New Shores" : GAME_VARIANT_LABELS[variant])}</strong>{" "}
    {translateText(SCENARIO_DESCRIPTIONS[variant])}</>;
}

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
