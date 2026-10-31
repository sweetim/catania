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
   The **How to play** guide and on-screen costs explain the rules.
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
On phones, switch between **Hand**, **Board**, and **Players**. Zoom the board to
enlarge placement targets, then scroll or drag inside it. Short screens can scroll
within the hand or player panel without moving the board. On very short windows,
the entire sidebar scrolls internally so the status card, turn controls, and hand
tasks remain reachable. The header's **Game** menu contains **Table guide**
(costs, public activity, and player details),
**How to play**, **Settings**, and **Pass device** when multiple humans have a hand revealed.
**End game** sits below a divider and still requires confirmation. The turn header
shows **Setup** or the current turn number. Keyboard users can select highlighted
positions with Enter or Space. Confirm/Cancel appears beside the selected piece
or hex, stays inside the map, and follows zoom and pan. Confirm is focused for
keyboard use; Escape cancels and returns focus to the selected location.

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
breakdown. Build controls are vertical rows with road, settlement, city, and
development-card icons alongside their costs. Buying a development card costs
one wool, one grain, and one ore; the trade button sits below the stack.
Owned development cards appear below as a vertical stack, one row per card with
a distinct card-type icon and a description below its title. The hand and card
dialog omit the "In your hand" and "New this turn" labels. Select a row to open
that card in the existing dialog; playing still requires confirmation and
action cards purchased this turn remain unavailable. The entire owned-card
section is hidden when your hand has no development cards.
After **Confirm Knight**, use **Cancel Knight** in the turn card or phone Board
prompt to return the card before confirming the robber move. This restores the
played-Knight count, Largest Army ownership, development-card allowance, and
previous turn phase. The map's **Cancel** or Escape only clears the selected hex.
Cancellation is unavailable after confirming the move, for a robber triggered
by seven, or when the Knight has already won the game.

Dice rolls settle before matching number tokens light up, their hexes lift with
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
viewports and write diagnostic screenshots to `test-results/`.

For a manual check, play solo and confirm that AI takes turns without any reveal
prompt and that only your own hand is available. Then finish setup with two or
three people, roll and resolve any robber choices, build and trade as resources
allow, and verify that a handoff shows no
private cards. Check zoom, keyboard placement, and end-game confirmation. Check
the collection tray after a second starting settlement, a producing roll, and a
bank trade in both Hand and Board views. Compare gain badges to resource totals,
and repeat with the operating system's reduced-motion setting enabled. Check that
rolls and placement previews leave the board stationary, matching numbers light
up instead of hex borders, and **Game > Table guide** opens without shifting the table.
Check that the Game menu closes with Escape or an outside click, and that closing
its dialogs returns focus to **Game**.
Viewport automation is not a claim of physical Android/iOS or local-network
compatibility; real-device multiplayer verification remains deferred.
