# Gameplay Guide

[Back to README](../README.md) | [Multiplayer guide](multiplayer.md) | [Testing guide](testing.md)

This guide covers single-device play with local AI or human pass-and-play.
For a shared board and private phones, see the [multiplayer guide](multiplayer.md).

## Start A Game

The home screen fits one viewport, with setup and the island preview side by
side on desktop and wide landscape phones. On narrower screens, switch between
**Setup** and **Island**; return to **Setup** to start the game. **Play across
devices** remains available in either view. Very short windows scroll the settings
inside the setup card while its start button stays visible in the card footer.

The **On this device** card contains the local player settings and **Let's settle
in**, beneath the theme selector.
Under **Separate multiplayer setup**, **Play across devices** immediately hosts a shared
board for phones. It does not carry over these names, player counts, or the island
preview; multiplayer players and a new island are set up independently.

1. Choose **Original** (the default), **Seafarers**, **Four Islands**, or **Fog Islands** under **Game version**,
   then three or four total players and how many are human (one by default).
   AI fills the remaining seats. Enter distinct names and optionally **Shuffle**
   the island preview. **Let's settle in** starts on the island currently shown,
   including its terrain, number tokens, and harbors.
2. With one human, your hand opens automatically and stays available during AI turns.
   With multiple humans, pass the device to the named player before revealing their hand.
3. Place a settlement and road in forward order, then in reverse order. Your
   placements are previewed before confirmation; AI places its own pieces automatically.
4. Roll, gather resources, build, trade, and play eligible development cards.
   **Help** and on-screen costs explain the rules.
