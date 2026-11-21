import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { blockedSettlementVertices } from "../game/engine";
import { edgeTiles, hiddenNumberTileIds, isPortRevealed, isResource, portAnchor } from "../game/board";
import { type Board as BoardState, type Player, type Resource, type Terrain, type Tile } from "../game/types";
import { pieceName, resourceName } from "../i18n";
import { useLanguage, useTranslation } from "../localization";
import { getTerrainName, getThemeName, useBoardTheme } from "../themes";
import { boardTranslations } from "../translations/board";
import { getPlayerLabel } from "./GameUi";
import { HEX_ARTWORK_CLIP_PATH, ResourceArtwork, TerrainArtwork } from "./ThemeArtwork";

const tileElevation = 8;

type CoordinateOffset = {
  horizontal: number;
  vertical: number;
  generation: number;
};

type ShipTravel = {
  horizontal: number;
  vertical: number;
  rotationDelta: number;
  generation: number;
};

type HarvestBurst = {
  key: string;
  horizontal: number;
  vertical: number;
  terrain: Resource | "gold";
  amount: 1 | 2;
  index: number;
};

type EdgeSnapshot = {
  playerId: string;
  kind: "road" | "ship";
  horizontal: number;
  vertical: number;
  rotation: number;
};

type BoardMotionTracker = {
  initialized: boolean;
  lastBoard: BoardState | null;
  lastRobberTileId: string | undefined;
  lastPirateTileId: string | null | undefined;
  lastRolledNumber: number | undefined;
  lastProducingKey: string;
  version: number;
  generation: number;
  buildings: Map<string, "settlement" | "city">;
  edges: Map<string, EdgeSnapshot>;
  visiblePortEdgeIds: Set<string>;
  tileCoordinates: Map<string, { horizontal: number; vertical: number }>;
  tileTerrains: Map<string, Terrain>;
  newSettlements: Map<string, number>;
  upgradedCities: Map<string, number>;
  newRoads: Map<string, number>;
  newShips: Map<string, number>;
  movedShips: Map<string, ShipTravel>;
  newPorts: Map<string, number>;
  robberTravel: CoordinateOffset | null;
  pirateTravel: CoordinateOffset | null;
  pirateEnterGeneration: number | null;
  blockedRollGeneration: number | null;
  harvestBursts: HarvestBurst[];
  completedKeys: Set<string>;
};

function edgeRotation(start: { x: number; y: number }, end: { x: number; y: number }) {
  const angle = start.x === end.x ? 0 : (Math.atan2(end.y - start.y, end.x - start.x) * 180) / Math.PI;
  return angle > 90 ? angle - 180 : angle < -90 ? angle + 180 : angle;
}

function normalizeHalfTurn(degrees: number) {
  let normalized = degrees;
  while (normalized > 90) normalized -= 180;
  while (normalized < -90) normalized += 180;
  return normalized;
}

function createBoardMotionTracker(): BoardMotionTracker {
  return {
    initialized: false,
    lastBoard: null,
    lastRobberTileId: undefined,
    lastPirateTileId: undefined,
    lastRolledNumber: undefined,
    lastProducingKey: "",
    version: 0,
    generation: 0,
    buildings: new Map(),
    edges: new Map(),
    visiblePortEdgeIds: new Set(),
    tileCoordinates: new Map(),
    tileTerrains: new Map(),
    newSettlements: new Map(),
    upgradedCities: new Map(),
    newRoads: new Map(),
    newShips: new Map(),
    movedShips: new Map(),
    newPorts: new Map(),
    robberTravel: null,
    pirateTravel: null,
    pirateEnterGeneration: null,
    blockedRollGeneration: null,
    harvestBursts: [],
    completedKeys: new Set(),
  };
}

function NumberToken({ x, y, number, matchesRoll, blocked, blockedShake = false, popIn = false, illustrationId }: {
  x: number;
  y: number;
  number: number;
  matchesRoll: boolean;
  blocked: boolean;
  blockedShake?: boolean;
  popIn?: boolean;
  illustrationId: string;
}) {
  const probability = 6 - Math.abs(7 - number);
  const frequent = number === 6 || number === 8;
  const bodyClassName = [
    blockedShake ? "board-blocked-shake" : "",
    popIn ? "board-number-peek-pop" : "",
  ].filter(Boolean).join(" ") || undefined;
  return (
    <g
      className={`number-token${matchesRoll ? " number-token-highlight" : ""}${blocked ? " number-token-blocked" : ""}`}
      transform={`translate(${x} ${y + 2})`}
    >
      <g className={bodyClassName}>
        {matchesRoll && (
          <circle
            className="number-token-halo"
            r="25.5"
            fill={blocked ? "none" : "#f4cf75"}
            fillOpacity="0.34"
            stroke={blocked ? "#817d71" : "#ae772c"}
            strokeWidth={blocked ? "1.5" : "2.2"}
            strokeDasharray={blocked ? "3 4" : undefined}
            opacity={blocked ? "0.7" : "1"}
            pointerEvents="none"
          />
        )}
        <circle cy="3.5" r="19.5" fill="#233329" opacity="0.26" />
        <circle cy="1.8" r="19" fill="#ae9872" />
        <circle
          className="number-token-face"
          r="19"
          fill={blocked ? "#e4dfd2" : matchesRoll ? `url(#${illustrationId}-token-hot)` : `url(#${illustrationId}-token)`}
          stroke={blocked ? "#887f6c" : matchesRoll ? "#a5631e" : frequent ? "#c9856e" : "#c8b998"}
          strokeWidth={matchesRoll ? "2.2" : frequent ? "1.5" : "1.2"}
        />
        <circle
          r="16.1"
          fill="none"
          stroke={blocked ? "#bbb29e" : matchesRoll ? "#d7ad51" : frequent ? "#d88a71" : "#e7ddc5"}
          strokeOpacity={frequent && !blocked && !matchesRoll ? "0.55" : "0.9"}
          strokeWidth={frequent ? "0.95" : "0.7"}
        />
        <text
          y="4.5"
          textAnchor="middle"
          fontFamily="Georgia, 'Times New Roman', serif"
          fontSize={frequent ? "24" : "22.5"}
          fontWeight="700"
          fill={frequent ? "#b2432e" : "#32453c"}
        >
          {number}
        </text>
        {Array.from({ length: probability }, (_, index) => (
          <circle
            key={index}
            cx={(index - (probability - 1) / 2) * 4.3}
            cy="11.2"
            r={frequent ? "1.45" : "1.3"}
            fill={frequent ? "#b2432e" : "#55624d"}
          />
        ))}
      </g>
    </g>
  );
}

export function useFogRevealHistory() {
  return useRef({
    terrains: new Map<string, Terrain>(),
    generations: new Map<string, number>(),
    completedVeils: new Set<string>(),
    version: 0,
  });
}

const VICTORY_TARGETS = Array.from({ length: 11 }, (_, index) => index + 3);

const victoryTargetPillClassName = "inline-flex items-center gap-1.5 rounded-full border border-[#e3d3a8] bg-gradient-to-b from-[#fdf7e3] to-[#f3e7c2] px-2.5 py-1 text-[10px] font-bold uppercase tabular-nums tracking-[.08em] text-[#8b6425] shadow-[inset_0_1px_0_#fffdf5,0_1px_3px_#423d2814]";

function VictoryTargetLabel({ victoryTarget }: { victoryTarget: number }) {
  const translateText = useTranslation(boardTranslations);
  return <>
    <span className="whitespace-nowrap @max-[120px]:hidden">{translateText("{points} VP to win", { points: victoryTarget })}</span>
    <span className="hidden whitespace-nowrap @max-[120px]:inline">{translateText("{points} VP", { points: victoryTarget })}</span>
  </>;
}

