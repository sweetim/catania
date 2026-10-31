import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { match } from "ts-pattern";
import { Board } from "../components/Board";
import { BankSupply, BuildButton, Cost, Dialog, Logo, PieceIcon, RESOURCE_NAMES, ResourceCard, ResourceInventory } from "../components/GameUi";
import { ActionConfirmation, DevelopmentDialog, DiscardSelection, TheftChoices } from "../components/GameplayDialogs";
import { OpenTrade } from "../components/OpenTrade";
import { PlayerSeat } from "../components/PlayerSeat";
import { DevelopmentHand } from "../components/DevelopmentHand";
import { getPhaseInstructions, TurnInstructions } from "../components/TurnInstructions";
import { TradeDialog } from "../components/TradeDialog";
import { ThemeSelector } from "../components/ThemeSelector";
import { TheftNotice } from "../components/TheftNotice";
import { COSTS, emptyResources, RESOURCES, resourceTotal } from "../game/engine";
import type { GameAction, Resources } from "../game/types";
import { BOARD_THEMES, BoardThemeContext, type BoardThemeId } from "../themes";
import { hostSession, joinSession } from "./session";
import { validName } from "./protocol";
import { MultiplayerDice } from "./MultiplayerDice";
import type { BuildMode, Invitation, MultiplayerSession, RoomSnapshot, SessionView } from "./types";
import "../index.css";

