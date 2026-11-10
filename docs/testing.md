# Testing Guide

[Back to README](../README.md) | [Gameplay guide](gameplay.md) | [Multiplayer guide](multiplayer.md)

## Automated Checks

Install dependencies with `bun install`, then run:

```bash
bun run test
bun run typecheck
bun run build
bun run test:browser
bun run test:browser:pwa
```

If Chromium is not installed, install it before running browser tests:

```bash
bunx playwright install chromium
```

Rule tests use injected randomness and cover legal and illegal actions, computer
decisions, and complete AI games. Computer trading coverage includes once-per-turn
single-card requests, useful and affordable prices, computer-to-computer exchanges, hidden-hand
privacy, exact 15-second deadlines, and resuming maritime trades after withdrawal.
Strategic regressions check complementary setup production, gold-hex settlement
preference, productive city upgrades, production-aware waiting versus immediate purchases, goal-aligned
bank trades/discards/gold, alternative trade goals, selective development cards,
winning builds and route awards, and public-leader targeting without hidden-card
access. Seeded complete games verify legal, finite actions and resource conservation.
Both `bun test` and `bun run test` run the tests
in `tests/game/`. The test root in `bunfig.toml` keeps Bun from loading Playwright
browser tests; run those separately with `bun run test:browser`.
Seafarers coverage checks the 42-hex scenario topology, terrain and token supplies,
mainland setup, ship costs and piece limits, shipping connections and movement,
mixed Longest Route, pirate theft/blocking, finite gold choices, island bonuses,
13-point victory, multiplayer serialization, and complete three-/four-player AI games.
Focused checks:

```bash
bun test tests/game/seafarers.test.ts
bun run test:browser --grep Seafarers --workers=2
```

Seafarers browser tests cover switching versions and artwork, starting on the
selected board, confirmed setup ships, real host/phone ship movement, and
off-turn gold selections on narrow private phones. As with other private-dialog
fixtures, gold rendering/payload checks are separate from engine authority tests.