function VictoryTargetBadge({ victoryTarget, disabled = false, onChange }: {
  victoryTarget: number;
  disabled?: boolean;
  onChange: (points: number) => void;
}) {
  const translateText = useTranslation(boardTranslations);
  const listboxId = useId();
  const wrapper = useRef<HTMLSpanElement>(null);
  const badge = useRef<HTMLButtonElement>(null);
  const listbox = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [dropUp, setDropUp] = useState(false);

  function toggleOpen() {
    if (!open && badge.current && wrapper.current) {
      const badgeRect = badge.current.getBoundingClientRect();
      let clipTop = 0;
      let clipBottom = window.innerHeight;
      let node: HTMLElement | null = wrapper.current.parentElement;
      while (node) {
        const style = getComputedStyle(node);
        if ([style.overflow, style.overflowY, style.overflowX].some(value => value === "hidden" || value === "clip")) {
          const clipRect = node.getBoundingClientRect();
          clipTop = clipRect.top;
          clipBottom = clipRect.bottom;
          break;
        }
        node = node.parentElement;
      }
      const popupHeight = 170;
      setDropUp(clipBottom - badgeRect.bottom < popupHeight && badgeRect.top - clipTop > clipBottom - badgeRect.bottom);
    }
    setOpen(current => !current);
  }

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: Event) => {
      if (!wrapper.current?.contains(event.target as Node | null)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    // Safari can blur a menu control before delivering a tapped item's click.
    document.addEventListener("focusin", dismiss);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("focusin", dismiss);
    };
  }, [open]);

  function focusTargetOption(index: number) {
    const options = listbox.current?.querySelectorAll<HTMLButtonElement>("[role='option']");
    if (!options?.length) return;
    options[Math.max(0, Math.min(options.length - 1, index))]?.focus();
  }

  function selectTarget(points: number) {
    setOpen(false);
    badge.current?.focus({ preventScroll: true });
    if (points !== victoryTarget) onChange(points);
  }

  return (
    <span ref={wrapper} className="pointer-events-auto relative inline-flex">
      <button
        ref={badge}
        type="button"
        aria-label={translateText("Victory points to win")}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        title={translateText("Victory points to win")}
        disabled={disabled}
        onClick={() => toggleOpen()}
        onKeyDown={event => {
          if (event.key === "Escape" && open) {
            event.preventDefault();
            setOpen(false);
            return;
          }
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          if (open) {
            const options = Array.from(listbox.current?.querySelectorAll("[role='option']") ?? []);
            focusTargetOption(options.findIndex(option => option.getAttribute("aria-selected") === "true"));
            return;
          }
          const next = VICTORY_TARGETS[VICTORY_TARGETS.indexOf(victoryTarget) + (event.key === "ArrowDown" ? 1 : -1)];
          if (next !== undefined) onChange(next);
        }}
        className={`${victoryTargetPillClassName} min-h-11 cursor-pointer @max-[80px]:gap-1 @max-[80px]:px-1 @max-[64px]:[&>svg]:hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#886636]`}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#b58a2d" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
          <path d="M8 21h8" /><path d="M12 17v4" /><path d="M7 4h10v5a5 5 0 0 1-10 0Z" /><path d="M7 6H4a3 3 0 0 0 3 4" /><path d="M17 6h3a3 3 0 0 1-3 4" />
        </svg>
        <VictoryTargetLabel victoryTarget={victoryTarget} />
        <svg width="8" height="8" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" className="hidden shrink-0 @min-[120px]:block">
          <path d="m3 4.5 3 3 3-3" />
        </svg>
      </button>
      {open && (
        <div
          ref={listbox}
          id={listboxId}
          role="listbox"
          aria-label={translateText("Victory points to win")}
          className={`absolute left-1/2 z-50 grid w-52 -translate-x-1/2 grid-cols-4 gap-1 rounded-xl border border-line bg-paper p-1.5 shadow-xl ${dropUp ? "bottom-full mb-1" : "top-full mt-1"}`}
          onKeyDown={event => {
            if (event.key === "Escape") {
              event.preventDefault();
              setOpen(false);
              badge.current?.focus();
              return;
            }
            const options = Array.from(listbox.current?.querySelectorAll<HTMLButtonElement>("[role='option']") ?? []);
            const index = options.findIndex(option => option === document.activeElement);
            const deltas = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 } as const;
            if (event.key in deltas) {
              event.preventDefault();
              focusTargetOption(index + deltas[event.key as keyof typeof deltas]);
            } else if (event.key === "Home") {
              event.preventDefault();
              focusTargetOption(0);
            } else if (event.key === "End") {
              event.preventDefault();
              focusTargetOption(options.length - 1);
            }
          }}
        >
          {VICTORY_TARGETS.map(points => (
            <button
              key={points}
              type="button"
              role="option"
              aria-selected={points === victoryTarget}
              className="flex min-h-11 cursor-pointer items-center justify-center rounded-lg px-2 text-sm font-semibold tabular-nums hover:bg-moss aria-selected:bg-forest"
              onClick={() => selectTarget(points)}
            >
              {points}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

export function Board({
  board,
  fogRevealHistory,
  players,
  robberTileId,
  pirateTileId,
  routeMode,
  pirateIndicator,
  legalVertexIds = [],
  legalEdgeIds = [],
  legalTileIds = [],
  tileSelectionMode = "robber",
  showBlockedSettlementLocations = false,
  fillBoardWithWater = false,
  producingTileIds = [],
  rolledNumber,
  selectedId,
  confirmation,
  onSelect,
  onChangeTheme,
  headerControls,
  interactive = true,
  compact = false,
  fit = false,
  victoryTarget,
  onChangeVictoryTarget,
  victoryTargetDisabled = false,
}: {
  board: BoardState;
  fogRevealHistory?: ReturnType<typeof useFogRevealHistory>;
  players: Pick<Player, "id" | "name" | "color" | "control">[];
  robberTileId?: string;
  pirateTileId?: string | null;
  routeMode?: "road" | "ship" | "move-ship" | null;
  pirateIndicator?: {
    onBoard: boolean;
    enabled: boolean;
    onSelect: () => void;
  };
  legalVertexIds?: string[];
  legalEdgeIds?: string[];
  legalTileIds?: string[];
  tileSelectionMode?: "setup" | "robber";
  showBlockedSettlementLocations?: boolean;
  fillBoardWithWater?: boolean;
  producingTileIds?: string[];
  rolledNumber?: number;
  selectedId?: string | null;
  confirmation?: {
    title: string;
    player?: { name: string; color: string };
    onConfirm: () => void;
    onCancel: () => void;
    choices?: { label: string; icon?: ReactNode; onConfirm: () => void }[];
  };
  onSelect?: (kind: "vertex" | "edge" | "tile", id: string) => void;
  onChangeTheme?: () => void;
  headerControls?: ReactNode;
  interactive?: boolean;
  compact?: boolean;
  fit?: boolean;
  victoryTarget?: number;
  onChangeVictoryTarget?: (points: number) => void;
  victoryTargetDisabled?: boolean;
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
  const [peekedTileId, setPeekedTileId] = useState<string | null>(null);
  const verticesById = new Map(
    board.vertices.map((vertex) => [vertex.id, vertex]),
  );
  const playersById = new Map(players.map((player) => [player.id, player]));
  const localFogRevealHistory = useFogRevealHistory();
  const fogRevealState = fogRevealHistory ?? localFogRevealHistory;
  const [, setFogRevealRevision] = useState(0);
  const fogReveals = useMemo(() => {
    const { terrains, generations } = fogRevealState.current;
    // A genuine reveal only turns fog tiles into their discovered terrain; any other terrain
    // change or tile-set change means a different map (variant switch, new code, restart),
    // which must restart tracking instead of playing reveal animations.
    const replacedMap = board.tiles.some(tile => {
      const previous = terrains.get(tile.id);
      return previous !== undefined && previous !== tile.terrain && !(previous === "fog" && tile.terrain !== "fog");
    }) || board.tiles.length !== terrains.size;
    if (replacedMap) {
      fogRevealState.current.generations = new Map();
      fogRevealState.current.version++;
    } else {
      for (const tile of board.tiles) {
        if (terrains.get(tile.id) === "fog" && tile.terrain !== "fog") {
          generations.set(tile.id, (generations.get(tile.id) ?? 0) + 1);
        }
      }
    }
    fogRevealState.current.terrains = new Map(board.tiles.map((tile) => [tile.id, tile.terrain]));
    return { generations: fogRevealState.current.generations, version: fogRevealState.current.version };
  }, [board, fogRevealState]);
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
    (tile.terrain !== "fog" && tile.number !== null && tile.number === rolledNumber) ||
    (legalTiles.has(tile.id) && (selectedId === tile.id || focusedId === tile.id)),
  ).map((tile) => tile.id));
  const blockedVertices = showBlockedSettlementLocations ? blockedSettlementVertices(board) : [];
  const visiblePorts = board.ports.filter(port => isPortRevealed(board, port));
  const hiddenNumberIds = new Set(hiddenNumberTileIds(board));
  const peekedTile = peekedTileId === null ? undefined : board.tiles.find(tile => tile.id === peekedTileId);
  const peekedTileRaised = peekedTile !== undefined && raisedTileIds.has(peekedTile.id);
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
      rotation: edgeRotation(start, end),
      coastal: edgeTiles(board, edge).filter(tile => tile.terrain !== "sea" && tile.terrain !== "fog").length === 1,
    };
  });
  const motionReference = useRef<BoardMotionTracker | null>(null);
  if (motionReference.current === null) motionReference.current = createBoardMotionTracker();
  const [, setMotionRevision] = useState(0);
  const producingKey = producingTileIds.join(",");
  const completeMotionKey = (key: string) => {
    const tracker = motionReference.current!;
    if (tracker.completedKeys.has(key)) return;
    tracker.completedKeys.add(key);
    setMotionRevision(current => current + 1);
  };
  const boardMotion = useMemo(() => {
    const tracker = motionReference.current!;
    const sameInput = tracker.initialized &&
      tracker.lastBoard === board &&
      tracker.lastRobberTileId === robberTileId &&
      tracker.lastPirateTileId === pirateTileId &&
      tracker.lastRolledNumber === rolledNumber &&
      tracker.lastProducingKey === producingKey;

    if (!sameInput) {
      const currentBuildings = new Map<string, "settlement" | "city">();
      for (const vertex of board.vertices) {
        if (vertex.building) currentBuildings.set(vertex.id, vertex.building.kind);
      }
      const currentEdges = new Map<string, EdgeSnapshot>();
      for (const item of edgeGeometry) {
        if (item.edge.playerId) {
          currentEdges.set(item.edge.id, {
            playerId: item.edge.playerId,
            kind: item.edge.kind === "ship" ? "ship" : "road",
            horizontal: item.x,
            vertical: item.y,
            rotation: item.rotation,
          });
        }
      }
      const currentVisiblePortEdgeIds = new Set(visiblePorts.map(port => port.edgeId));
      const currentTileCoordinates = new Map(
        board.tiles.map(tile => [tile.id, { horizontal: tile.x, vertical: tile.y }]),
      );
      const currentTileTerrains = new Map(board.tiles.map(tile => [tile.id, tile.terrain]));

      const removedShips: { edgeId: string; snapshot: EdgeSnapshot }[] = [];
      const addedShips: { edgeId: string; snapshot: EdgeSnapshot }[] = [];
      const addedRoads: string[] = [];
      let disappearedPiece = false;

      if (tracker.initialized) {
        for (const [vertexId] of tracker.buildings) {
          if (!currentBuildings.has(vertexId)) disappearedPiece = true;
        }
        for (const [edgeId, previousEdge] of tracker.edges) {
          const nextEdge = currentEdges.get(edgeId);
          if (!nextEdge) {
            if (previousEdge.kind === "ship") removedShips.push({ edgeId, snapshot: previousEdge });
            else disappearedPiece = true;
          }
        }
        for (const [edgeId, nextEdge] of currentEdges) {
          if (!tracker.edges.has(edgeId)) {
            if (nextEdge.kind === "ship") addedShips.push({ edgeId, snapshot: nextEdge });
            else addedRoads.push(edgeId);
          }
        }
      }

      const validSingleShipMove = removedShips.length === 1 &&
        addedShips.length === 1 &&
        removedShips[0]!.snapshot.playerId === addedShips[0]!.snapshot.playerId;

      const replacedBoard = !tracker.initialized ||
        board.tiles.length !== tracker.tileTerrains.size ||
        board.tiles.some(tile => {
          const previousTerrain = tracker.tileTerrains.get(tile.id);
          return previousTerrain !== undefined &&
            previousTerrain !== tile.terrain &&
            !(previousTerrain === "fog" && tile.terrain !== "fog");
        }) ||
        disappearedPiece ||
        (removedShips.length > 0 && !validSingleShipMove);

      if (replacedBoard) {
        tracker.version++;
        tracker.newSettlements.clear();
        tracker.upgradedCities.clear();
        tracker.newRoads.clear();
        tracker.newShips.clear();
        tracker.movedShips.clear();
        tracker.newPorts.clear();
        tracker.robberTravel = null;
        tracker.pirateTravel = null;
        tracker.pirateEnterGeneration = null;
        tracker.blockedRollGeneration = null;
        tracker.harvestBursts = [];
        tracker.completedKeys.clear();
      } else {
        for (const [vertexId, kind] of currentBuildings) {
          const previousKind = tracker.buildings.get(vertexId);
          if (!previousKind && kind === "settlement") {
            tracker.newSettlements.set(vertexId, ++tracker.generation);
          } else if (previousKind !== "city" && kind === "city") {
            tracker.newSettlements.delete(vertexId);
            tracker.upgradedCities.set(vertexId, ++tracker.generation);
          }
        }

        for (const edgeId of addedRoads) {
          tracker.newRoads.set(edgeId, ++tracker.generation);
        }

        if (validSingleShipMove) {
          const from = removedShips[0]!;
          const to = addedShips[0]!;
          tracker.newShips.delete(from.edgeId);
          tracker.movedShips.delete(from.edgeId);
          tracker.movedShips.set(to.edgeId, {
            horizontal: from.snapshot.horizontal - to.snapshot.horizontal,
            vertical: from.snapshot.vertical - to.snapshot.vertical,
            rotationDelta: normalizeHalfTurn(from.snapshot.rotation - to.snapshot.rotation),
            generation: ++tracker.generation,
          });
        } else {
          for (const added of addedShips) {
            tracker.newShips.set(added.edgeId, ++tracker.generation);
          }
        }

        for (const edgeId of currentVisiblePortEdgeIds) {
          if (!tracker.visiblePortEdgeIds.has(edgeId)) {
            tracker.newPorts.set(edgeId, ++tracker.generation);
          }
        }

        if (robberTileId && tracker.lastRobberTileId && robberTileId !== tracker.lastRobberTileId) {
          const previousCoordinate = tracker.tileCoordinates.get(tracker.lastRobberTileId);
          const nextCoordinate = currentTileCoordinates.get(robberTileId);
          if (previousCoordinate && nextCoordinate) {
            tracker.robberTravel = {
              horizontal: previousCoordinate.horizontal - nextCoordinate.horizontal,
              vertical: previousCoordinate.vertical - nextCoordinate.vertical,
              generation: ++tracker.generation,
            };
          }
        }

        if (pirateTileId && pirateTileId !== tracker.lastPirateTileId) {
          const previousCoordinate = tracker.lastPirateTileId
            ? tracker.tileCoordinates.get(tracker.lastPirateTileId)
            : undefined;
          const nextCoordinate = currentTileCoordinates.get(pirateTileId);
          if (previousCoordinate && nextCoordinate) {
            tracker.pirateTravel = {
              horizontal: previousCoordinate.horizontal - nextCoordinate.horizontal,
              vertical: previousCoordinate.vertical - nextCoordinate.vertical,
              generation: ++tracker.generation,
            };
            tracker.pirateEnterGeneration = null;
          } else {
            tracker.pirateTravel = null;
            tracker.pirateEnterGeneration = ++tracker.generation;
          }
        } else if (!pirateTileId) {
          tracker.pirateTravel = null;
          tracker.pirateEnterGeneration = null;
        }

        const rollActivated = rolledNumber !== undefined &&
          (tracker.lastRolledNumber !== rolledNumber || (producingKey !== "" && tracker.lastProducingKey !== producingKey));

        if (rolledNumber === undefined) {
          tracker.harvestBursts = [];
          tracker.blockedRollGeneration = null;
        } else if (rollActivated) {
          const blockedRobberTile = board.tiles.find(tile =>
            tile.id === robberTileId && tile.terrain !== "fog" && tile.number !== null && tile.number === rolledNumber,
          );
          tracker.blockedRollGeneration = blockedRobberTile ? ++tracker.generation : null;

          const activeProducingTiles = rolledNumber === 7
            ? []
            : producingTileIds.length > 0
              ? board.tiles.filter(tile => producingTileIds.includes(tile.id) && (isResource(tile.terrain) || tile.terrain === "gold"))
              : board.tiles.filter(tile =>
                tile.id !== robberTileId &&
                tile.number === rolledNumber &&
                (isResource(tile.terrain) || tile.terrain === "gold"),
              );

          const gainsByVertex = new Map<string, { terrain: Resource | "gold"; amount: 1 | 2 }[]>();
          for (const tile of activeProducingTiles) {
            const terrain = tile.terrain as Resource | "gold";
            for (const vertexId of tile.vertexIds) {
              const vertex = verticesById.get(vertexId);
              if (!vertex?.building) continue;
              const entries = gainsByVertex.get(vertexId) ?? [];
              entries.push({ terrain, amount: vertex.building.kind === "city" ? 2 : 1 });
              gainsByVertex.set(vertexId, entries);
            }
          }

          const rollGeneration = ++tracker.generation;
          const bursts: HarvestBurst[] = [];
          let burstIndex = 0;
          for (const [vertexId, entries] of gainsByVertex) {
            const vertex = verticesById.get(vertexId)!;
            entries.forEach((entry, indexOnVertex) => {
              const horizontalOffset = (indexOnVertex - (entries.length - 1) / 2) * 30;
              bursts.push({
                key: `${tracker.version}:harvest:${rollGeneration}:${vertexId}:${indexOnVertex}`,
                horizontal: vertex.x + horizontalOffset,
                vertical: vertex.y,
                terrain: entry.terrain,
                amount: entry.amount,
                index: burstIndex++,
              });
            });
          }
          tracker.harvestBursts = bursts;
        }
      }

      tracker.initialized = true;
      tracker.lastBoard = board;
      tracker.lastRobberTileId = robberTileId;
      tracker.lastPirateTileId = pirateTileId;
      tracker.lastRolledNumber = rolledNumber;
      tracker.lastProducingKey = producingKey;
      tracker.buildings = currentBuildings;
      tracker.edges = currentEdges;
      tracker.visiblePortEdgeIds = currentVisiblePortEdgeIds;
      tracker.tileCoordinates = currentTileCoordinates;
      tracker.tileTerrains = currentTileTerrains;
    }

    return tracker;
  }, [board, robberTileId, pirateTileId, rolledNumber, producingKey]);
  const isMotionActive = (key: string | null): key is string =>
    key !== null && !boardMotion.completedKeys.has(key);
  const blockedRollKey = boardMotion.blockedRollGeneration === null
    ? null
    : `${boardMotion.version}:blocked-roll:${boardMotion.blockedRollGeneration}`;
  const blockedRollActive = isMotionActive(blockedRollKey);
  const activeHarvestBursts = boardMotion.harvestBursts.filter(burst => isMotionActive(burst.key));
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

  function runConfirmation(action: () => void) {
    const focusWasInConfirmation = confirmationReference.current?.contains(document.activeElement);
    action();
    const viewport = viewportReference.current;
    if (focusWasInConfirmation && viewport?.getClientRects().length && !viewport.closest("[inert]")) {
      viewport.focus({ preventScroll: true });
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
      : translateText(terrain === "sea" ? "Sea" : terrain === "fog" ? "Fog" : terrain === "gold" ? "Gold" : "Desert").toLowerCase();
  }

  function tileDescription(tile: Tile) {
    const number = tile.terrain === "fog" ? null : tile.number;
    const probability = number === null ? 0 : 6 - Math.abs(7 - number);
    let description = tile.terrain === "fog"
      ? translateText("Unexplored fog; terrain and number concealed")
      : translateText(number === null
        ? "{terrain}, {resource}, no production"
        : "{terrain}, {resource}, roll {number}, {probability} chances out of 36", {
        terrain: getTerrainName(theme, tile.terrain, language),
        resource: terrainResourceName(tile.terrain),
        number: number ?? "",
        probability,
      });
    if (tile.terrain !== "fog" && robberTileId === tile.id) description = translateText("{description}, blocked by the robber", { description });
    if (tile.terrain !== "fog" && producingTileIds.includes(tile.id)) description = translateText("{description}, produced resources this roll", { description });
    return description;
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
      {headerControls && <div className="board-header-controls">{headerControls}</div>}
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
                { tiles: board.tiles.length, ports: visiblePorts.length })}
            </desc>
            <defs>
              <radialGradient
                id={`${illustrationId}-sea`}
                cx="46%"
                cy="40%"
                r="66%"
              >
                <stop offset="0" stopColor={theme.sea[0]} />
                <stop offset="0.74" stopColor={theme.sea[1]} />
                <stop offset="1" stopColor={theme.sea[2]} />
              </radialGradient>
              <linearGradient id={`${illustrationId}-hex-light`} x1="15%" y1="5%" x2="85%" y2="95%">
                <stop offset="0" stopColor="#fffdf6" stopOpacity="0.24" />
                <stop offset="0.48" stopColor="#ffffff" stopOpacity="0" />
                <stop offset="1" stopColor="#1e2d24" stopOpacity="0.18" />
              </linearGradient>
              <linearGradient id={`${illustrationId}-sea-light`} x1="15%" y1="5%" x2="85%" y2="95%">
                <stop offset="0" stopColor="#ffffff" stopOpacity="0.13" />
                <stop offset="0.55" stopColor="#ffffff" stopOpacity="0" />
                <stop offset="1" stopColor="#16353a" stopOpacity="0.14" />
              </linearGradient>
              <linearGradient id={`${illustrationId}-token`} x1="25%" y1="0%" x2="75%" y2="100%">
                <stop offset="0" stopColor="#fffdf5" />
                <stop offset="0.6" stopColor="#faf2dc" />
                <stop offset="1" stopColor="#ede0be" />
              </linearGradient>
              <linearGradient id={`${illustrationId}-token-hot`} x1="25%" y1="0%" x2="75%" y2="100%">
                <stop offset="0" stopColor="#fff6cc" />
                <stop offset="1" stopColor="#f5d784" />
              </linearGradient>
              <linearGradient id={`${illustrationId}-robber`} x1="20%" y1="0%" x2="85%" y2="100%">
                <stop offset="0" stopColor="#55665d" />
                <stop offset="0.5" stopColor="#313f39" />
                <stop offset="1" stopColor="#1b2621" />
              </linearGradient>
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
              <clipPath id={`${illustrationId}-hex-clip`}>
                <path d={HEX_ARTWORK_CLIP_PATH} />
              </clipPath>
            </defs>

            <g aria-hidden="true">
              {!fillBoardWithWater && (
                <>
                  <path
                    d="M-302-159C-273-260-165-318-40-315C95-340 245-274 296-169C350-67 332 92 267 195C198 291 72 322-42 309C-169 321-286 244-315 129C-345 26-341-54-302-159Z"
                    transform={`scale(${(halfWidth * 1.045) / 355} ${(halfHeight * 1.045) / 337})`}
                    fill={`url(#${illustrationId}-sea)`}
                  />
                  <path
                    d="M-302-159C-273-260-165-318-40-315C95-340 245-274 296-169C350-67 332 92 267 195C198 291 72 322-42 309C-169 321-286 244-315 129C-345 26-341-54-302-159Z"
                    transform={`scale(${(halfWidth * 0.995) / 355} ${(halfHeight * 0.995) / 337})`}
                    fill="none"
                    stroke="#ffffff"
                    strokeOpacity="0.24"
                    strokeWidth="1.2"
                  />
                  <ellipse
                    rx={halfWidth - 20}
                    ry={halfHeight - 19}
                    fill="none"
                    stroke="#86aca1"
                    strokeWidth="0.8"
                    strokeDasharray="2 7"
                    opacity="0.45"
                  />
                </>
              )}
              <path
                d="M-287-103q8-5 16 0t16 0M-306-88q8-5 16 0t16 0M240 134q8-5 16 0t16 0M250 148q8-5 16 0t16 0M-189 250q8-5 16 0t16 0M95-279q8-5 16 0t16 0M108-265q8-5 16 0t16 0"
                fill="none"
                stroke="#6e9c91"
                strokeWidth="1.4"
                strokeLinecap="round"
                opacity="0.48"
              />
              <g
                transform={`translate(${halfWidth - 52} ${-halfHeight + 52})`}
                fill="none"
                stroke="#7a9385"
                opacity="0.72"
              >
                <circle r="18" strokeWidth="0.7" />
                <circle r="13" strokeWidth="0.45" strokeDasharray="1.5 2.5" opacity="0.65" />
                <path d="M0-24V24M-24 0H24" strokeWidth="0.7" />
                <path
                  d="M0-17 3.8 0 0 17-3.8 0Z"
                  fill="#7a9385"
                  strokeWidth="0.8"
                />
                <path d="M0-17 3.8 0H0Z" fill="#fffdf6" fillOpacity="0.55" stroke="none" />
                <text
                  y="-29"
                  textAnchor="middle"
                  fill="#678172"
                  stroke="none"
                  fontSize="8.5"
                  fontWeight="700"
                  letterSpacing="2"
                >
                  {translateText("N")}
                </text>
              </g>
              <g
                stroke="#ffffff"
                strokeOpacity="0.32"
                strokeWidth="23"
                strokeLinecap="round"
              >
                {edgeGeometry
                  .filter(({ coastal }) => coastal)
                  .map(({ edge, start, end }) => (
                    <line
                      key={`foam-${edge.id}`}
                      x1={start.x}
                      y1={start.y}
                      x2={end.x}
                      y2={end.y}
                    />
                  ))}
              </g>
              <g
                filter={`url(#${illustrationId}-shadow)`}
                stroke={theme.coast}
                strokeWidth="13.5"
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
              const number = tile.terrain === "fog" ? null : tile.number;
              const matchesRoll = number !== null && number === rolledNumber;
              const blocked = matchesRoll && robberTileId === tile.id;
              const raised = raisedTileIds.has(tile.id);
              const peekingThisTile = peekedTileId === tile.id && hiddenNumberIds.has(tile.id);
              const fogRevealGeneration = fogReveals.generations.get(tile.id);
              const fogRevealVeilKey = fogRevealGeneration === undefined
                ? null
                : `${fogReveals.version}:${tile.id}:${fogRevealGeneration}`;
              const description = tileDescription(tile);
              return (
                <g
                  key={tile.id}
                  className={`terrain-hex${raised ? " terrain-hex-raised" : ""}`}
                  transform={raised ? `translate(0 ${-tileElevation})` : undefined}
                  pointerEvents="none"
                  role="img"
                  aria-label={description}
                >
                  {tile.terrain !== "fog" && tile.terrain !== "sea" && <polygon
                    points={points}
                    transform={`translate(0 ${3 + (raised ? tileElevation : 0)})`}
                    fill="#5c4d33"
                    stroke="#5c4d33"
                    strokeWidth="2.8"
                    strokeLinejoin="round"
                    opacity={raised ? "0.72" : "0.34"}
                    pointerEvents="none"
                  />}
                  <polygon
                    points={points}
                    fill={terrain.fill}
                    stroke={theme.border}
                    strokeWidth={tile.terrain === "sea" ? "1.6" : "2.7"}
                    strokeLinejoin="round"
                  />
                  <polygon
                    points={points}
                    fill={`url(#${illustrationId}-texture)`}
                    pointerEvents="none"
                  />
                  <polygon
                    points={points}
                    fill={`url(#${illustrationId}-${tile.terrain === "sea" ? "sea-light" : "hex-light"})`}
                    pointerEvents="none"
                  />
                  <g transform={`translate(${tile.x} ${tile.y})`}>
                    <TerrainArtwork
                      terrain={tile.terrain}
                      theme={theme}
                      clipPathId={`${illustrationId}-hex-clip`}
                    />
                  </g>
                  {tile.terrain !== "sea" && tile.terrain !== "fog" && (
                    <polygon
                      points={points}
                      transform={`translate(${tile.x} ${tile.y}) scale(0.935) translate(${-tile.x} ${-tile.y})`}
                      fill="none"
                      stroke="#fffdf6"
                      strokeOpacity="0.38"
                      strokeWidth="1.2"
                      strokeLinejoin="round"
                      pointerEvents="none"
                    />
                  )}
                  {tile.terrain !== "fog" && robberTileId === tile.id && (
                    <polygon
                      points={points}
                      fill="#1c2a24"
                      fillOpacity="0.22"
                      pointerEvents="none"
                    />
                  )}
                  {tile.terrain !== "sea" && (
                    <text
                      x={tile.x}
                      y={tile.y + 42.5}
                      textAnchor="middle"
                      fill={terrain.ink}
                      fillOpacity="0.9"
                      fontSize="6.8"
                      fontWeight="700"
                      letterSpacing="1.6"
                    >
                      {getTerrainName(theme, tile.terrain, language).toUpperCase()}
                    </text>
                  )}
                  {number !== null && !peekingThisTile && (
                    <NumberToken
                      x={tile.x}
                      y={tile.y}
                      number={number}
                      matchesRoll={matchesRoll}
                      blocked={blocked}
                      blockedShake={blocked && blockedRollActive}
                      illustrationId={illustrationId}
                    />
                  )}
                  {fogRevealVeilKey !== null && !fogRevealState.current.completedVeils.has(fogRevealVeilKey) && (
                    <g
                      key={`fog-reveal-${fogRevealVeilKey}`}
                      className="fog-reveal-veil"
                      aria-hidden="true"
                      onAnimationEnd={event => {
                        // Remove the veil once it has lifted so later DOM reordering (for example
                        // dice-roll highlights) cannot restart the finished animation.
                        if (event.animationName === "fog-lift") {
                          fogRevealState.current.completedVeils.add(fogRevealVeilKey);
                          setFogRevealRevision(current => current + 1);
                        }
                      }}
                    >
                      <polygon
                        points={points}
                        fill={theme.terrain.fog.fill}
                        stroke={theme.border}
                        strokeWidth="3"
                        strokeLinejoin="round"
                      />
                      <polygon points={points} fill={`url(#${illustrationId}-texture)`} />
                      <g transform={`translate(${tile.x} ${tile.y})`}>
                        <TerrainArtwork terrain="fog" theme={theme} clipPathId={`${illustrationId}-hex-clip`} />
                      </g>
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

            {visiblePorts.map((port) => {
              const { x, y, portX, portY } = portAnchor(board, port);
              const ratio = port.resource === "any" ? "3:1" : "2:1";
              const portGeneration = boardMotion.newPorts.get(port.edgeId);
              const portRevealKey = portGeneration === undefined
                ? null
                : `${boardMotion.version}:port:${port.edgeId}:${portGeneration}`;
              const portRevealing = isMotionActive(portRevealKey);
              return (
                <g
                  key={port.edgeId}
                  className={portRevealing ? "board-harbor-reveal" : undefined}
                  role="img"
                  aria-label={port.resource === "any"
                    ? translateText("Any resource harbor, trade {ratio}", { ratio })
                    : translateText("{resource} harbor, trade {ratio}", { resource: resourceName(language, port.resource).toLowerCase(), ratio })}
                  onAnimationEnd={event => {
                    if (portRevealKey && event.animationName === "board-harbor-reveal") completeMotionKey(portRevealKey);
                  }}
                >
                  <path
                    d={`M${x} ${y}L${portX} ${portY}`}
                    stroke="#e8d8ac"
                    strokeWidth="8"
                  />
                  <path
                    d={`M${x} ${y}L${portX} ${portY}`}
                    stroke="#9a8864"
                    strokeWidth="1.4"
                    strokeDasharray="2 3"
                  />
                  <g transform={`translate(${portX} ${portY})`}>
                    {port.resource === "any" ? (
                      <>
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
                          {translateText("ANY")}
                        </text>
                      </>
                    ) : (
                      <>
                        <rect
                          x="-27"
                          y="-15"
                          width="54"
                          height="33"
                          rx="9"
                          fill={theme.resources[port.resource]}
                          opacity="0.25"
                        />
                        <rect
                          x="-27"
                          y="-17"
                          width="54"
                          height="33"
                          rx="9"
                          fill={theme.resources[port.resource]}
                          stroke="#ffffff"
                          strokeOpacity="0.5"
                          strokeWidth="1"
                        />
                        <text
                          y="-5"
                          textAnchor="middle"
                          fill="#ffffff"
                          fontSize="13"
                          fontWeight="750"
                          fontFamily="Georgia, 'Times New Roman', serif"
                        >
                          {ratio}
                        </text>
                        <g
                          transform="translate(-23 0) scale(0.44)"
                          color="#ffffff"
                        >
                          <ResourceArtwork resource={port.resource} theme={theme} />
                        </g>
                        <text
                          x="-5"
                          y="10"
                          textAnchor="start"
                          fill="#ffffff"
                          fontSize="7"
                          fontWeight="700"
                          letterSpacing="0.5"
                        >
                          {resourceName(language, port.resource).toUpperCase()}
                        </text>
                      </>
                    )}
                  </g>
                </g>
              );
            })}

            {peekedTile && hiddenNumberIds.has(peekedTile.id) && peekedTile.number !== null && (
              <g
                className={`number-peek${peekedTileRaised ? " terrain-hex-raised" : ""}`}
                transform={peekedTileRaised ? `translate(0 ${-tileElevation})` : undefined}
                aria-hidden="true"
                pointerEvents="none"
              >
                <NumberToken
                  x={peekedTile.x}
                  y={peekedTile.y}
                  number={peekedTile.number}
                  matchesRoll={peekedTile.number === rolledNumber}
                  blocked={peekedTile.number === rolledNumber && robberTileId === peekedTile.id}
                  blockedShake={peekedTile.number === rolledNumber && robberTileId === peekedTile.id && blockedRollActive}
                  popIn
                  illustrationId={illustrationId}
                />
              </g>
            )}

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
                      tileSelectionMode === "setup" ? translateText("Choose starting cell at {location}", { location: tile.id }) : tile.terrain === "sea" ? translateText("Move pirate to sea") : translateText(tile.number === null ? "Move robber to {resource}" : "Move robber to {resource} {number}", {
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
              .map(({ edge, start, end, x, y, rotation }) => {
                const player = playersById.get(edge.playerId!)!;
                if (edge.kind === "ship") {
                  const shipEnterGeneration = boardMotion.newShips.get(edge.id);
                  const shipEnterKey = shipEnterGeneration === undefined
                    ? null
                    : `${boardMotion.version}:ship:${edge.id}:${shipEnterGeneration}`;
                  const shipEnterActive = isMotionActive(shipEnterKey);
                  const movedShip = boardMotion.movedShips.get(edge.id);
                  const shipSailKey = movedShip === undefined
                    ? null
                    : `${boardMotion.version}:ship-move:${edge.id}:${movedShip.generation}`;
                  const shipSailActive = isMotionActive(shipSailKey);
                  const rippleGeneration = shipSailActive
                    ? movedShip!.generation
                    : shipEnterActive ? shipEnterGeneration! : null;
                  const shipRippleKey = rippleGeneration === null
                    ? null
                    : `${boardMotion.version}:ship-ripple:${edge.id}:${rippleGeneration}`;
                  const shipRippleActive = isMotionActive(shipRippleKey);
                  return (
                    <g key={edge.id} pointerEvents="none">
                      {shipRippleActive && (
                        <circle
                          key={shipRippleKey}
                          cx={x}
                          cy={y}
                          className="board-water-ripple"
                          r="15"
                          aria-hidden="true"
                          onAnimationEnd={event => {
                            if (event.animationName === "board-water-ripple") completeMotionKey(shipRippleKey);
                          }}
                        />
                      )}
                      <g
                        key={shipSailActive ? shipSailKey : shipEnterActive ? shipEnterKey : "ship-still"}
                        className={shipSailActive ? "board-ship-sail" : shipEnterActive ? "board-ship-enter" : undefined}
                        style={shipSailActive ? ({
                          "--ship-from-x": `${movedShip!.horizontal}px`,
                          "--ship-from-y": `${movedShip!.vertical}px`,
                          transformOrigin: `${x}px ${y}px`,
                        } as CSSProperties) : shipEnterActive ? { transformOrigin: `${x}px ${y}px` } : undefined}
                        onAnimationEnd={event => {
                          if (shipSailKey && event.animationName === "board-ship-sail") completeMotionKey(shipSailKey);
                          if (shipEnterKey && event.animationName === "board-ship-drop") completeMotionKey(shipEnterKey);
                        }}
                      >
                        <g
                          className={shipSailActive && movedShip!.rotationDelta !== 0 ? "board-ship-turn" : undefined}
                          style={shipSailActive && movedShip!.rotationDelta !== 0 ? ({
                            "--ship-from-rotation": `${movedShip!.rotationDelta}deg`,
                            transformOrigin: `${x}px ${y}px`,
                          } as CSSProperties) : undefined}
                        >
                          <g
                            role="img"
                            aria-label={translateText("{player}'s ship at {location}", { player: player.name, location: edge.id })}
                            transform={rotation === 0 ? `translate(${x} ${y}) scale(0.65)`
                              : `translate(${x} ${y}) rotate(${rotation}) scale(0.65) translate(0 -12)`}
                          >
                            {selectedId === edge.id && <ellipse rx="23" ry="27" fill="none" stroke="#8c672e" strokeWidth="3" />}
                            <path d="M-19 6h38l-7 12H-12Z" fill={player.color} stroke="#fff5dc" strokeWidth="2" />
                            <path d="M0-22V6M3-20 18 2H3ZM-4-15-16 2h12Z" fill={player.color} stroke="#fff5dc" strokeWidth="1.5" />
                            <text y="15" transform={`rotate(${-rotation} 0 12)`} textAnchor="middle" fill="#fff5dc" fontSize="10" fontWeight="800">
                              {players.findIndex(candidate => candidate.id === player.id) + 1}
                            </text>
                          </g>
                        </g>
                      </g>
                    </g>
                  );
                }
                const roadGeneration = boardMotion.newRoads.get(edge.id);
                const roadEnterKey = roadGeneration === undefined
                  ? null
                  : `${boardMotion.version}:road:${edge.id}:${roadGeneration}`;
                const roadEnterActive = isMotionActive(roadEnterKey);
                return (
                  <g
                    key={edge.id}
                    className={roadEnterActive ? "board-road-enter" : undefined}
                    role="img"
                    aria-label={translateText("{player}'s road at {location}", { player: player.name, location: edge.id })}
                    pointerEvents="none"
                    onAnimationEnd={event => {
                      if (roadEnterKey && event.animationName === "board-road-draw") completeMotionKey(roadEnterKey);
                    }}
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
                      pathLength={roadEnterActive ? 1 : undefined}
                      className={roadEnterActive ? "board-road-stroke" : undefined}
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
                      pathLength={roadEnterActive ? 1 : undefined}
                      className={roadEnterActive ? "board-road-stroke" : undefined}
                      stroke="#fff5dc"
                      strokeWidth="13"
                      strokeLinecap="round"
                    />
                    <line
                      x1={start.x}
                      y1={start.y}
                      x2={end.x}
                      y2={end.y}
                      pathLength={roadEnterActive ? 1 : undefined}
                      className={roadEnterActive ? "board-road-stroke" : undefined}
                      stroke={player.color}
                      strokeWidth="9"
                      strokeLinecap="round"
                    />
                    <line
                      x1={start.x}
                      y1={start.y - 1}
                      x2={end.x}
                      y2={end.y - 1}
                      pathLength={roadEnterActive ? 1 : undefined}
                      className={roadEnterActive ? "board-road-stroke" : undefined}
                      stroke="#fffdf6"
                      strokeOpacity="0.28"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                    <circle
                      cx={x}
                      cy={y}
                      r="6"
                      className={roadEnterActive ? "board-road-badge" : undefined}
                      fill="#fff7e2"
                      stroke={player.color}
                      strokeWidth="1.4"
                    />
                    <text
                      x={x}
                      y={y + 2.6}
                      className={roadEnterActive ? "board-road-badge" : undefined}
                      textAnchor="middle"
                      fill="#33483d"
                      fontSize="7.5"
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
                        routeMode === "ship" || edgeTiles(board, edge).every(tile => tile.terrain === "sea" || tile.terrain === "fog")
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
                      r={highlighted ? 8.5 : 6.5}
                      className={highlighted ? undefined : "legal-target-pulse"}
                      fill={highlighted ? "#664b28" : "#fff4d4"}
                      stroke={highlighted ? "#fff4d4" : "#a77a3a"}
                      strokeWidth="1.5"
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
                const settlementGeneration = boardMotion.newSettlements.get(vertex.id);
                const settlementEnterKey = !city && settlementGeneration !== undefined
                  ? `${boardMotion.version}:settlement:${vertex.id}:${settlementGeneration}`
                  : null;
                const settlementEnterActive = isMotionActive(settlementEnterKey);
                const settlementRingKey = !city && settlementGeneration !== undefined
                  ? `${boardMotion.version}:settlement-ring:${vertex.id}:${settlementGeneration}`
                  : null;
                const settlementRingActive = isMotionActive(settlementRingKey);
                const cityGeneration = boardMotion.upgradedCities.get(vertex.id);
                const cityUpgradeKey = city && cityGeneration !== undefined
                  ? `${boardMotion.version}:city:${vertex.id}:${cityGeneration}`
                  : null;
                const cityUpgradeActive = isMotionActive(cityUpgradeKey);
                const cityRingKey = city && cityGeneration !== undefined
                  ? `${boardMotion.version}:city-ring:${vertex.id}:${cityGeneration}`
                  : null;
                const cityRingActive = isMotionActive(cityRingKey);
                return (
                  <g
                    key={vertex.id}
                    pointerEvents="none"
                  >
                    {settlementRingActive && (
                      <circle
                        key={settlementRingKey}
                        cx={vertex.x}
                        cy={vertex.y}
                        className="board-placement-ring"
                        r="14"
                        fill="none"
                        stroke={player.color}
                        strokeWidth="2.6"
                        aria-hidden="true"
                        onAnimationEnd={event => {
                          if (event.animationName === "board-ring-expand") completeMotionKey(settlementRingKey);
                        }}
                      />
                    )}
                    {cityRingActive && (
                      <circle
                        key={cityRingKey}
                        cx={vertex.x}
                        cy={vertex.y}
                        className="board-upgrade-ring"
                        r="16"
                        fill="none"
                        stroke="#e7ba43"
                        strokeWidth="3"
                        aria-hidden="true"
                        onAnimationEnd={event => {
                          if (event.animationName === "board-ring-expand") completeMotionKey(cityRingKey);
                        }}
                      />
                    )}
                    <g
                      className={cityUpgradeActive ? "board-city-upgrade" : settlementEnterActive ? "board-settlement-enter" : undefined}
                      style={cityUpgradeActive || settlementEnterActive ? { transformOrigin: `${vertex.x}px ${vertex.y}px` } : undefined}
                      onAnimationEnd={event => {
                        if (settlementEnterKey && event.animationName === "board-settlement-drop") completeMotionKey(settlementEnterKey);
                        if (cityUpgradeKey && event.animationName === "board-city-upgrade") completeMotionKey(cityUpgradeKey);
                      }}
                    >
                      <g
                        transform={`translate(${vertex.x} ${vertex.y})`}
                        role="img"
                        aria-label={translateText("{player}'s {piece} at {location}", { player: player.name, piece: pieceName(language, building.kind), location: vertex.id })}
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
                          {getPlayerLabel(player, players.findIndex(
                            (candidate) => candidate.id === player.id,
                          ) + 1)}
                        </text>
                        {city && <path d="M9-9h4v5H9Z" fill="#fff5dc" />}
                      </g>
                    </g>
                  </g>
                );
              })}

            {board.tiles.filter(tile => tile.id === pirateTileId && tile.terrain === "sea").map(tile => {
              const pirateTravel = boardMotion.pirateTravel;
              const pirateTravelKey = pirateTravel === null
                ? null
                : `${boardMotion.version}:pirate-travel:${pirateTravel.generation}`;
              const pirateTravelActive = isMotionActive(pirateTravelKey);
              const pirateEnterKey = boardMotion.pirateEnterGeneration === null
                ? null
                : `${boardMotion.version}:pirate-enter:${boardMotion.pirateEnterGeneration}`;
              const pirateEnterActive = isMotionActive(pirateEnterKey);
              const pirateRippleKey = pirateTravelActive
                ? `${boardMotion.version}:pirate-ripple:${pirateTravel!.generation}`
                : pirateEnterActive
                  ? `${boardMotion.version}:pirate-ripple:${boardMotion.pirateEnterGeneration!}`
                  : null;
              const pirateRippleActive = isMotionActive(pirateRippleKey);
              return (
                <g key="pirate" pointerEvents="none">
                  {pirateRippleActive && (
                    <circle
                      key={pirateRippleKey}
                      cx={tile.x}
                      cy={tile.y - 6}
                      className="board-water-ripple"
                      r="18"
                      aria-hidden="true"
                      onAnimationEnd={event => {
                        if (event.animationName === "board-water-ripple") completeMotionKey(pirateRippleKey);
                      }}
                    />
                  )}
                  <g
                    key={pirateTravelActive ? pirateTravelKey : pirateEnterActive ? pirateEnterKey : "pirate-still"}
                    className={pirateTravelActive ? "board-piece-travel" : pirateEnterActive ? "board-ship-enter" : undefined}
                    style={pirateTravelActive ? ({
                      "--travel-from-x": `${pirateTravel!.horizontal}px`,
                      "--travel-from-y": `${pirateTravel!.vertical}px`,
                    } as CSSProperties) : pirateEnterActive ? { transformOrigin: `${tile.x}px ${tile.y - 6}px` } : undefined}
                    onAnimationEnd={event => {
                      if (pirateTravelKey && event.animationName === "board-piece-travel") completeMotionKey(pirateTravelKey);
                      if (pirateEnterKey && event.animationName === "board-ship-drop") completeMotionKey(pirateEnterKey);
                    }}
                  >
                    <g
                      transform={`translate(${tile.x} ${tile.y - 6})`}
                      role="img"
                      aria-label={translateText("Pirate; adjacent ships cannot be built or moved")}
                    >
                      <path d="M-21 7h42l-8 12H-13ZM0-26V7M3-24 19 3H3Z" fill="#253b36" stroke="#fff5dc" strokeWidth="2" />
                      <path d="m8-8 6 6m0-6-6 6" stroke="#fff5dc" strokeWidth="2" />
                    </g>
                  </g>
                </g>
              );
            })}
            {board.tiles
              .filter((tile) => tile.id === robberTileId && tile.terrain !== "sea" && tile.terrain !== "fog")
              .map((tile) => {
                const robberTravel = boardMotion.robberTravel;
                const robberTravelKey = robberTravel === null
                  ? null
                  : `${boardMotion.version}:robber-travel:${robberTravel.generation}`;
                const robberTravelActive = isMotionActive(robberTravelKey);
                const robberBlockedShake = !robberTravelActive &&
                  blockedRollActive &&
                  tile.number !== null &&
                  tile.number === rolledNumber;
                return (
                  <g
                    key={robberTravelActive ? robberTravelKey : robberBlockedShake ? blockedRollKey : "robber"}
                    className={robberTravelActive ? "board-piece-travel" : robberBlockedShake ? "board-blocked-shake" : undefined}
                    style={robberTravelActive ? ({
                      "--travel-from-x": `${robberTravel!.horizontal}px`,
                      "--travel-from-y": `${robberTravel!.vertical}px`,
                    } as CSSProperties) : undefined}
                    pointerEvents="none"
                    onAnimationEnd={event => {
                      if (robberTravelKey && event.animationName === "board-piece-travel") completeMotionKey(robberTravelKey);
                      if (blockedRollKey && event.animationName === "board-blocked-shake") completeMotionKey(blockedRollKey);
                    }}
                  >
                    <g
                      transform={`translate(${tile.x + 24} ${tile.y + 18 - (raisedTileIds.has(tile.id) ? tileElevation : 0)})`}
                      role="img"
                      aria-label={translateText(tile.number === null ? "Robber on {resource}; production blocked" : "Robber on {resource} {number}; production blocked", {
                        resource: terrainResourceName(tile.terrain), number: tile.number ?? "",
                      })}
                    >
                      <ellipse
                        cy="13"
                        rx="13.5"
                        ry="4.5"
                        fill="#1a2c26"
                        opacity="0.32"
                      />
                      <path
                        d="M-10 11Q-12 8-8 3L-5-4Q-11-12-5-17Q0-21 5-17Q11-12 5-4L8 3Q12 8 10 11Z"
                        fill={`url(#${illustrationId}-robber)`}
                        stroke="#fff6dd"
                        strokeWidth="2.1"
                        strokeLinejoin="round"
                      />
                      <path
                        d="M-3-15Q-6-12-3-9M-5 5-3-1"
                        fill="none"
                        stroke="#a4b4aa"
                        strokeOpacity="0.85"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                      />
                      <path d="M-8 8H8" stroke="#18241f" strokeWidth="2" />
                    </g>
                  </g>
                );
              })}

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
                      r={occupied ? 24 : highlighted ? 17.5 : 13.5}
                      className={highlighted ? undefined : "legal-target-pulse"}
                      fill={occupied ? "none" : "#fff5d9"}
                      fillOpacity="0.8"
                      stroke={highlighted ? "#5d4525" : "#b68c45"}
                      strokeWidth={highlighted ? "3" : "1.6"}
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
            {board.tiles
              .filter(tile => hiddenNumberIds.has(tile.id))
              .map(tile => (
                <circle
                  key={`number-peek-${tile.id}`}
                  cx={tile.x}
                  cy={tile.y + 2}
                  r="20"
                  fill="transparent"
                  className="number-peek-target cursor-pointer outline-none"
                  role="button"
                  tabIndex={0}
                  aria-pressed={peekedTileId === tile.id}
                  aria-label={`${tileDescription(tile)}. ${translateText("Toggle to reveal the number hidden by this harbor")}`}
                  onClick={() => setPeekedTileId(current => current === tile.id ? null : tile.id)}
                  onKeyDown={event => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      if (!event.repeat) setPeekedTileId(current => current === tile.id ? null : tile.id);
                    }
                  }}
                />
              ))}
            {activeHarvestBursts.map((burst) => {
              const accent = burst.terrain === "gold" ? "#c9982c" : theme.resources[burst.terrain];
              return (
                <g
                  key={burst.key}
                  transform={`translate(${burst.horizontal} ${burst.vertical - 24})`}
                  pointerEvents="none"
                  aria-hidden="true"
                >
                  <g
                    className="board-harvest-chip"
                    style={{ animationDelay: `${Math.min(burst.index, 6) * 45}ms` }}
                    onAnimationEnd={event => {
                      if (event.animationName === "board-harvest-rise") completeMotionKey(burst.key);
                    }}
                  >
                    <rect
                      x="-19"
                      y="-10.5"
                      width="38"
                      height="21"
                      rx="10.5"
                      fill="#fffdf6"
                      stroke={accent}
                      strokeWidth="1.8"
                    />
                    {burst.terrain === "gold" ? (
                      <g transform="translate(-8 0)">
                        <circle r="6" fill="#f7dc7a" stroke="#b5831d" strokeWidth="1.2" />
                        <circle r="3.4" fill="none" stroke="#c9982c" strokeWidth="0.9" />
                      </g>
                    ) : (
                      <g transform="translate(-15 -6.5) scale(0.42)" color={accent}>
                        <ResourceArtwork resource={burst.terrain} theme={theme} />
                      </g>
                    )}
                    <text
                      x="7.5"
                      y="3.5"
                      textAnchor="middle"
                      fill="#2f4239"
                      fontSize="10.5"
                      fontWeight="800"
                    >
                      +{burst.amount}
                    </text>
                  </g>
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
          {confirmation.player && (
            <p className="placement-confirmation-player">
              <span className="placement-confirmation-player-dot" style={{ backgroundColor: confirmation.player.color }} />
              {confirmation.player.name}
            </p>
          )}
          <p id={`${illustrationId}-confirmation-title`}>{confirmation.title}</p>
          <div className={confirmation.choices ? "placement-confirmation-choices" : undefined}>
            <button type="button" className="button-secondary" onClick={cancelConfirmation}>
              {translateText("Cancel")}
            </button>
            {confirmation.choices ? confirmation.choices.map((choice, index) => (
              <button
                key={choice.label}
                ref={index === 0 ? confirmButtonReference : undefined}
                type="button"
                aria-label={choice.label}
                aria-describedby={`${illustrationId}-confirmation-title`}
                className="button-primary"
                onClick={() => runConfirmation(choice.onConfirm)}
              >
                {choice.icon && <span className="flex shrink-0 items-center [&>svg]:h-4 [&>svg]:w-4">{choice.icon}</span>}
                {choice.label}
              </button>
            )) : (
              <button
                ref={confirmButtonReference}
                type="button"
                aria-label={translateText("Confirm placement")}
                aria-describedby={`${illustrationId}-confirmation-title`}
                className="button-primary"
                onClick={() => runConfirmation(confirmation.onConfirm)}
              >
                {translateText("Confirm")}
              </button>
            )}
          </div>
        </div>
      )}
      <div
        className={`board-controls flex flex-wrap min-w-0 shrink-0 items-center justify-end gap-2 border-t border-[#e0ddcd] bg-[#f8f5eb] ${compact ? "px-3 py-2" : "px-4 py-3 sm:px-5"}`}
      >
        {onChangeTheme && (
          <button
            type="button"
            className={`board-theme-button ${victoryTarget === undefined && !pirateIndicator ? "mr-auto" : ""}`}
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
        {pirateIndicator && (
          <button
            type="button"
            className="board-pirate-button button-secondary min-w-0 px-2.5 text-xs disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-white/50"
            disabled={!pirateIndicator.enabled}
            onClick={pirateIndicator.onSelect}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
              <path d="M4 15h16l-2.5 4h-11Z" />
              <path d="M12 15V4" />
              <path d="M12 4l6 8h-6Z" />
            </svg>
            <span className="truncate">{translateText(pirateIndicator.onBoard ? "Move pirate off board" : "Pirate off board")}</span>
          </button>
        )}
        {victoryTarget !== undefined && (
          <span className="@container pointer-events-none flex min-w-0 flex-1 items-center justify-center">
            {onChangeVictoryTarget ? (
              <VictoryTargetBadge victoryTarget={victoryTarget} disabled={victoryTargetDisabled} onChange={onChangeVictoryTarget} />
            ) : (
              <span className={victoryTargetPillClassName}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#b58a2d" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
                  <path d="M8 21h8" /><path d="M12 17v4" /><path d="M7 4h10v5a5 5 0 0 1-10 0Z" /><path d="M7 6H4a3 3 0 0 0 3 4" /><path d="M17 6h3a3 3 0 0 1-3 4" />
                </svg>
                <VictoryTargetLabel victoryTarget={victoryTarget} />
              </span>
            )}
          </span>
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
            className="flex size-11 items-center justify-center rounded-xl border border-[#dcdccb] bg-[#fffdf5] text-xl text-[#455e4d] transition-colors hover:bg-[#e9edde] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#886636] disabled:cursor-not-allowed disabled:opacity-45"
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
            className="flex size-11 items-center justify-center rounded-xl border border-[#dcdccb] bg-[#fffdf5] text-xl text-[#455e4d] transition-colors hover:bg-[#e9edde] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#886636] disabled:cursor-not-allowed disabled:opacity-45"
          >
            +
          </button>
        </div>
      </div>
    </div>
  );
}
