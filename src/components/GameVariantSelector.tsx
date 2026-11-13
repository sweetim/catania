import { useEffect, useId, useRef, useState } from "react";
import { isGameVariant, type GameVariant } from "../game/types";
import { useTranslation } from "../localization";
import { seafarersTranslations } from "../translations/seafarers";

export const GAME_VARIANT_LABELS = {
  original: "Original",
  seafarers: "Seafarers",
  "four-islands": "Four Islands",
  "fog-islands": "Fog Islands",
  "foggy-world": "Foggy World",
  "mystery-world": "Mystery World",
} as const satisfies Record<GameVariant, keyof typeof seafarersTranslations>;

export function GameVariantSelector({ value, onChange, disabled = false }: {
  value: GameVariant;
  onChange: (variant: GameVariant) => void;
  disabled?: boolean;
}) {
  const translateText = useTranslation(seafarersTranslations);
  const listboxId = useId();
  const wrapper = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const listbox = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [dropUp, setDropUp] = useState(false);

  function toggleOpen() {
    if (!open && button.current && wrapper.current) {
      const buttonRect = button.current.getBoundingClientRect();
      let clipTop = 0;
      let clipBottom = window.innerHeight;
      let node: HTMLElement | null = wrapper.current.parentElement;
      while (node) {
        const style = getComputedStyle(node);
        if ([style.overflow, style.overflowY, style.overflowX].some(overflow => overflow === "hidden" || overflow === "clip" || overflow === "auto")) {
          const clipRect = node.getBoundingClientRect();
          clipTop = clipRect.top;
          clipBottom = clipRect.bottom;
          break;
        }
        node = node.parentElement;
      }
      const popupHeight = 240;
      setDropUp(clipBottom - buttonRect.bottom < popupHeight && buttonRect.top - clipTop > clipBottom - buttonRect.bottom);
    }
    setOpen(current => !current);
  }

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
    <div className="flex min-w-0 flex-col justify-end">
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
          className="flex min-h-[52px] w-full cursor-pointer items-center justify-between gap-1.5 rounded-full border border-[#e3d3a8] bg-gradient-to-b from-[#fdf7e3] to-[#f3e7c2] py-1 pl-3.5 pr-3 text-left text-[10px] font-bold uppercase tracking-[.08em] text-[#8b6425] shadow-[inset_0_1px_0_#fffdf5,0_1px_3px_#423d2814] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#886636] disabled:cursor-not-allowed sm:text-xs"
        >
          <span className="min-w-0 flex-1 truncate">{translateText(GAME_VARIANT_LABELS[value])}</span>
          <svg width="8" height="8" viewBox="0 0 12 12" fill="none" stroke="#8b6425" strokeWidth="1.5" aria-hidden="true" className="shrink-0">
            <path d="m3 4.5 3 3 3-3" />
          </svg>
        </button>
        {open && (
          <div
            ref={listbox}
            id={listboxId}
            role="listbox"
            aria-label={translateText("Game version")}
            className={`absolute left-0 z-50 flex w-full min-w-44 flex-col gap-1 rounded-xl border border-line bg-paper p-1.5 shadow-xl ${dropUp ? "bottom-full mb-1" : "top-full mt-1"}`}
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
                className="flex min-h-11 cursor-pointer items-center rounded-lg px-3 text-sm font-semibold normal-case tracking-normal text-ink hover:bg-moss aria-selected:bg-forest"
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
