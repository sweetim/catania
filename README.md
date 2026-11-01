# Catania

A Catan-style base game with single-device play for 1-4 humans (AI fills a 3-4
player table), or a shared board with private human phones and computer opponents
at a 3-4 player table.
Built with Bun, React 19, TypeScript, and Tailwind CSS v4. All illustrations and
assets are local.

## Features

- Solo AI opponents or human pass-and-play on one device.
- Shared-board multiplayer with QR invitations, private phone hands, and optional computer opponents.
- Base-game rules, trading, development cards, Longest Road, and Largest Army.
- Six board themes, responsive layouts, and keyboard-accessible placement controls.
- English and Japanese interfaces, including help, accessible controls, activity, and errors.

## Quick Start

Install dependencies, then start the development server:

```bash
bun install
bun run dev
```

Open the URL printed by Bun (normally `http://localhost:3000`). Use
`PORT=3001 bun run dev` to choose another port.

## Language

The initial language follows the first supported language in your browser's
preferences: Japanese (`ja`, including `ja-JP`) or English (`en`, including regional
variants). If neither is listed, the interface uses English.

Use **Game > Language** to choose **English / 日本語** wherever the Game menu is
available. Other screens keep the selector in the header. Close any open dialog
to access these controls.
A manual choice is saved under `catania.language` in `localStorage` and overrides
browser preferences on later visits. Invalid saved values are ignored. When storage
is blocked, switching still works for the current visit and the next visit uses the
browser locale again. Automatic detection does not save an override.

Language is independent of the game: switching preserves the board, current turn,
private hand, and multiplayer connection. Each multiplayer device chooses its own
language, including for activity and errors. Player-entered names are not translated.
New computer names use the language selected when they are added; existing names
stay unchanged when switching languages.
Documentation uses the English control names.

## Build And Deploy

`bun run build` produces a static browser bundle in `dist/`.
`bun run start` runs a production-mode source server through Bun; it does not
serve `dist/`.

For Vercel, import the repository. [`vercel.json`](vercel.json) configures the
build command and output directory; no application backend or secrets are needed.
For multiplayer, open the deployed HTTPS URL before generating invitations.
See the [multiplayer guide](docs/multiplayer.md) for setup and network requirements.

## Verify

```bash
bun run test
bun run typecheck
bun run build
bun run test:browser
```

Browser tests require Chromium: `bunx playwright install chromium`.
See the [testing guide](docs/testing.md) for test ports and manual checks.

## Limitations

- Games live in memory. Refreshing or closing the single-device game or multiplayer
  host loses the game; there is no saved-game recovery.
- Multiplayer targets devices on the same local network, including Ethernet and
  Wi-Fi together. It uses PeerJS Cloud signaling and Google STUN address discovery,
  requires internet access, and has no relay fallback.
- Single-device handoff hides cards on screen, but the shared browser holds all hands.

## Documentation

- [Gameplay guide](docs/gameplay.md): setup, controls, trading, cards, themes, and AI.
- [Multiplayer guide](docs/multiplayer.md): hosting, joining, privacy, and reconnection.
- [Testing guide](docs/testing.md): automated checks and manual verification.
- [Architecture](docs/architecture.md): implementation and historical design proposals.
- [Requirements](docs/requirements.md): current scope and original product plans.
