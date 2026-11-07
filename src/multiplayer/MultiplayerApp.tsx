import { Fragment, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import QRCode from "qrcode";
import { match } from "ts-pattern";
import { Board } from "../components/Board";
import { MapSeedControls } from "../components/MapSeedControls";
import { BoardSettingsDialog, useBoardSettings } from "../components/BoardSettings";
import { GameMenu } from "../components/GameMenu";
import { HelpDialog } from "../components/HelpDialog";
import { GameVariantSelector, GameVariantSummary } from "../components/GameVariantSelector";
import { FreeRouteChoice, GoldSelection } from "../components/SeafarersControls";
import { BankSupply, BuildButton, Cost, DevelopmentCardIcon, Dialog, Logo, PieceIcon, ResourceCard, ResourceInventory } from "../components/GameUi";
import { ActionConfirmation, DevelopmentDialog, DiscardSelection, TheftChoices } from "../components/GameplayDialogs";
import { OpenTrade } from "../components/OpenTrade";
import { PlayerSeat } from "../components/PlayerSeat";
import { DevelopmentHand } from "../components/DevelopmentHand";
import { VictoryDialog, type VictoryBreakdownRow } from "../components/VictoryDialog";
import { ProfileGate } from "../components/ProfileGate";
import { activeProfile, createProfile, readProfileState, removeProfile, writeProfileState, type PlayerProfile, type ProfileState } from "../profile";
import { getPhaseInstructions, TurnInstructions } from "../components/TurnInstructions";
import { TradeDialog } from "../components/TradeDialog";
import { ThemeSelector } from "../components/ThemeSelector";
import { PrivateNotices } from "../components/PrivateNotices";
import { CollapsibleSection } from "../components/CollapsibleSection";
import { COSTS, emptyResources, legalCityVertices, legalRoadEdges, legalSettlementVertices, legalShipEdges, legalShipDestinations, movableShipEdges, RESOURCES, resourceTotal, victoryTarget } from "../game/engine";
import { pirateStartTileId, seededRandom } from "../game/board";
import { isSeafarers, type GameAction, type GameVariant, type Resources } from "../game/types";
import { formatGameMessage } from "../game/messages";
import { pieceName, resourceName, type TranslationParameters } from "../i18n";
import { useLanguage, useTranslation } from "../localization";
import { BOARD_THEMES, BoardThemeContext, type BoardThemeId } from "../themes";
import { multiplayerUiTranslations } from "../translations/multiplayer-ui";
import { hostSession, joinSession } from "./session";
import { validName, type TradeIdentity } from "./protocol";
import { MultiplayerDice } from "./MultiplayerDice";
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
      return <li key={player.id} style={{ "--seat-pulse-color": player.color } as CSSProperties} className={`panel min-w-0 p-3 ${snapshot.game?.activePlayerId === player.id ? "player-seat-active" : ""}`}>
      <div className="flex items-center gap-2">
        <svg role="img" aria-label={translateText(player.control === "computer" ? "Computer player" : "Human player")} className="h-8 w-8 shrink-0 rounded-full border p-1.5" style={{ color: player.color, borderColor: `${player.color}66`, backgroundColor: `${player.color}14` }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          {player.control === "computer" ? <>
            <path d="M12 3v4M3 12v4M21 12v4" />
            <rect x="5" y="7" width="14" height="13" rx="4" />
            <path d="M9 16h6" />
            <circle cx="9" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="15" cy="12" r="1" fill="currentColor" stroke="none" />
          </> : <><circle cx="12" cy="8" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></>}
        </svg>
        <div className="min-w-0 flex-1">
          {!snapshot.game && player.control === "computer" && renameComputer
            ? <button className="min-h-11 max-w-full break-words text-left text-sm font-semibold underline decoration-line decoration-dotted underline-offset-4 disabled:opacity-50" aria-label={translateText("Rename {name}", { name: player.name })} disabled={disabled} onClick={() => setEditing({ playerId: player.id, name: player.name })}>{player.name}</button>
            : <strong className="block break-words text-sm">{player.name}</strong>}
          {player.control === "human" && <span className="text-[10px] text-muted">{translateText(player.connected ? "Connected" : "Disconnected")}</span>}
        </div>
        {!snapshot.game && removePlayer && <button className="button-secondary shrink-0 px-2 py-2 text-xs sm:px-3" aria-label={translateText("Remove {name}", { name: player.name })} disabled={disabled} onClick={() => removePlayer(player.id)}>{translateText("Remove")}</button>}
      </div>
      {statistics && <>
        <p className="mt-2 text-xs">{translateText("{points} points / {resources} resource cards / {development} development cards", { points: statistics.score, resources: statistics.resourceCount, development: statistics.developmentCount })}</p>
        <p className="mt-1 text-[11px] text-muted">{translateText(isSeafarers(snapshot.variant) ? "{knights} played Knights / Longest route: {roads}" : "{knights} played Knights / Longest road: {roads}", { knights: statistics.knightsPlayed, roads: statistics.longestRoad })}</p>
        <p className="text-[11px] font-semibold">
          {snapshot.game?.awards.longestRoad === player.id && translateText(isSeafarers(snapshot.variant) ? "Longest Route (+2) " : "Longest Road (+2) ")}
          {snapshot.game?.awards.largestArmy === player.id && translateText("Largest Army (+2)")}
        </p>
      </>}
    </li>; })}
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

