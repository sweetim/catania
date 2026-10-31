# Catania

A local Catan-style base game for 1-4 humans, with AI filling a 3-4 player table.
Built with Bun, React 19, TypeScript, and Tailwind CSS v4. All illustrations and
assets are local.

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

1. Choose three or four total players and how many are human (one by default).
   AI fills the remaining seats. Enter distinct names and optionally **Shuffle**
   the island preview. **Let's settle in** starts on the island currently shown,
   including its terrain, number tokens, and harbors.
2. With one human, your hand opens automatically and stays available during AI turns.
   With multiple humans, pass the device to the named player before revealing their hand.
3. Place a settlement and road in forward order, then in reverse order. Your
   placements are previewed before confirmation; AI places its own pieces automatically.
4. Roll, gather resources, build, trade, and play eligible development cards.
   **Help** and on-screen costs explain the rules.
5. For a player trade, use **Request cards** to ask for what you need and let other
   players propose a price, or choose **Exact offer** to specify both sides.
   AI responds automatically; pass the device for human responses. Compare prices
   as **You give / You receive** cards and confirm one exchange. Unaffordable
   prices show the exact missing cards and cannot be completed. Use **Change offer**
   to keep the requested cards and choose payment from your hand. Closing the editor
   keeps the original trade; submitting replaces it and asks for new responses.
   No cards move until the active player confirms; withdraw to reject every response.
6. Reach 10 victory points on your own turn. Inspect the revealed score breakdown
   and start a fresh rematch or return to the table.

Gameplay fits the viewport without page scrolling. The board and dice tray stay
in place as rolls and turn notices update. On desktop, the right sidebar has
three separately bordered panels: **Bank**, **Your cards**, and **Turn controls**.
Rounded edges, subtle shadows, and clear background gaps make them read as three
detached islands, with compact 12-pixel gaps on desktop and 8-pixel gaps on phones.
The cards panel holds resources, development cards, and build/trade controls,
scrolling vertically without horizontal scrolling. The bottom panel starts with
the active player's name and **Your turn** or **Their turn**, alongside a
high-contrast turn-number badge. Below it are the dice result, the current-action
card without a repeated turn-owner label, and the persistent **Roll the dice** and
**End turn** buttons, which stay in place and become disabled when unavailable.
The board fills the full height beside all three panels. On phones,
the turn-status card and controls stay at the bottom of **Hand**, while the dice
summary and bank remain above the selected view, visible across all three game views.
Bank resource quantities sit below their icons inside each card, without overlapping badges.
On phones, switch between **Hand**, **Board**, and **Players**. Zoom the board to
enlarge placement targets, then scroll or drag inside it. The board footer contains
**Theme** alongside zoom and reset controls, without instruction or legend text. Short screens can scroll
within the hand or player panel without moving the board. On very short windows,
the entire sidebar scrolls internally so the status card, turn controls, and hand
tasks remain reachable. The header's **Game** menu contains **Help**, **Settings**,
and **Pass device** when multiple humans have a hand revealed.
**End game** sits below a divider and still requires confirmation. The turn header
shows **Setup** or the current turn number. Keyboard users can select highlighted
positions with Enter or Space. Confirm/Cancel appears beside the selected piece
or hex, stays inside the map, and follows zoom and pan. Confirm is focused for
keyboard use; Escape cancels and returns focus to the selected location.

Choose a **Board theme** before starting to update the island preview immediately:
**Illustrated Island** (the default), **Mediterranean Ceramic**, **Carved Wooden Tabletop**,
**Pixel-Art Kingdom**, **Space Frontier**, or **Underwater Colonies**. During play,
the board footer's **Theme** button opens **Choose your theme**. Radio selections
apply immediately without closing the dialog; Close or Escape returns focus to
**Theme**. Themes change only board and resource artwork and palettes, not names,
rules, pieces, turns, or resources. Switching preserves the current selection,
zoom, and pan. This browser remembers the choice across games and reloads in
`localStorage` under `catania.boardTheme`; unknown values or unavailable storage
fall back to Illustrated Island. Storage failures do not prevent switching themes
for the current session, and remembering a theme does not save the game.

