import Peer from "peerjs";
import type { DataConnection } from "peerjs";
import type { GameAction } from "../game/types";
import { getComputerActionDelay } from "../game/computer";
import { GameError, gameErrorMessage } from "../game/messages";
import type { GameMessage } from "../game/messages";
import { profileStats, recordGameResultForActive } from "../profile";import { parseClientMessage, parseServerMessage } from "./protocol";
import type { Command, ServerMessage } from "./protocol";
import { HostRoom } from "./state";
import type { BuildMode, Invitation, MultiplayerSession, SessionView } from "./types";

type Timer = ReturnType<typeof setTimeout>;
const RETRY_DELAY = 2000;
const CONNECTION_TIMEOUT = 15000;

function send(connection: DataConnection, message: unknown, failed: () => void): void {
  try {
    if (!connection.open) return failed();
    void Promise.resolve(connection.send(message)).catch(failed);
  } catch { failed(); }
}

function signaling(id: string, callbacks: {
  ready: () => void;
  failed: (message: GameMessage) => void;
  connection: (connection: DataConnection) => void;
}) {
  let peer: Peer;
  let closed = false;
  let retry: Timer | undefined;
  let timeout: Timer | undefined;
  function schedule() {
    if (closed || retry) return;
    retry = setTimeout(() => { retry = undefined; reconnect(); }, RETRY_DELAY);
  }
  function watch() {
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      if (closed || peer.open) return;
      callbacks.failed({ key: "PeerJS signaling timed out. Check internet access; reconnecting automatically." });
      peer.disconnect();
      schedule();
    }, CONNECTION_TIMEOUT);
  }
  function create() {
    peer?.removeAllListeners();
    peer = new Peer(id, { config: { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] } });
    peer.on("open", () => {
      clearTimeout(retry); retry = undefined;
      clearTimeout(timeout);
      callbacks.ready();
    });
    peer.on("connection", callbacks.connection);
    peer.on("call", connection => connection.close());
    peer.on("disconnected", () => {
      if (closed) return;
      callbacks.failed({ key: "PeerJS signaling disconnected. Existing local connections may continue; reconnecting automatically." });
      schedule();
    });
    peer.on("error", error => {
      if (closed) return;
      callbacks.failed(error.type === "peer-unavailable"
        ? { key: "The target device is unavailable through PeerJS signaling. Keep both pages open and use the host's latest invitation." }
        : { key: "PeerJS connection failed ({failureType}). Check internet access and keep both pages open.", parameters: { failureType: error.type } });
      if (!peer.open) schedule();
    });
    peer.on("close", () => {
      if (closed) return;
      callbacks.failed({ key: "PeerJS signaling closed unexpectedly. Reconnecting automatically." });
      schedule();
    });
    watch();
  }
  function reconnect() {
    if (closed) return;
    clearTimeout(retry); retry = undefined;
    try {
      if (peer.destroyed) create();
      else if (peer.disconnected) { peer.reconnect(); watch(); }
      else if (peer.open) callbacks.ready();
    } catch {
      callbacks.failed({ key: "Unable to reconnect to PeerJS signaling. Check internet access." });
      schedule();
    }
  }
  create();
  return {
    get peer() { return peer; }, reconnect,
    close() {
      closed = true;
      clearTimeout(retry); clearTimeout(timeout);
      peer.removeAllListeners();
      peer.destroy();
    },
  };
}

