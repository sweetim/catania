import { Fragment, useEffect, useEffectEvent, useRef, useState } from "react";
import { match } from "ts-pattern";
import { Board } from "./components/Board";
import { RollSummary, type RollStage } from "./components/RollSummary";
import { ResourceCollection, type ResourceReceipt } from "./components/ResourceCollection";
import { ThemeSelector } from "./components/ThemeSelector";
import { BOARD_THEMES, BoardThemeContext, type BoardThemeId } from "./themes";
import {
  Arrow,
  BankSupply,
  CardStack,
  CardTypeIcon,
  Cost,
  DevelopmentCardIcon,
  Dialog,
  Logo,
  PieceIcon,
  RESOURCE_NAMES,
  ResourceCard,
  ResourceCardStepper,
  ResourceInventory,
  SelectableResourceCard,
} from "./components/GameUi";
import { createBoard } from "./game/board";
import { chooseComputerAction, getController } from "./game/computer";
import {
  applyAction,
  COSTS,
  createGame,
  emptyResources,
  getLongestRoadLength,
  getScore,
  getTradeRatio,
  legalCityVertices,
  legalRoadEdges,
  legalSettlementVertices,
  RESOURCES,
  resourceTotal,
} from "./game/engine";
import type {
  DevelopmentKind,
  GameAction,
  GameState,
  Player,
  Resource,
  Resources,
} from "./game/types";
import "./index.css";
import { getRollOutcome, type RollOutcome } from "./rollPresentation";
import { getResourceGains } from "./resourceReceipt";

type RollPresentation = {
  outcome: RollOutcome;
  next: GameState;
  automatic: boolean;
  stage: RollStage;
};

const PLAYER_COLORS = ["#b85d47", "#477c91", "#c1953d", "#76608c"];
const BLOCKED_SETTLEMENT_LOCATIONS_STORAGE_KEY = "catania.showBlockedSettlementLocations";
const BOARD_THEME_STORAGE_KEY = "catania.boardTheme";
const DEVELOPMENT_NAMES: Record<DevelopmentKind, string> = {
  knight: "Knight",
  "victory-point": "Victory point",
  "road-building": "Road building",
  "year-of-plenty": "Year of plenty",
  monopoly: "Monopoly",
};
const DEVELOPMENT_DESCRIPTIONS: Record<DevelopmentKind, string> = {
  knight:
    "Move the robber and steal one random resource from an adjacent opponent. Only played Knights count toward Largest Army (+2 points): at least three, and more than the current holder.",
  "victory-point":
    "One hidden victory point. Counted automatically toward your ten points on your turn, including when purchased.",
  "road-building":
    "Place two roads for free, following the usual connection and piece-limit rules.",
  "year-of-plenty":
    "Choose two resources from the bank, or all that remain if fewer than two are available.",
  monopoly:
    "Name a resource. Every other player gives you all of that resource from their hand.",
};

function phaseTitle(state: GameState) {
  return match(state.phase)
    .with({ type: "setup-settlement" }, () => "Find a place to call home.")
    .with({ type: "setup-road" }, () => "Every journey starts here.")
    .with({ type: "roll" }, () => "Let the dice decide.")
    .with({ type: "actions" }, () => "Make your next move.")
    .with({ type: "discard" }, () => "Make room in your hand.")
    .with({ type: "robber" }, phase => phase.pendingKnight ? "Move the robber." : "The robber is on the move.")
    .with({ type: "steal" }, () => "Choose a neighboring player.")
    .with({ type: "road-building" }, () => "Take the road less traveled.")
    .with({ type: "finished" }, () => "An island. A new legend.")
    .exhaustive();
}

function phaseDescription(state: GameState) {
  return match(state.phase)
    .with(
      { type: "setup-settlement" },
      () =>
        `Place your ${state.setupIndex < state.players.length ? "first" : "second"} settlement on a highlighted intersection. Leave at least two edges between settlements.`,
    )
    .with(
      { type: "setup-road" },
      () =>
        "Choose a highlighted edge connected to your new settlement, then confirm your road.",
    )
    .with(
      { type: "roll" },
      () =>
        "Roll two dice to gather resources. You may play an eligible development card before rolling.",
    )
    .with(
      { type: "actions" },
      () =>
        "Trade with the bank or another player, build your island, or invest in a development card.",
    )
    .with(
      { type: "discard" },
      () =>
        "A seven was rolled. Players with more than seven resource cards must return half, rounded down, to the bank.",
    )
    .with(
      { type: "robber" },
      phase => phase.pendingKnight
        ? "Confirm a new hex or cancel Knight."
        : "Select a different hex. The robber stops that hex from producing until it moves again.",
    )
    .with(
      { type: "steal" },
      () =>
        "Choose an opponent beside the robber. Take one random resource if they have any; an empty hand gives you nothing.",
    )
    .with(
      { type: "road-building" },
      (phase) =>
        `Place ${phase.remaining} more road${phase.remaining === 1 ? "" : "s"} for free. Confirm each placement on the board.`,
    )
    .with(
      { type: "finished" },
      () => "The first player to reach ten victory points on their turn wins.",
    )
    .exhaustive();
}

