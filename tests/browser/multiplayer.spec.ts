import { expect, test as base, type BrowserContext, type Page, type TestInfo } from "@playwright/test";
import { pack, unpack } from "peerjs-js-binarypack";
import QRCode from "qrcode";
import type { RoomSnapshot } from "../../src/multiplayer/types";

type WireMessage = { direction: "sent" | "received"; message: Record<string, unknown> };
type WireFrame = { direction: WireMessage["direction"]; channel: number; bytes: number[] };
type ObservedWindow = Window & {
  multiplayerProbe: { channels: RTCDataChannel[]; frames: WireFrame[] };
};
type MultiplayerHarness = {
  newPage: (name: string, phone?: boolean) => Promise<Page>;
  disconnectSignaling: (page: Page) => void;
};

const test = base.extend<{ multiplayer: MultiplayerHarness }>({
  multiplayer: async ({ browser, baseURL, viewport, isMobile, hasTouch }, use, testInfo) => {
    const contexts: BrowserContext[] = [];
    const sockets = new Map<BrowserContext, WebSocket[]>();
    const errors: string[] = [];
    const consoleMessages: string[] = [];
    const navigationSocketClosures: string[] = [];
    const externalRequests: string[] = [];
    const signaling: { direction: string; type: string }[] = [];
    let connectionInterrupted = false;

    async function newPage(name: string, phone = false) {
      const context = await browser.newContext({
        baseURL,
        viewport: phone ? { width: 390, height: 844 } : viewport,
        isMobile: phone || isMobile,
        hasTouch: phone || hasTouch,
      });
      contexts.push(context);
      sockets.set(context, []);
      await context.route("**/*", route => {
        if (new URL(route.request().url()).origin === new URL(baseURL!).origin) return route.continue();
        externalRequests.push(route.request().url());
        return route.abort();
      });
      await context.routeWebSocket("**/*", route => {
        const source = new URL(route.url());
        if (!source.hostname.endsWith(".peerjs.com")) {
          if (source.host === new URL(baseURL!).host) route.connectToServer();
          else {
            externalRequests.push(route.url());
            void route.close();
          }
          return;
        }
        expect(source.pathname).toBe("/peerjs");
        expect(source.searchParams.get("id")).toBeTruthy();
        // Playwright 1.64 connectToServer has no URL override. Forward unchanged
        // signaling to a real PeerServer; browser RTCDataChannels remain native.
        const socket = new WebSocket(`ws://127.0.0.1:4176${source.pathname}${source.search}`);
        sockets.get(context)!.push(socket);
        const pending: string[] = [];
        let pageClosedSocket = false;
        route.onMessage(message => {
          expect(typeof message, "PeerJS signaling uses text frames").toBe("string");
          signaling.push({ direction: "sent", type: JSON.parse(message.toString()).type });
          if (socket.readyState === WebSocket.OPEN) socket.send(message.toString());
          else pending.push(message.toString());
        });
        socket.addEventListener("open", () => {
          for (const message of pending.splice(0)) socket.send(message);
        });
        socket.addEventListener("message", event => {
          signaling.push({ direction: "received", type: JSON.parse(String(event.data)).type });
          route.send(String(event.data));
        });
        socket.addEventListener("error", event => {
          const message = `${name}: local PeerServer socket error: ${(event as ErrorEvent).message}`;
          // Refresh/StrictMode cleanup can close a routed socket before its local handshake finishes.
          if (pageClosedSocket) navigationSocketClosures.push(message);
          else errors.push(message);
        });
        socket.addEventListener("close", () => { void route.close({ code: 1000 }); });
        route.onClose(() => { pageClosedSocket = true; socket.close(); });
      });
      await context.addInitScript(() => {
        const probe: ObservedWindow["multiplayerProbe"] = { channels: [], frames: [] };
        (window as unknown as ObservedWindow).multiplayerProbe = probe;
        const nativeSend = RTCDataChannel.prototype.send;
        function record(direction: WireMessage["direction"], channel: RTCDataChannel, payload: unknown) {
          const bytes = payload instanceof ArrayBuffer ? new Uint8Array(payload)
            : ArrayBuffer.isView(payload) ? new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength) : null;
          if (!bytes) throw new Error("Expected PeerJS binary data-channel framing");
          probe.frames.push({ direction, channel: probe.channels.indexOf(channel), bytes: Array.from(bytes) });
        }
        RTCDataChannel.prototype.send = function (this: RTCDataChannel, data: Parameters<RTCDataChannel["send"]>[0]) {
          if (!probe.channels.includes(this)) {
            probe.channels.push(this);
            this.addEventListener("message", event => record("received", this, event.data));
          }
          Reflect.apply(nativeSend, this, [data]);
          record("sent", this, data);
        } as RTCDataChannel["send"];
      });
      const page = await context.newPage();
      page.on("console", message => consoleMessages.push(`${name} ${message.type()}: ${message.text()}`));
      page.on("pageerror", error => errors.push(`${name} pageerror: ${error.message}`));
      page.on("requestfailed", request => errors.push(`${name} ${request.failure()?.errorText}: ${request.url()}`));
      page.on("response", response => {
        if (response.status() >= 400) errors.push(`${name} HTTP ${response.status()}: ${response.url()}`);
      });
      return page;
    }

    try {
      await use({
        newPage,
        disconnectSignaling(page) {
          connectionInterrupted = true;
          const connections = sockets.get(page.context())!.filter(socket => socket.readyState === WebSocket.OPEN);
          expect(connections.length).toBeGreaterThan(0);
          for (const socket of connections) socket.close(1000, "Intentional signaling outage");
        },
      });
    } finally {
      await testInfo.attach("multiplayer-browser-diagnostics", {
        body: JSON.stringify({ errors, consoleMessages, navigationSocketClosures, externalRequests, signaling }, null, 2),
        contentType: "application/json",
      });
      expect.soft(errors, "No browser exceptions or failed application requests").toEqual([]);
      expect.soft(externalRequests, "No public cloud HTTP or WebSocket connections").toEqual([]);
      if (!connectionInterrupted) expect.soft(consoleMessages.filter(message => message.includes(" error:"))).toEqual([]);
      expect.soft(signaling.filter(message => !["OPEN", "OFFER", "ANSWER", "CANDIDATE", "HEARTBEAT", "LEAVE", "EXPIRE"].includes(message.type)),
        "Only PeerJS signaling, never gameplay snapshots, travels through PeerServer").toEqual([]);
      for (const context of contexts.toReversed()) await context.close();
      for (const connections of sockets.values()) for (const socket of connections) socket.close();
    }
  },
});

