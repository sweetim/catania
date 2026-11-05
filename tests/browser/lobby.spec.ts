import { type BrowserContext, type Page } from "@playwright/test";
import { expect, test as base } from "./fixtures";

type WireMessage = { direction: "sent" | "received"; message: Record<string, unknown> };
type BrowserProbe = { channels: RTCDataChannel[]; messages: WireMessage[] };
type ObservedWindow = Window & { lobbyTestProbe: BrowserProbe };
type Room = { inviteUrl: string; roomCode: string };
type SavedSeat = { credential: string; playerIdentifier: string; room: { roomIdentifier: string } };
type LobbyHarness = {
  origin: string;
  newPage: (viewport?: { width: number; height: number }, context?: BrowserContext) => Promise<Page>;
};

const desktop = { width: 1440, height: 900 };
const mobile = { width: 390, height: 844 };
const compact = { width: 320, height: 844 };

const test = base.extend<{ lobby: LobbyHarness }>({
  lobby: async ({ browser, request, baseURL }, use, testInfo) => {
    const response = await request.get("/api/config");
    expect(response.ok()).toBe(true);
    const configuration = await response.json() as { origins: string[]; configuredOrigin: string | null };
    const origin = configuration.configuredOrigin ?? configuration.origins[0];
    expect(origin, "The service must advertise a reachable LAN invitation origin").toBeTruthy();
    for (const address of configuration.origins) {
      expect(new URL(address).hostname).toMatch(/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/);
    }
    const allowedOrigins = new Set([new URL(baseURL!).origin, ...configuration.origins]);
    const contexts: BrowserContext[] = [];
    const pages: Page[] = [];
    const errors: string[] = [];
    const externalRequests: string[] = [];
    const navigationCancellations: string[] = [];
    const signaling: { direction: string; type: string }[] = [];

    function inspectAddress(address: string) {
      const url = new URL(address);
      if (url.protocol === "ws:") url.protocol = "http:";
      if (url.protocol === "wss:") url.protocol = "https:";
      if (!allowedOrigins.has(url.origin)) externalRequests.push(address);
    }

    async function newPage(viewport = desktop, existingContext?: BrowserContext) {
      const context = existingContext ?? await browser.newContext({ viewport });
      if (!existingContext) {
        contexts.push(context);
        await context.addInitScript(() => {
          const probe: BrowserProbe = { channels: [], messages: [] };
          (window as unknown as ObservedWindow).lobbyTestProbe = probe;
          const nativeSend = RTCDataChannel.prototype.send;
          // Observe native traffic without substituting transport, timing, or peer behavior.
          RTCDataChannel.prototype.send = function (this: RTCDataChannel, data: unknown) {
            const record = (direction: WireMessage["direction"], payload: unknown) => {
              if (typeof payload === "string") probe.messages.push({ direction, message: JSON.parse(payload) });
            };
            if (!probe.channels.includes(this)) {
              probe.channels.push(this);
              this.addEventListener("message", event => record("received", event.data));
            }
            const result = Reflect.apply(nativeSend, this, [data]);
            record("sent", data);
            return result;
          };
        });
        context.on("request", request => inspectAddress(request.url()));
        context.on("response", response => {
          if (response.status() >= 400) errors.push(`HTTP ${response.status()}: ${response.url()}`);
        });
        context.on("requestfailed", request => {
          const failure = `${request.failure()?.errorText}: ${request.url()}`;
          // Reload/pagehide intentionally abort navigation and the effect's configuration fetch.
          if (request.failure()?.errorText === "net::ERR_ABORTED"
            && (request.isNavigationRequest() || new URL(request.url()).pathname === "/api/config")) {
            navigationCancellations.push(failure);
          } else errors.push(failure);
        });
        context.on("page", page => {
          pages.push(page);
          page.on("console", message => {
            if (message.type() === "error") errors.push(`console: ${message.text()}`);
          });
          page.on("pageerror", error => errors.push(`pageerror: ${error.message}`));
          page.on("websocket", socket => {
            inspectAddress(socket.url());
            socket.on("socketerror", error => errors.push(`websocket: ${error}`));
            socket.on("framesent", frame => {
              const message = JSON.parse(frame.payload.toString()) as { type: string };
              signaling.push({ direction: "sent", type: message.type });
            });
            socket.on("framereceived", frame => {
              const message = JSON.parse(frame.payload.toString()) as { type: string };
              signaling.push({ direction: "received", type: message.type });
            });
          });
        });
      }
      return context.newPage();
    }

    try {
      await use({ origin: origin!, newPage });
    } finally {
      try {
        const messages = (await Promise.all(pages.filter(page => !page.isClosed()).map(readMessages))).flat();
        const snapshots = messages.filter(({ message }) => "snapshot" in message);
        for (const { message } of snapshots) {
          if (message.type === "snapshot") expect.soft(Object.keys(message).sort()).toEqual(["snapshot", "type"]);
          const snapshot = message.snapshot as Record<string, unknown> & { players: Record<string, unknown>[] };
          expect.soft(Object.keys(snapshot).sort()).toEqual(["canStart", "mode", "players", "roomIdentifier", "version"]);
          for (const player of snapshot.players) {
            expect.soft(Object.keys(player).sort()).toEqual(["color", "connected", "name", "organizer", "playerIdentifier", "ready"]);
          }
          expect.soft(JSON.stringify(snapshot)).not.toMatch(/reconnectCredential|credential|connectionIdentifier|private|actionResults/);
        }
        expect.soft(signaling.filter(message => ["action", "snapshot", "welcome", "authenticate"].includes(message.type))).toEqual([]);
        expect.soft(externalRequests, "Browser runtime traffic must remain on local application origins").toEqual([]);
        expect.soft(errors, "No unexplained browser, HTTP, or WebSocket errors").toEqual([]);
        await testInfo.attach("browser-diagnostics", {
          body: JSON.stringify({ errors, externalRequests, navigationCancellations, signaling, snapshotCount: snapshots.length }, null, 2),
          contentType: "application/json",
        });
      } finally {
        for (const context of contexts.reverse()) await context.close();
      }
    }
  },
});

