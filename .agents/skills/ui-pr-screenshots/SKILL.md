---
name: ui-pr-screenshots
description: >-
  Capture deterministic before-and-after UI screenshots across desktop, tablet,
  mobile, and localized layouts using Playwright and publish them to an orphan
  Git branch for clean GitHub PR comparison tables. Use when asked to create a
  PR with before/after UI screenshots or compare responsive layouts.
---

# UI PR Before/After Screenshots

Produce identical-state before/after UI screenshots across responsive layouts
and embed them in a GitHub pull request without adding binary `.png` files to
the feature branch or `master`.

## Steps

1. **Capture "before" screenshots before editing code**:
   - Write a temporary script in the scratch directory (not inside the repo)
     that starts the app server (`NODE_ENV=production PORT=<port>`) and drives
     Playwright Chromium (`reducedMotion: "reduce"`, `serviceWorkers: "block"`,
     falling back to `/usr/bin/chromium` if Playwright's browser cache is absent).
   - In `context.addInitScript`, seed `catania.profiles` /
     `catania.profile.active` in `localStorage` to bypass the profile gate and
     override `crypto.getRandomValues` with a fixed-seed PRNG so `generateMapSeed()`
     rebuilds the exact same island in both `"before"` and `"after"` runs.
   - Capture viewport screenshots (`fullPage: false`) across key layouts:
     desktop (`1440×900`, `en-US` and `ja-JP`), laptop (`1024×768`), tablet
     (`768×1024`), mobile (`390×844`), and compact mobile (`320×568`).

2. **Implement, verify, and capture "after" screenshots**:
   - Create the feature branch, apply changes, and run typecheck, unit tests,
     build, and impacted Playwright specs.
   - Re-run the identical screenshot script with `"after"` and visually inspect
     all captured PNGs before committing.

3. **Commit cleanly with repository author identity**:
   - Check `git config user.email`; if unset, pass `-c user.name=<name> -c user.email=<email>`
     matching `git log -1 --format="%an <%ae>"` to `git commit` and `git commit-tree`
     instead of mutating global git config.

4. **Publish assets to an orphan ref and open the PR**:
   - Write the PNG blobs into git using plumbing (`git hash-object -w`,
     `git mktree`, `git commit-tree`, `git update-ref refs/heads/pr-assets/<branch> <sha>`)
     so the feature branch contains zero binary image files.
   - Push both `<branch>` and `pr-assets/<branch>` to `origin`.
   - Pass `--body-file` to `gh pr create` with a Markdown `Layout | Before | After`
     table embedding `https://github.com/<owner>/<repo>/blob/pr-assets/<branch>/<file>.png?raw=true`.

## Validation

- Confirm `git diff --stat master..<branch>` lists only intended source/test
  changes and no `.png` files.
- Confirm `git ls-tree --name-only pr-assets/<branch>` lists all expected before
  and after PNGs before creating the PR.
