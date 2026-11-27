import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { match } from "ts-pattern";
import { victoryTarget } from "../game/engine";
import { type GameVariant } from "../game/types";
import { useTranslation } from "../localization";
import { seafarersTranslations } from "../translations/seafarers";
import {
  ChevronDownIcon,
  FogIcon,
  HexIslandIcon,
  MapFoldIcon,
  MoveShipIcon,
  SeaIcon,
  SlidersIcon,
  TrophyIcon,
} from "./Icons";

type ListboxPosition = {
  left: number;
  width: number;
  maxHeight: number;
  top?: number;
  bottom?: number;
};

export const GAME_VARIANT_LABELS = {
  original: "Original",
  seafarers: "Seafarers",
  "four-islands": "Four Islands",
  "fog-islands": "Fog Islands",
  "foggy-world": "Foggy World",
  "mystery-world": "Mystery World",
  "volcano-islands": "Volcano Islands",
  "custom-world": "Custom World",
} as const satisfies Record<GameVariant, keyof typeof seafarersTranslations>;

function VariantBadgeIcon({ variant, className = "h-4 w-4 shrink-0" }: { variant: GameVariant; className?: string }) {
  return match(variant)
    .with("original", () => <HexIslandIcon className={className} />)
    .with("seafarers", () => <MoveShipIcon className={className} />)
    .with("four-islands", () => <SeaIcon className={className} />)
    .with("fog-islands", "foggy-world", () => <FogIcon className={className} />)
    .with("mystery-world", () => <MapFoldIcon className={className} />)
    .with("volcano-islands", () => (
      <svg viewBox="0 0 16 16" className={className} aria-hidden="true" fill="none">
        <path d="M2 14 6 5h4l4 9H2Z" fill="currentColor" />
        <ellipse cx="8" cy="5" rx="2.4" ry="1" fill="#ff7426" />
        <path d="M7.2 5.8 6.5 9.5M8.8 5.8 9.6 10" stroke="#ffd859" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    ))
    .with("custom-world", () => <SlidersIcon className={className} />)
    .exhaustive();
}