async function readMessages(page: Page): Promise<WireMessage[]> {
  return page.evaluate(() => (window as unknown as ObservedWindow).lobbyTestProbe?.messages ?? []);
}

async function savedSeat(page: Page): Promise<SavedSeat> {
  return page.evaluate(() => {
    const roomIdentifier = new URL(location.href).searchParams.get("room");
    return JSON.parse(localStorage.getItem(`catania.seat.${roomIdentifier}`)!);
  });
}

function roster(page: Page) {
  return page.getByRole("list", { name: "Players", exact: true });
}

function playerRow(page: Page, name: string) {
  return roster(page).getByRole("listitem", { name, exact: true });
}

async function noHorizontalOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) <= window.innerWidth)).toBe(true);
}

async function createRoom(host: Page, origin: string, playing = false): Promise<Room> {
  await host.goto(origin);
  await host.getByRole("button", { name: "Create Game", exact: true }).click();
  await host.getByLabel("Local invitation address").selectOption(origin);
  if (playing) {
    await host.getByRole("radio", { name: /^Host & Play/ }).check();
    await host.getByLabel("Your name", { exact: true }).fill("Host");
    await host.getByRole("radio", { name: "Blue", exact: true }).check();
  } else {
    await expect(host.getByRole("radio", { name: /^Board-Only Display/ })).toBeChecked();
    await expect(host.getByLabel("Your name", { exact: true })).toHaveCount(0);
  }
  await host.getByRole("button", { name: "Create Room", exact: true }).click();
  await expect(host.getByRole("heading", { name: "The table is open.", exact: true })).toBeVisible();
  const inviteUrl = await host.getByLabel("Invite link", { exact: true }).inputValue();
  expect(new URL(inviteUrl).origin).toBe(origin);
  expect(new URL(inviteUrl).searchParams.get("invite")).toBeTruthy();
  const roomCode = await host.getByRole("status", { name: "Room code", exact: true }).innerText();
  expect(roomCode).toMatch(/^[A-Z2-9]{6}$/);
  return { inviteUrl, roomCode };
}

async function requestSeat(player: Page, room: Room, name: string, color: string, viaCode = false) {
  if (viaCode) {
    await player.goto(new URL(room.inviteUrl).origin);
    await player.getByRole("button", { name: "Join Game", exact: true }).click();
    await player.getByLabel("Room code", { exact: true }).fill(room.roomCode);
  } else {
    // Do not rewrite the advertised URL to localhost: exercise its actual network interface.
    await player.goto(room.inviteUrl);
    await expect(player.getByText("Room invite opened. Choose your identity below.", { exact: true })).toBeVisible();
  }
  await player.getByLabel("Your name", { exact: true }).fill(name);
  await player.getByRole("radio", { name: color, exact: true }).check();
  await player.getByRole("button", { name: "Request to Join", exact: true }).click();
  await expect(player.getByText("Waiting for host approval", { exact: true })).toBeVisible();
  await expect(player.getByRole("button", { name: "Mark Ready", exact: true })).toHaveCount(0);
}

