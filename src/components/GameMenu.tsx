import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { LanguageSelector, useTranslation } from "../localization";
import { boardTranslations } from "../translations/board";
import { ProfileAvatar } from "./ProfileAvatar";

type GameMenuAction = {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
};

export function GameMenu({ actions, exitAction, icon = false, triggerLabel, groupLabel, profileName }: {
  actions: GameMenuAction[];
  exitAction?: GameMenuAction;
  icon?: boolean;
  triggerLabel?: string;
  groupLabel?: string;
  profileName?: string;
}) {
  const translateText = useTranslation(boardTranslations);
  const triggerName = triggerLabel ?? translateText("Game");
  const groupName = groupLabel ?? translateText("Game menu");
  const menu = useRef<HTMLDetailsElement>(null);
  const menuContent = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  function positionMenu() {
    const content = menuContent.current;
    const trigger = menu.current?.querySelector("summary");
    if (!content || !trigger) return;
    const bounds = trigger.getBoundingClientRect();
    content.style.left = `${Math.max(8, Math.min(bounds.right - content.offsetWidth, window.innerWidth - content.offsetWidth - 8))}px`;
    content.style.top = `${Math.max(8, Math.min(bounds.top - content.offsetHeight - 4, window.innerHeight - content.offsetHeight - 8))}px`;
  }

  useLayoutEffect(() => {
    const content = menuContent.current;
    if (!icon || !open || !content) return;
    content.showPopover();
    positionMenu();
    window.addEventListener("resize", positionMenu);
    document.addEventListener("scroll", positionMenu, true);
    return () => {
      window.removeEventListener("resize", positionMenu);
      document.removeEventListener("scroll", positionMenu, true);
      content.hidePopover();
    };
  }, [icon, open]);

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
    <summary role="button" aria-expanded={open} aria-controls="game-menu" aria-label={icon || profileName ? triggerName : undefined} title={profileName ?? (icon ? triggerName : undefined)} onClick={(event) => {
      if (!icon || !menu.current || !menuContent.current) return;
      event.preventDefault();
      menu.current.open = !menu.current.open;
      if (menu.current.open) {
        menuContent.current.showPopover();
        positionMenu();
      } else {
        menuContent.current.hidePopover();
      }
      setOpen(menu.current.open);
    }} className={icon
      ? "flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg hover:bg-moss focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest"
      : profileName
      ? "flex min-h-11 cursor-pointer items-center gap-2 rounded-full py-1 pl-1 pr-2 transition-colors hover:bg-moss focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest"
      : "flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-3 text-xs font-semibold hover:bg-moss focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest"}>
      {icon
        ? <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" />
        </svg>
        : <>{profileName ? <ProfileAvatar name={profileName} className="h-9 w-9 text-sm" /> : triggerName}
          <svg aria-hidden="true" className="h-3 w-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="m3 4.5 3 3 3-3" />
          </svg></>}
    </summary>
    <div ref={menuContent} id="game-menu" role="group" aria-label={groupName} popover={icon ? "manual" : undefined} className={`z-50 w-48 rounded-xl border border-line bg-paper p-1.5 shadow-xl ${icon ? "fixed m-0 max-h-[calc(100dvh-16px)] overflow-auto" : "absolute right-0 top-full mt-1"}`}>
      {actions.map(action => <button key={action.label} className="min-h-11 w-full rounded-lg px-3 text-left text-sm hover:bg-moss" disabled={action.disabled} onClick={() => selectAction(action)}>
        {action.label}
      </button>)}
      <div className="mt-1 border-t border-line pt-1">
        <LanguageSelector />
      </div>
      {exitAction && (
        <div className="mt-1 border-t border-line pt-1">
          <button className="min-h-11 w-full rounded-lg px-3 text-left text-sm text-clay hover:bg-clay/10" disabled={exitAction.disabled} onClick={() => selectAction(exitAction)}>
            {exitAction.label}
          </button>
        </div>
      )}
    </div>
  </details>;
}