export function hostSession(onChange: (view: SessionView) => void): MultiplayerSession {
  const hostId = crypto.randomUUID();
  const secret = crypto.randomUUID();
  const room = new HostRoom(secret);
  let closed = false;
  let signalingError: GameMessage | null = null;
  let computerTimer: Timer | undefined;
  let view: SessionView = { role: "host", status: "connecting", invitationUrl: null, snapshot: room.snapshot(), error: null, pending: false };
  const connections = new Map<string, { connection: DataConnection; joined: boolean; timeout: Timer }>();
  const publish = () => {
    if (closed) return;
    clearTimeout(computerTimer);
    computerTimer = undefined;
    const expectedVersion = room.version;
    const delay = room.game ? getComputerActionDelay(room.game) : null;
    if (delay !== null) {
      const timer = setTimeout(() => {
        if (closed || computerTimer !== timer || room.version !== expectedVersion) return;
        computerTimer = undefined;
        try {
          if (!room.performComputer(expectedVersion)) return;
          view = { ...view, error: null };
          publish();
        } catch (error) {
          view = { ...view, error: gameErrorMessage(error, "The computer could not finish its move.") };
          onChange({ ...view, error: view.error || signalingError });
        }
      }, delay);
      computerTimer = timer;
    }
    view = { ...view, snapshot: room.snapshot() };
    onChange({ ...view, error: view.error || signalingError });
    for (const [connectionId, entry] of connections) {
      if (entry.joined) send(entry.connection, { type: "snapshot", snapshot: room.snapshot(connectionId) }, () => remove(connectionId));
    }
    // Ask phones without reported stats to share their local player profile once the game ends.
    if (room.game?.phase.type === "finished") {
      for (const connectionId of room.profileRequestConnectionIds()) {
        const entry = connections.get(connectionId);
        if (entry?.joined) send(entry.connection, { type: "request-profile" }, () => remove(connectionId));
      }
    }
  };
  function remove(connectionId: string) {
    const entry = connections.get(connectionId);
    if (!entry) return;
    connections.delete(connectionId);
    clearTimeout(entry.timeout);
    entry.connection.removeAllListeners();
    entry.connection.close();
    room.disconnect(connectionId);
    publish();
  }
  function deny(connectionId: string, error: GameMessage) {
    const entry = connections.get(connectionId);
    if (!entry) return;
    entry.joined = false;
    room.disconnect(connectionId);
    send(entry.connection, { type: "error", error, terminal: true }, () => remove(connectionId));
    clearTimeout(entry.timeout);
    // Give the reliable channel time to deliver the explanation before closing it.
    entry.timeout = setTimeout(() => remove(connectionId), 250);
  }
  const link = signaling(hostId, {
    ready: () => {
      signalingError = null;
      view = { ...view, status: "connected", error: null, invitationUrl: `${location.origin}${location.pathname}?multiplayer=1#host=${hostId}&secret=${secret}` };
      publish();
    },
    failed: error => {
      signalingError = error;
      view = { ...view, status: view.invitationUrl ? "connected" : "disconnected" };
      publish();
    },
    connection: connection => {
      if (closed || connections.size >= 24 || connection.serialization !== "binary") { connection.close(); return; }
      const connectionId = crypto.randomUUID();
      const entry = { connection, joined: false, timeout: setTimeout(() => remove(connectionId), CONNECTION_TIMEOUT) };
      connections.set(connectionId, entry);
      connection.on("close", () => remove(connectionId));
      connection.on("error", () => remove(connectionId));
      connection.on("iceStateChanged", state => {
        if (state === "failed" || state === "disconnected" || state === "closed") remove(connectionId);
      });
      connection.on("data", value => {
        if (closed || connections.get(connectionId) !== entry) return;
        try {
          const message = parseClientMessage(value);
          if (message.type === "join") {
            if (entry.joined) throw new GameError("This connection has already joined.");
            const joined = room.join(connectionId, message);
            clearTimeout(entry.timeout);
            entry.joined = true;
            if (joined.revokedConnectionId) deny(joined.revokedConnectionId, { key: "This seat reconnected on another connection. This old connection is no longer authorized." });
            if (joined.credential) send(connection, { type: "admitted", credential: joined.credential }, () => remove(connectionId));
            publish();
          } else if (message.type === "profile-stats") {
            if (!entry.joined) throw new GameError("Join this room before sending commands.");
            room.submitProfile(connectionId, message.stats);
            publish();
          } else {
            if (!entry.joined) throw new GameError("Join this room before sending commands.");
            const result = room.command(connectionId, message);
            publish();
            send(connection, result, () => remove(connectionId));
          }
        } catch (error) {
          const message = gameErrorMessage(error, "Invalid network message.");
          if (!entry.joined) deny(connectionId, message);
          else send(connection, { type: "error", error: message, terminal: false }, () => remove(connectionId));
        }
      });
    },
  });
  function perform(operation: () => void) {
    if (closed) return;
    try { operation(); view = { ...view, error: null }; }
    catch (error) { view = { ...view, error: gameErrorMessage(error) }; }
    publish();
  }
  onChange(view);
  return {
    setVariant: variant => perform(() => room.setVariant(variant)),
    shuffleBoard: () => perform(() => room.shuffleBoard()),
    useMapSeed: seed => perform(() => room.useMapSeed(seed)),
    startGame: () => perform(() => {
      const waiting = room.snapshot().pendingPlayers ?? [];
      room.start();
      for (const pending of waiting) deny(pending.connectionId, { key: "The game started before you were admitted." });
    }),
    endGame: () => perform(() => room.endGame()),
    resetGame: () => perform(() => room.resetGame()),
    admit: connectionId => perform(() => {
      const entry = connections.get(connectionId);
      if (!entry?.joined || !entry.connection.open) throw new GameError("That exact join request is no longer connected.");
      const credential = room.admit(connectionId);
      send(entry.connection, { type: "admitted", credential }, () => remove(connectionId));
    }),
    reject: connectionId => perform(() => { room.reject(connectionId); deny(connectionId, { key: "The host declined your join request." }); }),
    addComputer: language => perform(() => room.addComputer(language)),
    removePlayer: playerId => perform(() => {
      const connectionId = room.removePlayer(playerId);
      if (connectionId) deny(connectionId, { key: "The host removed you from the lobby. Use Reconnect to request a new seat." });
    }),
    renameComputer: (playerId, name) => perform(() => room.renameComputer(playerId, name)),
    perform: (action, expectedVersion) => perform(() => room.performBoard(action, expectedVersion)),
    selectBuild: (piece, expectedVersion) => perform(() => room.selectBuild(piece, undefined, expectedVersion)),
    reconnect: () => { if (!closed) link.reconnect(); },
    close: () => {
      if (closed) return;
      closed = true;
      clearTimeout(computerTimer);
      for (const connectionId of [...connections.keys()]) remove(connectionId);
      link.close();
      view = { ...view, status: "closed", pending: false, snapshot: null, invitationUrl: null };
      onChange(view);
    },
  };
}

