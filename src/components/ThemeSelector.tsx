import { useId } from "react";
import type { Terrain } from "../game/types";
import { useLanguage, useTranslation } from "../localization";
import { BOARD_THEMES, getThemeName, getThemeDescription, type BoardThemeId } from "../themes";
import { boardTranslations } from "../translations/board";
import { TerrainArtwork } from "./ThemeArtwork";

export function ThemeSelector({ value, onChange }: { value: BoardThemeId; onChange: (value: BoardThemeId) => void }) {
  const { language } = useLanguage();
  const translateText = useTranslation(boardTranslations);
  const selectorId = useId();
  return (
    <fieldset className="@container min-w-0">
      <legend className="mb-3 text-sm font-semibold">{translateText("Board theme")}</legend>
      <div className="grid min-w-0 grid-cols-2 gap-2">
        {Object.values(BOARD_THEMES).map((theme) => (
          <label key={theme.id} className="relative flex min-w-0 cursor-pointer">
            <input
              type="radio"
              name={`${selectorId}-board-theme`}
              value={theme.id}
              checked={value === theme.id}
              onChange={() => onChange(theme.id)}
              aria-labelledby={`${selectorId}-${theme.id}-name`}
              aria-describedby={`${selectorId}-${theme.id}-description`}
              className="peer absolute right-2 top-2 z-10 h-4 w-4 cursor-pointer accent-ink"
            />
            <span className="flex w-full min-w-0 flex-col rounded-xl border border-line bg-white/50 p-2 text-ink transition-colors hover:bg-moss peer-checked:border-ink peer-checked:bg-moss peer-checked:ring-1 peer-checked:ring-ink peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink">
              <span className="mb-1 flex min-h-4 items-center pr-6" aria-hidden="true">
                <span className="text-[9px] font-semibold uppercase tracking-[.08em] text-muted">{translateText(theme.id === "illustrated" ? "Original" : "Artwork")}</span>
              </span>
              <svg aria-hidden="true" focusable="false" viewBox="0 0 176 92" className="mb-2 block w-full rounded-lg">
                <rect width="176" height="92" rx="8" fill={theme.sea[1]} />
                <path d="M0 76Q46 56 91 76t85-8V92H0Z" fill={theme.sea[2]} opacity=".4" />
                {(["wood", "grain", "ore"] satisfies Terrain[]).map((terrain, index) => (
                  <g key={terrain} transform={`translate(${39 + index * 49} ${index === 1 ? 38 : 53}) scale(.44)`}>
                    <polygon points="0,-58 50,-29 50,29 0,58 -50,29 -50,-29" fill={theme.terrain[terrain].fill} stroke={theme.border} strokeWidth="5" strokeLinejoin="round" />
                    <TerrainArtwork terrain={terrain} theme={theme} />
                  </g>
                ))}
              </svg>
              <span id={`${selectorId}-${theme.id}-name`} className="block text-[11px] font-semibold leading-snug [overflow-wrap:anywhere] @min-[320px]:text-xs">{getThemeName(theme, language)}</span>
              <span id={`${selectorId}-${theme.id}-description`} className="mt-1 block text-[10px] leading-relaxed text-muted [overflow-wrap:anywhere]">{getThemeDescription(theme, language)}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