async function approve(host: Page, player: Page, name: string, organizer = false) {
  await host.getByRole("button", { name: `Approve ${name}${organizer ? " as Organizer" : ""}`, exact: true }).click();
  await expect(player.getByRole("button", { name: "Mark Ready", exact: true })).toBeEnabled();
  await expect(player.getByText("Direct WebRTC data channel connected.", { exact: true })).toBeVisible();
  await expect(playerRow(host, name).getByText("Not ready", { exact: true })).toBeVisible();
  await expect.poll(async () => (await readMessages(player)).filter(({ direction, message }) => direction === "received" && message.type === "welcome").length).toBeGreaterThan(0);
}

async function markReady(player: Page, host: Page, name: string) {
  await player.getByRole("button", { name: "Mark Ready", exact: true }).click();
  await expect(player.getByRole("button", { name: "Not Ready", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(playerRow(host, name).getByText("Ready", { exact: true })).toBeVisible();
}

for (const [name, viewport] of [["desktop", desktop], ["mobile", mobile], ["compact", compact]] as const) {
  test(`home fits ${name} without horizontal overflow`, async ({ lobby }, testInfo) => {
    const page = await lobby.newPage(viewport);
    await page.goto(lobby.origin);
    await expect(page.getByRole("heading", { name: "A little island. Your people.", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create Game", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Join Game", exact: true })).toBeVisible();
    await noHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`home-${name}.png`), fullPage: true });
  });
}

test("board-only admits three independent players and synchronizes readiness and identity over RTC", async ({ lobby }, testInfo) => {
  const host = await lobby.newPage();
  const room = await createRoom(host, lobby.origin);
  await expect(host.getByText("0 / 4 PLAYERS", { exact: true })).toBeVisible();
  await expect(host.getByRole("button", { name: "Mark Ready", exact: true })).toHaveCount(0);
  await expect(host.getByText("Change identity", { exact: true })).toHaveCount(0);

  const players: Page[] = [];
  for (const [name, color, viaCode] of [["Ada", "Blue", false], ["Bea", "Red", true], ["Cy", "Orange", false]] as const) {
    const player = await lobby.newPage(mobile);
    players.push(player);
    await requestSeat(player, room, name, color, viaCode);
    await expect(playerRow(host, name)).toHaveCount(0);
    await approve(host, player, name, name === "Ada");
  }
  const firstPlayer = players[0]!;
  await expect(playerRow(host, "Ada")).toContainText("Blue / Organizer");
  for (const page of [host, ...players]) {
    await expect(roster(page).getByRole("listitem")).toHaveCount(3);
    await expect(page.getByText("Gather 3-4 ready players.", { exact: true })).toBeVisible();
  }
  for (const [index, name] of ["Ada", "Bea", "Cy"].entries()) await markReady(players[index]!, host, name);
  for (const page of [host, ...players]) {
    await expect(page.getByText("Everyone is ready.", { exact: true })).toBeVisible();
    await expect(page.getByText("Lobby checks passed. Gameplay is not available in this milestone.", { exact: true })).toBeVisible();
  }
  for (const player of players) {
    const messages = await readMessages(player);
    expect(messages.some(({ direction, message }) => direction === "sent" && message.type === "action"
      && (message.action as { type: string; ready: boolean }).type === "set-ready"
      && (message.action as { ready: boolean }).ready)).toBe(true);
    expect(messages.some(({ direction, message }) => direction === "received" && message.type === "snapshot"
      && (message.snapshot as { canStart: boolean }).canStart)).toBe(true);
  }
  await noHorizontalOverflow(host);
  await noHorizontalOverflow(firstPlayer);
  await host.screenshot({ path: testInfo.outputPath("host-display-desktop.png"), fullPage: true });
  await firstPlayer.screenshot({ path: testInfo.outputPath("player-mobile.png"), fullPage: true });
  await firstPlayer.getByText("Change identity", { exact: true }).click();
  await firstPlayer.getByLabel("Your name", { exact: true }).fill("Ada Updated");
  await expect(firstPlayer.getByRole("radio", { name: "Red", exact: true })).toBeDisabled();
  await firstPlayer.getByRole("radio", { name: "White", exact: true }).check();
  await firstPlayer.getByRole("button", { name: "Save Identity", exact: true }).click();
  for (const page of [host, ...players]) {
    await expect(playerRow(page, "Ada Updated")).toContainText("White / Organizer");
    await expect(playerRow(page, "Ada Updated").getByText("Not ready", { exact: true })).toBeVisible();
    await expect(page.getByText("Gather 3-4 ready players.", { exact: true })).toBeVisible();
  }
  await expect(firstPlayer.getByRole("button", { name: "Mark Ready", exact: true })).toHaveAttribute("aria-pressed", "false");
  await firstPlayer.setViewportSize(compact);
  await noHorizontalOverflow(firstPlayer);
  await expect(host.getByRole("button", { name: /^(Mark Ready|Not Ready)$/ })).toHaveCount(0);
  await expect(host.getByText("Change identity", { exact: true })).toHaveCount(0);
});