function PlayerList({ snapshot, removePlayer, renameComputer, disabled }: {
  snapshot: RoomSnapshot;
  removePlayer?: (playerId: string) => void;
  renameComputer?: (playerId: string, name: string) => void;
  disabled?: boolean;
}) {
  const [editing, setEditing] = useState<{ playerId: string; name: string } | null>(null);
  const players = snapshot.game?.players ?? snapshot.players;
  const normalizedName = editing?.name.trim().normalize("NFC") ?? "";
  const existingNames = [...snapshot.players.filter(player => player.id !== editing?.playerId).map(player => player.name), ...(snapshot.pendingPlayers ?? []).map(player => player.name)];
  const nameError = !validName(editing?.name) ? "Use 1 to 20 characters, without control characters."
    : existingNames.some(name => name.toLowerCase() === normalizedName.toLowerCase()) ? "That name is already in the room. Choose another name." : "";
  return <><ul aria-label="Players" className={`grid gap-2 ${snapshot.game ? "sm:grid-cols-2 lg:grid-cols-4" : ""}`}>
    {players.map(player => {
      const statistics = snapshot.game?.players.find(candidate => candidate.id === player.id);
      return <li key={player.id} className={`panel min-w-0 p-3 ${snapshot.game?.activePlayerId === player.id ? "player-seat-active" : ""}`}>
      <div className="flex items-center gap-2">
        <svg role="img" aria-label={player.control === "computer" ? "Computer player" : "Human player"} className="h-8 w-8 shrink-0 rounded-full border p-1.5" style={{ color: player.color, borderColor: `${player.color}66`, backgroundColor: `${player.color}14` }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          {player.control === "computer" ? <>
            <path d="M12 3v4M3 12v4M21 12v4" />
            <rect x="5" y="7" width="14" height="13" rx="4" />
            <path d="M9 16h6" />
            <circle cx="9" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="15" cy="12" r="1" fill="currentColor" stroke="none" />
          </> : <><circle cx="12" cy="8" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></>}
        </svg>
        <div className="min-w-0 flex-1">
          {!snapshot.game && player.control === "computer" && renameComputer
            ? <button className="min-h-11 max-w-full break-words text-left text-sm font-semibold underline decoration-line decoration-dotted underline-offset-4 disabled:opacity-50" aria-label={`Rename ${player.name}`} disabled={disabled} onClick={() => setEditing({ playerId: player.id, name: player.name })}>{player.name}</button>
            : <strong className="block break-words text-sm">{player.name}</strong>}
          {player.control === "human" && <span className="text-[10px] text-muted">{player.connected ? "Connected" : "Disconnected"}</span>}
        </div>
        {!snapshot.game && removePlayer && <button className="button-secondary shrink-0 px-2 py-2 text-xs sm:px-3" aria-label={`Remove ${player.name}`} disabled={disabled} onClick={() => removePlayer(player.id)}>Remove</button>}
      </div>
      {statistics && <>
        <p className="mt-2 text-xs">{statistics.score} points / {statistics.resourceCount} resource cards / {statistics.developmentCount} development cards</p>
        <p className="mt-1 text-[11px] text-muted">{statistics.knightsPlayed} played Knights / Longest road: {statistics.longestRoad}</p>
        <p className="text-[11px] font-semibold">
          {snapshot.game?.awards.longestRoad === player.id && "Longest Road (+2) "}
          {snapshot.game?.awards.largestArmy === player.id && "Largest Army (+2)"}
        </p>
      </>}
    </li>; })}
  </ul>
    {!snapshot.game && editing && renameComputer && <Dialog title="Rename computer" onClose={() => setEditing(null)}>
      <form className="space-y-4" onSubmit={event => {
        event.preventDefault();
        if (disabled || nameError) return;
        renameComputer(editing.playerId, normalizedName);
        setEditing(null);
      }}>
        <label className="block text-sm font-semibold">Computer name<input className="field mt-2" value={editing.name} maxLength={20} autoComplete="off" aria-invalid={Boolean(nameError)} aria-describedby="computer-name-help" disabled={disabled} onChange={event => setEditing({ ...editing, name: event.target.value })} /></label>
        <p id="computer-name-help" aria-live="polite" className={`text-xs ${nameError ? "text-clay" : "text-muted"}`}>{nameError || "Choose a distinct name for this computer player."}</p>
        <div className="flex gap-3">
          <button type="button" className="button-secondary flex-1" onClick={() => setEditing(null)}>Cancel</button>
          <button type="submit" className="button-primary flex-1" disabled={disabled || Boolean(nameError)}>Save name</button>
        </div>
      </form>
    </Dialog>}
  </>;
}

function PlayerControls({ snapshot, disabled, error, perform, selectBuild }: {
  snapshot: RoomSnapshot;
  disabled: boolean;
  error: string;
  perform: (action: GameAction, expectedVersion: number) => void;
  selectBuild: (piece: BuildMode) => void;
}) {
  const game = snapshot.game!;
  const player = snapshot.privatePlayer!;
  const active = player.id === game.activePlayerId;
  const activePlayer = game.players.find(other => other.id === game.activePlayerId)!;
  const ownStatistics = game.players.find(other => other.id === player.id)!;
  const highestPublicScore = Math.max(...game.players.map(other => other.score));
  const totalScore = snapshot.privateScore ?? ownStatistics.score;
  const normalActions = active && game.phase.type === "actions" && !game.winnerId;
  const [details, setDetails] = useState<"table" | "activity" | "discard" | "steal" | "trade-response" | null>(null);
  const [editor, setEditor] = useState<"trade" | "development" | null>(null);
  const [developmentCardId, setDevelopmentCardId] = useState<string | null>(null);
  const [tradeMode, setTradeMode] = useState<"bank" | "players">("bank");
  const [editorVersion, setEditorVersion] = useState(snapshot.version);
  const [responseVersion, setResponseVersion] = useState<number | null>(null);
  const [confirmation, setConfirmation] = useState<{
    action: GameAction;
    title: string;
    description?: string;
    exchange?: { give: Resources; receive: Resources };
    version: number;
    returnTo?: "steal" | "trade-response";
  } | null>(null);
  const [chosen, setChosen] = useState(emptyResources);
  const discardCount = game.phase.type === "discard" ? game.phase.required[player.id] : undefined;
  const canPay = (cost: Resources) => RESOURCES.every(resource => player.resources[resource] >= cost[resource]);
  const trade = game.trade;
  const tradeIdentity = trade ? JSON.stringify([trade.offeredBy, trade.give, trade.receive]) : null;
  const staleMessage = "The game changed. Close and reopen this dialog to review the latest state.";
  const editorStale = editorVersion !== snapshot.version;
  const responseStale = responseVersion !== null && responseVersion !== snapshot.version;

  useEffect(() => { setChosen(emptyResources()); }, [game.phase.type]);

  useEffect(() => {
    setChosen(emptyResources());
    setResponseVersion(null);
  }, [tradeIdentity]);

  useEffect(() => {
    if (discardCount !== undefined || (active && game.phase.type === "steal") || trade) {
      setEditor(null);
      setConfirmation(null);
      setDetails(discardCount !== undefined ? "discard" : active && game.phase.type === "steal" ? "steal" : "trade-response");
    } else {
      setDetails(current => current === "discard" || current === "steal" || current === "trade-response" ? null : current);
    }
  }, [discardCount, active && game.phase.type === "steal", tradeIdentity]);

  function send(action: GameAction, expectedVersion = snapshot.version) {
    // A dialog must not submit an old choice against a newer trade or turn.
    perform(action, expectedVersion);
    setEditor(null);
    setDetails(null);
    setConfirmation(null);
  }

  const phaseInstructions = getPhaseInstructions({
    phase: game.phase,
    secondSettlement: game.board.vertices.filter(vertex => vertex.building).length >= game.players.length,
    pendingKnight: game.canCancelKnight,
    sharedBoard: true,
  });
  const awaitingPlayer = active || discardCount !== undefined || Boolean(game.winnerId);
  const instructionTitle = awaitingPlayer ? phaseInstructions.title : "The island is in motion.";
  const instructionDescription = game.winnerId ? `${game.players.find(other => other.id === game.winnerId)?.name} wins! ${phaseInstructions.description}`
    : !awaitingPlayer ? activePlayer.control === "computer"
      ? `${activePlayer.name} ${game.trade ? "is considering the trade." : game.phase.type === "discard" ? "is discarding resources." : "is playing automatically."}`
      : `${activePlayer.name} is playing. You can inspect your hand and the island while you wait.`
    : snapshot.buildMode ? `Choose a highlighted location for your ${snapshot.buildMode} on the shared board, then confirm the placement.`
    : phaseInstructions.description;

  return <div className="private-dashboard" aria-label="Your hand and actions">
    <section className="private-player-summary" aria-label="Your player summary">
      <PlayerSeat player={{ ...ownStatistics, resourceCount: resourceTotal(player.resources), developmentCount: player.developmentCards.length }}
        number={game.players.findIndex(other => other.id === player.id) + 1} active={active}
        leading={ownStatistics.score === highestPublicScore && game.players.some(other => other.score < highestPublicScore)}
        largestArmy={game.awards.largestArmy === player.id} longestRoadAward={game.awards.longestRoad === player.id}
        stacked={game.awards.largestArmy === player.id || game.awards.longestRoad === player.id} />
    </section>
    <section className="hand-content private-hand" aria-label="Your cards">
      <section className="hand-resources" aria-label="Your current resources">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="eyebrow min-w-0 truncate">{player.name}&apos;s hand</h2>
          <strong className="shrink-0 rounded-md bg-moss px-2 py-1 text-sm text-ink tabular-nums">{resourceTotal(player.resources)} cards</strong>
        </div>
        <ul aria-label="Cards in hand" className="grid grid-cols-5 gap-1.5 sm:gap-2">
          {RESOURCES.map(resource => <li key={resource} aria-label={`${RESOURCE_NAMES[resource]}: ${player.resources[resource]} in hand`}>
            <ResourceCard resource={resource} count={player.resources[resource]} iconClassName="h-8 w-8" className="hand-resource-card w-full" />
          </li>)}
        </ul>
        <div className="mt-3 flex items-center justify-between rounded-lg bg-moss/80 px-3 py-1.5">
          <span className="text-[11px]">Your victory points</span>
          <span className="text-xs font-semibold">{ownStatistics.score} public + {totalScore - ownStatistics.score} hidden = {totalScore}</span>
        </div>
      </section>
      <section className="hand-building" aria-label="Build a little bigger">
        <h2 className="eyebrow mb-2">Build a little bigger</h2>
        <div className="build-options flex flex-col gap-2">
          {(["road", "settlement", "city"] as const).map(piece => <BuildButton key={piece} piece={piece} color={player.color} resources={COSTS[piece]} aria-label={piece === "city" ? "Upgrade to city" : `Build ${piece}`} aria-pressed={snapshot.buildMode === piece}
            disabled={disabled || !normalActions || !canPay(COSTS[piece])}
            onClick={() => selectBuild(snapshot.buildMode === piece ? null : piece)} />)}
          <BuildButton piece="development" color={player.color} resources={COSTS.development} aria-label="Buy a card" disabled={disabled || !normalActions || !canPay(COSTS.development) || game.developmentRemaining === 0} onClick={() => setConfirmation({
            action: { type: "buy-development" },
            title: "Invest in a development card",
            description: "Pay one wool, one grain, and one ore. Your new card stays private. Action cards cannot be played until a later turn.",
            version: snapshot.version,
          })} />
        </div>
        {discardCount !== undefined ? <button className="button-primary mt-2 w-full px-2" onClick={() => setDetails("discard")}>Discard {discardCount}</button>
          : active && game.phase.type === "steal" ? <button className="button-primary mt-2 w-full px-2" onClick={() => setDetails("steal")}>Choose player</button>
          : trade ? <button className="button-primary mt-2 w-full px-2" onClick={() => { setResponseVersion(null); setChosen(emptyResources()); setDetails("trade-response"); }}>View trade</button>
          : <button className="button-secondary mt-2 w-full px-2" disabled={disabled || !normalActions} onClick={() => { setEditorVersion(snapshot.version); setEditor("trade"); }}>Make a trade</button>}
      </section>
      <DevelopmentHand cards={player.developmentCards} turnNumber={game.turnNumber} onSelect={cardId => { setDevelopmentCardId(cardId); setEditorVersion(snapshot.version); setEditor("development"); }} />
    </section>

    <section className="hand-dice private-turn" aria-label="Turn controls">
      <div className="turn-header">
        <h2 className="turn-owner"><span className="truncate" title={activePlayer.name}>{game.winnerId ? "Game over" : activePlayer.name}</span>{!game.winnerId && <span className="shrink-0 text-xs font-medium text-muted"> - {active ? "Your turn" : "Their turn"}</span>}</h2>
        <span className="turn-number">{game.turnNumber === 0 ? "Setup" : `Turn ${game.turnNumber}`}</span>
      </div>
      <MultiplayerDice game={game} />
      <div data-testid="game-phase" data-phase={game.phase.type} data-active-player={activePlayer.name} className="private-instructions" aria-live="polite">
        <TurnInstructions title={instructionTitle} description={instructionDescription} computerActivity={!awaitingPlayer && activePlayer.control === "computer"} />
      </div>
      <div className="turn-action">
        {active && game.canCancelKnight ? <button className="button-secondary" disabled={disabled} onClick={() => send({ type: "cancel-knight" })}>Cancel Knight</button>
          : <button className="button-primary" disabled={disabled || !active || game.phase.type !== "roll"} onClick={() => send({ type: "roll" })}>Roll the dice</button>}
        {active && game.phase.type === "road-building" && snapshot.boardTargets.edges.length === 0 ? <button className="button-secondary" disabled={disabled} onClick={() => send({ type: "skip-roads" })}>Finish Road Building</button>
          : <button className="button-secondary" disabled={disabled || !normalActions} onClick={() => send({ type: "end-turn" })}>End turn</button>}
      </div>
    </section>

    <nav className="private-navigation" aria-label="Table information">
      <button className="button-secondary" aria-label="All players and bank" onClick={() => setDetails("table")}>Players &amp; bank</button>
      <button className="button-secondary" aria-label="Table activity" onClick={() => setDetails("activity")}>Activity</button>
    </nav>

    {details === "table" && <Dialog title="All players and bank" onClose={() => setDetails(null)} wide><div className="space-y-4"><PlayerList snapshot={snapshot} /><BankSupply resources={game.bank} developmentCards={game.developmentRemaining} /></div></Dialog>}
    {details === "activity" && <Dialog title="Table activity" onClose={() => setDetails(null)}><ol className="space-y-3 text-sm text-muted">{game.log.slice(-12).map((entry, index) => <li key={`${index}-${entry}`}>{entry}</li>)}</ol></Dialog>}
    {details === "discard" && discardCount !== undefined && <Dialog title={`Discard ${discardCount} cards`} onClose={() => setDetails(null)} summary={<ResourceInventory resources={player.resources} />}>
      <DiscardSelection resources={player.resources} required={discardCount} chosenResources={chosen} onChangeResources={setChosen} disabled={disabled} onConfirm={() => send({ type: "discard", resources: chosen })} />
    </Dialog>}
    {details === "steal" && active && game.phase.type === "steal" && <Dialog title="Choose a player to steal from" onClose={() => setDetails(null)}>
      <div className="space-y-2"><TheftChoices players={game.phase.victimIds.map(playerId => game.players.find(other => other.id === playerId)!)} disabled={disabled} onSelect={playerId => {
        const victim = game.players.find(other => other.id === playerId)!;
        setDetails(null);
        setConfirmation({ action: { type: "steal", playerId }, title: "Confirm theft", description: victim.resourceCount > 0 ? `Steal one random resource from ${victim.name}.` : `${victim.name} has no resources. Finish without taking a card.`, version: snapshot.version, returnTo: "steal" });
      }} /></div>
    </Dialog>}
    {details === "trade-response" && trade && <Dialog title={trade.give ? "Trade offer" : "Trade request"} onClose={() => setDetails(null)} summary={<ResourceInventory resources={player.resources} />}>
      <OpenTrade trade={trade} viewer={player} players={game.players} chosenResources={chosen} disabled={disabled || responseStale}
        onChangeResources={resources => { setResponseVersion(current => current ?? snapshot.version); setChosen(resources); }}
        onComplete={(playerId, price) => {
          setDetails(null);
          setConfirmation({ action: { type: "complete-trade", playerId }, title: `Trade with ${game.players.find(other => other.id === playerId)!.name}`, exchange: { give: price, receive: trade.receive }, version: snapshot.version, returnTo: "trade-response" });
        }}
        onEdit={() => { setDetails(null); setTradeMode("players"); setEditorVersion(snapshot.version); setEditor("trade"); }}
        onWithdraw={() => send({ type: "cancel-trade" })}
        onRespond={action => send(action, responseVersion ?? snapshot.version)} />
      {(responseStale || error) && <p role="alert" className="mt-4 text-sm text-clay">{responseStale ? staleMessage : error}</p>}
    </Dialog>}

    {editor === "trade" && <TradeDialog game={game} player={player} initialMode={tradeMode} onModeChange={setTradeMode} initialOffer={trade?.offeredBy === player.id ? trade : undefined} disabled={disabled || !normalActions || editorStale} error={editorStale ? staleMessage : error}
      onClose={() => { setEditor(null); if (trade) setDetails("trade-response"); }} onSubmit={action => send(action, editorVersion)} />}
    {editor === "development" && <DevelopmentDialog player={player} bank={game.bank} turnNumber={game.turnNumber} phaseType={game.phase.type} developmentPlayed={game.developmentPlayed} initialCardId={developmentCardId} active={active} disabled={disabled || editorStale} error={editorStale ? staleMessage : error}
      onClose={() => setEditor(null)} onSubmit={action => send(action, editorVersion)} />}
    {confirmation && <ActionConfirmation title={confirmation.title} description={confirmation.description} exchange={confirmation.exchange} resources={confirmation.action.type === "steal" ? undefined : player.resources}
      disabled={disabled || confirmation.version !== snapshot.version} error={confirmation.version !== snapshot.version ? staleMessage : error}
      onClose={() => { setConfirmation(null); if (confirmation.returnTo) setDetails(confirmation.returnTo); }} onConfirm={() => send(confirmation.action, confirmation.version)} />}
  </div>;
}

export function MultiplayerApp() {
  const [invitation] = useState<Invitation | null>(() => {
    const parameters = new URLSearchParams(window.location.hash.slice(1));
    const hostId = parameters.get("host");
    const secret = parameters.get("secret");
    return hostId && secret ? { hostId, secret } : null;
  });
  const [name, setName] = useState(() => {
    try { return invitation ? sessionStorage.getItem(`catania.multiplayer.name.${invitation.hostId}`) ?? "" : ""; }
    catch { return ""; }
  });
  const [view, setView] = useState<SessionView | null>(null);
  const session = useRef<MultiplayerSession | null>(null);
  const [localError, setLocalError] = useState("");
  const [qrCode, setQrCode] = useState("");
  const [boardThemeId, setBoardThemeId] = useState<BoardThemeId>("illustrated");
  const [dialog, setDialog] = useState<"theme" | "leave" | null>(null);
  const [selected, setSelected] = useState<{ kind: "vertex" | "edge" | "tile"; id: string; version: number } | null>(null);
  const [copied, setCopied] = useState(false);
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
  const disconnectedPlayers = snapshot?.players.filter(player => player.control === "human" && !player.connected) ?? [];

  function connect() {
    if (!invitation || !name.trim()) return;
    session.current?.close();
    setLocalError("");
    try {
      sessionStorage.setItem(`catania.multiplayer.name.${invitation.hostId}`, name.trim());
    } catch { /* The connection still works without persistent browser storage. */ }
    session.current = joinSession(invitation, name.trim(), setView);
  }

  useEffect(() => {
    if (invitation && name.trim()) connect();
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

  const currentSelection = selected?.version === snapshot?.version ? selected : null;
  const selectedAction: GameAction | null = !currentSelection ? null : match(currentSelection.kind)
    .with("tile", () => ({ type: "move-robber" as const, tileId: currentSelection.id }))
    .with("edge", () => ({ type: "place-road" as const, edgeId: currentSelection.id }))
    .with("vertex", () => ({ type: snapshot?.buildMode === "city" ? "place-city" as const : "place-settlement" as const, vertexId: currentSelection.id }))
    .exhaustive();

  return <BoardThemeContext value={BOARD_THEMES[boardThemeId]}>
    <div data-theme={boardThemeId} className={privateGame ? "game-shell private-game-shell" : sharedGame ? "game-shell shared-game-shell" : hostLobby ? "multiplayer-lobby-shell" : "min-h-dvh"}>
      <header className="mx-auto flex max-w-[1600px] items-center justify-between gap-3 border-b border-line px-5 py-4 sm:px-8">
        <Logo />
        {privateGame ? <span className="private-connection" role="status" data-status={view?.status}>{view?.pending ? "Syncing" : view?.status === "connected" ? "Connected" : "Offline"}</span> : sharedGame ? <span className="ml-auto text-[10px] text-muted sm:mx-auto sm:text-xs" role="status"><span className="hidden sm:inline">Shared board / </span>{view?.status === "connected" ? "Connected" : "Offline"}</span> : <span className="hidden text-xs text-muted sm:block">One island. Your own hand.</span>}
        {view ? <button className="button-secondary" onClick={() => setDialog("leave")}>Leave room</button> : <a className="text-sm underline underline-offset-4" href="/">Single-device play</a>}
      </header>
      <main className={privateGame ? "private-game-main" : sharedGame ? "shared-game-main" : hostLobby ? "multiplayer-lobby-main" : `mx-auto max-w-[1600px] px-4 pb-10 sm:px-8 ${game ? "pt-4" : "pt-10 sm:pt-16"}`}>
        {!view && <section className="mx-auto max-w-xl">
          <p className="eyebrow">Gather around</p>
          <h1 className="mt-3 font-serif text-5xl tracking-tight">{invitation ? "Your seat awaits." : "An island to share."}</h1>
          <p className="mb-8 mt-5 text-sm leading-7 text-muted">{invitation ? "Keep your cards close. Connect your phone to the shared board, then wait for the host to admit you." : "One screen for the board, one phone per human player. Fill a three- or four-player table with friends on the same Wi-Fi or computer opponents, without a game server."}</p>
          {invitation ? <form className="panel space-y-4 p-6" onSubmit={event => { event.preventDefault(); connect(); }}>
            <label className="block text-sm font-semibold">Your name<input className="field mt-2" maxLength={20} autoComplete="nickname" value={name} onChange={event => setName(event.target.value)} required /></label>
            <button className="button-primary w-full" disabled={!name.trim()}>Connect to game</button>
          </form> : <div className="panel space-y-5 p-6">
            <h2 className="font-serif text-2xl">Make this the shared board.</h2>
            <p className="text-sm leading-6 text-muted">Players scan the QR code using their phone cameras. This screen shows only public information and stays open for the whole game.</p>
            <button className="button-primary w-full" onClick={() => { setLocalError(""); session.current = hostSession(setView); }}>Host board</button>
          </div>}
          <p className="mt-5 text-xs leading-6 text-muted">PeerJS Cloud helps devices find each other. Gameplay runs in the board browser over direct, encrypted connections. Guest Wi-Fi isolation can prevent connections.</p>
        </section>}

        {view && (!(privateGame || sharedGame || hostLobby) || view.status !== "connected") && <div className={privateGame ? "private-connection-notice" : "mb-4 flex flex-wrap items-center justify-between gap-2 text-xs"} role="status">
          <span>{host ? "Shared board" : "Private player screen"} / {view.status === "connected" ? "Connected" : view.status === "connecting" ? "Connecting through PeerJS Cloud..." : view.status === "closed" ? "Room closed" : "Connection lost"}{view.pending && " / Waiting for the host"}</span>
          {view.status === "disconnected" && <button className="button-secondary" onClick={() => session.current?.reconnect()}>Reconnect</button>}
          {view.status === "closed" && <a className="underline underline-offset-4" href="/?multiplayer=1">Start another room</a>}
        </div>}
        {(localError || view?.error) && <p role="alert" className={privateGame ? "private-game-error" : "mx-auto mb-5 max-w-4xl rounded-xl border border-clay/40 bg-white p-4 text-sm text-clay"}>{[localError, view?.error].filter(Boolean).join(" ")}</p>}

        {view && !game && <div className={`mx-auto grid max-w-5xl gap-6 lg:grid-cols-2 ${host ? "multiplayer-lobby-grid" : ""}`}>
          {host && snapshot?.previewBoard && <section aria-label="Island preview" className="multiplayer-lobby-island panel min-w-0 p-4 sm:p-6">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div><p className="eyebrow">A place to begin</p><h2 className="mt-1 font-serif text-2xl">Your island awaits.</h2></div>
                <button className="button-secondary px-3 text-xs" aria-label="Shuffle island preview" disabled={disabled} onClick={() => session.current?.shuffleBoard()}>Shuffle</button>
              </div>
              <div className="multiplayer-lobby-map h-[320px] min-w-0 sm:h-[420px]">
                <Board board={snapshot.previewBoard} players={[]} robberTileId={snapshot.previewBoard.tiles.find(tile => tile.terrain === "desert")?.id} interactive={false} compact fit onChangeTheme={() => setDialog("theme")} />
              </div>
              <p className="mt-4 text-xs leading-5 text-muted">Shuffle until you find your island. Starting the game keeps this exact map.</p>
          </section>}
          <div className={host ? "multiplayer-lobby-column min-w-0 space-y-6" : "contents"}>
          {host && <section aria-label="Room invitation" className="multiplayer-lobby-invitation panel flex min-w-0 flex-col items-center p-4 sm:p-6">
            <div className="lobby-invitation-heading text-center">
              <p className="eyebrow">Welcome to the table</p>
              <h1 className="my-3 font-serif text-3xl">Scan. Join. Settle in.</h1>
            </div>
            {qrCode ? <img src={qrCode} alt="Scan to join this game" className="lobby-qr aspect-square w-full max-w-80 rounded-xl" width={320} height={320} /> : <p className="lobby-qr py-16 text-sm text-muted">Preparing your invitation...</p>}
            {view.invitationUrl && <div className="lobby-invitation-link mt-4 w-full">
              <label htmlFor="room-invitation-url" className="block text-xs text-muted">Game invitation</label>
              <div className="mt-1 flex min-w-0 items-stretch rounded-xl border border-line bg-white">
                <input id="room-invitation-url" className="min-h-11 min-w-0 flex-1 rounded-l-xl bg-transparent px-3 text-xs" readOnly value={view.invitationUrl} onFocus={event => event.target.select()} />
                <button className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-r-xl border-l border-line px-3 text-xs font-semibold hover:bg-moss" aria-label="Copy invitation" title={copied ? "Invitation copied" : "Copy invitation"} onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(view.invitationUrl!);
                    window.clearTimeout(copyFeedbackTimer.current);
                    setCopied(true);
                    setLocalError("");
                    copyFeedbackTimer.current = window.setTimeout(() => setCopied(false), 2_000);
                  } catch {
                    window.clearTimeout(copyFeedbackTimer.current);
                    setCopied(false);
                    setLocalError("Select and copy the invitation link to share it.");
                  }
                }}>
                  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    {copied ? <path d="m5 12 4 4L19 6" /> : <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" /></>}
                  </svg>
                  <span role="status" className={copied ? "" : "sr-only"}>{copied ? "Copied" : ""}</span>
                </button>
              </div>
            </div>}
          </section>}
          <section className={`panel min-w-0 p-6 ${host ? "multiplayer-lobby-players" : "lg:col-span-2"}`}>
            <h2 className="break-words font-serif text-3xl">{snapshot?.playerId ? `Welcome, ${snapshot.players.find(player => player.id === snapshot.playerId)?.name}.` : host ? "Who is joining?" : view.status === "disconnected" ? "Not connected" : "Waiting for admission"}</h2>
            {!host && <p className="my-4 text-sm leading-6 text-muted">{snapshot?.playerId ? "Your seat is reserved. The host will start when everyone is connected." : view.status === "disconnected" ? "Reconnect to request admission, or change your name before trying again." : "Ask the host to admit your name on the shared screen. Your hand will appear here when the game starts."}</p>}
            {!host && !snapshot?.playerId && <button className="button-secondary" onClick={() => { session.current?.close(); session.current = null; setView(null); }}>Change name</button>}
            {snapshot && <>
              <div id="lobby-readiness" role="status" className="my-4 rounded-xl bg-moss p-4">
                <p className="eyebrow">{playerCount} of 4 seats filled</p>
                <p className="mt-1 text-sm font-semibold">{missingPlayers > 0 ? `${missingPlayers} more player${missingPlayers === 1 ? "" : "s"} needed to start.` : disconnectedPlayers.length > 0 ? "Enough players to start once everyone is connected." : `Ready to start with ${playerCount} players.`}</p>
                {disconnectedPlayers.length > 0 && <p className="mt-2 text-xs text-clay">Waiting for {disconnectedPlayers.map(player => player.name).join(", ")} to reconnect.</p>}
              </div>
              <div className="lobby-roster my-5 space-y-2">
                <PlayerList snapshot={snapshot} disabled={disabled} removePlayer={host ? playerId => session.current?.removePlayer(playerId) : undefined} renameComputer={host ? (playerId, name) => session.current?.renameComputer(playerId, name) : undefined} />
                {playerCount < 4 && <ul aria-label="Open seats" className="grid gap-2">
                  {Array.from({ length: 4 - playerCount }, (_, index) => playerCount + index + 1).map(seat => <li key={seat} className="flex items-center gap-3 rounded-xl border border-dashed border-line p-3 text-muted">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line text-xs">{seat}</span>
                    <div><p className="text-sm font-semibold">{seat < 4 ? "Player needed" : "Optional fourth player"}</p><p className="mt-1 text-xs">{seat < 4 ? "Join by phone or add a computer." : "Start with three, or fill this seat."}</p></div>
                  </li>)}
                </ul>}
              </div>
            </>}
            {host && (snapshot?.pendingPlayers ?? []).map(player => <div key={player.connectionId} className="my-3 flex flex-wrap items-center gap-2 rounded-xl border border-line p-3">
              <strong className="mr-auto break-words text-sm">{player.name}</strong>
              <button className="button-primary" aria-label={`Admit ${player.name}`} disabled={disabled || playerCount >= 4} onClick={() => session.current?.admit(player.connectionId)}>Admit</button>
              <button className="button-secondary" aria-label={`Decline ${player.name}`} disabled={disabled} onClick={() => session.current?.reject(player.connectionId)}>Decline</button>
            </div>)}
            {host && <>
              <div className="grid gap-2 sm:grid-cols-2">
                <button className="button-secondary" disabled={disabled || !snapshot || playerCount >= 4} onClick={() => session.current?.addComputer()}>Add computer</button>
                <button className="button-primary" aria-describedby="lobby-readiness" disabled={disabled || !snapshot || missingPlayers > 0 || disconnectedPlayers.length > 0} onClick={() => session.current?.startGame()}>Start game</button>
              </div>
              <p className="lobby-start-note my-5 text-xs leading-6 text-muted">Play with three or four human or computer players. Turn order is randomized when the game starts.</p>
            </>}
          </section>
          </div>
        </div>}

        {host && game && snapshot && <div className="shared-game-table" data-testid="game-phase" data-phase={game.phase.type} data-active-player={activePlayer?.name}>
          <ul aria-label="Players" className="table-seats shared-table-seats">
            {game.players.map((player, index) => <li key={player.id} className="min-w-0" aria-label={`${player.name}, ${player.control === "computer" ? "Computer player" : player.connected ? "Connected" : "Disconnected"}`}>
              <PlayerSeat player={player} number={index + 1} active={player.id === game.activePlayerId}
                leading={player.score === highestPublicScore && game.players.some(other => other.score < highestPublicScore)}
                largestArmy={game.awards.largestArmy === player.id} longestRoadAward={game.awards.longestRoad === player.id} />
              {player.control === "human" && !player.connected && <p role="status" className="mt-1 px-3 text-xs text-clay">{player.name} disconnected</p>}
            </li>)}
          </ul>
          <section aria-label="Shared game board" className="table-board flex min-w-0 flex-1">
            <div className="board-tablemat">
              <Board board={game.board} players={game.players} robberTileId={game.robberTileId} fit
                legalVertexIds={snapshot.boardTargets.vertices} legalEdgeIds={snapshot.boardTargets.edges} legalTileIds={snapshot.boardTargets.tiles}
                interactive={!disabled && activePlayer?.control !== "computer" && !game.winnerId} selectedId={currentSelection?.id} showBlockedSettlementLocations
                rolledNumber={game.dice ? game.dice[0] + game.dice[1] : undefined}
                onChangeTheme={() => setDialog("theme")}
                onSelect={(kind, id) => setSelected({ kind, id, version: snapshot.version })}
                confirmation={selectedAction ? { title: selectedAction.type === "move-robber" ? "Move the robber here?" : `Confirm ${selectedAction.type.replace("place-", "")}?`, onConfirm: () => { session.current?.perform(selectedAction, currentSelection!.version); setSelected(null); }, onCancel: () => setSelected(null) } : undefined}
              />
            </div>
          </section>
        </div>}
        {!host && game && snapshot && <div className={privateGame ? "private-game-content" : "space-y-4"}>
          {snapshot.privatePlayer ? <PlayerControls key={view?.status} snapshot={snapshot} disabled={disabled} error={view?.error ?? ""} perform={(action, expectedVersion) => session.current?.perform(action, expectedVersion)} selectBuild={piece => session.current?.selectBuild(piece, snapshot.version)} />
            : <p className="text-sm text-muted">Waiting for your private player information.</p>}
        </div>}
      </main>
      {!host && game && !game.winnerId && snapshot?.privatePlayer && <TheftNotice thefts={snapshot.privateThefts} playerId={snapshot.privatePlayer.id} players={game.players} />}
      {dialog === "theme" && <Dialog title="Choose your theme" onClose={() => setDialog(null)} wide><ThemeSelector value={boardThemeId} onChange={setBoardThemeId} /></Dialog>}
      {dialog === "leave" && <Dialog title={host ? "Close this room?" : "Leave this room?"} onClose={() => setDialog(null)}>
        <p className="mb-5 text-sm leading-6">{host ? "The board holds the game in memory. Closing it ends the game for everyone; there is no automatic host transfer or saved game." : "Your seat stays reserved while the host remains open. Open the invitation in this tab to reconnect."}</p>
        <div className="flex gap-3"><button className="button-secondary" onClick={() => setDialog(null)}>Keep playing</button><button className="button-primary" onClick={() => { session.current?.close(); session.current = null; window.location.href = "/"; }}>Leave room</button></div>
      </Dialog>}
    </div>
  </BoardThemeContext>;
}