function PlayerControls({ snapshot, disabled, error, perform, selectBuild, onPrivateNoticeTarget, turnMenu }: {
  snapshot: RoomSnapshot;
  disabled: boolean;
  error: string;
  perform: (action: GameAction, expectedVersion: number, trade?: TradeIdentity) => void;
  selectBuild: (piece: BuildMode) => void;
  onPrivateNoticeTarget: (target: HTMLDivElement | null) => void;
  turnMenu?: ReactNode;
}) {
  const { language } = useLanguage();
  const translateText = useTranslation(multiplayerUiTranslations);
  const game = snapshot.game!;
  const player = snapshot.privatePlayer!;
  const active = player.id === game.activePlayerId;
  const activePlayer = game.players.find(other => other.id === game.activePlayerId)!;
  const ownStatistics = game.players.find(other => other.id === player.id)!;
  const highestPublicScore = Math.max(...game.players.map(other => other.score));
  const totalScore = snapshot.privateScore ?? ownStatistics.score;
  const victoryPointCards = player.developmentCards.filter(card => card.kind === "victory-point").length;
  const normalActions = active && game.phase.type === "actions" && !game.winnerId;
  const [details, setDetails] = useState<"table" | "activity" | "discard" | "steal" | "trade-response" | null>(null);
  const [editor, setEditor] = useState<"trade" | "development" | null>(null);
  const [developmentCardId, setDevelopmentCardId] = useState<string | null>(null);
  const [tradeMode, setTradeMode] = useState<"bank" | "players">("bank");
  const [editorVersion, setEditorVersion] = useState(snapshot.version);
  const [responseVersion, setResponseVersion] = useState<number | null>(null);
  const [confirmation, setConfirmation] = useState<{
    action: GameAction;
    title: keyof typeof multiplayerUiTranslations;
    description?: keyof typeof multiplayerUiTranslations;
    parameters?: TranslationParameters;
    exchange?: { give: Resources; receive: Resources };
    version: number;
    returnTo?: "steal" | "trade-response";
  } | null>(null);
  const [chosen, setChosen] = useState(emptyResources);
  const discardCount = game.phase.type === "discard" ? game.phase.required[player.id] : undefined;
  const canPay = (cost: Resources) => RESOURCES.every(resource => player.resources[resource] >= cost[resource]);
  const settlementUnavailable = game.board.vertices.filter(vertex => vertex.building?.playerId === player.id && vertex.building.kind === "settlement").length >= 5
    ? translateText("All 5 settlements are on the board. Upgrade one to a city to free a settlement piece.")
    : null;
  const cityUnavailable = game.board.vertices.filter(vertex => vertex.building?.playerId === player.id && vertex.building.kind === "city").length >= 4
    ? translateText("All 4 cities are on the board.")
    : canPay(COSTS.city) && !game.board.vertices.some(vertex => vertex.building?.playerId === player.id && vertex.building.kind === "settlement")
      ? translateText("You have no settlements to upgrade. Build a settlement first.")
      : null;
  const trade = game.trade;
  const tradeIdentity = trade ? JSON.stringify([trade.offeredBy, trade.give, trade.receive]) : null;
  const staleMessage = translateText("The game changed. Close and reopen this dialog to review the latest state.");
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

  function send(action: GameAction, expectedVersion = snapshot.version, trade?: TradeIdentity) {
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
    secondSettlement: game.board.vertices.filter(vertex => vertex.building).length >= game.players.length,
    pendingKnight: game.canCancelKnight,
    sharedBoard: true,
  });
  const choosingGold = game.phase.type === "gold" && Object.keys(game.phase.required)[0] === player.id;
  const awaitingPlayer = active || choosingGold || discardCount !== undefined || Boolean(game.winnerId);
  const instructionTitle = awaitingPlayer ? phaseInstructions.title : translateText("The island is in motion.");
  const instructionDescription = game.winnerId ? translateText("{name} wins! {instructions}", { name: game.players.find(other => other.id === game.winnerId)!.name, instructions: phaseInstructions.description })
    : !awaitingPlayer ? activePlayer.control === "computer"
      ? translateText(game.trade ? "{name} is considering the trade." : game.phase.type === "discard" ? "{name} is discarding resources." : "{name} is playing automatically.", { name: activePlayer.name })
      : translateText("{name} is playing. You can inspect your hand and the island while you wait.", { name: activePlayer.name })
    : snapshot.buildMode ? translateText("Choose a highlighted location for your {piece} on the shared board, then confirm the placement.", { piece: pieceName(language, snapshot.buildMode) })
    : phaseInstructions.description;

  return <div className="private-dashboard" aria-label={translateText("Your hand and actions")}>
    <section className="private-player-summary" aria-label={translateText("Your player summary")}>
      <PlayerSeat variant={game.variant} player={{ ...ownStatistics, resourceCount: resourceTotal(player.resources), developmentCount: player.developmentCards.length }}
        number={game.players.findIndex(other => other.id === player.id) + 1} active={active}
        leading={ownStatistics.score === highestPublicScore && game.players.some(other => other.score < highestPublicScore)}
        largestArmy={game.awards.largestArmy === player.id} longestRoadAward={game.awards.longestRoad === player.id}
        islandBonus={ownStatistics.islands ?? 0}
        privateScore={totalScore}
        stacked={game.awards.largestArmy === player.id || game.awards.longestRoad === player.id || (ownStatistics.islands ?? 0) > 0} />
    </section>
    <section className="hand-content private-hand" aria-label={translateText("Your cards")}>
      <section className="hand-resources" aria-label={translateText("Your current resources")}>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="eyebrow min-w-0 truncate">{translateText("{name}'s hand", { name: player.name })}</h2>
          <div className="flex shrink-0 items-center gap-2">
            <strong className={`rounded-md px-2 py-1 text-sm text-ink tabular-nums ${resourceTotal(player.resources) > 7 ? "card-count-at-risk bg-clay/30" : "bg-moss"}`}>{translateText("{count} cards", { count: resourceTotal(player.resources) })}</strong>
            <span
              role="img"
              aria-label={translateText("{count} victory point cards", { count: victoryPointCards })}
              title={translateText("{count} victory point cards", { count: victoryPointCards })}
              className="flex items-center gap-1 rounded-md bg-moss px-2 py-1 text-sm text-ink tabular-nums"
            >
              <span className="text-[#947231] [&>svg]:h-4 [&>svg]:w-4"><DevelopmentCardIcon kind="victory-point" /></span>
              <strong className="font-semibold">{victoryPointCards}</strong>
            </span>
          </div>
        </div>
        <ul aria-label={translateText("Cards in hand")} className="grid grid-cols-5 gap-1.5 sm:gap-2">
          {RESOURCES.map(resource => <li key={resource} aria-label={translateText("{resource}: {count} in hand", { resource: resourceName(language, resource), count: player.resources[resource] })}>
            <ResourceCard resource={resource} count={player.resources[resource]} iconClassName="h-8 w-8" className="hand-resource-card w-full" />
          </li>)}
        </ul>
      </section>
      {choosingGold && game.phase.type === "gold" && <GoldSelection key={JSON.stringify(game.phase.required)}
        bank={game.bank} count={game.phase.required[player.id]!} disabled={disabled}
        onSubmit={resources => send({ type: "choose-gold", resources })} />}
      <CollapsibleSection title={translateText("Build a little bigger")} className="hand-building" defaultOpen>
        <div className="build-options flex flex-col gap-2">
          {(["road", ...(isSeafarers(game.variant) ? ["ship" as const] : []), "settlement", "city"] as const).map(piece => {
            const locations = piece === "road"
              ? legalRoadEdges(game, player.id)
              : piece === "ship" ? legalShipEdges(game, player.id) : piece === "city"
                ? legalCityVertices(game, player.id)
                : legalSettlementVertices(game, player.id);
            const explanation = piece === "settlement" ? settlementUnavailable : piece === "city" ? cityUnavailable : null;
            const unavailable = explanation ?? (!normalActions
              ? translateText("Available after rolling on your turn.")
              : !canPay(COSTS[piece])
                ? translateText("You need more resources.")
                : !locations.length
                  ? translateText("No legal position or no pieces remaining.")
                  : translateText("Select a location on the board."));
            return <Fragment key={piece}>
              <BuildButton piece={piece} color={player.color} resources={COSTS[piece]}
                aria-label={piece === "city" ? translateText("Upgrade to city") : translateText("Build {piece}", { piece: pieceName(language, piece) })}
                aria-pressed={snapshot.buildMode === piece} aria-describedby={explanation ? `${piece}-build-explanation` : undefined}
                title={unavailable}
                disabled={disabled || !normalActions || !canPay(COSTS[piece]) || !locations.length}
                onClick={() => selectBuild(snapshot.buildMode === piece ? null : piece)} />
              {explanation && <p id={`${piece}-build-explanation`} className="-mt-1 rounded-lg bg-moss/60 px-3 py-2 text-xs leading-5 text-ink">{explanation}</p>}
            </Fragment>;
          })}
          {isSeafarers(game.variant) && <button className="button-secondary w-full"
            disabled={disabled || !normalActions || !movableShipEdges(game, player.id).some(id => legalShipDestinations(game, player.id, id).length)}
            aria-pressed={snapshot.buildMode === "move-ship"} onClick={() => selectBuild(snapshot.buildMode === "move-ship" ? null : "move-ship")}>
            {translateText("Move ship")}
          </button>}
          <BuildButton piece="development" color={player.color} resources={COSTS.development} aria-label={translateText("Buy a card")} disabled={disabled || !normalActions || !canPay(COSTS.development) || game.developmentRemaining === 0} onClick={() => setConfirmation({
            action: { type: "buy-development" },
            title: "Invest in a development card",
            description: "Pay one wool, one grain, and one ore. Your new card stays private. Action cards cannot be played until a later turn.",
            version: snapshot.version,
          })} />
        </div>
        <p className="sr-only">{translateText("Building needs resources, an available piece, and a legal connection after your roll.")}</p>
        <button className="button-secondary mt-2 w-full px-2" disabled={disabled || !normalActions} onClick={() => { setEditorVersion(snapshot.version); setEditor("trade"); }}>{translateText("Make a trade")}</button>
      </CollapsibleSection>
      <DevelopmentHand variant={game.variant} cards={player.developmentCards} turnNumber={game.turnNumber} onSelect={cardId => { setDevelopmentCardId(cardId); setEditorVersion(snapshot.version); setEditor("development"); }} />
    </section>

    <section className="hand-dice private-turn" aria-label={translateText("Turn controls")}>
      {active && isSeafarers(game.variant) && <FreeRouteChoice phase={game.phase} mode={snapshot.buildMode} disabled={disabled} onSelect={selectBuild} />}
      <div ref={onPrivateNoticeTarget} className="private-notice-anchor" />
      <div className="turn-header">
        <h2 className="turn-owner"><span className="truncate" title={activePlayer.name}>{game.winnerId ? translateText("Game over") : activePlayer.name}</span>{!game.winnerId && <span className="shrink-0 text-xs font-medium text-muted">{translateText(active ? " - Your turn" : " - Their turn")}</span>}</h2>
        <span className="turn-number">{game.turnNumber === 0 ? translateText("Setup") : translateText("Turn {turn}", { turn: game.turnNumber })}</span>
        {turnMenu}
      </div>
      <MultiplayerDice game={game} />
      <div data-testid="game-phase" data-phase={game.phase.type} data-active-player={activePlayer.name} className="private-instructions" aria-live="polite">
        <TurnInstructions title={instructionTitle} description={instructionDescription} computerActivity={!awaitingPlayer && activePlayer.control === "computer"} />
      </div>
      <div className="turn-action">
        {discardCount !== undefined ? <button className="button-primary" onClick={() => setDetails("discard")}>{translateText("Discard {count}", { count: discardCount })}</button>
          : active && game.phase.type === "steal" ? <button className="button-primary" onClick={() => setDetails("steal")}>{translateText("Choose player")}</button>
          : trade ? <button className="button-primary" onClick={() => { setResponseVersion(null); setChosen(emptyResources()); setDetails("trade-response"); }}>{translateText("View trade")}</button>
          : active && game.canCancelKnight ? <button className="button-secondary" disabled={disabled} onClick={() => send({ type: "cancel-knight" })}>{translateText("Cancel Knight")}</button>
          : <button className="button-primary" disabled={disabled || !active || game.phase.type !== "roll"} onClick={() => send({ type: "roll" })}>{translateText("Roll the dice")}</button>}
        {active && game.phase.type === "road-building" && snapshot.boardTargets.edges.length === 0 ? <button className="button-secondary" disabled={disabled} onClick={() => send({ type: "skip-roads" })}>{translateText("Finish Road Building")}</button>
          : <button className="button-secondary" disabled={disabled || !normalActions} onClick={() => send({ type: "end-turn" })}>{translateText("End turn")}</button>}
      </div>
    </section>


    {details === "table" && <Dialog title={translateText("All players and bank")} onClose={() => setDetails(null)} wide><div className="space-y-4"><PlayerList snapshot={snapshot} /><BankSupply resources={game.bank} developmentCards={game.developmentRemaining} /></div></Dialog>}
    {details === "activity" && <Dialog title={translateText("Table activity")} onClose={() => setDetails(null)}><ol className="space-y-3 text-sm text-muted">{game.log.slice(-12).map((entry, index) => <li key={index}>{formatGameMessage(language, entry)}</li>)}</ol></Dialog>}
    {details === "discard" && discardCount !== undefined && <Dialog title={translateText("Discard {count} cards", { count: discardCount })} onClose={() => setDetails(null)} summary={<ResourceInventory resources={player.resources} />}>
      <DiscardSelection resources={player.resources} required={discardCount} chosenResources={chosen} onChangeResources={setChosen} disabled={disabled} onConfirm={() => send({ type: "discard", resources: chosen })} />
    </Dialog>}
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
      <OpenTrade trade={trade} viewer={player} players={game.players} chosenResources={chosen} disabled={disabled || responseStale}
        onChangeResources={resources => { setResponseVersion(current => current ?? snapshot.version); setChosen(resources); }}
        onComplete={(playerId, price) => {
          setDetails(null);
          setConfirmation({ action: { type: "complete-trade", playerId }, title: "Trade with {name}", parameters: { name: game.players.find(other => other.id === playerId)!.name }, exchange: { give: price, receive: trade.receive }, version: snapshot.version, returnTo: "trade-response" });
        }}
        onEdit={() => { setDetails(null); setTradeMode("players"); setEditorVersion(snapshot.version); setEditor("trade"); }}
        onWithdraw={() => send({ type: "cancel-trade" })}
        onRespond={action => send(action, responseVersion ?? snapshot.version,
          trade ? { offeredBy: trade.offeredBy, give: trade.give, receive: trade.receive } : undefined)} />
      {(responseStale || error) && <p role="alert" className="mt-4 text-sm text-clay">{responseStale ? staleMessage : error}</p>}
    </Dialog>}

    {editor === "trade" && <TradeDialog game={game} player={player} initialMode={tradeMode} onModeChange={setTradeMode} initialOffer={trade?.offeredBy === player.id ? trade : undefined} disabled={disabled || !normalActions || editorStale} error={editorStale ? staleMessage : error}
      onClose={() => { setEditor(null); if (trade) setDetails("trade-response"); }} onSubmit={action => send(action, editorVersion)} />}
    {editor === "development" && <DevelopmentDialog variant={game.variant} player={player} bank={game.bank} turnNumber={game.turnNumber} phaseType={game.phase.type} developmentPlayed={game.developmentPlayed} initialCardId={developmentCardId} active={active} disabled={disabled || editorStale} error={editorStale ? staleMessage : error}
      onClose={() => setEditor(null)} onSubmit={action => send(action, editorVersion)} />}
    {confirmation && <ActionConfirmation title={translateText(confirmation.title, confirmation.parameters)} player={{ name: player.name, color: player.color }} description={confirmation.description ? translateText(confirmation.description, confirmation.parameters) : undefined} exchange={confirmation.exchange} resources={confirmation.action.type === "steal" ? undefined : player.resources}
      disabled={disabled || confirmation.version !== snapshot.version} error={confirmation.version !== snapshot.version ? staleMessage : error}
      onClose={() => { setConfirmation(null); if (confirmation.returnTo) setDetails(confirmation.returnTo); }} onConfirm={() => send(confirmation.action, confirmation.version)} />}
  </div>;
}

