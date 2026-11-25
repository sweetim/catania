import { useEffect, useRef, useState, type CSSProperties } from "react";
import QRCode from "qrcode";
import { match } from "ts-pattern";
import { DiceIcon, EndTurnIcon } from "../components/ActionIcons";
import {
  AddRobotIcon,
  CheckIcon,
  CloseIcon,
  CopyIcon,
  DiscardCardIcon,
  EyeIcon,
  GoldIcon,
  LargestArmyIcon,
  LeaveIcon,
  LinkConnectIcon,
  LongestRoadAwardIcon,
  MapFoldIcon,
  MoveShipIcon,
  QrCodeIcon,
  ReturnToLobbyIcon,
  RobberIcon,
  RobotIcon,
  TradeIcon,
  UserIcon,
  UserMinusIcon,
  WarningIcon,
} from "../components/Icons";
import { Board, VictoryTargetBadge } from "../components/Board";
import { MapSeedControls } from "../components/MapSeedControls";
import { BoardSettingsDialog, useBoardSettings } from "../components/BoardSettings";
import { GameMenu } from "../components/GameMenu";
import { HelpDialog } from "../components/HelpDialog";
import { GameVariantSelector } from "../components/GameVariantSelector";
import { GoldSelection } from "../components/SeafarersControls";
import { Arrow, BankSupply, BuildButton, Cost, DevelopmentCardIcon, Dialog, IslandIcon, Logo, PieceIcon, ResourceCard, ResourceInventory } from "../components/GameUi";
import { ActionConfirmation, DevelopmentDialog, DiscardSelection, getDevelopmentDescriptions, getDevelopmentNames, TheftChoices } from "../components/GameplayDialogs";
import { OpenTrade } from "../components/OpenTrade";
import { DisconnectedIcon, PlayerSeat } from "../components/PlayerSeat";
import { DevelopmentHand } from "../components/DevelopmentHand";
import { DiceChart, VictoryDialog, type VictoryBreakdownRow } from "../components/VictoryDialog";
import { ProfileGate } from "../components/ProfileGate";
import { activeProfile, createProfile, readProfileState, removeProfile, writeProfileState, type PlayerProfile, type ProfileState } from "../profile";
import { getPhaseInstructions, TurnInstructions } from "../components/TurnInstructions";
import { TradeDialog } from "../components/TradeDialog";
import { ThemeSelector } from "../components/ThemeSelector";
import { PrivateNotices, type SabotageNoticeEvent, type TradeOutcomeEvent } from "../components/PrivateNotices";
import { ResourceReceiptAnnouncement, type ResourceReceipt } from "../components/ResourceCollection";
import { CollapsibleSection } from "../components/CollapsibleSection";
import { CustomMapConfigPanel } from "../components/CustomMapConfigPanel";
import { COSTS, emptyResources, hasLegalSabotageTarget, legalCityVertices, legalRoadEdges, legalSettlementVertices, legalShipEdges, legalShipDestinations, movableShipEdges, RESOURCES, resourceTotal } from "../game/engine";
import { pirateStartTileId, seededRandom } from "../game/board";
import { DEFAULT_CUSTOM_MAP_CONFIG, isCustomSabotageEnabled, isSeafarers, type DevelopmentKind, type GameAction, type GameVariant, type Resources } from "../game/types";
import { formatGameMessage } from "../game/messages";
import { pieceName, resourceName, type TranslationParameters } from "../i18n";
import { useLanguage, useTranslation } from "../localization";
import { useVibrateOnIncomingTrade, useVibrateOnYourTurn } from "../vibration";
import { BOARD_THEMES, BoardThemeContext, type BoardThemeId } from "../themes";
import { multiplayerUiTranslations } from "../translations/multiplayer-ui";
import { getResourceGains } from "../resourceReceipt";
import { hostSession, joinSession } from "./session";
import { parseInvitationUrl } from "./invitation";
import { validName, type TradeIdentity } from "./protocol";
import { MultiplayerDice, SharedBoardDice, useDiceRollAnimation } from "./MultiplayerDice";
import { computeSharedRollProduction, detectCompletedTrade, detectPlayerSabotages, detectSharedPublicEvents, type SharedPublicEvent } from "./presentation";
import type { BuildMode, Invitation, MultiplayerSession, PublicGame, RoomSnapshot, SessionView } from "./types";
import "../index.css";

