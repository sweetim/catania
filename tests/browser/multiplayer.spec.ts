import { type BrowserContext, type Locator, type Page, type TestInfo } from "@playwright/test";
import { expect, seedProfile, test as base } from "./fixtures";
import { pack, unpack } from "peerjs-js-binarypack";
import QRCode from "qrcode";
import { emptyResources, getTradeRatio, legalSettlementVertices, RESOURCES } from "../../src/game/engine";
import { createBoard } from "../../src/game/board";
import { RESOURCE_NAMES } from "../../src/components/GameUi";
import type { Resources } from "../../src/game/types";
import type { RoomSnapshot } from "../../src/multiplayer/types";

const signalingPort = Number(process.env.PLAYWRIGHT_SIGNALING_PORT ?? 4176);

type WireMessage = { direction: "sent" | "received"; message: Record<string, unknown> };
type WireFrame = { direction: WireMessage["direction"]; channel: number; bytes: number[] };
type ObservedWindow = Window & {
  multiplayerProbe: { channels: RTCDataChannel[]; frames: WireFrame[]; connections: RTCPeerConnection[]; blockedSends?: number };
};
type MultiplayerHarness = {
  newPage: (name: string, phone?: boolean, locale?: string) => Promise<Page>;
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

    async function newPage(name: string, phone = false, locale = "en-US") {
      const context = await browser.newContext({
        baseURL,
        viewport: phone ? { width: 390, height: 844 } : viewport,
        isMobile: phone || isMobile,
        hasTouch: phone || hasTouch,
        locale,
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
        const socket = new WebSocket(`ws://127.0.0.1:${signalingPort}${source.pathname}${source.search}`);
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
        const probe: ObservedWindow["multiplayerProbe"] = { channels: [], frames: [], connections: [] };
        (window as unknown as ObservedWindow).multiplayerProbe = probe;
        // Native STUN traffic bypasses HTTP routing; keep discovery local in tests.
        window.RTCPeerConnection = new Proxy(window.RTCPeerConnection, {
          construct(target, argumentsList) {
            const connection = new target({ ...argumentsList[0], iceServers: [] });
            probe.connections.push(connection);
            return connection;
          },
        });
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
      await seedProfile(context);
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

async function privateScreenFits(page: Page) {
  await noHorizontalOverflow(page);
  await expect.poll(() => page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)))
    .toBeLessThanOrEqual(page.viewportSize()!.height);
  const dashboard = page.getByLabel("Your hand and actions", { exact: true });
  const bounds = await dashboard.boundingBox();
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  const scrollContainer = page.viewportSize()!.width < 700 ? page.locator(".private-hand") : dashboard;
  const scrollTop = await scrollContainer.evaluate(element => element.scrollTop);
  for (const button of await dashboard.getByRole("button").all()) {
    await button.scrollIntoViewIfNeeded();
    const inScrollableHand = page.viewportSize()!.width < 700 && await button.evaluate(element => Boolean(element.closest(".private-hand")));
    const visibleHeight = inScrollableHand ? await scrollContainer.evaluate(element => element.clientHeight - 3) : page.viewportSize()!.height;
    expect(visibleHeight).toBeGreaterThanOrEqual(44);
    await expect(button).toBeInViewport({ ratio: Math.min(1, visibleHeight / (await button.boundingBox())!.height) });
  }
  await scrollContainer.evaluate((element, scrollTop) => { element.scrollTop = scrollTop; }, scrollTop);
  expect(await page.locator(page.viewportSize()!.width < 700 ? ".private-turn" : ".private-hand, .private-turn").evaluateAll(elements => elements
    .map(element => ({ panel: element.className, height: element.clientHeight, content: element.scrollHeight }))
    .filter(element => element.content > element.height))).toEqual([]);
}

async function expectInventory(dialog: Locator, resources: Resources) {
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  const inventory = dialog.getByRole("region", { name: "Your current resources", exact: true });
  await expect(inventory).toBeVisible();
  for (const resource of RESOURCES) {
    await expect(inventory.getByRole("listitem", { name: `${RESOURCE_NAMES[resource]}: ${resources[resource]} in hand`, exact: true })).toBeVisible();
  }
}

async function sentActions(page: Page) {
  return (await messages(page)).filter(entry => entry.direction === "sent" && entry.message.type === "action").map(entry => entry.message);
}

async function privateDialogFixture(multiplayer: MultiplayerHarness) {
  const host = await multiplayer.newPage("Host");
  const invitation = await hostGame(host);
  const phone = await multiplayer.newPage("Alex", true);
  await requestSeat(phone, invitation, "Alex");
  await host.getByRole("button", { name: "Admit Alex", exact: true }).click();
  await host.getByRole("button", { name: "Add computer", exact: true }).click();
  await host.getByRole("button", { name: "Add computer", exact: true }).click();
  await host.clock.install({ time: new Date("2030-01-01T00:00:00Z") });
  await host.clock.pauseAt(new Date("2030-01-01T00:00:01Z"));
  await host.getByRole("button", { name: "Start game", exact: true }).click();
  await expect(phone.getByTestId("game-phase")).toBeVisible();
  await phone.setViewportSize({ width: 320, height: 568 });
  const snapshot = await latestSnapshot(phone);
  snapshot.version += 100;
  snapshot.game!.activePlayerId = snapshot.playerId!;
  snapshot.game!.turnNumber = 5;
  snapshot.game!.phase = { type: "actions" };
  snapshot.privatePlayer!.resources = { wood: 5, brick: 0, wool: 5, grain: 5, ore: 5 };

  // Presentation only: the host's engine remains untouched and rejects these fixture versions.
  async function present() {
    snapshot.version++;
    const frame = await pack({ type: "snapshot", snapshot });
    await host.evaluate(bytes => {
      const channel = (window as unknown as ObservedWindow).multiplayerProbe.channels.find(channel => channel.readyState === "open")!;
      channel.send(Uint8Array.from(bytes).buffer);
    }, Array.from(new Uint8Array(frame)));
    await expect.poll(async () => (await latestSnapshot(phone)).version).toBe(snapshot.version);
    await expect(phone.getByTestId("game-phase")).toHaveAttribute("data-phase", snapshot.game!.phase.type);
  }
  return { host, phone, snapshot, present };
}

async function hostGame(host: Page) {
  await host.goto("/?multiplayer=1");
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
  await expect(host.getByRole("region", { name: "Your cards", exact: true, includeHidden: true })).toHaveCount(0);
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

async function chooseGameOption(page: Page, name: "Help" | "Settings" | "Reset game" | "Return to lobby" | "Leave room") {
  await page.getByRole("button", { name: "Game", exact: true }).click();
  await page.getByRole("group", { name: "Game menu", exact: true }).getByRole("button", { name, exact: true }).click();
}

async function selectMenuLanguage(page: Page, currentLanguage: "en" | "ja", nextLanguage: "en" | "ja") {
  await page.getByRole("button", { name: currentLanguage === "ja" ? "ゲーム" : "Game", exact: true }).click();
  await page.getByRole("combobox", { name: currentLanguage === "ja" ? "言語" : "Language", exact: true }).selectOption(nextLanguage);
  await page.keyboard.press("Escape");
}

test("invited phone avatar follows profile switching before joining", async ({ page }, testInfo) => {
  await page.goto("/?multiplayer=1#host=profile-ui-host&secret=profile-ui-secret");
  const menuButton = page.getByRole("button", { name: "Menu", exact: true });
  await expect(menuButton.locator(".profile-avatar")).toHaveText("A");
  await page.getByRole("textbox", { name: "Your name", exact: true }).fill("Guest");
  await menuButton.click();
  await page.getByRole("button", { name: "Profile", exact: true }).click();
  await expect(page.getByRole("listitem").filter({ has: page.getByRole("button", { name: "Continue as Alex", exact: true }) })).toContainText("Current profile");
  const creation = page.getByRole("form", { name: "Create a profile", exact: true });
  await creation.getByLabel("Profile name", { exact: true }).fill("Sam");
  await creation.getByRole("button", { name: "Create and continue", exact: true }).click();
  await expect(menuButton.locator(".profile-avatar")).toHaveText("S");
  await expect(page.getByRole("textbox", { name: "Your name", exact: true })).toHaveValue("Guest");
  await menuButton.click();
  await noHorizontalOverflow(page);
  await screenshot(page, testInfo, "invited-phone-profile-avatar");
});

test("completed multiplayer games save replayable profile history only once", async ({ multiplayer }) => {
  const { host, phone, snapshot, present } = await privateDialogFixture(multiplayer);
  snapshot.mapSeed = "ABCDEFGH";
  snapshot.game!.phase = { type: "finished" };
  snapshot.game!.winnerId = snapshot.playerId;
  const player = snapshot.game!.players.find(player => player.id === snapshot.playerId)!;
  player.score = 10;
  await present();
  for (let request = 0; request < 2; request++) {
    const frame = await pack({ type: "request-profile" });
    await host.evaluate(bytes => {
      const channel = (window as unknown as ObservedWindow).multiplayerProbe.channels.find(channel => channel.readyState === "open")!;
      channel.send(Uint8Array.from(bytes).buffer);
    }, Array.from(new Uint8Array(frame)));
    await expect.poll(() => phone.evaluate(() => JSON.parse(localStorage.getItem("catania.profiles")!)[0])).toMatchObject({
      games: 1, wins: 1, totalPoints: 10,
      history: [{
        gameId: snapshot.game!.gameId,
        mapCode: "ABCDEFGH",
        variant: snapshot.game!.variant,
        won: true, points: 10, turnCount: 5, completedAt: expect.any(String),
      }],
    });
  }
});

test("Japanese phones localize a shared English game without changing its state or names", async ({ multiplayer }, testInfo) => {
  const host = await multiplayer.newPage("English host");
  const invitation = await hostGame(host);
  const englishPhone = await multiplayer.newPage("English phone", true);
  await requestSeat(englishPhone, invitation, "Sam");
  await host.getByRole("button", { name: "Admit Sam", exact: true }).click();
  const japanesePhone = await multiplayer.newPage("Japanese phone", true, "ja-JP");
  await japanesePhone.goto(invitation);
  await expect(japanesePhone.locator("html")).toHaveAttribute("lang", "ja");
  await japanesePhone.getByRole("textbox", { name: "あなたの名前", exact: true }).fill("太郎");
  await japanesePhone.getByRole("button", { name: "ゲームに接続", exact: true }).click();
  await host.getByRole("button", { name: "Admit 太郎", exact: true }).click();
  await selectMenuLanguage(host, "en", "ja");
  await host.getByRole("button", { name: "コンピューターを追加", exact: true }).click();
  await expect(host.getByRole("button", { name: "コンピューター1の名前を変更", exact: true })).toBeVisible();
  await selectMenuLanguage(host, "ja", "en");
  await expect(host.getByRole("button", { name: "Rename コンピューター1", exact: true })).toBeVisible();
  await host.clock.install({ time: new Date("2030-01-01T00:00:00Z") });
  await host.clock.pauseAt(new Date("2030-01-01T00:00:01Z"));
  await host.getByRole("button", { name: "Start game", exact: true }).click();
  await expect(japanesePhone.getByTestId("game-phase")).toBeVisible();
  await expect(englishPhone.getByTestId("game-phase")).toBeVisible();
  for (const screen of [host, englishPhone]) {
    await screen.getByRole("button", { name: "Game", exact: true }).click();
    await expect(screen.getByRole("button", { name: "Profile", exact: true, includeHidden: true })).toHaveCount(0);
    await screen.keyboard.press("Escape");
  }
  const before = await latestSnapshot(japanesePhone);
  await expect(japanesePhone.getByRole("heading", { name: "太郎の手札", exact: true })).toBeVisible();
  await expect(englishPhone.getByRole("heading", { name: "Sam's hand", exact: true })).toBeVisible();
  await expect(japanesePhone.getByRole("button", { name: "サイコロを振る", exact: true })).toBeVisible();
  await expect(englishPhone.getByRole("button", { name: "Roll the dice", exact: true })).toBeVisible();

  await japanesePhone.getByRole("button", { name: "ゲーム", exact: true }).click();
  await expect(japanesePhone.getByRole("button", { name: "プロフィール", exact: true, includeHidden: true })).toHaveCount(0);
  await japanesePhone.getByRole("button", { name: "ヘルプ", exact: true }).click();
  await expect(japanesePhone.getByRole("dialog")).toContainText("盤面は共有、手札はそれぞれのスマートフォンで。");
  await japanesePhone.keyboard.press("Escape");

  const sentBefore = (await messages(japanesePhone)).filter(entry => entry.direction === "sent").length;
  await selectMenuLanguage(japanesePhone, "ja", "en");
  await expect(japanesePhone.getByRole("heading", { name: "太郎's hand", exact: true })).toBeVisible();
  await expect(host.locator("html")).toHaveAttribute("lang", "en");
  await expect(englishPhone.locator("html")).toHaveAttribute("lang", "en");
  expect((await latestSnapshot(japanesePhone)).version).toBe(before.version);
  expect((await latestSnapshot(japanesePhone)).privatePlayer).toEqual(before.privatePlayer);
  expect((await messages(japanesePhone)).filter(entry => entry.direction === "sent")).toHaveLength(sentBefore);
  await selectMenuLanguage(japanesePhone, "en", "ja");
  await selectMenuLanguage(host, "en", "ja");
  await expect(host.getByRole("region", { name: "共用のゲームボード", exact: true })).toBeVisible();
  await expect(englishPhone.locator("html")).toHaveAttribute("lang", "en");
  await noHorizontalOverflow(host);
  await screenshot(host, testInfo, "japanese-shared-board");
  await japanesePhone.setViewportSize({ width: 320, height: 568 });
  await noHorizontalOverflow(japanesePhone);
  await expect(japanesePhone.getByRole("button", { name: "ゲーム", exact: true })).toBeInViewport({ ratio: 1 });
  await japanesePhone.getByRole("button", { name: "ゲーム", exact: true }).click();
  await expect(japanesePhone.getByRole("combobox", { name: "言語", exact: true })).toBeInViewport({ ratio: 1 });
  await screenshot(japanesePhone, testInfo, "japanese-private-phone-game-menu");
  await japanesePhone.keyboard.press("Escape");
  await screenshot(japanesePhone, testInfo, "japanese-private-phone");
});

for (const variant of ["original", "seafarers"] as const) {
  test(`host Reset game restores ${variant} setup on every phone without changing seats`, async ({ multiplayer }, testInfo) => {
    const host = await multiplayer.newPage("Host");
    const invitation = await hostGame(host);
    await host.getByRole("button", { name: variant === "original" ? "Original" : "Seafarers", exact: true }).click();
    const phones: Page[] = [];
    for (const name of ["Ada", "Grace", "Linus"]) {
      const phone = await multiplayer.newPage(name, true);
      phones.push(phone);
      await requestSeat(phone, invitation, name);
      await host.getByRole("button", { name: `Admit ${name}`, exact: true }).click();
    }
    await host.getByRole("button", { name: "Start game", exact: true }).click();
    await expect(host.getByTestId("game-phase")).toHaveAttribute("data-phase", "setup-settlement");
    for (const phone of phones) await expect(phone.getByTestId("game-phase")).toHaveAttribute("data-phase", "setup-settlement");
    const initial = await latestSnapshot(phones[0]!);
    const activeName = initial.game!.players.find(player => player.id === initial.game!.activePlayerId)!.name;
    const credentials = await Promise.all(phones.map(phone => phone.evaluate(() => Object.entries(sessionStorage))));
    for (const phone of phones) {
      await phone.getByRole("button", { name: "Game", exact: true }).click();
      await expect(phone.getByRole("button", { name: "Reset game", exact: true })).toHaveCount(0);
      await phone.keyboard.press("Escape");
    }
    await host.getByRole("button", { name: /^Place settlement at/ }).first().click();
    await host.getByRole("button", { name: "Confirm placement", exact: true }).click();
    await expectPhase([host, ...phones], "setup-road", activeName);
    const progressed = await latestSnapshot(phones[0]!);
    await host.getByRole("button", { name: /^Build road at/ }).first().click();
    await chooseGameOption(host, "Reset game");
    const confirmation = host.getByRole("dialog", { name: "Reset this game?", exact: true });
    await expect(confirmation).toBeInViewport({ ratio: 1 });
    await confirmation.getByRole("button", { name: "Keep playing", exact: true }).click();
    await expect(host.getByRole("button", { name: "Confirm placement", exact: true })).toBeVisible();
    expect((await latestSnapshot(phones[0]!)).version).toBe(progressed.version);
    await chooseGameOption(host, "Reset game");
    await screenshot(host, testInfo, `host-reset-${variant}-confirmation`);
    await confirmation.getByRole("button", { name: "Reset game", exact: true }).click();
    await expectPhase([host, ...phones], "setup-settlement", activeName);
    await expect(host.getByRole("button", { name: "Confirm placement", exact: true })).toHaveCount(0);
    await expect(host.getByRole("img", { name: /'s (settlement|road|ship) at / })).toHaveCount(0);
    for (const [index, phone] of phones.entries()) {
      const reset = await latestSnapshot(phone);
      expect(reset.game).toEqual({ ...initial.game, gameId: reset.game!.gameId });
      expect(reset.game!.gameId).not.toBe(initial.game!.gameId);
      expect(reset.version).toBe(progressed.version + 1);
      expect(reset.playerId).toBe(initial.players[index]!.id);
      expect(reset.privatePlayer!.resources).toEqual(emptyResources());
      expect(reset.players).toEqual(initial.players);
      expect(await phone.evaluate(() => Object.entries(sessionStorage))).toEqual(credentials[index]);
      await expect(phone.getByRole("region", { name: "Dice tray", exact: true })).toBeVisible();
      await noHorizontalOverflow(phone);
    }
    await host.getByRole("button", { name: /^Place settlement at/ }).first().click();
    await host.getByRole("button", { name: "Confirm placement", exact: true }).click();
    await expectPhase([host, ...phones], "setup-road", activeName);
  });
}

test("host Return to lobby ends a running game for everyone with the same island and players", async ({ multiplayer }, testInfo) => {
  const host = await multiplayer.newPage("Host");
  const invitation = await hostGame(host);
  const mapCodeInput = host.getByLabel("Map code", { exact: true });
  const mapCode = await mapCodeInput.inputValue();
  const names = ["Ada", "Grace", "Linus"];
  const phones: Page[] = [];
  for (const name of names) {
    const phone = await multiplayer.newPage(name, true);
    phones.push(phone);
    await requestSeat(phone, invitation, name);
    await host.getByRole("button", { name: `Admit ${name}`, exact: true }).click();
  }
  await host.getByRole("button", { name: "Start game", exact: true }).click();
  await expect(host.getByTestId("game-phase")).toHaveAttribute("data-phase", "setup-settlement");
  for (const phone of phones) await expect(phone.getByTestId("game-phase")).toHaveAttribute("data-phase", "setup-settlement");
  const initial = await latestSnapshot(phones[0]!);
  const credentials = await Promise.all(phones.map(phone => phone.evaluate(() => Object.entries(sessionStorage))));
  await host.getByRole("button", { name: /^Place settlement at/ }).first().click();
  await host.getByRole("button", { name: "Confirm placement", exact: true }).click();
  await expect(host.getByTestId("game-phase")).toHaveAttribute("data-phase", "setup-road");
  const progressed = await latestSnapshot(phones[0]!);
  expect(progressed.game!.board.vertices.some(vertex => vertex.building)).toBe(true);

  for (const phone of phones) {
    await phone.getByRole("button", { name: "Game", exact: true }).click();
    await expect(phone.getByRole("button", { name: "Return to lobby", exact: true })).toHaveCount(0);
    await phone.keyboard.press("Escape");
  }

  await chooseGameOption(host, "Return to lobby");
  const confirmation = host.getByRole("dialog", { name: "Return to the lobby?", exact: true });
  await expect(confirmation).toContainText("same island and players");
  await expect(confirmation).toBeInViewport({ ratio: 1 });
  await confirmation.getByRole("button", { name: "Keep playing", exact: true }).click();
  await expect(host.getByTestId("game-phase")).toHaveAttribute("data-phase", "setup-road");
  expect((await latestSnapshot(phones[0]!)).version).toBe(progressed.version);

  await chooseGameOption(host, "Return to lobby");
  await screenshot(host, testInfo, "host-return-to-lobby-confirmation");
  await confirmation.getByRole("button", { name: "Return to lobby", exact: true }).click();
  await expect(host.getByRole("heading", { name: "Scan. Join. Settle in.", exact: true })).toBeVisible();
  // The lobby keeps the same island and roster.
  await expect(mapCodeInput).toHaveValue(mapCode);
  await expect(host.getByRole("list", { name: "Players", exact: true })).toContainText("Ada");
  for (const [index, phone] of phones.entries()) {
    const lobby = await latestSnapshot(phone);
    expect(lobby.game).toBeNull();
    expect(lobby.version).toBe(progressed.version + 1);
    expect(lobby.players.map(player => player.name)).toEqual(names);
    expect(lobby.playerId).toBe(initial.players[index]!.id);
    expect(await phone.evaluate(() => Object.entries(sessionStorage))).toEqual(credentials[index]);
    await expect(phone.getByRole("heading", { name: `Welcome, ${names[index]}.`, exact: true })).toBeVisible();
    await expect(phone.getByText("Your seat is reserved. The host will start when everyone is connected.", { exact: true })).toBeVisible();
  }

  await host.getByRole("button", { name: "Start game", exact: true }).click();
  await expect(host.getByTestId("game-phase")).toHaveAttribute("data-phase", "setup-settlement");
  await expect.poll(async () => (await latestSnapshot(phones[0]!)).game?.phase.type).toBe("setup-settlement");
  const restarted = await latestSnapshot(phones[0]!);
  await expectPhase([host, ...phones], "setup-settlement",
    restarted.game!.players.find(player => player.id === restarted.game!.activePlayerId)!.name);
  expect(restarted.game!.board).toEqual(initial.game!.board);
  expect(restarted.game!.gameId).not.toBe(initial.game!.gameId);
  for (const phone of phones) await expect(phone.getByRole("region", { name: "Dice tray", exact: true })).toBeVisible();
});

test("room Game menu shares navigation and preserves host and player leave behavior", async ({ multiplayer, isMobile }, testInfo) => {
  const host = await multiplayer.newPage("Host");
  const invitation = await hostGame(host);
  await host.getByRole("button", { name: "Game", exact: true }).click();
  await expect(host.getByRole("group", { name: "Game menu" }).getByRole("button")).toHaveText(["Help", "Settings", "Leave room"]);
  await expect(host.getByRole("group", { name: "Game menu" }).getByRole("combobox", { name: "Language", exact: true })).toBeVisible();
  await host.keyboard.press("Escape");
  const phone = await multiplayer.newPage("Alex", true);
  await requestSeat(phone, invitation, "Alex");
  await host.getByRole("button", { name: "Admit Alex", exact: true }).click();
  await phone.getByRole("button", { name: "Game", exact: true }).click();
  await expect(phone.getByRole("group", { name: "Game menu" }).getByRole("button")).toHaveText(["Help", "Leave room"]);
  await expect(phone.getByRole("group", { name: "Game menu" }).getByRole("combobox", { name: "Language", exact: true })).toBeVisible();
  await phone.keyboard.press("Escape");
  for (let player = 0; player < 2; player++) await host.getByRole("button", { name: "Add computer", exact: true }).click();
  await host.getByRole("button", { name: "Start game", exact: true }).click();
  await expect(host.getByTestId("game-phase")).toHaveAttribute("data-active-player", "Alex", { timeout: 15_000 });

  for (const [name, page, options] of [
    ["host", host, ["Help", "Settings", "Reset game", "Return to lobby", "Leave room"]],
    ["phone", phone, ["Help", "Leave room"]],
  ] as const) {
    if (isMobile) await page.setViewportSize({ width: 320, height: 568 });
    if (name === "phone") {
      // The private player screen has no header bar; its Game menu lives in the turn controls.
      await expect(page.getByRole("banner")).toHaveCount(0);
      await expect(page.locator(".private-turn").getByRole("button", { name: "Game", exact: true })).toBeVisible();
    }
    const gameButton = page.getByRole("button", { name: "Game", exact: true });
    const menu = page.getByRole("group", { name: "Game menu", exact: true });
    const languageSelector = menu.getByRole("combobox", { name: "Language", exact: true });
    const content = name === "host" ? page.getByTestId("game-phase") : page.getByLabel("Your hand and actions", { exact: true });
    const bounds = await content.boundingBox();
    await expect(gameButton).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("button", { name: "Leave room", exact: true })).toBeHidden();
    await expect(page.getByRole("combobox")).toHaveCount(0);
    await gameButton.focus();
    await page.keyboard.press("Enter");
    await expect(gameButton).toHaveAttribute("aria-expanded", "true");
    await expect(menu).toBeInViewport({ ratio: 1 });
    await expect(menu.getByRole("button")).toHaveText([...options]);
    for (const option of await menu.getByRole("button").all()) {
      await expect(option).toBeInViewport({ ratio: 1 });
      expect((await option.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await expect(languageSelector).toBeInViewport({ ratio: 1 });
    expect((await languageSelector.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await content.boundingBox()).toEqual(bounds);
    await screenshot(page, testInfo, `${name}-game-menu`);
    await page.keyboard.press("Tab");
    await expect(menu.getByRole("button", { name: "Help", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(gameButton).toBeFocused();
    await page.keyboard.press("Space");
    await expect(menu).toBeVisible();
    await (name === "host" ? page.locator("header") : page.locator(".private-player-summary")).click({ position: { x: 8, y: 8 } });
    await expect(menu).toBeHidden();
    await gameButton.focus();
    await page.keyboard.press("Enter");
    for (let step = 0; step < options.length; step++) await page.keyboard.press("Tab");
    await expect(languageSelector).toBeFocused();
    await languageSelector.selectOption("ja");
    await expect(page.locator("html")).toHaveAttribute("lang", "ja");
    await expect(page.getByRole("group", { name: "ゲームメニュー", exact: true })).toBeVisible();
    await page.getByRole("combobox", { name: "言語", exact: true }).selectOption("en");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(menu).toBeVisible();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(menu).toBeHidden();

    await chooseGameOption(page, "Help");
    const help = page.getByRole("dialog", { name: "Help", exact: true });
    await expect(help).toBeInViewport({ ratio: 1 });
    await expect(help.getByRole("list", { name: "Available builds and purchases" }).getByRole("listitem")).toHaveCount(4);
    await expect(help.getByRole("list", { name: "All development cards" }).getByRole("listitem")).toHaveCount(5);
    await expect(help).toContainText("One shared board, private phones.");
    await expect(help).not.toContainText("not a secure multiplayer room");
    await screenshot(page, testInfo, `${name}-room-help`);
    await page.keyboard.press("Escape");
    await expect(gameButton).toBeFocused();
    await expect(menu).toBeHidden();

    await chooseGameOption(page, "Leave room");
    const confirmation = page.getByRole("dialog", { name: name === "host" ? "Close this room?" : "Leave this room?", exact: true });
    await expect(confirmation).toContainText(name === "host" ? "ends the game for everyone" : "Your seat stays reserved");
    await confirmation.getByRole("button", { name: "Keep playing", exact: true }).click();
    await expect(confirmation).toHaveCount(0);
    await expect(gameButton).toBeFocused();
    await chooseGameOption(page, "Leave room");
    await page.keyboard.press("Escape");
    await expect(confirmation).toHaveCount(0);
    await expect(gameButton).toBeFocused();
    expect(await content.boundingBox()).toEqual(bounds);
    await noHorizontalOverflow(page);
  }

  await chooseGameOption(phone, "Leave room");
  await phone.getByRole("dialog", { name: "Leave this room?" }).getByRole("button", { name: "Leave room", exact: true }).click();
  await expect(phone.getByRole("link", { name: "Play across devices", exact: true })).toBeVisible();
  await expect(host.getByRole("status").filter({ hasText: "Alex disconnected" })).toBeVisible();
  await phone.goto(invitation);
  await expect(phone.getByLabel("Your hand and actions", { exact: true })).toBeVisible();
  await expect(host.getByRole("status").filter({ hasText: "Alex disconnected" })).toHaveCount(0);
  await chooseGameOption(host, "Leave room");
  await host.getByRole("dialog", { name: "Close this room?" }).getByRole("button", { name: "Leave room", exact: true }).click();
  await expect(host.getByRole("link", { name: "Play across devices", exact: true })).toBeVisible();
  await expect(phone.getByRole("status").filter({ hasText: "Offline" })).toBeVisible();
  await chooseGameOption(phone, "Help");
  await expect(phone.getByRole("dialog", { name: "Help", exact: true })).toBeVisible();
});

test("room Game settings update the shared board and persist across play modes", async ({ multiplayer }, testInfo) => {
  const host = await multiplayer.newPage("Host");
  const invitation = await hostGame(host);
  const map = host.locator(".board-viewport");
  await chooseGameOption(host, "Settings");
  const settings = host.getByRole("dialog", { name: "Settings", exact: true });
  const blockedLocations = settings.getByRole("checkbox", { name: "Show blocked settlement locations", exact: true });
  const water = settings.getByRole("checkbox", { name: "Fill board with water", exact: true });
  await expect(blockedLocations).toBeChecked();
  await expect(water).not.toBeChecked();
  await expect(blockedLocations).toHaveAccessibleDescription(/distance rule prevents building/);
  await expect(water).toHaveAccessibleDescription(/entire map area/);
  await blockedLocations.uncheck();
  await water.check();
  await screenshot(host, testInfo, "room-board-settings");
  await host.keyboard.press("Escape");
  await expect(host.getByRole("button", { name: "Game", exact: true })).toBeFocused();
  await expect(map).toHaveCSS("background-image", /radial-gradient/);

  const phone = await multiplayer.newPage("Alex", true);
  await requestSeat(phone, invitation, "Alex");
  await host.getByRole("button", { name: "Admit Alex", exact: true }).click();
  for (let player = 0; player < 2; player++) await host.getByRole("button", { name: "Add computer", exact: true }).click();
  await host.getByRole("button", { name: "Start game", exact: true }).click();
  await expect(host.getByTestId("game-phase")).toHaveAttribute("data-active-player", "Alex", { timeout: 15_000 });
  await host.getByRole("button", { name: /^Place settlement at / }).first().click();
  await host.getByRole("button", { name: "Confirm placement", exact: true }).click();
  await expectPhase([host, phone], "setup-road", "Alex");
  await expect(map).toHaveCSS("background-image", /radial-gradient/);
  const markers = host.getByRole("img", { name: /^Settlement blocked at / });
  await expect(markers).toHaveCount(0);
  const bounds = await map.boundingBox();
  const targets = host.getByRole("button", { name: /^Build road at / });
  const labels = await targets.evaluateAll(elements => elements.map(element => element.getAttribute("aria-label")));
  const snapshot = await latestSnapshot(phone);

  await chooseGameOption(host, "Settings");
  await blockedLocations.check();
  await water.uncheck();
  await settings.getByRole("button", { name: "Close dialog", exact: true }).click();
  await expect(markers.first()).toBeVisible();
  await expect(map).toHaveCSS("background-image", "none");
  expect(await map.boundingBox()).toEqual(bounds);
  expect(await targets.evaluateAll(elements => elements.map(element => element.getAttribute("aria-label")))).toEqual(labels);
  expect((await latestSnapshot(phone)).version).toBe(snapshot.version);
  await screenshot(host, testInfo, "room-board-settings-applied");
  await chooseGameOption(host, "Settings");
  await blockedLocations.uncheck();
  await water.check();
  await host.keyboard.press("Escape");
  await expect.poll(() => host.evaluate(() => [localStorage.getItem("catania.showBlockedSettlementLocations"), localStorage.getItem("catania.fillBoardWithWater")])).toEqual(["false", "true"]);

  await chooseGameOption(host, "Leave room");
  await host.getByRole("dialog", { name: "Close this room?" }).getByRole("button", { name: "Leave room", exact: true }).click();
  await expect(host.getByRole("link", { name: "Play across devices", exact: true })).toBeVisible();
  await expect(map).toHaveCSS("background-image", /radial-gradient/);
  await hostGame(host);
  await chooseGameOption(host, "Settings");
  await expect(blockedLocations).not.toBeChecked();
  await expect(water).toBeChecked();
});

test("lobby shows required seats and lets the host add or remove computer players", async ({ multiplayer }, testInfo) => {
  const host = await multiplayer.newPage("Host");
  const invitation = await hostGame(host);
  const readiness = host.getByRole("status").filter({ hasText: "seats filled" });
  const openSeats = host.getByRole("list", { name: "Open seats", exact: true });
  const roster = host.getByRole("list", { name: "Players", exact: true });
  const addComputer = host.getByRole("button", { name: "Add computer", exact: true });
  const startGame = host.getByRole("button", { name: "Start game", exact: true });
  await expect(readiness).toContainText("3 more players needed to start.");
  await expect(openSeats.getByRole("listitem")).toHaveCount(4);
  await expect(openSeats.getByText("Player needed", { exact: true })).toHaveCount(3);
  await expect(openSeats.getByText("Optional fourth player", { exact: true })).toBeVisible();
  await expect(startGame).toHaveAttribute("aria-describedby", "lobby-readiness");

  const phone = await multiplayer.newPage("Alex", true);
  await requestSeat(phone, invitation, "Alex");
  await expect(host.getByRole("button", { name: "Admit Alex", exact: true })).toBeVisible();
  await expect(readiness).toContainText("3 more players needed to start.");
  await host.getByRole("button", { name: "Admit Alex", exact: true }).click();
  await expect(readiness).toContainText("2 more players needed to start.");
  await expect(phone.getByRole("status").filter({ hasText: "seats filled" })).toContainText("2 more players needed to start.");
  await expect(phone.getByRole("button", { name: "Add computer", exact: true })).toHaveCount(0);
  await noHorizontalOverflow(host);
  await screenshot(host, testInfo, "lobby-missing-players");

  await addComputer.click();
  await expect(readiness).toContainText("1 more player needed to start.");
  await expect(startGame).toBeDisabled();
  await expect(roster.getByRole("img", { name: "Computer player", exact: true })).toHaveCount(1);
  await expect(roster.getByText("Computer", { exact: true })).toHaveCount(0);
  await addComputer.click();
  await expect(readiness).toContainText("Ready to start with 3 players.");
  await expect(startGame).toBeEnabled();
  await expect(openSeats.getByRole("listitem")).toHaveCount(1);
  await expect(openSeats.getByText("Optional fourth player", { exact: true })).toBeVisible();
  await expect(phone.getByRole("button", { name: /^Remove Computer / })).toHaveCount(0);
  await noHorizontalOverflow(host);
  await screenshot(host, testInfo, "lobby-human-and-computers");

  await addComputer.click();
  await expect(readiness).toContainText("Ready to start with 4 players.");
  await expect(addComputer).toBeDisabled();
  await expect(openSeats).toHaveCount(0);
  await expect(roster.getByRole("listitem")).toHaveCount(4);
  await host.getByRole("button", { name: "Remove Computer 1", exact: true }).click();
  await host.getByRole("button", { name: "Remove Computer 2", exact: true }).click();
  await expect(readiness).toContainText("1 more player needed to start.");
  await expect(startGame).toBeDisabled();
  await addComputer.click();
  await expect(startGame).toBeEnabled();
  await expect(roster.getByText("Alex", { exact: true })).toBeVisible();
  await expect(roster.getByText("Computer 3", { exact: true })).toBeVisible();
  await host.setViewportSize({ width: 320, height: 844 });
  await noHorizontalOverflow(host);
  await screenshot(host, testInfo, "lobby-computers-compact");
});

test("host renames computer players and colored avatars replace dots before names", async ({ multiplayer }, testInfo) => {
  const host = await multiplayer.newPage("Host");
  const invitation = await hostGame(host);
  const phone = await multiplayer.newPage("Alex", true);
  await requestSeat(phone, invitation, "Alex");
  await host.getByRole("button", { name: "Admit Alex", exact: true }).click();
  await host.getByRole("button", { name: "Add computer", exact: true }).click();
  await host.getByRole("button", { name: "Add computer", exact: true }).click();
  const roster = host.getByRole("list", { name: "Players", exact: true });
  await expect(roster.getByRole("img", { name: "Computer player", exact: true })).toHaveCount(2);
  await expect(roster.getByRole("img", { name: "Human player", exact: true })).toHaveCount(1);
  const human = roster.getByRole("listitem").filter({ has: host.getByText("Alex", { exact: true }) });
  const humanNameBounds = await human.getByText("Alex", { exact: true }).boundingBox();
  const humanAvatar = human.getByRole("img", { name: "Human player", exact: true });
  const humanAvatarBounds = await humanAvatar.boundingBox();
  expect(humanAvatarBounds!.x + humanAvatarBounds!.width).toBeLessThanOrEqual(humanNameBounds!.x);
  const humanColor = (await latestSnapshot(phone)).players.find(player => player.name === "Alex")!.color;
  expect(await humanAvatar.evaluate((element, color) => {
    const reference = document.createElement("span");
    reference.style.color = color;
    return getComputedStyle(element).color === reference.style.color;
  }, humanColor)).toBe(true);
  await expect(roster.locator(".rounded-full:not(svg)")).toHaveCount(0);
  await expect(roster.getByText("Computer", { exact: true })).toHaveCount(0);
  await expect(host.getByRole("button", { name: "Rename Alex", exact: true })).toHaveCount(0);
  await expect(phone.getByRole("button", { name: /^Rename / })).toHaveCount(0);
  await host.getByRole("button", { name: "Rename Computer 1", exact: true }).click();
  const dialog = host.getByRole("dialog", { name: "Rename computer", exact: true });
  const input = dialog.getByLabel("Computer name", { exact: true });
  const save = dialog.getByRole("button", { name: "Save name", exact: true });
  await expect(input).toHaveValue("Computer 1");
  await input.fill("");
  await expect(save).toBeDisabled();
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await input.fill("  aLeX  ");
  await expect(save).toBeDisabled();
  await expect(dialog.getByText("That name is already in the room. Choose another name.", { exact: true })).toBeVisible();
  await input.fill("Computer 2");
  await expect(save).toBeDisabled();
  await input.fill("Atlas");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(host.getByRole("button", { name: "Rename Computer 1", exact: true })).toBeFocused();
  await host.getByRole("button", { name: "Rename Computer 1", exact: true }).click();
  await input.fill("  Atlas  ");
  await save.click();
  await expect(dialog).toHaveCount(0);
  const renamed = roster.getByRole("listitem").filter({ has: host.getByRole("button", { name: "Rename Atlas", exact: true }) });
  await expect(renamed.getByRole("img", { name: "Computer player", exact: true })).toBeVisible();
  await expect(renamed.getByRole("button", { name: "Remove Atlas", exact: true })).toBeVisible();
  await expect(phone.getByRole("list", { name: "Players", exact: true }).getByText("Atlas", { exact: true })).toBeVisible();
  const nameBounds = await renamed.getByRole("button", { name: "Rename Atlas", exact: true }).boundingBox();
  const avatarBounds = await renamed.getByRole("img", { name: "Computer player", exact: true }).boundingBox();
  expect(avatarBounds!.x + avatarBounds!.width).toBeLessThanOrEqual(nameBounds!.x);
  await expect(renamed.getByRole("img")).toHaveCount(1);
  await noHorizontalOverflow(host);
  await screenshot(host, testInfo, "lobby-renamed-computer");
  await host.setViewportSize({ width: 320, height: 844 });
  await host.getByRole("button", { name: "Rename Atlas", exact: true }).click();
  await input.fill("Harbor Master");
  await noHorizontalOverflow(host);
  await screenshot(host, testInfo, "rename-computer-compact");
  await input.press("Enter");
  await expect(roster.getByRole("button", { name: "Rename Harbor Master", exact: true })).toBeVisible();
  await noHorizontalOverflow(host);
  await screenshot(host, testInfo, "lobby-avatars-compact");
});

test("lobby leaves a 16px gap below navigation and omits redundant copy", async ({ multiplayer }, testInfo) => {
  const host = await multiplayer.newPage("Host");
  await hostGame(host);
  await expect(host.getByText("One island. Your own hand.", { exact: true })).toHaveCount(0);
  await expect(host.getByText("Shuffle until you find your island. Starting the game keeps this exact map.", { exact: true })).toHaveCount(0);
  await expect(host.getByText("Play with three or four human or computer players. Turn order is randomized when the game starts.", { exact: true })).toHaveCount(0);
  const header = await host.getByRole("banner").boundingBox();
  const island = await host.getByRole("region", { name: "Island preview", exact: true }).boundingBox();
  expect(island!.y - header!.y - header!.height).toBeCloseTo(16, 0);
  await noHorizontalOverflow(host);
  await screenshot(host, testInfo, "lobby-navigation-gap");
});

test("desktop lobby fits the map left and invitation above players right without scrolling", async ({ multiplayer }, testInfo) => {
  const host = await multiplayer.newPage("Host");
  await host.setViewportSize({ width: 1440, height: 1000 });
  await hostGame(host);
  await expect(host.getByText("Shared board / Connected", { exact: true })).toHaveCount(0);
  for (const playerCount of [0, 4]) {
    if (playerCount === 4) {
      for (let player = 0; player < 4; player++) await host.getByRole("button", { name: "Add computer", exact: true }).click();
    }
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 1366, height: 768 }, { width: 1024, height: 720 }]) {
      await host.setViewportSize(viewport);
      await expect.poll(() => host.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight))).toBeLessThanOrEqual(viewport.height);
      await noHorizontalOverflow(host);
      const header = await host.getByRole("banner").boundingBox();
      const main = await host.getByRole("main").boundingBox();
      expect(main!.y).toBeCloseTo(header!.y + header!.height, 0);
      const invitation = host.getByRole("img", { name: "Scan to join this game", exact: true });
      await expect(invitation).toBeInViewport({ ratio: 1 });
      expect((await invitation.boundingBox())!.width).toBeGreaterThanOrEqual(144);
      if (viewport.height === 1000) expect((await invitation.boundingBox())!.width).toBe(240);
      const map = host.getByRole("region", { name: "Island map. Use the zoom controls to enlarge, then scroll or drag to pan.", exact: true });
      await expect(map).toBeInViewport({ ratio: 1 });
      expect((await map.boundingBox())!.height).toBeGreaterThanOrEqual(400);
      const islandBounds = await host.getByRole("region", { name: "Island preview", exact: true }).boundingBox();
      const invitationBounds = await host.getByRole("region", { name: "Room invitation", exact: true }).boundingBox();
      const playersBounds = await host.locator(".multiplayer-lobby-players").boundingBox();
      expect(islandBounds!.y - header!.y - header!.height).toBeCloseTo(16, 0);
      expect(islandBounds!.x + islandBounds!.width).toBeLessThanOrEqual(invitationBounds!.x);
      expect(islandBounds!.y).toBeCloseTo(invitationBounds!.y, 0);
      expect(playersBounds!.x).toBeCloseTo(invitationBounds!.x, 0);
      expect(playersBounds!.y).toBeGreaterThanOrEqual(invitationBounds!.y + invitationBounds!.height);
      const playersHeight = await host.locator(".multiplayer-lobby-players").evaluate(element => ({ content: element.scrollHeight, available: element.clientHeight }));
      expect(playersHeight.content).toBeLessThanOrEqual(playersHeight.available + 1);
      for (const button of await host.getByRole("main").getByRole("button").all()) await expect(button).toBeInViewport({ ratio: 1 });
      await screenshot(host, testInfo, `desktop-lobby-${viewport.width}-${viewport.height}-${playerCount}-players`);
    }
  }
});

test("lobby uses the map zoom bar theme control and ends the invitation at the copy button", async ({ multiplayer }, testInfo) => {
  const host = await multiplayer.newPage("Host");
  const invitation = await hostGame(host);
  const changeTheme = host.getByRole("button", { name: "Change theme", exact: true });
  await expect(changeTheme).toHaveAttribute("title", "Change theme: Illustrated Island");
  const toolbar = host.getByRole("region", { name: "Island preview", exact: true }).locator(".board-controls");
  await expect(toolbar.getByRole("button", { name: "Change theme", exact: true })).toHaveCount(1);
  await expect(toolbar.getByRole("group", { name: "Map zoom controls", exact: true })).toBeVisible();
  await expect(host.locator(".multiplayer-lobby-players").getByRole("button", { name: "Change theme", exact: true })).toHaveCount(0);
  await expect(host.getByRole("radio")).toHaveCount(0);
  await expect(host.getByText("Use the same Wi-Fi. Each human player needs their own phone; computer players do not. This board does not occupy a player seat.", { exact: true })).toHaveCount(0);
  await expect(host.getByText("This invitation uses localhost", { exact: false })).toHaveCount(0);
  const copyInvitation = host.getByRole("button", { name: "Copy invitation", exact: true });
  expect(await copyInvitation.evaluate(element => element.parentElement?.nextElementSibling)).toBeNull();
  await expect(host.getByRole("img", { name: "Scan to join this game", exact: true })).toBeVisible();
  await expect(host.getByLabel("Game invitation", { exact: true })).toHaveValue(invitation);
  await expect(host.getByRole("region", { name: "Island preview", exact: true })).toBeVisible();
  await changeTheme.click();
  const dialog = host.getByRole("dialog", { name: "Choose your theme", exact: true });
  await expect(dialog.getByRole("radio")).toHaveCount(6);
  await expect(dialog.getByRole("button", { name: "Close dialog", exact: true })).toBeFocused();
  await dialog.getByRole("radio", { name: "Mediterranean Ceramic", exact: true }).check();
  await expect(host.getByRole("region", { name: "Island preview", exact: true }).locator(".board-surface")).toHaveAttribute("data-theme", "ceramic");
  await screenshot(host, testInfo, "lobby-theme-dialog");
  await dialog.getByRole("button", { name: "Close dialog", exact: true }).click();
  await expect(changeTheme).toBeFocused();
  await expect(changeTheme).toHaveAttribute("title", "Change theme: Mediterranean Ceramic");
  await expect(host.getByRole("radio")).toHaveCount(0);
  await noHorizontalOverflow(host);
  await testInfo.attach("lobby-viewport", {
    body: JSON.stringify(await host.evaluate(() => ({ width: innerWidth, height: innerHeight, pageHeight: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight) }))),
    contentType: "application/json",
  });
  await screenshot(host, testInfo, "compact-lobby-theme");
  await host.setViewportSize({ width: 320, height: 844 });
  await changeTheme.click();
  await noHorizontalOverflow(host);
  await dialog.getByRole("radio", { name: "Pixel-Art Kingdom", exact: true }).check();
  await host.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(changeTheme).toBeFocused();
  await expect(changeTheme).toHaveAttribute("title", "Change theme: Pixel-Art Kingdom");
  expect(await toolbar.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await noHorizontalOverflow(host);
  await screenshot(host, testInfo, "compact-lobby-theme-320px");
});

test("invitation copies inline with temporary confirmation and a selectable failure fallback", async ({ multiplayer }, testInfo) => {
  const host = await multiplayer.newPage("Host");
  const invitation = await hostGame(host);
  await host.evaluate(() => {
    const copiedInvitations: string[] = [];
    Object.assign(window, { copiedInvitations });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => { copiedInvitations.push(text); } } });
  });
  await host.clock.install({ time: new Date("2030-01-01T00:00:00Z") });
  await host.clock.pauseAt(new Date("2030-01-01T00:00:01Z"));
  const input = host.getByLabel("Game invitation", { exact: true });
  const copy = host.getByRole("button", { name: "Copy invitation", exact: true });
  const confirmation = copy.getByRole("status");
  await expect(copy).toHaveAttribute("title", "Copy invitation");
  const inputBounds = await input.boundingBox();
  const copyBounds = await copy.boundingBox();
  expect(copyBounds!.x).toBeGreaterThanOrEqual(inputBounds!.x + inputBounds!.width);
  expect(copyBounds!.y).toBeCloseTo(inputBounds!.y, 0);
  expect(copyBounds!.width).toBeLessThanOrEqual(48);
  await copy.click();
  await expect(confirmation).toHaveText("Copied");
  await expect(copy).toHaveAttribute("title", "Invitation copied");
  expect(await host.evaluate(() => (window as unknown as { copiedInvitations: string[] }).copiedInvitations)).toEqual([invitation]);
  await noHorizontalOverflow(host);
  await screenshot(host, testInfo, "invitation-inline-copied");
  await host.clock.runFor(1_500);
  await copy.press("Enter");
  await host.clock.runFor(1_000);
  await expect(confirmation).toHaveText("Copied");
  await host.clock.runFor(1_000);
  await expect(confirmation).toHaveText("");
  await expect(copy).toHaveAttribute("title", "Copy invitation");
  expect(await host.evaluate(() => (window as unknown as { copiedInvitations: string[] }).copiedInvitations)).toEqual([invitation, invitation]);

  await copy.click();
  await expect(confirmation).toHaveText("Copied");
  await host.evaluate(() => { navigator.clipboard.writeText = async () => { throw new DOMException("Clipboard permission denied", "NotAllowedError"); }; });
  await copy.click();
  await expect(confirmation).toHaveText("");
  await expect(host.getByRole("alert")).toHaveText("Select and copy the invitation link to share it.");
  await input.focus();
  expect(await input.evaluate(element => {
    const input = element as HTMLInputElement;
    return input.value.slice(input.selectionStart ?? 0, input.selectionEnd ?? 0);
  })).toBe(invitation);
  await expect(input).toHaveValue(invitation);
  await host.evaluate(() => { navigator.clipboard.writeText = async () => {}; });
  await copy.click();
  await expect(host.getByRole("alert")).toHaveCount(0);
  await expect(confirmation).toHaveText("Copied");
  await host.setViewportSize({ width: 320, height: 844 });
  await noHorizontalOverflow(host);
  const compactInputBounds = await input.boundingBox();
  const compactCopyBounds = await copy.boundingBox();
  expect(compactCopyBounds!.x).toBeGreaterThanOrEqual(compactInputBounds!.x + compactInputBounds!.width);
  expect(compactCopyBounds!.y).toBeCloseTo(compactInputBounds!.y, 0);
  expect((await host.getByRole("img", { name: "Scan to join this game", exact: true }).boundingBox())!.width).toBeGreaterThanOrEqual(254);
  await screenshot(host, testInfo, "invitation-inline-copied-compact");
  await host.clock.runFor(2_000);
  await expect(confirmation).toHaveText("");
});

test("shared board header shows and copies the host-only map code", async ({ multiplayer }, testInfo) => {
  const host = await multiplayer.newPage("Host");
  const invitation = await hostGame(host);
  const phone = await multiplayer.newPage("Alex", true);
  await requestSeat(phone, invitation, "Alex");
  await host.getByRole("button", { name: "Admit Alex", exact: true }).click();
  for (let player = 0; player < 2; player++) await host.getByRole("button", { name: "Add computer", exact: true }).click();
  const mapSeed = await host.getByRole("textbox", { name: "Map code", exact: true }).inputValue();
  await host.getByRole("button", { name: "Start game", exact: true }).click();
  await expect(host.getByTestId("game-phase")).toHaveAttribute("data-phase", "setup-settlement");
  const copy = host.getByRole("button", { name: "Copy map code", exact: true });
  const confirmation = copy.getByRole("status");
  await expect(copy).toHaveText(mapSeed);
  await expect(copy).toHaveAttribute("title", "Copy map code");
  await expect(copy.locator("svg")).toHaveCount(2);
  await expect(copy).toBeInViewport({ ratio: 1 });
  await expect(phone.getByRole("button", { name: "Copy map code", exact: true })).toHaveCount(0);
  await host.evaluate(() => {
    const copiedMapCodes: string[] = [];
    Object.assign(window, { copiedMapCodes });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => { copiedMapCodes.push(text); } } });
  });
  await host.clock.install({ time: new Date("2030-01-01T00:00:00Z") });
  await host.clock.pauseAt(new Date("2030-01-01T00:00:01Z"));
  await copy.click();
  await expect(confirmation).toHaveText("Copied");
  await expect(copy).toHaveAttribute("title", "Map code copied");
  expect(await host.evaluate(() => (window as unknown as { copiedMapCodes: string[] }).copiedMapCodes)).toEqual([mapSeed]);
  await host.clock.runFor(2_000);
  await expect(confirmation).toHaveText(mapSeed);
  await expect(copy).toHaveAttribute("title", "Copy map code");
  await host.evaluate(() => { navigator.clipboard.writeText = async () => { throw new DOMException("Clipboard permission denied", "NotAllowedError"); }; });
  await copy.click();
  await expect(confirmation).toHaveText(mapSeed);
  await expect(host.getByRole("alert")).toHaveText("Map code could not be copied.");
  await host.evaluate(() => {
    const windowWithCodes = window as unknown as { copiedMapCodes: string[] };
    navigator.clipboard.writeText = async (text: string) => { windowWithCodes.copiedMapCodes.push(text); };
  });
  await copy.click();
  await expect(host.getByRole("alert")).toHaveCount(0);
  await expect(confirmation).toHaveText("Copied");
  await host.clock.runFor(2_000);
  await selectMenuLanguage(host, "en", "ja");
  const japaneseCopy = host.getByRole("button", { name: "マップコードをコピー", exact: true });
  const japaneseConfirmation = japaneseCopy.getByRole("status");
  await expect(japaneseCopy).toHaveAttribute("title", "マップコードをコピー");
  await expect(japaneseConfirmation).toHaveText(mapSeed);
  await japaneseCopy.click();
  await expect(japaneseConfirmation).toHaveText("コピーしました");
  expect(await host.evaluate(() => (window as unknown as { copiedMapCodes: string[] }).copiedMapCodes)).toEqual([mapSeed, mapSeed, mapSeed]);
  await host.clock.runFor(2_000);
  await selectMenuLanguage(host, "ja", "en");
  await expect(copy).toHaveText(mapSeed);
  await noHorizontalOverflow(host);
  await screenshot(host, testInfo, "shared-board-map-code");
});

test("host map seed toolbar automatically loads complete codes across languages and widths", async ({ multiplayer }, testInfo) => {
  const host = await multiplayer.newPage("Host");
  await hostGame(host);
  for (const language of ["en", "ja"] as const) {
    if (language === "ja") await selectMenuLanguage(host, "en", "ja");
    const labels = language === "ja"
      ? { preview: "島のプレビュー", code: "マップコード", replay: "このマップを再現", shuffle: "島の配置をシャッフル" }
      : { preview: "Island preview", code: "Map code", replay: "Replay map", shuffle: "Shuffle island preview" };
    const preview = host.getByRole("region", { name: labels.preview, exact: true });
    const toolbar = preview.locator(".board-surface > .board-header-controls").getByRole("form", { name: labels.code, exact: true });
    const input = toolbar.getByRole("textbox", { name: labels.code, exact: true });
    const shuffle = toolbar.getByRole("button", { name: labels.shuffle, exact: true });
    await expect(toolbar.getByRole("button", { name: labels.replay, exact: true })).toHaveCount(0);
    await expect(toolbar.getByRole("button")).toHaveCount(1);
    await expect(input).toHaveAttribute("maxlength", "8");
    const islandLayout = () => preview.locator('svg g[role="img"]').evaluateAll(elements => elements.map(element => element.getAttribute("aria-label")));
    for (const width of [1440, 390, 320]) {
      await host.setViewportSize({ width, height: 900 });
      await expect(toolbar).toBeVisible();
      await expect(toolbar.locator("label > span")).toBeVisible();
      expect(await toolbar.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      await input.fill("testmap2");
      await expect(input).toHaveValue(/^TESTMAP2$/i);
      const selectedIsland = await islandLayout();
      await input.fill("225DV7H");
      expect(await islandLayout()).toEqual(selectedIsland);
      await expect(host.getByRole("alert")).toHaveCount(0);
      await input.press("4");
      await expect.poll(islandLayout).not.toEqual(selectedIsland);
      await input.fill("testmap2");
      await expect(input).toHaveValue(/^TESTMAP2$/i);
      await expect.poll(islandLayout).toEqual(selectedIsland);
      await input.press("Enter");
      expect(await islandLayout()).toEqual(selectedIsland);
      await shuffle.click();
      await expect(input).not.toHaveValue("TESTMAP2");
      await expect.poll(islandLayout).not.toEqual(selectedIsland);
      expect(await input.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      await input.fill("");
      await expect(host.getByRole("alert")).toHaveCount(0);
      await expect(shuffle).toBeEnabled();
      await input.fill("TESTMAP2");
      await expect(input).toHaveValue("TESTMAP2");
      await expect.poll(islandLayout).toEqual(selectedIsland);
      await noHorizontalOverflow(host);
      await screenshot(host, testInfo, `host-map-seed-${language}-${width}`);
    }
    const selectedIsland = await islandLayout();
    await input.fill("TESTMAP");
    await input.press("Enter");
    await expect(host.getByRole("alert")).toHaveText(language === "ja"
      ? "8文字の有効なマップコードを入力してください。"
      : "Enter a valid 8-character map code.");
    expect(await islandLayout()).toEqual(selectedIsland);
    await input.fill("INVALID?");
    await expect(host.getByRole("alert")).toHaveCount(1);
    expect(await islandLayout()).toEqual(selectedIsland);
    await input.fill("225DV7H4");
    await expect(host.getByRole("alert")).toHaveCount(0);
    await expect.poll(islandLayout).not.toEqual(selectedIsland);
  }
});

for (const shuffleCount of [0, 2]) {
  test(`host starts with the lobby map after ${shuffleCount} shuffles`, async ({ multiplayer }, testInfo) => {
    const host = await multiplayer.newPage("Host");
    const invitation = await hostGame(host);
    const preview = host.getByRole("region", { name: "Island preview", exact: true });
    const islandLayout = (context: Locator) => context.locator('svg g[role="img"]').evaluateAll(elements => elements.map(element => ({
      label: element.getAttribute("aria-label"),
      points: element.querySelector("polygon")?.getAttribute("points") ?? null,
      transform: element.getAttribute("transform"),
    })));
    await expect(preview.locator('svg g[role="img"]')).toHaveCount(29);
    await expect(preview.getByRole("button", { name: /^Place settlement at / })).toHaveCount(0);
    let selectedIsland = await islandLayout(preview);
    for (let shuffle = 0; shuffle < shuffleCount; shuffle++) {
      await preview.getByRole("button", { name: "Shuffle island preview", exact: true }).click();
      await expect.poll(() => islandLayout(preview)).not.toEqual(selectedIsland);
      selectedIsland = await islandLayout(preview);
    }
    await host.getByRole("button", { name: "Change theme", exact: true }).click();
    const themeDialog = host.getByRole("dialog", { name: "Choose your theme", exact: true });
    await themeDialog.getByRole("radio", { name: /Mediterranean Ceramic/ }).check();
    await themeDialog.getByRole("button", { name: "Close dialog", exact: true }).click();
    await expect(preview.locator(".board-surface")).toHaveAttribute("data-theme", "ceramic");
    expect(await islandLayout(preview)).toEqual(selectedIsland);
    const phone = await multiplayer.newPage("Alex", true);
    await requestSeat(phone, invitation, "Alex");
    await host.getByRole("button", { name: "Admit Alex", exact: true }).click();
    await host.getByRole("button", { name: "Add computer", exact: true }).click();
    await host.getByRole("button", { name: "Add computer", exact: true }).click();
    await expect(phone.getByRole("heading", { name: "Welcome, Alex.", exact: true })).toBeVisible();
    await expect(phone.getByRole("button", { name: "Shuffle island preview", exact: true })).toHaveCount(0);
    await expect(phone.getByRole("region", { name: "Island preview", exact: true })).toHaveCount(0);
    expect(await latestSnapshot(phone)).not.toHaveProperty("previewBoard");
    expect(await islandLayout(preview)).toEqual(selectedIsland);
    await preview.getByRole("button", { name: "Zoom in", exact: true }).click();
    await expect(preview.getByLabel("Zoom level", { exact: true })).toHaveText("125%");
    await preview.getByRole("button", { name: "Zoom out", exact: true }).click();
    await expect(preview.getByLabel("Zoom level", { exact: true })).toHaveText("100%");
    await noHorizontalOverflow(host);
    await screenshot(host, testInfo, "selected-lobby-map");
    if (shuffleCount === 2) {
      await host.setViewportSize({ width: 320, height: 844 });
      await noHorizontalOverflow(host);
      expect(await preview.locator(".board-controls").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      await screenshot(host, testInfo, "selected-lobby-map-compact");
    }
    await host.clock.install({ time: new Date("2030-01-01T00:00:00Z") });
    await host.clock.pauseAt(new Date("2030-01-01T00:00:01Z"));
    await host.getByRole("button", { name: "Start game", exact: true }).click();
    const board = host.getByRole("region", { name: "Shared game board", exact: true });
    await expect.poll(() => islandLayout(board)).toEqual(selectedIsland);
    await expect(board.getByRole("img", { name: "Robber on desert; production blocked", exact: true })).toBeVisible();
    await expect(board.locator(".board-surface")).toHaveAttribute("data-theme", "ceramic");
    await expect(preview).toHaveCount(0);
    await expect(host.getByRole("button", { name: "Shuffle island preview", exact: true })).toHaveCount(0);
    await noHorizontalOverflow(host);
    await screenshot(host, testInfo, "started-selected-map");
  });
}

test("host removes a human seat and the phone needs fresh admission to rejoin", async ({ multiplayer }, testInfo) => {
  const host = await multiplayer.newPage("Host");
  const invitation = await hostGame(host);
  const phone = await multiplayer.newPage("Alex", true);
  await requestSeat(phone, invitation, "Alex");
  await host.getByRole("button", { name: "Admit Alex", exact: true }).click();
  await host.getByRole("button", { name: "Add computer", exact: true }).click();
  await host.getByRole("button", { name: "Add computer", exact: true }).click();
  const startGame = host.getByRole("button", { name: "Start game", exact: true });
  await expect(startGame).toBeEnabled();
  await expect(phone.getByRole("button", { name: /^Remove / })).toHaveCount(0);
  const storageKey = `catania:multiplayer:${new URLSearchParams(new URL(invitation).hash.slice(1)).get("host")}`;
  await expect.poll(() => phone.evaluate(key => sessionStorage.getItem(key), storageKey)).not.toBeNull();
  const previousCredential = await phone.evaluate(key => sessionStorage.getItem(key), storageKey);
  await phone.clock.install({ time: new Date("2030-01-01T00:00:00Z") });
  await phone.clock.pauseAt(new Date("2030-01-01T00:00:01Z"));
  await host.getByRole("button", { name: "Remove Alex", exact: true }).click();
  await expect(host.getByRole("status").filter({ hasText: "seats filled" })).toContainText("1 more player needed to start.");
  await expect(startGame).toBeDisabled();
  await expect(phone.getByRole("alert")).toContainText("removed");
  await expect(phone.getByRole("heading", { name: "Not connected", exact: true })).toBeVisible();
  await expect(phone.getByRole("heading", { name: "Welcome, Alex.", exact: true })).toHaveCount(0);
  await expect(phone.getByRole("list", { name: "Players", exact: true })).toHaveCount(0);
  expect(await phone.evaluate(key => sessionStorage.getItem(key), storageKey)).toBeNull();
  await phone.clock.runFor(4_000);
  await expect(host.getByRole("button", { name: "Admit Alex", exact: true })).toHaveCount(0);
  await screenshot(phone, testInfo, "removed-human-notification");
  await phone.getByRole("button", { name: "Reconnect", exact: true }).click();
  await expect(host.getByRole("button", { name: "Admit Alex", exact: true })).toBeVisible();
  await expect(startGame).toBeDisabled();
  await host.getByRole("button", { name: "Admit Alex", exact: true }).click();
  await expect(phone.getByRole("heading", { name: "Welcome, Alex.", exact: true })).toBeVisible();
  await expect.poll(() => phone.evaluate(key => sessionStorage.getItem(key), storageKey)).not.toBe(previousCredential);
  await expect(startGame).toBeEnabled();
  await noHorizontalOverflow(host);
  await screenshot(host, testInfo, "human-readmitted-after-removal");
});

test("shared tabletop shows only single-device player seats and map at desktop and mobile sizes", async ({ multiplayer, isMobile }, testInfo) => {
  const playerCount = isMobile ? 4 : 3;
  const host = await multiplayer.newPage("Host");
  const invitation = await hostGame(host);
  const phone = await multiplayer.newPage("AlexandertheExplorer", true);
  await requestSeat(phone, invitation, "AlexandertheExplorer");
  await host.getByRole("button", { name: "Admit AlexandertheExplorer", exact: true }).click();
  for (let player = 1; player < playerCount; player++) await host.getByRole("button", { name: "Add computer", exact: true }).click();
  await host.getByRole("button", { name: "Start game", exact: true }).click();
  await expect(host.getByTestId("game-phase")).toHaveAttribute("data-active-player", "AlexandertheExplorer", { timeout: 15_000 });
  const snapshot = await latestSnapshot(phone);
  const game = snapshot.game!;
  const board = host.getByRole("region", { name: "Shared game board", exact: true });
  await expect(board.locator(".board-viewport")).toHaveCSS("scrollbar-width", "none");
  const roster = host.getByRole("list", { name: "Players", exact: true });
  const viewports = isMobile ? [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 320, height: 568 }, { width: 768, height: 1024 }, { width: 820, height: 1180 }, { width: 1024, height: 768 }]
    : [{ width: 1440, height: 900 }, { width: 1280, height: 720 }, { width: 1024, height: 768 }, { width: 768, height: 1024 }, { width: 820, height: 1180 }];

  for (const viewport of viewports) {
    await host.setViewportSize(viewport);
    const boardBounds = (await board.boundingBox())!;
    const rosterBounds = (await roster.boundingBox())!;
    await expect(host.getByRole("button", { name: "Game", exact: true })).toBeInViewport({ ratio: 1 });
    await expect(board).toBeInViewport({ ratio: 1 });
    await expect(board.getByRole("group", { name: "Map zoom controls" })).toBeInViewport({ ratio: 1 });
    expect(boardBounds.y).toBeGreaterThanOrEqual(rosterBounds.y + rosterBounds.height);
    expect(boardBounds.width).toBe(rosterBounds.width);
    expect(boardBounds.height).toBeGreaterThan(viewport.height * 0.45);
    await expect(roster.getByRole("listitem")).toHaveCount(playerCount);
    const highestScore = Math.max(...game.players.map(player => player.score));
    for (const [index, player] of game.players.entries()) {
      const seat = roster.getByRole("listitem").filter({ has: host.getByText(player.name, { exact: true }) });
      await expect(seat.locator(".player-number")).toHaveText(player.control === "human" ? player.name.trim()[0]!.toUpperCase() : String(index + 1));
      await expect(seat.locator(".player-score > .font-serif")).toHaveText(String(player.score));
      await expect(seat.getByRole("img", { name: `${player.resourceCount} resource cards`, exact: true })).toBeVisible();
      await expect(seat.getByRole("img", { name: `${player.developmentCount} development cards`, exact: true })).toBeVisible();
      await expect(seat.locator(".player-seat")).toHaveClass(player.id === game.activePlayerId ? /player-seat-active/ : /^(?!.*player-seat-active)/);
      if (player.score === highestScore && game.players.some(other => other.score < highestScore)) await expect(seat.locator(".player-seat")).toHaveClass(/player-seat-leading/);
      expect(await seat.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      const row = await seat.locator(".player-number, .player-name, .player-card-counts, .player-score").evaluateAll(elements => elements.map(element => {
        const bounds = element.getBoundingClientRect();
        return { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom, center: bounds.top + bounds.height / 2 };
      }));
      const stacked = await seat.locator(".player-seat > div").evaluate(element => getComputedStyle(element).display === "grid");
      if (stacked) {
        expect(Math.abs(row[1]!.center - row[0]!.center)).toBeLessThan(1);
        expect(row[2]!.top).toBeGreaterThanOrEqual(row[1]!.bottom);
        expect(row[3]!.left).toBeGreaterThanOrEqual(row[1]!.right);
      } else {
        for (let index = 1; index < row.length; index++) {
          expect(Math.abs(row[index]!.center - row[0]!.center)).toBeLessThan(1);
          expect(row[index]!.left).toBeGreaterThanOrEqual(row[index - 1]!.right);
        }
      }
      await expect(seat.locator(".player-card-counts")).toHaveCSS("flex-direction", "row");
    }
    if (viewport.width < 700) {
      await roster.getByRole("listitem").last().scrollIntoViewIfNeeded();
      await expect(roster.getByRole("listitem").last()).toBeInViewport({ ratio: 1 });
      expect(await roster.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
      await roster.getByRole("listitem").first().scrollIntoViewIfNeeded();
      expect(await board.boundingBox()).toEqual(boardBounds);
    } else {
      expect(await roster.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      await expect(roster.getByRole("listitem").first()).toBeInViewport({ ratio: 1 });
      await expect(roster.getByRole("listitem").last()).toBeInViewport({ ratio: 1 });
    }
    await noHorizontalOverflow(host);
    expect(await host.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight))).toBeLessThanOrEqual(viewport.height);
    for (const name of ["Your cards", "Resource bank", "Build a little bigger", "Turn status", "Dice tray", "Roll result"]) {
      await expect(host.getByRole("region", { name, exact: true, includeHidden: true })).toHaveCount(0);
    }
    await expect(host.getByRole("navigation", { name: "Game views", includeHidden: true })).toHaveCount(0);
    await expect(host.getByRole("button", { name: /^(Build road|Build settlement|Upgrade to city|Table activity|Roll the dice|End turn|Make a trade|Buy a card)$/, includeHidden: true })).toHaveCount(0);
    await screenshot(host, testInfo, `shared-board-${viewport.width}-${viewport.height}`);
  }

  await board.getByRole("button", { name: /^Place settlement at / }).first().click();
  await expect(board.getByRole("button", { name: "Confirm placement", exact: true })).toBeInViewport({ ratio: 1 });
  await expect(board.getByRole("group", { name: "Placement confirmation", exact: true }).locator(".placement-confirmation-player")).toHaveText("AlexandertheExplorer");
  await board.getByRole("button", { name: "Confirm placement", exact: true }).click();
  await expectPhase([host, phone], "setup-road", "AlexandertheExplorer");
  await expect(board.getByRole("img", { name: /AlexandertheExplorer's settlement at / }).locator("text")).toHaveText("A");
  await expect(roster.getByRole("listitem").filter({ has: host.getByText("AlexandertheExplorer", { exact: true }) }).locator(".player-number")).toHaveText("A");
});

test("Seafarers lobby selection synchronizes phones and allows coastal ships and ship movement on the shared board", async ({ multiplayer }, testInfo) => {
  const host = await multiplayer.newPage("Host");
  const invitation = await hostGame(host);
  await host.getByRole("button", { name: "Seafarers", exact: true }).click();
  await expect(host.locator(".terrain-hex")).toHaveCount(42);
  const phone = await multiplayer.newPage("Alex", true);
  await requestSeat(phone, invitation, "Alex");
  await host.getByRole("button", { name: "Admit Alex", exact: true }).click();
  await host.getByRole("button", { name: "Add computer", exact: true }).click();
  await host.getByRole("button", { name: "Add computer", exact: true }).click();
  expect((await latestSnapshot(phone)).variant).toBe("seafarers");
  await host.getByRole("button", { name: "Start game", exact: true }).click();
  for (let placement = 0; placement < 2; placement++) {
    await expectPhase([host, phone], "setup-settlement", "Alex");
    const snapshot = await latestSnapshot(phone);
    const game = snapshot.game!;
    const vertexId = snapshot.boardTargets.vertices.find(id => {
      const vertex = game.board.vertices.find(vertex => vertex.id === id)!;
      return game.board.edges.some(edge => vertex.edgeIds.includes(edge.id) && !edge.playerId &&
        game.board.tiles.some(tile => tile.terrain === "sea" && tile.id !== game.pirateTileId && edge.vertexIds.every(id => tile.vertexIds.includes(id))));
    })!;
    expect(vertexId).toBeDefined();
    await host.getByRole("button", { name: `Place settlement at ${vertexId}`, exact: true }).click();
    await host.getByRole("button", { name: "Confirm placement", exact: true }).click();
    await expectPhase([host, phone], "setup-road", "Alex");
    await phone.getByRole("button", { name: "Choose ships", exact: true }).click();
    const target = host.getByRole("button", { name: /^Build ship at / }).first();
    await expect(target).toBeVisible();
    await target.click();
    await host.getByRole("button", { name: "Confirm placement", exact: true }).click();
  }
  await expect(phone.getByRole("button", { name: "Roll the dice", exact: true })).toBeEnabled({ timeout: 20000 });
  await host.evaluate(() => {
    Object.defineProperty(crypto, "getRandomValues", { configurable: true, value: (values: Uint32Array) => values.fill(0) });
  });
  await phone.getByRole("button", { name: "Roll the dice", exact: true }).click();
  await expectPhase([host, phone], "actions", "Alex");
  await phone.getByRole("button", { name: "Move ship", exact: true }).click();
  await host.getByRole("button", { name: /^Move ship at / }).first().click();
  await host.getByRole("button", { name: /^Move ship at / }).first().click();
  await expect(host.getByText("Move the ship here?", { exact: true })).toBeVisible();
  const before = (await latestSnapshot(phone)).privatePlayer!.resources;
  await host.getByRole("button", { name: "Confirm placement", exact: true }).click();
  await expect.poll(async () => (await latestSnapshot(phone)).game!.shipMoved).toBe(true);
  expect((await latestSnapshot(phone)).privatePlayer!.resources).toEqual(before);
  await noHorizontalOverflow(host);
  await privateScreenFits(phone);
  await screenshot(host, testInfo, "seafarers-shared-ships");
  await screenshot(phone, testInfo, "seafarers-private-controls");
});

test("Seafarers gold choices are available off-turn on a narrow phone and send only selected bank resources", async ({ multiplayer }, testInfo) => {
  const { phone, snapshot, present } = await privateDialogFixture(multiplayer);
  snapshot.variant = "seafarers";
  snapshot.game!.variant = "seafarers";
  snapshot.game!.board = createBoard(undefined, "seafarers");
  snapshot.game!.pirateTileId = snapshot.game!.board.tiles.find(tile => tile.terrain === "sea")!.id;
  snapshot.game!.activePlayerId = snapshot.game!.players.find(player => player.id !== snapshot.playerId)!.id;
  snapshot.game!.phase = { type: "gold", required: { [snapshot.playerId!]: 2 } };
  snapshot.game!.bank = { wood: 1, brick: 0, wool: 0, grain: 0, ore: 1 };
  snapshot.boardTargets = { vertices: [], edges: [], tiles: [] };
  await present();
  const choices = phone.getByRole("region", { name: "Choose your gold resources", exact: true });
  await expect(choices).toBeVisible();
  await expect(choices.getByRole("button", { name: "Collect resources", exact: true })).toBeDisabled();
  await choices.getByRole("button", { name: "Add Ore to Take from the bank", exact: true }).click();
  await choices.getByRole("button", { name: "Add Wood to Take from the bank", exact: true }).click();
  await expect(choices.getByRole("button", { name: "Collect resources", exact: true })).toBeEnabled();
  await privateScreenFits(phone);
  await screenshot(phone, testInfo, "seafarers-gold-choice");
  await choices.getByRole("button", { name: "Collect resources", exact: true }).click();
  await expect.poll(async () => (await sentActions(phone)).at(-1)).toMatchObject({
    type: "action", action: { type: "choose-gold", resources: { wood: 1, brick: 0, wool: 0, grain: 0, ore: 1 } },
  });
});

test("one private phone plays with two computers that complete setup automatically", async ({ multiplayer }, testInfo) => {
  const host = await multiplayer.newPage("Host");
  const invitation = await hostGame(host);
  const phone = await multiplayer.newPage("Alex", true);
  await requestSeat(phone, invitation, "Alex");
  await host.getByRole("button", { name: "Admit Alex", exact: true }).click();
  await host.getByRole("button", { name: "Add computer", exact: true }).click();
  await host.getByRole("button", { name: "Add computer", exact: true }).click();
  await expect(phone.getByRole("list", { name: "Players", exact: true }).getByRole("listitem")).toHaveCount(3);
  await host.getByRole("button", { name: "Start game", exact: true }).click();

  // Only the human's two settlements and roads are placed through the shared board.
  for (let placement = 0; placement < 2; placement++) {
    await expect(host.getByTestId("game-phase")).toHaveAttribute("data-active-player", "Alex", { timeout: 15_000 });
    await expectPhase([host, phone], "setup-settlement", "Alex");
    await host.getByRole("button", { name: /^Place settlement at / }).first().click();
    await host.getByRole("button", { name: "Confirm placement", exact: true }).click();
    await expectPhase([host, phone], "setup-road", "Alex");
    await host.getByRole("button", { name: /^Build road at / }).first().click();
    await host.getByRole("button", { name: "Confirm placement", exact: true }).click();
  }
  const tradeRequest = phone.getByRole("dialog", { name: "Trade request", exact: true });
  await phone.addLocatorHandler(tradeRequest, async dialog => {
    await dialog.getByRole("button", { name: "Decline", exact: true }).click();
  });
  await expect(phone.getByRole("button", { name: "Roll the dice", exact: true })).toBeEnabled({ timeout: 20_000 });
  await phone.removeLocatorHandler(tradeRequest);
  await expectPhase([host, phone], "roll", "Alex");
  const snapshots = (await messages(phone)).filter(entry => entry.direction === "received" && entry.message.type === "snapshot").map(entry => entry.message.snapshot as RoomSnapshot);
  // Computers earlier in turn order may already have built more by the human's first roll.
  const completedSetup = snapshots.find(snapshot => snapshot.game?.phase.type === "roll" && snapshot.game.turnNumber === 1)?.game;
  expect(completedSetup?.board.vertices.filter(vertex => vertex.building)).toHaveLength(6);
  expect(completedSetup?.board.edges.filter(edge => edge.playerId)).toHaveLength(6);
  const computerTurns = snapshots.filter(snapshot => snapshot.game?.players.find(player => player.id === snapshot.game?.activePlayerId)?.control === "computer");
  expect(computerTurns.length).toBeGreaterThan(0);
  for (const snapshot of computerTurns) {
    expect(snapshot.boardTargets).toEqual({ vertices: [], edges: [], tiles: [] });
    expect(snapshot.privatePlayer?.name).toBe("Alex");
    for (const player of snapshot.game!.players) {
      expect(player).not.toHaveProperty("resources");
      expect(player).not.toHaveProperty("developmentCards");
    }
  }
  await expect(host.getByRole("region", { name: "Your cards", exact: true, includeHidden: true })).toHaveCount(0);
  await expect(host.getByRole("button", { name: "Add computer", exact: true })).toHaveCount(0);
  await expect(host.getByRole("button", { name: /^Rename / })).toHaveCount(0);
  await expect(host.getByRole("button", { name: /^Remove / })).toHaveCount(0);
  await noHorizontalOverflow(host);
  await noHorizontalOverflow(phone);
  await screenshot(host, testInfo, "computer-setup-complete");
  await screenshot(phone, testInfo, "human-private-hand-with-computers");
});

test("computer turns run without phones or shared-board input", async ({ multiplayer }, testInfo) => {
  const host = await multiplayer.newPage("Host");
  await hostGame(host);
  for (let player = 0; player < 3; player++) {
    await host.getByRole("button", { name: "Add computer", exact: true }).click();
  }
  await host.clock.install({ time: new Date("2030-01-01T00:00:00Z") });
  await host.clock.pauseAt(new Date("2030-01-01T00:00:01Z"));
  await host.getByRole("button", { name: "Start game", exact: true }).click();
  await expect(host.getByTestId("game-phase")).toHaveAttribute("data-phase", "setup-settlement");
  await expect(host.getByRole("button", { name: /^Place settlement at / })).toHaveCount(0);
  await expect(host.getByRole("button", { name: /^Build (road|settlement|city)$/, includeHidden: true })).toHaveCount(0);
  await host.clock.runFor(450);
  await expect(host.getByRole("img", { name: /'s settlement at / })).toHaveCount(1);
  await expect(host.getByTestId("game-phase")).toHaveAttribute("data-phase", "setup-road");
  await expect(host.getByRole("button", { name: /^Build road at / })).toHaveCount(0);
  await host.clock.runFor(11 * 450);
  await expect(host.getByRole("img", { name: /'s settlement at / })).toHaveCount(6);
  await expect(host.getByRole("img", { name: /'s road at / })).toHaveCount(6);
  await expect(host.getByTestId("game-phase")).toHaveAttribute("data-phase", "roll");
  await host.clock.runFor(450);
  await expect(host.getByTestId("game-phase")).not.toHaveAttribute("data-phase", "roll");
  await screenshot(host, testInfo, "automatic-computer-turn");
  await chooseGameOption(host, "Leave room");
  await host.getByRole("dialog", { name: "Close this room?" }).getByRole("button", { name: "Leave room", exact: true }).click();
  await host.clock.runFor(2_000);
  await expect(host.getByRole("link", { name: "Play across devices", exact: true })).toBeVisible();
});

test("private player header matches the single-device hand and total score", async ({ multiplayer }, testInfo) => {
  const { phone, snapshot, present } = await privateDialogFixture(multiplayer);
  const game = snapshot.game!;
  const player = snapshot.privatePlayer!;
  const statistics = game.players.find(other => other.id === player.id)!;
  player.name = "AlexandertheExplorer";
  statistics.name = player.name;
  player.resources = { wood: 19, brick: 19, wool: 19, grain: 19, ore: 19 };
  player.developmentCards = [{ id: "development-1", kind: "knight", purchasedTurn: 1 }, { id: "development-2", kind: "victory-point", purchasedTurn: 1 }];
  statistics.resourceCount = 95;
  statistics.developmentCount = 2;
  statistics.knightsPlayed = 12;
  statistics.longestRoad = 15;
  statistics.score = 7;
  statistics.islands = 2;
  snapshot.privateScore = 8;
  game.awards = { largestArmy: player.id, longestRoad: player.id };
  await present();

  const header = phone.getByRole("region", { name: "Your current resources", exact: true });
  const heading = header.getByRole("heading", { name: `${player.name}'s hand`, exact: true });
  await expect(heading).toBeVisible();
  await expect(header.getByText("95 cards", { exact: true })).toBeVisible();
  await expect(header.getByText("95 cards", { exact: true })).toHaveClass(/card-count-at-risk/);
  await expect(header.getByRole("img", { name: "1 victory point cards", exact: true })).toBeVisible();
  await expect(header.locator(".player-seat")).toHaveCount(0);
  const summary = phone.getByRole("region", { name: "Your player summary", exact: true });
  const seat = summary.locator(".player-seat");
  await expect(seat.locator(".player-number")).toHaveText(player.name.trim()[0]!.toUpperCase());
  const playerColor = await phone.evaluate(color => { const style = document.createElement("span").style; style.backgroundColor = color; return style.backgroundColor; }, player.color);
  await expect(seat.locator(".player-number")).toHaveCSS("background-color", playerColor);
  await expect(seat.locator(".player-name")).toHaveText(player.name);
  await expect(seat).toHaveClass(/player-seat-active/);
  await expect(seat).toHaveClass(/player-seat-leading/);
  await expect(seat.locator(".player-score > span")).toHaveText(["VP", "8"]);
  await expect(seat).not.toContainText("total");
  for (const label of ["95 resource cards", "2 development cards", "12 knights played", "15 connected roads", "Largest Army (+2 victory points)", "Longest Road (+2 victory points)", "Island bonus: 1 island (+2 victory points)"]) {
    await expect(seat.getByRole("img", { name: label, exact: true })).toBeVisible();
  }
  const islandAward = seat.getByRole("img", { name: "Island bonus: 1 island (+2 victory points)", exact: true });
  await expect(islandAward.locator("strong")).toHaveText("1");

  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 667 }, { width: 844, height: 390 }, { width: 1440, height: 900 }]) {
    await phone.setViewportSize(viewport);
    await privateScreenFits(phone);
    expect(await header.locator(":scope > div").first().evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await summary.scrollIntoViewIfNeeded();
    await expect(summary).toBeInViewport({ ratio: 1 });
    expect(await summary.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect((await seat.locator(".player-name").boundingBox())!.width).toBeGreaterThan(30);
    for (const statistic of await seat.getByRole("img").all()) await expect(statistic).toBeInViewport({ ratio: 1 });
    const islandIconBounds = (await islandAward.locator("svg").boundingBox())!;
    const islandCountBounds = (await islandAward.locator("strong").boundingBox())!;
    expect(islandCountBounds.x - islandIconBounds.x - islandIconBounds.width).toBeCloseTo(1, 0);
    expect(islandCountBounds.y).toBeGreaterThan(islandIconBounds.y + islandIconBounds.height / 2);
    expect(islandCountBounds.y + islandCountBounds.height - islandIconBounds.y - islandIconBounds.height).toBeCloseTo(2, 0);
    const summaryBounds = (await summary.boundingBox())!;
    const handBounds = (await phone.locator(".private-hand").boundingBox())!;
    expect(handBounds.width).toBe(summaryBounds.width);
    expect(handBounds.y - summaryBounds.y - summaryBounds.height).toBe(8);
    expect((await heading.boundingBox())!.width).toBeGreaterThan(30);
    await heading.scrollIntoViewIfNeeded();
    await expect(heading).toBeInViewport({ ratio: 1 });
    await screenshot(phone, testInfo, `private-player-header-${viewport.width}-${viewport.height}`);
  }

  const opponent = game.players.find(other => other.id !== player.id)!;
  game.activePlayerId = opponent.id;
  statistics.score = 2;
  opponent.score = 3;
  snapshot.privateScore = 4;
  await present();
  await expect(seat).not.toHaveClass(/player-seat-active/);
  await expect(seat).not.toHaveClass(/player-seat-leading/);
  await expect(seat.locator(".player-score > span")).toHaveText(["VP", "4"]);
  await expect(seat).not.toContainText("total");
  snapshot.privateScore = 2;
  player.resources = { wood: 1, brick: 1, wool: 1, grain: 1, ore: 1 };
  await present();
  await expect(seat.locator(".player-score > span")).toHaveText(["VP", "2"]);
  await expect(seat).not.toContainText("total");
  await expect(header.getByText("5 cards", { exact: true })).not.toHaveClass(/card-count-at-risk/);
});

test("private build rows match the sidebar without stretching when development cards change", async ({ multiplayer }, testInfo) => {
  const { phone, snapshot, present } = await privateDialogFixture(multiplayer);
  const player = snapshot.privatePlayer!;
  const dashboard = phone.getByLabel("Your hand and actions", { exact: true });
  const hand = phone.getByRole("region", { name: "Your cards", exact: true });
  const building = hand.getByRole("region", { name: "Build a little bigger", exact: true });
  const rows = building.locator(".build-options > button");
  for (const kinds of [[], ["victory-point"], ["knight", "victory-point", "road-building", "year-of-plenty", "monopoly"]] as const) {
    player.developmentCards = kinds.map((kind, index) => ({ id: `development-${index}`, kind, purchasedTurn: 1 }));
    snapshot.privateScore = kinds.some(kind => kind === "victory-point") ? 1 : 0;
    await present();
    for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1440, height: 1000 }, { width: 570, height: 1908 }]) {
      await phone.setViewportSize(viewport);
      await privateScreenFits(phone);
      await expect(rows).toHaveCount(4);
      for (const [index, label] of ["Build road", "Build settlement", "Upgrade to city", "Buy a card"].entries()) {
        const row = rows.nth(index);
        await expect(row).toContainText(label);
        await expect(row).toHaveAccessibleName(label);
        const geometry = await row.evaluate(element => {
          const bounds = element.getBoundingClientRect();
          const content = element.firstElementChild!;
          const icon = content.firstElementChild!.getBoundingClientRect();
          const label = content.lastElementChild!.getBoundingClientRect();
          const cost = element.querySelector(".build-cost")!.getBoundingClientRect();
          return { width: bounds.width, height: bounds.height, parentWidth: element.parentElement!.getBoundingClientRect().width,
            iconWidth: icon.width, iconHeight: icon.height, labelRight: label.right, costLeft: cost.left };
        });
        expect(geometry.width).toBe(geometry.parentWidth);
        expect(geometry.height).toBe(56);
        expect(geometry.iconWidth).toBe(32);
        expect(geometry.iconHeight).toBe(32);
        expect(geometry.labelRight).toBeLessThanOrEqual(geometry.costLeft);
      }
      await expect(rows.last().locator("svg").first()).toHaveAttribute("viewBox", "0 0 24 28");
      await expect(building.getByRole("button", { name: "Make a trade", exact: true })).toHaveText("Make a trade");
      expect(await hand.evaluate(element => {
        const lastChild = element.lastElementChild!.getBoundingClientRect();
        return element.getBoundingClientRect().bottom - lastChild.bottom;
      })).toBeLessThanOrEqual(15);
      expect(await phone.locator(".private-turn").evaluate(element =>
        element.getBoundingClientRect().top - element.previousElementSibling!.getBoundingClientRect().bottom,
      )).toBe(8);
      await dashboard.evaluate(element => { element.scrollTop = 0; });
      await screenshot(phone, testInfo, `private-sidebar-${kinds.length}-types-${viewport.width}-${viewport.height}`);
    }
  }
  snapshot.buildMode = "city";
  await present();
  await expect(rows.nth(2)).toHaveAttribute("aria-pressed", "true");
  await expect(rows.nth(2)).toHaveClass(/border-forest bg-moss/);
  await expect(rows.nth(0)).toHaveAttribute("aria-pressed", "false");
});

test("private build buttons explain resources, legal spots, settlement stock and city limits", async ({ multiplayer }, testInfo) => {
  const { phone, snapshot, present } = await privateDialogFixture(multiplayer);
  const player = snapshot.privatePlayer!;
  const game = snapshot.game!;
  await present();
  const building = phone.getByRole("region", { name: "Build a little bigger", exact: true });
  const road = building.getByRole("button", { name: /^Build road\b/ });
  const settlement = building.getByRole("button", { name: /^Build settlement\b/ });
  const city = building.getByRole("button", { name: "Upgrade to city", exact: true });
  const explanation = building.locator("#settlement-build-explanation");
  const cityExplanation = building.locator("#city-build-explanation");
  const stockReason = "All 5 settlements are on the board. Upgrade one to a city to free a settlement piece.";
  const cityCapReason = "All 4 cities are on the board.";
  const noSettlementReason = "You have no settlements to upgrade. Build a settlement first.";

  // The empty board offers no legal spot; missing resources explain every row,
  // and the city explanation stays hidden while the upgrade is unaffordable.
  player.resources = { wood: 5, brick: 0, wool: 5, grain: 1, ore: 2 };
  await present();
  await expect(road).toBeDisabled();
  await expect(road).toHaveAttribute("title", "You need more resources.");
  await expect(settlement).toBeDisabled();
  await expect(settlement).toHaveAttribute("title", "You need more resources.");
  await expect(city).toBeDisabled();
  await expect(city).toHaveAttribute("title", "You need more resources.");
  await expect(city).not.toHaveAttribute("aria-describedby");
  await expect(cityExplanation).toHaveCount(0);
  await expect(explanation).toHaveCount(0);

  // With enough resources but no settlement on the board, the city row explains why.
  player.resources = { wood: 5, brick: 0, wool: 5, grain: 5, ore: 5 };
  await present();
  await expect(city).toBeDisabled();
  await expect(city).toHaveAttribute("title", noSettlementReason);
  await expect(city).toHaveAttribute("aria-describedby", "city-build-explanation");
  await expect(city).toHaveAccessibleDescription(noSettlementReason);
  await expect(cityExplanation).toHaveText(noSettlementReason);

  // Five settlements exhaust the stock even with resources and roads to spare.
  const neighborIds = (vertexId: string) => game.board.edges.filter(edge => edge.vertexIds.includes(vertexId))
    .flatMap(edge => edge.vertexIds.filter(id => id !== vertexId));
  const roadSpot = game.board.vertices[0]!;
  const roadEdge = game.board.edges.find(edge => edge.vertexIds.includes(roadSpot.id))!;
  const farEnd = roadEdge.vertexIds.find(id => id !== roadSpot.id)!;
  const forbidden = new Set([roadSpot.id, farEnd, ...neighborIds(roadSpot.id), ...neighborIds(farEnd)]);
  const homes = game.board.vertices.filter(vertex => !forbidden.has(vertex.id)).slice(0, 5);
  expect(homes).toHaveLength(5);
  for (const vertex of homes) vertex.building = { playerId: player.id, kind: "settlement" };
  roadEdge.playerId = player.id;
  player.resources = { wood: 5, brick: 5, wool: 5, grain: 5, ore: 5 };
  await present();
  await expect(settlement).toBeDisabled();
  await expect(settlement).toHaveAttribute("title", stockReason);
  await expect(settlement).toHaveAttribute("aria-describedby", "settlement-build-explanation");
  await expect(settlement).toHaveAccessibleDescription(stockReason);
  await expect(explanation).toHaveText(stockReason);
  await settlement.scrollIntoViewIfNeeded();
  await noHorizontalOverflow(phone);
  await screenshot(phone, testInfo, "private-settlement-stock-exhausted");

  // Upgrading one settlement to a city frees the piece next to the player's road.
  homes[0]!.building = { playerId: player.id, kind: "city" };
  await present();
  expect(legalSettlementVertices(game, player.id)).toContain(roadSpot.id);
  await expect(settlement).toBeEnabled();
  await expect(settlement).toHaveAttribute("title", "Select a location on the board.");
  await expect(settlement).not.toHaveAttribute("aria-describedby");
  await expect(explanation).toHaveCount(0);
  await expect(city).toBeEnabled();
  await expect(road).toBeEnabled();
  await screenshot(phone, testInfo, "private-settlement-stock-recovered");

  // Four cities reach the upgrade cap even with resources and a settlement to spare.
  for (const home of homes.slice(1, 4)) home.building = { playerId: player.id, kind: "city" };
  await present();
  await expect(city).toBeDisabled();
  await expect(city).toHaveAttribute("title", cityCapReason);
  await expect(city).toHaveAttribute("aria-describedby", "city-build-explanation");
  await expect(city).toHaveAccessibleDescription(cityCapReason);
  await expect(cityExplanation).toHaveText(cityCapReason);
  await city.scrollIntoViewIfNeeded();
  await noHorizontalOverflow(phone);
  await screenshot(phone, testInfo, "private-city-cap-exhausted");

  // Without settlements on the board there is nothing left to upgrade.
  for (const home of homes.slice(2)) home.building = null;
  await present();
  await expect(city).toBeDisabled();
  await expect(city).toHaveAttribute("title", noSettlementReason);
  await expect(city).toHaveAttribute("aria-describedby", "city-build-explanation");
  await expect(city).toHaveAccessibleDescription(noSettlementReason);
  await expect(cityExplanation).toHaveText(noSettlementReason);
  await screenshot(phone, testInfo, "private-city-no-settlements");
});

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
    await expect(phone.getByRole("region", { name: "Your cards", exact: true, includeHidden: true })).toHaveCount(0);
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
    await expect(phone.getByRole("region", { name: "Your cards", exact: true })).toBeVisible();
    await expect(phone.getByRole("region", { name: "Your current resources", exact: true })).toHaveCount(1);
    for (const action of ["Roll the dice", "End turn", "Build road", "Build settlement", "Upgrade to city", "Buy a card"]) {
      await expect(phone.getByRole("button", { name: action, exact: true })).toBeVisible();
    }
    const snapshots = (await messages(phone)).filter(entry => entry.direction === "received" && entry.message.type === "snapshot");
    for (const entry of snapshots) {
      const snapshot = entry.message.snapshot as RoomSnapshot;
      expect(Object.keys(snapshot).sort()).toEqual(["version", "variant", "players", "game", "playerId", "privatePlayer", "privateThefts", "privateMonopolies", "privateScore", "buildMode", "boardTargets"].sort());
      expect(snapshot).not.toHaveProperty("pendingPlayers");
      expect(snapshot.privateThefts).toEqual([]);
      expect(snapshot.privateMonopolies).toEqual([]);
      if (!snapshot.game) continue;
      expect(snapshot.privatePlayer?.name).toBe(name);
      expect(snapshot.privatePlayer?.id).toBe(snapshot.playerId);
      expect(snapshot.game).not.toHaveProperty("developmentDeck");
      expect(snapshot.game).not.toHaveProperty("thefts");
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
    await expect(phone.getByRole("navigation", { name: "Table information", exact: true })).toHaveCount(0);
    await expect.poll(() => phone.evaluate(() => (window as unknown as ObservedWindow).multiplayerProbe.channels.some(channel => channel.readyState === "open"))).toBe(true);
    await privateScreenFits(phone);
  }
  await expect(host.getByRole("region", { name: "Your cards", exact: true, includeHidden: true })).toHaveCount(0);
  await expect(host.getByRole("region", { name: "Your current resources", includeHidden: true })).toHaveCount(0);
  await expect(host.getByRole("region", { name: "Robbery notification", exact: true, includeHidden: true })).toHaveCount(0);
  await noHorizontalOverflow(host);
  await screenshot(host, testInfo, "host-completed-setup");
  await screenshot(activePhone, testInfo, "phone-private-hand");
  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 667 }, { width: 844, height: 390 }, { width: 1440, height: 900 }]) {
    await activePhone.setViewportSize(viewport);
    await privateScreenFits(activePhone);
    await screenshot(activePhone, testInfo, `private-hand-${viewport.width}-${viewport.height}`);
  }
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
    .toEqual({ key: "Wait for your turn to perform this action." });
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

  await inactivePhone.emulateMedia({ reducedMotion: "reduce" });
  await activePhone.clock.install({ time: new Date("2030-01-01T00:00:00Z") });
  await activePhone.clock.pauseAt(new Date("2030-01-01T00:00:01Z"));
  await activePhone.getByRole("button", { name: "Roll the dice", exact: true }).click();
  const rollResult = activePhone.getByRole("region", { name: "Roll result", exact: true });
  await expect(rollResult).toHaveAttribute("data-stage", "rolling");
  await expect(activePhone.getByRole("img", { name: "Dice rolling", exact: true })).toBeVisible();
  expect(await rollResult.locator("svg").first().evaluate(element => getComputedStyle(element).animationName)).toBe("dice-tumble");
  await expect(host.getByTestId("game-phase")).not.toHaveAttribute("data-phase", "roll");
  await expect(activePhone.getByTestId("game-phase")).not.toHaveAttribute("data-phase", "roll");
  const rolled = (await latestSnapshot(activePhone)).game!;
  expect(rolled.dice).toHaveLength(2);
  for (const die of rolled.dice!) {
    expect(die).toBeGreaterThanOrEqual(1);
    expect(die).toBeLessThanOrEqual(6);
  }
  const total = rolled.dice![0] + rolled.dice![1];
  await activePhone.clock.runFor(550);
  await expect(rollResult).toHaveAttribute("data-stage", "complete");
  await expect(rollResult).toContainText(`${rolled.dice![0]} + ${rolled.dice![1]} = ${total}`);
  await expect(activePhone.getByRole("status", { name: "Roll announcement" })).toContainText(`${activeName} rolled`);
  await expect(inactivePhone.getByRole("region", { name: "Roll result", exact: true })).toHaveAttribute("data-stage", "complete");
  expect(await inactivePhone.locator(".roll-die").first().evaluate(element => getComputedStyle(element).animationName)).toBe("none");
  expect(rolled.phase.type).toBe(total === 7 ? "robber" : "actions");
  await expectPhase(pages, rolled.phase.type, activeName);
  for (const phone of phones.values()) await expect.poll(async () => (await latestSnapshot(phone)).game).toEqual(rolled);
  await expect(host.getByRole("region", { name: "Roll result", exact: true, includeHidden: true })).toHaveCount(0);
  await screenshot(host, testInfo, "host-shared-roll");
  await screenshot(activePhone, testInfo, "phone-after-roll");
  await activePhone.clock.resume();
  await activePhone.reload();
  await expect(activePhone.getByRole("region", { name: "Roll result", exact: true })).toHaveAttribute("data-stage", "complete");
  await expect(activePhone.getByRole("img", { name: `Dice: ${rolled.dice![0]} and ${rolled.dice![1]}`, exact: true })).toBeVisible();
  await privateScreenFits(activePhone);
});

test("private robbery notices overlay above turn controls without moving the hand for five visible seconds", async ({ multiplayer }, testInfo) => {
  const { phone, snapshot, present } = await privateDialogFixture(multiplayer);
  const player = snapshot.privatePlayer!;
  const game = snapshot.game!;
  const opponent = game.players.find(other => other.id !== player.id)!;
  opponent.name = "AlexandertheExplorer";
  snapshot.privateThefts = [];
  await phone.clock.install({ time: new Date("2030-01-01T00:00:00Z") });
  await phone.clock.pauseAt(new Date("2030-01-01T00:00:01Z"));
  const notice = phone.getByRole("region", { name: "Robbery notification", exact: true });
  const announcement = phone.getByRole("status", { name: "Robbery result", exact: true });
  const dismiss = notice.getByRole("button", { name: "Dismiss robbery notification", exact: true });
  const dashboard = phone.getByLabel("Your hand and actions", { exact: true });
  const turnControls = phone.getByRole("region", { name: "Turn controls", exact: true });
  const hand = phone.getByRole("region", { name: "Your cards", exact: true });

  for (const lost of [true, false]) {
    game.activePlayerId = lost ? opponent.id : player.id;
    player.resources.ore = lost ? 4 : 5;
    await present();
    const turnBeforeNotice = await turnControls.boundingBox();
    const handBeforeNotice = await hand.boundingBox();
    snapshot.privateThefts.push({ id: lost ? 1 : 2, thiefId: lost ? opponent.id : player.id, victimId: lost ? player.id : opponent.id, resource: "ore" });
    await present();
    expect(await turnControls.boundingBox()).toEqual(turnBeforeNotice);
    expect(await hand.boundingBox()).toEqual(handBeforeNotice);
    const title = lost ? `${opponent.name} robbed you` : `You stole from ${opponent.name}`;
    const description = lost ? `${opponent.name} robbed you of 1 Ore.` : `You stole 1 Ore from ${opponent.name}.`;
    await expect(notice).toHaveCount(1);
    await expect(notice.getByRole("heading", { name: title, exact: true })).toBeVisible();
    await expect(notice.getByText(`${lost ? "-1" : "+1"}`, { exact: true })).toBeVisible();
    await expect(notice.locator(".resource-card")).toBeVisible();
    await expect(announcement).toHaveText(description);
    await expect(announcement).toHaveAttribute("aria-atomic", "true");

    for (const { width, height, reducedMotion } of [
      { width: 320, height: 568, reducedMotion: "no-preference" },
      { width: 1440, height: 900, reducedMotion: "no-preference" },
      { width: 320, height: 568, reducedMotion: "reduce" },
    ] as const) {
      await phone.setViewportSize({ width, height });
      await phone.emulateMedia({ reducedMotion });
      await privateScreenFits(phone);
      await notice.scrollIntoViewIfNeeded();
      await expect(notice).toBeInViewport({ ratio: 1 });
      await expect(notice.getByRole("heading", { name: title, exact: true })).toBeInViewport({ ratio: 1 });
      await expect(notice.locator(".resource-card")).toBeInViewport({ ratio: 1 });
      await expect(dismiss).toBeInViewport({ ratio: 1 });
      expect(await notice.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      expect(await notice.evaluate(element => element.parentElement?.parentElement?.getAttribute("aria-label"))).toBe("Turn controls");
      await expect(notice).toHaveCSS("position", "absolute");
      const noticeBounds = (await notice.boundingBox())!;
      const turnBounds = (await turnControls.boundingBox())!;
      expect(noticeBounds.y + noticeBounds.height).toBeLessThanOrEqual(turnBounds.y);
      expect(turnBounds.y - noticeBounds.y - noticeBounds.height).toBeCloseTo(8, 0);
      expect(noticeBounds.x).toBeCloseTo(turnBounds.x, 0);
      expect(noticeBounds.width).toBeCloseTo(turnBounds.width, 0);
      if (reducedMotion === "reduce") {
        await expect(notice).toHaveCSS("animation-name", "none");
        await expect(notice.locator(".resource-card")).toHaveCSS("animation-name", "none");
      }
      await expect(announcement).toHaveText(description);
      await screenshot(phone, testInfo, `private-robbery-${lost ? "victim" : "thief"}-${width}-${height}-${reducedMotion}`);
    }

    // Larger screens still scroll the stack; off-screen time must not expire a notice.
    await phone.emulateMedia({ reducedMotion: lost ? "no-preference" : "reduce" });
    await phone.setViewportSize({ width: 844, height: 400 });
    const building = phone.getByRole("button", { name: "Build a little bigger", exact: true });
    if (await building.getAttribute("aria-expanded") === "false") {
      await building.focus();
      await phone.keyboard.press("Enter");
    }
    await dashboard.evaluate(element => { element.scrollTop = 0; });
    await expect(notice).not.toBeInViewport({ ratio: 0.5 });
    await phone.clock.fastForward(10_000);
    await expect(notice).toBeVisible();
    await expect(announcement).toHaveText(description);
    await phone.setViewportSize({ width: 320, height: 568 });
    await notice.scrollIntoViewIfNeeded();
    await expect(notice).toBeInViewport({ ratio: 1 });
    const turnBeforeExpiry = await turnControls.boundingBox();
    const handBeforeExpiry = await hand.boundingBox();
    await phone.clock.fastForward(2_500);
    await present();
    await phone.clock.fastForward(2_499);
    await expect(notice).toHaveCount(1);
    await expect(announcement).toHaveText(description);
    await phone.clock.fastForward(1);
    await expect(notice).toHaveCount(0);
    await expect(announcement).toHaveText("");
    expect(await turnControls.boundingBox()).toEqual(turnBeforeExpiry);
    expect(await hand.boundingBox()).toEqual(handBeforeExpiry);
    await present();
    await expect(notice).toHaveCount(0);
    await expect(announcement).toHaveText("");
    player.resources.wood--;
    await present();
    await expect(phone.getByRole("listitem", { name: `Wood: ${player.resources.wood} in hand`, exact: true })).toBeVisible();
    await expect(notice).toHaveCount(0);
    await expect(announcement).toHaveText("");
  }
  expect(await sentActions(phone)).toEqual([]);
});

test("private robbery notices time each queued event and ignore unrelated resource losses", async ({ multiplayer }, testInfo) => {
  const { phone, snapshot, present } = await privateDialogFixture(multiplayer);
  await phone.clock.install({ time: new Date("2030-01-01T00:00:00Z") });
  await phone.clock.pauseAt(new Date("2030-01-01T00:00:01Z"));
  const player = snapshot.privatePlayer!;
  const game = snapshot.game!;
  const [thief, victim] = game.players.filter(other => other.id !== player.id);
  const statistics = game.players.find(other => other.id === player.id)!;
  const notice = phone.getByRole("region", { name: "Robbery notification", exact: true });
  const announcement = phone.getByRole("status", { name: "Robbery result", exact: true });
  const dismiss = notice.getByRole("button", { name: "Dismiss robbery notification", exact: true });
  snapshot.privateThefts = [];
  statistics.resourceCount = 20;
  thief!.resourceCount = 3;
  await present();
  await expect(phone.getByRole("listitem", { name: "Ore: 5 in hand", exact: true })).toBeVisible();

  // Spending or discarding changes counts without creating a theft event.
  player.resources.ore--;
  statistics.resourceCount--;
  thief!.resourceCount--;
  await present();
  await expect(phone.getByRole("listitem", { name: "Ore: 4 in hand", exact: true })).toBeVisible();
  await expect(notice).toHaveCount(0);
  await expect(announcement).toHaveText("");

  snapshot.privateThefts = [
    { id: 1, thiefId: thief!.id, victimId: player.id, resource: "ore" },
    { id: 2, thiefId: player.id, victimId: victim!.id, resource: "wool" },
  ];
  await present();
  await expect(notice).toHaveCount(1);
  await expect(notice.getByRole("heading", { name: `${thief!.name} robbed you`, exact: true })).toBeVisible();
  await expect(announcement).toHaveText(`${thief!.name} robbed you of 1 Ore.`);
  await expect(notice.getByRole("heading", { name: `You stole from ${victim!.name}`, exact: true })).toHaveCount(0);
  await notice.scrollIntoViewIfNeeded();
  await expect(notice).toBeInViewport({ ratio: 1 });
  await phone.clock.fastForward(2_500);

  // An identical later theft is still a distinct event, and cannot replace the unread first one.
  snapshot.privateThefts.push({ id: 3, thiefId: thief!.id, victimId: player.id, resource: "ore" });
  await present();
  await expect(notice).toHaveCount(1);
  await expect(announcement).toHaveText(`${thief!.name} robbed you of 1 Ore.`);
  await expect(notice.getByText("2 more", { exact: true })).toBeVisible();
  await notice.scrollIntoViewIfNeeded();
  await expect(notice).toBeInViewport({ ratio: 1 });
  await noHorizontalOverflow(phone);
  await screenshot(phone, testInfo, "private-robbery-queued");

  await phone.clock.fastForward(2_499);
  await expect(announcement).toHaveText(`${thief!.name} robbed you of 1 Ore.`);
  await phone.clock.fastForward(1);
  await expect(notice).toHaveCount(1);
  await expect(notice.getByRole("heading", { name: `You stole from ${victim!.name}`, exact: true })).toBeVisible();
  await expect(notice.getByText("+1", { exact: true })).toBeVisible();
  await expect(announcement).toHaveText(`You stole 1 Wool from ${victim!.name}.`);
  await notice.scrollIntoViewIfNeeded();
  await expect(notice).toBeInViewport({ ratio: 1 });
  await dismiss.focus();
  await phone.clock.fastForward(2_500);
  await present();
  await phone.clock.fastForward(2_499);
  await expect(announcement).toHaveText(`You stole 1 Wool from ${victim!.name}.`);
  // Manual keyboard dismissal preserves focus for the next distinct, identical theft.
  await phone.keyboard.press("Enter");
  await expect(notice).toHaveCount(1);
  await expect(notice.getByRole("heading", { name: `${thief!.name} robbed you`, exact: true })).toBeVisible();
  await expect(dismiss).toBeFocused();
  await expect(announcement).toHaveText(`${thief!.name} robbed you of 1 Ore.`);
  await expect(notice.getByText("-1", { exact: true })).toBeVisible();
  await expect(notice.getByText(/more/)).toHaveCount(0);
  await notice.scrollIntoViewIfNeeded();
  await expect(notice).toBeInViewport({ ratio: 1 });
  await phone.clock.fastForward(4_999);
  await expect(notice).toHaveCount(1);
  await expect(announcement).toHaveText(`${thief!.name} robbed you of 1 Ore.`);
  await phone.clock.fastForward(1);
  await expect(notice).toHaveCount(0);
  await expect(announcement).toHaveText("");
  await present();
  await expect(notice).toHaveCount(0);
  await expect(announcement).toHaveText("");
  expect(await sentActions(phone)).toEqual([]);

  // Reconnecting remounts the action controls, but must retain notice acknowledgements.
  await phone.evaluate(() => {
    const channel = (window as unknown as ObservedWindow).multiplayerProbe.channels.find(channel => channel.readyState === "open")!;
    channel.close();
  });
  await expect(phone.getByRole("alert")).toContainText(/connection to the host was lost/i);
  await expect(notice).toHaveCount(0);
  await expect(announcement).toHaveText("");
  await phone.getByRole("button", { name: "Reconnect", exact: true }).click();
  await expect.poll(() => phone.evaluate(() => (window as unknown as ObservedWindow).multiplayerProbe.channels.some(channel => channel.readyState === "open"))).toBe(true);
  await present();
  await expect(phone.getByRole("alert")).toHaveCount(0);
  await expect(notice).toHaveCount(0);
  await expect(announcement).toHaveText("");
  snapshot.privateThefts.push({ id: 4, thiefId: thief!.id, victimId: player.id, resource: "grain" });
  await present();
  await expect(notice.getByRole("heading", { name: `${thief!.name} robbed you`, exact: true })).toBeVisible();
  await expect(notice.getByText(/more/)).toHaveCount(0);
});

test("private monopoly notices report each victim's losses and queue behind unread theft notices", async ({ multiplayer }, testInfo) => {
  const { phone, snapshot, present } = await privateDialogFixture(multiplayer);
  await phone.clock.install({ time: new Date("2030-01-01T00:00:00Z") });
  await phone.clock.pauseAt(new Date("2030-01-01T00:00:01Z"));
  const player = snapshot.privatePlayer!;
  const game = snapshot.game!;
  const opponent = game.players.find(other => other.id !== player.id)!;
  snapshot.privateThefts = [];
  const monopolyNotice = phone.getByRole("region", { name: "Monopoly notification", exact: true });
  const monopolyAnnouncement = phone.getByRole("status", { name: "Monopoly result", exact: true });
  const robberyNotice = phone.getByRole("region", { name: "Robbery notification", exact: true });
  const robberyAnnouncement = phone.getByRole("status", { name: "Robbery result", exact: true });

  snapshot.privateMonopolies = [{ id: 2, playerId: opponent.id, resource: "ore", losses: { [player.id]: 3 } }];
  player.resources.ore = 2;
  await present();
  await expect(monopolyNotice).toHaveCount(1);
  await expect(monopolyNotice.getByRole("heading", { name: `${opponent.name}'s Monopoly`, exact: true })).toBeVisible();
  await expect(monopolyNotice.getByText("-3", { exact: true })).toBeVisible();
  await expect(monopolyAnnouncement).toHaveText(`You lost 3 ${RESOURCE_NAMES.ore} to ${opponent.name}'s Monopoly.`);
  await expect(monopolyNotice.getByText(/more/)).toHaveCount(0);
  await expect(robberyNotice).toHaveCount(0);
  await monopolyNotice.scrollIntoViewIfNeeded();
  await expect(monopolyNotice).toBeInViewport({ ratio: 1 });
  await noHorizontalOverflow(phone);
  await screenshot(phone, testInfo, "private-monopoly-victim");

  // A later unread theft queues behind the monopoly notice instead of overlapping it.
  snapshot.privateThefts.push({ id: 3, thiefId: opponent.id, victimId: player.id, resource: "wool" });
  await present();
  await expect(monopolyNotice).toHaveCount(1);
  await expect(monopolyNotice.getByText("1 more", { exact: true })).toBeVisible();
  await expect(robberyNotice).toHaveCount(0);
  await expect(robberyAnnouncement).toHaveText("");

  await monopolyNotice.getByRole("button", { name: "Dismiss Monopoly notification", exact: true }).click();
  await expect(monopolyNotice).toHaveCount(0);
  await expect(monopolyAnnouncement).toHaveText("");
  await expect(robberyNotice).toHaveCount(1);
  await expect(robberyAnnouncement).toHaveText(`${opponent.name} robbed you of 1 ${RESOURCE_NAMES.wool}.`);
  expect(await sentActions(phone)).toEqual([]);
});

test("private instructions and grouped development cards match single-device gameplay", async ({ multiplayer }, testInfo) => {
  const { phone, snapshot, present } = await privateDialogFixture(multiplayer);
  const player = snapshot.privatePlayer!;
  const game = snapshot.game!;
  const instructions = phone.getByTestId("game-phase");
  const developmentHand = phone.getByRole("region", { name: "Your development cards", exact: true });

  game.phase = { type: "setup-settlement" };
  await present();
  await expect(instructions.getByRole("heading", { name: "Find a place to call home.", exact: true })).toBeVisible();
  await expect(instructions).toContainText("Place your first settlement on a highlighted intersection on the shared board.");
  await expect(instructions).toContainText("Leave at least two edges between settlements.");
  await expect(instructions.locator(".turn-card")).toHaveCSS("background-color", "rgb(176, 205, 193)");
  await expect(developmentHand).toHaveCount(0);
  await expect(phone.getByRole("button", { name: /^Development cards \(/ })).toHaveCount(0);
  await privateScreenFits(phone);
  await screenshot(phone, testInfo, "private-setup-instructions");

  game.players.forEach((other, index) => { game.board.vertices[index]!.building = { playerId: other.id, kind: "settlement" }; });
  await present();
  await expect(instructions).toContainText("Place your second settlement");
  game.phase = { type: "robber", returnPhase: "roll" };
  game.canCancelKnight = true;
  await present();
  await expect(instructions.getByRole("heading", { name: "Move the robber.", exact: true })).toBeVisible();
  await expect(instructions).toContainText("Confirm a new hex on the shared board or cancel Knight.");
  await expect(phone.getByRole("button", { name: "Cancel Knight", exact: true })).toBeEnabled();

  game.phase = { type: "actions" };
  game.canCancelKnight = false;
  player.developmentCards = (["knight", "victory-point", "road-building", "year-of-plenty", "monopoly", "knight"] as const)
    .map((kind, index) => ({ id: `development-${index}`, kind, purchasedTurn: index === 0 ? game.turnNumber : 1 }));
  snapshot.privateScore = 1;
  await present();
  await expect(instructions.getByRole("heading", { name: "Make your next move.", exact: true })).toBeVisible();
  await expect(developmentHand.getByRole("listitem")).toHaveCount(5);
  await expect(developmentHand.getByRole("button", { name: /^Knight/ })).toContainText("2 cards");
  await expect(developmentHand).toContainText("Only played Knights count toward Largest Army");

  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1440, height: 900 }]) {
    await phone.setViewportSize(viewport);
    await privateScreenFits(phone);
    expect((await phone.locator(".private-hand .hand-resources h2").boundingBox())!.width).toBeGreaterThan(30);
    expect(await developmentHand.getByRole("list").evaluate(element => element.clientHeight >= 44 && element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await phone.locator(".private-instructions .turn-title, .private-instructions .turn-description, .private-turn .roll-summary-content").evaluateAll(elements => elements.every(element => element.scrollHeight <= element.clientHeight))).toBe(true);
    await screenshot(phone, testInfo, `private-development-list-${viewport.width}-${viewport.height}`);
  }
  await phone.setViewportSize({ width: 320, height: 568 });
  expect(await phone.locator(".private-hand").evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  for (const name of ["Knight", "Victory point", "Road building", "Year of plenty", "Monopoly"]) {
    await developmentHand.getByRole("button", { name: new RegExp(`^${name}`) }).click();
    const inspector = phone.getByRole("dialog", { name: "A card up your sleeve", exact: true });
    const selected = inspector.getByRole("button", { name: new RegExp(`^${name}`), pressed: true });
    await expect(selected).toHaveCount(1);
    if (name === "Knight") {
      await expect(inspector.getByRole("button", { name: /^Knight/ }).last()).toHaveAttribute("aria-pressed", "true");
      await expect(inspector.getByRole("button", { name: "Confirm Knight", exact: true })).toBeEnabled();
    }
    if (name === "Victory point") await expect(inspector.getByRole("button", { name: /^Confirm / })).toHaveCount(0);
    await inspector.getByRole("button", { name: "Close dialog", exact: true }).click();
    await privateScreenFits(phone);
  }
  expect(await phone.locator(".private-hand").evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  player.developmentCards = [];
  snapshot.privateScore = 0;
  await present();
  await expect(developmentHand).toHaveCount(0);
  await privateScreenFits(phone);
});

test("private dialogs keep development cards, discards, theft and trades accessible without page scrolling", async ({ multiplayer }, testInfo) => {
  const { phone, snapshot, present } = await privateDialogFixture(multiplayer);
  const player = snapshot.privatePlayer!;
  const game = snapshot.game!;
  const opponent = game.players.find(other => other.id !== player.id)!;
  player.developmentCards = (["knight", "victory-point", "road-building", "year-of-plenty", "monopoly", "knight"] as const)
    .map((kind, index) => ({ id: `development-${index}`, kind, purchasedTurn: index === 5 ? game.turnNumber : 1 }));
  game.bank.ore = 0;

  await present();
  await privateScreenFits(phone);
  await phone.getByRole("region", { name: "Your development cards", exact: true }).getByRole("button", { name: /^Knight/ }).click();
  const cards = phone.getByRole("dialog", { name: "A card up your sleeve", exact: true });
  await expect(cards.getByRole("button", { name: /^Knight/ })).toHaveCount(2);
  expect(await cards.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  await cards.getByRole("button", { name: /^Victory point/ }).click();
  await expect(cards.getByRole("button", { name: /^Victory point/ })).toHaveAttribute("aria-pressed", "true");
  await expect(cards).toContainText("Counted automatically toward your ten points");
  await expect(cards.getByRole("button", { name: /^Confirm / })).toHaveCount(0);
  await expect(cards.getByRole("region", { name: "Your current resources" })).toHaveCount(0);
  await cards.getByRole("button", { name: /^Knight/ }).first().click();
  await expect(cards.getByRole("button", { name: "Confirm Knight", exact: true })).toBeEnabled();
  await expect(cards).toContainText("Only played Knights count toward Largest Army");
  await cards.getByRole("button", { name: /^Knight/ }).last().click();
  await expect(cards.getByRole("button", { name: "Confirm Knight", exact: true })).toBeDisabled();
  await cards.getByRole("button", { name: /^Road building/ }).click();
  await expect(cards.getByRole("button", { name: "Confirm Road building", exact: true })).toBeEnabled();
  await cards.getByRole("button", { name: /^Year of plenty/ }).click();
  await expectInventory(cards, player.resources);
  await expect(cards.getByRole("button", { name: "Confirm Year of plenty", exact: true })).toBeDisabled();
  await expect(cards.getByRole("button", { name: "Add Ore to Take from the bank", exact: true })).toBeDisabled();
  await cards.getByRole("button", { name: "Add Wood to Take from the bank", exact: true }).click({ clickCount: 2 });
  await expect(cards.getByRole("button", { name: "Confirm Year of plenty", exact: true })).toBeEnabled();
  await cards.getByRole("button", { name: /^Monopoly/ }).click();
  await expectInventory(cards, player.resources);
  await cards.getByRole("combobox", { name: "Claim every card of this resource" }).selectOption("grain");
  await expect(cards.getByRole("button", { name: "Confirm Monopoly", exact: true })).toBeEnabled();
  await noHorizontalOverflow(phone);
  await screenshot(phone, testInfo, "private-development-dialog");
  await present();
  await expect(cards.getByRole("button", { name: "Confirm Monopoly", exact: true })).toBeDisabled();
  await expect(cards.getByRole("alert")).toContainText("The game changed");
  await cards.getByRole("button", { name: "Close dialog", exact: true }).click();

  await phone.getByRole("button", { name: "Make a trade", exact: true }).click();
  const trade = phone.getByRole("dialog", { name: "A fair exchange", exact: true });
  await expect(trade.getByRole("button", { name: "Bank & ports", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(trade.getByRole("region", { name: "Your current resources" })).toHaveCount(0);
  await expect(trade.getByRole("button", { name: "Give Wood", exact: true })).toHaveAccessibleDescription("In hand: 5. 4:1");
  await expect(trade.getByRole("button", { name: "Give Brick", exact: true })).toBeDisabled();
  await expect(trade.getByRole("button", { name: "Receive Ore", exact: true })).toBeDisabled();
  await trade.getByRole("button", { name: "Receive Brick", exact: true }).click();
  await expect(trade.getByRole("status", { name: "Hand after exchange", exact: true })).toHaveText("After exchange: 1 Wood, 1 Brick in your hand. Other cards stay the same.");
  await expect(trade.getByRole("button", { name: "Confirm exchange", exact: true })).toBeEnabled();
  await trade.getByRole("button", { name: "Bank & ports", exact: true }).scrollIntoViewIfNeeded();
  await noHorizontalOverflow(phone);
  await screenshot(phone, testInfo, "private-bank-selectors-320");
  await phone.setViewportSize({ width: 1440, height: 900 });
  await noHorizontalOverflow(phone);
  await screenshot(phone, testInfo, "private-bank-dialog-desktop");
  await phone.setViewportSize({ width: 320, height: 568 });
  await trade.getByRole("button", { name: "Receive Wood", exact: true }).click();
  await expect(trade.getByRole("button", { name: "Confirm exchange", exact: true })).toBeDisabled();
  await trade.getByRole("button", { name: "Player trade", exact: true }).click();
  await expectInventory(trade, player.resources);
  await expect(trade.getByRole("button", { name: "Request cards", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(trade.getByRole("group", { name: "You offer", exact: true })).toHaveCount(0);
  await expect(trade.getByRole("button", { name: "Ask for these cards", exact: true })).toBeDisabled();
  await trade.getByRole("button", { name: "Add Wood to You ask for", exact: true }).click();
  await expect(trade.getByRole("button", { name: "Ask for these cards", exact: true })).toBeEnabled();
  await trade.getByRole("button", { name: "Exact offer", exact: true }).click();
  const offer = trade.getByRole("button", { name: "Put the offer on the table", exact: true });
  await expect(offer).toBeDisabled();
  await expect(trade.getByRole("button", { name: "Add Brick to You offer", exact: true })).toBeDisabled();
  await trade.getByRole("button", { name: "Add Wood to You offer", exact: true }).click();
  await expect(offer).toBeDisabled();
  await trade.getByRole("button", { name: "Remove Wood from You ask for", exact: true }).click();
  await trade.getByRole("button", { name: "Add Ore to You ask for", exact: true }).click();
  await expect(offer).toBeEnabled();
  await noHorizontalOverflow(phone);
  await screenshot(phone, testInfo, "private-trade-editor");
  await present();
  await expect(offer).toBeDisabled();
  await expect(trade.getByRole("alert")).toContainText("The game changed");
  await trade.getByRole("button", { name: "Close dialog", exact: true }).click();

  await phone.getByRole("button", { name: "Buy a card", exact: true }).click();
  const buy = phone.getByRole("dialog", { name: "Invest in a development card", exact: true });
  await expectInventory(buy, player.resources);
  await expect(buy.locator(".eyebrow")).toHaveText(player.name);
  await expect(buy).toContainText("Pay one wool, one grain, and one ore");
  expect(await sentActions(phone)).toEqual([]);
  await buy.getByRole("button", { name: "Cancel", exact: true }).click();
  await phone.getByRole("button", { name: "Buy a card", exact: true }).click();
  await buy.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect.poll(() => sentActions(phone)).toEqual([expect.objectContaining({ version: snapshot.version, action: { type: "buy-development" } })]);
  await expect(phone.getByRole("alert")).toContainText("The game changed");

  game.phase = { type: "discard", required: { [player.id]: 2 } };
  await present();
  const discard = phone.getByRole("dialog", { name: "Discard 2 cards", exact: true });
  await expectInventory(discard, player.resources);
  await expect(discard).toContainText("Selected 0 of 2");
  await expect(discard).toContainText("20 cards left");
  await expect(discard.getByRole("button", { name: "Confirm discard", exact: true })).toBeDisabled();
  await expect(discard.getByRole("button", { name: "Add Brick to Return to the bank", exact: true })).toBeDisabled();
  await discard.getByRole("button", { name: "Add Wood to Return to the bank", exact: true }).click({ clickCount: 2 });
  await expect(discard.getByRole("button", { name: "Confirm discard", exact: true })).toBeEnabled();
  await expect(discard).toContainText("18 cards left");
  await noHorizontalOverflow(phone);
  await screenshot(phone, testInfo, "private-discard-dialog");
  await discard.getByRole("button", { name: "Close dialog", exact: true }).click();
  await privateScreenFits(phone);
  await phone.getByRole("button", { name: "Discard 2", exact: true }).click();
  await expect(discard).toContainText("Selected 2 of 2");

  opponent.resourceCount = 3;
  game.phase = { type: "steal", victimIds: [opponent.id], returnPhase: "actions" };
  await present();
  await expect(discard).toHaveCount(0);
  const theft = phone.getByRole("dialog", { name: "Choose a player to steal from", exact: true });
  const victim = theft.getByRole("button", { name: `${game.players.findIndex(other => other.id === opponent.id) + 1} ${opponent.name} 3 resources`, exact: true });
  await victim.click();
  const confirmTheft = phone.getByRole("dialog", { name: "Confirm theft", exact: true });
  await expect(confirmTheft).toContainText(`Steal one random resource from ${opponent.name}.`);
  await expect(confirmTheft.getByRole("region", { name: "Your current resources" })).toHaveCount(0);
  expect(await sentActions(phone)).toHaveLength(1);
  await confirmTheft.getByRole("button", { name: "Cancel", exact: true }).click();
  await theft.getByRole("button", { name: "Close dialog", exact: true }).click();
  await privateScreenFits(phone);
  await phone.getByRole("button", { name: "Choose player", exact: true }).click();
  await victim.click();
  await noHorizontalOverflow(phone);
  await screenshot(phone, testInfo, "private-theft-confirmation");
  await confirmTheft.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect.poll(async () => (await sentActions(phone)).at(-1)).toMatchObject({ version: snapshot.version, action: { type: "steal", playerId: opponent.id } });
  await expect(phone.getByRole("alert")).toContainText("The game changed");

  game.phase = { type: "finished" };
  game.winnerId = opponent.id;
  const winner = game.players.find(player => player.id === opponent.id)!;
  winner.score = 12;
  winner.scoreBreakdown = { public: 11, total: 12, settlements: 2, cities: 4, longestRoad: 2, largestArmy: 1, islands: 2, hidden: 1 };
  await present();
  // No gameplay dialog blocks the finished game; the victory pops up over the phone instead.
  await expect(phone.locator("dialog")).toHaveCount(0);
  await expect(phone.getByTestId("game-phase")).toContainText(`${opponent.name} wins!`);
  const victory = phone.getByRole("dialog", { name: `${opponent.name} takes the island.`, exact: true });
  await expect(victory).toBeVisible();
  await expect(victory).toContainText("12");
  await expect(victory.locator("dd")).toHaveText(["2", "4", "2", "1", "2", "1"]);
  await expect(victory.locator("dl > div svg")).toHaveCount(6);
  const islandRow = victory.locator("dl > div").filter({ hasText: "Island bonuses" });
  await expect(islandRow.locator("dd")).toHaveText("2");
  await expect(islandRow.locator("dt")).toContainText("1 × 2 VP");
  await expect(islandRow.locator(".victory-chip")).toHaveClass(/text-\[#b58a2d\]/);
  await expect(victory).toContainText("2 × 1 VP");
  await expect(victory).toContainText("2 × 2 VP");
  await expect(victory).toContainText("1 × 1 VP");
  await expect(victory.locator(".confetti-piece")).toHaveCount(28);
  await expect(victory.getByRole("button", { name: "Leave room", exact: true })).toBeVisible();
  // The gold exit leads as a full-width bar and the lone quiet exit spans its own full-width row below.
  const victoryActions = victory.locator(".victory-actions");
  const victoryActionsBox = (await victoryActions.boundingBox())!;
  const leaveRoomBox = (await victory.getByRole("button", { name: "Leave room", exact: true }).boundingBox())!;
  const viewIslandBox = (await victory.getByRole("button", { name: "View the island", exact: true }).boundingBox())!;
  expect(leaveRoomBox.width).toBeCloseTo(victoryActionsBox.width, 0);
  expect(viewIslandBox.width, "View the island fills its row instead of collapsing into the corner").toBeCloseTo(victoryActionsBox.width, 0);
  expect(viewIslandBox.y).toBeGreaterThan(leaveRoomBox.y);
  await noHorizontalOverflow(phone);
  await screenshot(phone, testInfo, "victory-popup-phone");
  await victory.getByRole("button", { name: "View the island", exact: true }).click();
  await expect(victory).toHaveCount(0);
  await expect(phone.getByTestId("game-phase")).toContainText(`${opponent.name} wins!`);
  await privateScreenFits(phone);
});

test("declining a computer trade request identifies the open trade and survives newer same-trade snapshots", async ({ multiplayer }, testInfo) => {
  const { phone, snapshot, present } = await privateDialogFixture(multiplayer);
  const game = snapshot.game!;
  const requester = game.players.find(other => other.control === "computer")!;
  const responder = game.players.find(other => other.control === "computer" && other.id !== requester.id)!;
  game.activePlayerId = requester.id;
  game.phase = { type: "actions" };
  game.trade = { offeredBy: requester.id, give: null, receive: { ...emptyResources(), ore: 1 }, responses: {} };
  await present();
  const request = phone.getByRole("dialog", { name: "Trade request", exact: true });
  await expect(request).toBeVisible();
  await expect(request.getByText(`From ${requester.name}`, { exact: true })).toBeVisible();
  // The other computer answers while this phone still shows the earlier snapshot: same trade, newer version.
  game.trade!.responses[responder.id] = false;
  await present();
  await expect(request).toBeVisible();
  const decline = request.getByRole("button", { name: "Decline", exact: true });
  await expect(decline).toBeEnabled();
  await decline.click();
  // The decline travels with the viewed trade's identity so the host can accept it despite the version bump.
  await expect.poll(() => sentActions(phone)).toEqual([expect.objectContaining({
    version: snapshot.version,
    action: { type: "respond-trade", accept: false },
    trade: { offeredBy: requester.id, give: null, receive: { ...emptyResources(), ore: 1 } },
  })]);
  await expect(request).toHaveCount(0);
});

test("dismissed mandatory private dialogs stay reachable while builds are collapsed", async ({ multiplayer }, testInfo) => {
  const { phone, snapshot, present } = await privateDialogFixture(multiplayer);
  const player = snapshot.privatePlayer!;
  const game = snapshot.game!;
  const opponent = game.players.find(other => other.id !== player.id)!;
  const buildDisclosure = phone.getByRole("button", { name: "Build a little bigger", exact: true });
  // Cross-device hands start with the build section expanded; collapse it to
  // verify the mandatory-dialog reentry buttons while builds are hidden.
  await expect(buildDisclosure).toHaveAttribute("aria-expanded", "true");
  await buildDisclosure.click();

  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }]) {
    await phone.setViewportSize(viewport);
    await expect(buildDisclosure).toHaveAttribute("aria-expanded", "false");
    await expect(phone.getByRole("button", { name: "Buy a card", exact: true })).toHaveCount(0);
    await expect(phone.getByRole("button", { name: "Make a trade", exact: true })).toHaveCount(0);

    game.phase = { type: "discard", required: { [player.id]: 2 } };
    game.trade = null;
    await present();
    const discard = phone.getByRole("dialog", { name: "Discard 2 cards", exact: true });
    await expect(discard).toBeVisible();
    await discard.getByRole("button", { name: "Close dialog", exact: true }).click();
    const discardReentry = phone.getByRole("button", { name: "Discard 2", exact: true });
    await expect(discardReentry).toBeInViewport();
    await discardReentry.click();
    await expect(discard).toBeVisible();
    await discard.getByRole("button", { name: "Close dialog", exact: true }).click();

    game.phase = { type: "steal", victimIds: [opponent.id], returnPhase: "actions" };
    await present();
    const theft = phone.getByRole("dialog", { name: "Choose a player to steal from", exact: true });
    await expect(theft).toBeVisible();
    await theft.getByRole("button", { name: "Close dialog", exact: true }).click();
    const stealReentry = phone.getByRole("button", { name: "Choose player", exact: true });
    await expect(stealReentry).toBeInViewport();
    await stealReentry.click();
    await expect(theft).toBeVisible();
    await theft.getByRole("button", { name: "Close dialog", exact: true }).click();

    game.phase = { type: "actions" };
    game.trade = { offeredBy: opponent.id, give: { ...emptyResources(), wood: 1 }, receive: { ...emptyResources(), ore: 1 }, responses: {} };
    await present();
    const offer = phone.getByRole("dialog", { name: "Trade offer", exact: true });
    await expect(offer).toBeVisible();
    await offer.getByRole("button", { name: "Close dialog", exact: true }).click();
    const tradeReentry = phone.getByRole("button", { name: "View trade", exact: true });
    await expect(tradeReentry).toBeInViewport();
    await tradeReentry.click();
    await expect(offer).toBeVisible();
    await offer.getByRole("button", { name: "Close dialog", exact: true }).click();
    await expect(buildDisclosure).toHaveAttribute("aria-expanded", "false");
    await screenshot(phone, testInfo, `private-mandatory-reentry-${viewport.width}`);
    await noHorizontalOverflow(phone);
  }
});

test("private phones keep the turn and dice panel in view while the hand scrolls", async ({ multiplayer }, testInfo) => {
  const { phone, snapshot, present } = await privateDialogFixture(multiplayer);
  snapshot.privatePlayer!.developmentCards = (["knight", "victory-point", "road-building", "year-of-plenty", "monopoly"] as const).map((kind, index) => ({ id: `development-${index}`, kind, purchasedTurn: 1 }));
  snapshot.game!.phase = { type: "roll" };
  await present();
  const hand = phone.locator(".private-hand");
  const turnControls = phone.getByRole("region", { name: "Turn controls", exact: true });
  const rollButton = phone.getByRole("button", { name: "Roll the dice", exact: true });

  for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
    await phone.setViewportSize(viewport);
    await expect(rollButton).toBeVisible();
    await expect(hand).toHaveCSS("scrollbar-width", "none");
    await expect(phone.locator(".private-dashboard")).toHaveCSS("scrollbar-width", "none");
    expect(await hand.evaluate(element => element.scrollHeight)).toBeGreaterThan(await hand.evaluate(element => element.clientHeight));
    await hand.evaluate(element => { element.scrollTop = element.scrollHeight; });
    expect(await hand.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    await expect(turnControls).toBeInViewport({ ratio: 1 });
    await expect(rollButton).toBeInViewport({ ratio: 1 });
    await hand.evaluate(element => { element.scrollTop = 0; });
    await expect(turnControls).toBeInViewport({ ratio: 1 });
    await expect(rollButton).toBeInViewport({ ratio: 1 });
    await noHorizontalOverflow(phone);
    await screenshot(phone, testInfo, `private-pinned-turn-${viewport.width}`);
  }
});

test("private trade responses preserve drafts and confirmations across version changes", async ({ multiplayer }, testInfo) => {
  const { phone, snapshot, present } = await privateDialogFixture(multiplayer);
  const player = snapshot.privatePlayer!;
  const game = snapshot.game!;
  const [opponent, otherOpponent] = game.players.filter(other => other.id !== player.id);
  game.trade = { offeredBy: player.id, give: null, receive: { ...emptyResources(), ore: 1 }, responses: { [otherOpponent!.id]: false } };
  await present();
  const request = phone.getByRole("dialog", { name: "Trade request", exact: true });
  const response = request.getByRole("group", { name: `${opponent!.name}'s trade response`, exact: true });
  const otherResponse = request.getByRole("group", { name: `${otherOpponent!.name}'s trade response`, exact: true });
  await expectInventory(request, player.resources);
  await expect(response).toContainText("not answered");
  await expect(otherResponse).toContainText("declined");
  await expect(request.getByRole("button", { name: "Withdraw request", exact: true })).toBeEnabled();
  game.trade.responses = { [opponent!.id]: { ...emptyResources(), wood: 2 }, [otherOpponent!.id]: { ...emptyResources(), wood: 7, brick: 1 } };
  await present();
  await expect(response.getByRole("img", { name: "You give: 2 Wood", exact: true })).toBeVisible();
  await expect(otherResponse.getByRole("button", { name: "Complete trade", exact: true })).toBeDisabled();
  await expect(otherResponse.getByRole("button", { name: "Complete trade", exact: true })).toHaveAccessibleDescription("Missing 2 Wood, 1 Brick");
  const original = structuredClone(game.trade);
  const originalResponses = await request.getByRole("group", { name: /'s trade response$/ }).allTextContents();
  await request.getByRole("button", { name: "Change offer", exact: true }).click();
  const editor = phone.getByRole("dialog", { name: "A fair exchange", exact: true });
  await expect(editor.getByRole("button", { name: "Player trade", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(editor.getByRole("button", { name: "Exact offer", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(editor.getByRole("group", { name: "You ask for", exact: true }).getByRole("status", { name: "Ore selected", exact: true })).toHaveText("1");
  await editor.getByRole("button", { name: "Add Wood to You offer", exact: true }).click();
  await editor.getByRole("button", { name: "Add Brick to You ask for", exact: true }).click();
  await phone.keyboard.press("Escape");
  await expect(request.getByRole("group", { name: /'s trade response$/ })).toHaveText(originalResponses);
  expect((await latestSnapshot(phone)).game!.trade).toEqual(original);
  await request.getByRole("button", { name: "Change offer", exact: true }).click();
  await expect(editor.getByRole("group", { name: "You offer", exact: true }).getByRole("status", { name: "Wood selected", exact: true })).toHaveText("0");
  await editor.getByRole("button", { name: "Close dialog", exact: true }).click();

  const complete = response.getByRole("button", { name: "Complete trade", exact: true });
  await complete.click();
  const confirmation = phone.getByRole("dialog", { name: `Trade with ${opponent!.name}`, exact: true });
  await expectInventory(confirmation, player.resources);
  await expect(confirmation.getByRole("img", { name: "You give: 2 Wood", exact: true })).toBeVisible();
  await expect(confirmation.getByRole("img", { name: "You receive: 1 Ore", exact: true })).toBeVisible();
  await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(request.getByRole("group", { name: /'s trade response$/ })).toHaveText(originalResponses);
  expect((await latestSnapshot(phone)).game!.trade).toEqual(original);
  await complete.click();
  game.trade.responses[otherOpponent!.id] = false;
  await present();
  await expect(confirmation.getByRole("button", { name: "Confirm", exact: true })).toBeDisabled();
  await expect(confirmation.getByRole("alert")).toContainText("The game changed");
  await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
  await noHorizontalOverflow(phone);
  await screenshot(phone, testInfo, "private-trade-responses");

  game.trade.give = { ...emptyResources(), wood: 2 };
  await present();
  const offer = phone.getByRole("dialog", { name: "Trade offer", exact: true });
  await expect(offer.getByRole("group", { name: `${opponent!.name}'s trade response`, exact: true })).toContainText("accepted");
  await expect(offer.getByRole("button", { name: "Withdraw offer", exact: true })).toBeEnabled();
  await offer.getByRole("button", { name: "Close dialog", exact: true }).click();
  await privateScreenFits(phone);

  game.activePlayerId = opponent!.id;
  game.trade = { offeredBy: opponent!.id, give: { ...emptyResources(), brick: 1 }, receive: { ...emptyResources(), wood: 6 }, responses: {} };
  await present();
  await expect(offer.getByRole("button", { name: "Accept offer", exact: true })).toBeDisabled();
  await expect(offer.getByRole("button", { name: "Decline", exact: true })).toBeEnabled();
  // The hand holds five Wood, so the six requested Wood cards stay sharp but dimmed.
  const unavailableWood = offer.getByRole("img", { name: "You give: 6 Wood", exact: true }).locator(".resource-card");
  await expect(unavailableWood).toHaveCSS("filter", "none");
  await expect(unavailableWood).toHaveCSS("opacity", "0.5");
  game.trade.receive.wood = 1;
  await present();
  await expect(offer.getByRole("button", { name: "Accept offer", exact: true })).toBeEnabled();
  const availableWood = offer.getByRole("img", { name: "You give: 1 Wood", exact: true }).locator(".resource-card");
  await expect(availableWood).toHaveCSS("filter", "none");
  await expect(availableWood).toHaveCSS("opacity", "1");
  game.trade.give = null;
  game.trade.expiresAt = Date.now() + 15_000;
  await present();
  const propose = request.getByRole("button", { name: "Propose price", exact: true });
  await expect(request.getByText("Computer players wait up to 15 seconds for prices.", { exact: true })).toBeVisible();
  await expectInventory(request, player.resources);
  await expect(propose).toBeDisabled();
  await request.getByRole("button", { name: "Add Wood to You want in return", exact: true }).click();
  await expect(propose).toBeDisabled();
  await request.getByRole("button", { name: "Remove Wood from You want in return", exact: true }).click();
  await request.getByRole("button", { name: "Add Ore to You want in return", exact: true }).click();
  await expect(propose).toBeEnabled();
  await present();
  await expect(propose).toBeDisabled();
  await expect(request.getByRole("status", { name: "Ore selected", exact: true })).toHaveText("1");
  await expect(request.getByRole("alert")).toContainText("The game changed");
  expect(await sentActions(phone)).toEqual([]);
  await request.getByRole("button", { name: "Close dialog", exact: true }).click();
  await phone.getByRole("button", { name: "View trade", exact: true }).click();
  await expect(request.getByRole("status", { name: "Ore selected", exact: true })).toHaveText("0");
  await request.getByRole("button", { name: "Add Ore to You want in return", exact: true }).click();
  await noHorizontalOverflow(phone);
  await screenshot(phone, testInfo, "private-trade-price");
  await propose.click();
  await expect.poll(() => sentActions(phone)).toEqual([expect.objectContaining({ version: snapshot.version, action: { type: "propose-trade", price: { ...emptyResources(), ore: 1 } } })]);
  await expect(phone.getByRole("alert")).toContainText("The game changed");
  game.trade = null;
  await present();
  await expect(request).toHaveCount(0);
});

test("bank, exact offers and negotiated prices exchange real hands only after confirmation", async ({ multiplayer }, testInfo) => {
  const host = await multiplayer.newPage("Host");
  await host.addInitScript(() => {
    let seed = 1;
    Object.defineProperty(crypto, "getRandomValues", { configurable: true, value: (values: Uint32Array) => {
      for (let index = 0; index < values.length; index++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        values[index] = seed;
      }
      return values;
    } });
  });
  const invitation = await hostGame(host);
  const phones = new Map<string, Page>();
  for (const name of ["Alex", "Sam", "Taylor"]) {
    const phone = await multiplayer.newPage(name);
    await phone.emulateMedia({ reducedMotion: "reduce" });
    phones.set(name, phone);
    await requestSeat(phone, invitation, name);
    await host.getByRole("button", { name: `Admit ${name}`, exact: true }).click();
  }
  await host.getByRole("button", { name: "Start game", exact: true }).click();
  for (let placement = 0; placement < 6; placement++) {
    await host.getByRole("button", { name: /^Place settlement at / }).first().click();
    await host.getByRole("button", { name: "Confirm placement", exact: true }).click();
    await host.getByRole("button", { name: /^Build road at / }).first().click();
    await host.getByRole("button", { name: "Confirm placement", exact: true }).click();
  }
  await expect(host.getByTestId("game-phase")).toHaveAttribute("data-phase", "roll");
  const activeName = (await host.getByTestId("game-phase").getAttribute("data-active-player"))!;
  const activePhone = phones.get(activeName)!;
  await expect(activePhone.getByRole("button", { name: "Roll the dice", exact: true })).toBeEnabled();
  const setup = await latestSnapshot(activePhone);
  const productionTile = setup.game!.board.tiles.find(tile => tile.terrain !== "desert" && tile.vertexIds.some(vertexId =>
    setup.game!.board.vertices.find(vertex => vertex.id === vertexId)?.building?.playerId === setup.playerId))!;
  const give = RESOURCES.find(resource => resource === productionTile.terrain)!;
  const firstDie = Math.max(1, productionTile.number! - 6);
  // Control only browser entropy: normal setup and production fund the real engine's hands.
  await host.evaluate(dice => {
    let index = 0;
    Object.defineProperty(crypto, "getRandomValues", { configurable: true, value: (values: Uint32Array) => {
      for (let position = 0; position < values.length; position++) values[position] = Math.floor(((dice[index++ % 2]! - 0.5) / 6) * 0x100000000);
      return values;
    } });
  }, [firstDie, productionTile.number! - firstDie]);
  for (let turn = 0; turn < 7; turn++) {
    const name = (await host.getByTestId("game-phase").getAttribute("data-active-player"))!;
    const currentPhone = phones.get(name)!;
    await currentPhone.getByRole("button", { name: "Roll the dice", exact: true }).click();
    await expectPhase([host, ...phones.values()], "actions", name);
    const snapshot = await latestSnapshot(activePhone);
    if (name === activeName && snapshot.privatePlayer!.resources[give] >= getTradeRatio(snapshot.game!, snapshot.playerId!, give)) break;
    await currentPhone.getByRole("button", { name: "End turn", exact: true }).click();
    await expect(host.getByTestId("game-phase")).toHaveAttribute("data-phase", "roll");
  }
  const beforeBank = await latestSnapshot(activePhone);
  expect(beforeBank.game!.activePlayerId).toBe(beforeBank.playerId);
  const ratio = getTradeRatio(beforeBank.game!, beforeBank.playerId!, give);
  expect(beforeBank.privatePlayer!.resources[give]).toBeGreaterThanOrEqual(ratio);
  const receive = RESOURCES.find(resource => resource !== give && beforeBank.game!.bank[resource] > 0)!;
  const buildToggle = activePhone.getByRole("button", { name: "Build a little bigger", exact: true });
  if (await buildToggle.getAttribute("aria-expanded") === "false") await buildToggle.click();
  await activePhone.getByRole("button", { name: "Make a trade", exact: true }).click();
  const editor = activePhone.getByRole("dialog", { name: "A fair exchange", exact: true });
  await editor.getByRole("button", { name: `Give ${RESOURCE_NAMES[give]}`, exact: true }).click();
  await editor.getByRole("button", { name: `Receive ${RESOURCE_NAMES[receive]}`, exact: true }).click();
  const bankHand = { ...beforeBank.privatePlayer!.resources, [give]: beforeBank.privatePlayer!.resources[give] - ratio, [receive]: beforeBank.privatePlayer!.resources[receive] + 1 };
  const bank = { ...beforeBank.game!.bank, [give]: beforeBank.game!.bank[give] + ratio, [receive]: beforeBank.game!.bank[receive] - 1 };
  await expect(editor.getByRole("status", { name: "Hand after exchange", exact: true })).toContainText(`After exchange: ${bankHand[give]} ${RESOURCE_NAMES[give]}, ${bankHand[receive]} ${RESOURCE_NAMES[receive]}`);
  expect((await latestSnapshot(activePhone)).privatePlayer!.resources).toEqual(beforeBank.privatePlayer!.resources);
  await editor.getByRole("button", { name: "Confirm exchange", exact: true }).click();
  await expect.poll(async () => (await latestSnapshot(activePhone)).privatePlayer!.resources).toEqual(bankHand);
  expect((await latestSnapshot(activePhone)).game!.bank).toEqual(bank);

  const responderPhone = [...phones.values()].find(phone => phone !== activePhone)!;
  const responder = (await latestSnapshot(responderPhone)).privatePlayer!;
  const payment = RESOURCES.find(resource => resource !== receive && responder.resources[resource] > 0)!;
  expect(payment).toBeTruthy();
  await activePhone.getByRole("button", { name: "Make a trade", exact: true }).click();
  await editor.getByRole("button", { name: "Player trade", exact: true }).click();
  await editor.getByRole("button", { name: "Exact offer", exact: true }).click();
  await editor.getByRole("button", { name: `Add ${RESOURCE_NAMES[receive]} to You offer`, exact: true }).click();
  await editor.getByRole("button", { name: `Add ${RESOURCE_NAMES[payment]} to You ask for`, exact: true }).click();
  await editor.getByRole("button", { name: "Put the offer on the table", exact: true }).click();
  const offer = activePhone.getByRole("dialog", { name: "Trade offer", exact: true });
  await responderPhone.getByRole("dialog", { name: "Trade offer", exact: true }).getByRole("button", { name: "Accept offer", exact: true }).click();
  const response = offer.getByRole("group", { name: `${responder.name}'s trade response`, exact: true });
  await expect(response).toContainText("accepted");
  const original = (await latestSnapshot(activePhone)).game!.trade;
  const complete = response.getByRole("button", { name: "Complete trade", exact: true });
  await complete.click();
  const confirmation = activePhone.getByRole("dialog", { name: `Trade with ${responder.name}`, exact: true });
  await expectInventory(confirmation, bankHand);
  expect((await latestSnapshot(activePhone)).privatePlayer!.resources).toEqual(bankHand);
  expect((await latestSnapshot(responderPhone)).privatePlayer!.resources).toEqual(responder.resources);
  await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
  expect((await latestSnapshot(activePhone)).game!.trade).toEqual(original);
  await complete.click();
  await noHorizontalOverflow(activePhone);
  await screenshot(activePhone, testInfo, "real-trade-confirmation");
  await confirmation.getByRole("button", { name: "Confirm", exact: true }).click();
  const exchangedHand = { ...bankHand, [receive]: bankHand[receive] - 1, [payment]: bankHand[payment] + 1 };
  const exchangedResponder = { ...responder.resources, [receive]: responder.resources[receive] + 1, [payment]: responder.resources[payment] - 1 };
  await expect.poll(async () => (await latestSnapshot(activePhone)).privatePlayer!.resources).toEqual(exchangedHand);
  await expect.poll(async () => (await latestSnapshot(responderPhone)).privatePlayer!.resources).toEqual(exchangedResponder);

  // Request the reverse exchange and negotiate its price through the same real channels.
  await activePhone.getByRole("button", { name: "Make a trade", exact: true }).click();
  await expect(editor.getByRole("button", { name: "Player trade", exact: true })).toHaveAttribute("aria-pressed", "true");
  await editor.getByRole("button", { name: `Add ${RESOURCE_NAMES[receive]} to You ask for`, exact: true }).click();
  await editor.getByRole("button", { name: "Ask for these cards", exact: true }).click();
  const request = responderPhone.getByRole("dialog", { name: "Trade request", exact: true });
  await request.getByRole("button", { name: `Add ${RESOURCE_NAMES[payment]} to You want in return`, exact: true }).click();
  await request.getByRole("button", { name: "Propose price", exact: true }).click();
  await activePhone.getByRole("dialog", { name: "Trade request", exact: true }).getByRole("group", { name: `${responder.name}'s trade response`, exact: true }).getByRole("button", { name: "Complete trade", exact: true }).click();
  expect((await latestSnapshot(activePhone)).privatePlayer!.resources).toEqual(exchangedHand);
  await confirmation.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect.poll(async () => (await latestSnapshot(activePhone)).privatePlayer!.resources).toEqual(bankHand);
  await expect.poll(async () => (await latestSnapshot(responderPhone)).privatePlayer!.resources).toEqual(responder.resources);
  for (const phone of phones.values()) {
    await expect.poll(async () => (await latestSnapshot(phone)).game!.trade).toBeNull();
    expect((await latestSnapshot(phone)).game!.bank).toEqual(bank);
    await expect(phone.getByRole("alert")).toHaveCount(0);
    await privateScreenFits(phone);
  }
});

for (const [stage, expectedError] of [
  ["answer", "Timed out waiting for the host's connection answer"],
  ["direct", "The host answered, but the direct WebRTC connection timed out"],
  ["state", "Connected to the host, but timed out waiting for the initial game state"],
] as const) {
  test(`connection timeout diagnostics distinguish ${stage} and clear on retry`, async ({ multiplayer }, testInfo) => {
    const host = await multiplayer.newPage("Host");
    const phone = await multiplayer.newPage("Alex");
    if (stage === "direct") {
      for (const page of [host, phone]) await page.addInitScript(() => {
        const nativeSetRemoteDescription = RTCPeerConnection.prototype.setRemoteDescription;
        RTCPeerConnection.prototype.setRemoteDescription = function (description) {
          return Reflect.apply(nativeSetRemoteDescription, this, [{ type: description.type, sdp: description.sdp?.replace(/^a=candidate:.*\r?\n/gm, "") }]);
        };
        RTCPeerConnection.prototype.addIceCandidate = async () => {};
      });
    }
    const invitation = await hostGame(host);
    let offerSent = false;
    if (stage === "answer") await phone.routeWebSocket(/\/peerjs\?/, route => {
      route.onMessage(message => { if (JSON.parse(message.toString()).type === "OFFER") offerSent = true; });
      route.send(JSON.stringify({ type: "OPEN" }));
    });
    if (stage === "state") await phone.addInitScript(() => {
      RTCDataChannel.prototype.send = function () {
        const probe = (window as unknown as ObservedWindow).multiplayerProbe;
        probe.blockedSends = (probe.blockedSends ?? 0) + 1;
      };
    });
    await phone.clock.install({ time: new Date("2030-01-01T00:00:00Z") });
    await phone.clock.pauseAt(new Date("2030-01-01T00:00:01Z"));
    await requestSeat(phone, invitation, "Alex");
    if (stage === "answer") await expect.poll(() => offerSent).toBe(true);
    else if (stage === "direct") await expect.poll(() => phone.evaluate(() =>
      (window as unknown as ObservedWindow).multiplayerProbe.connections.some(connection => connection.remoteDescription?.type === "answer"))).toBe(true);
    else await expect.poll(() => phone.evaluate(() => (window as unknown as ObservedWindow).multiplayerProbe.blockedSends ?? 0)).toBeGreaterThan(0);
    await phone.clock.runFor(15_000);
    const alert = phone.getByRole("alert");
    await expect(alert).toContainText(expectedError);
    await expect(alert).toContainText("Connection details: ICE");
    const parameters = new URLSearchParams(new URL(invitation).hash.slice(1));
    await expect(alert).not.toContainText(parameters.get("host")!);
    await expect(alert).not.toContainText(parameters.get("secret")!);
    await noHorizontalOverflow(phone);
    await screenshot(phone, testInfo, `connection-timeout-${stage}`);
    await phone.clock.runFor(2_000);
    await expect(alert).toHaveCount(0);
    await expect(phone.getByRole("status").filter({ hasText: "Private player screen" })).toContainText("Connecting to the host...");
  });
}

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
  await expect(host.getByRole("status").filter({ hasText: "seats filled" })).toContainText("Waiting for Alex to reconnect.");
  await phone.getByRole("button", { name: "Reconnect", exact: true }).click();
  await expect(phone.getByRole("alert")).toHaveCount(0);
  await expect(host.getByRole("button", { name: "Start game", exact: true })).toBeEnabled();
  expect((await latestSnapshot(phone)).playerId).toBe(originalSeat);
  await expect(host.getByRole("button", { name: /^Admit / })).toHaveCount(0);
  for (const page of [host, ...phones]) await expect(page.getByRole("list", { name: "Players", exact: true }).getByRole("listitem")).toHaveCount(3);
});
