import { match } from "ts-pattern";
import type { Resource, Terrain } from "../game/types";
import type { BoardTheme } from "../themes";

export function ResourceArtwork({
  resource,
  theme,
  compact = false,
}: {
  resource: Resource;
  theme: BoardTheme;
  compact?: boolean;
}) {
  return (
    <g fill="none" stroke="currentColor" strokeWidth={compact ? "1.9" : "1.5"} strokeLinecap="round" strokeLinejoin="round">
      {match(theme.id)
        .with("illustrated", () => match(resource)
          .with("wood", () => <>
            <path d="M16 3 7 15.5h4.5L5.5 24h21l-6-8.5H25L16 3Z" fill="currentColor" stroke="none" />
            <path d="M16 23v6.5" strokeWidth="3.2" />
          </>)
          .with("brick", () => <>
            <rect x="8.5" y="6" width="15" height="6.2" rx="1.4" fill="currentColor" stroke="none" />
            <rect x="3" y="13.9" width="12.2" height="6.2" rx="1.4" fill="currentColor" stroke="none" />
            <rect x="16.8" y="13.9" width="12.2" height="6.2" rx="1.4" fill="currentColor" stroke="none" />
            <rect x="5.5" y="21.8" width="12.2" height="6.2" rx="1.4" fill="currentColor" stroke="none" />
            <rect x="19.3" y="21.8" width="7.2" height="6.2" rx="1.4" fill="currentColor" stroke="none" opacity=".78" />
          </>)
          .with("wool", () => <>
            <path d="M7.5 23.5a5.2 5.2 0 0 1-2-9.8 5.6 5.6 0 0 1 9.8-5 5.8 5.8 0 0 1 9.6 4.8 4.8 4.8 0 0 1-1.6 10H7.5Z" fill="currentColor" stroke="none" />
            <path d="M10.5 23v5.5m9-5.5v5.5" strokeWidth="2.8" />
            <ellipse cx="25.5" cy="18.2" rx="3.4" ry="4" fill="currentColor" stroke="none" />
            <path d="M23.2 14.8 21.5 13m6 2 1.8-1" strokeWidth="1.8" />
          </>)
          .with("grain", () => <>
            <path d="M16 5v24.5" strokeWidth="2" />
            {[7, 13, 19].map((position) => (
              <g key={position} fill="currentColor" stroke="none">
                <path d={`M16 ${position + 6.5}Q4.5 ${position + 4.5} 6.5 ${position - 1}Q15 ${position} 16 ${position + 6.5}`} />
                <path d={`M16 ${position + 6.5}Q27.5 ${position + 4.5} 25.5 ${position - 1}Q17 ${position} 16 ${position + 6.5}`} />
              </g>
            ))}
          </>)
          .with("ore", () => <>
            <path d="m3 24 7.5-16.5L21 4l8 19.5-13.5 5.5L3 24Z" fill="currentColor" stroke="none" />
            <path d="m10.5 7.5 5 21.5L21 4" stroke="currentColor" strokeOpacity=".22" strokeWidth="1.6" />
            <path d="m10.5 7.5 5 21.5L21 4" stroke="white" strokeOpacity=".5" strokeWidth="1.4" />
            <path d="m3 24 12.5-6.5L29 23.5" stroke="white" strokeOpacity=".35" strokeWidth="1.2" />
          </>)
          .exhaustive())
        .with("ceramic", () => match(resource)
          .with("wood", () => <>
            <path d="M16 28V7M16 19 8 12m8 3 8-8" strokeWidth="2" />
            <path d="M15 15C3 17 3 7 5 5c7 0 10 4 10 10Zm3-2C17 4 23 2 27 3c1 7-2 10-9 10ZM15 23C6 25 3 20 4 16c7-2 11 1 11 7Zm3-2c0-7 5-9 10-8 0 6-4 10-10 8Z" fill="currentColor" stroke="none" />
            {!compact && <path d="M10 29q6-3 12 0M7 7l5 5m9-2 3-4" />}
          </>)
          .with("brick", () => <>
            <path d="M4 15h24v12H4Zm4-9h16v9H8Zm8 9v12M12 6v9m8 0V6" strokeWidth="2" />
            {!compact && <><path d="m7 19 3-2 3 2-3 3Zm12 0 3-2 3 2-3 3Z" fill="currentColor" stroke="none" /><path d="M5 29h22M11 3h10" /></>}
          </>)
          .with("wool", () => <>
            <path d="M7 22c-6-3-5-9 0-10-1-6 7-8 10-4 6-3 11 2 8 7 4 6-2 10-6 8-4 4-9 3-12-1Z" fill="currentColor" fillOpacity={compact ? ".24" : ".14"} strokeWidth="2" />
            <path d="M9 23v5m10-4v4m3-14q9-3 7 5l-5 3-3-3" />
            {!compact && <><path d="M9 14c-4 4 3 7 5 3s-5-6-5-1m5-7q5 0 4 5" /><circle cx="26" cy="16" r=".8" fill="currentColor" stroke="none" /><path d="M3 29h24" /></>}
          </>)
          .with("grain", () => <>
            <path d="M16 29V4M12 29l8-1" strokeWidth="2" />
            <path d="M15 12C7 12 5 8 6 4c7 0 10 4 9 8Zm2 5c0-7 4-10 10-10 0 6-4 10-10 10Zm-2 6c-8 0-11-4-10-9 6 0 10 3 10 9Zm2 3c0-6 4-9 10-8 0 5-4 9-10 8Z" fill="currentColor" stroke="none" />
            {!compact && <path d="M2 29h5m17 0h5" />}
          </>)
          .with("ore", () => <>
            <path d="M4 23 10 8l9-4 9 18-12 7Z" strokeWidth="2" />
            <path d="m10 8 6 21 3-25M4 23l12-4 12 3" />
            {!compact && <><path d="m10 8 7 6 7-1" /><path d="m8 20 2-5 3 8Zm12-5 4 5-6 4Z" fill="currentColor" stroke="none" /></>}
          </>)
          .exhaustive())
        .with("wooden", () => match(resource)
          .with("wood", () => <>
            <path d="m5 12 12-7c9-4 17 10 8 15l-12 7Z" fill="currentColor" fillOpacity={compact ? ".2" : ".12"} strokeWidth={compact ? "2" : "1.5"} />
            <ellipse cx="10" cy="20" rx="5.5" ry="7.5" transform="rotate(-29 10 20)" strokeWidth="2" />
            <ellipse cx="10" cy="20" rx="2.5" ry="4" transform="rotate(-29 10 20)" />
            {!compact && <path d="m13 12 7-4m-4 7 8-5m-6 8 9-5m-8 9 10-6M4 18l6-3m-5 9 7-4" />}
          </>)
          .with("brick", () => <>
            <path d="m3 15 16-9 10 6v11l-16 7L3 24Z" strokeWidth="2" />
            <path d="m3 15 10 7 16-10M13 22v8" />
            {!compact && <path d="m6 23 4 3m-4-7 4 3m6 2 3-2m0 5 3-2m0-5 4-2M9 14l10-5m-6 8 10-5" />}
          </>)
          .with("wool", () => <>
            <path d="M5 21c-5-4-1-10 3-9-1-6 7-7 10-3 8-3 12 4 8 9 1 7-7 9-10 6-3 4-10 3-11-3Z" fill="currentColor" fillOpacity={compact ? ".18" : "0"} strokeWidth="2" />
            <path d="M8 26v3m11-4v4m5-14 6 1-2 7-5-2" />
            {!compact && <path d="m7 16 5-4m-7 9 13-10M9 23l12-10m-6 11 7-6m-12-5 8 10m-3-12 6 8" />}
          </>)
          .with("grain", () => <>
            <path d="M15 29 18 4M11 29l-2-16m11 15 7-12M16 11 10 5l-1 6 7 5m1-7 7-5 1 5-9 7m-1 4-9-7 1 7 7 5m2-7 10-7-1 7-11 7M11 27l9 1" strokeWidth="1.8" />
            {!compact && <path d="m12 9 3 3m4-2 3-3M10 19l3 3m5-1 4-3" />}
          </>)
          .with("ore", () => <>
            <path d="m3 24 7-15 12-4 7 16-13 8Z" strokeWidth="2" />
            <path d="m10 9 6 20 6-24M3 24l10-4m7 3 9-2" />
            {!compact && <path d="m7 17 5-4m-7 9 9-6m-6 9 7-6m9-8-3 4m5 1-7 6m5 3-5-2" />}
          </>)
          .exhaustive())
        .with("pixel", () => (
          <g fill="currentColor" stroke="none" shapeRendering="crispEdges">
            {match(resource)
              .with("wood", () => <><path d="M14 2h4v4h4v6h4v6h4v8H2v-8h4v-6h4V6h4Z" /><path d="M14 26h4v6h-4Z" /><path d="M10 12h4v4h-4Zm-4 8h8v4H6Zm8-14h4v4h-4Z" fillOpacity=".35" fill="white" /></>)
              .with("brick", () => <><path d="M2 18h12v10H2Zm16 0h12v10H18ZM8 6h16v8H8Z" /><path d="M4 20h8v2H4Zm16 0h8v2h-8ZM10 8h12v2H10Z" fill="white" fillOpacity=".35" /></>)
              .with("wool", () => <><path d="M8 6h14v4h4v4h4v8h-8v4H6v-4H2V10h6ZM6 26h4v4H6Zm12 0h4v4h-4Z" /><path d="M10 10h10v4h-6v6H6v-6h4Zm14 6h2v2h-2Z" fill="white" fillOpacity=".65" /></>)
              .with("grain", () => <><path d="M14 2h4v28h-4ZM4 6h6v4h4v6h-4v-4H4Zm18 0h6v6h-6v4h-4v-6h4ZM4 18h6v4h4v6h-4v-4H4Zm18 0h6v6h-6v4h-4v-6h4Z" /><path d="M14 4h2v24h-2Z" fill="white" fillOpacity=".35" /></>)
              .with("ore", () => <><path d="M12 4h12v6h4v8h4v8h-8v4H8v-4H2V16h4v-6h6Z" /><path d="M12 10h6v6h-6Zm-6 8h6v6H6Zm14-12h4v10h-4Z" fill="white" fillOpacity=".4" /></>)
              .exhaustive()}
          </g>
        ))
        .with("space", () => (
          <>
            {match(resource)
              .with("wood", () => <>
                <path d="M16 4 7 15h4l-5 8h20l-5-8h4L16 4Z" fill="currentColor" fillOpacity=".22" strokeWidth="2" />
                <path d="M16 11v17" strokeWidth="2.2" />
                <path d="M6 28h20" strokeWidth="2" />
                {!compact && <path d="M10 28v3m12-3v3M5 7h4M7 5v4" />}
              </>)
              .with("brick", () => <>
                <path d="M5 9h22l3 5v13H2V14Z" strokeWidth="2" />
                <path d="M7 14h18v9H7Zm9 0v9M7 18h18" strokeWidth="1.8" />
                {!compact && <><path d="M11 5h10M16 2v3M9 30h14" /><circle cx="5" cy="25" r="1" fill="currentColor" stroke="none" /><circle cx="27" cy="25" r="1" fill="currentColor" stroke="none" /></>}
              </>)
              .with("wool", () => <>
                <path d="M7 22c-5-2-4-7 0-8-1-5 6-7 9-3 6-3 11 2 8 7 2 5-4 8-7 5-3 3-7 2-10-1Z" fill="currentColor" fillOpacity=".24" strokeWidth="2" />
                <path d="M10 23v5m9-5v5m4-11 5 1-1 5-4-1" strokeWidth="1.8" />
                {!compact && <path d="M4 12a12 12 0 0 1 24 0" strokeOpacity=".55" />}
              </>)
              .with("grain", () => <>
                <path d="M5 26V11L10 4h12l5 7v15Z" strokeWidth="2" />
                <path d="M12 24V10m0 8-4-4m4 1 4-4m4 13V10m0 9 4-4m-4 1-4-4" strokeWidth="1.9" />
                <path d="M3 28h26" strokeWidth="2" />
                {!compact && <path d="M5 11h22" strokeOpacity=".55" />}
              </>)
              .with("ore", () => <>
                <path d="m4 23 5-12 8-3 8 14-10 7Z" fill="currentColor" fillOpacity=".22" strokeWidth="2" />
                <path d="m9 11 6 18 2-21M4 23l11-5 10 4" strokeWidth="1.8" />
                {!compact && <><path d="M21 3h8v5h-8Zm4 5v8l-4 3" /><circle cx="26" cy="26" r="2" /></>}
              </>)
              .exhaustive()}
          </>
        ))
        .with("underwater", () => (
          <>
            {match(resource)
              .with("wood", () => <>
                <path d="M16 28V6M16 22c-5-1-8-5-8-10M16 17c5-1 8-5 8-10" strokeWidth="2.4" />
                <path d="M8 12c-3 0-4-3-2-5M24 7c3 0 4 3 2 5M16 6c-2-2 0-4 2-3" strokeWidth="1.8" />
                <path d="M6 28h20" strokeWidth="2" />
                {!compact && <circle cx="27" cy="18" r="2" />}
              </>)
              .with("brick", () => <>
                <path d="M4 17h24v11H4Zm4-8h16v9H8Zm8 9v11M16 9v8" strokeWidth="2" />
                {!compact && <><path d="M6 21h7m6 0h7M2 30h28" /><circle cx="27" cy="5" r="2.2" /><circle cx="5" cy="5" r="1.4" /></>}
              </>)
              .with("wool", () => <>
                <path d="M7 22c-5-2-5-7-1-8-1-5 6-7 8-3 6-3 10 2 7 7 3 4-3 8-6 5-3 3-6 2-8-1Z" fill="currentColor" fillOpacity=".24" strokeWidth="2" />
                <path d="M10 23v5m8-5v5m4-11h5v5h-5" strokeWidth="1.8" />
                {!compact && <><circle cx="27" cy="4" r="2" /><circle cx="5" cy="6" r="1.4" /></>}
              </>)
              .with("grain", () => <>
                <path d="M11 28c-2-8 2-15 0-23M16 28c2-8-2-15 0-24M21 28c-2-8 2-14 0-21" strokeWidth="2.2" />
                <path d="M11 18l-5-3M16 14l5-3M21 19l5-3M11 11l-4-3" strokeWidth="1.8" />
                <path d="M5 29h22" strokeWidth="2" />
                {!compact && <><circle cx="4" cy="5" r="1.8" /><circle cx="27" cy="7" r="1.5" /></>}
              </>)
              .with("ore", () => <>
                <path d="m5 24 6-14 9-2 8 16-12 5Z" fill="currentColor" fillOpacity=".2" strokeWidth="2" />
                <path d="m11 10 5 19 4-21M5 24l11-6 12 6" strokeWidth="1.8" />
                {!compact && <><circle cx="6" cy="6" r="2" /><circle cx="26" cy="4" r="1.5" /><path d="M3 30h26" /></>}
              </>)
              .exhaustive()}
          </>
        ))
        .exhaustive()}
    </g>
  );
}

