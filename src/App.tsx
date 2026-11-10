import { Fragment, useEffect, useEffectEvent, useRef, useState } from "react";
import { match } from "ts-pattern";
import { Board, useFogRevealHistory } from "./components/Board";
import { MapSeedControls } from "./components/MapSeedControls";
import { BoardSettingsDialog, useBoardSettings } from "./components/BoardSettings";
import { GameMenu } from "./components/GameMenu";
import { HelpDialog } from "./components/HelpDialog";
import { GameVariantSelector, GameVariantSummary } from "./components/GameVariantSelector";
import { FreeRouteChoice, GoldSelection } from "./components/SeafarersControls";
import { RollSummary, type RollStage } from "./components/RollSummary";
import { ResourceCollection, type ResourceReceipt } from "./components/ResourceCollection";
import { PrivateNotices } from "./components/PrivateNotices";
import { ThemeSelector } from "./components/ThemeSelector";
import { TerrainArtwork } from "./components/ThemeArtwork";
import { TradeDialog } from "./components/TradeDialog";
import { OpenTrade } from "./components/OpenTrade";
import { PlayerSeat } from "./components/PlayerSeat";
import { DevelopmentHand } from "./components/DevelopmentHand";
import { VictoryDialog } from "./components/VictoryDialog";
import { CollapsibleSection, COLLAPSIBLE_EXPANDED_MEDIA } from "./components/CollapsibleSection";
import { getPhaseInstructions, TurnInstructions } from "./components/TurnInstructions";
import {
  ActionConfirmation,
  DevelopmentDialog,
  DiscardSelection,
  TheftChoices,
} from "./components/GameplayDialogs";
import { BOARD_THEMES, BoardThemeContext, getThemeName, type BoardThemeId } from "./themes";
import { defaultComputerName, resourceName, type Language, type TranslationParameters } from "./i18n";
import { useLanguage, useTranslation } from "./localization";
import { appTranslations } from "./translations/app";
import { ProfileGate } from "./components/ProfileGate";
import { ScanToJoin } from "./components/ScanToJoin";
import {
  activeProfile, createProfile, profileStats, readProfileState, recordGameResult, removeProfile,
  writeProfileState, type PlayerProfile, type ProfileState,
} from "./profile";
import { formatGameMessage, gameErrorMessage, type GameMessage } from "./game/messages";
import {
  Arrow,
  BankSupply,
  BuildButton,
  DevelopmentCardIcon,
  Dialog,
  Logo,
  ResourceCard,
  ResourceInventory,
} from "./components/GameUi";
import { createBoard, generateMapSeed, normalizeMapSeed, pirateStartTileId, seededRandom } from "./game/board";
import { chooseComputerAction, getComputerActionDelay, getController } from "./game/computer";
import {
  applyAction,
  COSTS,
  createGame,
  emptyResources,
  getLongestRoadLength,
  getScore,
  legalCityVertices,
  legalRoadEdges,
  legalShipEdges,
  legalShipDestinations,
  movableShipEdges,
  legalSettlementVertices,
  legalSetupRevealTiles,
  RESOURCES,
  resourceTotal,
  victoryTarget,
} from "./game/engine";
import { isGameVariant, isSeafarers } from "./game/types";
import type {
  GameAction,
  GameState,
  GameVariant,
  Player,
  Resources,
} from "./game/types";
import "./index.css";
import { getRollOutcome, type RollOutcome } from "./rollPresentation";
import { getResourceGains } from "./resourceReceipt";
import { generateIdentifier } from "./identity";

type RollPresentation = {
  outcome: RollOutcome;
  next: GameState;
  automatic: boolean;
  stage: RollStage;
};

const PLAYER_COLORS = ["#b85d47", "#477c91", "#c1953d", "#76608c"];
const BOARD_THEME_STORAGE_KEY = "catania.boardTheme";

function phaseTitle(state: GameState, language: Language) {
  return getPhaseInstructions({
    language,
    phase: state.phase,
    variant: state.variant,
    secondSettlement: state.setupIndex >= state.players.length,
  }).title;
}

function phaseDescription(state: GameState, language: Language) {
  return getPhaseInstructions({
    language,
    phase: state.phase,
    variant: state.variant,
    secondSettlement: state.setupIndex >= state.players.length,
  }).description;
}

