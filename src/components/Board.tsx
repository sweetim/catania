import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { blockedSettlementVertices } from "../game/engine";
import { edgeTiles, isResource } from "../game/board";
import type { Board as BoardState, Player, Terrain } from "../game/types";
import { pieceName, resourceName } from "../i18n";
import { useLanguage, useTranslation } from "../localization";
import { getTerrainName, getThemeName, useBoardTheme } from "../themes";
import { boardTranslations } from "../translations/board";
import { TerrainArtwork } from "./ThemeArtwork";

const tileElevation = 8;

export function Board({
  board,
  players,
  robberTileId,
  pirateTileId,
  routeMode,
  onMovePirateOffBoard,
  legalVertexIds = [],
  legalEdgeIds = [],
  legalTileIds = [],
  showBlockedSettlementLocations = false,
  fillBoardWithWater = false,
  producingTileIds = [],
  rolledNumber,
  selectedId,
  confirmation,
  onSelect,
  onChangeTheme,
  routeChoice,
  interactive = true,
  compact = false,
  fit = false,
}: {
  board: BoardState;
  players: Pick<Player, "id" | "name" | "color">[];
  robberTileId?: string;
  pirateTileId?: string | null;
  routeMode?: "road" | "ship" | "move-ship" | null;
  onMovePirateOffBoard?: () => void;
  legalVertexIds?: string[];
  legalEdgeIds?: string[];
  legalTileIds?: string[];
  showBlockedSettlementLocations?: boolean;
  fillBoardWithWater?: boolean;
  producingTileIds?: string[];
  rolledNumber?: number;
  selectedId?: string | null;
  confirmation?: {
    title: string;
    onConfirm: () => void;
    onCancel: () => void;
  };
  onSelect?: (kind: "vertex" | "edge" | "tile", id: string) => void;
  onChangeTheme?: () => void;
  routeChoice?: ReactNode;
  interactive?: boolean;
  compact?: boolean;
  fit?: boolean;
}) {
  const { language } = useLanguage();
  const translateText = useTranslation(boardTranslations);
  const theme = useBoardTheme();
  const illustrationId = useId().replace(/:/g, "");
  const surfaceReference = useRef<HTMLDivElement>(null);
  const viewportReference = useRef<HTMLDivElement>(null);
  const mapReference = useRef<SVGSVGElement>(null);
  const confirmationReference = useRef<HTMLDivElement>(null);
  const confirmButtonReference = useRef<HTMLButtonElement>(null);
  const keyboardTargetReference = useRef<{ id: string; key: string } | null>(null);
  const panReference = useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);
  const zoomCenterReference = useRef({ x: 0.5, y: 0.5 });
  const [zoom, setZoom] = useState(1);
  const [viewportSize, setViewportSize] = useState({ width: 710, height: 674 });
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const verticesById = new Map(
    board.vertices.map((vertex) => [vertex.id, vertex]),
  );
  const playersById = new Map(players.map((player) => [player.id, player]));
  const halfWidth = Math.max(
    355,
    ...board.vertices.map((vertex) => Math.abs(vertex.x) + 85),
  );
  const halfHeight = Math.max(
    337,
    ...board.vertices.map((vertex) => Math.abs(vertex.y) + 85),
  );
  const viewWidth = halfWidth * 2;
  const viewHeight = halfHeight * 2;
  const canSelect = interactive && Boolean(onSelect);
  const legalVertices = new Set(canSelect ? legalVertexIds : []);
  const legalEdges = new Set(canSelect ? legalEdgeIds : []);
  const legalTiles = new Set(canSelect ? legalTileIds : []);
  const raisedTileIds = new Set(board.tiles.filter((tile) =>
    (tile.number !== null && tile.number === rolledNumber) ||
    (legalTiles.has(tile.id) && (selectedId === tile.id || focusedId === tile.id)),
  ).map((tile) => tile.id));
  const blockedVertices = showBlockedSettlementLocations ? blockedSettlementVertices(board) : [];
  const mapWidth = fit
    ? Math.min(viewportSize.width, (viewportSize.height * viewWidth) / viewHeight)
    : viewportSize.width;
  const hitRadius = Math.max(20, (22 * viewWidth) / (mapWidth * zoom));
  const edgeGeometry = board.edges.map((edge) => {
    const start = verticesById.get(edge.vertexIds[0])!;
    const end = verticesById.get(edge.vertexIds[1])!;
    return {
      edge,
      start,
      end,
      x: (start.x + end.x) / 2,
      y: (start.y + end.y) / 2,
      coastal: edgeTiles(board, edge).filter(tile => tile.terrain !== "sea").length === 1,
    };
  });
  const selectedPoint = selectedId
    ? verticesById.get(selectedId) ??
      edgeGeometry.find(({ edge }) => edge.id === selectedId) ??
      board.tiles.find((tile) => tile.id === selectedId)
    : undefined;
  const hasConfirmation = Boolean(confirmation && selectedPoint && canSelect);

  useEffect(() => {
    const viewport = viewportReference.current;
    if (!viewport) return;
    function measureViewport() {
      if (!viewport || viewport.clientWidth <= 0 || viewport.clientHeight <= 0)
        return;
      const bounds = viewport.getBoundingClientRect();
      setViewportSize({
        width: Math.floor(bounds.width),
        height: Math.floor(bounds.height),
      });
    }
    const observer = new ResizeObserver(measureViewport);
    observer.observe(viewport);
    measureViewport();
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const viewport = viewportReference.current;
    if (!viewport) return;
    viewport.scrollLeft =
      zoomCenterReference.current.x * viewport.scrollWidth -
      viewport.clientWidth / 2;
    viewport.scrollTop =
      zoomCenterReference.current.y * viewport.scrollHeight -
      viewport.clientHeight / 2;
  }, [zoom]);

  useLayoutEffect(() => {
    const surface = surfaceReference.current;
    const viewport = viewportReference.current;
    const map = mapReference.current;
    const popup = confirmationReference.current;
    if (!hasConfirmation || !selectedPoint || !surface || !viewport || !map || !popup)
      return;

    const positionConfirmation = () => {
      const transformation = map.getScreenCTM();
      if (!transformation || !viewport.clientWidth || !viewport.clientHeight) {
        popup.style.visibility = "hidden";
        return;
      }
      const anchor = new DOMPoint(selectedPoint.x, selectedPoint.y).matrixTransform(transformation);
      const viewportBounds = viewport.getBoundingClientRect();
      const surfaceBounds = surface.getBoundingClientRect();
      popup.style.maxHeight = `${Math.max(0, viewport.clientHeight - 16)}px`;
      const popupBounds = popup.getBoundingClientRect();
      const targetBounds = map.querySelector<SVGGElement>('[role="button"][aria-pressed="true"]')?.getBoundingClientRect() ?? {
        left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y,
      };
      const minimumLeft = viewportBounds.left + viewport.clientLeft + 8;
      const minimumTop = viewportBounds.top + viewport.clientTop + 8;
      const maximumLeft = Math.max(minimumLeft, minimumLeft + viewport.clientWidth - 16 - popupBounds.width);
      const maximumTop = Math.max(minimumTop, minimumTop + viewport.clientHeight - 16 - popupBounds.height);
      const below = targetBounds.bottom + 12;
      const above = targetBounds.top - 12 - popupBounds.height;
      let left = anchor.x - popupBounds.width / 2;
      let top = below;
      if (below > maximumTop) {
        if (above >= minimumTop) top = above;
        else if (targetBounds.right + 12 <= maximumLeft) {
          left = targetBounds.right + 12;
          top = anchor.y - popupBounds.height / 2;
        } else if (targetBounds.left - 12 - popupBounds.width >= minimumLeft) {
          left = targetBounds.left - 12 - popupBounds.width;
          top = anchor.y - popupBounds.height / 2;
        } else if (minimumTop - above < below - maximumTop) top = above;
      }
      popup.style.left = `${Math.max(minimumLeft, Math.min(maximumLeft, left)) - surfaceBounds.left - surface.clientLeft}px`;
      popup.style.top = `${Math.max(minimumTop, Math.min(maximumTop, top)) - surfaceBounds.top - surface.clientTop}px`;
      popup.style.visibility = "visible";
    };

    const observer = new ResizeObserver(positionConfirmation);
    observer.observe(viewport);
    observer.observe(map);
    observer.observe(popup);
    viewport.addEventListener("scroll", positionConfirmation, { passive: true });
    positionConfirmation();
    return () => {
      observer.disconnect();
      viewport.removeEventListener("scroll", positionConfirmation);
    };
  }, [hasConfirmation, selectedId, selectedPoint?.x, selectedPoint?.y, zoom, viewportSize.width, viewportSize.height]);

  useLayoutEffect(() => {
    const button = confirmButtonReference.current;
    if (hasConfirmation && button?.getClientRects().length) {
      button.focus({ preventScroll: true });
    }
  }, [hasConfirmation, selectedId]);

  function cancelConfirmation() {
    const target = mapReference.current?.querySelector<SVGGElement>('[role="button"][aria-pressed="true"]');
    keyboardTargetReference.current = null;
    confirmation?.onCancel();
    if (target?.isConnected && target.getClientRects().length && !target.closest("[inert]")) {
      target.focus({ preventScroll: true });
    }
  }

  function changeZoom(nextZoom: number) {
    const viewport = viewportReference.current;
    if (viewport) {
      zoomCenterReference.current = {
        x:
          (viewport.scrollLeft + viewport.clientWidth / 2) /
          viewport.scrollWidth,
        y:
          (viewport.scrollTop + viewport.clientHeight / 2) /
          viewport.scrollHeight,
      };
    }
    setZoom(Math.min(2.5, Math.max(1, nextZoom)));
  }

  function terrainResourceName(terrain: Terrain) {
    return isResource(terrain) ? resourceName(language, terrain).toLowerCase()
      : translateText(terrain === "sea" ? "Sea" : terrain === "gold" ? "Gold fields" : "Desert").toLowerCase();
  }

  function targetProperties(
    kind: "vertex" | "edge" | "tile",
    id: string,
    label: string,
  ) {
    return {
      role: "button" as const,
      tabIndex: 0,
      "aria-label": label,
      "aria-pressed": selectedId === id,
      className: "cursor-pointer outline-none",
      onClick: () => {
        keyboardTargetReference.current = null;
        onSelect?.(kind, id);
      },
      onKeyDown: (event: KeyboardEvent<SVGGElement>) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          if (!event.repeat) keyboardTargetReference.current = { id, key: event.key };
        }
      },
      onKeyUp: (event: KeyboardEvent<SVGGElement>) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          // Finish the selecting key before moving focus to the native Confirm button.
          const target = keyboardTargetReference.current;
          keyboardTargetReference.current = null;
          if (target?.id === id && target.key === event.key) onSelect?.(kind, id);
        }
      },
      onFocus: () => setFocusedId(id),
      onBlur: () => {
        if (keyboardTargetReference.current?.id === id) keyboardTargetReference.current = null;
        setFocusedId(null);
      },
    };
  }

  return (
    <div
      ref={surfaceReference}
      data-theme={theme.id}
      data-variant={board.variant ?? "original"}
      style={{ backgroundColor: theme.surface, borderColor: theme.id === "illustrated" ? "#dcd7c7" : theme.border }}
      className={`board-surface relative isolate w-full min-w-0 overflow-hidden rounded-[1.5rem] border border-[#dcd7c7] bg-[#f4f0e5] text-[#394b42] shadow-[0_8px_30px_-18px_#354c45] ${fit ? "board-surface-fit flex h-full min-h-0 flex-col" : ""}`}
      onKeyDown={(event) => {
        if (event.key === "Escape" && hasConfirmation) {
          event.preventDefault();
          event.stopPropagation();
          cancelConfirmation();
        }
      }}
    >
      {!compact && (
        <div
          className="pointer-events-none absolute left-5 top-4 z-10 hidden sm:block"
          aria-hidden="true"
        >
          <p className="text-[10px] font-bold tracking-[0.24em] text-[#687b6e]" style={theme.id === "illustrated" ? undefined : { color: theme.terrain.ore.ink }}>
            {translateText("THE ISLAND")}
          </p>
          <p className="mt-1 font-serif text-xs italic text-[#7c8879]" style={theme.id === "illustrated" ? undefined : { color: theme.terrain.ore.ink }}>
            {translateText("A place to begin.")}
          </p>
        </div>
      )}
      <div
        ref={viewportReference}
        role="region"
        aria-label={translateText("Island map. Use the zoom controls to enlarge, then scroll or drag to pan.")}
        tabIndex={zoom > 1 ? 0 : -1}
        className={`board-viewport w-full overflow-auto overscroll-contain outline-offset-[-3px] focus-visible:outline-2 focus-visible:outline-[#8b6438] ${fit ? "min-h-0 flex-1" : ""} ${zoom > 1 ? "cursor-grab active:cursor-grabbing" : ""}`}
        style={{
          aspectRatio: fit ? undefined : `${viewWidth} / ${viewHeight}`,
          touchAction: "pan-x pan-y",
          backgroundImage: fillBoardWithWater
            ? `radial-gradient(ellipse 65% 65% at 48% 43%, ${theme.sea[0]} 0%, ${theme.sea[1]} 78%, ${theme.sea[2]} 100%)`
            : undefined,
        }}
        onPointerDown={(event) => {
          if (zoom === 1 || event.pointerType !== "mouse" || event.button !== 0)
            return;
          if ((event.target as Element).closest('[role="button"]')) return;
          const viewport = event.currentTarget;
          panReference.current = {
            x: event.clientX,
            y: event.clientY,
            left: viewport.scrollLeft,
            top: viewport.scrollTop,
          };
          viewport.setPointerCapture(event.pointerId);
          event.preventDefault();
        }}
        onPointerMove={(event) => {
          const pan = panReference.current;
          if (!pan) return;
          event.currentTarget.scrollLeft = pan.left - event.clientX + pan.x;
          event.currentTarget.scrollTop = pan.top - event.clientY + pan.y;
        }}
        onPointerUp={(event) => {
          panReference.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
        onPointerCancel={() => {
          panReference.current = null;
        }}
        onLostPointerCapture={() => {
          panReference.current = null;
        }}
      >
        <div
          className="board-map"
          style={{
            width: fit
              ? Math.max(viewportSize.width, mapWidth * zoom)
              : `${zoom * 100}%`,
            height: fit
              ? Math.max(viewportSize.height, (mapWidth * zoom * viewHeight) / viewWidth)
              : undefined,
            aspectRatio: fit ? undefined : `${viewWidth} / ${viewHeight}`,
          }}
        >
          <svg
            ref={mapReference}
            viewBox={`${-halfWidth} ${-halfHeight} ${viewWidth} ${viewHeight}`}
            className="block h-full w-full select-none"
            role="group"
            aria-labelledby={`${illustrationId}-title ${illustrationId}-description`}
            fontFamily="ui-sans-serif, system-ui, sans-serif"
          >
            <title id={`${illustrationId}-title`}>{translateText("Catan island")}</title>
            <desc id={`${illustrationId}-description`}>
              {translateText(canSelect
                ? "{tiles} terrain hexes and {ports} coastal harbors. Numbers show dice rolls; dots show their probability. Pieces carry their player's number. Highlighted locations can be selected with Enter or Space."
                : "{tiles} terrain hexes and {ports} coastal harbors. Numbers show dice rolls; dots show their probability. Pieces carry their player's number. Read-only board.",
              { tiles: board.tiles.length, ports: board.ports.length })}
            </desc>
            <defs>
              <radialGradient
                id={`${illustrationId}-sea`}
                cx="48%"
                cy="43%"
                r="65%"
              >
                <stop offset="0" stopColor={theme.sea[0]} />
                <stop offset="0.78" stopColor={theme.sea[1]} />
                <stop offset="1" stopColor={theme.sea[2]} />
              </radialGradient>
              <pattern
                id={`${illustrationId}-texture`}
                width={theme.id === "illustrated" ? 17 : 24}
                height={theme.id === "illustrated" ? 19 : 24}
                patternUnits="userSpaceOnUse"
              >
                {theme.id === "ceramic" && <path d="M0 0H24V24H0ZM0 12H24M12 0V24" fill="none" stroke="#fffdf4" strokeWidth=".8" opacity=".2" />}
                {theme.id === "wooden" && <path d="M-4 5Q6 1 15 5T28 5M-4 12Q6 8 15 12T28 12M-4 20Q6 16 15 20T28 20" fill="none" stroke="#54361e" strokeWidth=".65" opacity=".2" />}
                {theme.id === "pixel" && <path d="M0 0H4V4H0ZM12 12H16V16H12Z" fill="#ffffff" opacity=".12" />}
                {theme.id === "space" && <path d="M12 2V6M10 4H14M0 24 24 0" stroke="#b9e7ff" strokeWidth=".5" opacity=".18" />}
                {theme.id === "underwater" && <circle cx="12" cy="12" r="6" fill="none" stroke="#d5fff6" strokeWidth=".6" opacity=".16" />}
                <circle cx="3" cy="5" r="0.65" fill="#fff9e7" opacity="0.25" />
                <circle
                  cx="13"
                  cy="14"
                  r="0.55"
                  fill="#394f40"
                  opacity="0.09"
                />
              </pattern>
              <filter
                id={`${illustrationId}-shadow`}
                x="-20%"
                y="-20%"
                width="140%"
                height="145%"
              >
                <feDropShadow
                  dx="0"
                  dy="4"
                  stdDeviation="4"
                  floodColor="#294f46"
                  floodOpacity="0.2"
                />
              </filter>
              <g
                id={`${illustrationId}-tree`}
                stroke="#375947"
                strokeWidth="1.3"
                strokeLinejoin="round"
              >
                <path d="M0 12V24" strokeWidth="2.4" />
                <path d="M0-22 12-3H7L16 12H-16L-7-3H-12Z" fill="#4d7155" />
                <path d="M0-22V12H-16L-7-3H-12Z" fill="#608363" stroke="none" />
              </g>
              <g
                id={`${illustrationId}-wheat`}
                fill="none"
                stroke="#9b793b"
                strokeWidth="1.8"
                strokeLinecap="round"
              >
                <path d="M0 21V-18M0 9Q-10 5-8-2Q0 0 0 9M0 1Q10-3 8-10Q0-8 0 1M0-7Q-9-11-6-17Q0-16 0-7M0-14Q6-18 4-23Q0-21 0-14" />
              </g>
              <g
                id={`${illustrationId}-sheep`}
                stroke="#68734f"
                strokeWidth="1.3"
                strokeLinejoin="round"
              >
                <path d="M-7 5V11M6 5V11" fill="none" strokeWidth="2" />
                <path
                  d="M-12 0C-17-8-10-13-5-10C-3-16 5-14 7-10C15-12 18-4 13 0C17 8 8 11 4 7C-2 12-10 9-10 5C-16 6-18 1-12 0Z"
                  fill="#faf5df"
                />
                <ellipse cx="12" cy="1" rx="5" ry="6" fill="#647052" />
                <path d="M10-5 7-8M15-4 19-6" />
                <circle cx="13" cy="0" r="0.8" fill="#faf5df" stroke="none" />
              </g>
              <g id={`${illustrationId}-wood`}>
                <path
                  d="M-46 26Q-20 11 1 23T46 23M-38 32Q-14 22 9 32"
                  fill="none"
                  stroke="#577755"
                  strokeWidth="1.5"
                  opacity="0.6"
                />
                <use
                  href={`#${illustrationId}-tree`}
                  transform="translate(-27 -10) scale(.85)"
                />
                <use
                  href={`#${illustrationId}-tree`}
                  transform="translate(1 -24) scale(.8)"
                />
                <use
                  href={`#${illustrationId}-tree`}
                  transform="translate(29 -8) scale(.95)"
                />
                <use
                  href={`#${illustrationId}-tree`}
                  transform="translate(-26 16) scale(.62)"
                />
                <use
                  href={`#${illustrationId}-tree`}
                  transform="translate(25 20) scale(.55)"
                />
              </g>
              <g
                id={`${illustrationId}-brick`}
                stroke="#945c47"
                strokeWidth="1.4"
                strokeLinejoin="round"
              >
                <path
                  d="M-47 5-33-21-16-12 2-37 20-18 30-22 48 8 30 23H-31Z"
                  fill="#b97860"
                  stroke="none"
                />
                <path
                  d="M-33-21-19 3-8-12M2-37 8-17 20-18M30-22 38 1"
                  fill="none"
                  stroke="#e1ac8c"
                />
                <path
                  d="M-41 12H-18V23H-41ZM-33 24H-10V34H-33ZM19 10H41V21H19ZM13 23H35V33H13Z"
                  fill="#c38c6b"
                />
                <path d="M-30 12V23M30 10V21M24 23V33" />
                <path d="M-40 14H-20M21 12H39" stroke="#e6b899" />
              </g>
              <g id={`${illustrationId}-wool`}>
                <path
                  d="M-47 10Q-26-15-4 0Q19-15 47 5L43 25Q17 9-1 22Q-24 10-43 30Z"
                  fill="#9eaf78"
                />
                <path
                  d="M-42 30Q-20 14 0 26Q22 14 42 27M-36-21l2-6 3 5M29-20l3-6 3 5M-12-33l3-5 3 4"
                  fill="none"
                  stroke="#819460"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                />
                <use
                  href={`#${illustrationId}-sheep`}
                  transform="translate(-28 7) scale(.78)"
                />
                <use
                  href={`#${illustrationId}-sheep`}
                  transform="translate(27 -10) scale(.8)"
                />
              </g>
              <g id={`${illustrationId}-grain`}>
                <path
                  d="M-45 21Q0 5 44 23M-37 29Q0 15 37 31M-25 37Q0 26 25 38"
                  fill="none"
                  stroke="#b18c43"
                  strokeWidth="1.4"
                  opacity="0.7"
                />
                <use
                  href={`#${illustrationId}-wheat`}
                  transform="translate(-28 -3) rotate(-12)"
                />
                <use
                  href={`#${illustrationId}-wheat`}
                  transform="translate(27 -4) rotate(12)"
                />
                <use
                  href={`#${illustrationId}-wheat`}
                  transform="translate(-4 -25) scale(.6)"
                />
                <use
                  href={`#${illustrationId}-wheat`}
                  transform="translate(39 9) scale(.55)"
                />
              </g>
              <g id={`${illustrationId}-ore`} strokeLinejoin="round">
                <path
                  d="M-49 19-26-25-11-7 7-43 46 18Z"
                  fill="#6b8183"
                  stroke="#576f74"
                  strokeWidth="1.4"
                />
                <path d="M7-43 7 18H46ZM-26-25-26 19H-3Z" fill="#809597" />
                <path
                  d="M7-43-4-21 5-25 12-19 19-25ZM-26-25-34-10-26-14-19-9Z"
                  fill="#e1e5d6"
                />
                <path
                  d="M-44 27-35 18-25 26-30 34ZM23 28 32 18 42 24 36 34Z"
                  fill="#819496"
                  stroke="#596f72"
                  strokeWidth="1.3"
                />
                <path
                  d="M-35 18-35 28-30 34M32 18 32 27 42 24"
                  fill="none"
                  stroke="#bccac1"
                  strokeWidth="1.2"
                />
              </g>
              <g id={`${illustrationId}-desert`}>
                <circle
                  cx="23"
                  cy="-22"
                  r="10"
                  fill="#eddbaf"
                  stroke="#bc945f"
                  strokeWidth="1.2"
                />
                <path
                  d="M-48 13Q-25-11-1 9Q24 25 47 3L44 25Q17 12-2 29Q-23 9-43 30Z"
                  fill="#c5a374"
                />
                <path
                  d="M-44 23Q-22 3 1 20M8 31Q27 17 39 25M-31-18l8-3M-17-29l7-2"
                  fill="none"
                  stroke="#ae8b5b"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </g>
            </defs>

            <g aria-hidden="true">
              {!fillBoardWithWater && (
                <>
                  <path
                    d="M-302-159C-273-260-165-318-40-315C95-340 245-274 296-169C350-67 332 92 267 195C198 291 72 322-42 309C-169 321-286 244-315 129C-345 26-341-54-302-159Z"
                    transform={`scale(${halfWidth / 355} ${halfHeight / 337})`}
                    fill={`url(#${illustrationId}-sea)`}
                  />
                  <ellipse
                    rx={halfWidth - 25}
                    ry={halfHeight - 24}
                    fill="none"
                    stroke="#86aca1"
                    strokeWidth="0.8"
                    strokeDasharray="2 7"
                    opacity="0.55"
                  />
                </>
              )}
              <path
                d="M-287-103q8-5 16 0t16 0M-306-88q8-5 16 0t16 0M240 134q8-5 16 0t16 0M250 148q8-5 16 0t16 0M-189 250q8-5 16 0t16 0M95-279q8-5 16 0t16 0M108-265q8-5 16 0t16 0"
                fill="none"
                stroke="#6e9c91"
                strokeWidth="1.4"
                strokeLinecap="round"
                opacity="0.55"
              />
              <g
                transform={`translate(${halfWidth - 55} ${-halfHeight + 55})`}
                fill="none"
                stroke="#80998a"
                opacity="0.8"
              >
                <circle r="18" strokeWidth="0.7" />
                <path d="M0-25V25M-25 0H25" strokeWidth="0.7" />
                <path
                  d="M0-18 4 0 0 18-4 0Z"
                  fill="#80998a"
                  strokeWidth="0.8"
                />
                <text
                  y="-31"
                  textAnchor="middle"
                  fill="#718b7c"
                  stroke="none"
                  fontSize="9"
                  letterSpacing="2"
                >
                  {translateText("N")}
                </text>
              </g>
              <g
                filter={`url(#${illustrationId}-shadow)`}
                stroke={theme.coast}
                strokeWidth="14"
                strokeLinecap="round"
              >
                {edgeGeometry
                  .filter(({ coastal }) => coastal)
                  .map(({ edge, start, end }) => (
                    <line
                      key={edge.id}
                      x1={start.x}
                      y1={start.y}
                      x2={end.x}
                      y2={end.y}
                    />
                  ))}
              </g>
            </g>

            {/* Paint raised terrain last, beneath pieces and fixed interaction targets. */}
            {board.tiles.toSorted((left, right) => Number(raisedTileIds.has(left.id)) - Number(raisedTileIds.has(right.id))).map((tile) => {
              const terrain = theme.terrain[tile.terrain];
              const points = tile.vertexIds
                .map((id) => {
                  const vertex = verticesById.get(id)!;
                  return `${vertex.x},${vertex.y}`;
                })
                .join(" ");
              const probability =
                tile.number === null ? 0 : 6 - Math.abs(7 - tile.number);
              const frequent = tile.number === 6 || tile.number === 8;
              const matchesRoll = tile.number !== null && tile.number === rolledNumber;
              const blocked = matchesRoll && robberTileId === tile.id;
              const raised = raisedTileIds.has(tile.id);
              let description = translateText(tile.number === null
                ? "{terrain}, {resource}, no production"
                : "{terrain}, {resource}, roll {number}, {probability} chances out of 36", {
                terrain: getTerrainName(theme, tile.terrain, language),
                resource: terrainResourceName(tile.terrain),
                number: tile.number ?? "",
                probability,
              });
              if (robberTileId === tile.id) description = translateText("{description}, blocked by the robber", { description });
              if (producingTileIds.includes(tile.id)) description = translateText("{description}, produced resources this roll", { description });
              return (
                <g
                  key={tile.id}
                  className={`terrain-hex${raised ? " terrain-hex-raised" : ""}`}
                  transform={raised ? `translate(0 ${-tileElevation})` : undefined}
                  pointerEvents="none"
                  role="img"
                  aria-label={description}
                >
                  <polygon
                    points={points}
                    transform={`translate(0 ${2.5 + (raised ? tileElevation : 0)})`}
                    fill="#887753"
                    stroke="#887753"
                    strokeWidth="3"
                    strokeLinejoin="round"
                    opacity={raised ? "0.85" : "0.45"}
                    pointerEvents="none"
                  />
                  <polygon
                    points={points}
                    fill={terrain.fill}
                    stroke={theme.border}
                    strokeWidth="3"
                    strokeLinejoin="round"
                  />
                  <polygon
                    points={points}
                    fill={`url(#${illustrationId}-texture)`}
                    pointerEvents="none"
                  />
                  {theme.id === "illustrated" && tile.terrain !== "sea" && tile.terrain !== "gold" ? (
                    <use
                      href={`#${illustrationId}-${tile.terrain}`}
                      transform={`translate(${tile.x} ${tile.y})`}
                    />
                  ) : (
                    <g transform={`translate(${tile.x} ${tile.y})`}>
                      <TerrainArtwork terrain={tile.terrain} theme={theme} />
                    </g>
                  )}
                  <text
                    x={tile.x}
                    y={tile.y + 43}
                    textAnchor="middle"
                    fill={terrain.ink}
                    fontSize="7.5"
                    fontWeight="700"
                    letterSpacing="1.5"
                  >
                    {getTerrainName(theme, tile.terrain, language).toUpperCase()}
                  </text>
                  {tile.number !== null && (
                    <g
                      className={`number-token${matchesRoll ? " number-token-highlight" : ""}${blocked ? " number-token-blocked" : ""}`}
                      transform={`translate(${tile.x} ${tile.y + 2})`}
                    >
                      {matchesRoll && (
                        <circle
                          className="number-token-halo"
                          r="25"
                          fill={blocked ? "none" : "#f4cf75"}
                          fillOpacity="0.3"
                          stroke={blocked ? "#817d71" : "#ae772c"}
                          strokeWidth={blocked ? "1.5" : "2"}
                          strokeDasharray={blocked ? "3 4" : undefined}
                          opacity={blocked ? "0.7" : "1"}
                          pointerEvents="none"
                        />
                      )}
                      <circle cy="3" r="19.5" fill="#35453a" opacity="0.22" />
                      <circle cy="1.5" r="19" fill="#b8a27b" />
                      <circle
                        className="number-token-face"
                        r="19"
                        fill={blocked ? "#e6e1d4" : matchesRoll ? "#ffecab" : "#fbf4df"}
                        stroke={blocked ? "#887f6c" : matchesRoll ? "#ac6b24" : "#c8b998"}
                        strokeWidth={matchesRoll ? "2.2" : "1.3"}
                      />
                      <circle
                        r="16.3"
                        fill="none"
                        stroke={blocked ? "#bbb29e" : matchesRoll ? "#d7ad51" : "#e7ddc5"}
                        strokeWidth="0.7"
                      />
                      <text
                        y="4.5"
                        textAnchor="middle"
                        fontFamily="Georgia, 'Times New Roman', serif"
                        fontSize="23"
                        fontWeight="700"
                        fill={frequent ? "#b14e38" : "#394b42"}
                      >
                        {tile.number}
                      </text>
                      {Array.from({ length: probability }, (_, index) => (
                        <circle
                          key={index}
                          cx={(index - (probability - 1) / 2) * 4.3}
                          cy="11"
                          r="1.35"
                          fill={frequent ? "#b14e38" : "#59644f"}
                        />
                      ))}
                    </g>
                  )}
                  {selectedId === tile.id && !legalTiles.has(tile.id) && (
                    <polygon
                      points={points}
                      fill="none"
                      stroke="#815b2b"
                      strokeWidth="4"
                      strokeLinejoin="round"
                    />
                  )}
                </g>
              );
            })}

            <g
              aria-hidden="true"
              stroke="#b8a777"
              strokeWidth="1.2"
              strokeLinecap="round"
              opacity="0.75"
            >
              {edgeGeometry
                .filter(({ coastal }) => coastal)
                .map(({ edge, start, end }) => (
                  <line
                    key={edge.id}
                    x1={start.x}
                    y1={start.y}
                    x2={end.x}
                    y2={end.y}
                  />
                ))}
            </g>

            {board.ports.map((port) => {
              const { x, y } = edgeGeometry.find(
                ({ edge }) => edge.id === port.edgeId,
              )!;
              const distance = Math.hypot(x, y);
              const edge = board.edges.find(edge => edge.id === port.edgeId)!;
              const land = edgeTiles(board, edge).find(tile => tile.terrain !== "sea")!;
              const coastDistance = Math.hypot(x - land.x, y - land.y);
              const directionX = board.variant === "seafarers" ? (x - land.x) / coastDistance : x / distance;
              const directionY = board.variant === "seafarers" ? (y - land.y) / coastDistance : y / distance;
              const portX = x + directionX * 51;
              const portY = y + directionY * 51;
              const ratio = port.resource === "any" ? "3:1" : "2:1";
              return (
                <g
                  key={port.edgeId}
                  role="img"
                  aria-label={port.resource === "any"
                    ? translateText("Any resource harbor, trade {ratio}", { ratio })
                    : translateText("{resource} harbor, trade {ratio}", { resource: resourceName(language, port.resource).toLowerCase(), ratio })}
                >
                  <path
                    d={`M${x + directionX * 8} ${y + directionY * 8}L${portX} ${portY}`}
                    stroke="#e8d8ac"
                    strokeWidth="8"
                  />
                  <path
                    d={`M${x + directionX * 8} ${y + directionY * 8}L${portX} ${portY}`}
                    stroke="#9a8864"
                    strokeWidth="1.4"
                    strokeDasharray="2 3"
                  />
                  <g transform={`translate(${portX} ${portY})`}>
                    <rect
                      x="-27"
                      y="-15"
                      width="54"
                      height="33"
                      rx="9"
                      fill="#547f72"
                      opacity="0.12"
                    />
                    <rect
                      x="-27"
                      y="-17"
                      width="54"
                      height="33"
                      rx="9"
                      fill="#f7f0d9"
                      stroke="#a8b6a0"
                      strokeWidth="1"
                    />
                    <text
                      y="-2"
                      textAnchor="middle"
                      fill="#425c4d"
                      fontSize="13"
                      fontWeight="750"
                      fontFamily="Georgia, 'Times New Roman', serif"
                    >
                      {ratio}
                    </text>
                    <text
                      y="9"
                      textAnchor="middle"
                      fill="#61715c"
                      fontSize="7.5"
                      fontWeight="700"
                      letterSpacing="0.8"
                    >
                      {port.resource === "any" ? translateText("ANY") : resourceName(language, port.resource).toUpperCase()}
                    </text>
                  </g>
                </g>
              );
            })}

            {board.tiles
              .filter((tile) => legalTiles.has(tile.id))
              .map((tile) => {
                const highlighted =
                  selectedId === tile.id || focusedId === tile.id;
                const points = tile.vertexIds
                  .map((id) => {
                    const vertex = verticesById.get(id)!;
                    return `${vertex.x},${vertex.y}`;
                  })
                  .join(" ");
                return (
                  <g
                    key={tile.id}
                    {...targetProperties(
                      "tile",
                      tile.id,
                      tile.terrain === "sea" ? translateText("Move pirate to sea") : translateText(tile.number === null ? "Move robber to {resource}" : "Move robber to {resource} {number}", {
                        resource: terrainResourceName(tile.terrain), number: tile.number ?? "",
                      }),
                    )}
                  >
                    <polygon points={points} fill="transparent" />
                    <polygon
                      points={points}
                      transform={raisedTileIds.has(tile.id) ? `translate(0 ${-tileElevation})` : undefined}
                      fill={highlighted ? "#fff5cb" : "transparent"}
                      fillOpacity={highlighted ? "0.2" : "1"}
                      stroke={highlighted ? "#553e20" : "#fff4d4"}
                      strokeWidth={highlighted ? "5" : "2.5"}
                      strokeDasharray={highlighted ? undefined : "5 5"}
                      strokeLinejoin="round"
                      pointerEvents="none"
                    />
                    {highlighted && (
                      <polygon
                        points={points}
                        transform={`translate(0 ${-tileElevation})`}
                        fill="none"
                        stroke="#fff5d8"
                        strokeWidth="1"
                        strokeLinejoin="round"
                        pointerEvents="none"
                      />
                    )}
                  </g>
                );
              })}

            {edgeGeometry
              .filter(({ edge }) => edge.playerId)
              .map(({ edge, start, end, x, y }) => {
                const player = playersById.get(edge.playerId!)!;
                if (edge.kind === "ship") return <g key={edge.id} role="img"
                  aria-label={translateText("{player}'s ship at {location}", { player: player.name, location: edge.id })}
                  transform={`translate(${x} ${y})`} pointerEvents="none">
                  {selectedId === edge.id && <ellipse rx="23" ry="27" fill="none" stroke="#8c672e" strokeWidth="3" />}
                  <path d="M-19 6h38l-7 12H-12Z" fill={player.color} stroke="#fff5dc" strokeWidth="2" />
                  <path d="M0-22V6M3-20 18 2H3ZM-4-15-16 2h12Z" fill={player.color} stroke="#fff5dc" strokeWidth="1.5" />
                  <text y="15" textAnchor="middle" fill="#fff5dc" fontSize="8" fontWeight="800">
                    {players.findIndex(candidate => candidate.id === player.id) + 1}
                  </text>
                </g>;
                return (
                  <g
                    key={edge.id}
                    role="img"
                    aria-label={translateText("{player}'s road at {location}", { player: player.name, location: edge.id })}
                    pointerEvents="none"
                  >
                    {selectedId === edge.id && (
                      <line
                        x1={start.x}
                        y1={start.y}
                        x2={end.x}
                        y2={end.y}
                        stroke="#8c672e"
                        strokeWidth="20"
                        strokeLinecap="round"
                      />
                    )}
                    <line
                      x1={start.x}
                      y1={start.y + 2}
                      x2={end.x}
                      y2={end.y + 2}
                      stroke="#364b3a"
                      strokeOpacity="0.3"
                      strokeWidth="13"
                      strokeLinecap="round"
                    />
                    <line
                      x1={start.x}
                      y1={start.y}
                      x2={end.x}
                      y2={end.y}
                      stroke="#fff5dc"
                      strokeWidth="13"
                      strokeLinecap="round"
                    />
                    <line
                      x1={start.x}
                      y1={start.y}
                      x2={end.x}
                      y2={end.y}
                      stroke={player.color}
                      strokeWidth="9"
                      strokeLinecap="round"
                    />
                    <circle
                      cx={x}
                      cy={y}
                      r="7.5"
                      fill="#fff5df"
                      stroke={player.color}
                      strokeWidth="1.5"
                    />
                    <text
                      x={x}
                      y={y + 3}
                      textAnchor="middle"
                      fill="#33483d"
                      fontSize="8.5"
                      fontWeight="800"
                    >
                      {players.findIndex(
                        (candidate) => candidate.id === player.id,
                      ) + 1}
                    </text>
                  </g>
                );
              })}

            {edgeGeometry
              .filter(({ edge }) => legalEdges.has(edge.id))
              .map(({ edge, start, end, x, y }) => {
                const highlighted =
                  selectedId === edge.id || focusedId === edge.id;
                // A generous touch target must never cover another road's visible center.
                const radius = Math.min(
                  hitRadius,
                  ...edgeGeometry
                    .filter(
                      (other) =>
                        other.edge.id !== edge.id &&
                        legalEdges.has(other.edge.id),
                    )
                    .map((other) => Math.hypot(other.x - x, other.y - y) - 1),
                );
                return (
                  <g
                    key={edge.id}
                    {...targetProperties(
                      "edge",
                      edge.id,
                      translateText(routeMode === "move-ship" ? "Move ship at {location}" :
                        routeMode === "ship" || edgeTiles(board, edge).every(tile => tile.terrain === "sea")
                          ? "Build ship at {location}" : "Build road at {location}", { location: edge.id }),
                    )}
                  >
                    <circle cx={x} cy={y} r={radius} fill="transparent" />
                    <line
                      x1={start.x * 0.85 + end.x * 0.15}
                      y1={start.y * 0.85 + end.y * 0.15}
                      x2={start.x * 0.15 + end.x * 0.85}
                      y2={start.y * 0.15 + end.y * 0.85}
                      stroke="#fff4d4"
                      strokeWidth={highlighted ? "12" : "9"}
                      strokeLinecap="round"
                      pointerEvents="none"
                    />
                    <line
                      x1={start.x * 0.85 + end.x * 0.15}
                      y1={start.y * 0.85 + end.y * 0.15}
                      x2={start.x * 0.15 + end.x * 0.85}
                      y2={start.y * 0.15 + end.y * 0.85}
                      stroke={highlighted ? "#664b28" : "#b48b45"}
                      strokeWidth={highlighted ? "7" : "4"}
                      strokeDasharray={highlighted ? undefined : "3 6"}
                      strokeLinecap="round"
                      pointerEvents="none"
                    />
                    <circle
                      cx={x}
                      cy={y}
                      r={highlighted ? 8 : 6}
                      fill={highlighted ? "#664b28" : "#fff4d4"}
                      stroke="#a77a3a"
                      strokeWidth="1.4"
                      pointerEvents="none"
                    />
                    <path
                      d={`M${x - 2.5} ${y}h5M${x} ${y - 2.5}v5`}
                      stroke={highlighted ? "#fff4d4" : "#8a642d"}
                      strokeWidth="1.3"
                      pointerEvents="none"
                    />
                  </g>
                );
              })}

            {blockedVertices.map((vertexId) => {
              const vertex = verticesById.get(vertexId)!;
              return (
                <g
                  key={vertexId}
                  transform={`translate(${vertex.x} ${vertex.y})`}
                  role="img"
                  aria-label={translateText("Settlement blocked at {location}: adjacent settlement or city", { location: vertexId })}
                  pointerEvents="none"
                >
                  <circle r="9" fill="#f4f0e5" fillOpacity="0.9" />
                  <path d="M-4-4 4 4M-4 4 4-4" fill="none" stroke="#775f55" strokeWidth="1.5" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                </g>
              );
            })}

            {board.vertices
              .filter((vertex) => vertex.building)
              .map((vertex) => {
                const building = vertex.building!;
                const player = playersById.get(building.playerId)!;
                const city = building.kind === "city";
                return (
                  <g
                    key={vertex.id}
                    transform={`translate(${vertex.x} ${vertex.y})`}
                    role="img"
                    aria-label={translateText("{player}'s {piece} at {location}", { player: player.name, piece: pieceName(language, building.kind), location: vertex.id })}
                    pointerEvents="none"
                  >
                    <ellipse
                      cy="10"
                      rx={city ? "19" : "15"}
                      ry="6"
                      fill="#35483c"
                      opacity="0.23"
                    />
                    {selectedId === vertex.id && (
                      <circle
                        r="24"
                        fill="none"
                        stroke="#805e2c"
                        strokeWidth="3"
                        strokeDasharray="4 3"
                      />
                    )}
                    <path
                      d={
                        city
                          ? "M-17 10V-6L-9-15-1-6V-1H3V-13L11-21 19-13V10Z"
                          : "M-13 11V-5L0-17 13-5V11Z"
                      }
                      fill={player.color}
                      stroke="#fff7df"
                      strokeWidth="5"
                      strokeLinejoin="round"
                    />
                    <path
                      d={
                        city
                          ? "M-17 10V-6L-9-15-1-6V-1H3V-13L11-21 19-13V10Z"
                          : "M-13 11V-5L0-17 13-5V11Z"
                      }
                      fill={player.color}
                      stroke="#39483e"
                      strokeWidth="1.5"
                      strokeLinejoin="round"
                    />
                    <path
                      d={
                        city
                          ? "M-17-6-9-15-1-6M3-13 11-21 19-13"
                          : "M-13-5 0-17 13-5"
                      }
                      fill="none"
                      stroke="#fff6da"
                      strokeOpacity="0.5"
                      strokeWidth="1.5"
                    />
                    <rect
                      x="-5.5"
                      y="-2"
                      width="11"
                      height="12"
                      rx="2"
                      fill="#fff5dc"
                    />
                    <text
                      y="7"
                      textAnchor="middle"
                      fill="#35483d"
                      fontSize="9"
                      fontWeight="800"
                    >
                      {players.findIndex(
                        (candidate) => candidate.id === player.id,
                      ) + 1}
                    </text>
                    {city && <path d="M9-9h4v5H9Z" fill="#fff5dc" />}
                  </g>
                );
              })}

            {board.tiles.filter(tile => tile.id === pirateTileId).map(tile => <g key={`pirate-${tile.id}`}
              transform={`translate(${tile.x} ${tile.y - 6})`} role="img"
              aria-label={translateText("Pirate; adjacent ships cannot be built or moved")} pointerEvents="none">
              <path d="M-21 7h42l-8 12H-13ZM0-26V7M3-24 19 3H3Z" fill="#253b36" stroke="#fff5dc" strokeWidth="2" />
              <path d="m8-8 6 6m0-6-6 6" stroke="#fff5dc" strokeWidth="2" />
            </g>)}
            {board.tiles
              .filter((tile) => tile.id === robberTileId)
              .map((tile) => (
                <g
                  key={tile.id}
                  transform={`translate(${tile.x + 24} ${tile.y + 18 - (raisedTileIds.has(tile.id) ? tileElevation : 0)})`}
                  role="img"
                  aria-label={translateText(tile.number === null ? "Robber on {resource}; production blocked" : "Robber on {resource} {number}; production blocked", {
                    resource: terrainResourceName(tile.terrain), number: tile.number ?? "",
                  })}
                  pointerEvents="none"
                >
                  <ellipse
                    cy="13"
                    rx="13"
                    ry="4"
                    fill="#243b35"
                    opacity="0.25"
                  />
                  <path
                    d="M-10 11Q-12 8-8 3L-5-4Q-11-12-5-17Q0-21 5-17Q11-12 5-4L8 3Q12 8 10 11Z"
                    fill="#36443e"
                    stroke="#f8edcf"
                    strokeWidth="2"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M-3-15Q-6-12-3-9M-5 5-3-1"
                    fill="none"
                    stroke="#829084"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                  <path d="M-8 8H8" stroke="#1f2f29" strokeWidth="2" />
                </g>
              ))}

            {board.vertices
              .filter((vertex) => legalVertices.has(vertex.id))
              .map((vertex) => {
                const highlighted =
                  selectedId === vertex.id || focusedId === vertex.id;
                const occupied = Boolean(vertex.building);
                const radius = Math.min(
                  hitRadius,
                  ...board.vertices
                    .filter(
                      (other) =>
                        other.id !== vertex.id && legalVertices.has(other.id),
                    )
                    .map(
                      (other) =>
                        Math.hypot(other.x - vertex.x, other.y - vertex.y) - 1,
                    ),
                );
                return (
                  <g
                    key={vertex.id}
                    {...targetProperties(
                      "vertex",
                      vertex.id,
                      translateText(occupied ? "Upgrade to city at {location}" : "Place settlement at {location}", { location: vertex.id }),
                    )}
                  >
                    <circle
                      cx={vertex.x}
                      cy={vertex.y}
                      r={radius}
                      fill="transparent"
                    />
                    <circle
                      cx={vertex.x}
                      cy={vertex.y}
                      r={occupied ? 24 : highlighted ? 17 : 13}
                      fill={occupied ? "none" : "#fff5d9"}
                      fillOpacity="0.75"
                      stroke={highlighted ? "#5d4525" : "#b68c45"}
                      strokeWidth={highlighted ? "3" : "1.5"}
                      strokeDasharray={
                        occupied && !highlighted ? "3 3" : undefined
                      }
                      pointerEvents="none"
                    />
                    {!occupied && (
                      <circle
                        cx={vertex.x}
                        cy={vertex.y}
                        r={highlighted ? 10 : 8}
                        fill={highlighted ? "#76562a" : "#faf2d6"}
                        stroke="#ae8540"
                        strokeWidth="1.5"
                        pointerEvents="none"
                      />
                    )}
                    {!occupied && (
                      <path
                        d={`M${vertex.x - 3.5} ${vertex.y}h7M${vertex.x} ${vertex.y - 3.5}v7`}
                        stroke={highlighted ? "#fff4d4" : "#8b652f"}
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        pointerEvents="none"
                      />
                    )}
                  </g>
                );
              })}
          </svg>
        </div>
      </div>
      {hasConfirmation && confirmation && (
        <div
          ref={confirmationReference}
          role="group"
          aria-label={translateText("Placement confirmation")}
          data-selection-id={selectedId}
          className="placement-confirmation"
          style={{ position: "absolute", left: 0, top: 0, visibility: "hidden" }}
        >
          <p id={`${illustrationId}-confirmation-title`}>{confirmation.title}</p>
          <div>
            <button type="button" className="button-secondary" onClick={cancelConfirmation}>
              {translateText("Cancel")}
            </button>
            <button
              ref={confirmButtonReference}
              type="button"
              aria-label={translateText("Confirm placement")}
              aria-describedby={`${illustrationId}-confirmation-title`}
              className="button-primary"
              onClick={() => {
                const focusWasInConfirmation = confirmationReference.current?.contains(document.activeElement);
                confirmation.onConfirm();
                const viewport = viewportReference.current;
                if (focusWasInConfirmation && viewport?.getClientRects().length && !viewport.closest("[inert]")) {
                  viewport.focus({ preventScroll: true });
                }
              }}
            >
              {translateText("Confirm")}
            </button>
          </div>
        </div>
      )}
      <div
        className={`board-controls flex flex-wrap min-w-0 shrink-0 items-center justify-end gap-2 border-t border-[#e0ddcd] bg-[#f8f5eb] ${compact ? "px-3 py-2" : "px-4 py-3 sm:px-5"}`}
      >
        {routeChoice && <div className="basis-full">{routeChoice}</div>}
        {onMovePirateOffBoard && <button className="button-secondary mr-auto px-2 text-xs" onClick={onMovePirateOffBoard}>
          {translateText("Move pirate off board")}
        </button>}
        {onChangeTheme && (
          <button
            type="button"
            className="board-theme-button"
            onClick={onChangeTheme}
            aria-label={translateText("Change theme")}
            aria-haspopup="dialog"
            title={translateText("Change theme: {theme}", { theme: getThemeName(theme, language) })}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path d="M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1-3.7 1.5 1.5 0 0 1 1-2.8h2a4 4 0 0 0 4-4C21 6 17 3 12 3Z" />
              <circle cx="7.5" cy="10" r="1" /><circle cx="11" cy="6.5" r="1" /><circle cx="16" cy="8" r="1" /><circle cx="7.5" cy="15" r="1" />
            </svg>
            <span className="board-theme-label">{translateText("Theme")}</span>
          </button>
        )}
        <div
          className="flex shrink-0 items-center gap-1"
          role="group"
          aria-label={translateText("Map zoom controls")}
        >
          <button
            type="button"
            aria-label={translateText("Zoom out")}
            disabled={zoom === 1}
            onClick={() => changeZoom(zoom - 0.25)}
            className="flex size-11 items-center justify-center rounded-xl border border-[#dcdccb] bg-[#fffdf5] text-xl text-[#455e4d] transition-colors hover:bg-[#e9edde] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#886636] disabled:cursor-not-allowed disabled:opacity-35"
          >
            -
          </button>
          <output
            aria-live="polite"
            aria-label={translateText("Zoom level")}
            className="min-w-10 text-center text-[10px] font-semibold tabular-nums text-[#6a7862]"
          >
            {Math.round(zoom * 100)}%
          </output>
          <button
            type="button"
            aria-label={translateText("Zoom in")}
            disabled={zoom === 2.5}
            onClick={() => changeZoom(zoom + 0.25)}
            className="flex size-11 items-center justify-center rounded-xl border border-[#dcdccb] bg-[#fffdf5] text-xl text-[#455e4d] transition-colors hover:bg-[#e9edde] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#886636] disabled:cursor-not-allowed disabled:opacity-35"
          >
            +
          </button>
        </div>
      </div>
    </div>
  );
}
