import { match } from "ts-pattern";
import type { Resource, Terrain } from "../game/types";
import type { BoardTheme } from "../themes";

export function ResourceArtwork({ resource, theme }: { resource: Resource; theme: BoardTheme }) {
  return (
    <g fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      {match(theme.id)
        .with("illustrated", () => match(resource)
          .with("wood", () => <><path d="M16 3 6 17h5l-6 8h22l-6-8h5L16 3Z" fill="currentColor" stroke="none" /><path d="M16 24v6" strokeWidth="3" /></>)
          .with("brick", () => <><path d="m3 16 17-8 10 6-17 9-10-7Z" fill="currentColor" stroke="none" /><path d="M3 19v5l10 6 17-9v-5l-17 9-10-6Z" fill="currentColor" stroke="none" opacity=".7" /></>)
          .with("wool", () => <><path d="M8 24a6 6 0 0 1-2-11 6 6 0 0 1 10-6 7 7 0 0 1 11 8 5 5 0 0 1-1 9H8Z" fill="currentColor" stroke="none" /><path d="M10 24v5m12-5v5" strokeWidth="3" /><path d="M25 17h4v6h-4z" fill="currentColor" stroke="none" /></>)
          .with("grain", () => <><path d="M16 5v25" strokeWidth="2" />{[7, 13, 19].map((position) => <g key={position} fill="currentColor" stroke="none"><path d={`M16 ${position + 7}Q4 ${position + 5} 6 ${position - 1}Q15 ${position} 16 ${position + 7}`} /><path d={`M16 ${position + 7}Q28 ${position + 5} 26 ${position - 1}Q17 ${position} 16 ${position + 7}`} /></g>)}</>)
          .with("ore", () => <><path d="m3 24 8-17 10-3 9 20-14 5L3 24Z" fill="currentColor" stroke="none" /><path d="m11 7 5 22 5-25" stroke="white" strokeOpacity=".45" /></>)
          .exhaustive())
        .with("ceramic", () => match(resource)
          .with("wood", () => <><path d="M16 28V7M16 19 8 12m8 3 8-8" strokeWidth="2" /><path d="M15 15C3 17 3 7 5 5c7 0 10 4 10 10Zm3-2C17 4 23 2 27 3c1 7-2 10-9 10ZM15 23C6 25 3 20 4 16c7-2 11 1 11 7Zm3-2c0-7 5-9 10-8 0 6-4 10-10 8Z" fill="currentColor" stroke="none" /><path d="M10 29q6-3 12 0M7 7l5 5m9-2 3-4" /></>)
          .with("brick", () => <><path d="M4 15h24v12H4Zm4-9h16v9H8Zm8 9v12M12 6v9m8 0V6" strokeWidth="2" /><path d="m7 19 3-2 3 2-3 3Zm12 0 3-2 3 2-3 3Z" fill="currentColor" stroke="none" /><path d="M5 29h22M11 3h10" /></>)
          .with("wool", () => <><path d="M7 22c-6-3-5-9 0-10-1-6 7-8 10-4 6-3 11 2 8 7 4 6-2 10-6 8-4 4-9 3-12-1Z" fill="currentColor" fillOpacity=".14" strokeWidth="2" /><path d="M9 23v5m10-4v4m3-14q9-3 7 5l-5 3-3-3M9 14c-4 4 3 7 5 3s-5-6-5-1m5-7q5 0 4 5" /><circle cx="26" cy="16" r=".8" fill="currentColor" stroke="none" /><path d="M3 29h24" /></>)
          .with("grain", () => <><path d="M16 29V4M12 29l8-1" strokeWidth="2" /><path d="M15 12C7 12 5 8 6 4c7 0 10 4 9 8Zm2 5c0-7 4-10 10-10 0 6-4 10-10 10Zm-2 6c-8 0-11-4-10-9 6 0 10 3 10 9Zm2 3c0-6 4-9 10-8 0 5-4 9-10 8Z" fill="currentColor" stroke="none" /><path d="M2 29h5m17 0h5" /></>)
          .with("ore", () => <><path d="M4 23 10 8l9-4 9 18-12 7Z" strokeWidth="2" /><path d="m10 8 6 21 3-25M4 23l12-4 12 3M10 8l7 6 7-1" /><path d="m8 20 2-5 3 8Zm12-5 4 5-6 4Z" fill="currentColor" stroke="none" /></>)
          .exhaustive())
        .with("wooden", () => match(resource)
          .with("wood", () => <><path d="m5 12 12-7c9-4 17 10 8 15l-12 7Z" fill="currentColor" fillOpacity=".12" /><ellipse cx="10" cy="20" rx="5.5" ry="7.5" transform="rotate(-29 10 20)" strokeWidth="2" /><ellipse cx="10" cy="20" rx="2.5" ry="4" transform="rotate(-29 10 20)" /><path d="m13 12 7-4m-4 7 8-5m-6 8 9-5m-8 9 10-6M4 18l6-3m-5 9 7-4" /></>)
          .with("brick", () => <><path d="m3 15 16-9 10 6v11l-16 7L3 24Z" strokeWidth="2" /><path d="m3 15 10 7 16-10M13 22v8m-7-7 4 3m-4-7 4 3m6 2 3-2m0 5 3-2m0-5 4-2M9 14l10-5m-6 8 10-5" /></>)
          .with("wool", () => <><path d="M5 21c-5-4-1-10 3-9-1-6 7-7 10-3 8-3 12 4 8 9 1 7-7 9-10 6-3 4-10 3-11-3Z" strokeWidth="2" /><path d="M8 26v3m11-4v4m5-14 6 1-2 7-5-2M7 16l5-4m-7 9 13-10M9 23l12-10m-6 11 7-6m-12-5 8 10m-3-12 6 8" /></>)
          .with("grain", () => <><path d="M15 29 18 4M11 29l-2-16m11 15 7-12M16 11 10 5l-1 6 7 5m1-7 7-5 1 5-9 7m-1 4-9-7 1 7 7 5m2-7 10-7-1 7-11 7M11 27l9 1" strokeWidth="1.8" /><path d="m12 9 3 3m4-2 3-3M10 19l3 3m5-1 4-3" /></>)
          .with("ore", () => <><path d="m3 24 7-15 12-4 7 16-13 8Z" strokeWidth="2" /><path d="m10 9 6 20 6-24M3 24l10-4m7 3 9-2M7 17l5-4m-7 9 9-6m-6 9 7-6m9-8-3 4m5 1-7 6m5 3-5-2" /></>)
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
              .with("wood", () => <><path d="M3 25V16a13 13 0 0 1 26 0v9Z" fill="currentColor" fillOpacity=".1" /><path d="M7 25v-7M25 25v-7M16 25V8m0 12-5-5m5 1 5-4" /><path d="M16 17C8 18 7 11 10 8c5 0 7 4 6 9Zm1-5c0-6 5-7 7-6 0 5-2 7-7 6Z" fill="currentColor" stroke="none" /><path d="M2 28h28M5 31h5m12 0h5" strokeWidth="2" /></>)
              .with("brick", () => <><path d="M5 9h22l3 5v13H2V14Z" /><path d="M7 14h18v9H7Zm9 0v9M7 18h18M11 5h10M16 2v3" strokeWidth="2" /><circle cx="5" cy="26" r="1" fill="currentColor" /><circle cx="27" cy="26" r="1" fill="currentColor" /><path d="M9 30h14" /></>)
              .with("wool", () => <><path d="M3 25V16a13 13 0 0 1 26 0v9ZM2 28h28" /><path d="M9 21c-5-1-4-6-1-7-1-4 5-6 7-3 5-3 10 1 7 6 2 5-4 7-6 4-2 3-5 3-7 0Z" fill="currentColor" fillOpacity=".25" /><path d="M10 22v3m9-4v4m2-10 5 1-1 4-4-1" /><path d="M7 31h5m8 0h5M10 5h12" /></>)
              .with("grain", () => <><path d="M4 25V12L9 5h14l5 7v13ZM2 28h28M4 12h24" /><path d="M12 24V10m0 9-4-4m4 1 4-5m4 13V10m0 10 4-5m-4 1-4-4" strokeWidth="2" /><path d="M6 31h6m8 0h6" /><path d="M7 26h18" strokeWidth="3" /></>)
              .with("ore", () => <><path d="m4 23 5-12 8-3 8 14-10 7Z" fill="currentColor" fillOpacity=".2" /><path d="m9 11 6 18 2-21M4 23l11-5 10 4M21 3h8v5h-8Zm4 5v9l-5 4m2-9h7" strokeWidth="2" /><path d="m23 23 4 1M3 29h24" /><circle cx="26" cy="27" r="2" /></>)
              .exhaustive()}
          </>
        ))
        .with("underwater", () => (
          <>
            {match(resource)
              .with("wood", () => <><path d="M4 26V15a12 12 0 0 1 24 0v11ZM2 29h28" /><path d="M16 25V10m0 9-6-5m6 2 6-5" strokeWidth="2" /><path d="M16 17C8 19 6 13 9 9c5 0 8 3 7 8Zm1-4c-1-6 4-8 7-7 1 5-2 8-7 7Z" fill="currentColor" stroke="none" /><path d="M7 23h4m10 0h4M7 9l3-3" /><circle cx="29" cy="4" r="2" /></>)
              .with("brick", () => <><path d="M4 17h24v11H4Zm4-8h16v9H8Zm8 9v11M16 8v9" strokeWidth="2" /><path d="M6 21h7m6 0h7M11 12h3m5 0h3M2 30h28M4 26V12m0 5L1 14" /><circle cx="27" cy="5" r="2.5" /><circle cx="5" cy="5" r="1.5" /></>)
              .with("wool", () => <><path d="M3 26V16a13 13 0 0 1 26 0v10ZM1 29h30" /><path d="M9 22c-5-2-5-6-1-8-1-4 5-6 7-3 5-3 9 2 6 6 3 4-2 7-5 5-3 3-5 2-7 0Z" fill="currentColor" fillOpacity=".2" /><path d="M10 23v3m8-4v4m3-10h5v5h-5M6 10l4-4" /><circle cx="27" cy="3" r="2" /></>)
              .with("grain", () => <><path d="M4 26V16a12 12 0 0 1 24 0v10ZM2 29h28" /><path d="M12 25V10m0 7-4-4m4 8-4-3m4-3 4-4m4 14V10m0 7-4-4m4 8 4-4m-4-3 4-4" strokeWidth="1.8" /><path d="M6 26h20" strokeWidth="3" /><circle cx="3" cy="4" r="2" /><circle cx="27" cy="8" r="1.5" /></>)
              .with("ore", () => <><path d="m5 24 6-14 9-2 8 16-12 5Z" fill="currentColor" fillOpacity=".16" strokeWidth="2" /><path d="m11 10 5 19 4-21M5 24l11-6 12 6M3 28V15m0 6 4-4m21 10 2-5" /><circle cx="6" cy="7" r="2.5" /><circle cx="25" cy="3" r="1.5" /><path d="M2 31h28" /></>)
              .exhaustive()}
          </>
        ))
        .exhaustive()}
    </g>
  );
}