export function App() {
  const { language } = useLanguage();
  const translateText = useTranslation(appTranslations);
  const [boardThemeId, setBoardThemeId] = useState<BoardThemeId>(() => {
    try {
      const savedTheme = window.localStorage.getItem(BOARD_THEME_STORAGE_KEY);
      return savedTheme && Object.hasOwn(BOARD_THEMES, savedTheme) ? savedTheme as BoardThemeId : "illustrated";
    } catch {
      return "illustrated";
    }
  });
  const boardTheme = BOARD_THEMES[boardThemeId];
  const [savedMap] = useState<{ seed: string; variant: GameVariant } | null>(() => {
    const parameters = new URLSearchParams(window.location.search);
    const seed = normalizeMapSeed(parameters.get("map") ?? "");
    const variant = parameters.get("variant") ?? "original";
    return seed && isGameVariant(variant) ? { seed, variant } : null;
  });
  const [variant, setVariant] = useState<GameVariant>(savedMap?.variant ?? "original");
  const [preview, setPreview] = useState(() => {
    const seed = savedMap?.seed ?? generateMapSeed();
    return { seed, board: createBoard(seededRandom(seed), savedMap?.variant ?? "original") };
  });
  const [mapCode, setMapCode] = useState("");
  const [mapCodeInvalid, setMapCodeInvalid] = useState(false);
  const [gameMapSeed, setGameMapSeed] = useState<string | null>(null);
  const [gameInstanceId, setGameInstanceId] = useState<string | null>(null);
  const [gameProfileId, setGameProfileId] = useState<string | null>(null);
  const [profileState, setProfileState] = useState<ProfileState>(() => readProfileState());
  const [profileGateOpen, setProfileGateOpen] = useState(false);
  const [names, setNames] = useState(() => {
    // The selected profile's name prefills the first human seat; the rest keep their placeholders.
    const profile = activeProfile(readProfileState());
    return profile ? [profile.name, "Sam", "Jordan", "Robin"] : ["Alex", "Sam", "Jordan", "Robin"];
  });
  const [playerCount, setPlayerCount] = useState(3);
  const [humanCount, setHumanCount] = useState(1);
  const [homeView, setHomeView] = useState<"setup" | "island">(savedMap ? "island" : "setup");
  const [game, setGame] = useState<GameState | null>(null);
  const fogRevealHistory = useFogRevealHistory();
  const initialGame = useRef<{ state: GameState; mapSeed: string } | null>(null);
  const [victoryDismissed, setVictoryDismissed] = useState(false);
  const [rollPresentation, setRollPresentation] = useState<RollPresentation | null>(null);
  const [resourceReceipt, setResourceReceipt] = useState<ResourceReceipt | null>(null);
  const [privateNoticeTarget, setPrivateNoticeTarget] = useState<HTMLDivElement | null>(null);
  const boardSettings = useBoardSettings();
  const { showBlockedSettlementLocations, fillBoardWithWater } = boardSettings;
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const rollBusy = Boolean(rollPresentation && rollPresentation.stage !== "complete");
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [handoffTarget, setHandoffTarget] = useState<string | null>(null);
  const [dialog, setDialog] = useState<
    "help" | "settings" | "theme" | "trade" | "development" | "players" | "restart" | "reset" | "scan" | null
  >(null);
  const gamePaused = dialog === "restart" || dialog === "reset";
  const [mobileView, setMobileView] = useState<"board" | "hand" | "players">(
    "hand",
  );
  const [buildMode, setBuildMode] = useState<
    "road" | "ship" | "move-ship" | "settlement" | "city" | null
  >(null);
  const [movingShipId, setMovingShipId] = useState<string | null>(null);
  const [buildSectionOpen, setBuildSectionOpen] = useState(() =>
    window.matchMedia(COLLAPSIBLE_EXPANDED_MEDIA).matches,
  );
  const [selected, setSelected] = useState<{
    kind: "vertex" | "edge" | "tile";
    id: string;
  } | null>(null);
  const [confirmation, setConfirmation] = useState<{
    action: GameAction;
    title: keyof typeof appTranslations;
    description?: keyof typeof appTranslations;
    parameters?: TranslationParameters;
    exchange?: { give: Resources; receive: Resources };
  } | null>(null);
  const [error, setError] = useState<GameMessage | keyof typeof appTranslations | "">(
    new URLSearchParams(window.location.search).has("map") && !savedMap ? "This saved map link is invalid." : "",
  );
  const errorText = typeof error === "string"
    ? error ? translateText(error) : ""
    : formatGameMessage(language, error);
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
        setError(gameErrorMessage(failure, "The computer could not finish its move."));
      }
    },
  );

  useEffect(() => {
    if (!game || !computerPlayer || rollBusy || gamePaused) return;
    const delay = getComputerActionDelay(game);
    if (delay === null) return;
    const timeout = window.setTimeout(
      () => takeComputerTurn(game, computerPlayer.id),
      delay,
    );
    return () => window.clearTimeout(timeout);
  }, [game, computerPlayer?.id, rollBusy, gamePaused]);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(preference.matches);
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);

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
    if (!rollPresentation || rollPresentation.stage === "complete" || gamePaused) return;
    // Timers also finish when CSS motion is disabled; animationend is not required.
    const duration = reducedMotion ? 0 : match(rollPresentation.stage)
      .with("rolling", () => 500)
      .with("production", () => 300)
      .with("received", () => 700)
      .exhaustive();
    const timeout = window.setTimeout(() => advanceRollPresentation(rollPresentation), duration);
    return () => window.clearTimeout(timeout);
  }, [rollPresentation, reducedMotion, gamePaused]);

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
    // Suppress mobile pull-to-refresh, which reloads without the beforeunload dialog.
    document.body.classList.add("game-in-progress");
    return () => {
      window.removeEventListener("beforeunload", warn);
      document.body.classList.remove("game-in-progress");
    };
  }, [Boolean(game), Boolean(game?.winnerId)]);

  useEffect(() => {
    // The field follows the current map code; typing a different code replays that island.
    setMapCode(preview.seed);
    setMapCodeInvalid(false);
  }, [preview.seed]);

  useEffect(() => {
    // Attribute the result to the profile that started the game, not a later selection.
    if (!game?.winnerId || !gameInstanceId || !gameMapSeed || humanCount !== 1) return;
    const current = profileState.profiles.find(profile => profile.id === gameProfileId);
    if (!current) return;
    const human = game.players.find(player => player.control === "human")!;
    const updated = recordGameResult(current, {
      gameId: gameInstanceId,
      mapCode: gameMapSeed,
      variant: game.variant,
      won: game.winnerId === human.id,
      points: getScore(game, human.id).total,
      turnCount: game.turnNumber,
    });
    if (updated === current) return;
    const next = { profiles: profileState.profiles.map(profile => profile === current ? updated : profile), activeId: profileState.activeId };
    if (!writeProfileState(next)) setError({ key: "Your game history could not be saved on this device." });
    setProfileState(next);
    // Re-running after the update is a no-op: the same game never counts twice.
  }, [Boolean(game?.winnerId), gameInstanceId, gameMapSeed, humanCount, gameProfileId]);

  function startGame(selectedBoard?: GameState["board"], selectedSeed?: string) {
    try {
      const profiles = names.slice(0, playerCount).map(
        (name, index): Pick<Player, "name" | "color" | "control"> => ({
          name: index < humanCount
            ? name.trim() || translateText("Player {number}", { number: index + 1 })
            : defaultComputerName(language, index - humanCount + 1),
          color: PLAYER_COLORS[index]!,
          control: index < humanCount ? "human" : "computer",
        }),
      );
      if (
        new Set(profiles.map((profile) => profile.name.toLowerCase())).size !==
        profiles.length
      ) {
        setHomeView("setup");
        setError("Use a different name for each player so private handoffs are clear.");
        return;
      }
      // Every game's island comes from a map code so it can be replayed later.
      const mapSeed = selectedSeed ?? generateMapSeed();
      const board = selectedBoard ?? createBoard(seededRandom(mapSeed), variant);
      const next = createGame(profiles, undefined, board, variant);
      initializeGame(next, mapSeed);
    } catch (failure) {
      setHomeView("setup");
      setError(gameErrorMessage(failure, "The game could not be started."));
    }
  }

  function initializeGame(next: GameState, mapSeed: string) {
    initialGame.current = { state: next, mapSeed };
    fogRevealHistory.current.terrains.clear();
    fogRevealHistory.current.generations.clear();
    fogRevealHistory.current.completedVeils.clear();
    fogRevealHistory.current.version++;
    setGameMapSeed(mapSeed);
    setGameInstanceId(generateIdentifier());
    setGameProfileId(profileState.activeId);
    setRollPresentation(null);
    setResourceReceipt(null);
    setGame(next);
    const firstHuman = next.players.find(player => player.control === "human")!;
    const firstController = next.players.find(player => player.id === getController(next))!;
    setViewerId(humanCount === 1 ? firstHuman.id : null);
    setHandoffTarget(humanCount > 1 && firstController.control === "human" ? firstController.id : null);
    setDialog(null);
    setConfirmation(null);
    setChosenResources(emptyResources());
    setDevelopmentCardId(null);
    setTradeMode("bank");
    setVictoryDismissed(false);
    setMobileView("board");
    setHomeView("setup");
    setError("");
    setSelected(null);
    setBuildMode(null);
    setMovingShipId(null);
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
    setMovingShipId(null);
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
      setDialog(null);
      setConfirmation(null);
      setVictoryDismissed(false);
      // Keep the game table mounted so the victory pops up over the board.
      setMobileView("board");
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
      ["setup-settlement", "setup-reveal", "setup-road", "road-building", "robber"].includes(
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
      setMovingShipId(null);
      setConfirmation(null);
      setDialog(null);
      setChosenResources(emptyResources());
      setDevelopmentCardId(null);
      presentAction(next, action);
    } catch (failure) {
      setError(gameErrorMessage(failure, "That action is not available."));
    }
  }

  const activePlayer = game?.players.find(
    (player) => player.id === game.activePlayerId,
  );
  const viewer = humanPlayers.find((player) => player.id === viewerId);
  const handoffPlayer = game?.players.find(
    (player) => player.id === handoffTarget,
  );
  const winner = game?.winnerId
    ? game.players.find((player) => player.id === game.winnerId)!
    : null;
  const winnerScore = game && winner ? getScore(game, winner.id) : null;
  // Without a revealed viewer there is no hand to keep mounted, so the win goes straight to results.
  const showVictoryScreen = Boolean(game?.winnerId && !viewer);
  const isActive = Boolean(viewer && viewer.id === activePlayer?.id);
  const normalActions = isActive && !rollBusy && game?.phase.type === "actions";
  const canCancelKnight = isActive && !rollBusy && game?.phase.type === "robber" && Boolean(game.phase.pendingKnight);
  const producingTileIds = rollPresentation && rollPresentation.stage !== "rolling"
    ? rollPresentation.outcome.producingTileIds : [];
  const rolledNumber = rollPresentation && rollPresentation.stage !== "rolling"
    ? rollPresentation.outcome.dice[0] + rollPresentation.outcome.dice[1] : undefined;
  const receivedResources = resourceReceipt?.playerId === viewerId ? resourceReceipt?.gains : undefined;
  const viewerVictoryPointCards = viewer
    ? viewer.developmentCards.filter((card) => card.kind === "victory-point").length
    : 0;
  const awaitingViewer = viewer && (
    viewer.id === controllingPlayer?.id ||
    (game?.phase.type === "discard" && (game.phase.required[viewer.id] ?? 0) > 0)
  );
  const handTaskOpen = Boolean(viewer && game && (game.trade ||
    (game.phase.type === "gold" && getController(game) === viewer.id) ||
    (game.phase.type === "discard" && (game.phase.required[viewer.id] ?? 0) > 0) ||
    (game.phase.type === "steal" && isActive)));
  const instructionTitle = rollBusy ? translateText("Let the island provide.") : game && awaitingViewer
    ? phaseTitle(game, language)
    : translateText("The island is in motion.");
  const instructionDescription = rollBusy
    ? translateText("Follow the dice, the matching number tokens, and the cards arriving in your hand.")
    : game && awaitingViewer
    ? buildMode === "move-ship"
      ? translateText(movingShipId ? "Choose a destination for your ship." : "Choose an open-ended ship, then its destination.")
      : phaseDescription(game, language)
    : translateText("{name} is playing. You can inspect your hand and the island while you wait.", { name: controllingPlayer?.name ?? "" });
  const canAfford = (cost: ReturnType<typeof emptyResources>) =>
    Boolean(
      viewer &&
        RESOURCES.every(
          (resource) => viewer.resources[resource] >= cost[resource],
        ),
    );
  const settlementUnavailable = game && viewer &&
    game.board.vertices.filter(vertex => vertex.building?.playerId === viewer.id && vertex.building.kind === "settlement").length >= 5
      ? translateText("All 5 settlements are on the board. Upgrade one to a city to free a settlement piece.")
      : null;
  const cityUnavailable = game && viewer
    ? game.board.vertices.filter(vertex => vertex.building?.playerId === viewer.id && vertex.building.kind === "city").length >= 4
      ? translateText("All 4 cities are on the board.")
      : canAfford(COSTS.city) && !game.board.vertices.some(vertex => vertex.building?.playerId === viewer.id && vertex.building.kind === "settlement")
        ? translateText("You have no settlements to upgrade. Build a settlement first.")
        : null
    : null;
  const roadUnavailable = game && viewer
    ? game.board.edges.filter(edge => edge.playerId === viewer.id && (edge.kind ?? "road") === "road").length >= 15
      ? translateText("All 15 roads are on the board.")
      : normalActions && canAfford(COSTS.road) && legalRoadEdges(game, viewer.id).length === 0
        ? translateText("No legal position. Roads must connect to your roads, settlements, or cities.")
        : null
  : null;
  const shipUnavailable = game && viewer
    ? game.board.edges.filter(edge => edge.playerId === viewer.id && edge.kind === "ship").length >= 15
      ? translateText("All 15 ships are on the board.")
      : normalActions && canAfford(COSTS.ship) && legalShipEdges(game, viewer.id).length === 0
        ? translateText("No legal position. Ships must connect to your ships, settlements, or cities.")
        : null
  : null;
  const legalVertices =
    game && viewer && isActive && !rollBusy
      ? game.phase.type === "setup-settlement" || game.phase.type === "setup-reveal" || buildMode === "settlement"
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
      buildMode === "road" || buildMode === "ship" || buildMode === "move-ship")
      ? buildMode === "move-ship"
        ? movingShipId ? legalShipDestinations(game, viewer.id, movingShipId)
          : movableShipEdges(game, viewer.id).filter(id => legalShipDestinations(game, viewer.id, id).length)
        : buildMode === "ship" ? legalShipEdges(game, viewer.id)
        : buildMode === "road" ? legalRoadEdges(game, viewer.id)
        : game.variant === "foggy-world" && game.phase.type === "setup-road" ? []
        : [...legalRoadEdges(game, viewer.id), ...legalShipEdges(game, viewer.id)]
      : [];
  const legalTiles =
    game && viewer && isActive && !rollBusy
      ? game.phase.type === "setup-reveal"
        ? legalSetupRevealTiles(game, viewer.id)
        : game.phase.type === "robber" ? game.board.tiles
            .filter((tile) => tile.terrain !== "fog" && (tile.terrain === "sea"
              ? isSeafarers(game.variant) && tile.id !== game.pirateTileId
              : tile.id !== game.robberTileId))
            .map((tile) => tile.id)
        : []
      : [];
  const selectedAction: GameAction | null =
    !selected || !game
      ? null
      : selected.kind === "tile"
        ? { type: game.phase.type === "setup-reveal" ? "reveal-tile" : game.board.tiles.find(tile => tile.id === selected.id)?.terrain === "sea" ? "move-pirate" : "move-robber", tileId: selected.id }
        : selected.kind === "edge"
          ? buildMode === "move-ship" && movingShipId
            ? { type: "move-ship", edgeId: movingShipId, destinationEdgeId: selected.id }
            : { type: buildMode === "ship" || !legalRoadEdges(game, game.activePlayerId).includes(selected.id) ? "place-ship" : "place-road", edgeId: selected.id }
          : {
              type: buildMode === "city" ? "place-city" : "place-settlement",
              vertexId: selected.id,
            };

  function returnToTable() {
    setGame(null);
    setRollPresentation(null);
    setResourceReceipt(null);
    setViewerId(null);
    setVictoryDismissed(false);
  }

  function restartGame() {
    const initial = initialGame.current!;
    initializeGame(structuredClone(initial.state), initial.mapSeed);
  }

  function playerCards() {
    if (!game) return null;
    const scores = game.players.map(player => getScore(game, player.id));
    const highestPublicScore = Math.max(...scores.map(score => score.public));
    const showPublicScoreLeaders = scores.some(score => score.public < highestPublicScore);
    return game.players.map((player, index) => {
      const score = scores[index]!;
      return <PlayerSeat key={player.id} variant={game.variant} number={index + 1}
        player={{ ...player, resourceCount: resourceTotal(player.resources), developmentCount: player.developmentCards.length, longestRoad: getLongestRoadLength(game, player.id), score: game.winnerId ? score.total : score.public }}
        active={game.activePlayerId === player.id} leading={showPublicScoreLeaders && score.public === highestPublicScore}
        largestArmy={game.awards.largestArmy === player.id} longestRoadAward={game.awards.longestRoad === player.id}
        islandBonus={score.islands ?? 0}
        privateScore={player.id === viewerId ? score.total : undefined} />;
    });
  }

  const gameMenu = <GameMenu icon={Boolean(viewer)} actions={[
    { label: translateText("Help"), onSelect: () => { setDialog("help"); setError(""); } },
    { label: translateText("Settings"), onSelect: () => setDialog("settings") },
    ...(needsHandoff && viewer ? [{ label: translateText("Pass device"), disabled: rollBusy, onSelect: () => setDialog("players") }] : []),
    { label: translateText("Reset game"), onSelect: () => setDialog("reset") },
  ]} exitAction={{ label: translateText("End game"), onSelect: () => setDialog("restart") }} />;

  const playerProfile = activeProfile(profileState);
  if ((!game || game.winnerId) && (!playerProfile || profileGateOpen)) {
    const selectProfile = (profile: PlayerProfile) => {
      const next = { profiles: profileState.profiles, activeId: profile.id };
      writeProfileState(next);
      setProfileState(next);
      setNames(current => [profile.name, ...current.slice(1)]);
      setProfileGateOpen(false);
    };
    const addProfile = (profile: PlayerProfile) => {
      const next = { profiles: [...profileState.profiles, profile], activeId: profile.id };
      writeProfileState(next);
      setProfileState(next);
      setNames(current => [profile.name, ...current.slice(1)]);
      setProfileGateOpen(false);
    };
    const renameProfile = (profile: PlayerProfile, name: string) => {
      const next = { profiles: profileState.profiles.map(candidate => candidate.id === profile.id ? { ...candidate, name } : candidate), activeId: profileState.activeId };
      writeProfileState(next);
      setProfileState(next);
      if (profile.id === profileState.activeId) setNames(current => [name, ...current.slice(1)]);
    };
    return (
      <BoardThemeContext value={boardTheme}>
        <div data-theme={boardThemeId} className="min-h-dvh">
          <ProfileGate
            profiles={profileState.profiles}
            activeProfileId={playerProfile?.id}
            onSelect={selectProfile}
            onCreate={addProfile}
            onRename={renameProfile}
            onDelete={profile => {
              const next = removeProfile(profileState, profile.id);
              if (!writeProfileState(next)) return false;
              setProfileState(next);
              return true;
            }}
            onReplay={(profile, previousGame) => {
              selectProfile(profile);
              returnToTable();
              setHandoffTarget(null);
              setDialog(null);
              setVariant(previousGame.variant);
              setPreview({ seed: previousGame.mapCode, board: createBoard(seededRandom(previousGame.mapCode), previousGame.variant) });
              setHomeView("island");
              setError("");
            }}
          />
        </div>
      </BoardThemeContext>
    );
  }

  return (
    <BoardThemeContext value={boardTheme}>
    <div data-theme={boardThemeId} className={!game ? "home-shell" : !game.winnerId || !showVictoryScreen ? "game-shell" : "min-h-dvh"}>
      {(!game || game.winnerId || !viewer) && (
        <header className="mx-auto flex max-w-[1600px] items-center justify-between gap-2 border-b border-line px-3 py-5 sm:gap-4 sm:px-9 lg:px-12">
          <div className="min-w-0 shrink-0 max-[360px]:[&>span>svg]:hidden max-[360px]:[&>span>span]:text-2xl"><Logo /></div>
          <div className="flex shrink-0 items-center gap-2 sm:gap-4">
            {game && !game.winnerId ? (
              !viewer && gameMenu
            ) : (
              <GameMenu
                triggerLabel={translateText("Menu")}
                groupLabel={translateText("Main menu")}
                profileName={playerProfile?.name}
                actions={[
                  { label: translateText("Help"), onSelect: () => { setDialog("help"); setError(""); } },
                  { label: translateText("Profile"), onSelect: () => setProfileGateOpen(true) },
                  ...(game?.winnerId ? [{ label: translateText("Restart"), onSelect: restartGame }] : []),
                ]}
                exitAction={game?.winnerId ? { label: translateText("Back to home"), onSelect: returnToTable } : undefined}
              />
            )}
          </div>
        </header>
      )}

      {!game ? (
        <main className="home-main" data-view={homeView}>
          <div className="home-introduction">
            <p className="eyebrow mb-3 flex items-center gap-3">
              <span className="h-px w-8 bg-clay" />
              {translateText("Your next gathering starts here")}
            </p>
            <h1 className="font-serif leading-[1.05] tracking-[-.045em]">
              {translateText("A little island.")}
              <br />
              {language === "en"
                ? <>Endless <span className="italic text-ink">possibility.</span></>
                : <span className="italic text-ink">{translateText("Endless possibility.")}</span>}
            </h1>
          </div>
          <nav className="home-navigation" aria-label={translateText("Home views")}>
            {(["setup", "island"] as const).map(view => (
              <button
                key={view}
                aria-pressed={homeView === view}
                aria-controls={`home-${view}`}
                onClick={() => setHomeView(view)}
              >
                {translateText(view === "setup" ? "Setup" : "Island")}
              </button>
            ))}
          </nav>
          <section
            id="home-setup"
            className="home-setup panel"
            aria-label={translateText("Set up your table")}
          >
            <div className="home-setup-content">
              <div>
                <p className="eyebrow">{translateText("On this device")}</p>
                <h2 className="home-setup-heading mt-1 font-serif text-2xl">
                  {translateText("Make room at the table.")}
                </h2>
              </div>
              <div className="home-table-options">
                <div>
                  <p className="mb-1.5 text-[11px] font-semibold text-muted">{translateText("Table size")}</p>
                  <div className="flex rounded-xl bg-moss p-1" role="group" aria-label={translateText("Number of players")}>
                    {[3, 4].map((count) => (
                      <button
                        key={count}
                        onClick={() => {
                          setPlayerCount(count);
                          setHumanCount((current) => Math.min(current, count));
                        }}
                        aria-pressed={playerCount === count}
                        className={`min-h-11 min-w-0 flex-1 rounded-lg px-0 text-[10px] font-semibold sm:px-2 sm:text-xs ${playerCount === count ? "bg-white shadow-sm" : "text-muted"}`}
                      >
                        {translateText("{count} players", { count })}
                      </button>
                    ))}
                  </div>
                </div>
                <label className="min-w-0 text-[10px] font-semibold text-muted sm:text-[11px]">
                  <span className="mb-1.5 block">{translateText("Human players")}</span>
                  <select
                    className="field !min-h-[52px] !px-1 !text-[10px] text-ink sm:!px-2 sm:!text-xs"
                    value={humanCount}
                    onChange={(event) => setHumanCount(Number(event.target.value))}
                  >
                    {Array.from({ length: playerCount }, (_, index) => index + 1)
                      .map((count) => (
                        <option key={count} value={count}>
                          {translateText(count === 1 ? "{count} human" : "{count} humans", { count })}
                        </option>
                      ))}
                  </select>
                </label>
                <GameVariantSelector value={variant} onChange={nextVariant => {
                  setVariant(nextVariant);
                  const seed = generateMapSeed();
                  setPreview({ seed, board: createBoard(seededRandom(seed), nextVariant) });
                }} />
              </div>
              {isSeafarers(variant) && <p className="text-xs leading-5 text-muted"><GameVariantSummary variant={variant} /></p>}
              <div className="grid grid-cols-2 gap-2">
                {names.slice(0, playerCount).map((name, index) => index < humanCount ? (
                  <label
                    key={index}
                    className="flex items-center gap-2 rounded-lg border border-line bg-paper/70 px-3"
                  >
                    <span
                      className="player-number flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white"
                      style={{ background: PLAYER_COLORS[index] }}
                    >
                      {Array.from(name.trim())[0]?.toUpperCase() ?? index + 1}
                    </span>
                    <span className="sr-only">{translateText("Player {number} name", { number: index + 1 })}</span>
                    <input
                      aria-label={translateText("Player {number} name", { number: index + 1 })}
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
                      {defaultComputerName(language, index - humanCount + 1)}{" "}
                      <span className="text-[10px] text-muted">/ {translateText("AI")}</span>
                    </span>
                  </div>
                ))}
              </div>
              <button
                className="home-theme"
                aria-label={translateText("Change theme")}
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
                  <span className="block text-[10px] font-medium text-muted">{translateText("Board theme")}</span>
                  <span className="block text-xs font-semibold">{getThemeName(boardTheme, language)}</span>
                </span>
                <span className="text-xs font-semibold underline underline-offset-4">{translateText("Change")}</span>
              </button>
            </div>
            <div className="home-local-start" role="group" aria-label={translateText("Start on this device")}>
              {error && <p className="home-error mb-2 text-xs leading-4 text-clay" role="alert">{errorText}</p>}
              <button
                className="button-primary w-full justify-between"
                onClick={() => startGame(preview.board, preview.seed)}
              >
                {translateText("Let's settle in")} <Arrow />
              </button>
            </div>
          </section>
          <section className="home-multiplayer" aria-label={translateText("Cross-device play")}>
            <h2 className="eyebrow mb-2">{translateText("Separate multiplayer setup")}</h2>
            <div className="grid gap-2">
              <a className="button-primary w-full justify-between" href="/?multiplayer=1">
                {translateText("Play across devices")} <Arrow />
              </a>
              <button className="button-secondary w-full justify-between" onClick={() => setDialog("scan")}>
                {translateText("Scan to join a board")} <Arrow />
              </button>
            </div>
          </section>
          <section
            id="home-island"
            className="home-island"
            aria-label={translateText("Island preview")}
          >
            <div className="shrink-0">
              <p className="eyebrow">{translateText("A place to begin")}</p>
              <h2 className="mt-1 font-serif text-2xl">{translateText("Your island awaits.")}</h2>
            </div>
            <div className="min-h-0 flex-1">
              <Board
                board={preview.board}
                players={[]}
                pirateTileId={pirateStartTileId(preview.board, seededRandom(preview.seed))}
                fillBoardWithWater={fillBoardWithWater}
                robberTileId={
                  preview.board.tiles.find((tile) => tile.terrain === "desert")?.id
                }
                interactive={false}
                compact
                fit
                victoryTarget={victoryTarget(variant)}
                onChangeTheme={() => setDialog("theme")}
                headerControls={<MapSeedControls
                  value={mapCode}
                  error={mapCodeInvalid ? translateText("Enter a valid 8-character map code.") : undefined}
                  onChange={value => {
                    setMapCode(value);
                    setMapCodeInvalid(false);
                  }}
                  onLoad={code => {
                    const normalized = normalizeMapSeed(code);
                    if (!normalized) {
                      setMapCodeInvalid(true);
                      return;
                    }
                    setMapCodeInvalid(false);
                    setPreview({ seed: normalized, board: createBoard(seededRandom(normalized), variant) });
                  }}
                  onShuffle={() => {
                    const seed = generateMapSeed();
                    setPreview({ seed, board: createBoard(seededRandom(seed), variant) });
                  }}
                />}
              />
            </div>
          </section>
        </main>
      ) : game.winnerId && showVictoryScreen ? (
        <main className="mx-auto max-w-5xl px-5 py-12 text-center">
          <p className="eyebrow">{translateText("The island has a new legend")}</p>
          <h1 className="mt-4 font-serif text-5xl">
            {translateText("{name} takes the island.", { name: game.players.find((player) => player.id === game.winnerId)?.name ?? "" })}
          </h1>
          <p className="mt-4 text-muted">
            {translateText("{points} points. Countless good deals. One more game?", { points: victoryTarget(game.variant) })}
          </p>
          <div className="my-10 grid gap-4 text-left sm:grid-cols-2">
            {game.players.map((player) => {
              const score = getScore(game, player.id);
              return (
                <section className="panel p-6" key={player.id}>
                  <div className="flex justify-between">
                    <h2 className="font-serif text-2xl">
                      {player.id === game.winnerId ? translateText("{name} / Winner", { name: player.name }) : player.name}
                    </h2>
                    <strong className="font-serif text-3xl">
                      {score.total}
                    </strong>
                  </div>
                  <dl className="mt-5 space-y-2 text-sm text-muted">
                    {[
                      [translateText("Settlements"), score.settlements],
                      [translateText("Cities"), score.cities],
                      [translateText(isSeafarers(game.variant) ? "Longest Route" : "Longest Road"), score.longestRoad],
                      [translateText("Largest Army"), score.largestArmy],
                      ...(game.variant === "seafarers" || game.variant === "four-islands" ? [[translateText("Island bonuses"), score.islands ?? 0]] : []),
                      [translateText("Revealed victory-point cards"), score.hidden],
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
              onClick={returnToTable}
            >
              {translateText("Back to home")}
            </button>
            <button className="button-primary" onClick={restartGame}>
              {translateText("Restart")} <Arrow />
            </button>
          </div>
        </main>
      ) : !viewer && handoffPlayer ? (
        <main className="handoff-table">
          <div className="handoff-island">
            <Board
              board={game.board}
              fogRevealHistory={fogRevealHistory}
              players={game.players}
              robberTileId={game.robberTileId}
              pirateTileId={game.pirateTileId}
              showBlockedSettlementLocations={showBlockedSettlementLocations}
              fillBoardWithWater={fillBoardWithWater}
              interactive={false}
              onChangeTheme={() => setDialog("theme")}
              compact
              fit
              victoryTarget={victoryTarget(game.variant)}
            />
          </div>
          <section className="handoff-card panel text-center">
            <span
              className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl text-2xl font-bold text-white"
              style={{ background: handoffPlayer.color }}
            >
              {handoffPlayer.name.charAt(0).toUpperCase()}
            </span>
            <p className="eyebrow mt-7">{translateText("A moment between friends")}</p>
            <h1 className="mt-3 font-serif text-4xl">
              {translateText("Pass the device to {name}.", { name: handoffPlayer.name })}
            </h1>
            <p className="mx-auto mt-4 max-w-xs text-sm leading-7 text-muted">
              {translateText("Everyone else, eyes on the island. Your private hand will appear when you're ready.")}
            </p>
            <button
              className="button-primary mt-7"
              onClick={() => {
                setViewerId(handoffPlayer.id);
                setHandoffTarget(null);
                setMobileView(
                  [
                    "setup-settlement",
                    "setup-reveal",
                    "setup-road",
                    "road-building",
                    "robber",
                  ].includes(game.phase.type)
                    ? "board"
                    : "hand",
                );
              }}
            >
              {translateText("I'm {name}. Reveal my hand", { name: handoffPlayer.name })} <Arrow />
            </button>
            <p className="mt-4 text-[10px] text-muted">
              {translateText("Local pass-and-play / private hands rely on taking turns")}
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
            aria-label={translateText("Game views")}
          >
            {(["hand", "board", "players"] as const).map((view) => (
              <button
                key={view}
                aria-pressed={mobileView === view}
                className={`min-h-11 flex-1 rounded-lg text-sm capitalize ${mobileView === view ? "bg-forest text-ink" : "text-muted"}`}
                onClick={() => setMobileView(view)}
              >
                {translateText(view)}
              </button>
            ))}
          </nav>
          <div className="table-feedback">
            <div className="roll-summary-feedback lg:hidden">
              <RollSummary seafarers={isSeafarers(game.variant)} outcome={rollPresentation?.outcome} stage={rollPresentation?.stage} viewerId={viewer.id} />
            </div>
            <BankSupply resources={game.bank} developmentCards={game.developmentDeck.length} />
          </div>
          <ResourceCollection
            receipt={resourceReceipt?.playerId === viewer.id ? resourceReceipt : null}
            onDismiss={() => setResourceReceipt(null)}
          />
          <div className="table-play-area" data-view={mobileView}>
            <section
              className={`table-board min-w-0 ${mobileView !== "board" ? "hidden lg:flex" : "flex"}`}
              aria-label={translateText("Game board")}
            >
              <div className="board-tablemat">
                <Board
                  board={game.board}
                  fogRevealHistory={fogRevealHistory}
                  players={game.players}
                  robberTileId={game.robberTileId}
                  pirateTileId={game.pirateTileId}
                  routeMode={buildMode === "ship" || buildMode === "move-ship" || buildMode === "road" ? buildMode : null}
                  routeChoice={isActive && isSeafarers(game.variant) && (game.phase.type === "setup-road" || game.phase.type === "road-building")
                    ? <FreeRouteChoice phase={game.phase} mode={buildMode} disabled={rollBusy} onSelect={mode => { setBuildMode(mode); setSelected(null); }} />
                    : undefined}
                  pirateIndicator={isSeafarers(game.variant) ? {
                    onBoard: game.pirateTileId !== null,
                    enabled: isActive && !rollBusy && game.phase.type === "robber",
                    onSelect: () => {
                      if (game.pirateTileId !== null) perform({ type: "move-pirate", tileId: null });
                      else setError("Move the robber or pirate.");
                    },
                  } : undefined}
                  showBlockedSettlementLocations={showBlockedSettlementLocations}
                  fillBoardWithWater={fillBoardWithWater}
                  producingTileIds={producingTileIds}
                  rolledNumber={rolledNumber}
                  onChangeTheme={() => setDialog("theme")}
                  fit
                  victoryTarget={victoryTarget(game.variant)}
                  legalVertexIds={legalVertices}
                  legalEdgeIds={legalEdges}
                  legalTileIds={legalTiles}
                  tileSelectionMode={game.phase.type === "setup-reveal" ? "setup" : "robber"}
                  selectedId={selected?.id ?? movingShipId}
                  confirmation={selectedAction && selected ? {
                    title: selected.kind === "tile"
                      ? translateText(selectedAction.type === "reveal-tile" ? "Choose this starting cell?" : selectedAction.type === "move-pirate" ? "Move the pirate here?" : "Move the robber here?")
                      : selected.kind === "edge"
                        ? translateText(selectedAction.type === "move-ship" ? "Move the ship here?" : selectedAction.type === "place-ship" ? "Build a ship here?" : "Build a road here?")
                        : buildMode === "city"
                          ? translateText("Upgrade to a city?")
                          : translateText("Settle here?"),
                    player: { name: viewer.name, color: viewer.color },
                    onConfirm: () => perform(selectedAction),
                    onCancel: () => setSelected(null),
                  } : undefined}
                  onSelect={(kind, id) => {
                    if (kind === "edge" && buildMode === "move-ship" && !movingShipId) {
                      setMovingShipId(id);
                      setSelected(null);
                      return;
                    }
                    setSelected({ kind, id });
                    setError("");
                  }}
                />
                {error && mobileView === "board" && (
                  <p
                    role="alert"
                    className="board-error text-sm text-clay lg:hidden"
                  >
                    {errorText}
                  </p>
                )}
              </div>
            </section>

            <section
              aria-label={translateText("Players and awards")}
              className={`table-players space-y-3 lg:hidden ${mobileView !== "players" ? "hidden" : ""}`}
            >
              {playerCards()}
            </section>
            <aside
              className="table-hand min-w-0 flex"
              aria-label={translateText("Your hand and actions")}
            >
              <div className="hand-content" role="region" aria-label={translateText("Your cards")}>
              <section inert={handTaskOpen} className="hand-resources" aria-label={translateText("Private resources")}>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h2 className="eyebrow min-w-0 truncate">{translateText("{name}'s hand", { name: viewer.name })}</h2>
                  <div className="flex shrink-0 items-center gap-2">
                    <strong className={`rounded-md px-2 py-1 text-sm text-ink tabular-nums ${resourceTotal(viewer.resources) > 7 ? "card-count-at-risk bg-clay/30" : "bg-moss"}`}>
                      {translateText("{count} cards", { count: resourceTotal(viewer.resources) })}
                    </strong>
                    <span
                      role="img"
                      aria-label={translateText("{count} victory point cards", { count: viewerVictoryPointCards })}
                      title={translateText("{count} victory point cards", { count: viewerVictoryPointCards })}
                      className="flex items-center gap-1 rounded-md bg-moss px-2 py-1 text-sm text-ink tabular-nums"
                    >
                      <span className="text-[#947231] [&>svg]:h-4 [&>svg]:w-4"><DevelopmentCardIcon kind="victory-point" /></span>
                      <strong className="font-semibold">{viewerVictoryPointCards}</strong>
                    </span>
                  </div>
                </div>
                <div className="grid grid-cols-5 gap-1.5 sm:gap-2">
                  {RESOURCES.map((resource) => (
                    <div
                      className="relative"
                      key={resource}
                      title={translateText("{count} {resource}", { count: viewer.resources[resource], resource: resourceName(language, resource) })}
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
                            aria-label={translateText("Received {count} {resource}", { count: receivedResources![resource], resource: resourceName(language, resource) })}
                            className="absolute -bottom-2 left-1/2 -translate-x-1/2 rounded-full border-2 border-paper bg-forest px-2 py-0.5 text-xs font-bold text-ink shadow-sm"
                          >
                            +{receivedResources![resource]}
                          </span>
                          </>
                        )}
                      </div>
                      <span className="sr-only">
                        {translateText("{count} {resource}", { count: viewer.resources[resource], resource: resourceName(language, resource) })}
                      </span>
                    </div>
                  ))}
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
                    {translateText("Choose a player to steal from")}
                  </h2>
                  <TheftChoices
                    players={game.phase.victimIds.map(playerId => {
                      const victim = game.players.find(player => player.id === playerId)!;
                      return { id: victim.id, name: victim.name, color: victim.color, number: game.players.indexOf(victim) + 1, resourceCount: resourceTotal(victim.resources) };
                    })}
                    onSelect={playerId => {
                      const victim = game.players.find(player => player.id === playerId)!;
                      setConfirmation({
                        action: { type: "steal", playerId },
                        title: "Confirm theft",
                        description: resourceTotal(victim.resources) > 0
                          ? "Steal one random resource from {name}."
                          : "{name} has no resources. Finish without taking a card.",
                        parameters: { name: victim.name },
                      });
                    }}
                  />
                </section>
              )}
              {game.phase.type === "road-building" &&
                isActive &&
                legalRoadEdges(game, viewer.id).length + legalShipEdges(game, viewer.id).length === 0 && (
                  <button
                    className="button-secondary mt-4 w-full"
                    onClick={() => perform({ type: "skip-roads" })}
                  >
                    {translateText("Finish road building")}
                  </button>
                )}
              {game.phase.type === "gold" && getController(game) === viewer.id && !rollBusy && <GoldSelection
                key={`${viewer.id}-${JSON.stringify(game.phase.required)}`} bank={game.bank} count={game.phase.required[viewer.id]!}
                onSubmit={resources => perform({ type: "choose-gold", resources })} />}

              <CollapsibleSection
                title={translateText("Build a little bigger")}
                className="hand-building"
                inert={handTaskOpen}
                open={buildSectionOpen}
                onToggle={setBuildSectionOpen}
              >
                <div className="build-options flex flex-col gap-2">
                  {(["road", ...(isSeafarers(game.variant) ? ["ship" as const] : []), "settlement", "city"] as const).map((piece) => {
                    const locations =
                      piece === "road"
                        ? legalRoadEdges(game, viewer.id)
                        : piece === "ship" ? legalShipEdges(game, viewer.id) : piece === "city"
                          ? legalCityVertices(game, viewer.id)
                          : legalSettlementVertices(game, viewer.id);
                    const explanation = piece === "road" ? roadUnavailable : piece === "ship" ? shipUnavailable : piece === "settlement" ? settlementUnavailable : piece === "city" ? cityUnavailable : null;
                    const unavailable = explanation ?? (!normalActions
                      ? translateText("Available after rolling on your turn.")
                      : !canAfford(COSTS[piece])
                        ? translateText("You need more resources.")
                        : !locations.length
                          ? translateText("No legal position or no pieces remaining.")
                          : translateText("Select a location on the board."));
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
                          aria-describedby={explanation ? `${piece}-build-explanation` : undefined}
                          onClick={() => {
                            setBuildMode(buildMode === piece ? null : piece);
                            setSelected(null);
                            setMovingShipId(null);
                            setMobileView("board");
                          }}
                        />
                        {explanation && (
                          <p id={`${piece}-build-explanation`} className="-mt-1 rounded-lg bg-moss/60 px-3 py-2 text-xs leading-5 text-ink">
                            {explanation}
                          </p>
                        )}
                      </Fragment>
                    );
                  })}
                  {isSeafarers(game.variant) && <button className="button-secondary w-full"
                    disabled={!normalActions || !movableShipEdges(game, viewer.id).some(id => legalShipDestinations(game, viewer.id, id).length)}
                    aria-pressed={buildMode === "move-ship"} onClick={() => {
                      setBuildMode(buildMode === "move-ship" ? null : "move-ship");
                      setMovingShipId(null);
                      setSelected(null);
                      setMobileView("board");
                    }}>{translateText("Move ship")}</button>}
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
                  {translateText("Building needs resources, an available piece, and a legal connection after your roll.")}
                </p>
                <button
                  className="button-secondary mt-2 w-full px-2"
                  disabled={!normalActions}
                  onClick={() => {
                    setDialog("trade");
                    setError("");
                  }}
                >
                  {translateText("Make a trade")}
                </button>
              </CollapsibleSection>
              <DevelopmentHand
                variant={game.variant}
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
                <section className="hand-task panel p-4" aria-label={translateText("Open trade")}>
                  <ResourceInventory resources={viewer.resources} />
                  <h2 className="font-serif text-xl">{translateText(game.trade.give ? "Trade offer" : "Trade request")}</h2>
                  <OpenTrade
                    trade={game.trade}
                    viewer={viewer}
                    players={game.players}
                    chosenResources={chosenResources}
                    onChangeResources={setChosenResources}
                    onComplete={(playerId, price) => setConfirmation({
                      action: { type: "complete-trade", playerId },
                      title: "Trade with {name}",
                      parameters: { name: game.players.find(player => player.id === playerId)!.name },
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
                      {translateText("Return to {name}", { name: controllingPlayer.name })}
                    </button>
                  )}
                </section>
              )}
              {!game.trade && needsHandoff && controllingPlayer?.control === "human" && viewer.id !== controllingPlayer.id && (
                <button
                  className="button-secondary mt-4 w-full"
                  onClick={() => passTo(controllingPlayer.id)}
                >
                  {translateText("Return to {name}", { name: controllingPlayer.name })}
                </button>
              )}
              {error && !dialog && !confirmation && (
                <p
                  role="alert"
                  className="mt-4 rounded-xl border border-clay/30 bg-clay/5 p-3 text-sm text-clay"
                >
                  {errorText}
                </p>
              )}
              </div>
              <div className="hand-dice" role="region" aria-label={translateText("Turn controls")}>
                <div ref={setPrivateNoticeTarget} className="private-notice-anchor" />
                <div className="turn-header">
                  <h2 className="turn-owner">
                    <span className="truncate" title={activePlayer?.name}>{activePlayer?.name}</span>
                    <span className="shrink-0 text-xs font-medium text-muted"> - {translateText(isActive ? "Your turn" : "Their turn")}</span>
                  </h2>
                  <span className="turn-number">
                    {game.phase.type.startsWith("setup") ? translateText("Setup") : translateText("Turn {number}", { number: game.turnNumber })}
                  </span>
                  {!game.winnerId && gameMenu}
                </div>
                <div className="roll-summary-hand hidden lg:block">
                  <RollSummary seafarers={isSeafarers(game.variant)} outcome={rollPresentation?.outcome} stage={rollPresentation?.stage} viewerId={viewer.id} />
                </div>
                <TurnInstructions
                  title={instructionTitle}
                  description={computerPlayer && !rollBusy ? translateText(game.trade
                    ? "{name} is considering the trade."
                    : game.phase.type === "discard"
                      ? "{name} is discarding resources."
                      : "{name} is playing automatically.", { name: computerPlayer.name }) : instructionDescription}
                  computerActivity={Boolean(computerPlayer)}
                  onCancelKnight={canCancelKnight ? () => perform({ type: "cancel-knight" }) : undefined}
                />
                <div className="turn-action">
                  <button
                    className="button-primary h-11 min-w-0 px-2 py-0"
                    onClick={() => perform({ type: "roll" })}
                    disabled={game.phase.type !== "roll" || !isActive || rollBusy || handTaskOpen}
                  >
                    {translateText("Roll the dice")}
                  </button>
                  <button
                    className="button-secondary h-11 min-w-0 px-2 py-0 text-xs leading-4"
                    onClick={() => perform({ type: "end-turn" })}
                    disabled={!normalActions || handTaskOpen}
                  >
                    {translateText(needsHandoff ? "End turn & pass device" : "End turn")}
                  </button>
                </div>
              </div>
            </aside>
          </div>
          {winner && winnerScore && !victoryDismissed && (
            <VictoryDialog
              eyebrow={gameMapSeed
                ? translateText("The island {code} has a new legend", { code: gameMapSeed })
                : translateText("The island has a new legend")}
              headline={translateText("{name} takes the island.", { name: winner.name })}
              winnerName={winner.name}
              winnerColor={winner.color}
              totalPoints={winnerScore.total}
              pointsUnit={translateText("points")}
              summary={translateText("{points} points. Countless good deals. One more game?", { points: victoryTarget(game.variant) })}
              breakdown={[
                { kind: "settlements", label: translateText("Settlements"), note: winnerScore.settlements ? translateText("{count} × {points} VP", { count: winnerScore.settlements, points: 1 }) : undefined, points: winnerScore.settlements },
                { kind: "cities", label: translateText("Cities"), note: winnerScore.cities ? translateText("{count} × {points} VP", { count: winnerScore.cities / 2, points: 2 }) : undefined, points: winnerScore.cities },
                { kind: "longest-road", label: translateText(isSeafarers(game.variant) ? "Longest Route" : "Longest Road"), points: winnerScore.longestRoad },
                { kind: "largest-army", label: translateText("Largest Army"), points: winnerScore.largestArmy },
                ...(game.variant === "seafarers" || game.variant === "four-islands" ? [{ kind: "islands" as const, label: translateText("Island bonuses"), note: winnerScore.islands ? translateText("{count} × {points} VP", { count: winnerScore.islands / 2, points: 2 }) : undefined, points: winnerScore.islands ?? 0 }] : []),
                { kind: "victory-point-cards", label: translateText("Revealed victory-point cards"), note: winnerScore.hidden ? translateText("{count} × {points} VP", { count: winnerScore.hidden, points: 1 }) : undefined, points: winnerScore.hidden },
              ]}
              profileNote={humanCount === 1 && playerProfile && winner.control === "human"
                ? translateText("Player history: {games} games / {wins} wins / {points} total points", profileStats(playerProfile))
                : undefined}
              mapCode={gameMapSeed ?? undefined}
            >
              <button className="button-secondary" onClick={returnToTable}>
                {translateText("Back to home")}
              </button>
              <button className="button-secondary" onClick={() => setVictoryDismissed(true)}>
                {translateText("View the island")}
              </button>
              <button className="button-primary" onClick={restartGame}>
                {translateText("Restart")} <Arrow />
              </button>
            </VictoryDialog>
          )}
        </main>
      ) : (
        <main className="computer-table">
          <h1 className="font-serif text-3xl">{translateText("The island is in motion.")}</h1>
          <p role="status" aria-label={translateText("Computer activity")} className="my-5 text-sm text-muted">
            {translateText("{name} is playing automatically. The next human hand will stay hidden until revealed.", { name: computerPlayer?.name ?? "" })}
          </p>
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">{playerCards()}</div>
          {game.trade && (
            <section className="panel mb-5 p-4" aria-label={translateText("Open trade")}>
              <h2 className="mb-3 font-serif text-xl">{translateText("Trade request")}</h2>
              <button className="button-primary" onClick={() => setDialog("players")}>
                {translateText("Pass device")}
              </button>
            </section>
          )}
          <div className="table-feedback">
            <RollSummary seafarers={isSeafarers(game.variant)} outcome={rollPresentation?.outcome} stage={rollPresentation?.stage} />
            <BankSupply resources={game.bank} developmentCards={game.developmentDeck.length} />
          </div>
          <Board board={game.board} fogRevealHistory={fogRevealHistory} players={game.players} robberTileId={game.robberTileId} pirateTileId={game.pirateTileId} showBlockedSettlementLocations={showBlockedSettlementLocations} fillBoardWithWater={fillBoardWithWater} producingTileIds={producingTileIds} rolledNumber={rolledNumber} onChangeTheme={() => setDialog("theme")} interactive={false} compact fit victoryTarget={victoryTarget(game.variant)} />
          {error && <p role="alert" className="mt-4 text-sm text-clay">{errorText}</p>}
        </main>
      )}


      {dialog === "theme" && (
        <Dialog title={translateText("Choose your theme")} onClose={() => setDialog(null)} wide>
          <ThemeSelector value={boardThemeId} onChange={setBoardThemeId} />
          <p className="mt-5 text-xs leading-5 text-muted">
            {translateText("Changes apply immediately to the board and resource artwork. Resource names and rules stay the same. Your choice is saved in this browser when storage is available; games are not saved.")}
          </p>
        </Dialog>
      )}

      {dialog === "settings" && <BoardSettingsDialog {...boardSettings} onClose={() => setDialog(null)} />}
      {dialog === "help" && <HelpDialog variant={game?.variant ?? variant} onClose={() => setDialog(null)} />}
      {dialog === "scan" && !game && <ScanToJoin onClose={() => setDialog(null)} />}
      {game && !game.winnerId && <PrivateNotices key={gameInstanceId} thefts={game.thefts} monopolies={game.monopolies} playerId={viewer?.id ?? null} players={game.players} target={privateNoticeTarget} />}
      {dialog === "players" && game && needsHandoff && (
        <Dialog title={translateText("Pass the device")} onClose={() => setDialog(null)}>
          <p className="mb-5 text-sm leading-6 text-muted">
            {translateText("Choose whose hand to open. The next screen hides all private cards until that player is ready.")}
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
      {(dialog === "restart" || dialog === "reset") && (
        <Dialog title={translateText(dialog === "reset" ? "Reset this game?" : "Leave this island?")} onClose={() => setDialog(null)}>
          <p className="text-sm leading-7 text-muted">
            {translateText(dialog === "reset"
              ? "Restart from the first settlement on the same island with the same players. All current progress will be lost."
              : "This ends the current game for everyone. Hands, settlements, and progress are not saved.")}
          </p>
          <div className="mt-6 flex justify-end gap-3">
            <button
              className="button-secondary"
              onClick={() => setDialog(null)}
            >
              {translateText("Keep playing")}
            </button>
            <button
              className="button-primary"
              onClick={() => {
                if (dialog === "reset") {
                  restartGame();
                  return;
                }
                setGame(null);
                setRollPresentation(null);
                setResourceReceipt(null);
                setViewerId(null);
                setHandoffTarget(null);
                setDialog(null);
                setError("");
              }}
            >
              {translateText(dialog === "reset" ? "Reset game" : "End game")}
            </button>
          </div>
        </Dialog>
      )}
      {confirmation && (
        <ActionConfirmation
          title={translateText(confirmation.title, confirmation.parameters)}
          player={viewer ? { name: viewer.name, color: viewer.color } : undefined}
          description={confirmation.description && translateText(confirmation.description, confirmation.parameters)}
          exchange={confirmation.exchange}
          resources={viewer && confirmation.action.type !== "steal" ? viewer.resources : undefined}
          error={errorText}
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
          error={errorText}
          onClose={() => {
            setDialog(null);
            setError("");
          }}
          onSubmit={perform}
        />
      )}
      {dialog === "development" && game && viewer && (
        <DevelopmentDialog
          variant={game.variant}
          player={viewer}
          bank={game.bank}
          turnNumber={game.turnNumber}
          phaseType={game.phase.type}
          developmentPlayed={game.developmentPlayed}
          active={isActive}
          disabled={rollBusy}
          initialCardId={developmentCardId}
          error={errorText}
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
