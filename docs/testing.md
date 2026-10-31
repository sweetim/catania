# Testing Guide

[Back to README](../README.md) | [Gameplay guide](gameplay.md) | [Multiplayer guide](multiplayer.md)

## Automated Checks

Install dependencies with `bun install`, then run:

```bash
bun run test
bun run typecheck
bun run build
bun run test:browser
```

If Chromium is not installed, install it before running browser tests:

```bash
bunx playwright install chromium
```

Rule tests use injected randomness and cover legal and illegal actions, computer
decisions, and complete AI games. `bun run test` runs the tests in `tests/game/`.

The browser suite selects `tests/browser/catania.spec.ts` and
`tests/browser/multiplayer.spec.ts` through [`playwright.config.ts`](../playwright.config.ts).
Tests exercise the interface in desktop and mobile Chromium viewports and write
diagnostic screenshots to `test-results/`, including each theme's preview, actual
game board, and resource cards, plus the theme dialog.

## Browser Test Servers

Browser tests use the declared Playwright dependency, a dedicated application
server on port 4173, and a test-only PeerServer on port 4176. Existing servers are
not reused. Set `PLAYWRIGHT_PORT` to use another application port when 4173 is
already occupied:

```bash
PLAYWRIGHT_PORT=4174 bun run test:browser
```

This changes only the application port; the test PeerServer still needs port 4176.
Multiplayer tests route signaling to that local server and exercise real browser
WebRTC connections without depending on public PeerJS Cloud. This test server is
not part of the deployment.

## Manual Single-Device Checks

1. Play solo and confirm that AI takes turns without any reveal prompt and that
   only your own hand is available.
2. Finish setup with two or three people, roll and resolve any robber choices,
   build and trade as resources allow, and verify that a handoff shows no private
   cards. Check zoom, keyboard placement, and end-game confirmation.
3. Check the collection tray after a second starting settlement, a producing roll,
   and a bank trade in both Hand and Board views. Compare gain badges to resource
   totals, and repeat with the operating system's reduced-motion setting enabled.
4. Check that rolls and placement previews leave the board stationary, matching
   numbers light up instead of hex borders, and **Game > Help** opens without
   shifting the table.
5. Check all build costs and five development-card types in Help before starting
   a game and with an empty hand. Scroll to the rules on desktop and mobile, and
   confirm that Help contains no current-table activity or player details.
6. Check that the Game menu closes with Escape or an outside click, and that
   closing its dialogs returns focus to **Game**.
7. Compare all six themes on desktop and phone boards, including a 320-pixel-wide
   viewport. Use arrow keys in the theme radios and check that Close and Escape
   restore focus to **Theme** without losing a selected location, zoom, or pan.

## Physical-Device Multiplayer

Viewport automation is not a claim of physical Android/iOS or local-network
compatibility. Separately check a deployed Vercel host and three physical phones
on the intended Wi-Fi:

1. Scan the invitation and admit each phone.
2. Complete setup, roll, trade, and discard.
3. Reconnect a phone after backgrounding it.
4. Verify that the shared screen never shows a private hand.

Browser automation does not establish physical Android/iOS compatibility or public
PeerJS Cloud availability. See the [multiplayer guide](multiplayer.md) for deployment,
network requirements, and reconnection limits.