5. Trade with the bank or other players using the [trading controls](#trading).
6. Reach 10 victory points in Original, 13 in Seafarers (Heading for New Shores),
   or 12 in Four Islands or Fog Islands, on your own turn. Inspect the revealed score breakdown
   and restart on the same island, keep viewing the island, or return home. The victory panel also shows the
   game's **map code**.

## Player Profiles

On first visit the home screen asks **Who's playing?**: create a profile, or
continue as an existing one stored on this device. Each profile keeps lifetime
games, wins, and total points, and its name prefills the first human seat's
name in **Set up your table** (replacing the default placeholder). Use
**Menu > Profile** on the home or results screen to change or **Rename** a
profile; the first seat follows the active profile's name. Profiles cannot be
changed, edited, or deleted during an unfinished game, and in-game menus contain
no **Profile** action.

On the home and results screens, **Menu** is the circular avatar showing the
active profile's initial; invited phones also show it before joining. Profile
cards show games, wins, and total points separately and mark the current profile.
Use the pencil beside the name to rename a profile, the trash icon to delete it,
or the separate **Create a profile** form to add one. Deletion requires
confirmation and permanently removes that profile's local stats and game history.
Deleting the active profile clears its selection: choose another profile or
create one before continuing. Select a profile card, including the current one,
to return to the previous screen.

Solo play against computers (one human) credits the finished game to the active
profile that started the game — a win or loss with your final points — and the
victory panel shows that profile's totals. Pass-and-play with two or more humans records nothing,
since one device cannot attribute the game to a single player. Profiles live in
this browser only, under `catania.profiles`.

Expand **Game history** on a profile card to see completed solo and
multiplayer-phone games, newest first. Each entry shows the win/loss result,
selected game version/scenario, turn count, final victory points, and completion
date; the stored game ID and map code remain on the device for replay.
Unfinished games do not count. Existing lifetime totals are retained,
but individual games played before this feature cannot be reconstructed.

Choose **Replay map** on an entry to load that island and its matching game
version into single-device setup, then choose your players and start when ready.
End or finish the current game before accessing profiles and replaying history.
Replay recreates the initial island, not saved moves, dice rolls, or the previous game state.
The history stays on the device; only lifetime totals are shared with a host.

## Map Codes

Every island is generated from an 8-character **map code** (letters and digits
without the ambiguous I, L, O, 0, and 1). The current code is shown in the
**Map code** toolbar at the top of the island preview, both at home and in the
multiplayer host lobby. A code loads automatically when all 8 characters are
entered or pasted; Enter also submits the field. This rebuilds that exact island,
including terrain, number tokens, ports, and the
robber's start; the game version must match the original map. The victory panel
and multiplayer host lobby also display the current code so it can be noted for
later replays. Codes are not secrets: knowing a code only reproduces the island.
Incomplete codes leave the map unchanged until submitted. Invalid codes are
flagged beside the home map-code field.

The game includes the standard terrain and tokens, nine ports, finite resource
bank and development deck, piece limits, robber and discards, all development
cards, Longest Road, Largest Army, and hidden victory points. Builds, trades,
phase transitions, and turn ownership are validated by the rules engine.

## Seafarers: Heading For New Shores

Seafarers uses a randomized 42-hex layout: the original 19-hex main island,
three smaller islands, and 14 sea hexes. This is the four-player scenario layout,
also available with three players. Four Islands and Fog Islands are separate
choices in the same selector, with the shared ship, pirate, and route rules below.
Changing versions generates a matching preview without changing player settings or
the selected artwork theme. Shuffle preserves the version; starting keeps the
exact preview. A rematch keeps the version and generates a new board.
Game version cannot change during play and is not saved across reloads.

- Place both starting settlements on the main island. At a coastal starting
  settlement, choose **Build road** or **Build ship** in the board footer.
- A ship costs one wood and one wool. Each player has 15 ships, separately from
  their 15 roads. Ships occupy sea/coastal edges, connect to your ships or buildings,
  and cannot pass an opponent's building. Roads require a land edge.
- Roads and ships connect to each other only at your settlement or city.
  Both count toward **Longest Route**, worth two points for a continuous route
  of at least five pieces. Road Building can place either kind of piece for free.
- After rolling, **Move ship** lets you select an old open-ended ship, then a
  highlighted destination and confirm it. Movement is free, at most once per turn.
  A ship built this turn, a ship in a closed route between your buildings, or a
  ship beside the pirate cannot move. Removing a ship cannot leave its destination
  connected only through the removed piece.
- On a seven or Knight, choose a different land hex for the robber, a different
  sea hex for the pirate, or **Move pirate off board**. The pirate steals from one
  player with an adjacent ship; coastal buildings alone do not qualify. It prevents
  building and moving ships on its hex, but does not break existing routes, block
  ports, or stop land production. Knight can be cancelled before either token moves.
- Gold fields produce any available bank resource: one card per settlement or two
  per city. Eligible players choose in turn order, starting with the active player;
  pass-and-play hands switch to the next chooser. Finish these choices before
  continuing the turn. If the bank has fewer cards than owed, take what remains.
  The robber blocks gold production as it does ordinary terrain.
- Your first settlement on each small island earns two extra points, independently
  for every player. Further settlements on that island do not repeat the bonus,
  and upgrading to a city preserves it. A gold island badge with its settled-island
  count next to each player's VP indicates earned island points, and the final
  breakdown lists them with a settled-island count and per-island value. Win at 13
  points on your own turn.

Computer opponents can settle the islands, build ships, resolve pirate/theft and
gold choices, and complete games under the same rules as humans.

### Four Islands

A 42-hex map contains four disconnected islands on 16-24 resource hexes (each island
rerolls between four and six hexes per map, with sea filling the rest), using the
same layout rules for three or four players. Starting settlements may
be placed on any island. Each player's starting islands are recorded independently:
the first settlement on each other island earns two bonus points, even if another
player arrived there first. Starting islands never award this bonus. City upgrades
preserve earned bonuses. There is no desert; the robber begins off board and can
enter revealed land on the first seven or Knight. Win at 12 points on your own turn.

### Fog Islands

A 42-hex map begins with a revealed 19-hex main island and 23 fog hexes covering
every other tile. The intact main island slides among eight positions within the
map frame, chosen by the map code, instead of always occupying the south-west.
Use the same layout rules for three or four players. Place starting settlements
only on the main island. Fog has no visible terrain or number and cannot support
settlements or roads without adjoining revealed land; ships can approach it as water.

When an endpoint of a newly built road or ship, or a moved ship, touches fog,
reveal that hex for everyone. The seeded discovery deck contains eight resource
hexes, two gold fields, and 13 sea hexes. The pirate starts off board until revealed
sea becomes available. Starting roads and ships can also reveal adjacent fog.
A resource discovery grants one matching
bank card if available; gold grants one available resource of choice; sea grants
nothing. These rewards are separate from dice production. Resolve gold before
continuing a free Road Building placement or returning to the previous phase.
Revealed land can then support settlements and produce normally. Neither robber
nor pirate may enter unexplored fog. There are no island bonuses; win at 12 points
on your own turn. Computer opponents explore without inspecting the hidden deck.

Map codes reproduce each scenario's initial board and, for Fog Islands, discovery
deck; discoveries depend on which hexes are reached first. Multiplayer sends only
revealed tiles and fog placeholders, never the hidden discovery deck.

## Board And Controls

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
the turn-status card and controls stay visible below **Hand**, **Board**, and
**Players**, while the dice summary and bank remain above the selected view.
Short landscape phones place the selected view and turn controls side by side.
On unfolded foldables and small tablets (600-1023 pixels wide and at least 601
pixels tall), the board and hand appear side by side without view tabs or the
top logo header. The turn controls keep the **Game** menu accessible; the page
header remains available during private handoff.
Bank resource quantities sit below their icons inside each card, without overlapping badges.
On phones, switch between **Hand**, **Board**, and **Players**. Zoom the board to
enlarge placement targets, then scroll or drag inside it. The board footer contains
**Theme** alongside the zoom controls, without instruction or legend text. The
victory point target, such as **10 VP to win**, sits centered in the same bar;
it shortens to the bare number pair on the narrowest phones.
Short screens can scroll within the hand or player panel without moving the board.
On very short desktop windows, the entire sidebar scrolls internally so the status
card, turn controls, and hand tasks remain reachable.
Vertical scrollbar tracks are hidden throughout solo and multiplayer gameplay,
including menus and dialogs. Wheel, touch, and keyboard scrolling remain available;
home and lobby scrollbars are unchanged.

The turn header's **Game** icon menu sits beside the player name and turn-number
badge, matching private multiplayer screens. It contains **Language**, **Help**, and **Settings**, plus
**Pass device** when multiple humans have a hand revealed. **End game** sits below
a divider and still requires confirmation. **Reset game** also requires
confirmation and restores the original setup on the same island, with the same
players and turn order. It clears all pieces, hands, rolls, trades, and pending
actions without changing profiles, artwork, language, or board settings.
Cancelling keeps the current game intact. The turn header shows **Setup** or the
current turn number. During a private handoff, the menu stays in the page header.
Keyboard users can select highlighted positions with Enter or Space.
Confirm/Cancel appears beside the selected piece or hex, stays inside the map,
and follows zoom and pan, with the acting player's name and color above the
prompt. Confirm is focused for keyboard use; Escape cancels
and returns focus to the selected location.

## Themes And Settings

The selected **Board theme** shows three miniature hex tiles with the theme's
actual terrain artwork. Use **Change** before starting to open
**Choose your theme** and update the island preview immediately:
**Illustrated Island** (the default), **Mediterranean Ceramic**, **Carved Wooden Tabletop**,
**Pixel-Art Kingdom**, **Space Frontier**, or **Underwater Colonies**. During play,
the board footer's **Theme** button opens **Choose your theme**. Radio selections
apply immediately without closing the dialog; Close or Escape returns focus to
the opening control. The home island preview also has a **Theme** button.
Themes change only board and resource artwork and palettes, not names,
rules, pieces, turns, or resources. Switching preserves the current selection,
zoom, and pan. This browser remembers the choice across games and reloads in
`localStorage` under `catania.boardTheme`; unknown values or unavailable storage
fall back to Illustrated Island. Storage failures do not prevent switching themes
for the current session, and remembering a theme does not save the game.

Small crosses mark empty corners next to any settlement or city where the distance
rule prevents a new settlement. **Game > Settings > Show blocked settlement locations**
toggles these markers. They are on by default, and the preference is remembered in
this browser when storage is available, including across new games and reloads.
Unmarked corners are not necessarily buildable: roads, resources, remaining pieces,
and turn rules still apply. The setting does not save the game.

In single-device games, **Game > Settings > Fill board with water** extends the
current theme's water background across the entire map area, including its empty
margins. It is off by default, keeping the round water shape. Changes apply
immediately without changing the island, zoom, or pan. The preference also applies
to the island preview and pass-device board, and is remembered across new games
and reloads under `catania.fillBoardWithWater` when browser storage is available.
Unknown values or unavailable storage default to round; storage failures do not
prevent toggling for the current session. The board controls remain unchanged.

## Help And Rules

**Help** combines how to play, every build and purchase with costs and piece limits,
all five development-card types with their effects, timing, and starting deck counts,
and the game rules for production, trading, the robber, scoring, and awards.
This reference is available before play and on the results screen through the
header's **Help** button, and during play through **Game > Help**, even with an
empty hand. Each card type shows its original supply: 14 Knights, 5 Victory points,
and 2 each of Road building, Year of plenty, and Monopoly. These are not live
remaining counts. Help contains no current table activity or player details.
The dialog scrolls internally and supports Escape to close and restore focus
to its opener.

## Trading

For a player trade, use **Request cards** to ask for what you need and let other
players propose a price, or choose **Exact offer** to specify both sides.
AI responds automatically; pass the device for human responses. Compare prices
as **You give / You receive** cards and confirm one exchange. Unaffordable
prices show the exact missing cards and cannot be completed. Use **Change offer**
to keep the requested cards and choose payment from your hand. Closing the editor
keeps the original trade; submitting replaces it and asks for new responses.
No cards move until the active player confirms; withdraw to reject every response.

Bank trades show available quantities on the selection cards and preview the
resulting quantities without a duplicate hand summary. Player trades show what
**you give** and **you receive**, with current resources available through confirmation.

## Hand And Resource Selection

The hand shows large per-resource quantities and a total card count. Discard and
trade panels keep your current cards visible. Tap a resource card to add it to a
selection, use its minus button to remove it, and read the selected quantity on
the card. Discards show one selected/required progress line and the total left in
hand instead of repeating labels under every resource. Per-resource availability
and remaining quantities remain available to assistive technology.

Development-card purchases and resource choices for Year of Plenty or Monopoly
also show your current resources; Knight, Road Building, Victory Point, and theft
confirmation omit that summary. The device-handoff picker shows human names and
colors without detailed player cards; all private summaries disappear during handoff.

## Players And Awards

The Players list uses the same compact player items as the table seats, without
extra text labels or a repeated road-count footer. Seats show public card totals
as icon-and-number badges, with full tooltips and accessible descriptions, never another player's resource
breakdown. The score reads **VP** followed by one number: your revealed seat includes
public and hidden points, while other seats show only public points. There is no
separate total label. On tablets and desktops, all seats fit above the map without horizontal
scrolling. Narrow cards put the name above a horizontal row of counts; wider cards
retain the single-row layout. Player seats also show each player's played-Knight
count as a shield icon and number, followed by a road icon and their longest connected-road count,
including zero, on desktop and phones. These use matching icon sizes and gaps.
A gold crossed-swords icon marks Largest Army, and a matching gold road icon marks
Longest Road. In Seafarers games a matching gold island icon marks earned island
bonus points, with the settled-island count stacked beneath it and the exact total
in the tooltip. These reward icons sit together
immediately to the right of VP,
separate from the Knight and road counts. Each tooltip and accessible label includes
the award's victory points without adding a text badge.

Knights still in hand do not count: play at least three to qualify, and surpass
the current holder to take the award. A warm gold cell highlight marks the highest
public VP score without a crown icon, shared by tied leaders unless everyone is tied.
Names are vertically centered beside their avatars, without a repeated turn-status
line or dot. Settlements and cities show the same label as their owner's avatar:
an uppercase name initial for human players, and a seat number for computers.
Road and ship labels remain seat numbers. The active cell pulses its whole area in the active player's own
color, layered above any leader highlight but beneath the cell's contents;
reduced motion settles the pulse into a static tint of the same color. It moves
to the next player's cell when the turn changes without moving the layout. The
separate turn controls also identify the active player. Hidden victory-point
cards do not affect the cell highlights.

Trades and mandatory discards show the current viewer's owned resources inside
the active task instead of the normal hand panel. Both inventories highlight the
resource-card count when it exceeds seven.

## Building And Development Cards

**Build a little bigger** expands or collapses the build and trade controls. It
starts collapsed on phones and expanded on larger screens.
Build controls are vertical rows with road, settlement, city, and
development-card icons alongside their costs. Buying a development card costs
one wool, one grain, and one ore; the trade button sits below the stack.
A visible explanation beneath **Build settlement** appears only when all five of
your settlement pieces are on the board, prompting a city upgrade to free a piece.
A matching explanation beneath **Upgrade to city** appears when you already have
four cities on the board, or when you can afford a city but have no settlement to
upgrade. Each explanation is also associated with its button for screen readers;
the settlement one disappears when a settlement piece is freed and the city ones
when the limit no longer applies. Other restrictions still disable the
buttons and retain standard tooltips, but do not add descriptions beneath them.

Owned development cards appear below as a vertical stack, one row per card type
with a quantity badge, a distinct icon, and a description below its title. The
section heading counts all owned cards, including duplicates. The hand and card
dialog omit the "In your hand" and "New this turn" labels. Select a row to open
an older copy first when available in the existing, individual-card dialog;
playing still requires confirmation and action cards purchased this turn remain
unavailable. The entire owned-card section is hidden when your hand has no
development cards.

After **Confirm Knight**, use **Cancel Knight** in the turn card or mobile
Board prompt to return the card before confirming the robber move. This
restores the played-Knight count, Largest Army ownership, development-card allowance,
and previous turn phase. The map's **Cancel** or Escape only clears the selected hex.
Cancellation is unavailable after confirming the move, for a robber triggered
by seven, or when the Knight has already won the game.

## Dice And Resource Feedback

Dice show the actual rolled faces throughout the rolling animation, without
placeholder values. Rolls settle before matching number tokens light up, their
hexes lift with a deeper shadow, and resource totals update. Selected or
keyboard-focused robber destinations also lift, while click targets stay in
their original positions. Robber-blocked matches still lift but keep a muted,
dashed token ring rather than a production glow; hex borders do not flash.

Gained resource cards deal into an on-screen collection tray and animate over
stationary hand cards, followed by gain badges and a glow. The tray remains
visible while viewing the board and can be dismissed; it clears after a few
seconds or immediately on private handoff. It shows actual gains for the
revealed hand from starting settlements, dice, bank/player trades, and development
cards. Theft uses a separate private notice instead of the generic gain tray.

After a successful robbery, the victim sees who robbed them and the exact lost
resource card with **-1**. The thief sees who they stole from and the card with
**+1**. Notices float directly above the turn/dice panel, overlaying nearby content
without shifting the hand or controls, and disappear after five
seconds on-screen, or sooner with the dismiss button. In pass-and-play, each
player's unread notices wait until that player reveals their hand; neither the
handoff screen nor another player's hand shows them. Scrolling a notice out of
view or hiding the hand stops its timer until it is visible again. Multiple
notices appear one at a time, each with its own timer. Discarding, spending, and empty-hand theft attempts
do not produce robbery notices. Multiplayer uses the same private notices, while
the shared board and public activity never show the stolen resource.

A fixed-size roll summary stays visible in every phone view until the next action.
It shows larger dice beside **You received** resource cards with **+N** quantities
for the revealed player, including on short phone screens. Rolls without a personal
gain show a short message instead of cards. The tray omits the numeric total,
roll sentence, and description row. Computer turns wait for the roll sequence
to finish. Screen-reader announcements explain sevens, robber blocking, and bank
shortages without revealing another player's resource breakdown. Reduced-motion
settings show the result, collection cards, and static highlights immediately,
without animation delays.

## Computer Opponents

Computer opponents run locally without an AI service. They handle setup, turns,
building, development cards, discards, and robber choices using their own hand
and public information. They trade with the bank/ports, respond to exact offers,
and quote equal-count prices for resource requests when useful to their build plan.
Before trading with the bank, they can request their next build's missing cards
if their surplus can fund an equal-count price. They make at most one request
per turn, accept affordable prices that improve their build plan, and wait up to
15 seconds for unanswered players. If no suitable price arrives, they withdraw
the request and continue playing. In pass-and-play, use **Pass device** to reveal
a human hand and respond. Computers never inspect opponents' hands to set prices.
Their strategy balances resource production and dice coverage during setup, then
compares settlement, city, route, and development purchases by value, affordability,
and estimated production wait. Trades, discards, and gold choices support that
plan instead of a fixed build order. They can claim Longest Route even when it
opens no settlement site, and prioritize immediately winning builds.

Computers save resource and route development cards until after rolling. They
use Year of Plenty to finish a build, save Road Building when no useful expansion
or route award is available, and estimate Monopoly returns from public production
and hand sizes. Knights can unblock production or claim Largest Army before a
roll. Robber and theft choices favor public leaders while avoiding empty theft
victims and damage to their own production. These are local heuristics, not an
external AI service or an adjustable difficulty system.

## Privacy And Limits

- Single-device handoff screens are used only with multiple humans and remove
  private cards from the rendered page until revealed. AI hands cannot be opened
  through the UI. The shared browser still holds every hand; this is display
  privacy, not security.
- Refreshing or closing the tab loses the game. There is no saved-game recovery
  or mid-game replacement player.
- Single-device play uses no internet service, remote font, or remote game asset.
  Dependency and browser installation may need internet access.
- Shared-board play has separate [multiplayer privacy and network limitations](multiplayer.md).
