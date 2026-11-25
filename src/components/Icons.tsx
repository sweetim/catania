import type { ReactNode } from "react";

type IconProperties = {
  className?: string;
  label?: string;
};

type StrokeIconProperties = IconProperties & {
  viewBox?: string;
  strokeWidth?: number;
  children: ReactNode;
};

function StrokeIcon({
  className = "h-4 w-4 shrink-0",
  label,
  viewBox = "0 0 24 24",
  strokeWidth = 1.8,
  children,
}: StrokeIconProperties) {
  return (
    <svg
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={className}
      viewBox={viewBox}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {label ? <title>{label}</title> : null}
      {children}
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/*  Core UI Chrome & Navigation Icons (24×24, strokeWidth 1.8, rounded)       */
/* -------------------------------------------------------------------------- */

export function CloseIcon({ className = "h-4 w-4 shrink-0", label }: IconProperties) {
  return (
    <StrokeIcon className={className} label={label}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </StrokeIcon>
  );
}

export function ChevronDownIcon({ className = "h-3.5 w-3.5 shrink-0", label }: IconProperties) {
  return (
    <StrokeIcon className={className} label={label}>
      <path d="m6 9 6 6 6-6" />
    </StrokeIcon>
  );
}

export function ChevronRightIcon({ className = "h-4 w-4 shrink-0", label }: IconProperties) {
  return (
    <StrokeIcon className={className} label={label}>
      <path d="m9 6 6 6-6 6" />
    </StrokeIcon>
  );
}

export function ArrowRightIcon({ className = "h-4 w-4 shrink-0", label }: IconProperties) {
  return (
    <StrokeIcon className={className} label={label}>
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </StrokeIcon>
  );
}

export function PlusIcon({ className = "h-4 w-4 shrink-0", label }: IconProperties) {
  return (
    <StrokeIcon className={className} label={label} strokeWidth={2}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </StrokeIcon>
  );
}

export function MinusIcon({ className = "h-4 w-4 shrink-0", label }: IconProperties) {
  return (
    <StrokeIcon className={className} label={label} strokeWidth={2}>
      <path d="M5 12h14" />
    </StrokeIcon>
  );
}

export function ZoomInIcon({ className = "h-4 w-4 shrink-0", label }: IconProperties) {
  return (
    <StrokeIcon className={className} label={label}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.8-3.8" />
      <path d="M11 8v6" />
      <path d="M8 11h6" />
    </StrokeIcon>
  );
}

export function ZoomOutIcon({ className = "h-4 w-4 shrink-0", label }: IconProperties) {
  return (
    <StrokeIcon className={className} label={label}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.8-3.8" />
      <path d="M8 11h6" />
    </StrokeIcon>
  );
}

export function CheckIcon({ className = "h-4 w-4 shrink-0", label }: IconProperties) {
  return (
    <StrokeIcon className={className} label={label} strokeWidth={2}>
      <path d="M20 6 9 17l-5-5" />
    </StrokeIcon>
  );
}

export function CopyIcon({ className = "h-4 w-4 shrink-0", label }: IconProperties) {
  return (
    <StrokeIcon className={className} label={label}>
      <rect width="12" height="12" x="9" y="9" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </StrokeIcon>
  );
}

export function ShuffleIcon({ className = "h-4 w-4 shrink-0", label }: IconProperties) {
  return (
    <StrokeIcon className={className} label={label}>
      <path d="m18 3 3 3-3 3" />
      <path d="m18 15 3 3-3 3" />
      <path d="M3 6h3c6 0 6 12 12 12h3" />
      <path d="M3 18h3c2 0 3.3-1.3 4.5-3.3" />
      <path d="M13.5 9.3C14.7 7.3 16 6 18 6h3" />
    </StrokeIcon>
  );
}

export function WarningIcon({ className = "h-3.5 w-3.5 shrink-0", label }: IconProperties) {
  return (
    <StrokeIcon className={className} label={label}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v4.5" />
      <circle cx="12" cy="16.2" r="0.9" fill="currentColor" stroke="none" />
    </StrokeIcon>
  );
}

export function MoreVerticalIcon({ className = "h-4 w-4 shrink-0", label }: IconProperties) {
  return (
    <svg
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
    >
      {label ? <title>{label}</title> : null}
      <circle cx="12" cy="5" r="1.7" />
      <circle cx="12" cy="12" r="1.7" />
      <circle cx="12" cy="19" r="1.7" />
    </svg>
  );
}

export function SlidersIcon({ className = "h-4 w-4 shrink-0", label }: IconProperties) {
  return (
    <StrokeIcon className={className} label={label}>
      <path d="M21 4h-7M10 4H3" />
      <path d="M21 12h-9M8 12H3" />
      <path d="M21 20h-5M12 20H3" />
      <path d="M14 2v4" />
      <path d="M8 10v4" />
      <path d="M16 18v4" />
    </StrokeIcon>
  );
}

export function HelpCircleIcon({ className = "h-4 w-4 shrink-0", label }: IconProperties) {
  return (
    <StrokeIcon className={className} label={label}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.2-3 4" />
      <circle cx="12" cy="17.2" r="0.8" fill="currentColor" stroke="none" />
    </StrokeIcon>
  );
}

export function GlobeIcon({ className = "h-4 w-4 shrink-0", label }: IconProperties) {
  return (
    <StrokeIcon className={className} label={label}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3.5 9h17" />
      <path d="M3.5 15h17" />
      <path d="M12 3a13.5 13.5 0 0 0 0 18" />
      <path d="M12 3a13.5 13.5 0 0 1 0 18" />
    </StrokeIcon>
  );
}

export function EditPencilIcon({ className = "h-4 w-4 shrink-0", label }: IconProperties) {
  return (
    <StrokeIcon className={className} label={label}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4Z" />
    </StrokeIcon>
  );
}

export function TrashIcon({ className = "h-4 w-4 shrink-0", label }: IconProperties) {
  return (
    <StrokeIcon className={className} label={label}>
      <path d="M3 6h18" />
      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <path d="M5 6l1 14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-14" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </StrokeIcon>
  );
}

export function ReplayIcon({ className = "h-4 w-4 shrink-0", label }: IconProperties) {
  return (
    <StrokeIcon className={className} label={label}>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
      <path d="m10.5 9 5 3-5 3Z" fill="currentColor" strokeLinejoin="round" />
    </StrokeIcon>
  );
}

export function TurnsIcon({ className = "h-4 w-4 shrink-0", label }: IconProperties) {
  return (
    <StrokeIcon className={className} label={label}>
      <path d="M6 3h12" />
      <path d="M6 21h12" />
      <path d="M7 3v3.5a5 5 0 0 0 2.2 4.1L12 12l2.8-1.4A5 5 0 0 0 17 6.5V3" />
      <path d="M7 21v-3.5a5 5 0 0 1 2.2-4.1L12 12l2.8 1.4a5 5 0 0 1 2.2 4.1V21" />
    </StrokeIcon>
  );
}

export function ResetIcon({ className = "h-4 w-4 shrink-0", label }: IconProperties) {
  return (
    <StrokeIcon className={className} label={label}>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </StrokeIcon>
  );
}

export function RestartIcon({ className = "h-4 w-4 shrink-0", label }: IconProperties) {
  return (
    <StrokeIcon className={className} label={label}>
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M3 21v-5h5" />
    </StrokeIcon>
  );
}

export function HomeIcon({ className = "h-4 w-4 shrink-0", label }: IconProperties) {
  return (
    <StrokeIcon className={className} label={label}>
      <path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" />
      <path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </StrokeIcon>
  );
}

export function ReturnToLobbyIcon({ className = "h-4 w-4 shrink-0", label }: IconProperties) {
  return (
    <StrokeIcon className={className} label={label}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <path d="M14 17.5h7" />
      <path d="m17 14.5-3 3 3 3" />
    </StrokeIcon>
  );
}

export function LeaveIcon({ className = "h-4 w-4 shrink-0", label }: IconProperties) {
  return (
    <StrokeIcon className={className} label={label}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5" />
      <path d="M21 12H9" />
    </StrokeIcon>
  );
}

export function FlagIcon({ className = "h-4 w-4 shrink-0", label }: IconProperties) {
  return (
    <StrokeIcon className={className} label={label}>
      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
      <path d="M4 22v-7" />
    </StrokeIcon>
  );
}

export function PassDeviceIcon({ className = "h-4 w-4 shrink-0", label }: IconProperties) {
  return (
    <StrokeIcon className={className} label={label}>
      <rect width="10" height="16" x="4" y="4" rx="2" />
      <path d="M9 17h.01" />
      <path d="M14 12h7" />
      <path d="m18 9 3 3-3 3" />
    </StrokeIcon>
  );
}

export function SingleDeviceIcon({ className = "h-4 w-4 shrink-0", label }: IconProperties) {
  return (
    <StrokeIcon className={className} label={label}>
      <rect width="14" height="20" x="5" y="2" rx="2" />
      <circle cx="12" cy="18" r="0.8" fill="currentColor" stroke="none" />
    </StrokeIcon>
  );
}

export function CrossDeviceIcon({ className = "h-4 w-4 shrink-0", label }: IconProperties) {
  return (
    <StrokeIcon className={className} label={label}>
      <rect width="12" height="16" x="2" y="4" rx="2" />
      <rect width="8" height="12" x="14" y="8" rx="1.5" />
      <circle cx="8" cy="17" r="0.7" fill="currentColor" stroke="none" />
      <circle cx="18" cy="17" r="0.7" fill="currentColor" stroke="none" />
    </StrokeIcon>
  );
}

export function QrCodeIcon({ className = "h-4 w-4 shrink-0", label }: IconProperties) {
  return (
    <StrokeIcon className={className} label={label}>
      <rect width="5" height="5" x="3" y="3" rx="1" />
      <rect width="5" height="5" x="16" y="3" rx="1" />
      <rect width="5" height="5" x="3" y="16" rx="1" />
      <path d="M21 16h-3a2 2 0 0 0-2 2v3" />
      <path d="M21 21v.01" />
      <path d="M12 7v3a2 2 0 0 1-2 2H7" />
      <path d="M3 12h.01" />
      <path d="M12 3h.01" />
      <path d="M12 16v.01" />
      <path d="M16 12h.01" />
      <path d="M21 12v.01" />
      <path d="M12 21v.01" />
    </StrokeIcon>
  );
}

export function PaletteIcon({ className = "h-4 w-4 shrink-0", label }: IconProperties) {
  return (
    <StrokeIcon className={className} label={label}>
      <path d="M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1-3.7 1.5 1.5 0 0 1 1-2.8h2a4 4 0 0 0 4-4C21 6 17 3 12 3Z" />
      <circle cx="7.5" cy="10.5" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="11.2" cy="7" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="15.8" cy="8.5" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="8" cy="15" r="1.2" fill="currentColor" stroke="none" />
    </StrokeIcon>
  );
}

export function MapFoldIcon({ className = "h-4 w-4 shrink-0", label }: IconProperties) {
  return (
    <StrokeIcon className={className} label={label}>
      <path d="M3 6l6-3 6 3 6-2v14l-6 2-6-2-6 3V6Z" />
      <path d="M9 3v15" />
      <path d="M15 6v14" />
    </StrokeIcon>
  );
}

export function HexIslandIcon({ className = "h-4 w-4 shrink-0", label }: IconProperties) {
  return (
    <StrokeIcon className={className} label={label}>
      <path d="M12 2 4 6.5v11L12 22l8-4.5v-11Z" />
      <path d="m7.5 14.5 3.5-6 3 4 2-2.5 2.5 4.5H7.5Z" />
    </StrokeIcon>
  );
}

export function GameVariantIcon({ className = "h-4 w-4 shrink-0", label }: IconProperties) {
  return (
    <StrokeIcon className={className} label={label}>
      <path d="M12 2.5 4.5 6.8v8.4L12 19.5l7.5-4.3V6.8Z" />
      <path d="m12 6.5 2 3.5 3 1.5-3 1.5-2 3.5-2-3.5-3-1.5 3-1.5Z" />
    </StrokeIcon>
  );
}

export function EyeIcon({ className = "h-4 w-4 shrink-0", label }: IconProperties) {
  return (
    <StrokeIcon className={className} label={label}>
      <path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="2.75" />
    </StrokeIcon>
  );
}

export function CardsHandIcon({ className = "h-4 w-4 shrink-0", label }: IconProperties) {
  return (
    <StrokeIcon className={className} label={label}>
      <rect x="4" y="5" width="11" height="15" rx="2" />
      <path d="M15 8h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9a2 2 0 0 1-1.7-1" />
    </StrokeIcon>
  );
}

/* -------------------------------------------------------------------------- */
/*  Players, Presence & Activity Icons                                        */
/* -------------------------------------------------------------------------- */

export function UserIcon({ className = "h-4 w-4 shrink-0", label }: IconProperties) {
  return (
    <StrokeIcon className={className} label={label}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21v-1.5a7.5 7.5 0 0 1 16 0V21" />
    </StrokeIcon>
  );
}

export function UsersIcon({ className = "h-4 w-4 shrink-0", label }: IconProperties) {
  return (
    <StrokeIcon className={className} label={label}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </StrokeIcon>
  );
}

export function RobotIcon({ className = "h-4 w-4 shrink-0", label, strokeWidth = 1.8 }: IconProperties & { strokeWidth?: number }) {
  return (
    <StrokeIcon className={className} label={label} strokeWidth={strokeWidth}>
      <path d="M12 3v4" />
      <path d="M3 12v3M21 12v3" />
      <rect x="5" y="7" width="14" height="13" rx="4" />
      <path d="M9.5 16h5" />
      <circle cx="9.5" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="14.5" cy="12" r="1" fill="currentColor" stroke="none" />
    </StrokeIcon>
  );
}

export function AddRobotIcon({ className = "h-4 w-4 shrink-0", label }: IconProperties) {
  return (
    <StrokeIcon className={className} label={label}>
      <path d="M10 3v3.5" />
      <rect x="3.5" y="6.5" width="13" height="12" rx="3.5" />
      <circle cx="7.8" cy="11.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="12.2" cy="11.5" r="1" fill="currentColor" stroke="none" />
      <path d="M8 15h4" />
      <path d="M19.5 13v6" />
      <path d="M16.5 16h6" />
    </StrokeIcon>
  );
}

export function UserMinusIcon({ className = "h-3.5 w-3.5 shrink-0", label }: IconProperties) {
  return (
    <StrokeIcon className={className} label={label}>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M3 20v-1.5a6 6 0 0 1 12 0V20" />
      <path d="M16 11h6" />
    </StrokeIcon>
  );
}

export function LinkConnectIcon({ className = "h-4 w-4 shrink-0", label }: IconProperties) {
  return (
    <StrokeIcon className={className} label={label}>
      <path d="M10 13a5 5 0 0 0 7.07 0l2.12-2.12a5 5 0 0 0-7.07-7.07L10.5 5.4" />
      <path d="M14 11a5 5 0 0 0-7.07 0l-2.12 2.12a5 5 0 0 0 7.07 7.07l1.6-1.6" />
    </StrokeIcon>
  );
}

export function DisconnectedIcon({ className = "h-3.5 w-3.5 shrink-0", label }: IconProperties) {
  return (
    <StrokeIcon className={className} label={label} strokeWidth={2}>
      <path d="M2 2 22 22" />
      <path d="M8.5 16.5a5 5 0 0 1 7 0" />
      <path d="M5 12.86a10 10 0 0 1 5.17-2.69" />
      <path d="M19 12.86a10 10 0 0 0-2.01-1.52" />
      <path d="M2 8.82a15 15 0 0 1 4.18-2.64" />
      <path d="M22 8.82a15 15 0 0 0-11.29-3.76" />
      <circle cx="12" cy="20" r="1.2" fill="currentColor" stroke="none" />
    </StrokeIcon>
  );
}

export function ActivityLogIcon({ className = "h-4 w-4 shrink-0", label }: IconProperties) {
  return (
    <StrokeIcon className={className} label={label}>
      <path d="M8 6h12" />
      <path d="M8 12h12" />
      <path d="M8 18h10" />
      <circle cx="4.5" cy="6" r="1" fill="currentColor" stroke="none" />
      <circle cx="4.5" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="4.5" cy="18" r="1" fill="currentColor" stroke="none" />
    </StrokeIcon>
  );
}

/* -------------------------------------------------------------------------- */
/*  Settings Icons                                                            */
/* -------------------------------------------------------------------------- */

export function BlockedCornerIcon({ className = "h-4 w-4 shrink-0", label }: IconProperties) {
  return (
    <StrokeIcon className={className} label={label}>
      <path d="M12 3 4.5 7.3v9.4L12 21l7.5-4.3V7.3Z" />
      <path d="m9.2 9.2 5.6 5.6" />
      <path d="m14.8 9.2-5.6 5.6" />
    </StrokeIcon>
  );
}

export function VibrateIcon({ className = "h-4 w-4 shrink-0", label }: IconProperties) {
  return (
    <StrokeIcon className={className} label={label}>
      <rect x="7" y="3" width="10" height="18" rx="2" />
      <path d="M12 17.5h.01" />
      <path d="M3.5 8.5c-1 2.2-1 4.8 0 7" />
      <path d="M20.5 8.5c1 2.2 1 4.8 0 7" />
    </StrokeIcon>
  );
}

/* -------------------------------------------------------------------------- */
/*  Gameplay Actions & Tabletop Emblems                                       */
/* -------------------------------------------------------------------------- */

export function DiceIcon({ className = "h-4 w-4 shrink-0", label }: IconProperties) {
  return (
    <StrokeIcon className={className} label={label}>
      <rect x="2.5" y="7.5" width="12.5" height="12.5" rx="2.5" />
      <circle cx="6.2" cy="11.2" r="1" fill="currentColor" stroke="none" />
      <circle cx="8.75" cy="13.75" r="1" fill="currentColor" stroke="none" />
      <circle cx="11.3" cy="16.3" r="1" fill="currentColor" stroke="none" />
      <path d="M9.5 7.5V6a2.5 2.5 0 0 1 2.5-2.5h7A2.5 2.5 0 0 1 21.5 6v7a2.5 2.5 0 0 1-2.5 2.5H15" />
      <circle cx="17.8" cy="7.2" r="1" fill="currentColor" stroke="none" />
      <circle cx="17.8" cy="11.8" r="1" fill="currentColor" stroke="none" />
    </StrokeIcon>
  );
}

export function EndTurnIcon({ className = "h-4 w-4 shrink-0", label }: IconProperties) {
  return (
    <StrokeIcon className={className} label={label}>
      <path d="M4 12h12" />
      <path d="m11 7 5 5-5 5" />
      <path d="M20 6v12" />
    </StrokeIcon>
  );
}

export function TradeIcon({ className = "h-4 w-4 shrink-0", label }: IconProperties) {
  return (
    <StrokeIcon className={className} label={label}>
      <path d="M4 8h15" />
      <path d="m15 4 4 4-4 4" />
      <path d="M20 16H5" />
      <path d="m9 12-4 4 4 4" />
    </StrokeIcon>
  );
}

export function BankHarborIcon({ className = "h-4 w-4 shrink-0", label }: IconProperties) {
  return (
    <StrokeIcon className={className} label={label}>
      <path d="M3 9 12 4l9 5Z" />
      <path d="M5 18h14" />
      <path d="M3 21h18" />
      <path d="M6 10v8" />
      <path d="M12 10v8" />
      <path d="M18 10v8" />
    </StrokeIcon>
  );
}

export function MoveShipIcon({ className = "h-4 w-4 shrink-0", label }: IconProperties) {
  return (
    <StrokeIcon className={className} label={label}>
      <path d="M3 16h14l-2.5 4h-9Z" />
      <path d="M10 16V6" />
      <path d="M10 6l6 7h-6Z" />
      <path d="M17 8h4" />
      <path d="m19 6 2 2-2 2" />
    </StrokeIcon>
  );
}

export function PirateShipIcon({ className = "h-4 w-4 shrink-0", label }: IconProperties) {
  return (
    <StrokeIcon className={className} label={label}>
      <path d="M3 16h18l-2.8 4H5.8Z" />
      <path d="M11 16V4" />
      <path d="M11 4.5 19.5 13H11Z" />
      <path d="m13 8.5 3 3" strokeWidth="1.5" />
      <path d="m16 8.5-3 3" strokeWidth="1.5" />
    </StrokeIcon>
  );
}

export function RobberIcon({ className = "h-4 w-4 shrink-0", label }: IconProperties) {
  return (
    <svg
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={className}
      viewBox="0 0 24 24"
      fill="none"
    >
      {label ? <title>{label}</title> : null}
      <path
        d="M6 20.5c-.8-1.5.5-4.3 2.5-6.6L9.5 11C6.5 8.5 7 3.5 12 3.5s5.5 5 2.5 7.5l1 2.9c2 2.3 3.3 5.1 2.5 6.6H6Z"
        fill="currentColor"
      />
      <path d="M7.2 18.5h9.6" stroke="var(--color-paper, #f6f3eb)" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="10.2" cy="7.5" r="0.9" fill="var(--color-paper, #f6f3eb)" />
      <circle cx="13.8" cy="7.5" r="0.9" fill="var(--color-paper, #f6f3eb)" />
    </svg>
  );
}

export function DiscardCardIcon({ className = "h-4 w-4 shrink-0", label }: IconProperties) {
  return (
    <StrokeIcon className={className} label={label}>
      <path d="M6 19H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v5" />
      <path d="M15 11v9" />
      <path d="m11.5 16.5 3.5 3.5 3.5-3.5" />
    </StrokeIcon>
  );
}

export function TrophyIcon({ className = "h-3.5 w-3.5 shrink-0", label }: IconProperties) {
  return (
    <StrokeIcon className={className} label={label} strokeWidth={1.9}>
      <path d="M8 21h8" />
      <path d="M12 17v4" />
      <path d="M7 4h10v5a5 5 0 0 1-10 0Z" />
      <path d="M7 6H4a3 3 0 0 0 3 4" />
      <path d="M17 6h3a3 3 0 0 1-3 4" />
    </StrokeIcon>
  );
}

export function CrownIcon({ className = "h-4 w-4 shrink-0", label }: IconProperties) {
  return (
    <StrokeIcon className={className} label={label}>
      <path d="m3 17 2-9 4.5 4L12 6l2.5 6L19 8l2 9Z" fill="currentColor" fillOpacity="0.2" />
      <path d="M4 20h16" />
    </StrokeIcon>
  );
}

export function LargestArmyIcon({ className = "h-6 w-5 shrink-0", label }: IconProperties) {
  return (
    <svg
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      viewBox="0 0 24 28"
      className={className}
      fill="none"
    >
      {label ? <title>{label}</title> : null}
      <path d="m4 4.5 4.2 1.4L18.5 17l-2.6 2.6L5.4 8.7 4 4.5Z" fill="currentColor" />
      <path d="m20 4.5-4.2 1.4L5.5 17l2.6 2.6L18.6 8.7 20 4.5Z" fill="currentColor" />
      <path d="m13.5 21 5.8-5.5M4.7 15.5l5.8 5.5" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
      <path d="m17 20 2.8 3.2M7 20l-2.8 3.2" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="20.2" cy="23.6" r="1.2" fill="currentColor" />
      <circle cx="3.8" cy="23.6" r="1.2" fill="currentColor" />
    </svg>
  );
}

export function LongestRoadAwardIcon({ className = "h-6 w-5 shrink-0", label }: IconProperties) {
  return (
    <svg
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      data-piece="road"
      viewBox="0 0 24 28"
      className={className}
      fill="none"
    >
      {label ? <title>{label}</title> : null}
      <path d="M4 4h16v14.5l-8 5.5-8-5.5Z" fill="currentColor" fillOpacity="0.18" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="m6.8 14.8 8.2-6.6 2.7 1.8-8.2 6.6Z" fill="currentColor" />
      <path d="m6.8 14.8 0 2.3 2.7 1.8 8.2-6.6v-2.3l-8.2 6.6Z" fill="currentColor" fillOpacity="0.65" />
    </svg>
  );
}

export function MasterSaboteurAwardIcon({ className = "h-6 w-5 shrink-0", label }: IconProperties) {
  return (
    <svg
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      data-piece="sabotage"
      viewBox="0 0 24 28"
      className={className}
      fill="none"
    >
      {label ? <title>{label}</title> : null}
      <path d="M4 4h16v14.5l-8 5.5-8-5.5Z" fill="currentColor" fillOpacity="0.18" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="m14.2 6.6-4.2 6.5h3.2L9.8 20.6l5.6-7.6h-3.1l1.9-6.4Z" fill="currentColor" />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/*  Non-Resource Terrain Icons (Gold, Desert, Sea, Fog)                       */
/* -------------------------------------------------------------------------- */

export function GoldIcon({ className = "h-4 w-4 shrink-0", label }: IconProperties) {
  return (
    <StrokeIcon className={className} label={label}>
      <path d="M4 18 7.5 11h9L20 18Z" fill="currentColor" fillOpacity="0.2" />
      <path d="M7.5 11 10 15h4l2.5-4" />
      <path d="M12 4v2.5M6 6.5l1.5 1.5M18 6.5 16.5 8" />
    </StrokeIcon>
  );
}

export function DesertIcon({ className = "h-4 w-4 shrink-0", label }: IconProperties) {
  return (
    <StrokeIcon className={className} label={label}>
      <circle cx="17" cy="7" r="2.6" />
      <path d="M2.5 18c3.2-3.8 6.5-3.8 9.8-.5 3.1 3.1 6.2 2.4 9.2-.8" />
      <path d="M7 15.5V9.5" />
      <path d="M7 12.5H5v-2M7 11.5h2v-1.8" />
    </StrokeIcon>
  );
}

export function SeaIcon({ className = "h-4 w-4 shrink-0", label }: IconProperties) {
  return (
    <StrokeIcon className={className} label={label}>
      <path d="M2.5 9.5c2-1.8 4-1.8 6 0s4 1.8 6 0 4-1.8 6 0" />
      <path d="M2.5 15c2-1.8 4-1.8 6 0s4 1.8 6 0 4-1.8 6 0" />
    </StrokeIcon>
  );
}

export function FogIcon({ className = "h-4 w-4 shrink-0", label }: IconProperties) {
  return (
    <StrokeIcon className={className} label={label}>
      <path d="M6.5 15.5h11a3.5 3.5 0 0 0 .5-6.95 5 5 0 0 0-9.6-1.35A3.8 3.8 0 0 0 6.5 15.5Z" />
      <path d="M4.5 19h15" />
    </StrokeIcon>
  );
}
