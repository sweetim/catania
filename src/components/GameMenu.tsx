import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { LanguageSelector, useTranslation } from "../localization";
import { boardTranslations } from "../translations/board";
import { ProfileAvatar } from "./ProfileAvatar";

type MenuIcon = "help" | "settings" | "pass" | "reset" | "profile" | "restart" | "end" | "home" | "lobby" | "leave" | "singleDevice" | "qr";

const menuIconPaths: Record<MenuIcon, ReactNode> = {
  help: <><circle cx="12" cy="12" r="9" /><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.2-3 4" /><path d="M12 17.2h.01" /></>,
  settings: <><path d="M21 4h-7M10 4H3" /><path d="M21 12h-9M8 12H3" /><path d="M21 20h-5M12 20H3" /><path d="M14 2v4" /><path d="M8 10v4" /><path d="M16 18v4" /></>,
  pass: <><path d="M4 7h13m0 0-3-3m3 3-3 3" /><path d="M20 17H7m0 0 3-3m-3 3 3 3" /></>,
  reset: <><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></>,
  profile: <><circle cx="12" cy="8" r="4" /><path d="M20 21a8 8 0 0 0-16 0" /></>,
  restart: <><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" /><path d="M3 21v-5h5" /></>,
  end: <><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" /><path d="M4 22v-7" /></>,
  home: <><path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" /><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></>,
  lobby: <><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" /><path d="m10 17 5-5-5-5" /><path d="M15 12H3" /></>,
  leave: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" /></>,
  singleDevice: <><rect width="14" height="20" x="5" y="2" rx="2" /><path d="M12 18h.01" /></>,
  qr: <><rect width="5" height="5" x="3" y="3" rx="1" /><rect width="5" height="5" x="16" y="3" rx="1" /><rect width="5" height="5" x="3" y="16" rx="1" /><path d="M21 16h-3a2 2 0 0 0-2 2v3" /><path d="M21 21v.01" /><path d="M12 7v3a2 2 0 0 1-2 2H7" /><path d="M3 12h.01" /><path d="M12 3h.01" /><path d="M12 16v.01" /><path d="M16 12h.01" /><path d="M21 12v.01" /><path d="M12 21v.01" /></>,
};

function MenuActionIcon({ icon }: { icon: MenuIcon }) {
  return <svg aria-hidden="true" className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {menuIconPaths[icon]}
  </svg>;
}

type GameMenuAction = {
  label: string;
  icon?: MenuIcon;
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
    const dismissMenu = (event: PointerEvent | FocusEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent && event.key !== "Tab") return;
      if (menu.current && event.target instanceof Node && !menu.current.contains(event.target)) {
        menu.current.open = false;
      }
    };
    document.addEventListener("pointerdown", dismissMenu);
    // Safari can blur a menu control before delivering a tapped item's click.
    document.addEventListener("focusin", dismissMenu);
    // Tabbing into browser chrome has no next focusin target in the document.
    document.addEventListener("keyup", dismissMenu);
    return () => {
      document.removeEventListener("pointerdown", dismissMenu);
      document.removeEventListener("focusin", dismissMenu);
      document.removeEventListener("keyup", dismissMenu);
    };
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
      {actions.map(action => <button key={action.label} className="flex min-h-11 w-full items-center gap-2.5 rounded-lg px-3 text-left text-sm hover:bg-moss" disabled={action.disabled} onClick={() => selectAction(action)}>
        {action.icon && <MenuActionIcon icon={action.icon} />}
        {action.label}
      </button>)}
      <div className="mt-1 border-t border-line pt-1">
        <LanguageSelector />
      </div>
      {exitAction && (
        <div className="mt-1 border-t border-line pt-1">
          <button className="flex min-h-11 w-full items-center gap-2.5 rounded-lg px-3 text-left text-sm text-clay hover:bg-clay/10" disabled={exitAction.disabled} onClick={() => selectAction(exitAction)}>
            {exitAction.icon && <MenuActionIcon icon={exitAction.icon} />}
            {exitAction.label}
          </button>
        </div>
      )}
    </div>
  </details>;
}
