# Catania

A local, pass-and-play Catan-style base game for 3-4 people. Built with Bun,
React 19, TypeScript, and Tailwind CSS v4. All illustrations and assets are local.

## Run

Install dependencies, then start the development server:

```bash
bun install
bun run dev
```

Open the URL printed by Bun (normally `http://localhost:3000`). To choose a port:

```bash
PORT=3001 bun run dev
```

For a production-mode source server:

```bash
bun run start
```

`bun run build` separately produces a static browser bundle in `dist/`; `start`
serves the source through Bun rather than reading `dist/`.

## Play

1. Choose three or four players, enter distinct names, and select **Let's settle in**.
2. Pass the device to the named player before revealing their hand.
3. Place a settlement and road in forward order, then in reverse order. Every
   location is previewed first and requires confirmation.
4. Roll, gather resources, build, trade, and play eligible development cards.
   The **How to play** guide and on-screen costs explain the rules.
5. For a player trade, create an offer and pass the device for responses. The
   active player confirms a trade with exactly one accepting player.
6. Reach 10 victory points on your own turn. Inspect the revealed score breakdown
   and start a fresh rematch or return to the table.

On phones, switch between **Hand**, **Board**, and **Players**. Zoom the board to
enlarge placement targets, then scroll or drag inside it. Keyboard users can
select highlighted positions with Enter or Space.

The game includes the standard terrain and tokens, nine ports, finite resource
bank and development deck, piece limits, robber and discards, all development
cards, Longest Road, Largest Army, and hidden victory points. Builds, trades,
phase transitions, and turn ownership are validated by the rules engine.

## Privacy And Limits

- This milestone is **one device, passed between players**, not Wi-Fi multiplayer.
- Handoff screens remove private cards from the rendered page until revealed.
  The shared browser still holds every hand; privacy depends on taking turns.
- Refreshing or closing the tab loses the game. There is no save, recovery,
  computer opponent, or replacement player.
- Rooms, QR joining, separate private phone hands, board-only host mode, peer
  networking, and reconnection are deferred. See `docs/` for that future scope.
- No internet service, remote font, or remote game asset is used during play.
  Dependency and browser installation may need internet access.

## Verify

```bash
bun run test
bun run typecheck
bun run build
bun run test:browser
```

Browser tests use the declared Playwright dependency and a dedicated server on
port 4173. If Chromium is not installed, install it once:

```bash
bunx playwright install chromium
```

Rule tests use injected randomness and cover legal and illegal actions.
Browser tests exercise the local interface in desktop and mobile Chromium
viewports and write diagnostic screenshots to `test-results/`.

For a manual check, finish setup with three people, roll and resolve any robber
choices, build and trade as resources allow, and verify that a handoff shows no
private cards. Check zoom, keyboard placement, and end-game confirmation.
Viewport automation is not a claim of physical Android/iOS or local-network
compatibility; real-device multiplayer verification remains deferred.