**Help** combines how to play, every build and purchase with costs and piece limits,
all five development-card types with their effects, timing, and starting deck counts,
and the game rules
for production, trading, the robber, scoring, and awards. This reference is available
before play and on the results screen through the header's **Help** button, and during
play through **Game > Help**, even with an empty hand. Each card type shows its
original supply: 14 Knights, 5 Victory points, and 2 each of Road building, Year of
plenty, and Monopoly. These are not live remaining counts. Help contains no current
table activity or player details. The dialog scrolls internally and
supports Escape to close and restore focus to its opener.

Small crosses mark empty corners next to any settlement or city where the distance
rule prevents a new settlement. **Game > Settings > Show blocked settlement locations**
toggles these markers. They are on by default, and the preference is remembered in
this browser when storage is available, including across new games and reloads.
Unmarked corners are not necessarily buildable: roads, resources, remaining pieces,
and turn rules still apply. The setting does not save the game.

The hand shows large per-resource quantities and a total card count. Discard and
trade panels keep your current cards visible. Tap a resource card to add it to a
selection, use its minus button to remove it, and read the selected quantity on
the card. Discards show one selected/required progress line and the total left in
hand instead of repeating labels under every resource. Per-resource availability
and remaining quantities remain available to assistive technology. Bank
trades show available quantities on the selection cards and preview the resulting
quantities without a duplicate hand summary. Player trades show what **you give**
and **you receive**, with current resources available through confirmation.
Development-card purchases and resource choices for Year of Plenty or Monopoly
also show your current resources; Knight, Road Building, Victory Point, and theft
confirmation omit that summary. The device-handoff picker shows human names and
colors without detailed player cards; all private summaries disappear during handoff.
Player seats show public card totals as icon-and-number badges, with full labels
in player details and accessible descriptions, never another player's resource
breakdown. Player seats also show each player's played-Knight count as a shield
icon and number, followed by a road icon and their longest connected-road count,
including zero, on desktop and phones. These use matching icon sizes and gaps.
A gold crossed-swords icon marks Largest Army, and a matching gold road icon marks
Longest Road. Each tooltip and accessible label includes the award's two victory
points without adding a text badge. Player details retain the connected-road count.
Knights still in hand do not count: play at least three to qualify, and surpass
the current holder to take the award. A gold crown and warm gold cell highlight
mark the highest public VP
score, shared by tied leaders unless everyone is tied. Names are vertically centered
beside their avatars, without a repeated turn-status line or dot. The active cell
has a gentle border pulse that becomes a static outline with reduced motion enabled;
it moves to the next player's cell when the turn changes without moving the layout.
The separate turn controls also identify the active player. Hidden victory-point
cards do not affect the crowns or cell highlights.
Build controls are vertical rows with road, settlement, city, and
development-card icons alongside their costs. Buying a development card costs
one wool, one grain, and one ore; the trade button sits below the stack.
A visible explanation beneath **Build settlement** appears only when all five of
your settlement pieces are on the board, prompting a city upgrade to free a piece.
This explanation is also associated with the button for screen readers and
disappears when a settlement piece is freed. Other restrictions still disable the
button and retain standard tooltips, but do not add descriptions beneath it.
Owned development cards appear below as a vertical stack, one row per card type
with a quantity badge, a distinct icon, and a description below its title. The
section heading counts all owned cards, including duplicates. The hand and card
dialog omit the "In your hand" and "New this turn" labels. Select a row to open
an older copy first when available in the existing, individual-card dialog;
playing still requires confirmation and action cards purchased this turn remain
unavailable. The entire owned-card section is hidden when your hand has no
development cards.
After **Confirm Knight**, use **Cancel Knight** in the turn card or phone Board
prompt to return the card before confirming the robber move. This restores the
played-Knight count, Largest Army ownership, development-card allowance, and
previous turn phase. The map's **Cancel** or Escape only clears the selected hex.
Cancellation is unavailable after confirming the move, for a robber triggered
by seven, or when the Knight has already won the game.

