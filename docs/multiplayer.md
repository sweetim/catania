# Multiplayer Guide

[Back to README](../README.md) | [Gameplay guide](gameplay.md) | [Testing guide](testing.md)

Play with a shared board and three or four human or computer players. Human
players use private phones; computer opponents run automatically on the host.
The shared screen hosts the game without occupying a player seat.

## Host And Join

1. Open the deployed website on the shared screen and choose **Play across devices**.
   This screen immediately becomes the shared board and connects through PeerJS Cloud;
   it runs the rules and holds the full game in memory.
2. Connect all devices to the same local network; a wired Ethernet host and Wi-Fi
   phones can work together. Each human player scans the displayed
   QR code with their phone's camera, opens the link, and enters a distinct name.
   Scanning the invitation does not connect the phone to Wi-Fi.
   The copy icon immediately after the invitation URL copies the same link and shows
   a checkmark with **Copied** for two seconds. If clipboard access fails, select the
   URL to copy it manually.
3. Admit each human player on the board, or choose **Add computer** to fill a seat
   without a phone. Use **Remove** beside any player to free their seat before starting.
   Select a computer's name to rename it; names must be distinct and contain 1-20
   characters. Color-tinted avatars appear before names: a person for human players
   and a robot for computers.
   The lobby shows how many players are still needed and marks the fourth seat as
   optional. Pending join requests do not count until admitted. **Start game** becomes
   available with three or four total players and every human connected; disconnected
   humans are named in the readiness message. Turn order is randomized.
   The host's island preview shows the map that will be used.
   The host chooses **Original** or **Seafarers** under **Game version**; Original
   is the default. Changing the version regenerates the preview and synchronizes
   the choice to all phones without changing the roster. Seafarers uses Heading
   for New Shores with the same rules and layout described in the
   [gameplay guide](gameplay.md#seafarers-heading-for-new-shores).
   Choose **Shuffle** to generate another island before starting. Player changes and
   theme selection preserve the map; **Start game** uses the exact preview, including
   its terrain, number tokens, ports, and initial robber location. Phones cannot shuffle.
   The **Theme** button sits in the map's zoom bar, just as in single-device play,
   and opens the theme gallery in a dialog. Selecting a theme updates the map immediately.
   On desktop, the map fills the left column, with the invitation above the player
   controls on the right. The panels fit the viewport without page scrolling.
   Mobile stacks the map, invitation, and players and allows scrolling. The connected-status
   line is omitted from the host lobby; connection failures and recovery controls
   remain visible.
4. Place settlements, cities, and roads, and move the robber on the shared board.
   Select a build on the active player's phone, then confirm its location
   on the board; the confirmation shows the acting player's name and color. Phones keep their own cards visible and handle rolls, discards,
   trades, theft choices, development cards, and ending turns. Computers handle their
   own placements, turns, discards, and trade responses automatically; board input is
   disabled during their turns. Seats cannot be added, removed, or renamed mid-game.
   In Seafarers, ships and pirate moves also use the shared board. Choose **Build
   ship** or **Move ship** on your phone, then select and confirm on the board;
   moving a ship requires selecting its source and then its destination.
   During setup or Road Building, choose roads or ships on the phone or in the
   board footer. Gold-resource choices stay on the eligible player's private phone,
   including when it is another player's turn. The host cannot choose private
   gold resources, and phones cannot place or move ships directly.

## Shared Board Screen

Active gameplay shows only public player seats above the island, using the same
player cards and map as single-device play. The map fills the remaining viewport
without page scrolling. On tablets and larger screens, all seats fit without
horizontal scrolling; narrow cards place the name above a horizontal row of counts.
On phones, the player strip scrolls horizontally while the map remains visible.
Theme, zoom, and placement confirmation stay on the map. The header uses the same
**Game** dropdown as single-device play, in both the lobby and the game.
**Language** changes this device's interface language.
**Help** includes the rules, build costs, development-card reference, and
shared-board/private-phone guidance. **Settings** on the shared
screen controls blocked settlement markers and whether water fills the map;
these preferences are saved in this browser and shared with single-device play.
**Leave room** opens the existing confirmation: leaving as host ends the room for
everyone, while leaving as a player keeps their seat reserved while the host stays
open. Escape, clicking outside, or tabbing away dismisses the menu; closing its
dialogs returns focus to **Game**.

Player seats show numbered colors, public points, card counts, played Knights,
connected roads, and awards, with the same active-turn and public-score-leader
highlights as single-device play. Disconnected human players are marked. The shared
screen has no bank, regular build controls, dice/setup panel, activity panel, or view tabs.
In Seafarers, the map footer includes the free road/ship choice when needed and
the pirate's off-board move during robber/pirate movement.
Build selection, turn guidance, rolls, and private actions remain on players' phones.

## Private Player Screen

The header's **Game** dropdown contains **Language**, **Help**, and **Leave room**.
Board-only settings and single-device handoff controls are omitted from private phones.

A separate player-summary card sits above the hand, showing your seat number,
name, resource and development-card counts, played Knights, connected roads, and
your total victory points as **VP** followed by one number. It uses the shared player row, including active-turn and
public-score-leader highlights and awards. On narrow screens, the counts wrap onto
a second row.

The private screen uses the single-device hand sidebar's heading, resource-card
count, illustrated resources, and a single score combining public and hidden points.
The hidden score stays on your device only. **Build a little bigger** contains the
same full-width build and card-purchase rows, icons, and costs, followed by **Make a
trade**. This section is collapsible and starts open on every device, unlike
single-device play where phones start it closed. Your hand and the turn controls stay in a vertical stack on desktop and
mobile. On phones, the turn/dice panel stays visible while the hand scrolls above
it. Larger screens scroll the stack when needed, without page scrolling or shrinking
the action buttons. Phase guidance uses the same green instruction panel, headings,
and explanations as single-device play, with placement directions referring to
the shared board.

Owned development cards appear directly in the hand as the same grouped list of
icons, names, counts, and descriptions used in single-device play. The list is hidden
when empty. Selecting a row opens its inspector and prefers a copy eligible by
purchase turn. A long list scrolls with the rest of the hand; owning cards does not
change the build layout or stretch the hand panel.

Public player information is shown on the shared board; private phones omit the
Players & bank and Activity navigation buttons. Discard, theft, and
incoming trade choices open in dialogs; dismissing one keeps its action available
in the turn controls, even while builds are collapsed. Dialog contents can scroll on
small screens. Trades use illustrated **Bank & ports** selectors with rates, counts,
and an exchange preview, or **Player trade** with **Request cards** and **Exact
offer** choices. Open trades show every opponent's response, proposed prices, and
missing cards. **Change offer** edits a draft; closing it leaves the original offer
and responses unchanged. Choosing a trade partner, a theft victim, or **Buy a card**
opens a **Cancel** / **Confirm** dialog showing your name and color before sending
the action. Development cards
remain selectable for inspection, including hidden victory points and cards that
cannot yet be played; eligible action cards are confirmed in the same dialog.
Resource-affecting choices show your hand, and discards show selected and remaining
counts. Only your own development cards and exact resource counts are shown. The
host checks the state version of submitted choices, so an outdated dialog cannot
silently apply its selection to a changed game.

New rolls animate the actual dice received from the host without delaying game
state or computer turns. Reduced-motion settings skip the animation, and reconnecting
shows the current result without replaying an old roll.

Successful thefts show a dismissible private notice on both involved phones:
the victim sees who robbed them and the exact card lost (**-1**), and the thief
sees who they stole from and the card gained (**+1**). Notices overlay immediately
above the turn/dice panel without shifting the hand or controls, one at a time,
and disappear after five seconds
on-screen or manual dismissal. Off-screen notices wait until scrolled into view.
Public log entries remain generic and the shared
board receives no private theft details. Theft events and notice dismissals survive
reconnecting in the same page; reloading the page resets local notice dismissals.

## Reconnect A Phone

A disconnected phone can use **Reconnect** or reload the invitation in the same
tab. Its room-specific reconnect credential is kept in `sessionStorage`; clearing
that storage, changing browsers, or opening a new tab can lose access to the seat.
Reconnection never uses a player's name as authorization. Admitted phones can
reclaim their existing seats while the original host remains open; there is no
mid-game replacement player.

Removing a human from the lobby revokes their seat credential. Their phone receives
a removal notice and stops retrying automatically; **Reconnect** requests fresh
admission instead of restoring that seat. An offline removed phone has its old
credential rejected when it reconnects and can then request admission again.

## Privacy And Trust

The host screen renders a public projection, and each phone receives only public
state plus its own private hand, score, and theft events involving that player.
Other phones do not receive its private hand or uninvolved theft details. The
trusted host browser still holds all hands. The host validates identities,
actions, versions, and rules; dice and other random outcomes are resolved there,
not on player phones. The shared board is a trusted input device: physical access
lets someone place pieces for the active human player. Computers' hands are not
sent to phones or displayed on the board. Phones cannot place pieces or
impersonate another player.

## Network Requirements

PeerJS Cloud supplies connection signaling. It does not run game rules or store
gameplay. Google STUN (`stun:stun.l.google.com:19302`) helps browsers discover
reachable addresses while retaining local connection candidates. STUN receives
address-discovery traffic, not game messages, invitation secrets, or seat credentials.
Gameplay uses direct, encrypted WebRTC data channels; no TURN relay is configured.
The website and QR image
are served/rendered by this application; no online QR-generation service is used.
Internet access is needed to load the deployed site and for signaling when joining
or reconnecting; STUN discovery also uses an external service. This is not an entirely
offline or entirely Vercel-only system. Public PeerJS and STUN service availability
is outside this application's control. Local candidates may still connect if STUN
is unreachable.

Guest Wi-Fi isolation, VPNs, firewalls, browser network restrictions, or suspended
phone tabs can interrupt or prevent connections. There is no relay fallback.
STUN does not guarantee connectivity or bypass device isolation.

Connection errors distinguish these stages:

- **PeerJS signaling unavailable or timed out:** check internet access and keep
  both pages open. For an unavailable target, use the current host invitation.
- **Waiting for the host's connection answer:** the player registered with
  signaling, but no host answer was applied before the timeout. Keep the host
  active and use its latest invitation; this is not proof of a Wi-Fi failure.
- **Host answered, but direct WebRTC timed out or failed:** check device firewalls,
  VPNs, guest/client isolation, and browser network restrictions. Ethernet is supported;
  switching the host to Wi-Fi is not inherently required.
- **Connected, but waiting for initial game state:** the data channel opened, but
  no valid initial snapshot arrived. Keep the host browser active. Admission is
  separate: a waiting-for-admission snapshot already counts as a working connection.

Direct-connection errors include ICE connection and candidate-gathering states when
available, without addresses, session descriptions, invitation secrets, or credentials.
Automatic and manual retries clear the previous error when a fresh attempt begins.
Refreshing the host destroys the room; reload only the player page when retrying
an invitation in a reused tab.

## Room Lifetime And Limits

Keep the host tab open and its device awake. Closing or refreshing the host loses
the room and game; host migration, saved-game recovery, and an
in-room rematch are not provided. Create a new room for another game.

## Deploy To Vercel

Import this repository into Vercel. [`vercel.json`](../vercel.json) selects
`bun run build` and the `dist` output directory. The deployment is static: no
Vercel Functions, database, Blob store, Supabase account, or application secrets
are required. Use the deployed HTTPS URL on the host before generating invitations.
A QR generated at `localhost` points each phone at itself and cannot be used for a
physical-device check.

Browser automation does not establish physical Android/iOS compatibility or public
PeerJS Cloud availability. Use the [physical-device checklist](testing.md#physical-device-multiplayer)
to verify the deployed site on the intended Wi-Fi.