function PlayerList({ snapshot, removePlayer, renameComputer, disabled }: {
  snapshot: RoomSnapshot;
  removePlayer?: (playerId: string) => void;
  renameComputer?: (playerId: string, name: string) => void;
  disabled?: boolean;
}) {
  const translateText = useTranslation(multiplayerUiTranslations);
  const [editing, setEditing] = useState<{ playerId: string; name: string } | null>(null);
  const players = snapshot.game?.players ?? snapshot.players;
  const normalizedName = editing?.name.trim().normalize("NFC") ?? "";
  const existingNames = [...snapshot.players.filter(player => player.id !== editing?.playerId).map(player => player.name), ...(snapshot.pendingPlayers ?? []).map(player => player.name)];
  const nameError = !validName(editing?.name) ? translateText("Use 1 to 20 characters, without control characters.")
    : existingNames.some(name => name.toLowerCase() === normalizedName.toLowerCase()) ? translateText("That name is already in the room. Choose another name.") : "";
  return <><ul aria-label={translateText("Players")} className={`grid gap-2 ${snapshot.game ? "sm:grid-cols-2 lg:grid-cols-4" : ""}`}>
    {players.map(player => {
      const statistics = snapshot.game?.players.find(candidate => candidate.id === player.id);
      const disconnected = player.control === "human" && !player.connected;
      return <li key={player.id} data-disconnected={disconnected ? "true" : undefined} style={{ "--seat-pulse-color": disconnected ? "#bb6549" : player.color } as CSSProperties} className={`panel min-w-0 p-3 ${disconnected ? "player-seat-disconnected" : ""} ${snapshot.game?.activePlayerId === player.id ? "player-seat-active" : ""}`}>
        <div className="flex items-center gap-2">
          <span className="relative shrink-0">
            <span
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border p-1.5 ${disconnected ? "opacity-55" : ""}`}
              style={{ color: player.color, borderColor: `${player.color}66`, backgroundColor: `${player.color}14` }}
            >
              {player.control === "computer"
                ? <RobotIcon label={translateText("Computer player")} className="h-full w-full" />
                : <UserIcon label={translateText("Human player")} className="h-full w-full" />}
            </span>
            {disconnected && (
              <span aria-hidden="true" className="player-disconnected-dot">
                <DisconnectedIcon className="h-2.5 w-2.5" />
              </span>
            )}
          </span>
          <div className="min-w-0 flex-1">
            {!snapshot.game && player.control === "computer" && renameComputer
              ? <button className="min-h-11 max-w-full break-words text-left text-sm font-semibold underline decoration-line decoration-dotted underline-offset-4 disabled:opacity-50" aria-label={translateText("Rename {name}", { name: player.name })} disabled={disabled} onClick={() => setEditing({ playerId: player.id, name: player.name })}>{player.name}</button>
              : <strong className="block break-words text-sm">{player.name}</strong>}
            {player.control === "human" && (disconnected
              ? <span className="player-disconnected-pill mt-1">
                  <DisconnectedIcon className="h-3 w-3 shrink-0" />
                  <span>{translateText("Disconnected")}</span>
                </span>
              : <span className="mt-0.5 inline-flex items-center gap-1.5 text-[11px] font-medium text-[#3b6a57]">
                  <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[#497562]" />
                  {translateText("Connected")}
                </span>)}
          </div>
          {!snapshot.game && removePlayer && <button className="button-secondary shrink-0 px-2 py-2 text-xs sm:px-3" aria-label={translateText("Remove {name}", { name: player.name })} disabled={disabled} onClick={() => removePlayer(player.id)}><UserMinusIcon />{translateText("Remove")}</button>}
        </div>
        {statistics && <>
          <p className="mt-2 text-xs">{translateText("{points} points / {resources} resource cards / {development} development cards", { points: statistics.score, resources: statistics.resourceCount, development: statistics.developmentCount })}</p>
          <p className="mt-1 text-[11px] text-muted">{translateText(isSeafarers(snapshot.variant) ? "{knights} played Knights / Longest route: {roads}" : "{knights} played Knights / Longest road: {roads}", { knights: statistics.knightsPlayed, roads: statistics.longestRoad })}</p>
          <p className="text-[11px] font-semibold">
            {snapshot.game?.awards.longestRoad === player.id && translateText(isSeafarers(snapshot.variant) ? "Longest Route (+2) " : "Longest Road (+2) ")}
            {snapshot.game?.awards.largestArmy === player.id && translateText("Largest Army (+2)")}
          </p>
        </>}
      </li>;
    })}
  </ul>
    {!snapshot.game && editing && renameComputer && <Dialog title={translateText("Rename computer")} onClose={() => setEditing(null)}>
      <form className="space-y-4" onSubmit={event => {
        event.preventDefault();
        if (disabled || nameError) return;
        renameComputer(editing.playerId, normalizedName);
        setEditing(null);
      }}>
        <label className="block text-sm font-semibold">{translateText("Computer name")}<input className="field mt-2" value={editing.name} maxLength={20} autoComplete="off" aria-invalid={Boolean(nameError)} aria-describedby="computer-name-help" disabled={disabled} onChange={event => setEditing({ ...editing, name: event.target.value })} /></label>
        <p id="computer-name-help" aria-live="polite" className={`text-xs ${nameError ? "text-clay" : "text-muted"}`}>{nameError || translateText("Choose a distinct name for this computer player.")}</p>
        <div className="flex gap-3">
          <button type="button" className="button-secondary flex-1" onClick={() => setEditing(null)}>{translateText("Cancel")}</button>
          <button type="submit" className="button-primary flex-1" disabled={disabled || Boolean(nameError)}>{translateText("Save name")}</button>
        </div>
      </form>
    </Dialog>}
  </>;
}

function victoryBreakdownRows(
  breakdown: PublicGame["players"][number]["scoreBreakdown"],
  translateText: (key: keyof typeof multiplayerUiTranslations, parameters?: TranslationParameters) => string,
  variant: GameVariant,
): VictoryBreakdownRow[] {
  if (!breakdown) return [];
  return [
    { kind: "settlements", label: translateText("Settlements"), note: breakdown.settlements ? translateText("{count} × {points} VP", { count: breakdown.settlements, points: 1 }) : undefined, points: breakdown.settlements },
    { kind: "cities", label: translateText("Cities"), note: breakdown.cities ? translateText("{count} × {points} VP", { count: breakdown.cities / 2, points: 2 }) : undefined, points: breakdown.cities },
    { kind: "longest-road", label: translateText(isSeafarers(variant) ? "Longest Route" : "Longest Road"), points: breakdown.longestRoad },
    { kind: "largest-army", label: translateText("Largest Army"), points: breakdown.largestArmy },
    ...(variant === "seafarers" || variant === "four-islands" ? [{ kind: "islands" as const, label: translateText("Island bonuses"), note: breakdown.islands ? translateText("{count} × {points} VP", { count: breakdown.islands / 2, points: 2 }) : undefined, points: breakdown.islands ?? 0 }] : []),
    { kind: "victory-point-cards", label: translateText("Revealed victory-point cards"), note: breakdown.hidden ? translateText("{count} × {points} VP", { count: breakdown.hidden, points: 1 }) : undefined, points: breakdown.hidden },
  ];
}

function SharedBoardPhaseBanner({ game, buildMode }: { game: PublicGame; buildMode: BuildMode }) {
  const { language } = useLanguage();
  const translateText = useTranslation(multiplayerUiTranslations);
  if (game.winnerId || game.trade) return null;
  const activePlayer = game.players.find(player => player.id === game.activePlayerId);
  if (!activePlayer) return null;

  const waitingList = (required: Record<string, number>) => Object.entries(required)
    .map(([playerId, count]) => {
      const target = game.players.find(player => player.id === playerId);
      return target ? `${target.name} (${count})` : null;
    })
    .filter((entry): entry is string => entry !== null)
    .join(language === "ja" ? "、" : ", ");

  const label = match(game.phase)
    .with({ type: "discard" }, phase => {
      const names = waitingList(phase.required);
      return names ? translateText("Waiting for discards: {names}", { names }) : null;
    })
    .with({ type: "gold" }, phase => {
      const names = waitingList(phase.required);
      return names ? translateText("Choosing gold: {names}", { names }) : null;
    })
    .with({ type: "steal" }, () => translateText("{name} is choosing a theft target", { name: activePlayer.name }))
    .with({ type: "robber" }, () => translateText(isSeafarers(game.variant)
      ? "{name}: Move the robber or pirate"
      : "{name}: Move the robber", { name: activePlayer.name }))
    .with({ type: "road-building" }, phase => translateText(isSeafarers(game.variant)
      ? (phase.remaining === 1 ? "{name}: Place {count} free route" : "{name}: Place {count} free routes")
      : (phase.remaining === 1 ? "{name}: Place {count} free road" : "{name}: Place {count} free roads"),
    { name: activePlayer.name, count: phase.remaining }))
    .with({ type: "actions" }, () => {
      if (!buildMode) return null;
      return match(buildMode)
        .with("move-ship", () => translateText("{name}: Move a ship on the board", { name: activePlayer.name }))
        .with("sabotage", () => translateText("{name}: Choose a sabotage target", { name: activePlayer.name }))
        .with("road", "ship", "settlement", "city", piece => translateText("{name}: Place {piece} on the board", {
          name: activePlayer.name,
          piece: pieceName(language, piece),
        }))
        .exhaustive();
    })
    .otherwise(() => null);

  if (!label) return null;
  const urgent = game.phase.type === "discard" || game.phase.type === "robber" || buildMode === "sabotage";

  return (
    <div
      key={`${game.phase.type}:${buildMode ?? ""}:${label}`}
      role="status"
      aria-label={translateText("Table phase")}
      data-urgent={urgent ? "true" : undefined}
      className="shared-board-phase-banner"
    >
      <span
        aria-hidden="true"
        className="shared-board-phase-dot"
        style={{ backgroundColor: urgent && game.phase.type === "discard" ? "#bb6549" : activePlayer.color }}
      />
      <span className="truncate">{label}</span>
    </div>
  );
}

function SharedBoardEventToast({ event, variant }: { event: SharedPublicEvent | null; variant: GameVariant }) {
  const { language } = useLanguage();
  const translateText = useTranslation(multiplayerUiTranslations);
  const developmentNames = getDevelopmentNames(language);
  if (!event) return null;

  const content = match(event)
    .with({ kind: "award" }, item => {
      const text = match(item.award)
        .with("longest-road", () => item.previousHolderName
          ? translateText(isSeafarers(variant)
            ? "{name} stole Longest Route from {previous} (+2 VP)"
            : "{name} stole Longest Road from {previous} (+2 VP)", { name: item.playerName, previous: item.previousHolderName })
          : translateText(isSeafarers(variant)
            ? "{name} claimed Longest Route (+2 VP)"
            : "{name} claimed Longest Road (+2 VP)", { name: item.playerName }))
        .with("largest-army", () => item.previousHolderName
          ? translateText("{name} stole Largest Army from {previous} (+2 VP)", { name: item.playerName, previous: item.previousHolderName })
          : translateText("{name} claimed Largest Army (+2 VP)", { name: item.playerName }))
        .with("islands", () => translateText("{name} earned an Island Bonus (+2 VP)", { name: item.playerName }))
        .exhaustive();
      const icon = match(item.award)
        .with("longest-road", () => <span className="text-[#b58a2d] [&>svg]:h-4 [&>svg]:w-4"><LongestRoadAwardIcon /></span>)
        .with("largest-army", () => <span className="text-[#b58a2d] [&>svg]:h-4 [&>svg]:w-4"><LargestArmyIcon /></span>)
        .with("islands", () => <span className="text-[#b58a2d]"><IslandIcon /></span>)
        .exhaustive();
      return { text, icon, accentColor: item.playerColor, tone: "award" as const };
    })
    .with({ kind: "development" }, item => ({
      text: translateText("{name} played {card}", { name: item.playerName, card: developmentNames[item.cardKind] }),
      icon: <span className="text-ink [&>svg]:h-4 [&>svg]:w-4"><DevelopmentCardIcon kind={item.cardKind} /></span>,
      accentColor: item.playerColor,
      tone: "event" as const,
    }))
    .with({ kind: "robbery" }, item => ({
      text: translateText(item.emptyHand
        ? "{thief} found {victim}'s hand empty"
        : "{thief} stole a card from {victim}", { thief: item.thiefName, victim: item.victimName }),
      icon: <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.playerColor }} />,
      accentColor: "#bb6549",
      tone: "alert" as const,
    }))
    .with({ kind: "sabotage" }, item => ({
      text: match(item.pieceKind)
        .with("road", () => translateText("{actor} sabotaged {victim}'s road", { actor: item.actorName, victim: item.victimName }))
        .with("ship", () => translateText("{actor} sabotaged {victim}'s ship", { actor: item.actorName, victim: item.victimName }))
        .with("settlement", () => translateText("{actor} sabotaged {victim}'s settlement", { actor: item.actorName, victim: item.victimName }))
        .with("city", () => translateText("{actor} reduced {victim}'s city", { actor: item.actorName, victim: item.victimName }))
        .exhaustive(),
      icon: <span className="text-clay [&>svg]:h-4 [&>svg]:w-4"><PieceIcon piece="sabotage" /></span>,
      accentColor: "#bb6549",
      tone: "alert" as const,
    }))
    .with({ kind: "shortage" }, item => ({
      text: translateText("Bank shortage: {resources}", {
        resources: item.resources.map(resource => resourceName(language, resource)).join(language === "ja" ? "、" : ", "),
      }),
      icon: <span className="h-2.5 w-2.5 rounded-full bg-clay" />,
      accentColor: "#bb6549",
      tone: "alert" as const,
    }))
    .exhaustive();

  return (
    <div
      key={event.id}
      role="status"
      aria-label={translateText("Table announcement")}
      data-tone={content.tone}
      className="shared-board-event-toast"
      style={{ "--event-accent": content.accentColor } as CSSProperties}
    >
      <span aria-hidden="true" className="flex shrink-0 items-center justify-center">{content.icon}</span>
      <span className="truncate">{content.text}</span>
    </div>
  );
}

function SharedTableStatus({ game, highlightedRolledNumber, onShowInvitation }: {
  game: PublicGame;
  highlightedRolledNumber?: number;
  onShowInvitation?: () => void;
}) {
  const translateText = useTranslation(multiplayerUiTranslations);
  const activePlayer = game.players.find(player => player.id === game.activePlayerId);
  const winner = game.winnerId ? game.players.find(player => player.id === game.winnerId) : undefined;
  const disconnectedPlayers = game.players.filter(player => player.control === "human" && !player.connected);
  const waitingPlayerIds = winner
    ? []
    : match(game.phase)
      .with({ type: "discard" }, phase => Object.keys(phase.required))
      .with({ type: "gold" }, phase => Object.keys(phase.required))
      .otherwise(() => [game.activePlayerId]);
  const blockingDisconnectedPlayers = disconnectedPlayers.filter(player => waitingPlayerIds.includes(player.id));
  const activePlayerDisconnected = Boolean(!winner && activePlayer?.control === "human" && !activePlayer.connected);
  const showDisconnectedNotice = !winner && disconnectedPlayers.length > 0;
  const rolledTotal = highlightedRolledNumber;

  return (
    <section
      className="shared-table-status"
      data-has-disconnected={showDisconnectedNotice ? "true" : undefined}
      aria-label={translateText("Table status")}
    >
      <div className="shared-status-island">
        <span className="turn-number shared-turn-badge">
          {(winner ?? activePlayer) && (
            <span
              aria-hidden="true"
              className={`shared-turn-dot ${activePlayerDisconnected ? "opacity-55" : ""}`}
              style={{ backgroundColor: (winner ?? activePlayer)!.color }}
            />
          )}
          <span>
            {game.turnNumber === 0 ? translateText("Setup") : translateText("Turn {turn}", { turn: game.turnNumber })}
          </span>
        </span>
        <SharedBoardDice game={game} />
      </div>
      <DiceChart diceCounts={game.diceRollTotals} compact highlightedNumber={rolledTotal} />
      <BankSupply resources={game.bank} developmentCards={game.developmentRemaining} />
      {showDisconnectedNotice && (
        <div
          className="shared-table-disconnected"
          data-blocking={blockingDisconnectedPlayers.length > 0 ? "true" : "false"}
          aria-label={translateText("Disconnected players")}
        >
          <span className="shared-table-disconnected-summary">
            <DisconnectedIcon className="h-3.5 w-3.5 shrink-0 text-clay" />
            <span>
              {blockingDisconnectedPlayers.length > 0
                ? translateText("Waiting for {names} to reconnect.", { names: blockingDisconnectedPlayers.map(player => player.name).join(", ") })
                : translateText("{names} disconnected", { names: disconnectedPlayers.map(player => player.name).join(", ") })}
            </span>
          </span>
          {onShowInvitation && (
            <button type="button" className="shared-table-rejoin-button" onClick={onShowInvitation}>
              <QrCodeIcon className="h-3.5 w-3.5 shrink-0" />
              <span>{translateText("Show invitation")}</span>
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function PlayerControls({ snapshot, disabled, syncing, error, perform, selectBuild, onPrivateNoticeTarget, onOpenDialog, externalDialogOpen, vibrateOnYourTurn }: {
  snapshot: RoomSnapshot;
  disabled: boolean;
  syncing?: boolean;
  error: string;
  perform: (action: GameAction, expectedVersion: number, trade?: TradeIdentity) => void;
  selectBuild: (piece: BuildMode) => void;
  onPrivateNoticeTarget: (target: HTMLDivElement | null) => void;
  onOpenDialog: (dialog: "help" | "settings" | "leave") => void;
  externalDialogOpen: boolean;
  vibrateOnYourTurn: boolean;
}) {
  const { language } = useLanguage();
  const translateText = useTranslation(multiplayerUiTranslations);
  const game = snapshot.game!;
  const player = snapshot.privatePlayer!;
  const active = player.id === game.activePlayerId;
  useVibrateOnYourTurn(active, vibrateOnYourTurn);
  const activePlayer = game.players.find(other => other.id === game.activePlayerId)!;
  const ownStatistics = game.players.find(other => other.id === player.id)!;
  const highestPublicScore = Math.max(...game.players.map(other => other.score));
  const totalScore = snapshot.privateScore ?? ownStatistics.score;
  const victoryPointCards = player.developmentCards.filter(card => card.kind === "victory-point").length;
  const normalActions = active && game.phase.type === "actions" && !game.winnerId;
  const [details, setDetails] = useState<"table" | "activity" | "discard" | "gold" | "steal" | "trade-response" | null>(null);
  const [editor, setEditor] = useState<"trade" | "development" | null>(null);
  const [developmentCardId, setDevelopmentCardId] = useState<string | null>(null);
  const [drawnCard, setDrawnCard] = useState<{ id: string; kind: DevelopmentKind } | null>(null);
  const [tradeMode, setTradeMode] = useState<"bank" | "players">("bank");
  const [editorVersion, setEditorVersion] = useState(snapshot.version);
  const [editorTrade, setEditorTrade] = useState<TradeIdentity | null>(null);
  const [editorStateKey, setEditorStateKey] = useState("");
  const [confirmation, setConfirmation] = useState<{
    action: GameAction;
    title: keyof typeof multiplayerUiTranslations;
    description?: keyof typeof multiplayerUiTranslations;
    parameters?: TranslationParameters;
    cost?: Resources;
    exchange?: { give: Resources; receive: Resources };
    confirmLabel?: keyof typeof multiplayerUiTranslations;
    version: number;
    trade?: TradeIdentity;
    returnTo?: "steal" | "trade-response";
  } | null>(null);
  const [chosen, setChosen] = useState(emptyResources);
  const [resourceReceipt, setResourceReceipt] = useState<ResourceReceipt | null>(null);
  const nextReceiptId = useRef(1);
  const [turnArrived, setTurnArrived] = useState(false);
  const previousActiveReference = useRef<{ gameId: string; active: boolean }>({ gameId: game.gameId, active });
  const pendingDevelopmentPurchase = useRef<{ gameId: string; existingIds: Set<string> } | null>(null);
  const rollIdentity = game.dice ? `${game.gameId}:${game.turnNumber}:${game.activePlayerId}:${game.dice[0]}:${game.dice[1]}` : null;
  const previousRollReference = useRef<{
    gameId: string;
    phaseType: string;
    rollIdentity: string | null;
    resources: Resources;
    lastTheftId: number;
  }>({
    gameId: game.gameId,
    phaseType: game.phase.type,
    rollIdentity,
    resources: { ...player.resources },
    lastTheftId: snapshot.privateThefts.at(-1)?.id ?? 0,
  });
  const [rollReceipt, setRollReceipt] = useState<{ identity: string; gains: Resources; anyGain: boolean } | null>(null);
  const discardCount = game.phase.type === "discard" ? game.phase.required[player.id] : undefined;
  const goldRequiredKeys = game.phase.type === "gold" ? Object.keys(game.phase.required) : [];
  const choosingGold = game.phase.type === "gold" && goldRequiredKeys[0] === player.id;
  const queuedGoldCount = game.phase.type === "gold" && !choosingGold ? game.phase.required[player.id] : undefined;
  const goldChooser = game.phase.type === "gold" && goldRequiredKeys[0]
    ? game.players.find(other => other.id === goldRequiredKeys[0])
    : undefined;
  const canPay = (cost: Resources) => RESOURCES.every(resource => player.resources[resource] >= cost[resource]);
  const settlementUnavailable = game.board.vertices.filter(vertex => vertex.building?.playerId === player.id && vertex.building.kind === "settlement").length >= 5
    ? translateText("All 5 settlements are on the board. Upgrade one to a city to free a settlement piece.")
    : null;
  const cityUnavailable = game.board.vertices.filter(vertex => vertex.building?.playerId === player.id && vertex.building.kind === "city").length >= 4
    ? translateText("All 4 cities are on the board.")
    : canPay(COSTS.city) && !game.board.vertices.some(vertex => vertex.building?.playerId === player.id && vertex.building.kind === "settlement")
      ? translateText("You have no settlements to upgrade. Build a settlement first.")
      : null;
  const roadUnavailable = game.board.edges.filter(edge => edge.playerId === player.id && (edge.kind ?? "road") === "road").length >= 15
    ? translateText("All 15 roads are on the board.")
    : normalActions && canPay(COSTS.road) && legalRoadEdges(game, player.id).length === 0
      ? translateText("No legal position. Roads must connect to your roads, settlements, or cities.")
      : null;
  const shipUnavailable = game.board.edges.filter(edge => edge.playerId === player.id && edge.kind === "ship").length >= 15
    ? translateText("All 15 ships are on the board.")
    : normalActions && canPay(COSTS.ship) && legalShipEdges(game, player.id).length === 0
      ? translateText("No legal position. Ships must connect to your ships, settlements, or cities.")
      : null;
  const trade = game.trade;
  const tradeIdentity = trade ? JSON.stringify([trade.offeredBy, trade.give, trade.receive]) : null;
  const currentTradeRef: TradeIdentity | undefined = trade
    ? { offeredBy: trade.offeredBy, give: trade.give, receive: trade.receive }
    : undefined;
  const sameOpenTrade = (identity: TradeIdentity | null | undefined) => Boolean(
    identity && trade &&
    trade.offeredBy === identity.offeredBy &&
    JSON.stringify(trade.give) === JSON.stringify(identity.give) &&
    JSON.stringify(trade.receive) === JSON.stringify(identity.receive),
  );
  const tradeEditorStateKey = JSON.stringify([
    game.gameId,
    game.turnNumber,
    game.activePlayerId,
    game.phase.type,
    player.resources,
    game.bank,
    tradeIdentity,
  ]);
  const staleMessage = translateText("The game changed. Close and reopen this dialog to review the latest state.");
  const editorStale = editorVersion !== snapshot.version;
  const tradeEditorStale = editorTrade
    ? editorStateKey !== tradeEditorStateKey
    : editorStale;
  const confirmationStale = confirmation !== null && (
    confirmation.action.type === "complete-trade" && confirmation.trade?.partnerPrice
      ? !(sameOpenTrade(confirmation.trade) &&
        JSON.stringify(trade?.responses[confirmation.action.playerId]) === JSON.stringify(confirmation.trade.partnerPrice))
      : confirmation.version !== snapshot.version
  );

  useVibrateOnIncomingTrade(tradeIdentity, Boolean(trade && trade.offeredBy !== player.id), vibrateOnYourTurn);

  useEffect(() => { setChosen(emptyResources()); }, [game.phase.type]);

  useEffect(() => {
    const previous = previousActiveReference.current;
    previousActiveReference.current = { gameId: game.gameId, active };
    if (previous.gameId === game.gameId && !previous.active && active && !game.winnerId) {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      setTurnArrived(true);
      const timer = window.setTimeout(() => setTurnArrived(false), 1100);
      return () => window.clearTimeout(timer);
    }
    if (!active || game.winnerId) setTurnArrived(false);
  }, [game.gameId, active, Boolean(game.winnerId)]);

  useEffect(() => {
    const pending = pendingDevelopmentPurchase.current;
    if (!pending) return;
    if (pending.gameId !== game.gameId || error) {
      pendingDevelopmentPurchase.current = null;
      return;
    }
    const added = player.developmentCards.find(card => !pending.existingIds.has(card.id));
    if (added) {
      pendingDevelopmentPurchase.current = null;
      if (!game.winnerId) setDrawnCard({ id: added.id, kind: added.kind });
    }
  }, [game.gameId, game.winnerId, player.developmentCards, error]);

  useEffect(() => {
    if (!resourceReceipt) return;
    const timeout = window.setTimeout(() => setResourceReceipt(null), 3200);
    return () => window.clearTimeout(timeout);
  }, [resourceReceipt]);

  useEffect(() => {
    const previous = previousRollReference.current;
    const latestTheft = snapshot.privateThefts.at(-1);
    const latestTheftId = latestTheft?.id ?? 0;
    const newTheft = latestTheftId !== previous.lastTheftId && Boolean(latestTheft && (latestTheft.thiefId === player.id || latestTheft.victimId === player.id));
    let rollReceiptTimer: number | undefined;

    if (previous.gameId !== game.gameId) {
      setRollReceipt(null);
      setResourceReceipt(null);
    } else {
      const gains = getResourceGains(previous.resources, player.resources);
      const totalGained = resourceTotal(gains);
      const rollChanged = rollIdentity !== null && rollIdentity !== previous.rollIdentity;
      const diceTotal = game.dice ? game.dice[0] + game.dice[1] : 0;

      if (rollIdentity === null) {
        setRollReceipt(null);
      } else if (rollChanged) {
        if (previous.phaseType === "roll" && diceTotal !== 7) {
          setRollReceipt({ identity: rollIdentity, gains, anyGain: totalGained > 0 });
        } else {
          setRollReceipt(null);
        }
      }

      if (newTheft) {
        setResourceReceipt(null);
      } else if (totalGained > 0 && !game.winnerId) {
        const isDiceRollGain = rollChanged && previous.phaseType === "roll" && diceTotal !== 7;
        const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const receipt: ResourceReceipt = { id: nextReceiptId.current++, playerId: player.id, gains };
        if (isDiceRollGain && !reducedMotion) {
          rollReceiptTimer = window.setTimeout(() => setResourceReceipt(receipt), 500);
        } else {
          setResourceReceipt(receipt);
        }
      }
    }

    previousRollReference.current = {
      gameId: game.gameId,
      phaseType: game.phase.type,
      rollIdentity,
      resources: { ...player.resources },
      lastTheftId: latestTheftId,
    };
    return () => {
      if (rollReceiptTimer !== undefined) window.clearTimeout(rollReceiptTimer);
    };
  }, [game.gameId, game.phase.type, game.winnerId, rollIdentity, player.id, player.resources, snapshot.privateThefts]);

  const activeRollGains = rollReceipt && rollReceipt.identity === rollIdentity && rollReceipt.anyGain ? rollReceipt.gains : null;
  const rollSettledWithNoGains = Boolean(rollReceipt && rollReceipt.identity === rollIdentity && !rollReceipt.anyGain);

  useEffect(() => {
    setChosen(emptyResources());
  }, [tradeIdentity]);

  const previousDiscardRollIdentity = useRef<string | null>(rollIdentity);
  useEffect(() => {
    const rolledSevenJustNow = rollIdentity !== null &&
      rollIdentity !== previousDiscardRollIdentity.current &&
      game.dice !== null &&
      game.dice[0] + game.dice[1] === 7;
    previousDiscardRollIdentity.current = rollIdentity;
    let discardTimer: number | undefined;

    if (discardCount !== undefined) {
      setEditor(null);
      setConfirmation(null);
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (rolledSevenJustNow && !reducedMotion) {
        discardTimer = window.setTimeout(() => setDetails("discard"), 500);
      } else {
        setDetails("discard");
      }
    } else if (choosingGold) {
      setEditor(null);
      setConfirmation(null);
      setDetails("gold");
    } else if (active && game.phase.type === "steal") {
      setEditor(null);
      setConfirmation(null);
      setDetails("steal");
    } else if (trade) {
      const ownTrade = trade.offeredBy === player.id;
      const anotherDialogOpen = externalDialogOpen ||
        editor === "development" ||
        drawnCard !== null ||
        (!ownTrade && (details === "table" || details === "activity" || editor === "trade" || confirmation !== null));
      if (!anotherDialogOpen) {
        setEditor(null);
        setConfirmation(null);
        setDetails("trade-response");
      }
    } else {
      setDetails(current => current === "discard" || current === "gold" || current === "steal" || current === "trade-response" ? null : current);
    }
    return () => {
      if (discardTimer !== undefined) window.clearTimeout(discardTimer);
    };
  }, [discardCount, choosingGold, active && game.phase.type === "steal", tradeIdentity]);

  function openTradeEditor(mode?: "bank" | "players") {
    if (mode) setTradeMode(mode);
    setEditorVersion(snapshot.version);
    setEditorTrade(trade && trade.offeredBy === player.id ? { offeredBy: trade.offeredBy, give: trade.give, receive: trade.receive } : null);
    setEditorStateKey(tradeEditorStateKey);
    setEditor("trade");
  }

  function send(action: GameAction, expectedVersion = snapshot.version, trade?: TradeIdentity) {
    if (action.type === "buy-development") {
      pendingDevelopmentPurchase.current = {
        gameId: game.gameId,
        existingIds: new Set(player.developmentCards.map(card => card.id)),
      };
    }
    // A dialog must not submit an old choice against a newer trade or turn.
    perform(action, expectedVersion, trade);
    setEditor(null);
    setDetails(null);
    setConfirmation(null);
  }

  const phaseInstructions = getPhaseInstructions({
    language,
    phase: game.phase,
    variant: game.variant,
    fogWorld: game.board.fogWorld === true,
    victoryPointsToWin: game.victoryPointsToWin,
    secondSettlement: game.board.vertices.filter(vertex => vertex.building).length >= game.players.length,
    pendingKnight: game.canCancelKnight,
    sharedBoard: true,
  });
  const myTradeResponse = trade && trade.offeredBy !== player.id ? trade.responses[player.id] : undefined;
  const incomingTradeNeedsResponse = Boolean(trade && trade.offeredBy !== player.id && myTradeResponse === undefined);
  const tradeOpponents = trade && trade.offeredBy === player.id
    ? game.players.filter(other => other.id !== player.id)
    : [];
  const tradeReadyCount = tradeOpponents.filter(other => Boolean(trade?.responses[other.id])).length;
  const tradeRespondedCount = tradeOpponents.filter(other => trade?.responses[other.id] !== undefined).length;
  const tradeButtonStatus = !trade ? null
    : trade.offeredBy === player.id
      ? {
        primary: true,
        badge: tradeReadyCount > 0
          ? translateText("{count} ready", { count: tradeReadyCount })
          : `${tradeRespondedCount}/${tradeOpponents.length}`,
        description: tradeReadyCount > 0
          ? translateText("{ready} ready, {responded} of {total} answered", { ready: tradeReadyCount, responded: tradeRespondedCount, total: tradeOpponents.length })
          : translateText("{responded} of {total} answered", { responded: tradeRespondedCount, total: tradeOpponents.length }),
      }
      : myTradeResponse === undefined
        ? { primary: true, badge: translateText("New"), description: translateText("Waiting for your response") }
        : myTradeResponse === false
          ? { primary: false, badge: translateText("Declined"), description: translateText("You declined this trade.") }
          : trade.give
            ? { primary: false, badge: translateText("Accepted"), description: translateText("You accepted this offer.") }
            : { primary: false, badge: translateText("Proposed"), description: translateText("You proposed a price.") };
  const awaitingPlayer = active || choosingGold || discardCount !== undefined || Boolean(game.winnerId);
  const instructionTitle = awaitingPlayer
    ? phaseInstructions.title
    : incomingTradeNeedsResponse
      ? translateText("Trade on the table.")
      : translateText("The island is in motion.");
  const instructionDescription = game.winnerId ? translateText("{name} wins! {instructions}", { name: game.players.find(other => other.id === game.winnerId)!.name, instructions: phaseInstructions.description })
    : incomingTradeNeedsResponse
      ? translateText(trade!.give
        ? "{name} offered a trade. Open it to accept or decline."
        : "{name} is requesting cards. Open it to propose a price or decline.", { name: activePlayer.name })
      : queuedGoldCount !== undefined && goldChooser
        ? translateText("{name} is choosing gold. Your turn to choose {count} next.", { name: goldChooser.name, count: queuedGoldCount })
        : !awaitingPlayer
          ? game.trade
            ? translateText("{name} is reviewing trade responses.", { name: activePlayer.name })
            : activePlayer.control === "computer"
              ? translateText(game.phase.type === "discard" ? "{name} is discarding resources." : "{name} is playing automatically.", { name: activePlayer.name })
              : translateText("{name} is playing. You can inspect your hand and the island while you wait.", { name: activePlayer.name })
          : snapshot.buildMode ? translateText("Choose a highlighted location for your {piece} on the shared board, then confirm the placement.", { piece: pieceName(language, snapshot.buildMode) })
            : phaseInstructions.description;

  const boardPhaseBanner = !active || game.winnerId ? null : match(game.phase)
    .with({ type: "actions" }, () => snapshot.buildMode ? {
      iconPiece: snapshot.buildMode === "move-ship" ? "ship" as const : snapshot.buildMode,
      text: translateText("Place your {piece} on the shared board", { piece: pieceName(language, snapshot.buildMode) }),
      cancelable: true,
    } : null)
    .with({ type: "setup-reveal" }, () => ({
      iconPiece: "settlement" as const,
      text: translateText("Choose a cell or settlement on the shared board"),
      cancelable: false,
    }))
    .with({ type: "setup-road" }, () => ({
      iconPiece: "road" as const,
      text: translateText(isSeafarers(game.variant) ? "Place your road or ship on the shared board" : "Place your road on the shared board"),
      cancelable: false,
    }))
    .with({ type: "robber" }, () => ({
      iconPiece: null,
      text: translateText(isSeafarers(game.variant) ? "Move the robber or pirate on the shared board" : "Move the robber on the shared board"),
      cancelable: false,
    }))
    .with({ type: "road-building" }, phase => ({
      iconPiece: "road" as const,
      text: translateText(isSeafarers(game.variant)
        ? (phase.remaining === 1 ? "Place {count} free route on the shared board" : "Place {count} free routes on the shared board")
        : (phase.remaining === 1 ? "Place {count} free road on the shared board" : "Place {count} free roads on the shared board"),
      { count: phase.remaining }),
      cancelable: false,
    }))
    .otherwise(() => null);

  const developmentNames = getDevelopmentNames(language);
  const developmentDescriptions = getDevelopmentDescriptions(language, game.variant, game.victoryPointsToWin);
  const receivedResources = resourceReceipt?.playerId === player.id ? resourceReceipt.gains : undefined;

  return <><div className="private-dashboard" data-active={active ? "true" : "false"} style={{ "--player-accent": player.color } as CSSProperties} aria-label={translateText("Your hand and actions")}>
    <section className="private-player-summary" aria-label={translateText("Your player summary")}>
      <PlayerSeat variant={game.variant} player={{ ...ownStatistics, resourceCount: resourceTotal(player.resources), developmentCount: player.developmentCards.length }}
        number={game.players.findIndex(other => other.id === player.id) + 1} active={active}
        leading={ownStatistics.score === highestPublicScore && game.players.some(other => other.score < highestPublicScore)}
        largestArmy={game.awards.largestArmy === player.id} longestRoadAward={game.awards.longestRoad === player.id}
        islandBonus={ownStatistics.islands ?? 0}
        privateScore={totalScore}
        stacked={game.awards.largestArmy === player.id || game.awards.longestRoad === player.id || (ownStatistics.islands ?? 0) > 0}
        badge={<>
          <strong className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold leading-5 text-ink tabular-nums ${resourceTotal(player.resources) > 7 ? "card-count-at-risk bg-clay/30" : "bg-moss"}`}>
            {resourceTotal(player.resources) > 7 && <WarningIcon className="h-3 w-3 shrink-0 text-clay" />}
            {translateText("{count} cards", { count: resourceTotal(player.resources) })}
          </strong>
          {victoryPointCards > 0 && (
            <span
              role="img"
              aria-label={translateText("{count} victory point cards", { count: victoryPointCards })}
              title={translateText("{count} victory point cards", { count: victoryPointCards })}
              className="flex items-center gap-1 rounded-md bg-moss px-1.5 py-0.5 text-xs leading-5 text-ink tabular-nums"
            >
              <span className="text-[#947231] [&>svg]:h-3.5 [&>svg]:w-3.5"><DevelopmentCardIcon kind="victory-point" /></span>
              <strong className="font-semibold">+{victoryPointCards} {translateText("VP")}</strong>
            </span>
          )}
        </>} />
    </section>
    <section className="hand-content private-hand" aria-label={translateText("Your cards")}>
      <ResourceReceiptAnnouncement receipt={resourceReceipt} />
      <section className="hand-resources relative" aria-label={translateText("Your current resources")}>
        <ul aria-label={translateText("Cards in hand")} className="grid grid-cols-5 gap-1.5 sm:gap-2">
          {RESOURCES.map(resource => {
            const count = player.resources[resource];
            const gained = receivedResources?.[resource] ?? 0;
            const arrived = gained > 0 || Boolean(activeRollGains && activeRollGains[resource] > 0);
            return <li key={resource} aria-label={translateText("{resource}: {count} in hand", { resource: resourceName(language, resource), count })} className="relative">
              <div key={gained > 0 ? resourceReceipt!.id : "idle"} className={`relative ${arrived ? "resource-hand-arrival" : ""}`}>
                <ResourceCard resource={resource} count={count} iconClassName="h-8 w-8" className={`hand-resource-card w-full ${count === 0 ? "resource-card-empty" : ""}`} />
                {gained > 0 && (
                  <>
                    <span className="resource-dealt-card" aria-hidden="true">
                      <ResourceCard resource={resource} compact className="h-full w-full" />
                    </span>
                    <span
                      aria-label={translateText("Received {count} {resource}", { count: gained, resource: resourceName(language, resource) })}
                      className="absolute -bottom-2 left-1/2 -translate-x-1/2 rounded-full border-2 border-paper bg-forest px-2 py-0.5 text-xs font-bold text-ink shadow-sm"
                    >
                      +{gained}
                    </span>
                  </>
                )}
              </div>
            </li>;
          })}
        </ul>
        <div ref={onPrivateNoticeTarget} className="private-hand-notices" />
      </section>
      <CollapsibleSection title={translateText("Build a little bigger")} className="hand-building" defaultOpen>
        <div className="build-options private-build-grid grid grid-cols-2 gap-2">
          {(["road", ...(isSeafarers(game.variant) ? ["ship" as const] : []), "settlement", "city"] as const).map(piece => {
            const locations = piece === "road"
              ? legalRoadEdges(game, player.id)
              : piece === "ship" ? legalShipEdges(game, player.id) : piece === "city"
                ? legalCityVertices(game, player.id)
                : legalSettlementVertices(game, player.id);
            const explanation = piece === "road" ? roadUnavailable : piece === "ship" ? shipUnavailable : piece === "settlement" ? settlementUnavailable : piece === "city" ? cityUnavailable : null;
            const unavailable = explanation ?? (!normalActions
              ? translateText("Available after rolling on your turn.")
              : !canPay(COSTS[piece])
                ? translateText("You need more resources.")
                : !locations.length
                  ? translateText("No legal position or no pieces remaining.")
                  : translateText("Select a location on the board."));
            return (
              <BuildButton key={piece} piece={piece} color={player.color} resources={COSTS[piece]} available={player.resources} layout="tile"
                aria-label={piece === "city" ? translateText("Upgrade to city") : translateText("Build {piece}", { piece: pieceName(language, piece) })}
                aria-pressed={snapshot.buildMode === piece} aria-describedby={explanation ? `${piece}-build-explanation` : undefined}
                title={unavailable}
                disabled={disabled || !normalActions || !canPay(COSTS[piece]) || !locations.length}
                onClick={() => selectBuild(snapshot.buildMode === piece ? null : piece)} />
            );
          })}
          {isSeafarers(game.variant) && <button className={`build-tile flex min-h-[70px] w-full flex-col items-start justify-center gap-1 rounded-xl border px-2.5 py-2 text-left text-xs font-semibold transition-all ${snapshot.buildMode === "move-ship" ? "border-forest bg-moss ring-2 ring-forest/50" : "border-[#cfc3a6] bg-white/90 shadow-[0_2px_0_#d8ccb0,0_3px_8px_#253b3610] hover:bg-white"}`}
            disabled={disabled || !normalActions || !movableShipEdges(game, player.id).some(id => legalShipDestinations(game, player.id, id).length)}
            aria-pressed={snapshot.buildMode === "move-ship"} onClick={() => selectBuild(snapshot.buildMode === "move-ship" ? null : "move-ship")}>
            <span className="flex min-w-0 items-center gap-1.5" style={{ color: player.color }}>
              <span className="flex h-6 w-6 shrink-0 items-center justify-center"><MoveShipIcon className="h-5 w-5" /></span>
              <span className="text-[12px] font-semibold leading-tight text-ink">{translateText("Move ship")}</span>
            </span>
          </button>}
          {game.sabotageEnabled && <BuildButton piece="sabotage" color="#8a2f22" resources={COSTS.sabotage} available={player.resources} layout="tile"
            aria-label={translateText("Sabotage")} aria-pressed={snapshot.buildMode === "sabotage"}
            title={!normalActions
              ? translateText("Available after rolling on your turn.")
              : !canPay(COSTS.sabotage)
                ? translateText("You need more resources.")
                : !hasLegalSabotageTarget(game, player.id)
                  ? translateText("There are no opponent pieces available to sabotage.")
                  : translateText("Select a location on the board.")}
            disabled={disabled || !normalActions || !canPay(COSTS.sabotage) || !hasLegalSabotageTarget(game, player.id)}
            onClick={() => selectBuild(snapshot.buildMode === "sabotage" ? null : "sabotage")} />}
          <BuildButton piece="development" color={player.color} resources={COSTS.development} available={player.resources} layout="tile" aria-label={translateText("Buy a card")} disabled={disabled || !normalActions || !canPay(COSTS.development) || game.developmentRemaining === 0} onClick={() => setConfirmation({
            action: { type: "buy-development" },
            title: "Buy a development card?",
            cost: COSTS.development,
            confirmLabel: "Buy",
            version: snapshot.version,
          })} />
        </div>
        {([
          ["road", roadUnavailable],
          ...(isSeafarers(game.variant) ? [["ship", shipUnavailable] as const] : []),
          ["settlement", settlementUnavailable],
          ["city", cityUnavailable],
        ] as const).some(([, explanation]) => Boolean(explanation)) && (
            <div className="mt-2 space-y-1.5">
              {([
                ["road", roadUnavailable],
                ...(isSeafarers(game.variant) ? [["ship", shipUnavailable] as const] : []),
                ["settlement", settlementUnavailable],
                ["city", cityUnavailable],
              ] as const).map(([piece, explanation]) => explanation && (
                <p key={piece} id={`${piece}-build-explanation`} className="rounded-lg bg-moss/60 px-3 py-2 text-xs leading-5 text-ink">
                  {explanation}
                </p>
              ))}
            </div>
          )}
        <p className="sr-only">{translateText("Building needs resources, an available piece, and a legal connection after your roll.")}</p>
        <button className="button-secondary mt-2 w-full px-2" disabled={disabled || !normalActions} onClick={() => openTradeEditor()}><TradeIcon />{translateText("Make a trade")}</button>
      </CollapsibleSection>
      <DevelopmentHand variant={game.variant} victoryPointsToWin={game.victoryPointsToWin} cards={player.developmentCards} turnNumber={game.turnNumber} onSelect={cardId => { setDevelopmentCardId(cardId); setEditorVersion(snapshot.version); setEditor("development"); }} />
    </section>

    <section className={`hand-dice private-turn ${turnArrived ? "private-turn-arrived" : ""}`} aria-label={translateText("Turn controls")}>
      {boardPhaseBanner && (
        <div key={boardPhaseBanner.text} className="placement-mode-banner placement-banner-enter" role="status">
          <span className="flex min-w-0 items-center gap-2" style={{ color: player.color }}>
            <span className="flex h-6 w-6 shrink-0 items-center justify-center [&>svg]:h-6 [&>svg]:w-6">
              {boardPhaseBanner.iconPiece ? (
                <PieceIcon piece={boardPhaseBanner.iconPiece} />
              ) : (
                <RobberIcon className="h-5 w-5 text-clay" />
              )}
            </span>
            <span className="min-w-0 text-xs font-semibold leading-4 text-ink">
              {boardPhaseBanner.text}
            </span>
          </span>
          {boardPhaseBanner.cancelable && (
            <button type="button" className="button-secondary min-h-9 shrink-0 px-2.5 py-1 text-xs" aria-label={translateText("Cancel placement")} disabled={disabled} onClick={() => selectBuild(null)}>
              {translateText("Cancel")}
            </button>
          )}
        </div>
      )}
      <div className="turn-header">
        <h2 className="turn-owner">
          {game.winnerId ? (
            <span className="truncate">{translateText("Game over")}</span>
          ) : active ? (
            <span className="font-bold text-ink">{translateText("Your turn")}</span>
          ) : (
            <>
              <span className="truncate" title={activePlayer.name}>{activePlayer.name}</span>
              <span className="shrink-0 text-xs font-medium text-muted">{translateText(" - Their turn")}</span>
            </>
          )}
          {syncing && (
            <span className="private-syncing-indicator" aria-hidden="true" title={translateText("Syncing")}>
              <span className="private-syncing-dot" />
            </span>
          )}
        </h2>
        <span className="turn-number">{game.turnNumber === 0 ? translateText("Setup") : translateText("Turn {turn}", { turn: game.turnNumber })}</span>
        <GameMenu
          icon
          actions={[
            { label: translateText("Help"), icon: "help", onSelect: () => onOpenDialog("help") },
            { label: translateText("Players & bank"), icon: "players", onSelect: () => setDetails("table") },
            { label: translateText("Table activity"), icon: "activity", onSelect: () => setDetails("activity") },
            { label: translateText("Settings"), icon: "settings", onSelect: () => onOpenDialog("settings") },
          ]}
          exitAction={{ label: translateText("Leave room"), icon: "leave", onSelect: () => onOpenDialog("leave") }}
        />
      </div>
      <MultiplayerDice game={game} gains={activeRollGains} rollSettled={rollSettledWithNoGains} />
      <div data-testid="game-phase" data-phase={game.phase.type} data-active-player={activePlayer.name} className="private-instructions" aria-live="polite">
        <TurnInstructions title={instructionTitle} description={instructionDescription} computerActivity={!awaitingPlayer && activePlayer.control === "computer"} expandable />
      </div>
      <div className="turn-action">
        {discardCount !== undefined ? <button className="button-primary" onClick={() => setDetails("discard")}><DiscardCardIcon />{translateText("Discard {count}", { count: discardCount })}</button>
          : choosingGold && game.phase.type === "gold" ? <button className="button-primary" onClick={() => setDetails("gold")}><GoldIcon />{translateText("Choose gold ({count})", { count: game.phase.required[player.id]! })}</button>
            : active && game.phase.type === "steal" ? <button className="button-primary" onClick={() => setDetails("steal")}><RobberIcon />{translateText("Choose player")}</button>
              : trade && tradeButtonStatus ? <button
                className={tradeButtonStatus.primary ? "button-primary" : "button-secondary"}
                aria-label={translateText("View trade")}
                aria-description={tradeButtonStatus.description}
                onClick={() => {
                  const previousResponse = trade.offeredBy !== player.id ? trade.responses[player.id] : undefined;
                  setChosen(previousResponse && typeof previousResponse === "object" ? { ...previousResponse } : emptyResources());
                  setDetails("trade-response");
                }}
              >
                <TradeIcon />
                <span>{translateText("View trade")}</span>
                <span aria-hidden="true" className={`trade-status-badge ${tradeButtonStatus.primary ? "trade-status-badge-primary" : "trade-status-badge-secondary"}`}>
                  {tradeButtonStatus.badge}
                </span>
              </button>
                : active && game.canCancelKnight ? <button className="button-secondary" disabled={disabled} onClick={() => send({ type: "cancel-knight" })}>{translateText("Cancel Knight")}</button>
                  : <button className="button-primary" disabled={disabled || !active || game.phase.type !== "roll"} onClick={() => send({ type: "roll" })}><DiceIcon />{translateText("Roll the dice")}</button>}
        {active && game.phase.type === "road-building" && snapshot.boardTargets.edges.length === 0 ? <button className="button-secondary" disabled={disabled} onClick={() => send({ type: "skip-roads" })}>{translateText("Finish Road Building")}</button>
          : <button className="button-secondary" disabled={disabled || !normalActions} onClick={() => send({ type: "end-turn" })}><EndTurnIcon />{translateText("End turn")}</button>}
      </div>
    </section>


    {details === "table" && <Dialog title={translateText("All players and bank")} onClose={() => setDetails(null)} wide><div className="space-y-4"><PlayerList snapshot={snapshot} /><BankSupply resources={game.bank} developmentCards={game.developmentRemaining} /></div></Dialog>}
    {details === "activity" && <Dialog title={translateText("Table activity")} onClose={() => setDetails(null)}>
      {game.log.length === 0
        ? <p className="text-sm text-muted">{translateText("No activity yet.")}</p>
        : <ol className="space-y-3 text-sm text-muted">{game.log.slice(-12).map((entry, index) => <li key={index}>{formatGameMessage(language, entry)}</li>)}</ol>}
    </Dialog>}
    {details === "discard" && discardCount !== undefined && <Dialog title={translateText("Discard {count} cards", { count: discardCount })} onClose={() => setDetails(null)} summary={<ResourceInventory resources={player.resources} />}>
      <DiscardSelection resources={player.resources} required={discardCount} chosenResources={chosen} onChangeResources={setChosen} disabled={disabled} onConfirm={() => send({ type: "discard", resources: chosen })} />
    </Dialog>}
    {details === "gold" && choosingGold && game.phase.type === "gold" && <GoldSelection
      key={JSON.stringify(game.phase.required)} hand={player.resources} bank={game.bank} count={game.phase.required[player.id]!}
      disabled={disabled} onClose={() => setDetails(null)} onSubmit={resources => send({ type: "choose-gold", resources })} />}
    {details === "steal" && active && game.phase.type === "steal" && <Dialog title={translateText("Choose a player to steal from")} onClose={() => setDetails(null)}>
      <div className="space-y-2"><TheftChoices players={game.phase.victimIds.map(playerId => {
        const victim = game.players.find(other => other.id === playerId)!;
        return { id: victim.id, name: victim.name, color: victim.color, number: game.players.indexOf(victim) + 1, resourceCount: victim.resourceCount };
      })} disabled={disabled} onSelect={playerId => {
        const victim = game.players.find(other => other.id === playerId)!;
        setDetails(null);
        setConfirmation({ action: { type: "steal", playerId }, title: "Confirm theft", description: victim.resourceCount > 0 ? "Steal one random resource from {name}." : "{name} has no resources. Finish without taking a card.", parameters: { name: victim.name }, version: snapshot.version, returnTo: "steal" });
      }} /></div>
    </Dialog>}
    {details === "trade-response" && trade && <Dialog title={translateText(trade.give ? "Trade offer" : "Trade request")} onClose={() => setDetails(null)} summary={<ResourceInventory resources={player.resources} />}>
      <OpenTrade trade={trade} viewer={player} players={game.players} chosenResources={chosen} disabled={disabled} error={error}
        onChangeResources={setChosen}
        onComplete={(playerId, price) => {
          setDetails(null);
          setConfirmation({
            action: { type: "complete-trade", playerId },
            title: "Trade with {name}",
            parameters: { name: game.players.find(other => other.id === playerId)!.name },
            exchange: { give: price, receive: trade.receive },
            version: snapshot.version,
            trade: { offeredBy: trade.offeredBy, give: trade.give, receive: trade.receive, partnerPrice: price },
            returnTo: "trade-response",
          });
        }}
        onEdit={() => { setDetails(null); openTradeEditor("players"); }}
        onWithdraw={() => send({ type: "cancel-trade" }, snapshot.version, currentTradeRef)}
        onRespond={action => send(action, snapshot.version, currentTradeRef)} />
    </Dialog>}

    {editor === "trade" && <TradeDialog game={game} player={player} initialMode={tradeMode} onModeChange={setTradeMode} initialOffer={trade?.offeredBy === player.id ? trade : undefined} disabled={disabled || !normalActions || tradeEditorStale} error={tradeEditorStale ? staleMessage : error}
      onClose={() => { setEditor(null); if (trade) setDetails("trade-response"); }}
      onSubmit={action => {
        if (action.type === "bank-trade") {
          send(action, editorTrade ? snapshot.version : editorVersion);
        } else {
          send(action, editorVersion, editorTrade ?? undefined);
        }
      }} />}
    {editor === "development" && <DevelopmentDialog variant={game.variant} victoryPointsToWin={game.victoryPointsToWin} player={player} bank={game.bank} turnNumber={game.turnNumber} phaseType={game.phase.type} developmentPlayed={game.developmentPlayed} initialCardId={developmentCardId} active={active} disabled={disabled || editorStale} error={editorStale ? staleMessage : error}
      onClose={() => setEditor(null)} onSubmit={action => send(action, editorVersion)} />}
    {drawnCard && <Dialog title={translateText("Development card drawn")} eyebrow={<span className="eyebrow">{translateText("You drew a development card")}</span>} onClose={() => setDrawnCard(null)}>
      <div className="drawn-card-reveal flex flex-col items-center text-center">
        <div className={`drawn-card-frame mb-4 flex h-24 w-20 flex-col items-center justify-center rounded-2xl border-2 shadow-md ${drawnCard.kind === "victory-point" ? "border-[#d7aa44] bg-gradient-to-b from-[#fffaf0] to-[#f4e4bc] text-[#947231]" : "border-forest bg-gradient-to-b from-[#fffdf6] to-[#e9eddf] text-ink"}`}>
          <span className="[&>svg]:h-12 [&>svg]:w-12"><DevelopmentCardIcon kind={drawnCard.kind} /></span>
        </div>
        <h3 className="font-serif text-2xl text-ink">{developmentNames[drawnCard.kind]}</h3>
        <span className={`mt-2 inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${drawnCard.kind === "victory-point" ? "bg-[#f3e7c2] text-[#8b6425]" : "bg-moss text-ink"}`}>
          {translateText(drawnCard.kind === "victory-point" ? "Counts immediately toward your victory points." : "Playable starting on your next turn.")}
        </span>
        <p className="mt-3 text-sm leading-6 text-muted">{developmentDescriptions[drawnCard.kind]}</p>
        <button type="button" className="button-primary mt-5 w-full" onClick={() => setDrawnCard(null)}>
          {translateText("Got it")}
        </button>
      </div>
    </Dialog>}
    {confirmation && <ActionConfirmation title={translateText(confirmation.title, confirmation.parameters)} player={confirmation.action.type === "buy-development" ? undefined : { name: player.name, color: player.color }} description={confirmation.description ? translateText(confirmation.description, confirmation.parameters) : undefined} cost={confirmation.cost} exchange={confirmation.exchange} resources={confirmation.action.type === "steal" || confirmation.action.type === "buy-development" ? undefined : player.resources}
      confirmLabel={confirmation.confirmLabel ? translateText(confirmation.confirmLabel) : undefined}
      disabled={disabled || confirmationStale} error={confirmationStale ? staleMessage : error}
      onClose={() => { setConfirmation(null); if (confirmation.returnTo) setDetails(confirmation.returnTo); }} onConfirm={() => send(confirmation.action, confirmation.version, confirmation.trade)} />}
  </div></>;
}

export function MultiplayerApp() {
  const { language } = useLanguage();
  const translateText = useTranslation(multiplayerUiTranslations);
  const [invitation] = useState<Invitation | null>(() => parseInvitationUrl(window.location.href));
  const [name, setName] = useState(() => {
    try {
      const stored = invitation ? sessionStorage.getItem(`catania.multiplayer.name.${invitation.hostId}`) : null;
      if (stored) return stored;
    } catch { /* fall back to the selected profile's name */ }
    const profile = activeProfile(readProfileState());
    return invitation && profile ? profile.name : "";
  });
  const [view, setView] = useState<SessionView | null>(null);
  const session = useRef<MultiplayerSession | null>(null);
  const [localError, setLocalError] = useState<keyof typeof multiplayerUiTranslations | "">("");
  const [qrCode, setQrCode] = useState("");
  const [boardThemeId, setBoardThemeId] = useState<BoardThemeId>("illustrated");
  const [dialog, setDialog] = useState<"help" | "settings" | "theme" | "activity" | "leave" | "reset" | "lobby" | "invitation" | null>(null);
  const boardSettings = useBoardSettings();
  const [selected, setSelected] = useState<{ kind: "vertex" | "edge" | "tile"; id: string; version: number } | null>(null);
  const [movingShip, setMovingShip] = useState<{ edgeId: string; version: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const [privateNoticeTarget, setPrivateNoticeTarget] = useState<HTMLDivElement | null>(null);
  const [tradeOutcomes, setTradeOutcomes] = useState<TradeOutcomeEvent[]>([]);
  const [playerSabotages, setPlayerSabotages] = useState<SabotageNoticeEvent[]>([]);
  const nextSabotageId = useRef(1);
  const nextTradeOutcomeId = useRef(1);
  const previousTradeReference = useRef<PublicGame | null>(null);
  const previousPrivateGameReference = useRef<PublicGame | null>(null);
  const previousConnectedGameId = useRef<string | null>(null);
  const [lobbyNotice, setLobbyNotice] = useState<keyof typeof multiplayerUiTranslations | null>(null);
  const [roomClosedDismissed, setRoomClosedDismissed] = useState(false);
  const [sharedEvents, setSharedEvents] = useState<SharedPublicEvent[]>([]);
  const nextSharedEventId = useRef(1);
  const previousSharedGameReference = useRef<PublicGame | null>(null);
  const [sharedRollProduction, setSharedRollProduction] = useState<{ identity: string; producingTileIds: string[] } | null>(null);
  const [victoryDismissed, setVictoryDismissed] = useState(false);
  const [victoryReady, setVictoryReady] = useState(false);
  const previousWinnerGameReference = useRef<{ gameId: string | null; winnerId: string | null }>({ gameId: null, winnerId: null });
  const [mapCode, setMapCode] = useState("");
  const [profileState, setProfileState] = useState<ProfileState>(() => readProfileState());
  const [profileGateOpen, setProfileGateOpen] = useState(false);
  const [storedRoomName] = useState<string | null>(() => {
    try { return invitation ? sessionStorage.getItem(`catania.multiplayer.name.${invitation.hostId}`) : null; }
    catch { return null; }
  });
  const copyFeedbackTimer = useRef<number | undefined>(undefined);
  const snapshot = view?.snapshot;
  const game = snapshot?.game;
  const host = view?.role === "host";
  const hostLobby = host && !game;
  const sharedGame = Boolean(host && game);
  const privateGame = Boolean(game && !host && snapshot?.privatePlayer);
  const activePlayer = game?.players.find(player => player.id === game.activePlayerId);
  const highestPublicScore = game ? Math.max(...game.players.map(player => player.score)) : 0;
  const disabled = view?.status !== "connected" || Boolean(view?.pending);
  const playerCount = snapshot?.players.length ?? 0;
  const missingPlayers = Math.max(0, 3 - playerCount);
  const pendingPlayers = snapshot?.pendingPlayers ?? [];
  const extraPendingPlayers = pendingPlayers.slice(Math.max(0, 4 - playerCount));
  const renderPendingPlayer = (player: NonNullable<RoomSnapshot["pendingPlayers"]>[number]) => <>
    <strong className="mr-auto min-w-0 truncate text-sm" title={player.name}>{player.name}</strong>
    <button className="button-primary min-h-9 shrink-0 px-3 py-1.5" aria-label={translateText("Admit {name}", { name: player.name })} disabled={disabled || playerCount >= 4} onClick={() => session.current?.admit(player.connectionId)}>{translateText("Admit")}</button>
    <button className="button-secondary min-h-9 shrink-0 px-3 py-1.5" aria-label={translateText("Decline {name}", { name: player.name })} disabled={disabled} onClick={() => session.current?.reject(player.connectionId)}>{translateText("Decline")}</button>
  </>;
  const disconnectedPlayers = snapshot?.players.filter(player => player.control === "human" && !player.connected) ?? [];
  const sessionError = view?.error ? formatGameMessage(language, view.error) : "";
  const victoryWinner = game?.winnerId ? game.players.find(player => player.id === game.winnerId) : undefined;
  const sharedRollIdentity = host && game?.dice
    ? `${game.gameId}:${game.turnNumber}:${game.activePlayerId}:${game.dice[0]}:${game.dice[1]}`
    : null;
  const sharedDiceRolling = useDiceRollAnimation(sharedRollIdentity);
  const settledSharedRolledNumber = host && game?.dice && !sharedDiceRolling
    ? game.dice[0] + game.dice[1]
    : undefined;
  const settledSharedProducingTileIds = host && sharedRollIdentity && !sharedDiceRolling && sharedRollProduction?.identity === sharedRollIdentity
    ? sharedRollProduction.producingTileIds
    : [];
  const activeSharedEvent = sharedEvents[0] ?? null;

  useEffect(() => {
    // A fresh game (or a return to the lobby) brings the victory popup back.
    if (!game?.winnerId) {
      setVictoryDismissed(false);
      setVictoryReady(false);
    }
    const previous = previousWinnerGameReference.current;
    const transitionedToWinner = Boolean(game?.winnerId && previous.gameId === game.gameId && !previous.winnerId);
    previousWinnerGameReference.current = { gameId: game?.gameId ?? null, winnerId: game?.winnerId ?? null };
    if (!game?.winnerId) return;
    if (!host || !transitionedToWinner || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setVictoryReady(true);
      return;
    }
    setVictoryReady(false);
    const timer = window.setTimeout(() => setVictoryReady(true), 450);
    return () => window.clearTimeout(timer);
  }, [host, game?.gameId, game?.winnerId]);

  useEffect(() => {
    if (!host || !game) {
      previousSharedGameReference.current = null;
      setSharedRollProduction(null);
      setSharedEvents([]);
      return;
    }
    const previous = previousSharedGameReference.current;
    let shortageTimer: number | undefined;
    if (previous && previous.gameId === game.gameId) {
      const previousRollIdentity = previous.dice
        ? `${previous.gameId}:${previous.turnNumber}:${previous.activePlayerId}:${previous.dice[0]}:${previous.dice[1]}`
        : null;
      if (sharedRollIdentity && sharedRollIdentity !== previousRollIdentity) {
        const production = computeSharedRollProduction(previous, game);
        setSharedRollProduction({ identity: sharedRollIdentity, producingTileIds: production.producingTileIds });
        if (production.shortages.length > 0 && !game.winnerId) {
          const shortageEvent: SharedPublicEvent = {
            id: nextSharedEventId.current++,
            kind: "shortage",
            resources: production.shortages,
          };
          const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
          if (reducedMotion) {
            setSharedEvents(current => [...current.slice(-5), shortageEvent]);
          } else {
            shortageTimer = window.setTimeout(() => {
              setSharedEvents(current => [...current.slice(-5), shortageEvent]);
            }, 500);
          }
        }
      } else if (!sharedRollIdentity) {
        setSharedRollProduction(null);
      }

      const detected = detectSharedPublicEvents(previous, game, () => nextSharedEventId.current++);
      if (detected.length > 0) {
        setSharedEvents(current => [...current.slice(-5), ...detected]);
      }
    } else {
      setSharedRollProduction(null);
      setSharedEvents([]);
    }
    if (game.winnerId) setSharedEvents([]);
    previousSharedGameReference.current = game;
    return () => {
      if (shortageTimer !== undefined) window.clearTimeout(shortageTimer);
    };
  }, [host, game, sharedRollIdentity]);

  useEffect(() => {
    if (!activeSharedEvent) return;
    const timer = window.setTimeout(() => {
      setSharedEvents(current => current.filter(item => item.id !== activeSharedEvent.id));
    }, 4200);
    return () => window.clearTimeout(timer);
  }, [activeSharedEvent?.id]);

  useEffect(() => {
    const privatePlayer = snapshot?.privatePlayer;
    if (host || !game || !privatePlayer) {
      previousPrivateGameReference.current = null;
      setPlayerSabotages([]);
      return;
    }
    const previous = previousPrivateGameReference.current;
    if (previous && previous.gameId === game.gameId) {
      const detected = detectPlayerSabotages(previous, game, privatePlayer.id, () => nextSabotageId.current++);
      if (detected.length > 0) {
        setPlayerSabotages(current => [...current.slice(-19), ...detected]);
      }
    } else {
      setPlayerSabotages([]);
    }
    previousPrivateGameReference.current = game;
  }, [host, game, snapshot?.privatePlayer?.id]);

  useEffect(() => {
    if (view?.status !== "closed") setRoomClosedDismissed(false);
  }, [view?.status]);

  useEffect(() => {
    if (host) {
      previousConnectedGameId.current = null;
      setLobbyNotice(null);
      return;
    }
    if (view?.status !== "connected" || !snapshot?.playerId) return;
    const currentGameId = game?.gameId ?? null;
    if (currentGameId) {
      setLobbyNotice(null);
    } else if (previousConnectedGameId.current) {
      setLobbyNotice("The host returned everyone to the lobby.");
    }
    previousConnectedGameId.current = currentGameId;
  }, [host, view?.status, snapshot?.playerId, game?.gameId]);

  useEffect(() => {
    const privatePlayer = snapshot?.privatePlayer;
    if (host || !game || !privatePlayer) {
      previousTradeReference.current = null;
      setTradeOutcomes([]);
      return;
    }
    const previous = previousTradeReference.current;
    previousTradeReference.current = game;
    if (!previous || previous.gameId !== game.gameId) {
      setTradeOutcomes([]);
      return;
    }
    const completed = detectCompletedTrade(previous, game, privatePlayer.id, () => nextTradeOutcomeId.current++);
    if (completed) setTradeOutcomes(current => [...current.slice(-9), completed]);
  }, [host, game, snapshot?.privatePlayer]);

  useEffect(() => {
    // The field follows the host's current map code; typing a different code replays that island.
    if (snapshot?.mapSeed) setMapCode(snapshot.mapSeed);
  }, [snapshot?.mapSeed]);

  function connect() {
    if (!invitation || !name.trim()) return;
    session.current?.close();
    setLocalError("");
    try {
      sessionStorage.setItem(`catania.multiplayer.name.${invitation.hostId}`, name.trim());
    } catch { /* The connection still works without persistent browser storage. */ }
    session.current = joinSession(invitation, name.trim(), setView, playerProfile?.id ?? null);
  }

  useEffect(() => {
    if (invitation) {
      // Auto-connect only resumes a seat this browser already joined; fresh visits pick a profile and press Connect.
      if (storedRoomName) connect();
    } else session.current = hostSession(setView);
    return () => { session.current?.close(); session.current = null; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setQrCode("");
    setCopied(false);
    window.clearTimeout(copyFeedbackTimer.current);
    if (view?.invitationUrl) {
      QRCode.toDataURL(view.invitationUrl, { width: 320, margin: 3, errorCorrectionLevel: "M" })
        .then(source => { if (!cancelled) setQrCode(source); })
        .catch(() => { if (!cancelled) setLocalError("Could not render the QR code. Share the invitation link instead."); });
    }
    return () => { cancelled = true; window.clearTimeout(copyFeedbackTimer.current); };
  }, [view?.invitationUrl]);

  useEffect(() => {
    if (!host || !snapshot || view?.status === "closed") return;
    const warn = (event: BeforeUnloadEvent) => {
      if (!session.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [host, Boolean(snapshot), view?.status]);

  const playerProfile = activeProfile(profileState);
  async function copyInvitationUrl() {
    if (!view?.invitationUrl) return;
    try {
      await navigator.clipboard.writeText(view.invitationUrl);
      window.clearTimeout(copyFeedbackTimer.current);
      setCopied(true);
      setLocalError("");
      copyFeedbackTimer.current = window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      window.clearTimeout(copyFeedbackTimer.current);
      setCopied(false);
      setLocalError("Select and copy the invitation link to share it.");
    }
  }
  const invitationQr = qrCode
    ? <img src={qrCode} alt={translateText("Scan to join this game")} className="lobby-qr aspect-square w-full max-w-80 rounded-xl" width={320} height={320} />
    : <p className="lobby-qr py-16 text-sm text-muted">{translateText("Preparing your invitation...")}</p>;
  const invitationLink = view?.invitationUrl && <div className="lobby-invitation-link mt-4 w-full">
    <label htmlFor="room-invitation-url" className="block text-xs text-muted">{translateText("Game invitation")}</label>
    <div className="mt-1 flex min-w-0 items-stretch rounded-xl border border-line bg-white">
      <input id="room-invitation-url" className="min-h-11 min-w-0 flex-1 rounded-l-xl bg-transparent px-3 text-xs" readOnly value={view.invitationUrl} onFocus={event => event.target.select()} />
      <button className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-r-xl border-l border-line px-3 text-xs font-semibold hover:bg-moss" aria-label={translateText("Copy invitation")} title={translateText(copied ? "Invitation copied" : "Copy invitation")} onClick={copyInvitationUrl}>
        {copied ? <CheckIcon /> : <CopyIcon />}
        <span role="status" className={copied ? "" : "sr-only"}>{copied ? translateText("Copied") : ""}</span>
      </button>
    </div>
  </div>;
  // Phones pick a player profile before joining; the shared board hosts no seat and never gates.
  if (invitation && !view && (!playerProfile || profileGateOpen)) {
    const selectProfile = (profile: PlayerProfile) => {
      const next = { profiles: profileState.profiles, activeId: profile.id };
      writeProfileState(next);
      setProfileState(next);
      if (!name.trim()) setName(profile.name);
      setProfileGateOpen(false);
    };
    const addProfile = (profile: PlayerProfile) => {
      const next = { profiles: [...profileState.profiles, profile], activeId: profile.id };
      writeProfileState(next);
      setProfileState(next);
      if (!name.trim()) setName(profile.name);
      setProfileGateOpen(false);
    };
    const renameProfile = (profile: PlayerProfile, playerName: string) => {
      const next = { profiles: profileState.profiles.map(candidate => candidate.id === profile.id ? { ...candidate, name: playerName } : candidate), activeId: profileState.activeId };
      writeProfileState(next);
      setProfileState(next);
      if (profile.id === profileState.activeId && name === profile.name) setName(playerName);
    };
    return <BoardThemeContext value={BOARD_THEMES[boardThemeId]}>
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
            if (profile.id === profileState.activeId && name === profile.name) setName("");
            return true;
          }}
          onReplay={(profile, previousGame) => {
            selectProfile(profile);
            window.location.href = `/?map=${encodeURIComponent(previousGame.mapCode)}&variant=${previousGame.variant}`;
          }}
        />
      </div>
    </BoardThemeContext>;
  }

  const currentSelection = selected?.version === snapshot?.version ? selected : null;
  const movingShipId = movingShip?.version === snapshot?.version && snapshot?.buildMode === "move-ship" ? movingShip?.edgeId : null;
  const selectedAction: GameAction | null = !currentSelection || !game ? null : match(currentSelection.kind)
    .with("tile", (): GameAction => ({ type: game.phase.type === "setup-reveal" ? "reveal-tile" : game.board.tiles.find(tile => tile.id === currentSelection.id)?.terrain === "sea" ? "move-pirate" : "move-robber", tileId: currentSelection.id }))
    .with("edge", (): GameAction => snapshot?.buildMode === "sabotage"
      ? { type: "sabotage-route", edgeId: currentSelection.id }
      : movingShipId
        ? { type: "move-ship", edgeId: movingShipId, destinationEdgeId: currentSelection.id }
        : { type: snapshot?.buildMode === "ship" || !legalRoadEdges(game, game.activePlayerId).includes(currentSelection.id) ? "place-ship" : "place-road", edgeId: currentSelection.id })
    .with("vertex", (): GameAction => snapshot?.buildMode === "sabotage"
      ? { type: "sabotage-building", vertexId: currentSelection.id }
      : { type: snapshot?.buildMode === "city" ? "place-city" as const : "place-settlement" as const, vertexId: currentSelection.id })
    .exhaustive();
  const routeChoicePending = currentSelection?.kind === "edge" && selectedAction?.type === "place-road" &&
    game && isSeafarers(game.variant) && (game.phase.type === "setup-road" || game.phase.type === "road-building") &&
    legalShipEdges(game, game.activePlayerId).includes(currentSelection.id);

  const effectiveBoardThemeId: BoardThemeId = host ? boardThemeId : (snapshot?.boardThemeId ?? boardThemeId);

  return <BoardThemeContext value={BOARD_THEMES[effectiveBoardThemeId]}>
    <div data-theme={effectiveBoardThemeId} className={privateGame ? "game-shell private-game-shell" : sharedGame ? "game-shell shared-game-shell" : hostLobby ? "multiplayer-lobby-shell" : "min-h-dvh"}>
      {!privateGame && <header className="mx-auto flex max-w-[1600px] items-center justify-between gap-2 border-b border-line px-5 py-4 sm:gap-3 sm:px-8">
        <div className="min-w-0 shrink-0 max-sm:[&>span>svg]:hidden max-sm:[&>span>span]:text-2xl"><Logo /></div>
        {sharedGame && snapshot?.mapSeed && <button type="button" className="ml-auto inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border border-[#e3d3a8] bg-gradient-to-b from-[#fdf7e3] to-[#f3e7c2] px-2.5 py-0.5 text-[10px] font-bold tracking-[.08em] tabular-nums text-[#8b6425] shadow-[inset_0_1px_0_#fffdf5,0_1px_3px_#423d2814] hover:border-[#cdb87e] hover:to-[#eee0b8] sm:mx-auto" aria-label={translateText("Copy map code")} title={translateText(copied ? "Map code copied" : "Copy map code")} onClick={async () => {
          try {
            await navigator.clipboard.writeText(snapshot.mapSeed!);
            window.clearTimeout(copyFeedbackTimer.current);
            setCopied(true);
            setLocalError("");
            copyFeedbackTimer.current = window.setTimeout(() => setCopied(false), 2_000);
          } catch {
            window.clearTimeout(copyFeedbackTimer.current);
            setCopied(false);
            setLocalError("Map code could not be copied.");
          }
        }}>
          <MapFoldIcon className="h-3.5 w-3.5 shrink-0" />
          <span role="status" className="whitespace-nowrap">{copied ? translateText("Copied") : snapshot.mapSeed}</span>
          {copied ? <CheckIcon className="h-3.5 w-3.5 shrink-0" /> : <CopyIcon className="h-3.5 w-3.5 shrink-0" />}
        </button>}
        {view ? <GameMenu actions={[
          { label: translateText("Help"), icon: "help", onSelect: () => setDialog("help") },
          ...(host && game ? [{ label: translateText("Table activity"), icon: "activity" as const, onSelect: () => setDialog("activity") }] : []),
          ...(host ? [{ label: translateText("Settings"), icon: "settings" as const, onSelect: () => setDialog("settings") }] : []),
          ...(host && game ? [{ label: translateText("Reset game"), icon: "reset" as const, disabled, onSelect: () => setDialog("reset") }] : []),
          ...(host && game ? [{ label: translateText("Return to lobby"), icon: "lobby" as const, disabled, onSelect: () => setDialog("lobby") }] : []),
          ...(host && game ? [{ label: translateText("Show invitation"), icon: "qr" as const, onSelect: () => setDialog("invitation") }] : []),
        ]} exitAction={{ label: translateText("Leave room"), icon: "leave", onSelect: () => setDialog("leave") }} /> : <GameMenu
          triggerLabel={translateText("Menu")}
          groupLabel={translateText("Main menu")}
          profileName={invitation ? playerProfile?.name : undefined}
          actions={[
            { label: translateText("Help"), icon: "help", onSelect: () => setDialog("help") },
            ...(invitation ? [{ label: translateText("Profile"), icon: "profile" as const, onSelect: () => setProfileGateOpen(true) }] : []),
            { label: translateText("Settings"), icon: "settings", onSelect: () => setDialog("settings") },
          ]}
          exitAction={{ label: translateText("Single-device play"), icon: "singleDevice", onSelect: () => { window.location.href = "/"; } }}
        />}
      </header>}
      {privateGame && <span className="sr-only" role="status" data-status={view?.status}>{translateText(view?.pending ? "Syncing" : view?.status === "connected" ? "Connected" : "Offline")}</span>}
      <main className={privateGame ? "private-game-main" : sharedGame ? "shared-game-main" : hostLobby ? "multiplayer-lobby-main" : `mx-auto max-w-[1600px] px-4 pb-10 sm:px-8 ${game ? "pt-4" : "pt-10 sm:pt-16"}`}>
        {!view && invitation && <section className="mx-auto max-w-xl">
          <p className="eyebrow">{translateText("Gather around")}</p>
          <h1 className="mt-3 font-serif text-5xl tracking-tight">{translateText("Your seat awaits.")}</h1>
          <p className="mb-8 mt-5 text-sm leading-7 text-muted">{translateText("Keep your cards close. Connect your phone to the shared board, then wait for the host to admit you.")}</p>
          <form className="panel space-y-4 p-6" onSubmit={event => { event.preventDefault(); connect(); }}>
            <label className="block text-sm font-semibold">{translateText("Your name")}<input className="field mt-2" maxLength={20} autoComplete="nickname" value={name} onChange={event => setName(event.target.value)} required /></label>
            <button className="button-primary w-full" disabled={!name.trim()}><LinkConnectIcon />{translateText("Connect to game")}</button>
          </form>
          <p className="mt-5 text-xs leading-6 text-muted">{translateText("PeerJS Cloud provides signaling, and STUN helps discover reachable addresses. Gameplay runs in the board browser over direct, encrypted connections, without a relay fallback. Ethernet and Wi-Fi can work together; guest Wi-Fi isolation can prevent connections.")}</p>
        </section>}

        {view && (!(privateGame || sharedGame || hostLobby) || view.status !== "connected") && <div className={privateGame ? "private-connection-notice" : "mb-4 flex flex-wrap items-center justify-between gap-2 text-xs"} role="status">
          <span>{translateText(view.pending ? "{screen} / {status} / Waiting for the host" : "{screen} / {status}", {
            screen: translateText(host ? "Shared board" : "Private player screen"),
            status: translateText(view.status === "connected" ? "Connected" : view.status === "connecting" ? host ? "Connecting through PeerJS Cloud..." : "Connecting to the host..." : view.status === "closed" ? "Room closed" : "Connection lost"),
          })}</span>
          {view.status === "disconnected" && <button className="button-secondary" onClick={() => session.current?.reconnect()}><LinkConnectIcon />{translateText("Reconnect")}</button>}
          {view.status === "closed" && <a className="underline underline-offset-4" href="/?multiplayer=1">{translateText("Start another room")}</a>}
        </div>}
        {(localError || sessionError) && <p role="alert" className={privateGame ? "private-game-error" : "mx-auto mb-5 max-w-4xl rounded-xl border border-clay/40 bg-white p-4 text-sm text-clay"}>{[localError ? translateText(localError) : "", sessionError].filter(Boolean).join(" ")}</p>}

        {view && !game && <div className={`mx-auto grid max-w-5xl gap-6 lg:grid-cols-2 ${host ? "multiplayer-lobby-grid" : ""}`}>
          {host && snapshot?.previewBoard && <section aria-label={translateText("Island preview")} className="multiplayer-lobby-island panel min-w-0 p-4 sm:p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div><p className="eyebrow">{translateText("A place to begin")}</p><h2 className="mt-1 font-serif text-2xl">{translateText("Your island awaits.")}</h2></div>
              <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
                <VictoryTargetBadge victoryTarget={snapshot.victoryPointsToWin} disabled={disabled} onChange={points => session.current?.setVictoryPointsToWin(points)} />
                <GameVariantSelector value={snapshot.variant} disabled={disabled} onChange={variant => session.current?.setVariant(variant)} />
              </div>
            </div>
            {snapshot.variant === "custom-world" && <div className="mb-4">
              <CustomMapConfigPanel
                value={snapshot.customMapConfig ?? DEFAULT_CUSTOM_MAP_CONFIG}
                disabled={disabled}
                onChange={config => session.current?.setCustomMapConfig(config)}
              />
            </div>}
            <div className="multiplayer-lobby-map h-[320px] min-w-0 sm:h-[420px]">
              <Board
                board={snapshot.previewBoard}
                players={[]}
                robberTileId={snapshot.previewBoard.tiles.find(tile => tile.terrain === "desert")?.id}
                pirateTileId={snapshot.previewBoard.tiles.find(tile => tile.terrain === "sea")?.id}
                fillBoardWithWater={boardSettings.fillBoardWithWater}
                interactive={false}
                compact
                fit
                onChangeTheme={() => setDialog("theme")}
                headerControls={<MapSeedControls
                  value={mapCode}
                  onChange={setMapCode}
                  disabled={disabled}
                  showCopy
                  onLoad={code => session.current?.useMapSeed(code)}
                  onShuffle={() => session.current?.shuffleBoard()}
                />}
              />
            </div>
          </section>}
          <div className={host ? "multiplayer-lobby-column min-w-0 space-y-6" : "contents"}>
            {host && <section aria-label={translateText("Room invitation")} className="multiplayer-lobby-invitation panel flex min-w-0 flex-col items-center p-4 sm:p-6">
              <div className="lobby-invitation-heading text-center">
                <p className="eyebrow">{translateText("Welcome to the table")}</p>
                <h1 className="my-3 font-serif text-3xl">{translateText("Scan. Join. Settle in.")}</h1>
              </div>
              {invitationQr}
              {invitationLink}
            </section>}
            <section className={`panel min-w-0 p-6 ${host ? "multiplayer-lobby-players" : "lg:col-span-2"}`}>
              <div className="flex flex-wrap items-center gap-2.5">
                <h2 className="break-words font-serif text-3xl">{snapshot?.playerId ? translateText("Welcome, {name}.", { name: snapshot.players.find(player => player.id === snapshot.playerId)!.name }) : translateText(host ? "Who is joining?" : view.status === "disconnected" ? "Not connected" : "Waiting for admission")}</h2>
                {!host && !snapshot?.playerId && view.status === "connected" && (
                  <span className="waiting-dots" aria-hidden="true" title={translateText("Waiting for host")}>
                    <span /><span /><span />
                  </span>
                )}
              </div>
              {!host && lobbyNotice && (
                <div role="status" className="mt-3 flex items-center justify-between gap-2 rounded-xl border border-forest/60 bg-moss px-3.5 py-2.5 text-xs font-semibold text-ink">
                  <span>{translateText(lobbyNotice)}</span>
                  <button type="button" aria-label={translateText("Dismiss notice")} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted hover:bg-paper" onClick={() => setLobbyNotice(null)}>
                    <CloseIcon className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
              {!host && <p className="my-4 text-sm leading-6 text-muted">{translateText(snapshot?.playerId ? "Your seat is reserved. The host will start when everyone is connected." : view.status === "disconnected" ? "Reconnect to request admission, or change your name before trying again." : "Ask the host to admit your name on the shared screen. Your hand will appear here when the game starts.")}</p>}
              {!host && !snapshot?.playerId && <button className="button-secondary" onClick={() => { session.current?.close(); session.current = null; setView(null); }}>{translateText("Change name")}</button>}
              {snapshot && <>
                <div id="lobby-readiness" role="status" className="my-4 rounded-xl bg-moss p-4">
                  <p className="eyebrow">{translateText("{count} of 4 seats filled", { count: playerCount })}</p>
                  <p className="mt-1 text-sm font-semibold">{missingPlayers > 0 ? translateText(missingPlayers === 1 ? "{count} more player needed to start." : "{count} more players needed to start.", { count: missingPlayers }) : disconnectedPlayers.length > 0 ? translateText("Enough players to start once everyone is connected.") : translateText("Ready to start with {count} players.", { count: playerCount })}</p>
                  {disconnectedPlayers.length > 0 && <p className="mt-2 text-xs text-clay">{translateText("Waiting for {names} to reconnect.", { names: disconnectedPlayers.map(player => player.name).join(", ") })}</p>}
                </div>
                <div className="lobby-roster my-5 space-y-2">
                  <PlayerList snapshot={snapshot} disabled={disabled} removePlayer={host ? playerId => session.current?.removePlayer(playerId) : undefined} renameComputer={host ? (playerId, name) => session.current?.renameComputer(playerId, name) : undefined} />
                  {playerCount < 4 && <ul aria-label={translateText("Open seats")} className="grid gap-2">
                    {Array.from({ length: 4 - playerCount }, (_, index) => playerCount + index + 1).map((seat, index) => {
                      const pendingPlayer = host ? pendingPlayers[index] : undefined;
                      return pendingPlayer ? <li key={pendingPlayer.connectionId} className="lobby-pending-enter flex items-center gap-3 rounded-xl border border-line p-3">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line text-xs">{seat}</span>
                        {renderPendingPlayer(pendingPlayer)}
                      </li> : <li key={seat} className="flex items-center gap-3 rounded-xl border border-dashed border-line p-3 text-muted">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line text-xs">{seat}</span>
                        <div><p className="text-sm font-semibold">{translateText(seat < 4 ? "Player needed" : "Optional fourth player")}</p><p className="mt-1 text-xs">{translateText(seat < 4 ? "Join by phone or add a computer." : "Start with three, or fill this seat.")}</p></div>
                      </li>;
                    })}
                  </ul>}
                </div>
              </>}
              {host && extraPendingPlayers.map(player => <div key={player.connectionId} className="lobby-pending-enter my-3 flex items-center gap-2 rounded-xl border border-line p-3">{renderPendingPlayer(player)}</div>)}
              {host && <>
                <div className="grid gap-2 sm:grid-cols-2">
                  <button className="button-secondary" disabled={disabled || !snapshot || playerCount >= 4} onClick={() => session.current?.addComputer(language)}><AddRobotIcon />{translateText("Add computer")}</button>
                  <button className="button-primary" aria-describedby="lobby-readiness" disabled={disabled || !snapshot || missingPlayers > 0 || disconnectedPlayers.length > 0} onClick={() => session.current?.startGame()}>{translateText("Start game")} <Arrow /></button>
                </div>
              </>}
            </section>
          </div>
        </div>}

        {host && game && snapshot && <div className="shared-game-table" data-testid="game-phase" data-phase={game.phase.type} data-active-player={activePlayer?.name}>
          <ul aria-label={translateText("Players")} className="table-seats shared-table-seats">
            {game.players.map((player, index) => <li key={player.id} className="min-w-0" aria-label={translateText("{name}, {status}", { name: player.name, status: translateText(player.control === "computer" ? "Computer player" : player.connected ? "Connected" : "Disconnected") })}>
              <PlayerSeat variant={game.variant} player={player} number={index + 1} active={player.id === game.activePlayerId}
                leading={player.score === highestPublicScore && game.players.some(other => other.score < highestPublicScore)}
                largestArmy={game.awards.largestArmy === player.id} longestRoadAward={game.awards.longestRoad === player.id}
                islandBonus={player.islands ?? 0}
                disconnected={player.control === "human" && !player.connected} />
            </li>)}
          </ul>
          <SharedTableStatus game={game} highlightedRolledNumber={settledSharedRolledNumber} onShowInvitation={() => setDialog("invitation")} />
          <section aria-label={translateText("Shared game board")} className="table-board flex min-w-0 flex-1">
            <div className="board-tablemat relative">
              <div className="shared-board-overlays">
                <SharedBoardPhaseBanner game={game} buildMode={snapshot.buildMode} />
                <SharedBoardEventToast event={activeSharedEvent} variant={game.variant} />
              </div>
              <Board board={game.board} players={game.players} robberTileId={game.robberTileId} pirateTileId={game.pirateTileId} fit
                victoryTarget={game.victoryPointsToWin}
                routeMode={snapshot.buildMode === "ship" || snapshot.buildMode === "move-ship" || snapshot.buildMode === "road" ? snapshot.buildMode : null}
                sabotageMode={snapshot.buildMode === "sabotage"}
                pirateIndicator={isSeafarers(game.variant) ? {
                  onBoard: game.pirateTileId !== null,
                  enabled: !disabled && activePlayer?.control === "human" && game.phase.type === "robber" && game.pirateTileId !== null,
                  onSelect: () => session.current?.perform({ type: "move-pirate", tileId: null }, snapshot.version),
                } : undefined}
                legalVertexIds={snapshot.boardTargets.vertices} legalEdgeIds={movingShipId ? legalShipDestinations(game, game.activePlayerId, movingShipId) : snapshot.boardTargets.edges} legalTileIds={snapshot.boardTargets.tiles}
                tileSelectionMode={game.phase.type === "setup-reveal" ? "setup" : "robber"}
                interactive={!disabled && activePlayer?.control !== "computer" && !game.winnerId} selectedId={currentSelection?.id ?? movingShipId}
                showBlockedSettlementLocations={boardSettings.showBlockedSettlementLocations} fillBoardWithWater={boardSettings.fillBoardWithWater}
                producingTileIds={settledSharedProducingTileIds}
                rolledNumber={settledSharedRolledNumber}
                onChangeTheme={() => setDialog("theme")}
                onSelect={(kind, id) => {
                  if (kind === "edge" && snapshot.buildMode === "move-ship" && !movingShipId) {
                    setMovingShip({ edgeId: id, version: snapshot.version });
                    setSelected(null);
                  } else setSelected({ kind, id, version: snapshot.version });
                }}
                confirmation={selectedAction ? {
                  title: selectedAction.type === "sabotage-route"
                    ? (() => {
                      const edge = game.board.edges.find(candidate => candidate.id === selectedAction.edgeId);
                      const owner = game.players.find(candidate => candidate.id === edge?.playerId);
                      return translateText(edge?.kind === "ship" ? "Destroy {name}'s ship?" : "Destroy {name}'s road?", { name: owner?.name ?? "" });
                    })()
                    : selectedAction.type === "sabotage-building"
                      ? (() => {
                        const building = game.board.vertices.find(candidate => candidate.id === selectedAction.vertexId)?.building;
                        const owner = game.players.find(candidate => candidate.id === building?.playerId);
                        return translateText(building?.kind === "city" ? "Reduce {name}'s city to a settlement?" : "Destroy {name}'s settlement?", { name: owner?.name ?? "" });
                      })()
                      : selectedAction.type === "reveal-tile" ? translateText("Choose this starting cell?")
                        : selectedAction.type === "move-robber" ? translateText("Move the robber here?")
                          : selectedAction.type === "move-pirate" ? translateText("Move the pirate here?")
                            : selectedAction.type === "move-ship" ? translateText("Move the ship here?")
                              : routeChoicePending ? translateText("Road or ship here?")
                                : translateText("Confirm {piece}?", { piece: pieceName(language, selectedAction.type === "place-ship" ? "ship" : selectedAction.type === "place-road" ? "road" : selectedAction.type === "place-city" ? "city" : "settlement") }),
                  player: activePlayer ? { name: activePlayer.name, color: activePlayer.color } : undefined,
                  ...(routeChoicePending ? {
                    choices: [
                      { label: translateText("Build road"), icon: <PieceIcon piece="road" />, onConfirm: () => { session.current?.perform(selectedAction, currentSelection!.version); setSelected(null); setMovingShip(null); } },
                      { label: translateText("Build ship"), icon: <PieceIcon piece="ship" />, onConfirm: () => { session.current?.perform({ ...selectedAction, type: "place-ship" }, currentSelection!.version); setSelected(null); setMovingShip(null); } },
                    ],
                  } : {}),
                  onConfirm: () => { session.current?.perform(selectedAction, currentSelection!.version); setSelected(null); setMovingShip(null); }, onCancel: () => setSelected(null)
                } : undefined}
              />
            </div>
          </section>
          {victoryWinner && victoryReady && !victoryDismissed && (
            <VictoryDialog
              eyebrow={snapshot.mapSeed
                ? translateText("The island {code} has a new legend", { code: snapshot.mapSeed })
                : translateText("The island has a new legend")}
              headline={translateText("{name} takes the island.", { name: victoryWinner.name })}
              winnerName={victoryWinner.name}
              winnerColor={victoryWinner.color}
              totalPoints={victoryWinner.score}
              pointsUnit={translateText("points")}
              breakdown={victoryBreakdownRows(victoryWinner.scoreBreakdown, translateText, game.variant)}
              diceCounts={game.diceRollTotals}
              profileNote={snapshot.profiles?.[victoryWinner.id]
                ? translateText("Player history: {games} games / {wins} wins / {points} total points", snapshot.profiles[victoryWinner.id])
                : undefined}
              mapCode={snapshot.mapSeed}
            >
              <button className="button-primary" disabled={disabled} onClick={() => session.current?.endGame()}>
                <ReturnToLobbyIcon />
                {translateText("Return to lobby")}
              </button>
              <button className="button-secondary" onClick={() => setVictoryDismissed(true)}>
                <MapFoldIcon />
                {translateText("View the island")}
              </button>
            </VictoryDialog>
          )}
        </div>}
        {!host && game && snapshot && <div className={privateGame ? "private-game-content" : "space-y-4"}>
          {snapshot.privatePlayer ? <PlayerControls key={`${view?.status}:${game.gameId}`} snapshot={snapshot} disabled={disabled} syncing={Boolean(view?.pending)} error={sessionError} perform={(action, expectedVersion, trade) => session.current?.perform(action, expectedVersion, trade)} selectBuild={piece => session.current?.selectBuild(piece, snapshot.version)} onPrivateNoticeTarget={setPrivateNoticeTarget} onOpenDialog={setDialog} externalDialogOpen={dialog !== null} vibrateOnYourTurn={boardSettings.vibrateOnYourTurn} />
            : <p className="text-sm text-muted">{translateText("Waiting for your private player information.")}</p>}
          {victoryWinner && !victoryDismissed && (
            <VictoryDialog
              eyebrow={translateText("The island has a new legend")}
              headline={translateText("{name} takes the island.", { name: victoryWinner.name })}
              winnerName={victoryWinner.name}
              winnerColor={victoryWinner.color}
              totalPoints={victoryWinner.score}
              pointsUnit={translateText("points")}
              summary={translateText("The host can return everyone to the lobby for a rematch.")}
              breakdown={victoryBreakdownRows(victoryWinner.scoreBreakdown, translateText, game.variant)}
              diceCounts={game.diceRollTotals}
            >
              <button className="button-primary" onClick={() => setDialog("leave")}>
                <LeaveIcon />
                {translateText("Leave room")}
              </button>
              <button className="button-secondary" onClick={() => setVictoryDismissed(true)}>
                <EyeIcon />
                {translateText("View your hand")}
              </button>
            </VictoryDialog>
          )}
        </div>}
      </main>
      {!host && game && !game.winnerId && snapshot?.privatePlayer && <PrivateNotices key={game.gameId} thefts={snapshot.privateThefts} monopolies={snapshot.privateMonopolies} sabotages={playerSabotages} tradeOutcomes={tradeOutcomes} playerId={snapshot.privatePlayer.id} players={game.players} target={privateNoticeTarget} />}
      {!host && view?.status === "closed" && !roomClosedDismissed && <Dialog title={translateText("Room closed")} onClose={() => setRoomClosedDismissed(true)}>
        <p className="mb-5 text-sm leading-6">{translateText("The host closed this room. Start a new room or return home to keep playing.")}</p>
        <div className="flex flex-wrap gap-3">
          <a className="button-secondary flex-1 text-center" href="/">{translateText("Back to home")}</a>
          <a className="button-primary flex-1 text-center" href="/?multiplayer=1">{translateText("Start another room")}</a>
        </div>
      </Dialog>}
      {dialog === "activity" && host && game && <Dialog title={translateText("Table activity")} onClose={() => setDialog(null)}>
        {game.log.length === 0
          ? <p className="text-sm text-muted">{translateText("No activity yet.")}</p>
          : <ol className="space-y-3 text-sm text-muted">{game.log.slice(-20).map((entry, index) => <li key={index}>{formatGameMessage(language, entry)}</li>)}</ol>}
      </Dialog>}
      {dialog === "theme" && <Dialog title={translateText("Choose your theme")} onClose={() => setDialog(null)} wide><ThemeSelector value={boardThemeId} onChange={theme => {
        setBoardThemeId(theme);
        if (host) session.current?.setBoardTheme(theme);
      }} /></Dialog>}
      {dialog === "invitation" && host && <Dialog title={translateText("Room invitation")} onClose={() => setDialog(null)}>
        <p className="mb-5 text-sm leading-6">{translateText("Share this code or link to let a disconnected player rejoin their seat with the same profile or name.")}</p>
        <div className="flex flex-col items-center">
          {invitationQr}
          {invitationLink}
        </div>
      </Dialog>}
      {dialog === "help" && <HelpDialog variant={game?.variant ?? snapshot?.variant ?? "original"} victoryPointsToWin={game?.victoryPointsToWin ?? snapshot?.victoryPointsToWin} sabotageEnabled={game ? game.sabotageEnabled === true : isCustomSabotageEnabled(snapshot?.customMapConfig)} multiplayer onClose={() => setDialog(null)} />}
      {dialog === "settings" && <BoardSettingsDialog {...boardSettings} onClose={() => setDialog(null)} />}
      {dialog === "reset" && host && game && <Dialog title={translateText("Reset this game?")} onClose={() => setDialog(null)}>
        <p className="mb-5 text-sm leading-6">{translateText("Restart from the first settlement on the same island with the same players. All current progress will be lost.")}</p>
        <div className="flex gap-3">
          <button className="button-secondary" onClick={() => setDialog(null)}>{translateText("Keep playing")}</button>
          <button className="button-primary" disabled={disabled} onClick={() => {
            session.current?.resetGame();
            setSelected(null);
            setMovingShip(null);
            setDialog(null);
          }}>{translateText("Reset game")}</button>
        </div>
      </Dialog>}
      {dialog === "lobby" && host && game && <Dialog title={translateText("Return to the lobby?")} onClose={() => setDialog(null)}>
        <p className="mb-5 text-sm leading-6">{translateText("End this game for everyone and return to the lobby with the same island and players. All current progress will be lost.")}</p>
        <div className="flex gap-3">
          <button className="button-secondary" onClick={() => setDialog(null)}>{translateText("Keep playing")}</button>
          <button className="button-primary" disabled={disabled} onClick={() => {
            session.current?.endGame();
            setSelected(null);
            setMovingShip(null);
            setDialog(null);
          }}>{translateText("Return to lobby")}</button>
        </div>
      </Dialog>}
      {dialog === "leave" && <Dialog title={translateText(host ? "Close this room?" : "Leave this room?")} onClose={() => setDialog(null)}>
        <p className="mb-5 text-sm leading-6">{translateText(host ? "The board holds the game in memory. Closing it ends the game for everyone; there is no automatic host transfer or saved game." : "Your seat stays reserved while the host remains open. Open the invitation in this tab to reconnect.")}</p>
        <div className="flex gap-3"><button className="button-secondary" onClick={() => setDialog(null)}>{translateText("Keep playing")}</button><button className="button-primary" onClick={() => {
          if (host) {
            session.current?.announceClose?.();
            setDialog(null);
            window.setTimeout(() => {
              session.current?.close();
              session.current = null;
              window.location.href = "/";
            }, 120);
          } else {
            session.current?.close();
            session.current = null;
            window.location.href = "/";
          }
        }}>{translateText("Leave room")}</button></div>
      </Dialog>}
    </div>
  </BoardThemeContext>;
}
