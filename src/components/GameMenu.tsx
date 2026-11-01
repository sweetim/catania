import { useEffect, useRef, useState } from "react";
import { LanguageSelector, useTranslation } from "../localization";
import { boardTranslations } from "../translations/board";

type GameMenuAction = {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
};

export function GameMenu({ actions, exitAction, icon = false }: {
  actions: GameMenuAction[];
  exitAction: GameMenuAction;
  icon?: boolean;
}) {
  const translateText = useTranslation(boardTranslations);
  const menu = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const dismissMenu = (event: PointerEvent) => {
      if (menu.current && event.target instanceof Node && !menu.current.contains(event.target)) {
        menu.current.open = false;
      }
    };
    document.addEventListener("pointerdown", dismissMenu);
    return () => document.removeEventListener("pointerdown", dismissMenu);
  }, []);

  function selectAction(action: GameMenuAction) {
    if (menu.current) {
      menu.current.open = false;
      // Dialogs restore focus to the visible opener, not a hidden menu item.
      menu.current.querySelector("summary")?.focus();
    }
    action.onSelect();
  }

  return <details
    ref={menu}
    className="game-menu relative shrink-0"
    onToggle={(event) => setOpen(event.currentTarget.open)}
    onBlur={(event) => {
      // Ignore focus lost to the native select popup so language choice stays usable.
      const focusTarget = event.relatedTarget instanceof Node ? event.relatedTarget : document.activeElement;
      if (!event.currentTarget.contains(focusTarget)) event.currentTarget.open = false;
    }}
    onKeyDown={(event) => {
      if (event.key === "Escape" && event.currentTarget.open) {
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.open = false;
        event.currentTarget.querySelector("summary")?.focus();
      }
    }}
  >
    <summary role="button" aria-expanded={open} aria-controls="game-menu" aria-label={icon ? translateText("Game") : undefined} title={icon ? translateText("Game") : undefined} className={icon
      ? "flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg hover:bg-moss focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest"
      : "flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-3 text-xs font-semibold hover:bg-moss focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest"}>
      {icon
        ? <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" />
        </svg>
        : <>{translateText("Game")}
          <svg aria-hidden="true" className="h-3 w-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="m3 4.5 3 3 3-3" />
          </svg></>}
    </summary>
    <div id="game-menu" role="group" aria-label={translateText("Game menu")} className={`absolute right-0 z-50 w-48 rounded-xl border border-line bg-paper p-1.5 shadow-xl ${icon ? "bottom-full mb-1" : "top-full mt-1"}`}>
      {actions.map(action => <button key={action.label} className="min-h-11 w-full rounded-lg px-3 text-left text-sm hover:bg-moss" disabled={action.disabled} onClick={() => selectAction(action)}>
        {action.label}
      </button>)}
      <div className="mt-1 border-t border-line pt-1">
        <LanguageSelector />
      </div>
      <div className="mt-1 border-t border-line pt-1">
        <button className="min-h-11 w-full rounded-lg px-3 text-left text-sm text-clay hover:bg-clay/10" disabled={exitAction.disabled} onClick={() => selectAction(exitAction)}>
          {exitAction.label}
        </button>
      </div>
    </div>
  </details>;
}