const observations = new WeakMap<Page, { generation: number; messages: WireMessage[]; chunks: Map<string, Uint8Array[]> }>();

async function messages(page: Page) {
  const { generation, frames } = await page.evaluate(() => ({
    generation: performance.timeOrigin,
    frames: (window as unknown as ObservedWindow).multiplayerProbe.frames.splice(0),
  }));
  if (observations.get(page)?.generation !== generation) observations.set(page, { generation, messages: [], chunks: new Map() });
  const { messages, chunks } = observations.get(page)!;
  for (const { direction, channel, bytes } of frames) {
    let message = unpack(Uint8Array.from(bytes).buffer) as Record<string, unknown>;
    if (typeof message.__peerData === "number") {
      const key = `${direction}:${channel}:${message.__peerData}`;
      const parts = chunks.get(key) ?? [];
      chunks.set(key, parts);
      parts[message.n as number] = new Uint8Array(message.data as ArrayBuffer);
      if (parts.filter(Boolean).length !== message.total) continue;
      const combined = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
      let offset = 0;
      for (const part of parts) {
        combined.set(part, offset);
        offset += part.length;
      }
      message = unpack(combined.buffer) as Record<string, unknown>;
      chunks.delete(key);
    }
    messages.push({ direction, message });
  }
  return messages;
}