export function MultiplayerApp() {
  const { language } = useLanguage();
  const translateText = useTranslation(multiplayerUiTranslations);
  const [invitation] = useState<Invitation | null>(() => {
    const parameters = new URLSearchParams(window.location.hash.slice(1));
    const hostId = parameters.get("host");
    const secret = parameters.get("secret");
    return hostId && secret ? { hostId, secret } : null;
  });
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
  const [dialog, setDialog] = useState<"help" | "settings" | "theme" | "leave" | "reset" | null>(null);
  const boardSettings = useBoardSettings();
  const [selected, setSelected] = useState<{ kind: "vertex" | "edge" | "tile"; id: string; version: number } | null>(null);
  const [movingShip, setMovingShip] = useState<{ edgeId: string; version: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const [privateNoticeTarget, setPrivateNoticeTarget] = useState<HTMLDivElement | null>(null);
  const [victoryDismissed, setVictoryDismissed] = useState(false);
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
  const disconnectedPlayers = snapshot?.players.filter(player => player.control === "human" && !player.connected) ?? [];
  const sessionError = view?.error ? formatGameMessage(language, view.error) : "";
  const victoryWinner = game?.winnerId ? game.players.find(player => player.id === game.winnerId) : undefined;

  useEffect(() => {
    // A fresh game (or a return to the lobby) brings the victory popup back.
    if (!game?.winnerId) setVictoryDismissed(false);
  }, [Boolean(game), Boolean(game?.winnerId)]);

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
    session.current = joinSession(invitation, name.trim(), setView);
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
    .with("tile", (): GameAction => ({ type: game.board.tiles.find(tile => tile.id === currentSelection.id)?.terrain === "sea" ? "move-pirate" : "move-robber", tileId: currentSelection.id }))
    .with("edge", (): GameAction => movingShipId
      ? { type: "move-ship", edgeId: movingShipId, destinationEdgeId: currentSelection.id }
      : { type: snapshot?.buildMode === "ship" || !legalRoadEdges(game, game.activePlayerId).includes(currentSelection.id) ? "place-ship" : "place-road", edgeId: currentSelection.id })
    .with("vertex", () => ({ type: snapshot?.buildMode === "city" ? "place-city" as const : "place-settlement" as const, vertexId: currentSelection.id }))
    .exhaustive();

  return <BoardThemeContext value={BOARD_THEMES[boardThemeId]}>
    <div data-theme={boardThemeId} className={privateGame ? "game-shell private-game-shell" : sharedGame ? "game-shell shared-game-shell" : hostLobby ? "multiplayer-lobby-shell" : "min-h-dvh"}>
      {!privateGame && <header className="mx-auto flex max-w-[1600px] items-center justify-between gap-2 border-b border-line px-5 py-4 sm:gap-3 sm:px-8">
        <div className="min-w-0 shrink-0 max-sm:[&>span>svg]:hidden max-sm:[&>span>span]:text-2xl"><Logo /></div>
        {sharedGame && <span className="ml-auto text-[10px] text-muted max-sm:sr-only sm:mx-auto sm:text-xs" role="status">{translateText("Shared board / {status}", { status: translateText(view?.status === "connected" ? "Connected" : "Offline") })}</span>}
        {view ? <GameMenu actions={[
          { label: translateText("Help"), onSelect: () => setDialog("help") },
          ...(host ? [{ label: translateText("Settings"), onSelect: () => setDialog("settings") }] : []),
          ...(host && game ? [{ label: translateText("Reset game"), disabled, onSelect: () => setDialog("reset") }] : []),
        ]} exitAction={{ label: translateText("Leave room"), onSelect: () => setDialog("leave") }} /> : <GameMenu
          triggerLabel={translateText("Menu")}
          groupLabel={translateText("Main menu")}
          profileName={invitation ? playerProfile?.name : undefined}
          actions={[
            { label: translateText("Help"), onSelect: () => setDialog("help") },
            ...(invitation ? [{ label: translateText("Profile"), onSelect: () => setProfileGateOpen(true) }] : []),
          ]}
          exitAction={{ label: translateText("Single-device play"), onSelect: () => { window.location.href = "/"; } }}
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
            <button className="button-primary w-full" disabled={!name.trim()}>{translateText("Connect to game")}</button>
          </form>
          <p className="mt-5 text-xs leading-6 text-muted">{translateText("PeerJS Cloud provides signaling, and STUN helps discover reachable addresses. Gameplay runs in the board browser over direct, encrypted connections, without a relay fallback. Ethernet and Wi-Fi can work together; guest Wi-Fi isolation can prevent connections.")}</p>
        </section>}

        {view && (!(privateGame || sharedGame || hostLobby) || view.status !== "connected") && <div className={privateGame ? "private-connection-notice" : "mb-4 flex flex-wrap items-center justify-between gap-2 text-xs"} role="status">
          <span>{translateText(view.pending ? "{screen} / {status} / Waiting for the host" : "{screen} / {status}", {
            screen: translateText(host ? "Shared board" : "Private player screen"),
            status: translateText(view.status === "connected" ? "Connected" : view.status === "connecting" ? host ? "Connecting through PeerJS Cloud..." : "Connecting to the host..." : view.status === "closed" ? "Room closed" : "Connection lost"),
          })}</span>
          {view.status === "disconnected" && <button className="button-secondary" onClick={() => session.current?.reconnect()}>{translateText("Reconnect")}</button>}
          {view.status === "closed" && <a className="underline underline-offset-4" href="/?multiplayer=1">{translateText("Start another room")}</a>}
        </div>}
        {(localError || sessionError) && <p role="alert" className={privateGame ? "private-game-error" : "mx-auto mb-5 max-w-4xl rounded-xl border border-clay/40 bg-white p-4 text-sm text-clay"}>{[localError ? translateText(localError) : "", sessionError].filter(Boolean).join(" ")}</p>}

        {view && !game && <div className={`mx-auto grid max-w-5xl gap-6 lg:grid-cols-2 ${host ? "multiplayer-lobby-grid" : ""}`}>
          {host && snapshot?.previewBoard && <section aria-label={translateText("Island preview")} className="multiplayer-lobby-island panel min-w-0 p-4 sm:p-6">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div><p className="eyebrow">{translateText("A place to begin")}</p><h2 className="mt-1 font-serif text-2xl">{translateText("Your island awaits.")}</h2></div>
                <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
                  <GameVariantSelector value={snapshot.variant} disabled={disabled} onChange={variant => session.current?.setVariant(variant)} />
                </div>
              </div>
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
                  victoryTarget={victoryTarget(snapshot.variant)}
                  onChangeTheme={() => setDialog("theme")}
                  headerControls={<MapSeedControls
                    value={mapCode}
                    onChange={setMapCode}
                    disabled={disabled}
                    onLoad={code => session.current?.useMapSeed(code)}
                    onShuffle={() => session.current?.shuffleBoard()}
                  />}
                />
              </div>
              {isSeafarers(snapshot.variant) && <p className="mt-4 text-xs leading-5 text-muted"><GameVariantSummary variant={snapshot.variant} /></p>}
          </section>}
          <div className={host ? "multiplayer-lobby-column min-w-0 space-y-6" : "contents"}>
          {host && <section aria-label={translateText("Room invitation")} className="multiplayer-lobby-invitation panel flex min-w-0 flex-col items-center p-4 sm:p-6">
            <div className="lobby-invitation-heading text-center">
              <p className="eyebrow">{translateText("Welcome to the table")}</p>
              <h1 className="my-3 font-serif text-3xl">{translateText("Scan. Join. Settle in.")}</h1>
            </div>
            {qrCode ? <img src={qrCode} alt={translateText("Scan to join this game")} className="lobby-qr aspect-square w-full max-w-80 rounded-xl" width={320} height={320} /> : <p className="lobby-qr py-16 text-sm text-muted">{translateText("Preparing your invitation...")}</p>}
            {view.invitationUrl && <div className="lobby-invitation-link mt-4 w-full">
              <label htmlFor="room-invitation-url" className="block text-xs text-muted">{translateText("Game invitation")}</label>
              <div className="mt-1 flex min-w-0 items-stretch rounded-xl border border-line bg-white">
                <input id="room-invitation-url" className="min-h-11 min-w-0 flex-1 rounded-l-xl bg-transparent px-3 text-xs" readOnly value={view.invitationUrl} onFocus={event => event.target.select()} />
                <button className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-r-xl border-l border-line px-3 text-xs font-semibold hover:bg-moss" aria-label={translateText("Copy invitation")} title={translateText(copied ? "Invitation copied" : "Copy invitation")} onClick={async () => {
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
                  <span role="status" className={copied ? "" : "sr-only"}>{copied ? translateText("Copied") : ""}</span>
                </button>
              </div>
            </div>}
          </section>}
          <section className={`panel min-w-0 p-6 ${host ? "multiplayer-lobby-players" : "lg:col-span-2"}`}>
            <h2 className="break-words font-serif text-3xl">{snapshot?.playerId ? translateText("Welcome, {name}.", { name: snapshot.players.find(player => player.id === snapshot.playerId)!.name }) : translateText(host ? "Who is joining?" : view.status === "disconnected" ? "Not connected" : "Waiting for admission")}</h2>
            {!host && <p className="my-4 text-sm leading-6 text-muted">{translateText(snapshot?.playerId ? "Your seat is reserved. The host will start when everyone is connected." : view.status === "disconnected" ? "Reconnect to request admission, or change your name before trying again." : "Ask the host to admit your name on the shared screen. Your hand will appear here when the game starts.")}</p>}
            {!host && snapshot && <p className="my-4 text-xs leading-5 text-muted">
              {snapshot.variant === "original" ? translateText("Original") : <GameVariantSummary variant={snapshot.variant} />}
            </p>}
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
                  {Array.from({ length: 4 - playerCount }, (_, index) => playerCount + index + 1).map(seat => <li key={seat} className="flex items-center gap-3 rounded-xl border border-dashed border-line p-3 text-muted">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line text-xs">{seat}</span>
                    <div><p className="text-sm font-semibold">{translateText(seat < 4 ? "Player needed" : "Optional fourth player")}</p><p className="mt-1 text-xs">{translateText(seat < 4 ? "Join by phone or add a computer." : "Start with three, or fill this seat.")}</p></div>
                  </li>)}
                </ul>}
              </div>
            </>}
            {host && (snapshot?.pendingPlayers ?? []).map(player => <div key={player.connectionId} className="my-3 flex flex-wrap items-center gap-2 rounded-xl border border-line p-3">
              <strong className="mr-auto break-words text-sm">{player.name}</strong>
              <button className="button-primary" aria-label={translateText("Admit {name}", { name: player.name })} disabled={disabled || playerCount >= 4} onClick={() => session.current?.admit(player.connectionId)}>{translateText("Admit")}</button>
              <button className="button-secondary" aria-label={translateText("Decline {name}", { name: player.name })} disabled={disabled} onClick={() => session.current?.reject(player.connectionId)}>{translateText("Decline")}</button>
            </div>)}
            {host && <>
              <div className="grid gap-2 sm:grid-cols-2">
                <button className="button-secondary" disabled={disabled || !snapshot || playerCount >= 4} onClick={() => session.current?.addComputer(language)}>{translateText("Add computer")}</button>
                <button className="button-primary" aria-describedby="lobby-readiness" disabled={disabled || !snapshot || missingPlayers > 0 || disconnectedPlayers.length > 0} onClick={() => session.current?.startGame()}>{translateText("Start game")}</button>
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
                islandBonus={player.islands ?? 0} />
              {player.control === "human" && !player.connected && <p role="status" className="mt-1 px-3 text-xs text-clay">{translateText("{name} disconnected", { name: player.name })}</p>}
            </li>)}
          </ul>
          <section aria-label={translateText("Shared game board")} className="table-board flex min-w-0 flex-1">
            <div className="board-tablemat">
              <Board board={game.board} players={game.players} robberTileId={game.robberTileId} pirateTileId={game.pirateTileId} fit
                victoryTarget={victoryTarget(game.variant)}
                routeMode={snapshot.buildMode === "ship" || snapshot.buildMode === "move-ship" || snapshot.buildMode === "road" ? snapshot.buildMode : null}
                routeChoice={isSeafarers(game.variant) && activePlayer?.control === "human" && (game.phase.type === "setup-road" || game.phase.type === "road-building")
                  ? <FreeRouteChoice phase={game.phase} mode={snapshot.buildMode} disabled={disabled} onSelect={piece => session.current?.selectBuild(piece, snapshot.version)} />
                  : undefined}
                onMovePirateOffBoard={!disabled && activePlayer?.control === "human" && isSeafarers(game.variant) && game.phase.type === "robber" && game.pirateTileId !== null
                  ? () => session.current?.perform({ type: "move-pirate", tileId: null }, snapshot.version) : undefined}
                legalVertexIds={snapshot.boardTargets.vertices} legalEdgeIds={movingShipId ? legalShipDestinations(game, game.activePlayerId, movingShipId) : snapshot.boardTargets.edges} legalTileIds={snapshot.boardTargets.tiles}
                interactive={!disabled && activePlayer?.control !== "computer" && !game.winnerId} selectedId={currentSelection?.id ?? movingShipId}
                showBlockedSettlementLocations={boardSettings.showBlockedSettlementLocations} fillBoardWithWater={boardSettings.fillBoardWithWater}
                rolledNumber={game.dice ? game.dice[0] + game.dice[1] : undefined}
                onChangeTheme={() => setDialog("theme")}
                onSelect={(kind, id) => {
                  if (kind === "edge" && snapshot.buildMode === "move-ship" && !movingShipId) {
                    setMovingShip({ edgeId: id, version: snapshot.version });
                    setSelected(null);
                  } else setSelected({ kind, id, version: snapshot.version });
                }}
                confirmation={selectedAction ? { title: selectedAction.type === "move-robber" ? translateText("Move the robber here?")
                  : selectedAction.type === "move-pirate" ? translateText("Move the pirate here?")
                  : selectedAction.type === "move-ship" ? translateText("Move the ship here?")
                  : translateText("Confirm {piece}?", { piece: pieceName(language, selectedAction.type === "place-ship" ? "ship" : selectedAction.type === "place-road" ? "road" : selectedAction.type === "place-city" ? "city" : "settlement") }),
                  player: activePlayer ? { name: activePlayer.name, color: activePlayer.color } : undefined,
                  onConfirm: () => { session.current?.perform(selectedAction, currentSelection!.version); setSelected(null); setMovingShip(null); }, onCancel: () => setSelected(null) } : undefined}
              />
            </div>
          </section>
          {victoryWinner && !victoryDismissed && (
            <VictoryDialog
              eyebrow={translateText("The island has a new legend")}
              headline={translateText("{name} takes the island.", { name: victoryWinner.name })}
              winnerName={victoryWinner.name}
              winnerColor={victoryWinner.color}
              totalPoints={victoryWinner.score}
              pointsUnit={translateText("points")}
              summary={translateText("The room keeps its players and invitation. Start the next game from the lobby.")}
              breakdown={victoryBreakdownRows(victoryWinner.scoreBreakdown, translateText, game.variant)}
              profileNote={snapshot.profiles?.[victoryWinner.id]
                ? translateText("Player history: {games} games / {wins} wins / {points} total points", snapshot.profiles[victoryWinner.id])
                : undefined}
              mapNote={snapshot.mapSeed
                ? translateText("Map code: {code}. Enter it before starting to replay this island.", { code: snapshot.mapSeed })
                : undefined}
            >
              <button className="button-primary" disabled={disabled} onClick={() => session.current?.endGame()}>
                {translateText("Return to lobby")}
              </button>
              <button className="button-secondary" onClick={() => setVictoryDismissed(true)}>
                {translateText("View the island")}
              </button>
            </VictoryDialog>
          )}
        </div>}
        {!host && game && snapshot && <div className={privateGame ? "private-game-content" : "space-y-4"}>
          {snapshot.privatePlayer ? <PlayerControls key={`${view?.status}:${game.gameId}`} snapshot={snapshot} disabled={disabled} error={sessionError} perform={(action, expectedVersion, trade) => session.current?.perform(action, expectedVersion, trade)} selectBuild={piece => session.current?.selectBuild(piece, snapshot.version)} onPrivateNoticeTarget={setPrivateNoticeTarget} turnMenu={<GameMenu icon actions={[
            { label: translateText("Help"), onSelect: () => setDialog("help") },
          ]} exitAction={{ label: translateText("Leave room"), onSelect: () => setDialog("leave") }} />} />
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
            >
              <button className="button-primary" onClick={() => setDialog("leave")}>
                {translateText("Leave room")}
              </button>
              <button className="button-secondary" onClick={() => setVictoryDismissed(true)}>
                {translateText("View the island")}
              </button>
            </VictoryDialog>
          )}
        </div>}
      </main>
      {!host && game && !game.winnerId && snapshot?.privatePlayer && <PrivateNotices key={game.gameId} thefts={snapshot.privateThefts} monopolies={snapshot.privateMonopolies} playerId={snapshot.privatePlayer.id} players={game.players} target={privateNoticeTarget} />}
      {dialog === "theme" && <Dialog title={translateText("Choose your theme")} onClose={() => setDialog(null)} wide><ThemeSelector value={boardThemeId} onChange={setBoardThemeId} /></Dialog>}
      {dialog === "help" && <HelpDialog variant={game?.variant ?? snapshot?.variant ?? "original"} multiplayer onClose={() => setDialog(null)} />}
      {dialog === "settings" && host && <BoardSettingsDialog {...boardSettings} onClose={() => setDialog(null)} />}
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
      {dialog === "leave" && <Dialog title={translateText(host ? "Close this room?" : "Leave this room?")} onClose={() => setDialog(null)}>
        <p className="mb-5 text-sm leading-6">{translateText(host ? "The board holds the game in memory. Closing it ends the game for everyone; there is no automatic host transfer or saved game." : "Your seat stays reserved while the host remains open. Open the invitation in this tab to reconnect.")}</p>
        <div className="flex gap-3"><button className="button-secondary" onClick={() => setDialog(null)}>{translateText("Keep playing")}</button><button className="button-primary" onClick={() => { session.current?.close(); session.current = null; window.location.href = "/"; }}>{translateText("Leave room")}</button></div>
      </Dialog>}
    </div>
  </BoardThemeContext>;
}
