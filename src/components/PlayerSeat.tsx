import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { CardTypeIcon, DevelopmentCardIcon, getPlayerLabel, IslandIcon, PieceIcon } from "./GameUi";
import { DisconnectedIcon, LargestArmyIcon, LongestRoadAwardIcon } from "./Icons";
import { useTranslation } from "../localization";
import { gameplayTranslations } from "../translations/gameplay";
import { isSeafarers, type GameVariant } from "../game/types";

export { DisconnectedIcon };

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
  const displayedScore = privateScore ?? player.score;
  const previousStatsReference = useRef<{
    resourceCount: number;
    developmentCount: number;
    knightsPlayed: number;
    longestRoad: number;
    score: number;
    largestArmy: boolean;
    longestRoadAward: boolean;
    islandBonus: number;
  } | null>(null);
  const [statGenerations, setStatGenerations] = useState({
    resourceCount: 0,
    developmentCount: 0,
    knightsPlayed: 0,
    longestRoad: 0,
    score: 0,
    largestArmy: 0,
    longestRoadAward: 0,
    islandBonus: 0,
  });

  useEffect(() => {
    const previous = previousStatsReference.current;
    if (previous) {
      const resourceChanged = player.resourceCount !== previous.resourceCount;
      const developmentChanged = player.developmentCount !== previous.developmentCount;
      const knightsChanged = player.knightsPlayed !== previous.knightsPlayed;
      const roadChanged = player.longestRoad !== previous.longestRoad;
      const scoreChanged = displayedScore !== previous.score;
      const armyGained = largestArmy && !previous.largestArmy;
      const roadAwardGained = longestRoadAward && !previous.longestRoadAward;
      const islandGained = islandBonus > previous.islandBonus;
      if (resourceChanged || developmentChanged || knightsChanged || roadChanged || scoreChanged || armyGained || roadAwardGained || islandGained) {
        setStatGenerations(current => ({
          resourceCount: current.resourceCount + (resourceChanged ? 1 : 0),
          developmentCount: current.developmentCount + (developmentChanged ? 1 : 0),
          knightsPlayed: current.knightsPlayed + (knightsChanged ? 1 : 0),
          longestRoad: current.longestRoad + (roadChanged ? 1 : 0),
          score: current.score + (scoreChanged ? 1 : 0),
          largestArmy: current.largestArmy + (armyGained ? 1 : 0),
          longestRoadAward: current.longestRoadAward + (roadAwardGained ? 1 : 0),
          islandBonus: current.islandBonus + (islandGained ? 1 : 0),
        }));
      }
    }
    previousStatsReference.current = {
      resourceCount: player.resourceCount,
      developmentCount: player.developmentCount,
      knightsPlayed: player.knightsPlayed,
      longestRoad: player.longestRoad,
      score: displayedScore,
      largestArmy,
      longestRoadAward,
      islandBonus,
    };
  }, [player.resourceCount, player.developmentCount, player.knightsPlayed, player.longestRoad, displayedScore, largestArmy, longestRoadAward, islandBonus]);

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
          <CardTypeIcon kind="resource" /><strong key={statGenerations.resourceCount} className={statGenerations.resourceCount > 0 ? "stat-bump" : undefined}>{player.resourceCount}</strong>
        </span>
        <span role="img" aria-label={translateText("{count} development cards", { count: player.developmentCount })} title={translateText("{count} development cards", { count: player.developmentCount })} className="player-card-stat text-[#947231]">
          <CardTypeIcon kind="development" /><strong key={statGenerations.developmentCount} className={statGenerations.developmentCount > 0 ? "stat-bump" : undefined}>{player.developmentCount}</strong>
        </span>
        <span role="img" aria-label={knightLabel} title={knightLabel} className="player-card-stat text-[#497562]">
          <DevelopmentCardIcon kind="knight" /><strong key={statGenerations.knightsPlayed} className={statGenerations.knightsPlayed > 0 ? "stat-bump" : undefined}>{player.knightsPlayed}</strong>
        </span>
        <span role="img" aria-label={roadLabel} title={roadLabel} className="player-card-stat text-[#497562]">
          <PieceIcon piece="road" /><strong key={statGenerations.longestRoad} className={statGenerations.longestRoad > 0 ? "stat-bump" : undefined}>{player.longestRoad}</strong>
        </span>
      </div>
      <div role="group" aria-label={translateText("{player}'s victory points", { player: player.name })} className={`player-score col-start-3 row-start-1 flex shrink-0 items-center justify-end gap-1 text-right ${leading ? "text-[#8b6425]" : ""}`}>
        <span className="text-[9px] text-muted">{translateText("VP")}</span>
        <span key={statGenerations.score} className={`font-serif text-2xl ${statGenerations.score > 0 ? "stat-bump" : ""}`}>{displayedScore}</span>
        {(largestArmy || longestRoadAward || islandBonus > 0) && <div role="group" aria-label={translateText("Victory point awards")} className="ml-1.5 flex shrink-0 items-center gap-2.5">
          {islandBonus > 0 && <span key={`island-${statGenerations.islandBonus}`} role="img" aria-label={islandLabel} title={islandLabel} className={`flex shrink-0 items-end gap-px text-[#b58a2d] ${statGenerations.islandBonus > 0 ? "award-badge-enter" : ""}`}><IslandIcon className="shrink-0" /><strong className="translate-y-0.5 text-[10px] font-bold leading-none tabular-nums">{islandCount}</strong></span>}
          {largestArmy && <LargestArmyIcon key={`army-${statGenerations.largestArmy}`} label={translateText("Largest Army (+2 victory points)")} className={`shrink-0 text-[#b58a2d] ${statGenerations.largestArmy > 0 ? "award-badge-enter" : ""}`} />}
          {longestRoadAward && <span key={`road-${statGenerations.longestRoadAward}`} role="img" aria-label={translateText(isSeafarers(variant) ? "Longest Route (+2 victory points)" : "Longest Road (+2 victory points)")} title={translateText(isSeafarers(variant) ? "Longest Route (+2 victory points)" : "Longest Road (+2 victory points)")} className={`shrink-0 text-[#b58a2d] ${statGenerations.longestRoadAward > 0 ? "award-badge-enter" : ""}`}><LongestRoadAwardIcon className="shrink-0" /></span>}
        </div>}
      </div>
      {badge && <div className="player-seat-badge col-start-3 row-start-2 flex shrink-0 items-center justify-end gap-1.5">{badge}</div>}
    </div>
  </div>;
}