export const HEX_ARTWORK_CLIP_PATH = "M0-56.5 48.9-28.25v56.5L0 56.5-48.9 28.25v-56.5Z";

function IllustratedConifer({ horizontal, vertical, scale }: { horizontal: number; vertical: number; scale: number }) {
  return (
    <g transform={`translate(${horizontal} ${vertical}) scale(${scale})`} strokeLinejoin="round">
      <path d="M0 10V20" stroke="#4d3d2e" strokeWidth="2.4" />
      <path d="M0-21 9-8H4.5L12 2H6.5L14 11H-14L-6.5 2H-12L-4.5-8H-9Z" fill="#3a614b" stroke="#28493a" strokeWidth="1.25" />
      <path d="M0-21V11H-14L-6.5 2H-12L-4.5-8H-9Z" fill="#547f60" stroke="none" />
    </g>
  );
}

function IllustratedSheep({ horizontal, vertical, scale, mirror = false }: {
  horizontal: number;
  vertical: number;
  scale: number;
  mirror?: boolean;
}) {
  const horizontalScale = mirror ? -scale : scale;
  return (
    <g transform={`translate(${horizontal} ${vertical}) scale(${horizontalScale} ${scale})`} stroke="#58693f" strokeWidth="1.35" strokeLinejoin="round">
      <ellipse cx="0" cy="11" rx="11" ry="2.6" fill="#637841" fillOpacity=".3" stroke="none" />
      <path d="M-6 5V10.5M5 5V10.5" fill="none" strokeWidth="2.1" />
      <path d="M-11 0C-15-6-9-11-4-9C-2-14 5-13 7-9C13-10 16-3 11 1C14 7 7 10 3 6C-2 10-9 8-9 4C-14 5-15 1-11 0Z" fill="#fbf7e6" />
      <path d="M-9-2C-6-7 2-8 7-5" fill="none" stroke="#ffffff" strokeOpacity=".6" strokeWidth="1.1" />
      <ellipse cx="10.5" cy="1" rx="4.2" ry="5" fill="#596647" />
      <path d="M8.5-3.5 6-6.2M13-2.8 16-4.5" strokeWidth="1.3" />
      <circle cx="11.6" cy="0" r=".8" fill="#fbf7e6" stroke="none" />
    </g>
  );
}

