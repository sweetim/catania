import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { match } from "ts-pattern";
import { Board } from "../components/Board";
import { BankSupply, CardStack, Cost, DevelopmentCardIcon, Dialog, Logo, PieceIcon, RESOURCE_NAMES, ResourceCardStepper, ResourceInventory } from "../components/GameUi";
import { ThemeSelector } from "../components/ThemeSelector";
import { COSTS, emptyResources, RESOURCES, resourceTotal } from "../game/engine";
import type { DevelopmentKind, GameAction, Player, Resource, Resources } from "../game/types";
import { BOARD_THEMES, BoardThemeContext, type BoardThemeId } from "../themes";
import { hostSession, joinSession } from "./session";
import type { BuildMode, Invitation, MultiplayerSession, PublicGame, RoomSnapshot, SessionView } from "./types";
import "../index.css";

const DEVELOPMENT_NAMES: Record<DevelopmentKind, string> = {
  knight: "Knight",
  "victory-point": "Victory point",
  "road-building": "Road building",
  "year-of-plenty": "Year of plenty",
  monopoly: "Monopoly",
};

function phaseInstruction(game: PublicGame) {
  return match(game.phase)
    .with({ type: "setup-settlement" }, () => "Place a settlement on the shared board.")
    .with({ type: "setup-road" }, () => "Place a road beside your new settlement on the shared board.")
    .with({ type: "roll" }, () => "Roll the dice on your phone. You may play an eligible development card first.")
    .with({ type: "actions" }, () => "Build on the shared board. Trade, play cards, or end your turn on your phone.")
    .with({ type: "discard" }, () => "Players with a discard obligation must choose cards on their own phones.")
    .with({ type: "robber" }, () => "Move the robber to a different hex on the shared board.")
    .with({ type: "steal" }, () => "Choose a neighboring player to steal from on your phone.")
    .with({ type: "road-building" }, phase => `Place ${phase.remaining} free road${phase.remaining === 1 ? "" : "s"} on the shared board.`)
    .with({ type: "finished" }, () => "The island has a winner. Public scores now include hidden victory points.")
    .exhaustive();
}