export function joinSession(invitation: Invitation, name: string, onChange: (view: SessionView) => void): MultiplayerSession {
  const storageKey = `catania:multiplayer:${invitation.hostId}`;
  let credential: string | null = null;
  let storageError: GameMessage | null = null;
  let signalingError: GameMessage | null = null;
  try { credential = sessionStorage.getItem(storageKey); }
  catch { storageError = { key: "Session storage is blocked. Refreshing this page will lose your seat credential." }; }
  let closed = false;
  let stopped = false;
  let connection: DataConnection | null = null;
  let retry: Timer | undefined;
  let timeout: Timer | undefined;
  let requestId: string | null = null;
  let view: SessionView = { role: "player", status: "connecting", invitationUrl: null, snapshot: null, error: null, pending: false };
  function publish() { onChange({ ...view, error: view.error || signalingError || storageError }); }
  function clearPending() {
    requestId = null;
    clearTimeout(timeout); timeout = undefined;
    view = { ...view, pending: false };
  }
  function disconnect(error: GameMessage, retryConnection = true) {
    if (closed) return;
    const previous = connection;
    connection = null;
    previous?.removeAllListeners();
    previous?.close();
    clearPending();
    view = { ...view, status: "disconnected", error };
    publish();
    if (retryConnection && !stopped && !retry) retry = setTimeout(() => { retry = undefined; link.reconnect(); }, RETRY_DELAY);
  }
  function connect() {
    if (closed || stopped || connection) return;
    clearTimeout(retry); retry = undefined;
    view = { ...view, status: "connecting", error: null };
    publish();
    const current = link.peer.connect(invitation.hostId, { reliable: true, serialization: "binary" });
    connection = current;
    const failed = (reason:
      | "Connection to the host was lost. Keep both pages open."
      | "Timed out waiting for the host's connection answer. Keep the host page open and use its latest invitation."
      | "Connected to the host, but timed out waiting for the initial game state. Keep the host page active."
      | "The host answered, but the direct WebRTC connection timed out. Check device firewalls, VPNs, and router device isolation. No relay fallback is configured."
      | "The direct WebRTC connection failed or was interrupted. Check device firewalls, VPNs, and router device isolation. No relay fallback is configured."
      = "Connection to the host was lost. Keep both pages open.") => {
      if (connection !== current) return;
      const peerConnection = current.peerConnection;
      disconnect(peerConnection ? {
        key: `${reason} Connection details: ICE {iceState}; gathering {gatheringState}. Reconnecting automatically.`,
        parameters: { iceState: peerConnection.iceConnectionState, gatheringState: peerConnection.iceGatheringState },
      } : { key: `${reason} Reconnecting automatically.` });
    };
    timeout = setTimeout(() => {
      let message: Parameters<typeof failed>[0] = "Timed out waiting for the host's connection answer. Keep the host page open and use its latest invitation.";
      if (current.open) message = "Connected to the host, but timed out waiting for the initial game state. Keep the host page active.";
      else if (current.peerConnection?.remoteDescription) message = "The host answered, but the direct WebRTC connection timed out. Check device firewalls, VPNs, and router device isolation. No relay fallback is configured.";
      failed(message);
    }, CONNECTION_TIMEOUT);
    current.on("close", () => failed());
    current.on("error", () => failed());
    current.on("iceStateChanged", state => {
      if (state === "failed" || state === "disconnected" || state === "closed") failed("The direct WebRTC connection failed or was interrupted. Check device firewalls, VPNs, and router device isolation. No relay fallback is configured.");
    });
    current.on("open", () => {
      // Secrets and credentials travel only over the encrypted data channel, never signaling metadata.
      send(current, { type: "join", secret: invitation.secret, name, ...(credential ? { credential } : {}) }, failed);
    });
    current.on("data", value => {
      if (closed || connection !== current) return;
      let message: ServerMessage;
      try { message = parseServerMessage(value); }
      catch { stopped = true; disconnect({ key: "The host sent an invalid network message. Reconnect only to a trusted host." }, false); return; }
      switch (message.type) {
        case "admitted":
          credential = message.credential;
          try { sessionStorage.setItem(storageKey, credential); }
          catch { storageError = { key: "Session storage is blocked. Refreshing this page will lose your seat credential." }; }
          publish();
          break;
        case "request-profile": {
          // Record this finished game into the selected profile, then share the totals with the shared board.
          const snapshot = view.snapshot;
          const game = snapshot?.game ?? null;
          const finished = game?.phase.type === "finished" ? game : null;
          const own = snapshot?.playerId && finished ? finished.players.find(player => player.id === snapshot.playerId) : undefined;
          if (!finished || !own) break;
          if (!snapshot?.mapSeed) {
            view = { ...view, error: { key: "The host did not provide a map code for this game." } };
            publish();
            break;
          }
          try {
            const profile = recordGameResultForActive({
              gameId: finished.gameId,
              mapCode: snapshot.mapSeed,
              variant: finished.variant,
              won: finished.winnerId === own.id,
              points: own.score,
              turnCount: finished.turnNumber,
            });
            if (profile) send(current, { type: "profile-stats", stats: profileStats(profile) }, failed);
          } catch (error) {
            view = { ...view, error: gameErrorMessage(error, "Your game history could not be saved on this device.") };
            publish();
          }
          break;
        }
        case "snapshot":
          if (view.snapshot && message.snapshot.version < view.snapshot.version) return;
          if (message.snapshot.game?.gameId !== view.snapshot?.game?.gameId) clearPending();
          if (!requestId) { clearTimeout(timeout); timeout = undefined; }
          view = { ...view, status: "connected", snapshot: message.snapshot, error: null };
          publish();
          break;
        case "result":
          if (message.requestId !== requestId) return;
          clearPending();
          view = { ...view, error: message.error };
          publish();
          break;
        case "error":
          clearPending();
          view = { ...view, error: message.error };
          if (message.terminal) {
            credential = null;
            try { sessionStorage.removeItem(storageKey); }
            catch { storageError = { key: "Session storage is blocked. The old seat credential could not be cleared." }; }
            view = { ...view, snapshot: null };
            stopped = true;
            clearTimeout(retry); retry = undefined;
            disconnect(message.error, false);
          }
          else publish();
          break;
      }
    });
  }
  const link = signaling(crypto.randomUUID(), {
    ready: () => { signalingError = null; if (connection?.open) { view = { ...view, error: null }; publish(); } else connect(); },
    failed: error => {
      signalingError = error;
      if (connection?.open) publish();
      else disconnect(error);
    },
    connection: connection => connection.close(),
  });
  function command(intent: { type: "action"; action: GameAction } | { type: "select-build"; piece: BuildMode }, expectedVersion?: number) {
    if (closed) return;
    if (!connection?.open || view.status !== "connected" || !view.snapshot?.playerId) {
      view = { ...view, error: { key: "Wait until the host admits your connected phone." } }; publish(); return;
    }
    if (requestId) return;
    requestId = crypto.randomUUID();
    let message: Command;
    try { message = parseClientMessage({ ...intent, requestId, version: expectedVersion ?? view.snapshot.version }) as Command; }
    catch (error) { clearPending(); view = { ...view, error: gameErrorMessage(error, "Invalid action.") }; publish(); return; }
    view = { ...view, pending: true, error: null };
    publish();
    timeout = setTimeout(() => disconnect({ key: "The host did not confirm the command. Reconnecting to obtain the authoritative state; the command will not be replayed." }), CONNECTION_TIMEOUT);
    send(connection, message, () => disconnect({ key: "The command could not reach the host. Reconnecting automatically." }));
  }
  const hostOnly = () => { if (!closed) { view = { ...view, error: { key: "Only the shared host can manage the lobby or start the game." } }; publish(); } };
  publish();
  return {
    setVariant: hostOnly, startGame: hostOnly, resetGame: hostOnly, shuffleBoard: hostOnly, useMapSeed: hostOnly, admit: hostOnly, reject: hostOnly, addComputer: hostOnly, removePlayer: hostOnly, renameComputer: hostOnly, endGame: hostOnly,
    perform: (action, expectedVersion) => command({ type: "action", action }, expectedVersion),
    selectBuild: (piece, expectedVersion) => command({ type: "select-build", piece }, expectedVersion),
    reconnect: () => {
      if (closed) return;
      stopped = false;
      clearTimeout(retry); retry = undefined;
      if (!connection?.open) disconnect({ key: "Reconnecting to the host." }, false);
      link.reconnect();
    },
    close: () => {
      if (closed) return;
      closed = true;
      clearTimeout(retry); clearPending();
      connection?.removeAllListeners(); connection?.close(); connection = null;
      link.close();
      signalingError = null;
      view = { ...view, status: "closed", snapshot: null, error: null, pending: false };
      publish();
    },
  };
}