test("Host & Play owns a seat and enforces approval-time colors, capacity, decline, and removal", async ({ lobby }) => {
  const host = await lobby.newPage();
  const room = await createRoom(host, lobby.origin, true);
  await expect(host.getByText("1 / 4 PLAYERS", { exact: true })).toBeVisible();
  await expect(playerRow(host, "Host")).toContainText("Host (you)");
  await expect(playerRow(host, "Host")).toContainText("Blue / Organizer");
  await expect(host.getByRole("button", { name: "Remove Host", exact: true })).toHaveCount(0);
  await markReady(host, host, "Host");

  const duplicate = await lobby.newPage(mobile);
  await requestSeat(duplicate, room, "Duplicate", "Blue");
  await expect(host.getByText("1 / 4 PLAYERS", { exact: true })).toBeVisible();
  await host.getByRole("button", { name: "Approve Duplicate", exact: true }).click();
  await expect(host.getByRole("alert")).toHaveText("That color is already reserved. Choose an unused player color.");
  await expect(duplicate.getByRole("heading", { name: "Your connection has ended.", exact: true })).toBeVisible();
  await expect(duplicate.getByText("That color is already reserved. Choose an unused player color.", { exact: true })).toBeVisible();
  await expect(playerRow(host, "Duplicate")).toHaveCount(0);

  const players: Page[] = [];
  for (const [name, color] of [["Remy", "Red"], ["Oli", "Orange"], ["Wren", "White"]] as const) {
    const player = await lobby.newPage(mobile);
    players.push(player);
    await requestSeat(player, room, name, color);
    await approve(host, player, name);
  }
  await expect(roster(host).getByRole("listitem")).toHaveCount(4);
  const fifth = await lobby.newPage(mobile);
  await requestSeat(fifth, room, "Fifth", "Blue", true);
  await expect(host.getByRole("button", { name: "Approve Fifth", exact: true })).toBeEnabled();
  await host.getByRole("button", { name: "Approve Fifth", exact: true }).click();
  await expect(fifth.getByText("This room is full. Remove a player before admitting another.", { exact: true })).toBeVisible();
  await expect(roster(host).getByRole("listitem")).toHaveCount(4);

  const declined = await lobby.newPage(mobile);
  await requestSeat(declined, room, "Declined", "Red");
  await host.getByRole("button", { name: "Decline Declined", exact: true }).click();
  await expect(declined.getByText("The host declined your request to join.", { exact: true })).toBeVisible();
  await expect(roster(host).getByRole("listitem")).toHaveCount(4);

  const removed = players[0]!;
  const seat = await savedSeat(removed);
  await host.getByRole("button", { name: "Remove Remy", exact: true }).click();
  await expect(removed.getByText("The host removed you from the lobby.", { exact: true })).toBeVisible();
  await expect(removed.getByRole("button", { name: /^(Mark Ready|Not Ready)$/ })).toHaveCount(0);
  await expect.poll(() => removed.evaluate(identifier => localStorage.getItem(`catania.seat.${identifier}`), seat.room.roomIdentifier)).toBeNull();
  await expect(roster(host).getByRole("listitem")).toHaveCount(3);
  await markReady(players[1]!, host, "Oli");
  await expect(playerRow(host, "Remy")).toHaveCount(0);
});

test("player refresh reclaims the same credential and lost credentials fail explicitly", async ({ lobby }) => {
  const host = await lobby.newPage();
  const room = await createRoom(host, lobby.origin);
  const player = await lobby.newPage(mobile);
  await requestSeat(player, room, "Ada", "Blue");
  await approve(host, player, "Ada", true);
  await markReady(player, host, "Ada");
  const originalSeat = await savedSeat(player);
  expect(originalSeat.credential).toBeTruthy();
  await player.reload();
  await expect(player.getByRole("button", { name: "Mark Ready", exact: true })).toBeEnabled();
  expect(await savedSeat(player)).toEqual(originalSeat);
  await expect(roster(host).getByRole("listitem")).toHaveCount(1);
  await expect(playerRow(host, "Ada").getByText("Not ready", { exact: true })).toBeVisible();
  await expect(host.getByRole("button", { name: /^Approve / })).toHaveCount(0);

  const stranger = await lobby.newPage(mobile);
  await stranger.goto(player.url());
  await expect(stranger.getByRole("alert")).toContainText("This browser has no reconnect credential for that room.");
  await expect(stranger.getByRole("button", { name: "Mark Ready", exact: true })).toHaveCount(0);
  await markReady(player, host, "Ada");
  await player.evaluate(identifier => localStorage.removeItem(`catania.seat.${identifier}`), originalSeat.room.roomIdentifier);
  await player.reload();
  await expect(player.getByRole("alert")).toContainText("An invite cannot reclaim an occupied seat; ask the host to remove it before joining again.");
  await expect(player.getByRole("button", { name: "Mark Ready", exact: true })).toHaveCount(0);
  await expect(roster(host).getByRole("listitem")).toHaveCount(1);
});

