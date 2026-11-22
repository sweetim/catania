import { type CSSProperties, type ReactNode } from "react";
import { CardTypeIcon, DevelopmentCardIcon, getPlayerLabel, IslandIcon, PieceIcon } from "./GameUi";
import { useTranslation } from "../localization";
import { gameplayTranslations } from "../translations/gameplay";
import { isSeafarers, type GameVariant } from "../game/types";

export function DisconnectedIcon({ className = "h-3.5 w-3.5 shrink-0" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.1"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 2 22 22" />
      <path d="M8.5 16.5a5 5 0 0 1 7 0" />
      <path d="M5 12.86a10 10 0 0 1 5.17-2.69" />
      <path d="M19 12.86a10 10 0 0 0-2.01-1.52" />
      <path d="M2 8.82a15 15 0 0 1 4.18-2.64" />
      <path d="M22 8.82a15 15 0 0 0-11.29-3.76" />
      <circle cx="12" cy="20" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function PlayerSeat({ player, number, active, leading, largestArmy, longestRoadAward, islandBonus = 0, stacked = false, privateScore, variant = "original", badge, disconnected = false }: {
  variant?: GameVariant;
  player: { name: string; color: string; control: "human" | "computer"; resourceCount: number; developmentCount: number; knightsPlayed: number; longestRoad: number; score: number };
  number: number;
  active: boolean;
  leading: boolean;
  largestArmy: boolean;
  longestRoadAward: boolean;
  islandBonus?: number;
  stacked?: boolean;
  privateScore?: number;
  badge?: ReactNode;
  disconnected?: boolean;
}) {
  const translateText = useTranslation(gameplayTranslations);
  const knightLabel = translateText(player.knightsPlayed === 1 ? "{count} knight played" : "{count} knights played", { count: player.knightsPlayed });
  const roadLabel = translateText(isSeafarers(variant) ? "{count} connected roads and ships" : player.longestRoad === 1 ? "{count} connected road" : "{count} connected roads", { count: player.longestRoad });
  const islandCount = islandBonus / 2;
  const islandLabel = translateText(islandCount === 1 ? "Island bonus: {count} island (+{points} victory points)" : "Island bonus: {count} islands (+{points} victory points)", { count: islandCount, points: islandBonus });
  const useTwoRowGrid = stacked || Boolean(badge);

  return <div
    data-disconnected={disconnected ? "true" : undefined}
    style={{ "--seat-pulse-color": disconnected ? "#bb6549" : player.color } as CSSProperties}
    className={`player-seat min-w-0 rounded-xl border px-4 py-3 ${
      disconnected
        ? `player-seat-disconnected ${active ? "player-seat-active" : ""}`
        : active
          ? "player-seat-active border-forest/40 bg-moss/80"
          : "border-line bg-white/30"
    } ${leading && !disconnected ? "player-seat-leading" : ""}`}
  >
    <div className={useTwoRowGrid ? "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1" : "flex items-center gap-2.5"}>
      <span className={`player-number relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${badge ? "row-span-2" : ""}`} style={{ backgroundColor: player.color }}>
        <span className={disconnected ? "opacity-75" : undefined}>{getPlayerLabel(player, number)}</span>
        {disconnected && (
          <span aria-hidden="true" className="player-disconnected-dot">
            <DisconnectedIcon className="h-2.5 w-2.5" />
          </span>
        )}
      </span>
      <p className="player-name min-w-0 flex-1 truncate text-sm font-semibold" title={player.name}>{player.name}</p>
      {disconnected && (
        <span role="status" className="player-disconnected-pill">
          <DisconnectedIcon className="h-3 w-3 shrink-0" />
          <span className="player-disconnected-label" aria-hidden="true">{translateText("Disconnected")}</span>
          <span className="sr-only">{translateText("{name} disconnected", { name: player.name })}</span>
        </span>
      )}
      <div role="group" aria-label={translateText("{player}'s card counts", { player: player.name })} className={`player-card-counts ${useTwoRowGrid ? badge ? "col-start-2 row-start-2" : "col-span-2 col-start-2 row-start-2" : ""}`}>
        <span role="img" aria-label={translateText("{count} resource cards", { count: player.resourceCount })} title={translateText("{count} resource cards", { count: player.resourceCount })} className="player-card-stat text-[#497562]">
          <CardTypeIcon kind="resource" /><strong>{player.resourceCount}</strong>
        </span>
        <span role="img" aria-label={translateText("{count} development cards", { count: player.developmentCount })} title={translateText("{count} development cards", { count: player.developmentCount })} className="player-card-stat text-[#947231]">
          <CardTypeIcon kind="development" /><strong>{player.developmentCount}</strong>
        </span>
        <span role="img" aria-label={knightLabel} title={knightLabel} className="player-card-stat text-[#497562]">
          <DevelopmentCardIcon kind="knight" /><strong>{player.knightsPlayed}</strong>
        </span>
        <span role="img" aria-label={roadLabel} title={roadLabel} className="player-card-stat text-[#497562]">
          <PieceIcon piece="road" /><strong>{player.longestRoad}</strong>
        </span>
      </div>
      <div role="group" aria-label={translateText("{player}'s victory points", { player: player.name })} className={`player-score col-start-3 row-start-1 flex shrink-0 items-center justify-end gap-1 text-right ${leading ? "text-[#8b6425]" : ""}`}>
        <span className="text-[9px] text-muted">{translateText("VP")}</span>
        <span className="font-serif text-2xl">{privateScore ?? player.score}</span>
        {(largestArmy || longestRoadAward || islandBonus > 0) && <div role="group" aria-label={translateText("Victory point awards")} className="ml-1.5 flex shrink-0 items-center gap-2.5">
          {islandBonus > 0 && <span role="img" aria-label={islandLabel} title={islandLabel} className="flex shrink-0 items-end gap-px text-[#b58a2d]"><IslandIcon className="shrink-0" /><strong className="translate-y-0.5 text-[10px] font-bold leading-none tabular-nums">{islandCount}</strong></span>}
          {largestArmy && <svg role="img" aria-label={translateText("Largest Army (+2 victory points)")} viewBox="0 0 24 28" className="shrink-0 text-[#b58a2d]" fill="none">
            <title>{translateText("Largest Army (+2 victory points)")}</title>
            <path d="m3 3 5 2 11 13-3 3L5 8 3 3Zm18 0-5 2L5 18l3 3L19 8l2-5Z" fill="currentColor" />
            <path d="m13 21 7-6M4 15l7 6m6 0 3 4M7 21l-3 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>}
          {longestRoadAward && <span role="img" aria-label={translateText(isSeafarers(variant) ? "Longest Route (+2 victory points)" : "Longest Road (+2 victory points)")} title={translateText(isSeafarers(variant) ? "Longest Route (+2 victory points)" : "Longest Road (+2 victory points)")} className="shrink-0 text-[#b58a2d]"><PieceIcon piece="road" /></span>}
        </div>}
      </div>
      {badge && <div className="player-seat-badge col-start-3 row-start-2 flex shrink-0 items-center justify-end gap-1.5">{badge}</div>}
    </div>
  </div>;
}