function PlayerList({ snapshot }: { snapshot: RoomSnapshot }) {
  const players = snapshot.game?.players ?? snapshot.players;
  return <ul aria-label="Players" className={`grid gap-2 ${snapshot.game ? "sm:grid-cols-2 lg:grid-cols-4" : ""}`}>
    {players.map(player => {
      const statistics = snapshot.game?.players.find(candidate => candidate.id === player.id);
      return <li key={player.id} className={`panel min-w-0 p-3 ${snapshot.game?.activePlayerId === player.id ? "player-seat-active" : ""}`}>
      <div className="flex items-center gap-2">
        <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: player.color }} />
        <strong className="min-w-0 break-words text-sm">{player.name}</strong>
        <span className="ml-auto text-[10px] text-muted">{player.connected ? "Connected" : "Disconnected"}</span>
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
  </ul>;
}

function PlayerControls({ snapshot, disabled, perform, selectBuild }: {
  snapshot: RoomSnapshot;
  disabled: boolean;
  perform: (action: GameAction, expectedVersion: number) => void;
  selectBuild: (piece: BuildMode) => void;
}) {
  const game = snapshot.game!;
  const player = snapshot.privatePlayer!;
  const active = player.id === game.activePlayerId;
  const normalActions = active && game.phase.type === "actions" && !game.winnerId;
  const [editor, setEditor] = useState<"trade" | "price" | "development" | null>(null);
  const [editorVersion, setEditorVersion] = useState(snapshot.version);
  const [tradeMode, setTradeMode] = useState<"bank" | "offer" | "request">("bank");
  const [giveResource, setGiveResource] = useState<Resource>("wood");
  const [receiveResource, setReceiveResource] = useState<Resource>("brick");
  const [give, setGive] = useState(emptyResources);
  const [receive, setReceive] = useState(emptyResources);
  const [chosen, setChosen] = useState(emptyResources);
  const [chosenResource, setChosenResource] = useState<Resource>("wood");
  const [card, setCard] = useState<Player["developmentCards"][number] | null>(null);
  const discardCount = game.phase.type === "discard" ? game.phase.required[player.id] : undefined;
  const canPay = (cost: Resources) => RESOURCES.every(resource => player.resources[resource] >= cost[resource]);
  const trade = game.trade;
  const tradeOwner = game.players.find(other => other.id === trade?.offeredBy);
  let tradeRatio = 4;
  for (const port of game.board.ports) {
    const edge = game.board.edges.find(candidate => candidate.id === port.edgeId)!;
    if (edge.vertexIds.some(vertexId => game.board.vertices.find(vertex => vertex.id === vertexId)?.building?.playerId === player.id)) {
      if (port.resource === giveResource) tradeRatio = 2;
      else if (port.resource === "any") tradeRatio = Math.min(tradeRatio, 3);
    }
  }

  useEffect(() => { setChosen(emptyResources()); }, [game.phase.type]);

  function send(action: GameAction) {
    // A dialog must not submit an old choice against a newer trade or turn.
    perform(action, editor ? editorVersion : snapshot.version);
    setEditor(null);
  }

  return <div className="mx-auto grid w-full max-w-4xl grid-cols-1 gap-4 lg:grid-cols-2">
    <section className="panel min-w-0 p-5" aria-labelledby="private-hand-title">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div><p className="eyebrow">Only on your device</p><h1 id="private-hand-title" className="mt-1 font-serif text-3xl">Your cards</h1></div>
        <div className="min-w-0 max-w-full text-right"><strong className="block break-words" style={{ color: player.color }}>{player.name}</strong><p className="text-xs text-muted">{snapshot.privateScore} total points</p></div>
      </div>
      <ResourceInventory resources={player.resources} />
      {player.developmentCards.length > 0 && <section className="mt-5" aria-label="Your development cards">
        <h2 className="mb-3 font-serif text-xl">Development cards</h2>
        <div className="grid gap-2">
          {player.developmentCards.map(ownedCard => <button key={ownedCard.id} className="button-secondary justify-start text-left"
            disabled={disabled || !active || !["roll", "actions"].includes(game.phase.type) || game.developmentPlayed || ownedCard.kind === "victory-point" || ownedCard.purchasedTurn >= game.turnNumber}
            onClick={() => { setCard(ownedCard); setChosen(emptyResources()); setEditorVersion(snapshot.version); setEditor("development"); }}>
            <DevelopmentCardIcon kind={ownedCard.kind} />
            <span>{DEVELOPMENT_NAMES[ownedCard.kind]}<span className="block text-[10px] font-normal text-muted">{ownedCard.kind === "victory-point" ? "Counts automatically toward your score" : ownedCard.purchasedTurn >= game.turnNumber ? "Available on a later turn" : "One action card per turn"}</span></span>
          </button>)}
        </div>
      </section>}
    </section>

    <section className="panel min-w-0 p-5" aria-label="Your actions">
      <h2 className="font-serif text-2xl">{active ? "Your turn" : "Around the table"}</h2>
      <p className="my-3 text-sm leading-6 text-muted">{phaseInstruction(game)}</p>
      <div className="grid grid-cols-2 gap-2">
        <button className="button-primary" disabled={disabled || !active || game.phase.type !== "roll"} onClick={() => send({ type: "roll" })}>Roll the dice</button>
        <button className="button-secondary" disabled={disabled || !normalActions} onClick={() => send({ type: "end-turn" })}>End turn</button>
      </div>
      {discardCount !== undefined && <fieldset disabled={disabled} className="mt-5 space-y-4 border-t border-line pt-5">
        <legend className="sr-only">Discard resources</legend>
        <p className="text-sm font-semibold">Discard {discardCount} cards ({resourceTotal(chosen)} selected)</p>
        <ResourceCardStepper label="Discard" values={chosen} maximum={player.resources} onChange={setChosen} />
        <button className="button-primary w-full" disabled={resourceTotal(chosen) !== discardCount || !canPay(chosen)} onClick={() => send({ type: "discard", resources: chosen })}>Confirm discard</button>
      </fieldset>}
      {active && game.phase.type === "steal" && <div className="mt-5 grid gap-2">
        <h3 className="text-sm font-semibold">Steal one random resource</h3>
        {game.phase.victimIds.map(playerId => <button key={playerId} className="button-secondary" disabled={disabled} onClick={() => send({ type: "steal", playerId })}>Steal from {game.players.find(other => other.id === playerId)?.name}</button>)}
      </div>}
      {active && game.canCancelKnight && <button className="button-secondary mt-4 w-full" disabled={disabled} onClick={() => send({ type: "cancel-knight" })}>Cancel Knight</button>}
      {active && game.phase.type === "road-building" && snapshot.boardTargets.edges.length === 0 && <button className="button-secondary mt-4 w-full" disabled={disabled} onClick={() => send({ type: "skip-roads" })}>Finish Road Building</button>}
      <div className="mt-5 grid gap-2 border-t border-line pt-5">
        {(["road", "settlement", "city"] as const).map(piece => <button key={piece} className="button-secondary flex-wrap justify-between text-left" aria-label={`Build ${piece}`} aria-pressed={snapshot.buildMode === piece}
          disabled={disabled || !normalActions || !canPay(COSTS[piece])}
          onClick={() => selectBuild(snapshot.buildMode === piece ? null : piece)}>
          <span className="flex items-center gap-2"><PieceIcon piece={piece} />Build {piece}</span><Cost resources={COSTS[piece]} />
        </button>)}
        {snapshot.buildMode && active && <p className="py-1 text-sm text-muted">Choose your {snapshot.buildMode} location on the shared board.</p>}
        <button className="button-secondary flex-wrap justify-between text-left" aria-label="Buy development card" disabled={disabled || !normalActions || !canPay(COSTS.development) || game.developmentRemaining === 0} onClick={() => send({ type: "buy-development" })}>
          <span>Buy development card</span><Cost resources={COSTS.development} />
        </button>
        <button className="button-primary" disabled={disabled || !normalActions} onClick={() => { setGive(emptyResources()); setReceive(emptyResources()); setEditorVersion(snapshot.version); setEditor("trade"); }}>Trade resources</button>
      </div>
    </section>

    {trade && <section className="panel space-y-4 p-5 lg:col-span-2" aria-label="Player trade">
      <h2 className="font-serif text-2xl">{tradeOwner?.name}&apos;s trade</h2>
      <CardStack resources={trade.receive} label={active ? "You receive" : "You give"} />
      {trade.give && <CardStack resources={trade.give} label={active ? "You give" : "You receive"} />}
      {trade.offeredBy === player.id ? <>
        {Object.entries(trade.responses).map(([playerId, price]) => <div key={playerId} className="rounded-xl border border-line p-3">
          <p className="mb-2 text-sm">{game.players.find(other => other.id === playerId)?.name}: {price === false ? "Declined" : "Ready to trade"}</p>
          {price !== false && <><CardStack resources={price} label="You give" /><button className="button-primary mt-3" disabled={disabled || !canPay(price)} onClick={() => send({ type: "complete-trade", playerId })}>Trade with {game.players.find(other => other.id === playerId)?.name}</button></>}
        </div>)}
        {Object.keys(trade.responses).length === 0 && <p className="text-sm text-muted">Waiting for the other players to respond on their phones.</p>}
        <button className="button-secondary" disabled={disabled} onClick={() => send({ type: "cancel-trade" })}>Withdraw trade</button>
      </> : <div className="flex flex-wrap gap-2">
        {trade.give ? <button className="button-primary" disabled={disabled || !canPay(trade.receive)} onClick={() => send({ type: "respond-trade", accept: true })}>Accept offer</button>
          : <button className="button-primary" disabled={disabled || !canPay(trade.receive)} onClick={() => { setGive(emptyResources()); setEditorVersion(snapshot.version); setEditor("price"); }}>Propose a price</button>}
        <button className="button-secondary" disabled={disabled} onClick={() => send({ type: "respond-trade", accept: false })}>Decline trade</button>
        {trade.responses[player.id] !== undefined && <p className="w-full text-sm text-muted">Response sent. Cards move only when the active player confirms the exchange.</p>}
      </div>}
    </section>}

    {editor && <Dialog title={editor === "development" ? DEVELOPMENT_NAMES[card!.kind] : editor === "price" ? "Propose a price" : "Trade resources"} onClose={() => setEditor(null)} summary={<ResourceInventory resources={player.resources} />}>
      <fieldset disabled={disabled} className="space-y-5">
        <legend className="sr-only">Choose your action</legend>
        {editor === "trade" && <>
          <label className="block text-sm font-semibold">Trade type<select className="field mt-2" value={tradeMode} onChange={event => setTradeMode(event.target.value as typeof tradeMode)}>
            <option value="bank">Bank / harbor</option><option value="offer">Exact player offer</option><option value="request">Request cards</option>
          </select></label>
          {tradeMode === "bank" ? <>
            <label className="block text-sm">You give ({tradeRatio} cards)<select className="field mt-2" value={giveResource} onChange={event => setGiveResource(event.target.value as Resource)}>{RESOURCES.map(resource => <option key={resource} value={resource}>{RESOURCE_NAMES[resource]}</option>)}</select></label>
            <label className="block text-sm">You receive (1 card)<select className="field mt-2" value={receiveResource} onChange={event => setReceiveResource(event.target.value as Resource)}>{RESOURCES.map(resource => <option key={resource} value={resource}>{RESOURCE_NAMES[resource]}</option>)}</select></label>
            <button className="button-primary w-full" disabled={!normalActions || giveResource === receiveResource || player.resources[giveResource] < tradeRatio || game.bank[receiveResource] === 0} onClick={() => send({ type: "bank-trade", give: giveResource, receive: receiveResource })}>Confirm bank trade</button>
          </> : <>
            {tradeMode === "offer" && <ResourceCardStepper label="You give" values={give} maximum={player.resources} onChange={setGive} />}
            <ResourceCardStepper label="You receive" values={receive} onChange={setReceive} />
            <button className="button-primary w-full" disabled={!normalActions || resourceTotal(receive) === 0 || (tradeMode === "offer" && (resourceTotal(give) === 0 || !canPay(give) || RESOURCES.some(resource => give[resource] > 0 && receive[resource] > 0)))} onClick={() => send(tradeMode === "offer" ? { type: "offer-trade", give, receive } : { type: "request-trade", receive })}>Send trade</button>
          </>}
        </>}
        {editor === "price" && <>
          {trade && <CardStack resources={trade.receive} label="You give" />}
          <ResourceCardStepper label="Requested payment" values={give} onChange={setGive} />
          <button className="button-primary w-full" disabled={!trade || trade.give !== null || trade.offeredBy === player.id || !canPay(trade.receive) || resourceTotal(give) === 0 || RESOURCES.some(resource => give[resource] > 0 && trade.receive[resource] > 0)} onClick={() => send({ type: "propose-trade", price: give })}>Send price</button>
        </>}
        {editor === "development" && card && <>
          {card.kind === "year-of-plenty" && <ResourceCardStepper label="Resources to collect" values={chosen} maximum={game.bank} maximumLabel="In bank" onChange={setChosen} />}
          {card.kind === "monopoly" && <label className="block text-sm">Collect all of<select className="field mt-2" value={chosenResource} onChange={event => setChosenResource(event.target.value as Resource)}>{RESOURCES.map(resource => <option key={resource} value={resource}>{RESOURCE_NAMES[resource]}</option>)}</select></label>}
          {card.kind === "knight" && <p className="text-sm leading-6">Move the robber on the shared board, then choose a neighboring player on your phone.</p>}
          {card.kind === "road-building" && <p className="text-sm leading-6">Place two roads for free on the shared board, following the usual placement and piece limits.</p>}
          <button className="button-primary w-full" disabled={!active || !["roll", "actions"].includes(game.phase.type) || game.developmentPlayed || !player.developmentCards.some(owned => owned.id === card.id) || (card.kind === "year-of-plenty" && (resourceTotal(chosen) !== Math.min(2, resourceTotal(game.bank)) || resourceTotal(chosen) === 0 || RESOURCES.some(resource => chosen[resource] > game.bank[resource])))} onClick={() => send({ type: "play-development", cardId: card.id, ...(card.kind === "year-of-plenty" ? { resources: chosen } : {}), ...(card.kind === "monopoly" ? { resource: chosenResource } : {}) })}>Play {DEVELOPMENT_NAMES[card.kind]}</button>
        </>}
      </fieldset>
    </Dialog>}
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
  const snapshot = view?.snapshot;
  const game = snapshot?.game;
  const host = view?.role === "host";
  const activePlayer = game?.players.find(player => player.id === game.activePlayerId);
  const disabled = view?.status !== "connected" || Boolean(view?.pending);

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
    if (view?.invitationUrl) {
      QRCode.toDataURL(view.invitationUrl, { width: 320, margin: 3, errorCorrectionLevel: "M" })
        .then(source => { if (!cancelled) setQrCode(source); })
        .catch(() => { if (!cancelled) setLocalError("Could not render the QR code. Share the invitation link instead."); });
    }
    return () => { cancelled = true; };
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
    <div data-theme={boardThemeId} className="min-h-dvh">
      <header className="mx-auto flex max-w-[1600px] items-center justify-between gap-3 border-b border-line px-5 py-4 sm:px-8">
        <Logo />
        <span className="hidden text-xs text-muted sm:block">One island. Your own hand.</span>
        {view ? <button className="button-secondary" onClick={() => setDialog("leave")}>Leave room</button> : <a className="text-sm underline underline-offset-4" href="/">Single-device play</a>}
      </header>
      <main className={`mx-auto max-w-[1600px] px-4 pb-10 sm:px-8 ${game ? "pt-4" : "pt-10 sm:pt-16"}`}>
        {!view && <section className="mx-auto max-w-xl">
          <p className="eyebrow">Gather around</p>
          <h1 className="mt-3 font-serif text-5xl tracking-tight">{invitation ? "Your seat awaits." : "An island to share."}</h1>
          <p className="mb-8 mt-5 text-sm leading-7 text-muted">{invitation ? "Keep your cards close. Connect your phone to the shared board, then wait for the host to admit you." : "One screen for the board, one phone per player. Connect three or four players on the same Wi-Fi, without a game server."}</p>
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

        {view && <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-xs" role="status">
          <span>{host ? "Shared board" : "Private player screen"} / {view.status === "connected" ? "Connected" : view.status === "connecting" ? "Connecting through PeerJS Cloud..." : view.status === "closed" ? "Room closed" : "Connection lost"}{view.pending && " / Waiting for the host"}</span>
          {view.status === "disconnected" && <button className="button-secondary" onClick={() => session.current?.reconnect()}>Reconnect</button>}
          {view.status === "closed" && <a className="underline underline-offset-4" href="/?multiplayer=1">Start another room</a>}
        </div>}
        {(localError || view?.error) && <p role="alert" className="mx-auto mb-5 max-w-4xl rounded-xl border border-clay/40 bg-white p-4 text-sm text-clay">{[localError, view?.error].filter(Boolean).join(" ")}</p>}

        {view && !game && <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-2">
          {host && <section className="panel flex min-w-0 flex-col items-center p-6">
            <p className="eyebrow">Welcome to the table</p>
            <h1 className="my-3 font-serif text-3xl">Scan. Join. Settle in.</h1>
            {qrCode ? <img src={qrCode} alt="Scan to join this game" className="aspect-square w-full max-w-72 rounded-xl" width={320} height={320} /> : <p className="py-16 text-sm text-muted">Preparing your invitation...</p>}
            {view.invitationUrl && <div className="mt-4 w-full">
              <label className="block text-xs text-muted">Game invitation<input className="field mt-2 text-xs" readOnly value={view.invitationUrl} onFocus={event => event.target.select()} /></label>
              <button className="button-secondary mt-3 w-full" onClick={async () => { try { await navigator.clipboard.writeText(view.invitationUrl!); setCopied(true); setLocalError(""); } catch { setLocalError("Select and copy the invitation link to share it."); } }}>{copied ? "Invitation copied" : "Copy invitation"}</button>
            </div>}
            <p className="mt-4 text-center text-xs leading-6 text-muted">Use the same Wi-Fi. Each player needs their own phone. This board does not occupy a player seat.</p>
            {["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname) && <p className="mt-3 text-center text-xs leading-6 text-clay">This invitation uses localhost, which other devices cannot reach. Use the deployed HTTPS website for a real-device game.</p>}
          </section>}
          <section className={`panel min-w-0 p-6 ${host ? "" : "lg:col-span-2"}`}>
            <h2 className="break-words font-serif text-3xl">{snapshot?.playerId ? `Welcome, ${snapshot.players.find(player => player.id === snapshot.playerId)?.name}.` : host ? "Who is joining?" : "Waiting for admission"}</h2>
            {!host && <p className="my-4 text-sm leading-6 text-muted">{snapshot?.playerId ? "Your seat is reserved. The host will start when everyone is connected." : "Ask the host to admit your name on the shared screen. Your hand will appear here when the game starts."}</p>}
            {!host && !snapshot?.playerId && <button className="button-secondary" onClick={() => { session.current?.close(); session.current = null; setView(null); }}>Change name</button>}
            {snapshot && <div className="my-5"><PlayerList snapshot={snapshot} /></div>}
            {host && (snapshot?.pendingPlayers ?? []).map(player => <div key={player.connectionId} className="my-3 flex flex-wrap items-center gap-2 rounded-xl border border-line p-3">
              <strong className="mr-auto break-words text-sm">{player.name}</strong>
              <button className="button-primary" aria-label={`Admit ${player.name}`} disabled={disabled} onClick={() => session.current?.admit(player.connectionId)}>Admit</button>
              <button className="button-secondary" aria-label={`Decline ${player.name}`} disabled={disabled} onClick={() => session.current?.reject(player.connectionId)}>Decline</button>
            </div>)}
            {host && <>
              <p className="my-5 text-xs leading-6 text-muted">Admit three or four players with distinct names. Turn order is randomized when the game starts.</p>
              <ThemeSelector value={boardThemeId} onChange={setBoardThemeId} />
              <button className="button-primary mt-6 w-full" disabled={disabled || !snapshot || snapshot.players.length < 3 || snapshot.players.some(player => !player.connected)} onClick={() => session.current?.startGame()}>Start game</button>
            </>}
          </section>
        </div>}

        {game && snapshot && <div className="space-y-4">
          <section aria-label="Turn status" className="panel flex flex-wrap items-center justify-between gap-3 p-4" aria-live="polite">
            <div className="min-w-0 max-w-full break-words">
              <p className="eyebrow">{game.turnNumber === 0 ? "Setup" : `Turn ${game.turnNumber}`}</p>
              <h2 className="mt-1 font-serif text-2xl">{game.winnerId ? `${game.players.find(player => player.id === game.winnerId)?.name} wins!` : `${activePlayer?.name}'s turn`}</h2>
              <p data-testid="game-phase" data-phase={game.phase.type} data-active-player={activePlayer?.name} className="mt-1 text-sm text-muted">{phaseInstruction(game)}</p>
            </div>
            <p aria-label="Dice result" className="shrink-0 rounded-xl bg-moss px-5 py-3 text-lg font-semibold tabular-nums">{game.dice ? `${game.dice[0]} + ${game.dice[1]} = ${game.dice[0] + game.dice[1]}` : "Dice not rolled"}</p>
          </section>
          {host ? <>
            <PlayerList snapshot={snapshot} />
            <div className="flex flex-wrap items-center gap-2">
              <div className="w-full min-w-0 lg:w-auto lg:flex-1"><BankSupply resources={game.bank} developmentCards={game.developmentRemaining} /></div>
              {(["road", "settlement", "city"] as const).map(piece => <button key={piece} className="button-secondary" aria-pressed={snapshot.buildMode === piece} disabled={disabled || game.phase.type !== "actions"} onClick={() => session.current?.selectBuild(snapshot.buildMode === piece ? null : piece, snapshot.version)}>Build {piece}</button>)}
            </div>
            <section aria-label="Shared game board" className="board-tablemat h-[65dvh] min-h-[430px] sm:h-[70dvh]">
              <Board board={game.board} players={game.players} robberTileId={game.robberTileId} fit
                legalVertexIds={snapshot.boardTargets.vertices} legalEdgeIds={snapshot.boardTargets.edges} legalTileIds={snapshot.boardTargets.tiles}
                interactive={!disabled && !game.winnerId} selectedId={currentSelection?.id} showBlockedSettlementLocations
                rolledNumber={game.dice ? game.dice[0] + game.dice[1] : undefined}
                onChangeTheme={() => setDialog("theme")}
                onSelect={(kind, id) => setSelected({ kind, id, version: snapshot.version })}
                confirmation={selectedAction ? { title: selectedAction.type === "move-robber" ? "Move the robber here?" : `Confirm ${selectedAction.type.replace("place-", "")}?`, onConfirm: () => { session.current?.perform(selectedAction, currentSelection!.version); setSelected(null); }, onCancel: () => setSelected(null) } : undefined}
              />
            </section>
          </> : snapshot.privatePlayer ? <>
            <PlayerControls snapshot={snapshot} disabled={disabled} perform={(action, expectedVersion) => session.current?.perform(action, expectedVersion)} selectBuild={piece => session.current?.selectBuild(piece, snapshot.version)} />
            <details className="panel mx-auto max-w-4xl p-4"><summary className="cursor-pointer text-sm font-semibold">All players and bank</summary><div className="mt-4 space-y-3"><PlayerList snapshot={snapshot} /><BankSupply resources={game.bank} developmentCards={game.developmentRemaining} /></div></details>
          </> : <p className="text-sm text-muted">Waiting for your private player information.</p>}
          <details className="panel mx-auto max-w-4xl p-4"><summary className="cursor-pointer text-sm font-semibold">Table activity</summary><ol className="mt-3 space-y-2 text-xs leading-5 text-muted">{game.log.slice(-12).map((entry, index) => <li key={`${index}-${entry}`}>{entry}</li>)}</ol></details>
        </div>}
      </main>
      {dialog === "theme" && <Dialog title="Choose your theme" onClose={() => setDialog(null)}><ThemeSelector value={boardThemeId} onChange={setBoardThemeId} /></Dialog>}
      {dialog === "leave" && <Dialog title={host ? "Close this room?" : "Leave this room?"} onClose={() => setDialog(null)}>
        <p className="mb-5 text-sm leading-6">{host ? "The board holds the game in memory. Closing it ends the game for everyone; there is no automatic host transfer or saved game." : "Your seat stays reserved while the host remains open. Open the invitation in this tab to reconnect."}</p>
        <div className="flex gap-3"><button className="button-secondary" onClick={() => setDialog(null)}>Keep playing</button><button className="button-primary" onClick={() => { session.current?.close(); session.current = null; window.location.href = "/"; }}>Leave room</button></div>
      </Dialog>}
    </div>
  </BoardThemeContext>;
}