test("closing a real data channel disables controls and recovers the same seat", async ({ lobby }) => {
  const host = await lobby.newPage();
  const room = await createRoom(host, lobby.origin);
  const player = await lobby.newPage(mobile);
  await requestSeat(player, room, "Ada", "Blue");
  await approve(host, player, "Ada", true);
  await markReady(player, host, "Ada");
  const originalSeat = await savedSeat(player);
  const authenticationCount = (await readMessages(player)).filter(({ direction, message }) => direction === "sent" && message.type === "authenticate").length;
  expect(await player.evaluate(() => {
    const channel = (window as unknown as ObservedWindow).lobbyTestProbe.channels.find(channel => channel.readyState === "open");
    channel?.close();
    return !!channel;
  })).toBe(true);
  await expect(player.getByText("Reconnecting to your seat", { exact: true })).toBeVisible();
  await expect(player.getByRole("button", { name: /^(Mark Ready|Not Ready)$/ })).toBeDisabled();
  await expect.poll(async () => (await readMessages(player)).filter(({ direction, message }) => direction === "sent" && message.type === "authenticate").length).toBeGreaterThan(authenticationCount);
  await expect(player.getByRole("button", { name: "Mark Ready", exact: true })).toBeEnabled();
  expect(await savedSeat(player)).toEqual(originalSeat);
  await expect(roster(host).getByRole("listitem")).toHaveCount(1);
  await markReady(player, host, "Ada");
});

test("a valid second tab rebinds the seat and permanently disables the stale connection", async ({ lobby }) => {
  const host = await lobby.newPage();
  const room = await createRoom(host, lobby.origin);
  const original = await lobby.newPage(mobile);
  await requestSeat(original, room, "Ada", "Blue");
  await approve(host, original, "Ada", true);
  await markReady(original, host, "Ada");
  const originalSeat = await savedSeat(original);
  const replacement = await lobby.newPage(mobile, original.context());
  await replacement.goto(original.url());
  await expect(replacement.getByRole("button", { name: "Mark Ready", exact: true })).toBeEnabled();
  expect(await savedSeat(replacement)).toEqual(originalSeat);
  await expect(original.getByText("This seat was reopened in another tab.", { exact: true })).toBeVisible();
  await expect(original.getByRole("button", { name: /^(Mark Ready|Not Ready)$/ })).toHaveCount(0);
  await expect.poll(() => original.evaluate(() => (window as unknown as ObservedWindow).lobbyTestProbe.channels.every(channel => channel.readyState === "closed"))).toBe(true);
  await markReady(replacement, host, "Ada");
  await expect(roster(host).getByRole("listitem")).toHaveCount(1);
  await expect(host.getByRole("button", { name: /^Approve / })).toHaveCount(0);
  await expect(original.getByRole("heading", { name: "Your connection has ended.", exact: true })).toBeVisible();
});

for (const operation of ["refresh", "close"] as const) {
  test(`host ${operation} ends the room rather than restoring authority`, async ({ lobby }) => {
    const host = await lobby.newPage();
    const room = await createRoom(host, lobby.origin);
    const player = await lobby.newPage(mobile);
    await requestSeat(player, room, "Ada", "Blue");
    await approve(host, player, "Ada", true);
    host.on("dialog", dialog => dialog.accept());
    if (operation === "refresh") {
      await host.reload();
      await expect(host.getByRole("heading", { name: "A little island. Your people.", exact: true })).toBeVisible();
    } else await host.close({ runBeforeUnload: true });
    await expect(player.getByRole("heading", { name: "Your connection has ended.", exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(player.getByRole("button", { name: /^(Mark Ready|Not Ready)$/ })).toHaveCount(0);
    await expect(player.getByText(/The host ended the room|The host did not return/)).toBeVisible();
  });
}