function IllustratedWheatCluster({ horizontal, vertical, mirror = false }: {
  horizontal: number;
  vertical: number;
  mirror?: boolean;
}) {
  return (
    <g transform={`translate(${horizontal} ${vertical}) scale(${mirror ? -1 : 1} 1)`} stroke="#876120" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M0 4Q-7-14-3-34M3 5Q-1-12 7-28M-3 5Q-12-9-11-24" fill="none" strokeWidth="1.5" />
      {[
        { originX: -4, originY: -12, tilt: -22 },
        { originX: -5, originY: -20, tilt: -16 },
        { originX: -4, originY: -28, tilt: -8 },
        { originX: 3, originY: -14, tilt: 16 },
        { originX: 6, originY: -22, tilt: 22 },
        { originX: -10, originY: -16, tilt: -30 },
      ].map((grain, index) => (
        <g key={index} transform={`translate(${grain.originX} ${grain.originY}) rotate(${grain.tilt})`}>
          <path d="M0 0Q-4.5-2.5-3.5-7Q1-5.5 0 0Z" fill="#f7e09b" />
          <path d="M0-1Q4.5-3.5 3.5-8Q-1-6.5 0-1Z" fill="#d9aa43" />
        </g>
      ))}
    </g>
  );
}

export function TerrainArtwork({ terrain, theme, clipPathId }: {
  terrain: Terrain;
  theme: BoardTheme;
  clipPathId?: string;
}) {
  const ink = theme.terrain[terrain].ink;
  const clipPath = clipPathId ? `url(#${clipPathId})` : undefined;
  if (terrain === "fog") {
    const cloud = "M-38 12 A13 13 0 0 1 -36 -12 A15 15 0 0 1 -8 -22 A15 15 0 0 1 20 -14 A13 13 0 0 1 34 2 A10 10 0 0 1 26 12 Z";
    return <g aria-hidden="true" pointerEvents="none" clipPath={clipPath} fill="none" stroke={ink} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {match(theme.id)
        .with("illustrated", () => <>
          <path d="M-52-58H52V-8Q0-18-52-8Z" fill="#e5edf0" fillOpacity=".5" stroke="none" />
          <path d="M-52 8Q-34-12-10-6Q12-22 36-10Q46-4 52-10V58H-52Z" fill="#dde7ea" fillOpacity=".62" stroke="none" />
          <path d={cloud} transform="translate(20 -15) scale(.46)" fill="#f7faf9" fillOpacity=".62" stroke="none" />
          <path d={cloud} transform="translate(-22 10) scale(.52)" fill="#f7faf9" fillOpacity=".52" stroke="none" />
          <path d={cloud} fill="#f7faf9" fillOpacity=".86" stroke={ink} strokeOpacity=".38" strokeWidth="1.4" />
          <path d="M-24 6Q-8 0 8 6T32 4M-36 22Q-12 15 12 22T42 20" strokeOpacity=".34" strokeWidth="1.4" />
          <path d="M0-39v7M-3.5-35.5h7M26-30v5M23.5-27.5h5" stroke="#f8fbfa" strokeOpacity=".85" strokeWidth="1.3" />
        </>)
        .with("ceramic", () => <>
          <path d={cloud} transform="translate(-24 -6) scale(.38)" strokeWidth="2" opacity=".65" />
          <path d={cloud} strokeWidth="3" />
          <path d="M-41 17h7M-31 20h4" />
          <path d="m38-22 4-4 4 4-4 4Z" />
        </>)
        .with("wooden", () => <>
          <path d={cloud} />
          <path d="M-32 6Q-16 -2 0 6T32 5M-25 -1Q-13 -7 0 -1T25 -2" opacity=".7" />
          <path d="m-34-16 5-4m-1 9 5-4M28-13l5-4" opacity=".5" />
        </>)
        .with("pixel", () => <g fill={ink} stroke="none" shapeRendering="crispEdges">
          <path d="M-44 4h88v11h-88Z" fillOpacity=".25" />
          <path d="M-40 2h80v10h-80Z" />
          <path d="M-30-6h60v8h-60Z" />
          <path d="M-26-14h12v8h-12ZM-8-18h14v12h-14ZM12-12h12v6h-12Z" />
          <path d="M-22-11h6v3h-6ZM-4-15h6v3h-6Z" fill="white" fillOpacity=".4" />
        </g>)
        .with("space", () => <>
          <path d="M-43 8Q-6-26 43-6" strokeWidth="11" strokeOpacity=".2" />
          <path d={cloud} fill={ink} fillOpacity=".08" />
          <path d="M-28-31h6m-3-3v6M24-30h6m-3-3v6M8-34h5m-2.5-2.5v5" />
        </>)
        .with("underwater", () => <>
          <path d={cloud} strokeWidth="7" strokeOpacity=".25" />
          <path d={cloud} fill={ink} fillOpacity=".15" />
          <circle cx="-18" cy="-28" r="3" /><circle cx="-4" cy="-33" r="1.5" /><circle cx="16" cy="-29" r="2.5" /><circle cx="27" cy="-2" r="1.5" />
        </>)
        .exhaustive()}
    </g>;
  }
  if (terrain === "volcano") {
    return <g className="volcano-artwork" aria-hidden="true" pointerEvents="none" clipPath={clipPath} fill="none" stroke={ink} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M-52-58H52V-6Q0-20-52-6Z" fill="#ffd9a8" fillOpacity=".28" stroke="none" />
      <path d="M-52 28Q-32 14-14 25Q4 15 24 24Q38 15 52 26V58H-52Z" fill="#6d3a30" fillOpacity=".5" stroke="none" />
      <path d="M-54 56C-34 42-21 12-14-24L-5-21 0-23 6-21 14-24C21 12 34 42 54 56Z" fill="#59352f" fillOpacity=".9" />
      <path d="M0-22 6-21 14-24C21 12 34 42 54 56H5C10 28 6 4 0-22Z" fill="#361c18" fillOpacity=".4" stroke="none" />
      <path d="M-12-18C-17 4-26 24-40 44M11-16C17 6 26 24 39 43" stroke={ink} strokeOpacity=".34" strokeWidth="1.2" />
      <ellipse cx="0" cy="-24" rx="14.5" ry="4.8" fill="#ff7020" stroke={ink} />
      <ellipse cx="0" cy="-24" rx="9" ry="2.5" fill="#ffe169" stroke="none" />
      <path d="M-6-20C-11-9-11 1-18 12C-23 20-26 27-30 33M5-20C11-8 12 2 19 13C24 20 27 27 32 35M-1-19C-3-6 3 6-1 18C-2 24 1 28 0 33" stroke="#ff5e1a" strokeWidth="4" />
      <path d="M-6-20C-11-9-11 1-18 12C-23 20-26 27-30 33M5-20C11-8 12 2 19 13C24 20 27 27 32 35M-1-19C-3-6 3 6-1 18C-2 24 1 28 0 33" stroke="#ffd859" strokeWidth="1.5" />
      <path d="M-10-36q4-7 10-5t10-7m-22 2q3-6 8-6" stroke="#fff3e0" strokeOpacity=".65" strokeWidth="2.2" />
      <circle cx="-18" cy="-35" r="2.2" fill="#ffd859" stroke="none" />
      <circle cx="15" cy="-38" r="1.8" fill="#ff8f3a" stroke="none" />
      <circle cx="8" cy="-45" r="1.4" fill="#ffe794" stroke="none" />
    </g>;
  }
  if (terrain === "gold") {
    return <g className="gold-field-artwork" aria-hidden="true" pointerEvents="none" clipPath={clipPath} fill="none" stroke={ink} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M-52-24L8-58H30L-52-8Z" fill="#fff9cc" fillOpacity=".48" stroke="none" />
      <path d="M-52 0L44-58H52V-50L-52 12Z" fill="#fffbe0" fillOpacity=".3" stroke="none" />
      <path d="M-52 10Q0 22 52 10V58H-52Z" fill="#b97409" fillOpacity=".34" stroke="none" />
      <path d="M-52 17Q-22-3 2 10Q25 22 52-2" stroke="#a8670a" strokeWidth="16" strokeOpacity=".52" />
      <path d="M-52 17Q-22-3 2 10Q25 22 52-2" stroke="#4d9692" strokeWidth="11" />
      <path d="M-46 15Q-20-2 3 10Q24 21 47 0" stroke="#d6f4ef" strokeWidth="2.4" strokeOpacity=".85" />
      <path d="M-52 35Q0 29 52 35V58H-52Z" fill="#f5c644" fillOpacity=".78" stroke="none" />
      <path d="M-44 35Q0 29.5 44 35" stroke="#fff6be" strokeOpacity=".65" strokeWidth="1.2" />
      <ellipse cy="25" rx="34" ry="6.5" fill={ink} fillOpacity=".18" stroke="none" />
      <g className="gold-ingots">
        <g>
          <path d="m-19-28 29-8 13 9-30 8Z" fill="#fffbe0" />
          <path d="m-19-28 12 9v7l-12-9Z" fill="#a9670c" />
          <path d="m-7-19 30-8v7l-30 8Z" fill="#f6bd27" />
          <path d="m-12-28 21-5" stroke="#ffffff" strokeWidth="2.5" />
        </g>
      </g>
      <g className="gold-coins">
        {[-32, 32].map(position => <g key={position} transform={`translate(${position} 0)`}>
          <path d="M-9-2v15a9 4 0 0 0 18 0V-2" fill="#e59f16" />
          <path d="M-9 3a9 4 0 0 0 18 0m-18 5a9 4 0 0 0 18 0m-18 5a9 4 0 0 0 18 0" />
          <ellipse cy="-2" rx="9" ry="4" fill="#fff7bf" />
          <ellipse cy="-2" rx="5" ry="2" strokeWidth="1" />
          <path d="M-6 2v10" stroke="#fff8c4" strokeWidth="2.2" />
        </g>)}
      </g>
      <path className="gold-sparkles" d="m-34-29 2 5 5 2-5 2-2 5-2-5-5-2 5-2Zm66 8 1.5 4 4 1.5-4 1.5-1.5 4-1.5-4-4-1.5 4-1.5Zm-48 45 1 2.6 2.6 1-2.6 1-1 2.6-1-2.6-2.6-1 2.6-1Z" fill="#fffdf0" strokeWidth="1" />
    </g>;
  }
  if (terrain === "sea") {
    const illustrated = theme.id === "illustrated";
    if (illustrated) {
      return <g aria-hidden="true" pointerEvents="none" clipPath={clipPath} fill="none" strokeLinecap="round">
        <path d="M-34-20q8-5 16 0t16 0M6-14q8-5 16 0t16 0M-38 2q9-6 18 0t18 0M4 10q8-5 16 0t16 0M-24 24q9-6 18 0t18 0" stroke="#eff8f5" strokeOpacity=".42" strokeWidth="2" />
        <path d="M-32-18q8-5 16 0t16 0M8-12q8-5 16 0t16 0M-36 4q9-6 18 0t18 0M6 12q8-5 16 0t16 0M-22 26q9-6 18 0t18 0" stroke="#5f9185" strokeOpacity=".72" strokeWidth="1.45" />
      </g>;
    }
    return <g aria-hidden="true" pointerEvents="none" clipPath={clipPath} fill="none" stroke={ink} strokeWidth="2" strokeLinecap="round">
      <path d="M-36-14q9-8 18 0t18 0t18 0t18 0M-36 4q9-8 18 0t18 0t18 0t18 0M-26 22q9-8 18 0t18 0t18 0" />
    </g>;
  }
  return (
    <g aria-hidden="true" pointerEvents="none" clipPath={clipPath} color={ink} fill="none" stroke={ink} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      {match(theme.id)
        .with("illustrated", () => (
          <>
            {match(terrain)
              .with("wood", () => <>
                <path d="M-52-58H52V-12Q0-22-52-12Z" fill="#b4cdb2" fillOpacity=".44" stroke="none" />
                <path d="M-52 10V-11L-43-23-35-12-26-27-17-13-8-31 1-17 11-30 20-13 30-25 39-10 47-21 52-11V10Z" fill="#5b7d63" fillOpacity=".46" stroke="none" />
                <path d="M-52 10Q-24 2 0 14Q24 2 52 10V58H-52Z" fill="#6b8b6d" stroke="none" />
                <path d="M-52 33Q-18 25 0 32Q20 38 52 30V58H-52Z" fill="#98b48e" fillOpacity=".88" stroke="none" />
                <path d="M-45 33Q-18 26 0 32Q20 37 45 31" stroke="#44664f" strokeOpacity=".42" strokeWidth="1.2" />
                <g stroke="#28493a" strokeWidth="1.15">
                  <path d="M-21-15v6M21-14v6" stroke="#4d3d2e" strokeWidth="2" />
                  <circle cx="-21" cy="-24" r="8.5" fill="#61875d" />
                  <path d="M-27-26A7 7 0 0 1-19-31" stroke="#90b484" strokeWidth="1.8" />
                  <circle cx="21" cy="-23" r="8.2" fill="#5d845a" />
                  <path d="M15-25A6.5 6.5 0 0 1 23-30" stroke="#8cb080" strokeWidth="1.8" />
                </g>
                <IllustratedConifer horizontal={-2} vertical={-36} scale={0.62} />
                <IllustratedConifer horizontal={-33} vertical={-3} scale={0.94} />
                <IllustratedConifer horizontal={33} vertical={-2} scale={0.96} />
                <IllustratedConifer horizontal={-42} vertical={12} scale={0.56} />
                <IllustratedConifer horizontal={42} vertical={13} scale={0.54} />
                <g transform="translate(-26 24)" stroke="#4c3929" strokeWidth="1.1">
                  <path d="M-7 1h12a2.5 2.5 0 0 1 0 5H-7Z" fill="#73533b" />
                  <circle cx="-7" cy="3.5" r="2.5" fill="#dfc99f" />
                  <path d="M-4-3h11a2.2 2.2 0 0 1 0 4.4H-4Z" fill="#826045" />
                  <circle cx="-4" cy="-0.8" r="2.2" fill="#e6d3ad" />
                </g>
              </>)
              .with("brick", () => <>
                <path d="M-52-58H52V-14Q0-4-52-16Z" fill="#f0cbb0" fillOpacity=".48" stroke="none" />
                <path d="M-52 10V-14Q-42-31-24-30Q-11-30-2-18V10Z" fill="#b76e53" stroke="#7c3f2e" strokeWidth="1.15" />
                <path d="M-6 10V-17Q10-35 28-33Q43-31 52-15V10Z" fill="#a85f46" stroke="#7c3f2e" strokeWidth="1.15" />
                <path d="M-44-21Q-33-30-20-28M7-25Q20-33 36-28" stroke="#ebb895" strokeWidth="1.8" />
                <path d="M-45-8Q-30-13-14-9M10-12Q25-17 44-11M-42-1Q-28-5-16-2" stroke="#e7b695" strokeOpacity=".55" strokeWidth="1.15" />
                <path d="M-52 12Q-22 3 0 13Q22 4 52 11V58H-52Z" fill="#c27d60" stroke="none" />
                <path d="M-52 34Q0 28 52 34V58H-52Z" fill="#dfb095" fillOpacity=".88" stroke="none" />
                <path d="M-46 34Q0 28 46 34" stroke="#8a4b38" strokeOpacity=".42" strokeWidth="1.2" />
                <g stroke="#7c3f2e" strokeWidth="1.15">
                  <ellipse cx="-30.5" cy="28" rx="11.5" ry="2.6" fill="#7c3f2e" fillOpacity=".26" stroke="none" />
                  <path d="M-41 19h10.5v7.5H-41ZM-30.5 19H-20v7.5h-10.5ZM-36 12h11v7h-11Z" fill="#b85e43" />
                  <path d="M-40 20.6h8.5M-29.5 20.6h8.5M-35 13.6h9" stroke="#e8b897" strokeWidth="1.3" />
                  <ellipse cx="31" cy="24.5" rx="10" ry="2.4" fill="#7c3f2e" fillOpacity=".26" stroke="none" />
                  <path d="M22 24V13A9 10 0 0 1 40 13V24Z" fill="#b65d42" />
                  <path d="M22 24V13A9 10 0 0 1 31 3V24Z" fill="#cf7f62" stroke="none" />
                  <path d="M22 24V13A9 10 0 0 1 40 13V24Z" fill="none" />
                  <path d="M27.5 3.5h7" strokeWidth="2.2" />
                  <path d="M28 24V17A3 3.5 0 0 1 34 17V24Z" fill="#54271d" />
                  <path d="M29.4 24V20A1.6 1.8 0 0 1 32.6 20V24Z" fill="#f2b86d" stroke="none" />
                  <path d="M31 0Q34-7 29-13Q26-19 32-25" stroke="#fbf1e1" strokeOpacity=".75" strokeWidth="1.6" />
                </g>
              </>)
              .with("wool", () => <>
                <path d="M-52-58H52V-18Q0-8-52-20Z" fill="#e7f0c9" fillOpacity=".54" stroke="none" />
                <path d="M-52 6Q-22-24 10-8Q30 2 52-15V58H-52Z" fill="#b2c57e" stroke="none" />
                <path d="M-48-11Q-20-23 10-8Q30 2 48-13" stroke="#e3ecc0" strokeOpacity=".78" strokeWidth="1.6" />
                <path d="M-52 17Q-18 3 14 15Q34 22 52 11V58H-52Z" fill="#9bb267" stroke="none" />
                <path d="M-52 35Q0 28 52 35V58H-52Z" fill="#c8d797" fillOpacity=".9" stroke="none" />
                <path d="M-45 34Q0 28 45 34" stroke="#677c40" strokeOpacity=".38" strokeWidth="1.2" />
                <path d="M-36-18v-8m8 5v-8m8 7v-8M-38-24q10-2 20 3M-38-20q10-2 20 3" stroke="#856e49" strokeWidth="1.3" />
                <path d="M-15 24l1.5-3.5 1.5 3.5M14 26l1.5-3.5 1.5 3.5M-37-4l1.4-3.2 1.4 3.2M9-22l1.4-3.2 1.4 3.2" stroke="#62783d" strokeWidth="1.2" />
                <circle cx="-18" cy="25" r="1.4" fill="#fbf7e6" stroke="none" />
                <circle cx="21" cy="24" r="1.3" fill="#f5e18a" stroke="none" />
                <circle cx="-24" cy="-9" r="1.2" fill="#fbf7e6" stroke="none" />
                <circle cx="15" cy="-19" r="1.3" fill="#f5e18a" stroke="none" />
                <IllustratedSheep horizontal={-33} vertical={12} scale={0.76} mirror />
                <IllustratedSheep horizontal={33} vertical={-11} scale={0.78} mirror />
              </>)
              .with("grain", () => <>
                <path d="M-52-58H52V-18Q0-10-52-20Z" fill="#f7e6ad" fillOpacity=".56" stroke="none" />
                <path d="M-52-4Q-12-23 52-8V58H-52Z" fill="#ddb755" stroke="none" />
                <path d="M-52 8Q-10-4 28 14L52 24V58H-52Z" fill="#cfa03e" fillOpacity=".58" stroke="none" />
                <path d="M-52 22Q0 8 52 19V58H-52Z" fill="#ebd078" fillOpacity=".75" stroke="none" />
                <path d="M-46 11Q-4-2 46 14M-44 22Q0 10 44 23M-36 30Q0 22 36 31" stroke="#a57c2a" strokeOpacity=".48" strokeWidth="1.25" />
                <path d="M-52 35Q0 29 52 35V58H-52Z" fill="#edd380" fillOpacity=".92" stroke="none" />
                <g stroke="#876120" strokeWidth="1.15">
                  <path d="M-4.2-23L-2.6-35H2.6L4.2-23Z" fill="#fbf3d7" />
                  <path d="M-3.5-35Q0-39.5 3.5-35Z" fill="#b8763b" />
                  <path d="M-7-41.5L7-28.5M-7-28.5L7-41.5" stroke="#7c571c" strokeWidth="1.35" />
                  <circle cx="0" cy="-35" r="1.4" fill="#7c571c" stroke="none" />
                </g>
                <IllustratedWheatCluster horizontal={-31} vertical={22} />
                <IllustratedWheatCluster horizontal={31} vertical={22} mirror />
              </>)
              .with("ore", () => <>
                <path d="M-52-58H52V-10Q0-18-52-10Z" fill="#d2e0e3" fillOpacity=".56" stroke="none" />
                <path d="M-44 12L-10-20 4-10 16-22 44 12Z" fill="#7c949c" fillOpacity=".5" stroke="none" />
                <g strokeLinejoin="round">
                  <path d="M-52 19L-23-37 2 18Z" fill="#59727b" stroke="#3f5860" strokeWidth="1.25" />
                  <path d="M-23-37-19 18H2Z" fill="#789199" stroke="none" />
                  <path d="M-23-37-32-19-25-22-19-16-14-21Z" fill="#eff3ea" stroke="none" />
                  <path d="M-23-37-32-19-25-22-22-26Z" fill="#d3dede" stroke="none" />
                  <path d="M-4 18L24-33 52 19Z" fill="#536c75" stroke="#3f5860" strokeWidth="1.25" />
                  <path d="M24-33 27 18H52Z" fill="#758f97" stroke="none" />
                  <path d="M24-33 15-16 21-20 27-14 33-19Z" fill="#eff3ea" stroke="none" />
                  <path d="M24-33 15-16 21-20 24-24Z" fill="#d3dede" stroke="none" />
                </g>
                <path d="M-52 16L-32 12-14 19 0 15 16 19 33 12 52 17V58H-52Z" fill="#6b838b" stroke="none" />
                <path d="M-52 35Q0 30 52 35V58H-52Z" fill="#b7c7cb" fillOpacity=".92" stroke="none" />
                <path d="M-46 35Q0 30 46 35" stroke="#486169" strokeOpacity=".4" strokeWidth="1.2" />
                <g stroke="#395159" strokeWidth="1.15" strokeLinejoin="round">
                  <path d="M-39 27L-35 18-28 21-25 28Z" fill="#465e67" />
                  <path d="M-35 18L-32 27-25 28" fill="none" stroke="#dce6e2" strokeWidth="1.2" />
                  <path d="M25 28L29 20 36 18 39 27Z" fill="#465e67" />
                  <path d="M36 18L33 27 25 28" fill="none" stroke="#dce6e2" strokeWidth="1.2" />
                </g>
              </>)
              .with("desert", () => <>
                <path d="M-52-58H52V-8Q0-16-52-8Z" fill="#f8d8a2" fillOpacity=".76" stroke="none" />
                <circle cx="24" cy="-27" r="14.5" fill="#fae09e" fillOpacity=".58" stroke="none" />
                <circle cx="24" cy="-27" r="8.5" fill="#f6bc4f" stroke="none" />
                <path d="M-52-4Q-18-20 14-6Q34 3 52-10V58H-52Z" fill="#e1a85e" stroke="none" />
                <path d="M-50-5Q-18-19 14-6Q34 2 50-9" stroke="#f7d598" strokeOpacity=".65" strokeWidth="1.5" />
                <path d="M-52 9Q-18-7 10 11Q32 24 52 9V58H-52Z" fill="#c47c37" stroke="none" />
                <path d="M-52 9Q-18-7 10 11Q32 24 52 9L52 15Q31 28 9 15Q-18 0-52 15Z" fill="#f5cf8b" fillOpacity=".82" stroke="none" />
                <path d="M-52 29Q-14 20 16 30Q35 36 52 29V58H-52Z" fill="#e8b974" stroke="none" />
                <path d="M-42 23Q-22 14 2 22M14 28Q30 22 44 26" stroke="#9e5d24" strokeOpacity=".55" strokeWidth="1.3" />
                <g>
                  <ellipse cx="-25" cy="13.5" rx="7" ry="2" fill="#8c501c" fillOpacity=".36" stroke="none" />
                  <path d="M-25 13V-9" stroke="#4f6c40" strokeWidth="4.6" />
                  <path d="M-25 3H-31V-3M-25-1H-19V-6" stroke="#4f6c40" strokeWidth="3.2" />
                  <path d="M-26.1 11V-8.5M-31.6-2.5V2.2M-19.6-5.5V-1.8" stroke="#87a66c" strokeWidth="1.1" />
                  <path d="M-19 14Q-16 11-13 14Z" fill="#a9672a" stroke="none" />
                </g>
              </>)
              .exhaustive()}
          </>
        ))
        .with("ceramic", () => (
          <>
            <path d="M-45 19V-15l20-18M25-33l20 18v34M-27 34H27" stroke="#fffdf3" strokeWidth="4" />
            <path d="M-45 19V-15l20-18M25-33l20 18v34M-27 34H27" strokeWidth="1" />
            {[-24, -12, 0, 12, 24].map((position) => <path key={position} d={`m${position} 30 3 4-3 3-3-3Z`} fill="currentColor" stroke="none" opacity=".8" />)}
            <path d="M-42-10q10-2 6-12m78 12q-10-2-6-12M-8-33q8-9 16 0-8 9-16 0Z" />
            {terrain === "desert" ? <>
              <circle cx="0" cy="-19" r="8" strokeWidth="2" /><path d="M0-31v-3m-13 15h-4m30 0h4m-8-9 3-3m-21 3-3-3M-35 9Q-22-8-8 9T20 9q10-11 16 0M-33 18Q-20 4-5 18t38 0" strokeWidth="2" />
              <path d="M-27 23q7-6 14 0m26 0q7-6 14 0" />
            </> : <>
              <g transform="translate(-43 -19) scale(.85)"><ResourceArtwork resource={terrain} theme={theme} /></g>
              <g transform="translate(16 -19) scale(.85)"><ResourceArtwork resource={terrain} theme={theme} /></g>
              <path d="M-34 24q8-5 14 0m14 2q6-4 12 0m14-2q6-5 14 0" opacity=".6" />
            </>}
          </>
        ))
        .with("wooden", () => (
          <>
            <path d="M-27-32Q0-37 27-32M-36-25Q-21-29-14-27m28 0q10-2 22 2M-44 17q12-5 22 0m44 0q12-5 22 0M-37 27Q-16 20 0 27t37 0M-26 34Q0 28 26 34" opacity=".32" />
            <path d="m-41 22 8-5m-3 8 8-5m-2 8 8-5m44 1 8-5m-2 8 8-5m-6-4 6 9m-65-9 6 8" opacity=".55" />
            <path d="M-22-34Q0-38 22-34M-24 36Q0 30 24 36" stroke="#fff0c5" strokeOpacity=".55" />
            {terrain === "desert" ? <>
              <ellipse cx="23" cy="-18" rx="10" ry="8" /><ellipse cx="23" cy="-18" rx="6" ry="4" /><path d="M-44 10Q-22-15 1 9T44 7M-40 18Q-20-7 0 16m-26-12 10 12m-4-15 12 13m-5-12 11 13m-31-8 10 12m29 5 25-10m-18 14 22-9" />
            </> : <>
              <g transform="translate(-45 -24) scale(.95)"><ResourceArtwork resource={terrain} theme={theme} /></g>
              <g transform="translate(15 -24) scale(.95)"><ResourceArtwork resource={terrain} theme={theme} /></g>
              <g transform="translate(-9 -37) scale(.55)"><ResourceArtwork resource={terrain} theme={theme} /></g>
            </>}
          </>
        ))
        .with("pixel", () => (
          <g stroke="none" fill="currentColor" shapeRendering="crispEdges">
            {match(terrain)
              .with("wood", () => <path d="M-44 22h16v-4h12v8h-24v4h-4Zm60 0h12v-4h12v8h4v4H16Z" opacity=".35" />)
              .with("brick", () => <><path d="M-44 18h18v8h-18Zm22 8h16v8h-16Zm28 0h16v8H6Zm20-8h18v8H26Z" opacity=".45" /><path d="M-40 20h12v2h-12Zm68 0h12v2H28Z" fill="white" fillOpacity=".3" /></>)
              .with("wool", () => <path d="M-46 16h8v-4h12v6h12v8h-32Zm60 2h10v-6h12v4h10v10H14ZM-28 30h4v-4h4v8h-8Zm48 0h4v-4h4v8h-8Z" opacity=".3" />)
              .with("grain", () => <path d="M-44 22h26v4h-26ZM-28 30h56v4h-56ZM18 22h26v4H18ZM-16-36h32v4h-32Z" opacity=".4" />)
              .with("ore", () => <><path d="M-44 20h8v-4h8v10h8v8h-16v-4h-8Zm64 6h8V16h8v4h8v10h-8v4H20Z" opacity=".4" /><path d="M-34 20h4v4h-4Zm66 0h4v4h-4Z" fill="white" fillOpacity=".6" /></>)
              .with("desert", () => <><path d="M16-32h16v4h4v12h-4v4H16v-4h-4v-12h4ZM-44 14h8V6h12V2h12v8H0v8h20v-4h14V6h12v20H30v4H10V20H-8v-4h-12v6h-16v8h-8Z" opacity=".5" /><path d="M18-28h12v12H18Z" fill="white" fillOpacity=".35" /><path d="M-28-20h8v4h-8Zm-8 16h8v4h-8ZM8 32h16v4H8Z" /></>)
              .exhaustive()}
            {terrain !== "desert" && <>
              <g transform="translate(-46 -22)"><ResourceArtwork resource={terrain} theme={theme} /></g>
              <g transform="translate(14 -22)"><ResourceArtwork resource={terrain} theme={theme} /></g>
              <path d="M-8-36h4v4h-4Zm12 8h4v4H4ZM-2 30h4v4h-4Z" opacity=".6" />
            </>}
          </g>
        ))
        .with("space", () => (
          <>
            <path d="m-22-33 2-4m43 7 4-2M-8-29h5m-2-2v4m16-8v4m-2-2h4M-43 10h4m-2-2v4" opacity=".7" />
            <ellipse cx="-29" cy="26" rx="12" ry="4" fill="currentColor" fillOpacity=".12" /><path d="M-38 26q9-5 18 0" opacity=".55" />
            <ellipse cx="28" cy="28" rx="10" ry="3.5" fill="currentColor" fillOpacity=".12" /><path d="M22 28q6-4 12 0M-12 34h24m-20-4v4m16-4v4" opacity=".55" />
            {terrain === "desert" ? <>
              <ellipse cx="-22" cy="-11" rx="17" ry="8" fill="currentColor" fillOpacity=".18" /><ellipse cx="-22" cy="-11" rx="11" ry="4" /><ellipse cx="25" cy="7" rx="18" ry="10" fill="currentColor" fillOpacity=".13" /><path d="M12 7q13-12 26 0M12 19l4 3m-23-2 4-3" /><circle cx="16" cy="-26" r="6" /><path d="M7-24q10 3 18-4" />
            </> : <>
              <path d="M-31 10v8h12m38 0h12v-8M-31-28h-8v7m70-7h8v7" opacity=".6" />
              <g transform="translate(-46 -24)"><ResourceArtwork resource={terrain} theme={theme} /></g>
              <g transform="translate(14 -24)"><ResourceArtwork resource={terrain} theme={theme} /></g>
              <path d="M-8-27h16l-3 5H-5ZM0-22v4" fill="currentColor" fillOpacity=".2" />
            </>}
          </>
        ))
        .with("underwater", () => (
          <>
            <path d="M-33-30q8-5 16-1m26-3q9-4 17 0M-40 30q16-6 28-1m24 0q15-5 28 1M-25 36q25-5 50 0" opacity=".45" />
            <circle cx="-28" cy="-25" r="2.5" /><circle cx="-20" cy="-35" r="1.5" /><circle cx="31" cy="-27" r="3" /><circle cx="22" cy="-36" r="1.5" />
            <path d="M-39 28V14m0 9-5-5m5 1 5-5M39 29V17m0 7 5-5m-5 2-5-6" strokeWidth="2.5" />
            <path d="M-30 31q-7-7-4-13m65 13q6-8 3-13" />
            {terrain === "desert" ? <>
              <path d="M-43 13Q-24-4-3 12T43 8M-35 20Q-17 6 0 20t34-1" strokeWidth="1.8" /><path d="m-24-10 3-6 3 6 7 1-5 4 1 7-6-4-6 4 1-7-5-4ZM18-13q0-12 8-12t8 12Z" fill="currentColor" fillOpacity=".2" /><path d="M26-25v12m-5-10 3 10m7-10-3 10M-10 31h3m12-4h3" />
            </> : <>
              <g transform="translate(-46 -20)"><ResourceArtwork resource={terrain} theme={theme} /></g>
              <g transform="translate(14 -20)"><ResourceArtwork resource={terrain} theme={theme} /></g>
              <path d="M-31 12v8h11m40 0h11v-8M-7-24q7-7 14 0-7 7-14 0Zm14 0 5-4v8Z" fill="currentColor" fillOpacity=".16" />
            </>}
          </>
        ))
        .exhaustive()}
    </g>
  );
}