async function latestSnapshot(page: Page): Promise<RoomSnapshot> {
  const received = (await messages(page)).filter(entry => entry.direction === "received" && entry.message.type === "snapshot");
  return received.at(-1)!.message.snapshot as RoomSnapshot;
}

async function screenshot(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach(name, { path, contentType: "image/png" });
}

async function noHorizontalOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)))
    .toBeLessThanOrEqual(page.viewportSize()!.width);
}

async function hostGame(host: Page) {
  await host.goto("/?multiplayer=1");
  await host.getByRole("button", { name: "Host board", exact: true }).click();
  const invitation = host.getByLabel("Game invitation", { exact: true });
  await expect(invitation).toHaveValue(/#host=.+&secret=.+/);
  await expect(invitation).toHaveAttribute("readonly", "");
  const address = await invitation.inputValue();
  const url = new URL(address);
  expect(url.origin).toBe(new URL(host.url()).origin);
  expect(url.searchParams.get("multiplayer")).toBe("1");
  const parameters = new URLSearchParams(url.hash.slice(1));
  expect(parameters.get("host")).toBeTruthy();
  expect(parameters.get("secret")).toBeTruthy();
  const image = host.getByRole("img", { name: "Scan to join this game", exact: true });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate(element => {
    const image = element as HTMLImageElement;
    return image.complete && image.naturalWidth >= 200 && image.naturalHeight >= 200;
  })).toBe(true);
  const expected = QRCode.create(address, { errorCorrectionLevel: "M" }).modules;
  const rendered = await image.evaluate((element, size) => {
    const image = element as HTMLImageElement;
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const scale = canvas.width / (size + 6);
    return Array.from({ length: size * size }, (_, index) => {
      const x = Math.floor((index % size + 3.5) * scale);
      const y = Math.floor((Math.floor(index / size) + 3.5) * scale);
      return pixels[(y * canvas.width + x) * 4]! < 128 ? 1 : 0;
    });
  }, expected.size);
  expect(rendered, "Rendered QR modules encode the exact invitation, including its secret").toEqual(Array.from(expected.data));
  await expect(host.getByRole("heading", { name: "Your cards", includeHidden: true })).toHaveCount(0);
  await expect(host.getByRole("button", { name: "Start game", exact: true })).toBeDisabled();
  return address;
}

async function requestSeat(phone: Page, invitation: string, name: string) {
  await phone.goto(invitation);
  await phone.getByLabel("Your name", { exact: true }).fill(name);
  await phone.getByRole("button", { name: "Connect to game", exact: true }).click();
}

async function expectPhase(pages: Page[], phase: string, activePlayer: string) {
  for (const page of pages) {
    await expect(page.getByTestId("game-phase")).toHaveAttribute("data-phase", phase);
    await expect(page.getByTestId("game-phase")).toHaveAttribute("data-active-player", activePlayer);
  }
}

