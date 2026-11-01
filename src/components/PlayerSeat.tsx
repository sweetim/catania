import { type CSSProperties } from "react";
import { CardTypeIcon, DevelopmentCardIcon, PieceIcon } from "./GameUi";
import { useTranslation } from "../localization";
import { gameplayTranslations } from "../translations/gameplay";

export function PlayerSeat({ player, number, active, leading, largestArmy, longestRoadAward, detailed = false, stacked = detailed, privateScore }: {
  player: { name: string; color: string; resourceCount: number; developmentCount: number; knightsPlayed: number; longestRoad: number; score: number };
  number: number;
  active: boolean;
  leading: boolean;
  largestArmy: boolean;
  longestRoadAward: boolean;
  detailed?: boolean;
  stacked?: boolean;
  privateScore?: number;
}) {
  const translateText = useTranslation(gameplayTranslations);
  const knightLabel = translateText(player.knightsPlayed === 1 ? "{count} knight played" : "{count} knights played", { count: player.knightsPlayed });
  const roadLabel = translateText(player.longestRoad === 1 ? "{count} connected road" : "{count} connected roads", { count: player.longestRoad });

  return <div style={{ "--seat-pulse-color": player.color } as CSSProperties} className={`player-seat min-w-0 rounded-xl border px-4 py-3 ${active ? "player-seat-active border-forest/40 bg-moss/80" : "border-line bg-white/30"} ${leading ? "player-seat-leading" : ""}`}>
    <div className={stacked ? "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1" : "flex items-center gap-2.5"}>
      <span className="player-number flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white" style={{ background: player.color }}>{number}</span>
      <p className="player-name min-w-0 flex-1 truncate text-sm font-semibold" title={player.name}>{player.name}</p>
      <div role="group" aria-label={translateText("{player}'s card counts", { player: player.name })} className={`player-card-counts ${detailed ? "player-card-counts-detailed" : ""} ${stacked ? "col-span-2 col-start-2 row-start-2" : ""}`}>
        <span role="img" aria-label={translateText("{count} resource cards", { count: player.resourceCount })} title={translateText("{count} resource cards", { count: player.resourceCount })} className="player-card-stat text-forest">
          <CardTypeIcon kind="resource" /><strong>{player.resourceCount}</strong>
          {detailed && <span className="text-[10px] text-muted">{translateText("resources")}</span>}
        </span>
        <span role="img" aria-label={translateText("{count} development cards", { count: player.developmentCount })} title={translateText("{count} development cards", { count: player.developmentCount })} className="player-card-stat text-[#947231]">
          <CardTypeIcon kind="development" /><strong>{player.developmentCount}</strong>
          {detailed && <span className="text-[10px] text-muted">{translateText("development")}</span>}
        </span>
        <span role="img" aria-label={knightLabel} title={knightLabel} className="player-card-stat text-forest">
          <DevelopmentCardIcon kind="knight" /><strong>{player.knightsPlayed}</strong>
        </span>
        <span role="img" aria-label={roadLabel} title={roadLabel} className="player-card-stat text-forest">
          <PieceIcon piece="road" /><strong>{player.longestRoad}</strong>
        </span>
      </div>
      <div role="group" aria-label={translateText("{player}'s victory points", { player: player.name })} className={`player-score col-start-3 row-start-1 flex shrink-0 items-center gap-1 text-right ${leading ? "text-[#8b6425]" : ""}`}>
        <span className="font-serif text-2xl">{player.score}</span>
        <span className="text-[9px] text-muted">{translateText("VP")}{privateScore !== undefined && privateScore !== player.score && <span className="block whitespace-nowrap">{translateText("{count} total", { count: privateScore })}</span>}</span>
        {(largestArmy || longestRoadAward) && <div role="group" aria-label={translateText("Victory point awards")} className="ml-1.5 flex shrink-0 items-center gap-2.5">
          {largestArmy && <svg role="img" aria-label={translateText("Largest Army (+2 victory points)")} viewBox="0 0 24 28" className="shrink-0 text-[#b58a2d]" fill="none">
            <title>{translateText("Largest Army (+2 victory points)")}</title>
            <path d="m3 3 5 2 11 13-3 3L5 8 3 3Zm18 0-5 2L5 18l3 3L19 8l2-5Z" fill="currentColor" />
            <path d="m13 21 7-6M4 15l7 6m6 0 3 4M7 21l-3 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>}
          {longestRoadAward && <span role="img" aria-label={translateText("Longest Road (+2 victory points)")} title={translateText("Longest Road (+2 victory points)")} className="shrink-0 text-[#b58a2d]"><PieceIcon piece="road" /></span>}
        </div>}
      </div>
    </div>
    {detailed && <div className="player-awards mt-3 border-t border-line pt-3 text-xs leading-6"><p>{roadLabel}</p></div>}
  </div>;
}
