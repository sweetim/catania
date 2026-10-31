# Multiplayer Guide

[Back to README](../README.md) | [Gameplay guide](gameplay.md) | [Testing guide](testing.md)

Play with a shared board and private phones for three or four human players.
The shared screen hosts the game without occupying a player seat.

## Host And Join

1. Open the deployed website on the shared screen and choose **Play across devices**,
   then **Host board**. This browser runs the rules and holds the full game in memory.
2. Connect all devices to the same normal Wi-Fi. Each player scans the displayed
   QR code with their phone's camera, opens the link, and enters a distinct name.
   Scanning the invitation does not connect the phone to Wi-Fi.
3. Admit each player on the board. **Start game** becomes available with three or
   four admitted, connected phones. Turn order is randomized.
4. Place settlements, cities, and roads, and move the robber on the shared board.
   Select a build on the active player's phone or board, then confirm its location
   on the board. Phones keep their own cards visible and handle rolls, discards,
   trades, theft choices, development cards, and ending turns.

## Reconnect A Phone

A disconnected phone can use **Reconnect** or reload the invitation in the same
tab. Its room-specific reconnect credential is kept in `sessionStorage`; clearing
that storage, changing browsers, or opening a new tab can lose access to the seat.
Reconnection never uses a player's name as authorization. Admitted phones can
reclaim their existing seats while the original host remains open; there is no
mid-game replacement player.

## Privacy And Trust

The host screen renders a public projection, and each phone receives only public
state plus its own private hand and score. Other phones do not receive its private
hand. The trusted host browser still holds all hands. The host validates identities,
actions, versions, and rules; dice and other random outcomes are resolved there,
not on player phones. The shared board is a trusted input device: physical access
lets someone place pieces for the active player. Phones cannot place pieces or
impersonate another player.

## Network Requirements

PeerJS Cloud supplies connection signaling. It does not run game rules or store
gameplay. Gameplay uses encrypted WebRTC data channels with no configured STUN or
TURN servers, targeting directly reachable local peers. The website and QR image
are served/rendered by this application; no online QR-generation service is used.
Internet access is needed to load the deployed site and for signaling when joining
or reconnecting. This is not an entirely offline or entirely Vercel-only system.
Public PeerJS service availability is outside this application's control.

Guest Wi-Fi isolation, VPNs, firewalls, browser network restrictions, or suspended
phone tabs can interrupt or prevent connections. There is no relay fallback.

## Room Lifetime And Limits

Keep the host tab open and its device awake. Closing or refreshing the host loses
the room and game; host migration, saved-game recovery, multiplayer AI, and an
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
