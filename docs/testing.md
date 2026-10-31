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
Multiplayer coverage includes required/optional lobby seats, computer add/remove
controls and capacity, human removal and fresh readmission, validated computer
renaming and left-side player avatars, exact lobby-map preservation after zero or
multiple shuffles, one phone with two automatic computer opponents, private-hand
projections, and reconnect readiness. Host-session tests cover computer timer cleanup,
stale callbacks, off-turn discards/trades, and shared-board authority restrictions.
Connection tests cover STUN-only configuration for hosts, players, and recreated
peers; unanswered negotiations, direct ICE failures/timeouts, and missing initial
snapshots; private-data-free diagnostics; and clearing old errors on retries.
Browser regressions render all three timeout stages at desktop/mobile sizes,
using controlled signaling/candidate/message suppression rather than claiming
to reproduce a physical router failure.
Dialog regressions cover the shared single-device and cross-device trade editor,
resource-card selectors, response states, missing-card explanations, development-card
inspection, discard progress, and purchase/theft/trade confirmations. Phone checks
include 320-pixel layouts and version changes while a choice or confirmation is open.
Presentation-fixture tests validate rendering and command payloads separately from
the real WebRTC game tests that validate authoritative state transitions.
Robbery coverage checks exact-resource events and private projections, local
victim/thief notices across handoffs, computer thefts in solo play, and phone
notice queues, five-second expiry, anchored overlays without layout shifts, off-screen timer cleanup,
reconnect acknowledgements, resource-loss false positives, and reduced motion.
Shared-board layout checks cover the single-device player seats and map, viewport
containment, horizontally scrolling seats, and confirmed placements at desktop and
320-pixel widths. They also verify that bank/build/turn panels, tabs, and private
hands or actions do not appear on the shared screen.

## Browser Test Servers

Browser tests use the declared Playwright dependency, a dedicated application
server on port 4173, and a test-only PeerServer on port 4176. Existing servers are
not reused. Set `PLAYWRIGHT_PORT` and `PLAYWRIGHT_SIGNALING_PORT` to use different
application and signaling ports when another test run occupies the defaults:

```bash
PLAYWRIGHT_PORT=4191 PLAYWRIGHT_SIGNALING_PORT=4192 bun run test:browser
```

Each setting is optional; their defaults remain 4173 and 4176 respectively.
Multiplayer tests route signaling to that local server and exercise native browser
WebRTC connections. The harness overrides `RTCPeerConnection` construction to use
`iceServers: []`, since native STUN traffic bypasses HTTP/WebSocket interception.
Tests therefore do not depend on public PeerJS Cloud or STUN. Unit tests separately
assert the production STUN configuration and absence of TURN. This test server
and discovery override are not part of the deployment.

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
compatibility or public STUN reachability. Separately check a deployed Vercel host
and three physical phones on the intended local network, including a desktop on
Ethernet and Android Chrome on Wi-Fi:

1. Scan the invitation and admit each phone.
2. Complete setup, roll, trade, and discard.
3. Reconnect a phone after backgrounding it.
4. Verify that the shared screen never shows a private hand.
5. In a new room, admit one phone and add two computers. Check the missing-player
   message, optional fourth seat, and add/remove controls. Rename a computer, check
   its left-side robot avatar, and verify duplicate names are rejected. Remove the human and
   confirm their phone must request fresh admission. Shuffle the preview, change
   themes, and verify Start keeps the chosen terrain, numbers, ports, and robber.
   Verify automatic
    computer placements, turns, discards, and trade responses without phone prompts.
6. Keep the host awake and retry joining from Android Chrome with the current
   invitation. If it fails, record the displayed connection stage and ICE/gathering
   states, not the invitation or session description. Check both automatic and
   manual retries clear the previous error. Repeat with phone and desktop roles
   reversed, and check background/resume behavior. Do not treat STUN as proof that
   guest isolation or firewall restrictions can be bypassed.

Browser automation does not establish physical Android/iOS compatibility or public
PeerJS Cloud availability. See the [multiplayer guide](multiplayer.md) for deployment,
network requirements, and reconnection limits.