export function TerrainArtwork({ terrain, theme }: { terrain: Terrain; theme: BoardTheme }) {
  const ink = theme.terrain[terrain].ink;
  return (
    <g aria-hidden="true" pointerEvents="none" color={ink} fill="none" stroke={ink} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      {match(theme.id)
        .with("illustrated", () => (
          <>
            {match(terrain)
              .with("wood", () => <path d="M-45 24Q-22 12 0 24T45 23M-36 31Q-12 23 9 32" opacity=".6" />)
              .with("brick", () => <><path d="M-46 6-32-20-16-12 2-36 20-18 30-22 46 8 30 23H-31Z" fill={ink} opacity=".25" stroke="none" /><path d="M-33-20-20 2M2-36 8-17 20-18" opacity=".5" /></>)
              .with("wool", () => <><path d="M-46 10Q-25-14-4 0Q19-14 46 5L42 25Q17 9-1 22Q-24 10-42 30Z" fill={ink} opacity=".18" stroke="none" /><path d="m-36-22 2-5 3 4m58 2 3-5 3 4" /></>)
              .with("grain", () => <path d="M-44 21Q0 5 44 23M-36 29Q0 15 36 31M-24 36Q0 26 24 37" opacity=".6" />)
              .with("ore", () => <><path d="M-46 19-26-24-11-7 7-38 45 18Z" fill={ink} opacity=".35" /><path d="m7-38-10 19 8-4 7 6 5-7m-43 0-7 14 7-4 7 5" stroke="#e1e5d6" strokeWidth="3" /></>)
              .with("desert", () => <><circle cx="23" cy="-23" r="9" fill="#eddbaf" /><path d="M-46 13Q-25-11-1 9Q24 25 46 3L43 25Q17 12-2 29Q-23 9-42 30Z" fill={ink} fillOpacity=".3" stroke="none" /><path d="M-43 23Q-22 3 1 20M8 31Q27 17 38 25m-69-43 8-3" /></>)
              .exhaustive()}
            {terrain !== "desert" && terrain !== "ore" && <>
              <g transform="translate(-44 -25) scale(.9)"><ResourceArtwork resource={terrain} theme={theme} /></g>
              <g transform="translate(16 -20) scale(.85)"><ResourceArtwork resource={terrain} theme={theme} /></g>
              <g transform="translate(-10 -39) scale(.6)"><ResourceArtwork resource={terrain} theme={theme} /></g>
            </>}
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
