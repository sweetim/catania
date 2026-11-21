import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { type GameVariant } from "../game/types";
import { useTranslation } from "../localization";
import { seafarersTranslations } from "../translations/seafarers";

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
  "custom-world": "Custom World",
} as const satisfies Record<GameVariant, keyof typeof seafarersTranslations>;

export function GameVariantSelector({ value, onChange, disabled = false, className = "" }: {
  value: GameVariant;
  onChange: (variant: GameVariant) => void;
  disabled?: boolean;
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
          className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-2 rounded-xl border border-[#dfcfab] bg-gradient-to-b from-[#fdf8e7] to-[#f6ecd0] px-3.5 py-2 text-left text-sm font-semibold text-[#6e4f1d] shadow-[inset_0_1px_0_#fffdf6,0_1px_2px_#423d2810] transition-colors hover:border-[#cfb986] hover:from-[#fbf3da] hover:to-[#f1e2ba] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#886636] disabled:cursor-not-allowed"
        >
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 text-[#9c732d]">
              <path d="M12 2 4 6.5v11L12 22l8-4.5v-11Z" />
              <path d="M12 22V12m0 0 8-4.5M12 12 4 7.5" />
            </svg>
            <span className="min-w-0 flex-1 truncate">{translateText(GAME_VARIANT_LABELS[value])}</span>
          </span>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="#8b6425" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
            <path d="m3 4.5 3 3 3-3" />
          </svg>
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
                aria-selected={variant === value}
                className="flex min-h-11 shrink-0 cursor-pointer items-center rounded-lg px-3 text-sm font-semibold normal-case tracking-normal text-ink hover:bg-moss aria-selected:bg-forest"
                onClick={() => selectVariant(variant)}
              >
                {translateText(GAME_VARIANT_LABELS[variant])}
              </button>
            ))}
          </div>
        )}
      </span>
    </div>
  );
}