export function App() {
  const [boardThemeId, setBoardThemeId] = useState<BoardThemeId>(() => {
    try {
      const savedTheme = window.localStorage.getItem(BOARD_THEME_STORAGE_KEY);
      return savedTheme && Object.hasOwn(BOARD_THEMES, savedTheme) ? savedTheme as BoardThemeId : "illustrated";
    } catch {
      return "illustrated";
    }
  });
  const boardTheme = BOARD_THEMES[boardThemeId];
  const [preview, setPreview] = useState(() => createBoard());
  const [names, setNames] = useState(["Alex", "Sam", "Jordan", "Robin"]);
  const [playerCount, setPlayerCount] = useState(3);
  const [humanCount, setHumanCount] = useState(1);
  const [game, setGame] = useState<GameState | null>(null);
  const [rollPresentation, setRollPresentation] = useState<RollPresentation | null>(null);
  const [resourceReceipt, setResourceReceipt] = useState<ResourceReceipt | null>(null);
  const [showBlockedSettlementLocations, setShowBlockedSettlementLocations] = useState(() => {
    try {
      return window.localStorage.getItem(BLOCKED_SETTLEMENT_LOCATIONS_STORAGE_KEY) !== "false";
    } catch {
      return true;
    }
  });
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const rollBusy = Boolean(rollPresentation && rollPresentation.stage !== "complete");
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [handoffTarget, setHandoffTarget] = useState<string | null>(null);
  const [dialog, setDialog] = useState<
    "help" | "settings" | "theme" | "trade" | "development" | "players" | "restart" | null
  >(null);
  const gameMenu = useRef<HTMLDetailsElement>(null);
  const [gameMenuOpen, setGameMenuOpen] = useState(false);
  const [mobileView, setMobileView] = useState<"board" | "hand" | "players">(
    "hand",
  );
  const [buildMode, setBuildMode] = useState<
    "road" | "settlement" | "city" | null
  >(null);
  const [selected, setSelected] = useState<{
    kind: "vertex" | "edge" | "tile";
    id: string;
  } | null>(null);
  const [confirmation, setConfirmation] = useState<{
    action: GameAction;
    title: string;
    description?: string;
    exchange?: { give: Resources; receive: Resources };
  } | null>(null);
  const [error, setError] = useState("");
  const [tradeMode, setTradeMode] = useState<"bank" | "players">("bank");
  const [playerTradeMode, setPlayerTradeMode] = useState<"request" | "offer">("request");
  const [giveResource, setGiveResource] = useState<Resource>("wood");
  const [receiveResource, setReceiveResource] = useState<Resource>("brick");
  const [giveResources, setGiveResources] = useState(emptyResources);
  const [receiveResources, setReceiveResources] = useState(emptyResources);
  const [chosenResources, setChosenResources] = useState(emptyResources);
  const [chosenResource, setChosenResource] = useState<Resource>("wood");
  const [developmentCardId, setDevelopmentCardId] = useState<string | null>(
    null,
  );
  const humanPlayers =
    game?.players.filter((player) => player.control === "human") ?? [];
  const needsHandoff = humanPlayers.length > 1;
  const controllingPlayer = game?.players.find(
    (player) => player.id === getController(game),
  );
  const computerPlayer =
    game && !game.winnerId
      ? game.players.find(
          (player) =>
            player.control === "computer" &&
            game.trade &&
            game.trade.offeredBy !== player.id &&
            game.trade.responses[player.id] === undefined,
        ) ??
        (controllingPlayer?.control === "computer" ? controllingPlayer : undefined)
      : undefined;

  const takeComputerTurn = useEffectEvent(
    (expectedGame: GameState, playerId: string) => {
      if (game !== expectedGame || rollBusy) return;
      try {
        const action = chooseComputerAction(game, playerId);
        if (action) presentAction(applyAction(game, playerId, action), action, true);
      } catch (failure) {
        setError(
          failure instanceof Error
            ? failure.message
            : "The computer could not finish its move.",
        );
      }
    },
  );

  useEffect(() => {
    if (!game || !computerPlayer || rollBusy || dialog === "restart") return;
    const timeout = window.setTimeout(
      () => takeComputerTurn(game, computerPlayer.id),
      450,
    );
    return () => window.clearTimeout(timeout);
  }, [game, computerPlayer?.id, rollBusy, dialog === "restart"]);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(preference.matches);
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(BLOCKED_SETTLEMENT_LOCATIONS_STORAGE_KEY, String(showBlockedSettlementLocations));
    } catch {
      // Keep the toggle usable when browser storage is unavailable.
    }
  }, [showBlockedSettlementLocations]);

  useEffect(() => {
    try {
      window.localStorage.setItem(BOARD_THEME_STORAGE_KEY, boardThemeId);
    } catch {
      // Theme switching still works when browser storage is unavailable.
    }
  }, [boardThemeId]);

  const advanceRollPresentation = useEffectEvent((expected: RollPresentation) => {
    if (rollPresentation !== expected) return;
    const stage = reducedMotion ? "complete" : match(expected.stage)
      .with("rolling", () => "production" as const)
      .with("production", () => "received" as const)
      .with("received", "complete", () => "complete" as const)
      .exhaustive();
    setRollPresentation({ ...expected, stage });
    if ((expected.stage === "rolling" || expected.stage === "production") && stage !== "production") {
      advanceGame(expected.next, expected.automatic);
    }
  });

  useEffect(() => {
    if (!rollPresentation || rollPresentation.stage === "complete" || dialog === "restart") return;
    // Timers also finish when CSS motion is disabled; animationend is not required.
    const duration = reducedMotion ? 0 : match(rollPresentation.stage)
      .with("rolling", () => 500)
      .with("production", () => 300)
      .with("received", () => 700)
      .exhaustive();
    const timeout = window.setTimeout(() => advanceRollPresentation(rollPresentation), duration);
    return () => window.clearTimeout(timeout);
  }, [rollPresentation, reducedMotion, dialog === "restart"]);

  useEffect(() => {
    if (!resourceReceipt) return;
    const timeout = window.setTimeout(() => setResourceReceipt(null), 3200);
    return () => window.clearTimeout(timeout);
  }, [resourceReceipt]);

  useEffect(() => {
    if (!game || game.winnerId) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [Boolean(game), Boolean(game?.winnerId)]);

  useEffect(() => {
    const dismissMenu = (event: PointerEvent) => {
      if (gameMenu.current && event.target instanceof Node && !gameMenu.current.contains(event.target)) {
        gameMenu.current.open = false;
      }
    };
    document.addEventListener("pointerdown", dismissMenu);
    return () => document.removeEventListener("pointerdown", dismissMenu);
  }, []);

  function openGameDialog(nextDialog: "help" | "settings" | "players" | "restart") {
    if (gameMenu.current) {
      gameMenu.current.open = false;
      // Dialogs restore focus to the visible opener, not a hidden menu item.
      gameMenu.current.querySelector("summary")?.focus();
    }
    setDialog(nextDialog);
    if (nextDialog === "help") setError("");
  }

  function startGame(selectedBoard?: GameState["board"]) {
    try {
      const profiles = names.slice(0, playerCount).map(
        (name, index): Pick<Player, "name" | "color" | "control"> => ({
          name: index < humanCount
            ? name.trim() || `Player ${index + 1}`
            : `Computer ${index - humanCount + 1}`,
          color: PLAYER_COLORS[index]!,
          control: index < humanCount ? "human" : "computer",
        }),
      );
      if (
        new Set(profiles.map((profile) => profile.name.toLowerCase())).size !==
        profiles.length
      ) {
        throw new Error(
          "Use a different name for each player so private handoffs are clear.",
        );
      }
      const next = createGame(profiles, undefined, selectedBoard);
      setRollPresentation(null);
      setResourceReceipt(null);
      setGame(next);
      const firstHuman = next.players.find(
        (player) => player.control === "human",
      )!;
      const firstController = next.players.find(
        (player) => player.id === getController(next),
      )!;
      setViewerId(humanCount === 1 ? firstHuman.id : null);
      setHandoffTarget(
        humanCount > 1 && firstController.control === "human"
          ? firstController.id
          : null,
      );
      setDialog(null);
      setConfirmation(null);
      setChosenResources(emptyResources());
      setDevelopmentCardId(null);
      setMobileView("board");
      setError("");
      setSelected(null);
      setBuildMode(null);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "The game could not be started.",
      );
    }
  }

  function passTo(playerId: string) {
    if (!needsHandoff || !humanPlayers.some((player) => player.id === playerId)) {
      return;
    }
    setViewerId(null);
    setRollPresentation(null);
    setResourceReceipt(null);
    setHandoffTarget(playerId);
    setDialog(current => current === "theme" ? current : null);
    setConfirmation(null);
    setSelected(null);
    setBuildMode(null);
    setError("");
    setDevelopmentCardId(null);
    setChosenResources(emptyResources());
  }

  function advanceGame(next: GameState, automatic = false) {
    if (game && viewerId) {
      const previousPlayer = game.players.find(player => player.id === viewerId)!;
      const nextPlayer = next.players.find(player => player.id === viewerId)!;
      const gains = getResourceGains(previousPlayer.resources, nextPlayer.resources);
      if (resourceTotal(gains) > 0) {
        setResourceReceipt(previous => ({ id: (previous?.id ?? 0) + 1, playerId: viewerId, gains }));
      }
    }
    setGame(next);
    if (next.winnerId) {
      setRollPresentation(null);
      setResourceReceipt(null);
      setViewerId(null);
      setHandoffTarget(null);
      setDialog(null);
      setConfirmation(null);
      return;
    }
    const nextController = getController(next);
    const controllerChanged = game && getController(game) !== nextController;
    // Off-turn computer trade responses must not interrupt a human's private input.
    if (automatic && !controllerChanged) return;
    if (needsHandoff && nextController !== viewerId) {
      const nextPlayer = next.players.find(
        (player) => player.id === nextController,
      )!;
      if (nextPlayer.control === "human") {
        passTo(nextController);
      } else {
        setViewerId(null);
        setResourceReceipt(null);
        setHandoffTarget(null);
        setDialog(current => current === "theme" ? current : null);
        setConfirmation(null);
      }
    }
    if (automatic && nextController !== viewerId &&
      !(next.phase.type === "discard" && (next.phase.required[viewerId ?? ""] ?? 0) > 0)) return;
    if (game?.phase.type === "roll" && next.phase.type === "actions") return;
    setMobileView(
      ["setup-settlement", "setup-road", "road-building", "robber"].includes(
        next.phase.type,
      )
        ? "board"
        : "hand",
    );
  }

  function presentAction(next: GameState, action: GameAction, automatic = false) {
    if (action.type === "roll" && game) {
      setResourceReceipt(null);
      setRollPresentation({
        outcome: getRollOutcome(game, next),
        next,
        automatic,
        stage: reducedMotion ? "complete" : "rolling",
      });
      if (reducedMotion) advanceGame(next, automatic);
    } else {
      setRollPresentation(null);
      advanceGame(next, automatic);
    }
  }

  function perform(action: GameAction) {
    if (!game || rollBusy || !viewerId || !humanPlayers.some((player) => player.id === viewerId)) return;
    try {
      const next = applyAction(game, viewerId, action);
      setError("");
      setSelected(null);
      setBuildMode(null);
      setConfirmation(null);
      setDialog(null);
      setChosenResources(emptyResources());
      setDevelopmentCardId(null);
      presentAction(next, action);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "That action is not available.",
      );
    }
  }

  const activePlayer = game?.players.find(
    (player) => player.id === game.activePlayerId,
  );
  const viewer = humanPlayers.find((player) => player.id === viewerId);
  const handoffPlayer = game?.players.find(
    (player) => player.id === handoffTarget,
  );
  const isActive = Boolean(viewer && viewer.id === activePlayer?.id);
  const normalActions = isActive && !rollBusy && game?.phase.type === "actions";
  const canCancelKnight = isActive && !rollBusy && game?.phase.type === "robber" && Boolean(game.phase.pendingKnight);
  const producingTileIds = rollPresentation && rollPresentation.stage !== "rolling"
    ? rollPresentation.outcome.producingTileIds : [];
  const rolledNumber = rollPresentation && rollPresentation.stage !== "rolling"
    ? rollPresentation.outcome.dice[0] + rollPresentation.outcome.dice[1] : undefined;
  const receivedResources = resourceReceipt?.playerId === viewerId ? resourceReceipt?.gains : undefined;
  const awaitingViewer = viewer && (
    viewer.id === controllingPlayer?.id ||
    (game?.phase.type === "discard" && (game.phase.required[viewer.id] ?? 0) > 0)
  );
  const handTaskOpen = Boolean(viewer && game && (game.trade ||
    (game.phase.type === "discard" && (game.phase.required[viewer.id] ?? 0) > 0) ||
    (game.phase.type === "steal" && isActive)));
  const instructionTitle = rollBusy ? "Let the island provide." : game && awaitingViewer
    ? phaseTitle(game)
    : "The island is in motion.";
  const instructionDescription = rollBusy
    ? "Follow the dice, the matching number tokens, and the cards arriving in your hand."
    : game && awaitingViewer
    ? phaseDescription(game)
    : `${controllingPlayer?.name} is playing. You can inspect your hand and the island while you wait.`;
  const canAfford = (cost: ReturnType<typeof emptyResources>) =>
    Boolean(
      viewer &&
        RESOURCES.every(
          (resource) => viewer.resources[resource] >= cost[resource],
        ),
    );
  const settlementUnavailable = game && viewer &&
    game.board.vertices.filter(vertex => vertex.building?.playerId === viewer.id && vertex.building.kind === "settlement").length >= 5
      ? "All 5 settlements are on the board. Upgrade one to a city to free a settlement piece."
      : null;
  const legalVertices =
    game && viewer && isActive && !rollBusy
      ? game.phase.type === "setup-settlement" || buildMode === "settlement"
        ? legalSettlementVertices(game, viewer.id)
        : buildMode === "city"
          ? legalCityVertices(game, viewer.id)
          : []
      : [];
  const legalEdges =
    game &&
    viewer &&
    isActive &&
    !rollBusy &&
    (game.phase.type === "setup-road" ||
      game.phase.type === "road-building" ||
      buildMode === "road")
      ? legalRoadEdges(game, viewer.id)
      : [];
  const legalTiles =
    game && viewer && isActive && !rollBusy && game.phase.type === "robber"
      ? game.board.tiles
          .filter((tile) => tile.id !== game.robberTileId)
          .map((tile) => tile.id)
      : [];
  const selectedAction: GameAction | null =
    !selected || !game
      ? null
      : selected.kind === "tile"
        ? { type: "move-robber", tileId: selected.id }
        : selected.kind === "edge"
          ? { type: "place-road", edgeId: selected.id }
          : {
              type: buildMode === "city" ? "place-city" : "place-settlement",
              vertexId: selected.id,
            };
  const developmentCard = viewer?.developmentCards.find(
    (card) => card.id === developmentCardId,
  );
  const ratio =
    game && viewer ? getTradeRatio(game, viewer.id, giveResource) : 4;
  const canExchange = Boolean(game && viewer && giveResource !== receiveResource &&
    viewer.resources[giveResource] >= ratio && game.bank[receiveResource] > 0);

  function playerCards(detailed = false) {
    if (!game) return null;
    const scores = game.players.map(player => getScore(game, player.id));
    const highestPublicScore = Math.max(...scores.map(score => score.public));
    const showPublicScoreLeaders = scores.some(score => score.public < highestPublicScore);
    return game.players.map((player, index) => {
      const score = scores[index]!;
      const isPublicScoreLeader = showPublicScoreLeaders && score.public === highestPublicScore;
      const hasLargestArmy = game.awards.largestArmy === player.id;
      const hasLongestRoad = game.awards.longestRoad === player.id;
      const knightLabel = `${player.knightsPlayed} ${player.knightsPlayed === 1 ? "knight" : "knights"} played`;
      const roadLength = getLongestRoadLength(game, player.id);
      const roadLabel = `${roadLength} connected ${roadLength === 1 ? "road" : "roads"}`;
      return (
        <div
          key={player.id}
          className={`player-seat min-w-0 rounded-xl border px-4 py-3 ${game.activePlayerId === player.id ? "player-seat-active border-forest/40 bg-moss/80" : "border-line bg-white/30"} ${isPublicScoreLeader ? "player-seat-leading" : ""}`}
        >
          <div className={detailed ? "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1" : "flex items-center gap-2.5"}>
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
              style={{ background: player.color }}
            >
              {index + 1}
            </span>
            <p className="min-w-0 flex-1 truncate text-sm font-semibold">{player.name}</p>
            <div role="group" aria-label={`${player.name}'s card counts`} className={`player-card-counts ${detailed ? "player-card-counts-detailed col-span-2 col-start-2 row-start-2" : ""}`}>
              <span role="img" aria-label={`${resourceTotal(player.resources)} resource cards`} title={`${resourceTotal(player.resources)} resource cards`} className="player-card-stat text-forest">
                <CardTypeIcon kind="resource" />
                <strong>{resourceTotal(player.resources)}</strong>
                {detailed && <span className="text-[10px] text-muted">resources</span>}
              </span>
              <span role="img" aria-label={`${player.developmentCards.length} development cards`} title={`${player.developmentCards.length} development cards`} className="player-card-stat text-[#947231]">
                <CardTypeIcon kind="development" />
                <strong>{player.developmentCards.length}</strong>
                {detailed && <span className="text-[10px] text-muted">development</span>}
              </span>
              <span role="img" aria-label={knightLabel} title={knightLabel} className="player-card-stat text-forest">
                <DevelopmentCardIcon kind="knight" />
                <strong>{player.knightsPlayed}</strong>
              </span>
              <span className="flex items-center gap-2.5">
                <span role="img" aria-label={roadLabel} title={roadLabel} className="player-card-stat text-forest">
                  <PieceIcon piece="road" />
                  <strong>{roadLength}</strong>
                </span>
                {hasLargestArmy && (
                  <svg role="img" aria-label="Largest Army (+2 victory points)" viewBox="0 0 24 28" className="shrink-0 text-[#b58a2d]" fill="none">
                    <title>Largest Army (+2 victory points)</title>
                    <path d="m3 3 5 2 11 13-3 3L5 8 3 3Zm18 0-5 2L5 18l3 3L19 8l2-5Z" fill="currentColor" />
                    <path d="m13 21 7-6M4 15l7 6m6 0 3 4M7 21l-3 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                )}
                {hasLongestRoad && (
                  <span role="img" aria-label="Longest Road (+2 victory points)" title="Longest Road (+2 victory points)" className="shrink-0 text-[#b58a2d]">
                    <PieceIcon piece="road" />
                  </span>
                )}
              </span>
            </div>
            <div className={`player-score col-start-3 row-start-1 flex shrink-0 items-center gap-1 text-right ${isPublicScoreLeader ? "text-[#8b6425]" : ""}`}>
              {isPublicScoreLeader && (
                <svg role="img" aria-label="Public VP leader" viewBox="0 0 24 24" className="size-4 shrink-0 text-[#b58a2d]" fill="currentColor">
                  <title>Highest public victory points</title>
                  <path d="m3 6 4.5 4L12 3l4.5 7L21 6l-2 12H5L3 6Z" />
                  <path d="M5 21h14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              )}
              <span className="font-serif text-2xl">
                {game.winnerId ? score.total : score.public}
              </span>
              <span className="text-[9px] text-muted">VP</span>
            </div>
          </div>
          {detailed && (
            <div className="player-awards mt-3 border-t border-line pt-3 text-xs leading-6">
              <p>{roadLabel}</p>
            </div>
          )}
        </div>
      );
    });
  }

  return (
    <BoardThemeContext value={boardTheme}>
    <div data-theme={boardThemeId} className={game && !game.winnerId ? "game-shell" : "min-h-dvh"}>
      <header className="mx-auto flex max-w-[1600px] items-center justify-between gap-4 border-b border-line px-5 py-5 sm:px-9 lg:px-12">
        <Logo />
        <div className="hidden items-center gap-2 text-[10px] font-semibold uppercase tracking-[.16em] text-muted sm:flex">
          <span className="h-1.5 w-1.5 rounded-full bg-forest" />
          {game ? "A little friendly competition" : "Made for gathering around"}
        </div>
        {game && !game.winnerId ? (
          <details
            ref={gameMenu}
            className="game-menu relative shrink-0"
            onToggle={(event) => setGameMenuOpen(event.currentTarget.open)}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
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
            <summary role="button" aria-expanded={gameMenuOpen} aria-controls="game-menu" className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-3 text-xs font-semibold hover:bg-moss focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest">
              Game
              <svg aria-hidden="true" className="h-3 w-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="m3 4.5 3 3 3-3" />
              </svg>
            </summary>
            <div id="game-menu" role="group" aria-label="Game menu" className="absolute right-0 top-full z-50 mt-1 w-48 rounded-xl border border-line bg-paper p-1.5 shadow-xl">
              <button className="min-h-11 w-full rounded-lg px-3 text-left text-sm hover:bg-moss" onClick={() => openGameDialog("help")}>
                Help
              </button>
              <button className="min-h-11 w-full rounded-lg px-3 text-left text-sm hover:bg-moss" onClick={() => openGameDialog("settings")}>
                Settings
              </button>
              {needsHandoff && viewer && (
                <button className="min-h-11 w-full rounded-lg px-3 text-left text-sm hover:bg-moss" disabled={rollBusy} onClick={() => openGameDialog("players")}>
                  Pass device
                </button>
              )}
              <div className="mt-1 border-t border-line pt-1">
                <button className="min-h-11 w-full rounded-lg px-3 text-left text-sm text-clay hover:bg-clay/10" onClick={() => openGameDialog("restart")}>
                  End game
                </button>
              </div>
            </div>
          </details>
        ) : (
          <button
            className="text-xs font-semibold underline decoration-line underline-offset-4 hover:decoration-forest"
            onClick={() => {
              setDialog("help");
              setError("");
            }}
          >
            Help{" "}
            <span aria-hidden="true" className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full border border-line font-serif">
              ?
            </span>
          </button>
        )}
      </header>

      {!game ? (
        <main className="mx-auto max-w-[1440px] px-5 sm:px-9 lg:px-12">
          <div className="grid items-center gap-3 pb-10 pt-10 lg:grid-cols-[.85fr_1.15fr] lg:gap-10 lg:pb-14 lg:pt-14">
            <section className="relative z-10">
              <p className="eyebrow mb-5 flex items-center gap-3">
                <span className="h-px w-8 bg-clay" />
                Leave the everyday on the mainland
              </p>
              <h1 className="max-w-lg font-serif text-5xl leading-[1.05] tracking-[-.045em] sm:text-6xl lg:text-[72px]">
                A little island.
                <br />
                Endless <span className="italic text-ink">possibility.</span>
              </h1>
              <p className="mt-6 max-w-sm text-sm leading-7 text-muted">
                Gather your favorite people. Settle new shores, strike a good
                deal, and build something worth coming together for.
              </p>
              <div className="my-7 flex flex-wrap gap-5 text-[11px] font-medium text-muted">
                <span className="flex items-center gap-2">
                  <svg
                    aria-hidden="true"
                    className="h-4 w-4"
                    viewBox="0 0 20 20"
                    fill="none"
                    stroke="currentColor"
                  >
                    <circle cx="8" cy="6" r="3" />
                    <path d="M2 18v-3a6 6 0 0 1 12 0v3m1-14a3 3 0 0 1 0 6m1 2a5 5 0 0 1 3 6" />
                  </svg>
                  1-4 people / AI opponents
                </span>
                <span>60-120 minutes</span>
                <span>One shared device</span>
              </div>
              <section
                className="panel max-w-lg p-5 sm:p-6"
                aria-label="Set up your table"
              >
                <div className="mb-5 flex items-center justify-between gap-3">
                  <h2 className="font-serif text-xl">
                    Make room at the table.
                  </h2>
                  <div
                    className="flex rounded-lg bg-moss p-1"
                    aria-label="Number of players"
                  >
                    {[3, 4].map((count) => (
                      <button
                        key={count}
                        onClick={() => {
                          setPlayerCount(count);
                          setHumanCount((current) => Math.min(current, count));
                        }}
                        aria-pressed={playerCount === count}
                        className={`min-h-8 rounded-md px-3 text-xs font-semibold ${playerCount === count ? "bg-white shadow-sm" : "text-muted"}`}
                      >
                        {count} players
                      </button>
                    ))}
                  </div>
                </div>
                <label className="mb-4 flex items-center justify-between gap-3 text-xs font-semibold">
                  <span>Human players</span>
                  <select
                    className="field !w-auto"
                    value={humanCount}
                    onChange={(event) =>
                      setHumanCount(Number(event.target.value))
                    }
                  >
                    {Array.from({ length: playerCount }, (_, index) => index + 1)
                      .map((count) => (
                        <option key={count} value={count}>
                          {count} {count === 1 ? "human" : "humans"}
                        </option>
                      ))}
                  </select>
                </label>
                <div className="grid grid-cols-2 gap-3">
                  {names.slice(0, playerCount).map((name, index) => index < humanCount ? (
                    <label
                      key={index}
                      className="flex items-center gap-2 rounded-lg border border-line bg-paper/70 px-3"
                    >
                      <span
                        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white"
                        style={{ background: PLAYER_COLORS[index] }}
                      >
                        {index + 1}
                      </span>
                      <span className="sr-only">Player {index + 1} name</span>
                      <input
                        aria-label={`Player ${index + 1} name`}
                        maxLength={20}
                        value={name}
                        onChange={(event) =>
                          setNames((current) =>
                            current.map((value, position) =>
                              position === index ? event.target.value : value,
                            ),
                          )
                        }
                        className="min-h-11 w-full min-w-0 bg-transparent text-sm outline-offset-0"
                      />
                    </label>
                  ) : (
                    <div
                      key={index}
                      className="flex min-h-11 items-center gap-2 rounded-lg border border-line bg-moss/60 px-3 text-sm"
                    >
                      <span
                        className="h-5 w-5 shrink-0 rounded-full"
                        style={{ background: PLAYER_COLORS[index] }}
                      />
                      <span>
                        Computer {index - humanCount + 1}{" "}
                        <span className="text-[10px] text-muted">/ AI</span>
                      </span>
                    </div>
                  ))}
                </div>
                <div className="mt-5 border-t border-line pt-5">
                  <ThemeSelector value={boardThemeId} onChange={setBoardThemeId} />
                </div>
                <button
                  className="button-primary mt-5 w-full justify-between"
                  onClick={() => startGame(preview)}
                >
                  Let&apos;s settle in <Arrow />
                </button>
                <p className="mt-3 text-center text-[10px] leading-5 text-muted">
                  {humanCount === 1
                    ? "Solo play. Your hand stays visible. AI fills the table."
                    : "Pass & play. Reveal hands only between human players."}
                  <br />
                  Keep this tab open; refreshing ends the game.
                </p>
              </section>
              {error && (
                <p className="mt-3 text-sm text-clay" role="alert">
                  {error}
                </p>
              )}
            </section>
            <section
              className="relative -mx-4 flex min-w-0 flex-col items-center sm:mx-0"
              aria-label="Island preview"
            >
              <div className="w-full">
                <Board
                  board={preview}
                  players={[]}
                  robberTileId={
                    preview.tiles.find((tile) => tile.terrain === "desert")?.id
                  }
                  interactive={false}
                  compact
                />
              </div>
              <div className="mt-4 flex items-center gap-4 rounded-full border border-line bg-white/60 py-2 pl-5 pr-2">
                <span className="text-xs text-muted">
                  A new island. Every time.
                </span>
                <button
                  className="flex min-h-9 items-center gap-2 rounded-full bg-moss px-3 text-xs font-semibold"
                  onClick={() => setPreview(createBoard())}
                  aria-label="Shuffle island preview"
                >
                  <span aria-hidden="true">&#8635;</span>Shuffle
                </button>
              </div>
              <p className="mt-4 text-[9px] uppercase tracking-[.22em] text-muted/75">
                19 hexes. A world of possibilities.
              </p>
            </section>
          </div>
          <div className="grid gap-6 border-t border-line py-8 sm:grid-cols-3">
            {[
              {
                title: "Find your footing.",
                text: "A settlement, a road, and a place to begin.",
              },
              {
                title: "A little give and take.",
                text: "The best deals bring everyone to the table.",
              },
              {
                title: "Make your own way.",
                text: "Build, explore, and be the first to ten points.",
              },
            ].map((item, index) => (
              <div className="flex gap-4" key={item.title}>
                <span className="mt-1 font-serif text-xl italic text-clay/70">
                  0{index + 1}
                </span>
                <div>
                  <h3 className="font-serif text-lg">{item.title}</h3>
                  <p className="mt-1 text-xs leading-6 text-muted">
                    {item.text}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </main>
      ) : game.winnerId ? (
        <main className="mx-auto max-w-5xl px-5 py-12 text-center">
          <p className="eyebrow">The island has a new legend</p>
          <h1 className="mt-4 font-serif text-5xl">
            {game.players.find((player) => player.id === game.winnerId)?.name}{" "}
            takes the island.
          </h1>
          <p className="mt-4 text-muted">
            Ten points. Countless good deals. One more game?
          </p>
          <div className="my-10 grid gap-4 text-left sm:grid-cols-2">
            {game.players.map((player) => {
              const score = getScore(game, player.id);
              return (
                <section className="panel p-6" key={player.id}>
                  <div className="flex justify-between">
                    <h2 className="font-serif text-2xl">
                      {player.name}
                      {player.id === game.winnerId ? " / Winner" : ""}
                    </h2>
                    <strong className="font-serif text-3xl">
                      {score.total}
                    </strong>
                  </div>
                  <dl className="mt-5 space-y-2 text-sm text-muted">
                    {[
                      ["Settlements", score.settlements],
                      ["Cities", score.cities],
                      ["Longest Road", score.longestRoad],
                      ["Largest Army", score.largestArmy],
                      ["Revealed victory-point cards", score.hidden],
                    ].map(([label, points]) => (
                      <div className="flex justify-between" key={label}>
                        <dt>{label}</dt>
                        <dd>{points}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              );
            })}
          </div>
          <div className="flex justify-center gap-3">
            <button
              className="button-secondary"
              onClick={() => {
                setGame(null);
                setRollPresentation(null);
                setResourceReceipt(null);
                setViewerId(null);
              }}
            >
              Back to the table
            </button>
            <button className="button-primary" onClick={() => startGame()}>
              Play a rematch <Arrow />
            </button>
          </div>
        </main>
      ) : !viewer && handoffPlayer ? (
        <main className="handoff-table">
          <div className="handoff-island">
            <Board
              board={game.board}
              players={game.players}
              robberTileId={game.robberTileId}
              showBlockedSettlementLocations={showBlockedSettlementLocations}
              interactive={false}
              onChangeTheme={() => setDialog("theme")}
              compact
              fit
            />
          </div>
          <section className="handoff-card panel text-center">
            <span
              className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl text-2xl font-bold text-white"
              style={{ background: handoffPlayer.color }}
            >
              {handoffPlayer.name.charAt(0).toUpperCase()}
            </span>
            <p className="eyebrow mt-7">A moment between friends</p>
            <h1 className="mt-3 font-serif text-4xl">
              Pass the device to {handoffPlayer.name}.
            </h1>
            <p className="mx-auto mt-4 max-w-xs text-sm leading-7 text-muted">
              Everyone else, eyes on the island. Your private hand will appear
              when you&apos;re ready.
            </p>
            <button
              className="button-primary mt-7"
              onClick={() => {
                setViewerId(handoffPlayer.id);
                setHandoffTarget(null);
                setMobileView(
                  [
                    "setup-settlement",
                    "setup-road",
                    "road-building",
                    "robber",
                  ].includes(game.phase.type)
                    ? "board"
                    : "hand",
                );
              }}
            >
              I&apos;m {handoffPlayer.name}. Reveal my hand <Arrow />
            </button>
            <p className="mt-4 text-[10px] text-muted">
              Local pass-and-play / private hands rely on taking turns
            </p>
          </section>
        </main>
      ) : viewer ? (
        <main className="game-table">
          <div className="table-seats grid gap-2" style={{ gridTemplateColumns: `repeat(${game.players.length}, minmax(0, 1fr))` }}>
            {playerCards()}
          </div>
          <nav
            className="table-navigation flex rounded-xl border border-line p-1 lg:hidden"
            aria-label="Game views"
          >
            {(["hand", "board", "players"] as const).map((view) => (
              <button
                key={view}
                aria-pressed={mobileView === view}
                className={`min-h-11 flex-1 rounded-lg text-sm capitalize ${mobileView === view ? "bg-forest text-ink" : "text-muted"}`}
                onClick={() => setMobileView(view)}
              >
                {view}
              </button>
            ))}
          </nav>
          <div className="table-feedback">
            <div className="lg:hidden">
              <RollSummary outcome={rollPresentation?.outcome} stage={rollPresentation?.stage} viewerId={viewer.id} />
            </div>
            <BankSupply resources={game.bank} developmentCards={game.developmentDeck.length} />
          </div>
          <ResourceCollection
            receipt={resourceReceipt?.playerId === viewer.id ? resourceReceipt : null}
            onDismiss={() => setResourceReceipt(null)}
          />
          <div className="table-play-area">
            <section
              className={`table-board min-w-0 ${mobileView !== "board" ? "hidden lg:flex" : "flex"}`}
              aria-label="Game board"
            >
              <div className="board-instruction flex items-start gap-2 lg:hidden">
                <div className="min-w-0 flex-1">
                  <h1 className="font-serif text-lg">{instructionTitle}</h1>
                  <p role={computerPlayer ? "status" : undefined} aria-label={computerPlayer ? "Computer activity" : undefined} className="text-xs leading-4 text-muted">
                    {instructionDescription}
                  </p>
                </div>
                {canCancelKnight && (
                  <button className="button-secondary shrink-0 px-3 text-xs" onClick={() => perform({ type: "cancel-knight" })}>
                    Cancel Knight
                  </button>
                )}
              </div>
              <div className="board-tablemat">
                <Board
                  board={game.board}
                  players={game.players}
                  robberTileId={game.robberTileId}
                  showBlockedSettlementLocations={showBlockedSettlementLocations}
                  producingTileIds={producingTileIds}
                  rolledNumber={rolledNumber}
                  onChangeTheme={() => setDialog("theme")}
                  fit
                  legalVertexIds={legalVertices}
                  legalEdgeIds={legalEdges}
                  legalTileIds={legalTiles}
                  selectedId={selected?.id}
                  confirmation={selectedAction && selected ? {
                    title: selected.kind === "tile"
                      ? "Move the robber here?"
                      : selected.kind === "edge"
                        ? "Build a road here?"
                        : buildMode === "city"
                          ? "Upgrade to a city?"
                          : "Settle here?",
                    onConfirm: () => perform(selectedAction),
                    onCancel: () => setSelected(null),
                  } : undefined}
                  onSelect={(kind, id) => {
                    setSelected({ kind, id });
                    setError("");
                  }}
                />
                {error && mobileView === "board" && (
                  <p
                    role="alert"
                    className="board-error text-sm text-clay lg:hidden"
                  >
                    {error}
                  </p>
                )}
              </div>
            </section>

            <aside
              className={`table-hand min-w-0 ${mobileView !== "hand" ? "hidden lg:flex" : "flex"}`}
              aria-label="Your hand and actions"
            >
              <div className="hand-content" role="region" aria-label="Your cards">
              <section inert={handTaskOpen} className="hand-resources" aria-label="Private resources">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h2 className="eyebrow min-w-0 truncate">{viewer.name}&apos;s hand</h2>
                  <strong className="shrink-0 rounded-md bg-moss px-2 py-1 text-sm text-ink tabular-nums">
                    {resourceTotal(viewer.resources)} cards
                  </strong>
                </div>
                <div className="grid grid-cols-5 gap-1.5 sm:gap-2">
                  {RESOURCES.map((resource) => (
                    <div
                      className="relative"
                      key={resource}
                      title={`${viewer.resources[resource]} ${RESOURCE_NAMES[resource]}`}
                    >
                      <div
                        key={(receivedResources?.[resource] ?? 0) > 0 ? resourceReceipt!.id : "idle"}
                        className={`relative ${(receivedResources?.[resource] ?? 0) > 0 ? "resource-hand-arrival" : ""}`}
                      >
                        <ResourceCard
                          resource={resource}
                          count={viewer.resources[resource]}
                          iconClassName="h-8 w-8"
                          className="hand-resource-card w-full"
                        />
                        {(receivedResources?.[resource] ?? 0) > 0 && (
                          <>
                          <span className="resource-dealt-card" aria-hidden="true">
                            <ResourceCard resource={resource} compact className="h-full w-full" />
                          </span>
                          <span
                            aria-label={`Received ${receivedResources![resource]} ${RESOURCE_NAMES[resource]}`}
                            className="absolute -bottom-2 left-1/2 -translate-x-1/2 rounded-full border-2 border-paper bg-forest px-2 py-0.5 text-xs font-bold text-ink shadow-sm"
                          >
                            +{receivedResources![resource]}
                          </span>
                          </>
                        )}
                      </div>
                      <span className="sr-only">
                        {viewer.resources[resource]}{" "}
                        {RESOURCE_NAMES[resource]}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex items-center justify-between rounded-lg bg-moss/80 px-3 py-1.5">
                  <span className="text-[11px]">Your victory points</span>
                  <span className="text-xs font-semibold">
                    {getScore(game, viewer.id).public} public +{" "}
                    {getScore(game, viewer.id).hidden} hidden ={" "}
                    {getScore(game, viewer.id).total}
                  </span>
                </div>
              </section>

              {game.phase.type === "discard" &&
                (game.phase.required[viewer.id] ?? 0) > 0 && (
                  <section className="hand-task panel p-4">
                    <ResourceInventory resources={viewer.resources} />
                    <ResourceCardStepper
                      label="Return to the bank"
                      values={chosenResources}
                      maximum={viewer.resources}
                      onChange={setChosenResources}
                    />
                    <p className="selection-progress mt-3 flex justify-between gap-2 text-xs text-muted" aria-live="polite">
                      <strong className="text-ink">Selected {resourceTotal(chosenResources)} of {game.phase.required[viewer.id]}</strong>
                      <span>{resourceTotal(viewer.resources) - resourceTotal(chosenResources)} cards left</span>
                    </p>
                    <button
                      className="button-primary mt-3 w-full"
                      disabled={
                        rollBusy ||
                        resourceTotal(chosenResources) !==
                        game.phase.required[viewer.id]
                      }
                      onClick={() =>
                        perform({ type: "discard", resources: chosenResources })
                      }
                    >
                      Confirm discard
                    </button>
                  </section>
                )}
              {game.phase.type === "steal" && isActive && (
                <section className="hand-task panel space-y-2 p-4">
                  <h2 className="eyebrow mb-3">
                    Choose a player to steal from
                  </h2>
                  {game.phase.victimIds.map((playerId) => {
                    const victim = game.players.find(
                      (player) => player.id === playerId,
                    )!;
                    const count = resourceTotal(victim.resources);
                    return (
                      <button
                        key={playerId}
                        className="button-secondary w-full justify-between"
                        onClick={() =>
                          setConfirmation({
                            action: { type: "steal", playerId },
                            title: "Confirm theft",
                            description:
                              count > 0
                                ? `Steal one random resource from ${victim.name}.`
                                : `${victim.name} has no resources. Finish without taking a card.`,
                          })
                        }
                      >
                        <span>{victim.name}</span>
                        <span className="text-xs text-muted">
                          {count} resources
                        </span>
                      </button>
                    );
                  })}
                </section>
              )}
              {game.phase.type === "road-building" &&
                isActive &&
                legalEdges.length === 0 && (
                  <button
                    className="button-secondary mt-4 w-full"
                    onClick={() => perform({ type: "skip-roads" })}
                  >
                    Finish road building
                  </button>
                )}

              <section inert={handTaskOpen} className="hand-building" aria-label="Build a little bigger">
                <h2 className="eyebrow mb-2">Build a little bigger</h2>
                <div className="build-options flex flex-col gap-2">
                  {(["road", "settlement", "city"] as const).map((piece) => {
                    const locations =
                      piece === "road"
                        ? legalRoadEdges(game, viewer.id)
                        : piece === "city"
                          ? legalCityVertices(game, viewer.id)
                          : legalSettlementVertices(game, viewer.id);
                    const explanation = piece === "settlement" ? settlementUnavailable : null;
                    const unavailable = explanation ?? (!normalActions
                      ? "Available after rolling on your turn."
                      : !canAfford(COSTS[piece])
                        ? "You need more resources."
                        : !locations.length
                          ? "No legal position or no pieces remaining."
                          : "Select a location on the board.");
                    return (
                      <Fragment key={piece}>
                        <button
                          title={unavailable}
                          disabled={
                            !normalActions ||
                            !canAfford(COSTS[piece]) ||
                            !locations.length
                          }
                          aria-pressed={buildMode === piece}
                          aria-describedby={explanation ? "settlement-build-explanation" : undefined}
                          className={`flex min-h-14 w-full items-center justify-between gap-2 rounded-xl border px-2.5 text-left text-xs ${buildMode === piece ? "border-forest bg-moss" : "border-line bg-white/40"}`}
                          onClick={() => {
                            setBuildMode(buildMode === piece ? null : piece);
                            setSelected(null);
                            setMobileView("board");
                          }}
                        >
                          <span className="flex min-w-0 items-center gap-2" style={{ color: viewer.color }}>
                            <PieceIcon piece={piece} />
                            <span className="font-semibold text-ink">
                              {piece === "city"
                                ? "Upgrade to city"
                                : `Build ${piece}`}
                            </span>
                          </span>
                          <span className="build-cost shrink-0"><Cost resources={COSTS[piece]} /></span>
                        </button>
                        {explanation && (
                          <p id="settlement-build-explanation" className="-mt-1 rounded-lg bg-moss/60 px-3 py-2 text-xs leading-5 text-ink">
                            {explanation}
                          </p>
                        )}
                      </Fragment>
                    );
                  })}
                  <button
                    className="flex min-h-14 w-full items-center justify-between gap-2 rounded-xl border border-line bg-white/40 px-2.5 text-left text-xs"
                    disabled={
                      !normalActions ||
                      !canAfford(COSTS.development) ||
                      game.developmentDeck.length === 0
                    }
                    onClick={() =>
                      setConfirmation({
                        action: { type: "buy-development" },
                        title: "Invest in a development card",
                        description:
                          "Pay one wool, one grain, and one ore. Your new card stays private. Action cards cannot be played until a later turn.",
                      })
                    }
                  >
                    <span className="flex min-w-0 items-center gap-2" style={{ color: viewer.color }}>
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center">
                        <CardTypeIcon kind="development" />
                      </span>
                      <span className="font-semibold text-ink">Buy a card</span>
                    </span>
                    <span className="build-cost shrink-0"><Cost resources={COSTS.development} /></span>
                  </button>
                </div>
                <p className="sr-only">
                  Building needs resources, an available piece, and a legal
                  connection after your roll.
                </p>
                <button
                  className="button-secondary mt-2 w-full px-2"
                  disabled={!normalActions}
                  onClick={() => {
                    setDialog("trade");
                    setGiveResources(emptyResources());
                    setReceiveResources(emptyResources());
                    setError("");
                  }}
                >
                  Make a trade
                </button>
              </section>
              {viewer.developmentCards.length > 0 && <section
                inert={handTaskOpen}
                className="development-hand"
                aria-label="Your development cards"
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h2 className="text-xs font-medium">Your development cards</h2>
                  <span className="rounded-md bg-moss px-2 py-1 text-xs">
                    {viewer.developmentCards.length}
                  </span>
                </div>
                <ul className="flex flex-col gap-2">
                  {[...new Set(viewer.developmentCards.map(card => card.kind))].map(kind => {
                    const cards = viewer.developmentCards.filter(card => card.kind === kind);
                    const card = cards.find(card => card.purchasedTurn < game.turnNumber) ?? cards[0]!;
                    return (
                      <li key={kind}>
                        <button
                          className="flex min-h-16 w-full items-center gap-3 rounded-xl border border-line bg-white/40 px-3 py-2 text-left hover:bg-moss/60"
                          aria-haspopup="dialog"
                          onClick={() => {
                            setDevelopmentCardId(card.id);
                            setChosenResources(emptyResources());
                            setChosenResource("wood");
                            setDialog("development");
                            setError("");
                          }}
                        >
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-moss text-forest">
                            <DevelopmentCardIcon kind={kind} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center justify-between gap-2">
                              <span className="text-sm font-semibold">{DEVELOPMENT_NAMES[kind]}</span>
                              <span className="shrink-0 rounded-md bg-moss px-2 py-1 text-xs tabular-nums">
                                {cards.length}<span className="sr-only"> {cards.length === 1 ? "card" : "cards"}</span>
                              </span>
                            </span>
                            <span className="mt-1 block text-xs leading-5 text-muted">
                              {DEVELOPMENT_DESCRIPTIONS[kind]}
                            </span>
                          </span>
                          <Arrow className="h-4 w-4 shrink-0 text-muted" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>}

              {game.trade && (
                <section className="hand-task panel p-4" aria-label="Open trade">
                  <ResourceInventory resources={viewer.resources} />
                  <h2 className="font-serif text-xl">{game.trade.give ? "Trade offer" : "Trade request"}</h2>
                  {viewer.id !== game.trade.offeredBy && <p className="mt-1 text-xs text-muted">
                    From {game.players.find(player => player.id === game.trade!.offeredBy)?.name}
                  </p>}
                  <div className="my-3 flex items-center justify-center gap-4 rounded-xl bg-moss/70 p-3">
                    {game.trade.give ? <>
                      <CardStack
                        label="You give"
                        resources={viewer.id === game.trade.offeredBy ? game.trade.give : game.trade.receive}
                      />
                      <Arrow className="h-5 w-5 shrink-0 text-forest" />
                      <CardStack
                        label="You receive"
                        resources={viewer.id === game.trade.offeredBy ? game.trade.receive : game.trade.give}
                      />
                    </> : <CardStack
                      label={viewer.id === game.trade.offeredBy ? "You receive" : "You give"}
                      resources={game.trade.receive}
                    />}
                  </div>
                  {viewer.id === game.trade.offeredBy ? (
                    <div className="space-y-2">
                      {game.players
                        .filter((player) => player.id !== viewer.id)
                        .map((player) => {
                          const response =
                            game.trade!.responses[player.id];
                          const status =
                            response ? game.trade!.give ? "accepted" : null
                              : response === false ? "declined" : "not answered";
                          const missingCards = response ? RESOURCES
                            .filter(resource => response[resource] > viewer.resources[resource])
                            .map(resource => `${response[resource] - viewer.resources[resource]} ${RESOURCE_NAMES[resource]}`)
                            .join(", ") : "";
                          return (
                            <div
                              key={player.id}
                              role="group"
                              aria-label={`${player.name}'s trade response`}
                              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-white/40 px-3 py-2"
                            >
                              <span className="flex min-w-0 items-center gap-2">
                                <span
                                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                                  style={{ background: player.color }}
                                />
                                <span className="truncate text-xs font-semibold">
                                  {player.name}
                                </span>
                              </span>
                              {status && <span
                                className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${response ? "bg-forest text-ink" : response === false ? "bg-ink/10 text-muted" : "border border-line text-muted"}`}
                              >
                                {status}
                              </span>}
                              {response ? (
                                <div className="flex w-full flex-wrap items-center justify-between gap-3 pt-1">
                                  {!game.trade!.give && <CardStack label="You give" resources={response} />}
                                  <div className="ml-auto flex min-w-0 max-w-full flex-col items-end gap-1.5">
                                    <button
                                      className="button-primary !min-h-11 !px-3 !text-xs"
                                      disabled={!canAfford(response)}
                                      aria-describedby={missingCards ? `trade-missing-${player.id}` : undefined}
                                      onClick={() =>
                                        setConfirmation({
                                          action: {
                                            type: "complete-trade",
                                            playerId: player.id,
                                          },
                                          title: `Trade with ${player.name}`,
                                          exchange: { give: response, receive: game.trade!.receive },
                                        })
                                      }
                                    >
                                      Complete trade
                                    </button>
                                    {missingCards && <p id={`trade-missing-${player.id}`} className="text-right text-xs text-clay">
                                      Missing {missingCards}
                                    </p>}
                                  </div>
                                </div>
                              ) : player.control === "human" ? (
                                <button
                                  className="min-h-11 text-xs font-semibold underline"
                                  onClick={() => passTo(player.id)}
                                >
                                  Pass to {player.name}
                                </button>
                              ) : null}
                            </div>
                          );
                        })}
                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                        <button
                          className="button-secondary !min-h-11 !px-3 !text-xs"
                          aria-haspopup="dialog"
                          onClick={() => {
                            setTradeMode("players");
                            setPlayerTradeMode("offer");
                            setGiveResources(game.trade!.give ?? emptyResources());
                            setReceiveResources(game.trade!.receive);
                            setDialog("trade");
                            setError("");
                          }}
                        >
                          Change offer
                        </button>
                        <button
                          className="min-h-11 text-xs text-clay underline"
                          onClick={() => perform({ type: "cancel-trade" })}
                        >
                          {game.trade.give ? "Withdraw offer" : "Withdraw request"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                    {!game.trade.give && (
                      <div className="mb-4 space-y-3">
                        <ResourceCardStepper label="You want in return" values={chosenResources} onChange={setChosenResources} />
                        <p className="text-xs leading-5 text-muted">
                          Choose different cards in return.
                        </p>
                        {!canAfford(game.trade.receive) && (
                          <p className="text-xs text-clay">You do not have all the requested cards to offer this trade.</p>
                        )}
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        className="button-secondary"
                        onClick={() =>
                          perform({ type: "respond-trade", accept: false })
                        }
                      >
                        Decline
                      </button>
                      <button
                        className="button-primary"
                        disabled={
                          !RESOURCES.every(
                            (resource) =>
                              viewer.resources[resource] >=
                              game.trade!.receive[resource],
                          ) || (!game.trade.give && (
                            !resourceTotal(chosenResources) || RESOURCES.some(resource =>
                              chosenResources[resource] > 0 && game.trade!.receive[resource] > 0)
                          ))
                        }
                        onClick={() =>
                          perform(game.trade!.give
                            ? { type: "respond-trade", accept: true }
                            : { type: "propose-trade", price: chosenResources })
                        }
                      >
                        {game.trade.give ? "Accept offer" : "Propose price"}
                      </button>
                    </div>
                    </>
                  )}
                  {needsHandoff && controllingPlayer?.control === "human" && viewer.id !== controllingPlayer.id && (
                    <button className="button-secondary mt-4 w-full" onClick={() => passTo(controllingPlayer.id)}>
                      Return to {controllingPlayer.name}
                    </button>
                  )}
                </section>
              )}
              {!game.trade && needsHandoff && controllingPlayer?.control === "human" && viewer.id !== controllingPlayer.id && (
                <button
                  className="button-secondary mt-4 w-full"
                  onClick={() => passTo(controllingPlayer.id)}
                >
                  Return to {controllingPlayer.name}
                </button>
              )}
              {error && !dialog && !confirmation && (
                <p
                  role="alert"
                  className="mt-4 rounded-xl border border-clay/30 bg-clay/5 p-3 text-sm text-clay"
                >
                  {error}
                </p>
              )}
              </div>
              <div className="hand-dice" role="region" aria-label="Turn controls">
                <div className="turn-header">
                  <h2 className="turn-owner">
                    <span className="truncate" title={activePlayer?.name}>{activePlayer?.name}</span>
                    <span className="shrink-0 text-xs font-medium text-muted"> - {isActive ? "Your turn" : "Their turn"}</span>
                  </h2>
                  <span className="turn-number">
                    {game.phase.type.startsWith("setup") ? "Setup" : `Turn ${game.turnNumber}`}
                  </span>
                </div>
                <div className="hidden lg:block">
                  <RollSummary outcome={rollPresentation?.outcome} stage={rollPresentation?.stage} viewerId={viewer.id} />
                </div>
                <div className="turn-card rounded-2xl bg-forest text-ink">
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <h1 className="turn-title font-serif text-xl leading-tight">
                        {instructionTitle}
                      </h1>
                      <p role={computerPlayer ? "status" : undefined} aria-label={computerPlayer ? "Computer activity" : undefined} className="turn-description text-xs leading-4 text-ink/70">
                        {computerPlayer && !rollBusy ? `${computerPlayer.name} ${game.trade ? "is considering the trade." : game.phase.type === "discard" ? "is discarding resources." : "is playing automatically."}` : instructionDescription}
                      </p>
                    </div>
                    {canCancelKnight && (
                      <button className="button-secondary shrink-0 px-3 text-xs" onClick={() => perform({ type: "cancel-knight" })}>
                        Cancel Knight
                      </button>
                    )}
                  </div>
                </div>
                <div className="turn-action">
                  <button
                    className="button-primary h-11 min-w-0 px-2 py-0"
                    onClick={() => perform({ type: "roll" })}
                    disabled={game.phase.type !== "roll" || !isActive || rollBusy || handTaskOpen}
                  >
                    Roll the dice
                  </button>
                  <button
                    className="button-secondary h-11 min-w-0 px-2 py-0 text-xs leading-4"
                    onClick={() => perform({ type: "end-turn" })}
                    disabled={!normalActions || handTaskOpen}
                  >
                    {needsHandoff ? "End turn & pass device" : "End turn"}
                  </button>
                </div>
              </div>
            </aside>
            <section
              aria-label="Players and awards"
              className={`table-players space-y-3 lg:hidden ${mobileView !== "players" ? "hidden" : ""}`}
            >
              {playerCards(true)}
            </section>
          </div>
        </main>
      ) : (
        <main className="computer-table">
          <h1 className="font-serif text-3xl">The island is in motion.</h1>
          <p role="status" aria-label="Computer activity" className="my-5 text-sm text-muted">
            {computerPlayer?.name} is playing automatically. The next human hand will stay hidden until revealed.
          </p>
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">{playerCards()}</div>
          <div className="table-feedback">
            <RollSummary outcome={rollPresentation?.outcome} stage={rollPresentation?.stage} />
            <BankSupply resources={game.bank} developmentCards={game.developmentDeck.length} />
          </div>
          <Board board={game.board} players={game.players} robberTileId={game.robberTileId} showBlockedSettlementLocations={showBlockedSettlementLocations} producingTileIds={producingTileIds} rolledNumber={rolledNumber} onChangeTheme={() => setDialog("theme")} interactive={false} compact fit />
          {error && <p role="alert" className="mt-4 text-sm text-clay">{error}</p>}
        </main>
      )}

      <footer className={`${game && !game.winnerId ? "hidden" : "flex"} mx-auto max-w-[1440px] flex-wrap justify-between gap-3 px-5 py-6 text-[9px] uppercase tracking-[.14em] text-muted sm:px-9 lg:px-12`}>
        <span>A tabletop state of mind.</span>
        <span>Catania / Solo &amp; pass-and-play / Wi-Fi play coming later</span>
      </footer>

      {dialog === "theme" && (
        <Dialog title="Choose your theme" onClose={() => setDialog(null)} wide>
          <ThemeSelector value={boardThemeId} onChange={setBoardThemeId} />
          <p className="mt-5 text-xs leading-5 text-muted">
            Changes apply immediately to the board and resource artwork. Resource names and rules stay the same.
            Your choice is saved in this browser when storage is available; games are not saved.
          </p>
        </Dialog>
      )}

      {dialog === "settings" && (
        <Dialog title="Settings" onClose={() => setDialog(null)}>
          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-semibold">
            <input
              type="checkbox"
              checked={showBlockedSettlementLocations}
              onChange={(event) => setShowBlockedSettlementLocations(event.currentTarget.checked)}
              aria-describedby="blocked-settlement-locations-description"
              className="size-5 shrink-0 accent-forest"
            />
            Show blocked settlement locations
          </label>
          <p id="blocked-settlement-locations-description" className="mt-3 text-sm leading-6 text-muted">
            Crosses mark empty corners next to any settlement or city, where the distance rule prevents building.
            Unmarked corners still require the usual roads, resources, and available pieces on your turn.
          </p>
          <p className="mt-4 text-xs text-muted">Saved in this browser when storage is available. Games are not saved.</p>
        </Dialog>
      )}

      {dialog === "help" && (
        <Dialog title="Help" onClose={() => setDialog(null)} wide>
          <div className="space-y-8 text-sm leading-7 text-muted">
            <p className="font-serif text-xl text-ink">
              Good neighbors. Clever trades. Ten victory points.
            </p>
            <section aria-labelledby="help-how-to-play">
              <h3 id="help-how-to-play" className="mb-4 font-serif text-2xl text-ink">How to play</h3>
              <ol className="list-decimal space-y-3 pl-5">
                <li>
                  <strong className="text-ink">Settle the island.</strong> Choose three or four players,
                  with computers filling any non-human seats. Turn order is randomized. Each player
                  places a free settlement and adjoining road in order, then again in reverse.
                  Your second settlement grants one resource from each neighboring non-desert hex.
                </li>
                <li>
                  <strong className="text-ink">Roll and gather.</strong> Roll two dice once on your turn.
                  All players collect from matching hexes. Resolve any discards, robber moves, and
                  theft before continuing. An eligible development card can be played before or after rolling.
                </li>
                <li>
                  <strong className="text-ink">Trade, build, and pass.</strong> After rolling, trade,
                  build, and buy cards in any order while you have the resources. Select a highlighted
                  location on the board, then confirm the placement; Cancel or Escape clears the preview.
                  Finish required choices before ending your turn. Reach 10 points on your own turn to win.
                </li>
              </ol>
            </section>

            <section aria-labelledby="help-builds">
              <h3 id="help-builds" className="mb-4 font-serif text-2xl text-ink">Builds and costs</h3>
              <p className="mb-4">Pay these resources to the bank after rolling. You need a legal location and an available piece to build.</p>
              <ul aria-label="Available builds and purchases" className="grid gap-3 sm:grid-cols-2">
                {([
                  { piece: "road", name: "Road", description: "Connect an empty edge to your own road, settlement, or city. You cannot extend through an opponent's building. Roads earn no points by themselves. Limit: 15 roads." },
                  { piece: "settlement", name: "Settlement", description: "Build on an empty intersection beside your road, at least two edges from every settlement or city. Worth 1 point; produces 1 resource per matching neighboring hex. Limit: 5 settlements." },
                  { piece: "city", name: "City", description: "Upgrade one of your settlements, returning its piece to your supply. Worth 2 points total; produces 2 resources per matching neighboring hex. Limit: 4 cities." },
                  { piece: "development", name: "Development card", description: "Draw a hidden card from the shuffled deck. There are 25 cards; purchases stop when the deck is empty. Cards cannot be traded." },
                ] as const).map(({ piece, name, description }) => (
                  <li key={piece} className="min-w-0 rounded-xl border border-line bg-white/30 p-4">
                    <div className="mb-3 flex items-center gap-3 text-forest">
                      {piece === "development" ? <CardTypeIcon kind="development" /> : <PieceIcon piece={piece} />}
                      <h4 className="font-semibold text-ink">{name}</h4>
                    </div>
                    <Cost resources={COSTS[piece]} />
                    <p className="mt-3 text-xs leading-6">{description}</p>
                  </li>
                ))}
              </ul>
            </section>

            <section aria-labelledby="help-development-cards">
              <h3 id="help-development-cards" className="mb-4 font-serif text-2xl text-ink">Development cards</h3>
              <p className="mb-4">
                All five card types are shown here, whether or not you own them. Counts show the starting
                deck, not the cards remaining. Play at most one action
                development card per turn, never on the turn you bought it. Finish mandatory choices
                before playing a card. Victory-point cards count automatically and do not use this allowance.
              </p>
              <ul aria-label="All development cards" className="space-y-3">
                {([
                  ["knight", 14], ["victory-point", 5], ["road-building", 2],
                  ["year-of-plenty", 2], ["monopoly", 2],
                ] as const).map(([kind, count]) => (
                  <li key={kind} className="flex gap-3 rounded-xl border border-line bg-white/30 p-4">
                    <span className="text-forest"><DevelopmentCardIcon kind={kind} /></span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                        <h4 className="font-semibold text-ink">{DEVELOPMENT_NAMES[kind]}</h4>
                        <span className="rounded-md bg-moss px-2 py-0.5 text-xs font-semibold text-ink">{count} in starting deck</span>
                      </div>
                      <p className="mt-1 text-xs leading-6">{DEVELOPMENT_DESCRIPTIONS[kind]}</p>
                    </div>
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-xs leading-6">
                Knight does not trigger discards. You may cancel it before confirming the
                robber move, unless it has already won the game. Road building needs a remaining road
                piece and stops early if no legal placements remain. Year of plenty can take two of the
                same resource, but cannot be played with an empty bank. Played action cards leave your hand.
              </p>
            </section>

            <section aria-labelledby="help-rules" className="space-y-4">
              <h3 id="help-rules" className="font-serif text-2xl text-ink">Game rules</h3>
              <p>
                <strong className="text-ink">Resources and production.</strong> Forests produce wood,
                hills brick, pastures wool, fields grain, and mountains ore. The desert produces nothing.
                On a matching dice total, each adjacent settlement receives one resource and each city two,
                unless the robber blocks that hex. The bank starts with 19 of each resource. If it cannot
                satisfy all claims for a resource and multiple players need it, nobody receives that resource
                this roll. If only one player needs it, they take what remains. Other resources still produce normally.
              </p>
              <p>
                <strong className="text-ink">Seven and the robber.</strong> A seven produces no resources.
                Every player with more than seven resource cards chooses half, rounded down, to return
                to the bank; development cards do not count. After all discards, the active player moves
                the robber to a different hex, including the desert, and chooses one opponent with an
                adjacent settlement or city to steal one random resource from. An empty hand gives nothing;
                if no opponent is adjacent, skip theft. The robber stays and blocks production until moved again.
              </p>
              <p>
                <strong className="text-ink">Trading and ports.</strong> After rolling, the active player
                can exchange four of one resource for one different resource available in the bank (4:1).
                Their settlement or city on a generic port improves this to 3:1; a matching resource port
                allows 2:1 for that resource. Player trades must involve the active player. Request cards
                and compare prices, or make an exact offer. Both sides must give resources, with no resource
                appearing on both sides. No gifts or development-card trades. Nothing moves until the active
                player confirms one exchange and both players still have the cards.
              </p>
              <p>
                <strong className="text-ink">Points and victory.</strong> Each settlement is 1 point,
                each city 2, and each hidden victory-point card 1. Longest Road and Largest Army are
                worth 2 points each. Reach at least 10 on your own turn to win, including cards bought
                that turn. Opponents see only your public score until the game ends.
              </p>
              <p>
                <strong className="text-ink">Longest Road and Largest Army.</strong> Longest Road needs
                at least five roads in one continuous trail, not your total network. Count each road once;
                loops can count, branches do not all add together, and an opponent's building interrupts
                the trail. Largest Army needs at least three played Knights. For either award, the highest
                qualifying player holds it. A tie stays with the current holder if they are among the leaders;
                otherwise a tie leaves it unclaimed. Surpassing the holder transfers the award and its points.
              </p>
              <div className="rounded-xl bg-moss p-4">
                <strong className="text-ink">One device, a whole table.</strong> Play solo against local
                AI with your hand always visible, or pass the device before revealing each human's hand.
                Computer hands cannot be opened. AI handles its own turns and trade responses, including
                prices for requests; it uses bank and port trades but does not initiate player trades.
                This is a friendly local game, not a secure multiplayer room. Games live only in this tab:
                refreshing or closing it ends the game.
              </div>
            </section>

          </div>
        </Dialog>
      )}
      {dialog === "players" && game && needsHandoff && (
        <Dialog title="Pass the device" onClose={() => setDialog(null)}>
          <p className="mb-5 text-sm leading-6 text-muted">
            Choose whose hand to open. The next screen hides all private cards
            until that player is ready.
          </p>
          <div className="space-y-3">
            {humanPlayers.map((player) => (
              <button
                className="button-secondary w-full justify-between"
                key={player.id}
                onClick={() => passTo(player.id)}
              >
                <span className="flex items-center gap-3">
                  <span
                    className="h-3 w-3 rounded-full"
                    style={{ background: player.color }}
                  />
                  {player.name}
                </span>
                <Arrow />
              </button>
            ))}
          </div>
        </Dialog>
      )}
      {dialog === "restart" && (
        <Dialog title="Leave this island?" onClose={() => setDialog(null)}>
          <p className="text-sm leading-7 text-muted">
            This ends the current game for everyone. Hands, settlements, and
            progress are not saved.
          </p>
          <div className="mt-6 flex justify-end gap-3">
            <button
              className="button-secondary"
              onClick={() => setDialog(null)}
            >
              Keep playing
            </button>
            <button
              className="button-primary"
              onClick={() => {
                setGame(null);
                setRollPresentation(null);
                setResourceReceipt(null);
                setViewerId(null);
                setHandoffTarget(null);
                setDialog(null);
                setError("");
              }}
            >
              End game
            </button>
          </div>
        </Dialog>
      )}
      {confirmation && (
        <Dialog
          title={confirmation.title}
          summary={viewer && confirmation.action.type !== "steal" ? <ResourceInventory resources={viewer.resources} /> : undefined}
          onClose={() => {
            setConfirmation(null);
            setError("");
          }}
        >
          {confirmation.exchange ? <div className="flex items-center justify-center gap-4 rounded-xl bg-moss p-4">
            <CardStack label="You give" resources={confirmation.exchange.give} />
            <Arrow className="h-5 w-5 shrink-0 text-forest" />
            <CardStack label="You receive" resources={confirmation.exchange.receive} />
          </div> : <p className="text-sm leading-7 text-muted">
            {confirmation.description}
          </p>}
          {error && (
            <p role="alert" className="mt-3 text-sm text-clay">
              {error}
            </p>
          )}
          <div className="mt-6 flex justify-end gap-3">
            <button
              className="button-secondary"
              onClick={() => {
                setConfirmation(null);
                setError("");
              }}
            >
              Cancel
            </button>
            <button
              className="button-primary"
              onClick={() => perform(confirmation.action)}
            >
              Confirm
            </button>
          </div>
        </Dialog>
      )}
      {dialog === "trade" && game && viewer && (
        <Dialog
          title="A fair exchange"
          summary={tradeMode === "players" ? <ResourceInventory resources={viewer.resources} /> : undefined}
          onClose={() => {
            setDialog(null);
            setError("");
          }}
        >
          <div className="mb-6 flex rounded-xl bg-moss p-1">
            {(["bank", "players"] as const).map((mode) => (
              <button
                key={mode}
                aria-pressed={tradeMode === mode}
                className={`min-h-10 flex-1 rounded-lg text-sm ${tradeMode === mode ? "bg-white shadow-sm" : "text-muted"}`}
                onClick={() => setTradeMode(mode)}
              >
                {mode === "bank" ? "Bank & ports" : "Player trade"}
              </button>
            ))}
          </div>
          {tradeMode === "bank" ? (
            <>
              <p className="mb-5 text-sm leading-6 text-muted">
                Your best bank or port rate is shown on each card.
              </p>
              <fieldset className="mb-5">
                <legend className="mb-3 text-sm font-semibold">
                  You give
                </legend>
                <div className="grid grid-cols-5 gap-2 sm:gap-3">
                  {RESOURCES.map((resource) => (
                    <SelectableResourceCard
                      key={resource}
                      resource={resource}
                      action="Give"
                      count={viewer.resources[resource]}
                      countLabel="In hand"
                      caption={`${getTradeRatio(game, viewer.id, resource)}:1`}
                      selected={giveResource === resource}
                      disabled={
                        viewer.resources[resource] <
                        getTradeRatio(game, viewer.id, resource)
                      }
                      onClick={() => setGiveResource(resource)}
                    />
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend className="mb-3 text-sm font-semibold">
                  Take 1 from the bank
                </legend>
                <div className="grid grid-cols-5 gap-2 sm:gap-3">
                  {RESOURCES.map((resource) => (
                    <SelectableResourceCard
                      key={resource}
                      resource={resource}
                      action="Receive"
                      count={game.bank[resource]}
                      countLabel="In bank"
                      caption=""
                      selected={receiveResource === resource}
                      disabled={game.bank[resource] < 1}
                      onClick={() => setReceiveResource(resource)}
                    />
                  ))}
                </div>
              </fieldset>
              <div
                className="my-5 flex items-center justify-center gap-2 rounded-xl bg-moss p-4"
                aria-hidden="true"
              >
                {Array.from({ length: ratio }, (_, index) => (
                  <ResourceCard
                    key={index}
                    resource={giveResource}
                    compact
                    iconClassName="h-5 w-5"
                    className="h-13 w-9"
                  />
                ))}
                <Arrow className="h-5 w-5 shrink-0 text-forest" />
                <ResourceCard
                  resource={receiveResource}
                  compact
                  iconClassName="h-5 w-5"
                  className="h-13 w-9"
                />
              </div>
              {canExchange && (
                <p role="status" aria-label="Hand after exchange" className="mb-4 text-xs leading-5 text-ink">
                  After exchange: {viewer.resources[giveResource] - ratio} {RESOURCE_NAMES[giveResource]}, {viewer.resources[receiveResource] + 1} {RESOURCE_NAMES[receiveResource]} in your hand. Other cards stay the same.
                </p>
              )}
              <button
                className="button-primary w-full"
                disabled={!canExchange}
                onClick={() =>
                  perform({
                    type: "bank-trade",
                    give: giveResource,
                    receive: receiveResource,
                  })
                }
              >
                Confirm exchange
              </button>
              <p className="mt-3 text-xs text-muted">
                Choose different resources and enough cards to make the
                exchange.
              </p>
            </>
          ) : (
            <>
              <div role="group" aria-label="Player trade type" className="mb-5 flex rounded-xl bg-moss p-1">
                {(["request", "offer"] as const).map(mode => (
                  <button
                    key={mode}
                    aria-pressed={playerTradeMode === mode}
                    className={`min-h-10 flex-1 rounded-lg text-sm ${playerTradeMode === mode ? "bg-white shadow-sm" : "text-muted"}`}
                    onClick={() => setPlayerTradeMode(mode)}
                  >
                    {mode === "request" ? "Request cards" : "Exact offer"}
                  </button>
                ))}
              </div>
              <div className="space-y-5">
                {playerTradeMode === "offer" && <>
                <ResourceCardStepper
                  label="You offer"
                  values={giveResources}
                  maximum={viewer.resources}
                  onChange={setGiveResources}
                />
                <div
                  className="flex items-center justify-center gap-4 rounded-xl bg-moss p-4"
                  aria-hidden="true"
                >
                  <CardStack
                    resources={giveResources}
                    emptyText="Nothing offered"
                  />
                  <Arrow className="h-5 w-5 shrink-0 text-forest" />
                  <CardStack
                    resources={receiveResources}
                    emptyText="Nothing asked"
                  />
                </div>
                </>}
                <ResourceCardStepper
                  label="You ask for"
                  values={receiveResources}
                  onChange={setReceiveResources}
                />
              </div>
              <p className="my-4 text-xs leading-6 text-muted">
                {playerTradeMode === "request"
                  ? "Players name a price. You choose whether to trade."
                  : "No cards move until you confirm a trade."}
              </p>
              <button
                className="button-primary w-full"
                disabled={
                  !resourceTotal(receiveResources) ||
                  (playerTradeMode === "offer" && (!resourceTotal(giveResources) || RESOURCES.some(
                    (resource) =>
                      giveResources[resource] > 0 &&
                      receiveResources[resource] > 0,
                  )))
                }
                onClick={() =>
                  perform(playerTradeMode === "request" ? {
                    type: "request-trade",
                    receive: receiveResources,
                  } : {
                    type: "offer-trade",
                    give: giveResources,
                    receive: receiveResources,
                  })
                }
              >
                {playerTradeMode === "request" ? "Ask for these cards" : "Put the offer on the table"}
              </button>
            </>
          )}
          {error && (
            <p role="alert" className="mt-4 text-sm text-clay">
              {error}
            </p>
          )}
        </Dialog>
      )}
      {dialog === "development" && game && viewer && (
        <Dialog
          title="A card up your sleeve"
          summary={developmentCard?.kind === "year-of-plenty" || developmentCard?.kind === "monopoly" ? <ResourceInventory resources={viewer.resources} /> : undefined}
          onClose={() => {
            setDialog(null);
            setError("");
          }}
        >
          <div className="space-y-3">
            {viewer.developmentCards.map((card) => (
              <button
                key={card.id}
                className={`w-full rounded-xl border p-4 text-left ${developmentCardId === card.id ? "border-forest bg-moss" : "border-line"}`}
                aria-pressed={developmentCardId === card.id}
                onClick={() => {
                  setDevelopmentCardId(card.id);
                  setChosenResources(emptyResources());
                  setError("");
                }}
              >
                <span className="flex justify-between gap-3">
                  <span className="flex items-center gap-2 font-serif text-xl">
                    <span className="text-forest"><DevelopmentCardIcon kind={card.kind} /></span>
                    {DEVELOPMENT_NAMES[card.kind]}
                  </span>
                  {card.kind === "victory-point" && (
                    <span className="text-[10px] text-muted">+1 hidden point</span>
                  )}
                </span>
                <span className="mt-2 block text-xs leading-6 text-muted">
                  {DEVELOPMENT_DESCRIPTIONS[card.kind]}
                </span>
              </button>
            ))}
          </div>
          {developmentCard && developmentCard.kind !== "victory-point" && (
            <div className="mt-5 border-t border-line pt-5">
              {developmentCard.kind === "year-of-plenty" && (
                <>
                  <ResourceCardStepper
                    label="Take from the bank"
                    values={chosenResources}
                    maximum={game.bank}
                    maximumLabel="In bank"
                    onChange={setChosenResources}
                  />
                  <p className="mt-3 text-xs text-muted">
                    Selected {resourceTotal(chosenResources)} of {Math.min(2, resourceTotal(game.bank))}
                  </p>
                </>
              )}
              {developmentCard.kind === "monopoly" && (
                <label className="text-sm">
                  Claim every card of this resource
                  <select
                    className="field mt-2"
                    value={chosenResource}
                    onChange={(event) =>
                      setChosenResource(event.target.value as Resource)
                    }
                  >
                    {RESOURCES.map((resource) => (
                      <option value={resource} key={resource}>
                        {RESOURCE_NAMES[resource]}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <button
                className="button-primary mt-4 w-full"
                disabled={
                  !isActive || rollBusy ||
                  !["roll", "actions"].includes(game.phase.type) ||
                  game.developmentPlayed ||
                  developmentCard.purchasedTurn === game.turnNumber ||
                  (developmentCard.kind === "year-of-plenty" &&
                    resourceTotal(chosenResources) !==
                      Math.min(2, resourceTotal(game.bank)))
                }
                onClick={() =>
                  perform({
                    type: "play-development",
                    cardId: developmentCard.id,
                    resource: chosenResource,
                    resources: chosenResources,
                  })
                }
              >
                Confirm {DEVELOPMENT_NAMES[developmentCard.kind]}
              </button>
              <p className="mt-3 text-xs leading-6 text-muted">
                One action card per turn, before or after rolling. Newly bought
                action cards must wait until a later turn.
              </p>
            </div>
          )}
          {error && (
            <p role="alert" className="mt-4 text-sm text-clay">
              {error}
            </p>
          )}
        </Dialog>
      )}
    </div>
    </BoardThemeContext>
  );
}

export default App;
