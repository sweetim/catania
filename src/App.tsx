import { Fragment, useEffect, useEffectEvent, useRef, useState } from "react";
import { match } from "ts-pattern";
import { Board } from "./components/Board";
import { RollSummary, type RollStage } from "./components/RollSummary";
import { ResourceCollection, type ResourceReceipt } from "./components/ResourceCollection";
import { TheftNotice } from "./components/TheftNotice";
import { ThemeSelector } from "./components/ThemeSelector";
import { TerrainArtwork } from "./components/ThemeArtwork";
import { TradeDialog } from "./components/TradeDialog";
import { OpenTrade } from "./components/OpenTrade";
import { PlayerSeat } from "./components/PlayerSeat";
import { DevelopmentHand } from "./components/DevelopmentHand";
import { getPhaseInstructions, TurnInstructions } from "./components/TurnInstructions";
import {
  ActionConfirmation,
  DevelopmentDialog,
  DiscardSelection,
  TheftChoices,
  DEVELOPMENT_NAMES,
  DEVELOPMENT_DESCRIPTIONS,
} from "./components/GameplayDialogs";
import { BOARD_THEMES, BoardThemeContext, type BoardThemeId } from "./themes";
import {
  Arrow,
  BankSupply,
  BuildButton,
  CardTypeIcon,
  Cost,
  DevelopmentCardIcon,
  Dialog,
  Logo,
  PieceIcon,
  RESOURCE_NAMES,
  ResourceCard,
  ResourceInventory,
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
  legalCityVertices,
  legalRoadEdges,
  legalSettlementVertices,
  RESOURCES,
  resourceTotal,
} from "./game/engine";
import type {
  GameAction,
  GameState,
  Player,
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

function phaseTitle(state: GameState) {
  return getPhaseInstructions({
    phase: state.phase,
    secondSettlement: state.setupIndex >= state.players.length,
  }).title;
}

function phaseDescription(state: GameState) {
  return getPhaseInstructions({
    phase: state.phase,
    secondSettlement: state.setupIndex >= state.players.length,
  }).description;
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
  const [homeView, setHomeView] = useState<"setup" | "island">("setup");
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
  const [chosenResources, setChosenResources] = useState(emptyResources);
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
      setHomeView("setup");
      setError("");
      setSelected(null);
      setBuildMode(null);
    } catch (failure) {
      setHomeView("setup");
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
      const theft = next.thefts.at(-1);
      if (theft && theft.id !== game.thefts.at(-1)?.id && (theft.thiefId === viewerId || theft.victimId === viewerId)) {
        setResourceReceipt(null);
      } else if (resourceTotal(gains) > 0) {
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

  function playerCards(detailed = false) {
    if (!game) return null;
    const scores = game.players.map(player => getScore(game, player.id));
    const highestPublicScore = Math.max(...scores.map(score => score.public));
    const showPublicScoreLeaders = scores.some(score => score.public < highestPublicScore);
    return game.players.map((player, index) => {
      const score = scores[index]!;
      return <PlayerSeat key={player.id} number={index + 1} detailed={detailed}
        player={{ ...player, resourceCount: resourceTotal(player.resources), developmentCount: player.developmentCards.length, longestRoad: getLongestRoadLength(game, player.id), score: game.winnerId ? score.total : score.public }}
        active={game.activePlayerId === player.id} leading={showPublicScoreLeaders && score.public === highestPublicScore}
        largestArmy={game.awards.largestArmy === player.id} longestRoadAward={game.awards.longestRoad === player.id} />;
    });
  }

  return (
    <BoardThemeContext value={boardTheme}>
    <div data-theme={boardThemeId} className={!game ? "home-shell" : !game.winnerId ? "game-shell" : "min-h-dvh"}>
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
        <main className="home-main" data-view={homeView}>
          <div className="home-introduction">
            <p className="eyebrow mb-3 flex items-center gap-3">
              <span className="h-px w-8 bg-clay" />
              Your next gathering starts here
            </p>
            <h1 className="font-serif leading-[1.05] tracking-[-.045em]">
              A little island.
              <br />
              Endless <span className="italic text-ink">possibility.</span>
            </h1>
            <p className="home-description mt-3 max-w-sm text-sm leading-6 text-muted">
              Settle new shores, strike a good deal, and make room for a little friendly competition.
            </p>
          </div>
          <nav className="home-navigation" aria-label="Home views">
            {(["setup", "island"] as const).map(view => (
              <button
                key={view}
                aria-pressed={homeView === view}
                aria-controls={`home-${view}`}
                onClick={() => setHomeView(view)}
              >
                {view === "setup" ? "Setup" : "Island"}
              </button>
            ))}
          </nav>
          <section
            id="home-setup"
            className="home-setup panel"
            aria-label="Set up your table"
          >
            <div className="home-setup-content">
              <div>
                <p className="eyebrow">On this device</p>
                <h2 className="home-setup-heading mt-1 font-serif text-2xl">
                  Make room at the table.
                </h2>
              </div>
              <div className="home-table-options">
                <div>
                  <p className="mb-1.5 text-[11px] font-semibold text-muted">Table size</p>
                  <div className="flex rounded-xl bg-moss p-1" role="group" aria-label="Number of players">
                    {[3, 4].map((count) => (
                      <button
                        key={count}
                        onClick={() => {
                          setPlayerCount(count);
                          setHumanCount((current) => Math.min(current, count));
                        }}
                        aria-pressed={playerCount === count}
                        className={`min-h-11 flex-1 rounded-lg px-2 text-xs font-semibold ${playerCount === count ? "bg-white shadow-sm" : "text-muted"}`}
                      >
                        {count} players
                      </button>
                    ))}
                  </div>
                </div>
                <label className="min-w-0 text-[11px] font-semibold text-muted">
                  <span className="mb-1.5 block">Human players</span>
                  <select
                    className="field !min-h-[52px] text-ink"
                    value={humanCount}
                    onChange={(event) => setHumanCount(Number(event.target.value))}
                  >
                    {Array.from({ length: playerCount }, (_, index) => index + 1)
                      .map((count) => (
                        <option key={count} value={count}>
                          {count} {count === 1 ? "human" : "humans"}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
              <div className="grid grid-cols-2 gap-2">
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
                    <span className="min-w-0">
                      Computer {index - humanCount + 1}{" "}
                      <span className="text-[10px] text-muted">/ AI</span>
                    </span>
                  </div>
                ))}
              </div>
              <button
                className="home-theme"
                aria-label="Change theme"
                aria-haspopup="dialog"
                onClick={() => setDialog("theme")}
              >
                <svg className="home-theme-preview" data-theme={boardThemeId} viewBox="0 0 176 76" aria-hidden="true" focusable="false">
                  {(["wood", "grain", "ore"] as const).map((terrain, index) => (
                    <g key={terrain} transform={`translate(${30 + index * 58} ${index === 1 ? 32 : 44}) scale(.5)`}>
                      <polygon points="0,-58 50,-29 50,29 0,58 -50,29 -50,-29" fill={boardTheme.terrain[terrain].fill} stroke={boardTheme.border} strokeWidth="3" strokeLinejoin="round" />
                      <TerrainArtwork terrain={terrain} theme={boardTheme} />
                    </g>
                  ))}
                </svg>
                <span className="min-w-0 flex-1">
                  <span className="block text-[10px] font-medium text-muted">Board theme</span>
                  <span className="block text-xs font-semibold">{boardTheme.name}</span>
                </span>
                <span className="text-xs font-semibold underline underline-offset-4">Change</span>
              </button>
            </div>
            <div className="home-local-start" role="group" aria-label="Start on this device">
              {error && <p className="home-error mb-2 text-xs leading-4 text-clay" role="alert">{error}</p>}
              <button
                className="button-primary w-full justify-between"
                onClick={() => startGame(preview)}
              >
                Let&apos;s settle in <Arrow />
              </button>
            </div>
          </section>
          <section className="home-multiplayer" aria-label="Cross-device play">
            <h2 className="eyebrow mb-2">Separate multiplayer setup</h2>
            <a className="button-primary w-full justify-between" href="/?multiplayer=1">
              Play across devices <Arrow />
            </a>
          </section>
          <section
            id="home-island"
            className="home-island"
            aria-label="Island preview"
          >
            <div className="flex shrink-0 items-center justify-between gap-3">
              <div>
                <p className="eyebrow">A place to begin</p>
                <h2 className="mt-1 font-serif text-2xl">Your island awaits.</h2>
              </div>
              <button
                className="button-secondary !px-3 !text-xs"
                onClick={() => setPreview(createBoard())}
                aria-label="Shuffle island preview"
              >
                <span aria-hidden="true">&#8635;</span> Shuffle
              </button>
            </div>
            <div className="min-h-0 flex-1">
              <Board
                board={preview}
                players={[]}
                robberTileId={
                  preview.tiles.find((tile) => tile.terrain === "desert")?.id
                }
                interactive={false}
                compact
                fit
                onChangeTheme={() => setDialog("theme")}
              />
            </div>
            <div className="flex shrink-0 flex-wrap justify-between gap-2 text-[10px] text-muted">
              <span>19 hexes. A new story every time.</span>
              <span>3-4 settlers / 60-120 minutes</span>
            </div>
          </section>
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
                    <DiscardSelection
                      resources={viewer.resources}
                      required={game.phase.required[viewer.id]!}
                      chosenResources={chosenResources}
                      onChangeResources={setChosenResources}
                      disabled={rollBusy}
                      onConfirm={() => perform({ type: "discard", resources: chosenResources })}
                    />
                  </section>
                )}
              {game.phase.type === "steal" && isActive && (
                <section className="hand-task panel space-y-2 p-4">
                  <h2 className="eyebrow mb-3">
                    Choose a player to steal from
                  </h2>
                  <TheftChoices
                    players={game.phase.victimIds.map(playerId => {
                      const victim = game.players.find(player => player.id === playerId)!;
                      return { id: victim.id, name: victim.name, resourceCount: resourceTotal(victim.resources) };
                    })}
                    onSelect={playerId => {
                      const victim = game.players.find(player => player.id === playerId)!;
                      setConfirmation({
                        action: { type: "steal", playerId },
                        title: "Confirm theft",
                        description: resourceTotal(victim.resources) > 0
                          ? `Steal one random resource from ${victim.name}.`
                          : `${victim.name} has no resources. Finish without taking a card.`,
                      });
                    }}
                  />
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
                        <BuildButton
                          piece={piece}
                          color={viewer.color}
                          resources={COSTS[piece]}
                          title={unavailable}
                          disabled={
                            !normalActions ||
                            !canAfford(COSTS[piece]) ||
                            !locations.length
                          }
                          aria-pressed={buildMode === piece}
                          aria-describedby={explanation ? "settlement-build-explanation" : undefined}
                          onClick={() => {
                            setBuildMode(buildMode === piece ? null : piece);
                            setSelected(null);
                            setMobileView("board");
                          }}
                        />
                        {explanation && (
                          <p id="settlement-build-explanation" className="-mt-1 rounded-lg bg-moss/60 px-3 py-2 text-xs leading-5 text-ink">
                            {explanation}
                          </p>
                        )}
                      </Fragment>
                    );
                  })}
                  <BuildButton
                    piece="development"
                    color={viewer.color}
                    resources={COSTS.development}
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
                  />
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
                    setError("");
                  }}
                >
                  Make a trade
                </button>
              </section>
              <DevelopmentHand
                cards={viewer.developmentCards}
                turnNumber={game.turnNumber}
                inert={handTaskOpen}
                onSelect={cardId => {
                  setDevelopmentCardId(cardId);
                  setChosenResources(emptyResources());
                  setDialog("development");
                  setError("");
                }}
              />

              {game.trade && (
                <section className="hand-task panel p-4" aria-label="Open trade">
                  <ResourceInventory resources={viewer.resources} />
                  <h2 className="font-serif text-xl">{game.trade.give ? "Trade offer" : "Trade request"}</h2>
                  <OpenTrade
                    trade={game.trade}
                    viewer={viewer}
                    players={game.players}
                    chosenResources={chosenResources}
                    onChangeResources={setChosenResources}
                    onComplete={(playerId, price) => setConfirmation({
                      action: { type: "complete-trade", playerId },
                      title: `Trade with ${game.players.find(player => player.id === playerId)!.name}`,
                      exchange: { give: price, receive: game.trade!.receive },
                    })}
                    onEdit={() => {
                      setTradeMode("players");
                      setDialog("trade");
                      setError("");
                    }}
                    onWithdraw={() => perform({ type: "cancel-trade" })}
                    onRespond={perform}
                    onPass={passTo}
                  />
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
                <TurnInstructions
                  title={instructionTitle}
                  description={computerPlayer && !rollBusy ? `${computerPlayer.name} ${game.trade ? "is considering the trade." : game.phase.type === "discard" ? "is discarding resources." : "is playing automatically."}` : instructionDescription}
                  computerActivity={Boolean(computerPlayer)}
                  onCancelKnight={canCancelKnight ? () => perform({ type: "cancel-knight" }) : undefined}
                />
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

      <footer className={`${game?.winnerId ? "flex" : "hidden"} mx-auto max-w-[1440px] flex-wrap justify-between gap-3 px-5 py-6 text-[9px] uppercase tracking-[.14em] text-muted sm:px-9 lg:px-12`}>
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
      {game && !game.winnerId && <TheftNotice thefts={game.thefts} playerId={viewer?.id ?? null} players={game.players} />}
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
        <ActionConfirmation
          title={confirmation.title}
          description={confirmation.description}
          exchange={confirmation.exchange}
          resources={viewer && confirmation.action.type !== "steal" ? viewer.resources : undefined}
          error={error}
          onClose={() => {
            setConfirmation(null);
            setError("");
          }}
          onConfirm={() => perform(confirmation.action)}
        />
      )}
      {dialog === "trade" && game && viewer && (
        <TradeDialog
          game={game}
          player={viewer}
          initialOffer={game.trade}
          initialMode={tradeMode}
          onModeChange={setTradeMode}
          disabled={rollBusy}
          error={error}
          onClose={() => {
            setDialog(null);
            setError("");
          }}
          onSubmit={perform}
        />
      )}
      {dialog === "development" && game && viewer && (
        <DevelopmentDialog
          player={viewer}
          bank={game.bank}
          turnNumber={game.turnNumber}
          phaseType={game.phase.type}
          developmentPlayed={game.developmentPlayed}
          active={isActive}
          disabled={rollBusy}
          initialCardId={developmentCardId}
          error={error}
          onClose={() => {
            setDialog(null);
            setError("");
          }}
          onSubmit={perform}
          onClearError={() => setError("")}
        />
      )}
    </div>
    </BoardThemeContext>
  );
}

export default App;