Dice show the actual rolled faces throughout the rolling animation, without
placeholder values. Rolls settle before matching number tokens light up, their hexes lift with
a deeper shadow, and resource totals update. Selected or keyboard-focused robber
destinations also lift, while click targets stay in their original positions.
Robber-blocked matches still lift but keep a muted, dashed token ring rather than
a production glow; hex borders do not flash. Gained resource cards deal into an
on-screen collection tray and animate over stationary hand cards, followed by
gain badges and a glow. The tray remains visible while viewing the board and can
be dismissed; it clears after a few seconds or immediately on private handoff.
It shows actual gains for the revealed hand
from starting settlements, dice, bank/player trades, theft, and development cards.
A fixed-size roll summary stays visible in every phone view until the next action.
It shows larger dice beside **You received** resource cards
with **+N** quantities for the revealed player, including on short phone screens.
Rolls without a personal gain show a short message instead of cards.
The tray omits the numeric total, roll sentence, and description row.
Computer turns wait for the roll sequence to finish. Screen-reader announcements
explain sevens, robber blocking, and bank shortages without revealing another
player's resource breakdown. Reduced-motion settings
show the result, collection cards, and static highlights immediately, without
animation delays.

The game includes the standard terrain and tokens, nine ports, finite resource
bank and development deck, piece limits, robber and discards, all development
cards, Longest Road, Largest Army, and hidden victory points. Builds, trades,
phase transitions, and turn ownership are validated by the rules engine.

Computer opponents run locally without an AI service. They handle setup, turns,
building, development cards, discards, and robber choices using their own hand
and public information. They trade with the bank/ports, respond to exact offers,
and quote equal-count prices for resource requests when useful to their build plan.
They do not initiate player trades or inspect opponents' hands to set prices.
They use a basic strategy, not an
advanced difficulty system.

## Privacy And Limits

- This milestone is **one device, solo or passed between humans**, not Wi-Fi multiplayer.
- Handoff screens are used only with multiple humans and remove private cards
  from the rendered page until revealed. AI hands cannot be opened through the UI.
  The shared browser still holds every hand; this is display privacy, not security.
- Refreshing or closing the tab loses the game. There is no save, recovery,
  or mid-game replacement player.
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

Rule tests use injected randomness and cover legal and illegal actions, computer
decisions, and complete AI games.
Browser tests exercise the local interface in desktop and mobile Chromium
viewports and write diagnostic screenshots to `test-results/`, including each
theme's preview, actual game board, and resource cards, plus the theme dialog.

For a manual check, play solo and confirm that AI takes turns without any reveal
prompt and that only your own hand is available. Then finish setup with two or
three people, roll and resolve any robber choices, build and trade as resources
allow, and verify that a handoff shows no
private cards. Check zoom, keyboard placement, and end-game confirmation. Check
the collection tray after a second starting settlement, a producing roll, and a
bank trade in both Hand and Board views. Compare gain badges to resource totals,
and repeat with the operating system's reduced-motion setting enabled. Check that
rolls and placement previews leave the board stationary, matching numbers light
up instead of hex borders, and **Game > Help** opens without shifting the table.
Check all build costs and five development-card types in Help before starting a game
and with an empty hand, then scroll to the rules and current table on desktop and mobile.
Check that the Game menu closes with Escape or an outside click, and that closing
its dialogs returns focus to **Game**.
Compare all six themes on desktop and phone boards, including a 320-pixel-wide
viewport. Use arrow keys in the theme radios and check that Close and Escape
restore focus to **Theme** without losing a selected location, zoom, or pan.
Viewport automation is not a claim of physical Android/iOS or local-network
compatibility; real-device multiplayer verification remains deferred.
