import { useEffect, useEffectEvent, useState } from "react";
import { match } from "ts-pattern";
import { Board } from "./components/Board";
import { RollSummary, type RollStage } from "./components/RollSummary";
import { ResourceCollection, type ResourceReceipt } from "./components/ResourceCollection";
import {
  Arrow,
  CardStack,
  Cost,
  Dialog,
  Logo,
  RESOURCE_COLORS,
  RESOURCE_NAMES,
  ResourceCard,
  ResourceCardStepper,
  ResourceIcon,
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
const DEVELOPMENT_NAMES: Record<DevelopmentKind, string> = {
  knight: "Knight",
  "victory-point": "Victory point",
  "road-building": "Road building",
  "year-of-plenty": "Year of plenty",
  monopoly: "Monopoly",
};
const DEVELOPMENT_DESCRIPTIONS: Record<DevelopmentKind, string> = {
  knight:
    "Move the robber and steal one random resource from an adjacent opponent. Three knights can earn Largest Army.",
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
    .with({ type: "robber" }, () => "The robber is on the move.")
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
      () =>
        "Select a different hex. The robber stops that hex from producing until it moves again.",
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
  const [preview, setPreview] = useState(() => createBoard());
  const [names, setNames] = useState(["Alex", "Sam", "Jordan", "Robin"]);
  const [playerCount, setPlayerCount] = useState(3);
  const [humanCount, setHumanCount] = useState(1);
  const [game, setGame] = useState<GameState | null>(null);
  const [rollPresentation, setRollPresentation] = useState<RollPresentation | null>(null);
  const [resourceReceipt, setResourceReceipt] = useState<ResourceReceipt | null>(null);
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const rollBusy = Boolean(rollPresentation && rollPresentation.stage !== "complete");
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [handoffTarget, setHandoffTarget] = useState<string | null>(null);
  const [dialog, setDialog] = useState<
    "rules" | "trade" | "development" | "players" | "restart" | null
  >(null);
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
    description: string;
  } | null>(null);
  const [error, setError] = useState("");
  const [tradeMode, setTradeMode] = useState<"bank" | "players">("bank");
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

  function startGame() {
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
      const next = createGame(profiles);
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
    setDialog(null);
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
        setDialog(null);
        setConfirmation(null);
      }
    }
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
  const producingTileIds = rollPresentation && rollPresentation.stage !== "rolling"
    ? rollPresentation.outcome.producingTileIds : [];
  const receivedResources = resourceReceipt?.playerId === viewerId ? resourceReceipt?.gains : undefined;
  const awaitingViewer = viewer && (
    viewer.id === controllingPlayer?.id ||
    (game?.phase.type === "discard" && (game.phase.required[viewer.id] ?? 0) > 0)
  );
  const instructionTitle = rollBusy ? "Let the island provide." : game && awaitingViewer
    ? phaseTitle(game)
    : "The island is in motion.";
  const instructionDescription = rollBusy
    ? "Follow the dice, the producing hexes, and the resources arriving in your hand."
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

  function playerCards(detailed = false) {
    if (!game) return null;
    return game.players.map((player, index) => {
      const score = getScore(game, player.id);
      return (
        <div
          key={player.id}
          className={`min-w-0 rounded-xl border px-4 py-3 ${game.activePlayerId === player.id ? "border-forest/40 bg-moss/80" : "border-line bg-white/30"}`}
        >
          <div className="flex items-center gap-2.5">
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
              style={{ background: player.color }}
            >
              {index + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{player.name}</p>
              <p className="mt-0.5 text-[10px] text-muted">
                {player.control === "computer" && "AI / "}
                {game.activePlayerId === player.id
                  ? "At the helm"
                  : `Player ${index + 1}`}
              </p>
            </div>
            <div className="text-right">
              <span className="font-serif text-2xl">
                {game.winnerId ? score.total : score.public}
              </span>
              <span className="ml-1 text-[9px] text-muted">VP</span>
            </div>
          </div>
          {detailed && (
            <>
              <div className="mt-4 flex justify-between text-xs text-muted">
                <span>{resourceTotal(player.resources)} resources</span>
                <span>{player.developmentCards.length} development</span>
              </div>
              <div className="mt-3 border-t border-line pt-3 text-xs leading-6">
                <p>
                  {getLongestRoadLength(game, player.id)} connected roads{" "}
                  {game.awards.longestRoad === player.id && (
                    <strong className="text-forest"> / Longest Road +2</strong>
                  )}
                </p>
                <p>
                  {player.knightsPlayed} knights played{" "}
                  {game.awards.largestArmy === player.id && (
                    <strong className="text-forest"> / Largest Army +2</strong>
                  )}
                </p>
              </div>
            </>
          )}
        </div>
      );
    });
  }

  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-[1600px] items-center justify-between gap-4 border-b border-line px-5 py-5 sm:px-9 lg:px-12">
        <Logo />
        <div className="hidden items-center gap-2 text-[10px] font-semibold uppercase tracking-[.16em] text-muted sm:flex">
          <span className="h-1.5 w-1.5 rounded-full bg-forest" />
          {game ? "A little friendly competition" : "Made for gathering around"}
        </div>
        <button
          className="text-xs font-semibold underline decoration-line underline-offset-4 hover:decoration-forest"
          onClick={() => {
            setDialog("rules");
            setError("");
          }}
        >
          How to play{" "}
          <span className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full border border-line font-serif">
            ?
          </span>
        </button>
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
                Endless <span className="italic text-forest">possibility.</span>
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
                <button
                  className="button-primary mt-5 w-full justify-between"
                  onClick={startGame}
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
            <button className="button-primary" onClick={startGame}>
              Play a rematch <Arrow />
            </button>
          </div>
        </main>
      ) : !viewer && handoffPlayer ? (
        <main className="mx-auto grid max-w-6xl items-center gap-8 px-5 py-12 lg:grid-cols-2">
          <div className="order-2 opacity-75 lg:order-1">
            <Board
              board={game.board}
              players={game.players}
              robberTileId={game.robberTileId}
              interactive={false}
              compact
            />
          </div>
          <section className="order-1 text-center lg:order-2">
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
        <main className="mx-auto max-w-[1600px] px-4 pb-10 pt-6 sm:px-9 lg:px-12">
          <div className="mb-5 flex items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="eyebrow">Your island, taking shape</span>
              <span className="rounded-full border border-line px-2.5 py-1 text-[10px] text-muted">
                {game.phase.type.startsWith("setup")
                  ? "Founding the island"
                  : `Turn ${game.turnNumber}`}
              </span>
            </div>
            <div className="flex gap-3">
              {needsHandoff && (
                <button
                  className="min-h-10 text-xs font-semibold text-muted"
                  disabled={rollBusy}
                  onClick={() => setDialog("players")}
                >
                  Pass device
                </button>
              )}
              <button
                className="min-h-10 text-xs text-muted"
                onClick={() => setDialog("restart")}
              >
                End game
              </button>
            </div>
          </div>
          {computerPlayer && (
            <p
              role="status"
              aria-label="Computer activity"
              className="mb-5 rounded-xl bg-moss px-4 py-3 text-xs text-forest"
            >
              {computerPlayer.name}{" "}
              {game.trade
                ? "is considering the trade."
                : game.phase.type === "discard"
                  ? "is discarding resources."
                  : "is playing automatically."}
            </p>
          )}
          <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
            {playerCards()}
          </div>
          <nav
            className="mb-5 flex rounded-xl border border-line p-1 lg:hidden"
            aria-label="Game views"
          >
            {(["hand", "board", "players"] as const).map((view) => (
              <button
                key={view}
                aria-pressed={mobileView === view}
                className={`min-h-11 flex-1 rounded-lg text-sm capitalize ${mobileView === view ? "bg-forest text-white" : "text-muted"}`}
                onClick={() => setMobileView(view)}
              >
                {view}
              </button>
            ))}
          </nav>
          <RollSummary outcome={rollPresentation?.outcome} stage={rollPresentation?.stage} viewerId={viewer.id} />
          <ResourceCollection
            receipt={resourceReceipt?.playerId === viewer.id ? resourceReceipt : null}
            onDismiss={() => setResourceReceipt(null)}
          />
          <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_350px] xl:gap-9">
            <section
              className={`min-w-0 ${mobileView !== "board" ? "hidden lg:block" : ""}`}
              aria-label="Game board"
            >
              <div className="mb-4 lg:hidden">
                <h1 className="font-serif text-2xl">{instructionTitle}</h1>
                <p className="mt-2 text-xs leading-6 text-muted">
                  {instructionDescription}
                </p>
              </div>
              <div className="relative rounded-2xl border border-line bg-[#eeeee3]/60 p-2 sm:p-4">
                <div className="flex items-center justify-between px-2 pt-2">
                  <span className="eyebrow">The island</span>
                  <span className="text-[10px] text-muted">
                    Standard island / {game.players.length} settlers
                  </span>
                </div>
                <Board
                  board={game.board}
                  players={game.players}
                  robberTileId={game.robberTileId}
                  producingTileIds={producingTileIds}
                  legalVertexIds={legalVertices}
                  legalEdgeIds={legalEdges}
                  legalTileIds={legalTiles}
                  selectedId={selected?.id}
                  onSelect={(kind, id) => {
                    setSelected({ kind, id });
                    setError("");
                  }}
                />
                {selectedAction && selected ? (
                  <div
                    className="mx-2 mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-forest/30 bg-paper p-4"
                    aria-live="polite"
                  >
                    <div>
                      <p className="text-sm font-semibold">
                        {selected.kind === "tile"
                          ? "Move the robber here?"
                          : selected.kind === "edge"
                            ? "Build a road here?"
                            : buildMode === "city"
                              ? "Upgrade to a city?"
                              : "Settle here?"}
                      </p>
                      <p className="mt-1 text-xs text-muted">
                        Your choice is only a preview until confirmed.
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        className="button-secondary"
                        onClick={() => setSelected(null)}
                      >
                        Cancel
                      </button>
                      <button
                        className="button-primary"
                        onClick={() => perform(selectedAction)}
                      >
                        Confirm placement
                      </button>
                    </div>
                  </div>
                ) : (
                  (legalVertices.length > 0 ||
                    legalEdges.length > 0 ||
                    legalTiles.length > 0) && (
                    <p className="mb-4 text-center text-xs text-forest">
                      Select a highlighted{" "}
                      {legalVertices.length
                        ? "intersection"
                        : legalEdges.length
                          ? "road"
                          : "hex"}{" "}
                      to preview your move.
                    </p>
                  )
                )}
                {error && mobileView === "board" && (
                  <p
                    role="alert"
                    className="mx-2 mb-4 text-sm text-clay lg:hidden"
                  >
                    {error}
                  </p>
                )}
                <div className="mx-2 mb-2 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
                  <span className="eyebrow">The bank</span>
                  <div className="flex gap-3 sm:gap-5">
                    {RESOURCES.map((resource) => (
                      <span
                        key={resource}
                        className="flex items-center gap-1.5 text-xs"
                        title={`${RESOURCE_NAMES[resource]} in bank`}
                      >
                        <span style={{ color: RESOURCE_COLORS[resource] }}>
                          <ResourceIcon
                            resource={resource}
                            className="h-4 w-4"
                          />
                        </span>
                        <span className="sr-only">
                          {RESOURCE_NAMES[resource]}:
                        </span>
                        {game.bank[resource]}
                      </span>
                    ))}
                  </div>
                  <span className="text-[10px] text-muted">
                    {game.developmentDeck.length} development cards
                  </span>
                </div>
              </div>
              <div className="mt-5 grid gap-5 sm:grid-cols-2">
                <section className="panel p-5">
                  <h2 className="eyebrow mb-4">A little investment</h2>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                    {(
                      ["road", "settlement", "city", "development"] as const
                    ).map((piece) => (
                      <div
                        key={piece}
                        className="flex flex-wrap items-center justify-between gap-1"
                      >
                        <span className="text-xs capitalize">{piece}</span>
                        <Cost resources={COSTS[piece]} />
                      </div>
                    ))}
                  </div>
                </section>
                <section className="panel p-5">
                  <h2 className="eyebrow mb-3">Island stories</h2>
                  <ol aria-label="Public activity" className="space-y-2">
                    {game.log
                      .slice(-3)
                      .reverse()
                      .map((entry, index) => (
                        <li
                          key={`${game.log.length}-${index}`}
                          className="text-xs leading-5 text-muted"
                        >
                          {entry}
                        </li>
                      ))}
                  </ol>
                </section>
              </div>
            </section>

            <aside
              className={`min-w-0 ${mobileView !== "hand" ? "hidden lg:block" : ""}`}
              aria-label="Your hand and actions"
            >
              <div className="rounded-2xl bg-forest p-5 text-white">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-semibold uppercase tracking-[.17em] text-white/60">
                    {isActive ? "Your turn" : `${activePlayer?.name}'s turn`}
                  </p>
                  {game.dice && !rollPresentation && (
                    <div aria-label={`Dice: ${game.dice[0]} and ${game.dice[1]}`} className="flex gap-1.5">
                      {game.dice.map((value, index) => (
                        <span key={index} className="flex h-7 w-7 items-center justify-center rounded-md bg-paper font-serif text-lg font-bold text-ink">
                          {value}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <h1 className="mt-3 font-serif text-[28px] leading-tight">
                  {instructionTitle}
                </h1>
                <p className="mt-3 text-xs leading-6 text-white/75">
                  {instructionDescription}
                </p>
                {game.phase.type === "roll" && isActive && (
                  <button
                    className="mt-5 flex min-h-12 w-full items-center justify-between rounded-xl bg-paper px-4 text-sm font-semibold text-forest hover:bg-white"
                    onClick={() => perform({ type: "roll" })}
                    disabled={rollBusy}
                  >
                    Roll the dice <Arrow />
                  </button>
                )}
                {game.phase.type === "actions" && isActive && (
                  <button
                    className="mt-5 w-full rounded-xl border border-white/25 py-3 text-xs font-semibold hover:bg-white/10"
                    onClick={() => perform({ type: "end-turn" })}
                    disabled={rollBusy}
                  >
                    {needsHandoff ? "End turn & pass device" : "End turn"}{" "}
                    <span aria-hidden="true">&rarr;</span>
                  </button>
                )}
              </div>

              <section className="mt-5" aria-label="Private resources">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="eyebrow">{viewer.name}&apos;s hand</h2>
                  <span className="text-[10px] text-muted">
                    Only for your eyes / {resourceTotal(viewer.resources)} cards
                  </span>
                </div>
                <div className="grid grid-cols-5 gap-1.5 sm:gap-2">
                  {RESOURCES.map((resource) => (
                    <div
                      className={`relative ${viewer.resources[resource] ? "" : "opacity-40"}`}
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
                          className="aspect-[3/4] w-full"
                        />
                        {(receivedResources?.[resource] ?? 0) > 0 && (
                          <span
                            aria-label={`Received ${receivedResources![resource]} ${RESOURCE_NAMES[resource]}`}
                            className="absolute -bottom-2 left-1/2 -translate-x-1/2 rounded-full border-2 border-paper bg-forest px-2 py-0.5 text-xs font-bold text-white shadow-sm"
                          >
                            +{receivedResources![resource]}
                          </span>
                        )}
                      </div>
                      <span className="sr-only">
                        {viewer.resources[resource]}{" "}
                        {RESOURCE_NAMES[resource]}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex items-center justify-between rounded-lg bg-moss/80 px-3 py-2.5">
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
                  <section className="panel mt-5 p-4">
                    <ResourceCardStepper
                      label="Return to the bank"
                      values={chosenResources}
                      maximum={viewer.resources}
                      onChange={setChosenResources}
                    />
                    <p className="mt-3 text-xs text-muted">
                      Choose exactly {game.phase.required[viewer.id]} resources.
                      Selected {resourceTotal(chosenResources)}.
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
                <section className="panel mt-5 space-y-2 p-4">
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

              <section className="mt-5">
                <h2 className="eyebrow mb-3">Build a little bigger</h2>
                <div className="space-y-2">
                  {(["road", "settlement", "city"] as const).map((piece) => {
                    const locations =
                      piece === "road"
                        ? legalRoadEdges(game, viewer.id)
                        : piece === "city"
                          ? legalCityVertices(game, viewer.id)
                          : legalSettlementVertices(game, viewer.id);
                    const unavailable = !normalActions
                      ? "Available after rolling on your turn."
                      : !canAfford(COSTS[piece])
                        ? "You need more resources."
                        : !locations.length
                          ? "No legal position or no pieces remaining."
                          : "Select a location on the board.";
                    return (
                      <button
                        key={piece}
                        title={unavailable}
                        disabled={
                          !normalActions ||
                          !canAfford(COSTS[piece]) ||
                          !locations.length
                        }
                        aria-pressed={buildMode === piece}
                        className={`flex min-h-14 w-full items-center justify-between rounded-xl border px-4 text-sm ${buildMode === piece ? "border-forest bg-moss" : "border-line bg-white/40"}`}
                        onClick={() => {
                          setBuildMode(buildMode === piece ? null : piece);
                          setSelected(null);
                          setMobileView("board");
                        }}
                      >
                        <span className="capitalize">
                          {piece === "city"
                            ? "Upgrade to city"
                            : `Build ${piece}`}
                        </span>
                        <Cost resources={COSTS[piece]} />
                      </button>
                    );
                  })}
                </div>
                <p className="mt-2 text-[10px] leading-5 text-muted">
                  Building needs resources, an available piece, and a legal
                  connection after your roll.
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    className="button-secondary px-2"
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
                  <button
                    className="button-secondary px-2"
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
                    Buy a card
                  </button>
                </div>
              </section>
              <button
                className="panel mt-4 flex min-h-14 w-full items-center justify-between px-4 text-left"
                onClick={() => {
                  setDevelopmentCardId(null);
                  setDialog("development");
                  setError("");
                }}
              >
                <span className="text-xs font-medium">
                  Your development cards
                </span>
                <span className="flex items-center gap-3">
                  <span className="rounded-md bg-moss px-2 py-1 text-xs">
                    {viewer.developmentCards.length}
                  </span>
                  <Arrow />
                </span>
              </button>

              {game.trade && (
                <section className="panel mt-5 p-4" aria-label="Open trade">
                  <h2 className="font-serif text-xl">A deal on the table.</h2>
                  <p className="sr-only">
                    {game.players.find(
                      (player) => player.id === game.trade!.offeredBy,
                    )?.name}{" "}
                    offers{" "}
                    {RESOURCES.filter(
                      (resource) => game.trade!.give[resource] > 0,
                    )
                      .map(
                        (resource) =>
                          `${game.trade!.give[resource]} ${RESOURCE_NAMES[resource]}`,
                      )
                      .join(", ")}{" "}
                    for{" "}
                    {RESOURCES.filter(
                      (resource) => game.trade!.receive[resource] > 0,
                    )
                      .map(
                        (resource) =>
                          `${game.trade!.receive[resource]} ${RESOURCE_NAMES[resource]}`,
                      )
                      .join(", ")}
                    .
                  </p>
                  <div className="my-4 flex items-center justify-center gap-4 rounded-xl bg-moss/70 p-3.5">
                    <span className="flex flex-col items-center gap-1.5">
                      <CardStack
                        resources={game.trade.give}
                        emptyText="Nothing offered"
                      />
                      <span className="text-[9px] font-semibold uppercase tracking-[.15em] text-muted">
                        Offered
                      </span>
                    </span>
                    <Arrow className="h-5 w-5 shrink-0 text-forest" />
                    <span className="flex flex-col items-center gap-1.5">
                      <CardStack
                        resources={game.trade.receive}
                        emptyText="Nothing asked"
                      />
                      <span className="text-[9px] font-semibold uppercase tracking-[.15em] text-muted">
                        Wanted
                      </span>
                    </span>
                  </div>
                  {viewer.id === game.trade.offeredBy ? (
                    <div className="space-y-2">
                      {game.players
                        .filter((player) => player.id !== viewer.id)
                        .map((player) => {
                          const response =
                            game.trade!.responses[player.id];
                          const status =
                            response === true
                              ? "accepted"
                              : response === false
                                ? "declined"
                                : "not answered";
                          return (
                            <div
                              key={player.id}
                              className="flex items-center justify-between gap-2 rounded-xl border border-line bg-white/40 px-3 py-2"
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
                              <span className="flex shrink-0 items-center gap-2">
                                <span
                                  className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${response === true ? "bg-forest text-white" : response === false ? "bg-ink/10 text-muted" : "border border-line text-muted"}`}
                                >
                                  {status}
                                </span>
                                {response ? (
                                  <button
                                    className="button-secondary !min-h-8 !px-2.5 !py-1 !text-xs"
                                    onClick={() =>
                                      setConfirmation({
                                        action: {
                                          type: "complete-trade",
                                          playerId: player.id,
                                        },
                                        title: `Trade with ${player.name}`,
                                        description:
                                          "Complete this exchange once. Both players' resources will be checked again before the transfer.",
                                      })
                                    }
                                  >
                                    Complete trade
                                  </button>
                                ) : player.control === "human" ? (
                                  <button
                                    className="min-h-8 text-xs font-semibold underline"
                                    onClick={() => passTo(player.id)}
                                  >
                                    Pass to {player.name}
                                  </button>
                                ) : null}
                              </span>
                            </div>
                          );
                        })}
                      <button
                        className="mt-2 text-xs text-clay underline"
                        onClick={() => perform({ type: "cancel-trade" })}
                      >
                        Withdraw offer
                      </button>
                    </div>
                  ) : (
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
                          )
                        }
                        onClick={() =>
                          perform({ type: "respond-trade", accept: true })
                        }
                      >
                        Accept offer
                      </button>
                    </div>
                  )}
                </section>
              )}
              {needsHandoff && controllingPlayer?.control === "human" && viewer.id !== controllingPlayer.id && (
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
            </aside>
            <section
              aria-label="Players and awards"
              className={`space-y-3 lg:hidden ${mobileView !== "players" ? "hidden" : ""}`}
            >
              {playerCards(true)}
            </section>
          </div>
        </main>
      ) : (
        <main className="mx-auto max-w-5xl px-5 py-10">
          <div className="flex items-center justify-between gap-4">
            <h1 className="font-serif text-3xl">The island is in motion.</h1>
            <button className="min-h-10 text-xs text-muted" onClick={() => setDialog("restart")}>End game</button>
          </div>
          <p role="status" aria-label="Computer activity" className="my-5 text-sm text-muted">
            {computerPlayer?.name} is playing automatically. The next human hand will stay hidden until revealed.
          </p>
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">{playerCards()}</div>
          <RollSummary outcome={rollPresentation?.outcome} stage={rollPresentation?.stage} />
          <Board board={game.board} players={game.players} robberTileId={game.robberTileId} producingTileIds={producingTileIds} interactive={false} compact />
          {error && <p role="alert" className="mt-4 text-sm text-clay">{error}</p>}
        </main>
      )}

      <footer className="mx-auto flex max-w-[1440px] flex-wrap justify-between gap-3 px-5 py-6 text-[9px] uppercase tracking-[.14em] text-muted sm:px-9 lg:px-12">
        <span>A tabletop state of mind.</span>
        <span>Catania / Solo &amp; pass-and-play / Wi-Fi play coming later</span>
      </footer>

      {dialog === "rules" && (
        <Dialog
          title="A little guide to the island"
          onClose={() => setDialog(null)}
          wide
        >
          <div className="space-y-5 text-sm leading-7 text-muted">
            <p className="font-serif text-xl text-ink">
              Good neighbors. Clever trades. Ten victory points.
            </p>
            <p>
              <strong className="text-ink">Start with a home.</strong> Each
              player places a settlement and an adjoining road in order, then
              again in reverse. Your second settlement grants one resource from
              each neighboring non-desert hex. Settlements must be at least two
              edges apart.
            </p>
            <p>
              <strong className="text-ink">Let the island provide.</strong> On
              your turn, roll the dice. Matching hexes produce one resource for
              each settlement, or two for each city. A robber blocks its hex. On
              a seven, hands over seven cards discard half, rounded down; then
              move the robber and steal from an eligible neighbor.
            </p>
            <p>
              <strong className="text-ink">Trade. Build. Repeat.</strong> After
              rolling, trade with other players or the bank (4:1). A settlement
              at a generic port improves the rate to 3:1; a matching resource
              port makes it 2:1. Build roads, new settlements, cities, or buy a
              development card. Each player has 15 roads, 5 settlements, and 4
              cities.
            </p>
            <p>
              <strong className="text-ink">A card up your sleeve.</strong> Play
              at most one action development card per turn, including before
              rolling, but not on the turn you bought it. Knights move the
              robber, Road Building places two roads, Year of Plenty takes two
              bank resources, and Monopoly takes all of one resource from
              opponents. Victory-point cards count automatically, including on
              purchase.
            </p>
            <p>
              <strong className="text-ink">Make it to ten.</strong> A settlement
              is 1 point, a city 2, and a hidden victory-point card 1. Longest
              Road (at least five connected roads) and Largest Army (at least
              three played knights) are worth 2 each. Ties stay with the current
              holder. Reach 10 on your own turn to win.
            </p>
            <div className="rounded-xl bg-moss p-4">
              <strong className="text-ink">One device, a whole table.</strong>{" "}
              Play solo against local AI with your hand always visible, or choose
              multiple humans and pass the device before revealing each hand.
              Computer hands cannot be opened. AI handles its own turns and trade
              responses; it uses bank and port trades but does not propose player trades. This
              is a friendly local game, not a secure multiplayer room. Games
              live only in this tab: refreshing or closing it ends the game.
            </div>
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
          <div className="mt-6 space-y-3">{playerCards(true)}</div>
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
          onClose={() => {
            setConfirmation(null);
            setError("");
          }}
        >
          <p className="text-sm leading-7 text-muted">
            {confirmation.description}
          </p>
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
                Your best port rate is applied automatically. Dimmed cards are
                beyond your hand; the bank must have what you ask for.
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
                  You receive
                </legend>
                <div className="grid grid-cols-5 gap-2 sm:gap-3">
                  {RESOURCES.map((resource) => (
                    <SelectableResourceCard
                      key={resource}
                      resource={resource}
                      action="Receive"
                      count={game.bank[resource]}
                      caption="in bank"
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
              <button
                className="button-primary w-full"
                disabled={
                  giveResource === receiveResource ||
                  viewer.resources[giveResource] < ratio ||
                  game.bank[receiveResource] < 1
                }
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
              <div className="space-y-5">
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
                <ResourceCardStepper
                  label="You ask for"
                  values={receiveResources}
                  onChange={setReceiveResources}
                />
              </div>
              <p className="my-4 text-xs leading-6 text-muted">
                Computers respond automatically. With multiple humans, pass the
                device for private responses. Choose one accepting player to
                confirm the exchange.
              </p>
              <button
                className="button-primary w-full"
                disabled={
                  !resourceTotal(giveResources) ||
                  !resourceTotal(receiveResources) ||
                  RESOURCES.some(
                    (resource) =>
                      giveResources[resource] > 0 &&
                      receiveResources[resource] > 0,
                  )
                }
                onClick={() =>
                  perform({
                    type: "offer-trade",
                    give: giveResources,
                    receive: receiveResources,
                  })
                }
              >
                Put the offer on the table
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
          onClose={() => {
            setDialog(null);
            setError("");
          }}
        >
          {!viewer.developmentCards.length ? (
            <p className="text-sm leading-7 text-muted">
              Your next big idea is waiting. Buy a development card for one
              wool, one grain, and one ore after rolling on your turn.
            </p>
          ) : (
            <div className="space-y-3">
              {viewer.developmentCards.map((card) => (
                <button
                  key={card.id}
                  className={`w-full rounded-xl border p-4 text-left ${developmentCardId === card.id ? "border-forest bg-moss" : "border-line"}`}
                  onClick={() => {
                    setDevelopmentCardId(card.id);
                    setChosenResources(emptyResources());
                    setError("");
                  }}
                >
                  <span className="flex justify-between gap-3">
                    <span className="font-serif text-xl">
                      {DEVELOPMENT_NAMES[card.kind]}
                    </span>
                    <span className="text-[10px] text-muted">
                      {card.kind === "victory-point"
                        ? "+1 hidden point"
                        : card.purchasedTurn === game.turnNumber
                          ? "New this turn"
                          : "In your hand"}
                    </span>
                  </span>
                  <span className="mt-2 block text-xs leading-6 text-muted">
                    {DEVELOPMENT_DESCRIPTIONS[card.kind]}
                  </span>
                </button>
              ))}
            </div>
          )}
          {developmentCard && developmentCard.kind !== "victory-point" && (
            <div className="mt-5 border-t border-line pt-5">
              {developmentCard.kind === "year-of-plenty" && (
                <>
                  <ResourceCardStepper
                    label="Take from the bank"
                    values={chosenResources}
                    maximum={game.bank}
                    onChange={setChosenResources}
                  />
                  <p className="mt-3 text-xs text-muted">
                    Select {Math.min(2, resourceTotal(game.bank))} cards.
                    Selected {resourceTotal(chosenResources)}.
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
  );
}

export default App;