The browser suite selects `tests/browser/catania.spec.ts`,
`tests/browser/multiplayer.spec.ts`, and `tests/browser/localization.spec.ts`
through [`playwright.config.ts`](../playwright.config.ts).
The separate `bun run test:browser:pwa` run builds `dist/` and serves it with
[`scripts/serve-dist.ts`](../scripts/serve-dist.ts) through
[`playwright.pwa.config.ts`](../playwright.pwa.config.ts). Its checks cover the
web app manifest fields, PNG icon responses, the injected manifest and icon
links, service-worker registration, and an offline reload of the cached shell;
the service worker registers only in production builds, so the main dev-server
suite never exercises it.
Tests exercise the interface in desktop and mobile Chromium viewports and write
diagnostic screenshots to `test-results/`, including each theme's preview, actual
game board, and resource cards, plus the theme dialog.
Deterministic single-device fixtures enter an explicit map code and press Enter,
and build the mirrored engine board with `seededRandom` using that same code.
Turn order and development-card randomness are seeded separately from the map.
Scenario-specific maps and dice sequences preserve real resource production,
finite-bank trades, settlement stock, computer requests, and scripted victories;
tests do not inject game state into the single-device app.
Blocked-storage tests create a temporary player profile on each visit, including
after reload, because profiles cannot persist while storage is unavailable.
Responsive home checks keep the map-code field, replay action, and shuffle action
fully visible alongside the island; lobby checks reject horizontal overflow and
verify that wrapped map controls do not block game setup.
Harbor regressions check that both pier strokes meet the coastline on Original
and Seafarers boards without moving the offshore badges.
Multiplayer coverage includes required/optional lobby seats, computer add/remove
controls and capacity, human removal and fresh readmission, validated computer
renaming and left-side player avatars, exact lobby-map preservation after zero or
multiple shuffles, one phone with two automatic computer opponents, private-hand
projections, and reconnect readiness. Host-session tests cover computer timer cleanup,
stale callbacks, off-turn discards/trades, and shared-board authority restrictions.
Victory-target regressions cover the host-only 3-13 selector in the map's gold VP
badge, keyboard selection, narrow-screen touch targets, scenario-default resets,
phone synchronization, localized rules, unchanged maps, and reset/rematch retention.
Engine and computer tests verify custom winning thresholds, including both endpoints,
and network validation rejects invalid targets and phone configuration commands.
Reset regressions cover Original and Seafarers on desktop and mobile, confirmation
and cancellation, exact initial islands and turn order, cleared hands and pending
placements, resetting during a roll, host-only authority, synchronized phones,
preserved seat credentials, and stale computer/command timers.
The one-phone setup test declines computer trade requests while waiting for the
human's first turn, so random trades do not consume its readiness timeout.
Desktop/mobile browser regressions cover human prices on computer requests,
automatic withdrawal at the deadline, private phone request presentation, and
keeping computer hands hidden throughout an exchange.
Single-device request fixtures decline earlier computer requests before the
human's first roll and use scripted dice that trigger the intended build request.
Mirrored solo fixtures also resolve off-turn computer responses and human declines
before advancing the requester, preserving the real single-card trading rules.
Foggy World setup regressions cover cell-first discovery followed by legal nodes
restricted to the selected land cell, repeated sea discoveries, rejection of
cells without legal settlement nodes, direct second-settlement placement on
revealed-land nodes alongside fog reveal targets, persistent sea attempts,
discovery rewards and gold choices, explicit Road/Ship choices before setup edges
appear, route placement restricted to the selected cell's boundary (or adjacent
revealed land after direct placement), shared-board authority, hidden fixed terrain,
discovery-order independence, and complete three- and four-player setups.
Fog reveal regressions cover setup discoveries across private handoffs without
replaying completed veils. Menu checks include tabbing out of the document, and
short desktop lobbies retain a map at least 400 pixels tall with inline version labels.
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
containment, horizontally scrolling phone seats, and confirmed placements at desktop
and 320-pixel widths. Responsive checks cover all seats fitting on tablets, narrow
two-level player cards, identical compact player-list/table-seat markup, counts
fitting one row without overflow at 320-pixel phone and short-landscape widths,
persistent mobile turn controls across tabs, and collapsible build controls.
Shared-board checks also verify that bank/build/turn panels, tabs,
and private hands or actions do not appear on the shared screen.
Unfolded-layout checks hide the single-device page header while keeping the
in-game menu accessible, cover the breakpoint boundaries, and verify that home,
folded-phone, short-landscape, and desktop layouts retain their header.
Tablet seats, shared-board tablet seats, and unfolded-layout checks run in both
desktop and touch-enabled mobile projects.
Scrollbar regressions verify hidden tracks in solo panels, menus, dialogs, shared
boards, and private multiplayer hands, preserved scrolling, and unchanged home
scrollbars.
Disabled build-row checks cover folded/unfolded resizing at 125% and 156.25%
display scales, keep labels out of opacity layers, and verify that wrapped text
stays inside its row without overlapping resource costs.
They use human-only players so computer setup timers cannot switch away from
the hand during layout assertions.
Score regressions check a single VP number including hidden points only for the
revealed player or private phone, without changing public leader highlights.
Single-device turn controls match the private phone's inline Game menu, and
trade/discard inventories retain the over-seven-card warning.

Language tests cover Japanese browser locales, regional language matching,
unsupported-locale fallback, saved overrides across both modes, invalid and blocked
storage, translated document metadata, help/themes/settings, private handoffs,
keyboard placement, and narrow-screen controls. Mixed-language multiplayer tests
verify independent host/phone choices, translated activity, preserved names and
private hands, and switching without network commands or state changes. Unit tests
check catalog parameter parity and validation/formatting of structured game errors
and logs. Existing English browser tests explicitly use `en-US`.

## Browser Test Servers

Browser tests use the declared Playwright dependency, a dedicated application
server on port 4173, and a test-only PeerServer on port 4176. The PWA run adds a
dist static server on port 4180. Existing servers are
not reused. Set `PLAYWRIGHT_PORT` and `PLAYWRIGHT_SIGNALING_PORT` to use different
application and signaling ports when another test run occupies the defaults:

```bash
PLAYWRIGHT_PORT=4191 PLAYWRIGHT_SIGNALING_PORT=4192 bun run test:browser
```

Each setting is optional; their defaults remain 4173 and 4176 respectively.
`PLAYWRIGHT_DIST_PORT` overrides the PWA dist-server port the same way.
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
6. Check that the Game and Menu dropdowns close with Escape or an outside click,
   and that closing their dialogs returns focus to the opener (**Game** or
   **Menu**).
7. Compare all six themes on desktop and phone boards, including a 320-pixel-wide
   viewport. Use arrow keys in the theme radios and check that Close and Escape
     restore focus to **Theme** without losing a selected location, zoom, or pan.
8. Start with a Japanese browser locale, then switch **English / 日本語** through
   **Game > Language** during play or **Menu > Language** on the home,
   multiplayer setup, and results screens. Check help,
   resource labels, and placement instructions; confirm a manual
   choice survives reloads. In multiplayer, use different languages on the host
   and a phone and compare their activity messages. Visually inspect Japanese text
   on a system with Japanese fonts; no remote font download is required by the app.
9. Note the map code beside **Shuffle**, start a game, and check the victory
   panel repeats that code. Return home and enter or paste the code; confirm the
   identical island loads automatically at 8 characters, without a replay button.
   Partial codes must not change the map; Enter still submits the field.
   Enter an invalid code and check the field explains the 8-character format.
10. In a fresh browser profile, check the **Who's playing?** screen: create a
   profile, verify its name prefills the first human seat, finish a solo game,
   and confirm the victory panel shows one recorded game. Use
   **Menu > Profile** to rename the profile and pick or create another;
   the first seat follows the active name and history stays per-profile.
   Check that the avatar initial updates after renaming or switching, the current
   profile is marked, and games/wins/total points have separate labels. On desktop
   and a 320-pixel-wide phone, rename controls must fit without horizontal scrolling.
   The empty creation form should show neutral guidance, not an error, until edited
   or blurred. Repeat in Japanese and on an invited phone before joining.
   The pencil must sit beside the name, and no **Keep current profile** button
   should appear; selecting the current card returns to the previous screen.
   The trash icon must open a confirmation, with Cancel/Escape returning focus
   without deleting anything. Confirm deletion of an inactive, active, and last
   profile, then reload to verify persistence. Deleting the active profile must
   require selecting or creating one; a storage failure must leave the dialog
   open with an error. Verify Profile is absent from solo, pass-and-play, shared
   board, and private-phone menus during unfinished games.
11. Finish solo and multiplayer-phone games and expand **Game history** in the
    profile. Verify game ID, map code, version, date, outcome, final points, and
    turn count survive reloads; duplicate result requests must not add entries.
    Replay both Original and Seafarers entries and compare every terrain tile,
    production number, and port against the saved island. The game must wait in
    setup until started. History replay must not be accessible from an unfinished
    game, and ending one must not create a history entry. Old profiles retain
    totals with empty history.

## Physical-Device Multiplayer

Viewport automation is not a claim of physical Android/iOS or local-network
compatibility or public STUN reachability. Separately check a deployed Vercel host
and three physical phones on the intended local network, including a desktop on
Ethernet and Android Chrome on Wi-Fi:

1. Scan the invitation and admit each phone. On one phone, join through the home
   page's **Scan to join a board** scanner over HTTPS, including its permission
   prompt; on a plain-HTTP development URL, confirm the dialog instead guides the
   player to the phone's camera app.
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
7. Finish a full game to the victory panel. Confirm the winner's player-history
   line appears on the shared board after the phones reply, note the map code,
   and check that replaying the code in a new room rebuilds the same island.
   Play a second game with the same phone and confirm its totals accumulate
   exactly once per game, including after a mid-victory reload.

Browser automation does not establish physical Android/iOS compatibility or public
PeerJS Cloud availability. See the [multiplayer guide](multiplayer.md) for deployment,
network requirements, and reconnection limits.