export function GameVariantSelector({ value, onChange, onSelectOption, disabled = false, showVictoryTarget = false, className = "" }: {
  value: GameVariant;
  onChange: (variant: GameVariant) => void;
  onSelectOption?: (variant: GameVariant) => void;
  disabled?: boolean;
  showVictoryTarget?: boolean;
  className?: string;
}) {
  const translateText = useTranslation(seafarersTranslations);
  const listboxId = useId();
  const wrapper = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const listbox = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [listboxPosition, setListboxPosition] = useState<ListboxPosition | null>(null);

  function computeListboxPosition(): ListboxPosition | null {
    const trigger = button.current;
    if (!trigger) return null;
    const triggerBounds = trigger.getBoundingClientRect();
    const viewportMargin = 8;
    const width = Math.min(Math.max(triggerBounds.width, 192), window.innerWidth - viewportMargin * 2);
    const left = Math.max(
      viewportMargin,
      Math.min(triggerBounds.left, window.innerWidth - width - viewportMargin),
    );
    const availableBelow = window.innerHeight - triggerBounds.bottom - viewportMargin - 4;
    const availableAbove = triggerBounds.top - viewportMargin - 4;
    const openUpward = availableBelow < 220 && availableAbove > availableBelow;
    const maxHeight = Math.max(120, Math.min(360, openUpward ? availableAbove : availableBelow));
    return openUpward
      ? { left, width, maxHeight, bottom: window.innerHeight - triggerBounds.top + 4 }
      : { left, width, maxHeight, top: triggerBounds.bottom + 4 };
  }

  function toggleOpen() {
    if (!open) setListboxPosition(computeListboxPosition());
    setOpen(current => !current);
  }

  useLayoutEffect(() => {
    if (!open) return;
    const updatePosition = () => setListboxPosition(computeListboxPosition());
    updatePosition();
    window.addEventListener("resize", updatePosition);
    document.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      document.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: Event) => {
      if (!wrapper.current?.contains(event.target as Node | null)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    // Safari can blur a menu control before delivering a tapped item's click.
    document.addEventListener("focusin", dismiss);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("focusin", dismiss);
    };
  }, [open]);

  function focusOption(index: number) {
    const options = listbox.current?.querySelectorAll<HTMLButtonElement>("[role='option']");
    if (!options?.length) return;
    options[Math.max(0, Math.min(options.length - 1, index))]?.focus();
  }

  function selectVariant(variant: GameVariant) {
    setOpen(false);
    button.current?.focus({ preventScroll: true });
    if (variant !== value) onChange(variant);
    onSelectOption?.(variant);
  }

  const variants = Object.keys(GAME_VARIANT_LABELS) as GameVariant[];

  return (
    <div className={`flex min-w-0 flex-col justify-end ${className}`}>
      <span ref={wrapper} className="relative block">
        <button
          ref={button}
          type="button"
          aria-label={translateText("Game version")}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listboxId}
          title={translateText("Game version")}
          disabled={disabled}
          onClick={() => toggleOpen()}
          onKeyDown={event => {
            if (event.key === "Escape" && open) {
              event.preventDefault();
              setOpen(false);
              return;
            }
            if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
            event.preventDefault();
            if (open) {
              const options = Array.from(listbox.current?.querySelectorAll("[role='option']") ?? []);
              focusOption(options.findIndex(option => option.getAttribute("aria-selected") === "true"));
              return;
            }
            const next = variants[variants.indexOf(value) + (event.key === "ArrowDown" ? 1 : -1)];
            if (next !== undefined) onChange(next);
          }}
          className="group flex min-h-11 w-full cursor-pointer items-center justify-between gap-2 rounded-xl border border-[#dfcfab] bg-gradient-to-b from-[#fdf9ec] to-[#f4e9cb] px-3 py-1.5 text-left text-sm font-semibold text-[#5d4217] shadow-[inset_0_1px_0_#fffdf7,0_1px_2px_#423d2812] transition-all hover:border-[#cbb37c] hover:from-[#fcf4de] hover:to-[#efe0b5] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#886636] disabled:cursor-not-allowed"
        >
          <span className="flex min-w-0 flex-1 items-center gap-2.5">
            <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#e8d5a4]/65 text-[#8a6121] shadow-[inset_0_1px_0_#fffdf7]">
              <VariantBadgeIcon variant={value} className="h-4 w-4 shrink-0" />
            </span>
            <span className="min-w-0 flex-1 truncate">{translateText(GAME_VARIANT_LABELS[value])}</span>
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            {showVictoryTarget && (
              <span aria-hidden="true" className="hidden items-center gap-1 rounded-full border border-[#d9c48f]/80 bg-white/60 px-2 py-0.5 text-[10px] font-bold tracking-wide text-[#7a571e] tabular-nums min-[360px]:inline-flex">
                <TrophyIcon className="h-3 w-3 shrink-0 text-[#a5782a]" />
                {translateText("{points} VP", { points: victoryTarget(value) })}
              </span>
            )}
            <ChevronDownIcon className={`h-3.5 w-3.5 shrink-0 text-[#8b6425] transition-transform ${open ? "rotate-180" : ""}`} />
          </span>
        </button>
        {open && listboxPosition && (
          <div
            ref={listbox}
            id={listboxId}
            role="listbox"
            aria-label={translateText("Game version")}
            style={listboxPosition}
            className="fixed z-50 flex flex-col gap-1 overflow-y-auto overscroll-contain rounded-xl border border-line bg-paper p-1.5 shadow-xl"
            onKeyDown={event => {
              if (event.key === "Escape") {
                event.preventDefault();
                setOpen(false);
                button.current?.focus();
                return;
              }
              const options = Array.from(listbox.current?.querySelectorAll<HTMLButtonElement>("[role='option']") ?? []);
              const index = options.findIndex(option => option === document.activeElement);
              const deltas = { ArrowDown: 1, ArrowUp: -1 } as const;
              if (event.key in deltas) {
                event.preventDefault();
                focusOption(index + deltas[event.key as keyof typeof deltas]);
              } else if (event.key === "Home") {
                event.preventDefault();
                focusOption(0);
              } else if (event.key === "End") {
                event.preventDefault();
                focusOption(options.length - 1);
              }
            }}
          >
            {variants.map(variant => (
              <button
                key={variant}
                type="button"
                role="option"
                aria-label={translateText(GAME_VARIANT_LABELS[variant])}
                aria-selected={variant === value}
                className="flex min-h-11 shrink-0 cursor-pointer items-center justify-between gap-2 rounded-lg px-2.5 text-sm font-semibold normal-case tracking-normal text-ink transition-colors hover:bg-moss aria-selected:bg-forest"
                onClick={() => selectVariant(variant)}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-ink/5 text-ink/80">
                    <VariantBadgeIcon variant={variant} className="h-3.5 w-3.5 shrink-0" />
                  </span>
                  <span className="truncate">{translateText(GAME_VARIANT_LABELS[variant])}</span>
                </span>
                {showVictoryTarget && (
                  <span aria-hidden="true" className="shrink-0 rounded-full bg-ink/8 px-2 py-0.5 text-[10px] font-bold text-ink/75 tabular-nums">
                    {translateText("{points} VP", { points: victoryTarget(variant) })}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </span>
    </div>
  );
}