test("host and three private phones play over real PeerJS channels and recover a refreshed seat", async ({ multiplayer }, testInfo) => {
  const host = await multiplayer.newPage("Host");
  const invitation = await hostGame(host);
  await noHorizontalOverflow(host);
  await screenshot(host, testInfo, "host-invitation");
  const phones = new Map<string, Page>();
  for (const name of ["Alex", "Sam", "Taylor"]) {
    const phone = await multiplayer.newPage(name, true);
    phones.set(name, phone);
    await requestSeat(phone, invitation, name);
    await expect(host.getByRole("button", { name: `Admit ${name}`, exact: true })).toBeVisible();
    await expect(phone.getByRole("heading", { name: "Your cards", includeHidden: true })).toHaveCount(0);
    await expect(host.getByRole("button", { name: "Start game", exact: true })).toBeDisabled();
    await expect.poll(async () => (await messages(phone)).filter(entry => entry.message.type === "snapshot").length).toBeGreaterThan(0);
    const waiting = await latestSnapshot(phone);
    expect(waiting.game).toBeNull();
    expect(waiting.privatePlayer).toBeNull();
    expect(waiting).not.toHaveProperty("pendingPlayers");
    await host.getByRole("button", { name: `Admit ${name}`, exact: true }).click();
    await expect.poll(async () => (await latestSnapshot(phone)).playerId).toBeTruthy();
  }
  const pages = [host, ...phones.values()];
  for (const page of pages) {
    const roster = page.getByRole("list", { name: "Players", exact: true });
    await expect(roster.getByRole("listitem")).toHaveCount(3);
    for (const name of phones.keys()) await expect(roster.getByText(name, { exact: true })).toBeVisible();
  }
  await expect(host.getByRole("button", { name: "Start game", exact: true })).toBeEnabled();
  await host.getByRole("button", { name: "Start game", exact: true }).click();

  const setupPlayers: string[] = [];
  for (let placement = 0; placement < 6; placement++) {
    await expect(host.getByTestId("game-phase")).toHaveAttribute("data-phase", "setup-settlement");
    const activePlayer = (await host.getByTestId("game-phase").getAttribute("data-active-player"))!;
    expect(phones.has(activePlayer)).toBe(true);
    setupPlayers.push(activePlayer);
    await expectPhase(pages, "setup-settlement", activePlayer);
    await host.getByRole("button", { name: /^Place settlement at / }).first().click();
    await host.getByRole("button", { name: "Confirm placement", exact: true }).click();
    await expectPhase(pages, "setup-road", activePlayer);
    await expect(host.getByRole("img", { name: /'s settlement at / })).toHaveCount(placement + 1);
    for (const phone of phones.values()) {
      await expect.poll(async () => (await latestSnapshot(phone)).game!.board.vertices.filter(vertex => vertex.building).length).toBe(placement + 1);
    }
    await host.getByRole("button", { name: /^Build road at / }).first().click();
    await host.getByRole("button", { name: "Confirm placement", exact: true }).click();
    await expect(host.getByRole("img", { name: /'s road at / })).toHaveCount(placement + 1);
    for (const phone of phones.values()) {
      await expect.poll(async () => (await latestSnapshot(phone)).game!.board.edges.filter(edge => edge.playerId).length).toBe(placement + 1);
    }
  }
  const firstRound = setupPlayers.slice(0, 3);
  expect(new Set(firstRound).size).toBe(3);
  expect(setupPlayers).toEqual([...firstRound, ...firstRound.toReversed()]);
  const activeName = firstRound[0]!;
  const activePhone = phones.get(activeName)!;
  await expectPhase(pages, "roll", activeName);

  for (const [name, phone] of phones) {
    await expect(phone.getByRole("heading", { name: "Your cards", exact: true })).toBeVisible();
    await expect(phone.getByRole("region", { name: "Your current resources", exact: true })).toHaveCount(1);
    for (const action of ["Roll the dice", "End turn", "Build road", "Build settlement", "Build city", "Buy development card"]) {
      await expect(phone.getByRole("button", { name: action, exact: true })).toBeVisible();
    }
    const snapshots = (await messages(phone)).filter(entry => entry.direction === "received" && entry.message.type === "snapshot");
    for (const entry of snapshots) {
      const snapshot = entry.message.snapshot as RoomSnapshot;
      expect(Object.keys(snapshot).sort()).toEqual(["version", "players", "game", "playerId", "privatePlayer", "privateScore", "buildMode", "boardTargets"].sort());
      expect(snapshot).not.toHaveProperty("pendingPlayers");
      if (!snapshot.game) continue;
      expect(snapshot.privatePlayer?.name).toBe(name);
      expect(snapshot.privatePlayer?.id).toBe(snapshot.playerId);
      expect(snapshot.game).not.toHaveProperty("developmentDeck");
      expect(snapshot.game.phase).not.toHaveProperty("pendingKnight");
      for (const player of snapshot.game.players) {
        expect(player).not.toHaveProperty("resources");
        expect(player).not.toHaveProperty("developmentCards");
        expect(player.resourceCount).toEqual(expect.any(Number));
        expect(player.developmentCount).toEqual(expect.any(Number));
      }
    }
    const ownSnapshot = await latestSnapshot(phone);
    for (const [resource, count] of Object.entries(ownSnapshot.privatePlayer!.resources)) {
      const label = resource[0]!.toUpperCase() + resource.slice(1);
      await expect(phone.getByRole("listitem", { name: `${label}: ${count} in hand`, exact: true })).toBeVisible();
    }
    await phone.getByText("All players and bank", { exact: true }).click();
    for (const player of ownSnapshot.game!.players) {
      const row = phone.getByRole("list", { name: "Players", exact: true }).getByRole("listitem").filter({ has: phone.getByText(player.name, { exact: true }) });
      await expect(row).toContainText(`${player.resourceCount} resource cards / ${player.developmentCount} development cards`);
    }
    await phone.getByText("All players and bank", { exact: true }).click();
    await expect.poll(() => phone.evaluate(() => (window as unknown as ObservedWindow).multiplayerProbe.channels.some(channel => channel.readyState === "open"))).toBe(true);
    await noHorizontalOverflow(phone);
  }
  await expect(host.getByRole("heading", { name: "Your cards", includeHidden: true })).toHaveCount(0);
  await expect(host.getByRole("region", { name: "Your current resources", includeHidden: true })).toHaveCount(0);
  await noHorizontalOverflow(host);
  await screenshot(host, testInfo, "host-completed-setup");
  await screenshot(activePhone, testInfo, "phone-private-hand");
  await activePhone.setViewportSize({ width: 320, height: 844 });
  await screenshot(activePhone, testInfo, "phone-private-hand-compact");
  await noHorizontalOverflow(activePhone);
  await activePhone.setViewportSize({ width: 390, height: 844 });

  const inactivePhone = phones.get(firstRound[1]!)!;
  await expect(inactivePhone.getByRole("button", { name: "Roll the dice", exact: true })).toBeDisabled();
  const beforeRejectedRoll = await latestSnapshot(inactivePhone);
  const requestId = crypto.randomUUID();
  const command = await pack({ type: "action", requestId, version: beforeRejectedRoll.version, action: { type: "roll" } });
  await inactivePhone.evaluate(bytes => {
    const channel = (window as unknown as ObservedWindow).multiplayerProbe.channels.find(channel => channel.readyState === "open")!;
    channel.send(Uint8Array.from(bytes).buffer);
  }, Array.from(new Uint8Array(command)));
  await expect.poll(async () => (await messages(inactivePhone)).find(entry => entry.direction === "received" && entry.message.type === "result" && entry.message.requestId === requestId)?.message.error)
    .toBe("Wait for your turn to perform this action.");
  await expectPhase(pages, "roll", activeName);
  expect((await latestSnapshot(activePhone)).game!.dice).toBeNull();

  const beforeRefresh = await latestSnapshot(activePhone);
  const hostId = new URLSearchParams(new URL(invitation).hash.slice(1)).get("host")!;
  const storageKey = `catania:multiplayer:${hostId}`;
  const credential = await activePhone.evaluate(key => sessionStorage.getItem(key), storageKey);
  expect(credential).toBeTruthy();
  await activePhone.reload();
  await expect(activePhone.getByRole("button", { name: "Roll the dice", exact: true })).toBeEnabled({ timeout: 15_000 });
  const afterRefresh = await latestSnapshot(activePhone);
  expect(afterRefresh.playerId).toBe(beforeRefresh.playerId);
  expect(afterRefresh.privatePlayer).toEqual(beforeRefresh.privatePlayer);
  expect(await activePhone.evaluate(key => sessionStorage.getItem(key), storageKey)).toBe(credential);
  await expect(host.getByRole("button", { name: /^Admit / })).toHaveCount(0);
  await expect(host.getByRole("list", { name: "Players", exact: true }).getByRole("listitem")).toHaveCount(3);

  await activePhone.getByRole("button", { name: "Roll the dice", exact: true }).click();
  await expect(host.getByTestId("game-phase")).not.toHaveAttribute("data-phase", "roll");
  await expect(activePhone.getByTestId("game-phase")).not.toHaveAttribute("data-phase", "roll");
  const rolled = (await latestSnapshot(activePhone)).game!;
  expect(rolled.dice).toHaveLength(2);
  for (const die of rolled.dice!) {
    expect(die).toBeGreaterThanOrEqual(1);
    expect(die).toBeLessThanOrEqual(6);
  }
  const total = rolled.dice![0] + rolled.dice![1];
  expect(rolled.phase.type).toBe(total === 7 ? "robber" : "actions");
  await expectPhase(pages, rolled.phase.type, activeName);
  for (const phone of phones.values()) await expect.poll(async () => (await latestSnapshot(phone)).game).toEqual(rolled);
  await expect(host.getByRole("region", { name: "Turn status", exact: true })).toContainText(String(total));
  await screenshot(host, testInfo, "host-shared-roll");
  await screenshot(activePhone, testInfo, "phone-after-roll");
});

test("signaling and data-channel loss report failure and recover the reserved seat", async ({ multiplayer }, testInfo) => {
  const host = await multiplayer.newPage("Host");
  const invitation = await hostGame(host);
  const phones: Page[] = [];
  for (const name of ["Alex", "Sam", "Taylor"]) {
    const phone = await multiplayer.newPage(name, true);
    phones.push(phone);
    await requestSeat(phone, invitation, name);
    await host.getByRole("button", { name: `Admit ${name}`, exact: true }).click();
    await expect(phone.getByRole("heading", { name: `Welcome, ${name}.`, exact: true })).toBeVisible();
  }
  const phone = phones[0]!;
  const originalSeat = (await latestSnapshot(phone)).playerId;
  await expect(host.getByRole("button", { name: "Start game", exact: true })).toBeEnabled();

  multiplayer.disconnectSignaling(host);
  await expect(host.getByRole("alert")).toContainText("PeerJS signaling disconnected");
  await expect(host.getByRole("button", { name: "Start game", exact: true })).toBeEnabled();
  expect(await phone.evaluate(() => (window as unknown as ObservedWindow).multiplayerProbe.channels.some(channel => channel.readyState === "open")),
    "Losing signaling does not replace or close an established native data channel").toBe(true);
  await screenshot(host, testInfo, "host-signaling-interrupted");
  await expect(host.getByRole("alert")).toHaveCount(0);
  await expect(host.getByRole("button", { name: "Start game", exact: true })).toBeEnabled();

  await phone.evaluate(() => {
    const channel = (window as unknown as ObservedWindow).multiplayerProbe.channels.find(channel => channel.readyState === "open")!;
    channel.close();
  });
  await expect(phone.getByRole("alert")).toContainText("Connection to the host was lost");
  await expect(host.getByRole("button", { name: "Start game", exact: true })).toBeDisabled();
  await phone.getByRole("button", { name: "Reconnect", exact: true }).click();
  await expect(phone.getByRole("alert")).toHaveCount(0);
  await expect(host.getByRole("button", { name: "Start game", exact: true })).toBeEnabled();
  expect((await latestSnapshot(phone)).playerId).toBe(originalSeat);
  await expect(host.getByRole("button", { name: /^Admit / })).toHaveCount(0);
  for (const page of [host, ...phones]) await expect(page.getByRole("list", { name: "Players", exact: true }).getByRole("listitem")).toHaveCount(3);
});
