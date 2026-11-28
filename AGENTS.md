## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:

- **Important** Present your plan to the user and wait for their approval before
  writing any code.
- **Important** When the user requests a revision to previous work, always
  confirm the approach with the user before implementing.
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.
- Propose fixes that address the root cause, not symptoms or workarounds.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes,
simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.
- Detected file changes unrelated to your own work may be caused by other agents
  editing the same files. Ignore them and focus only on the changes you made
  yourself.

When your changes create orphans:

- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:

- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it
work") require constant clarification.

## 5. Keep Docs And Verify UI In Sync

**Docs track the code. UI changes need human eyes.**

- After code changes that affect documented behavior, update the relevant docs
  (README, AGENTS.md, inline docs) to match the new behavior.
- Invoke Bun via `mise exec -- bun ...` when `mise` is trusted and available;
  in sandboxed or non-interactive shells where `mise` prompts for trust, lacks
  `$HOME/.local/share/mise`, or resolves unrelated global tools, invoke
  `$HOME/.local/share/mise/installs/bun/latest/bin/bun` directly (e.g.
  `bun install --frozen-lockfile --offline`), or run `./node_modules/bun/bin/bun.exe`
  and the platform `tsgo` binary under `node_modules/@typescript/` inside the
  sandbox once `node_modules` is installed. If `~/.cache/ms-playwright` is
  absent, pass `executablePath: "/usr/bin/chromium"` via a scratch Playwright
  config rather than editing `playwright.config.ts`.
- After any UI or `RoomSnapshot`/protocol change, check single-device and
  multi-device parity, both `en` and `ja` localization, and desktop + narrow
  mobile (`320px`) / unfolded layouts.
- After UI-related changes, add or update automated UI tests for the affected
  behavior and run them. When modifying shared components, visible labels,
  selectors, or snapshot fields, grep `tests/browser/` for all affected
  assertions and run every impacted test—not only newly added tests. Always run
  `mise exec -- bun run typecheck` and `mise exec -- bun run test:browser --list`
  after editing browser specs. Report test results and any verification that
  could not be completed.
- Multiple agents work on this workspace concurrently. For every Playwright run,
  always isolate ports, output directories, and worker count:
  `PLAYWRIGHT_PORT=<p1> PLAYWRIGHT_SIGNALING_PORT=<p2> PLAYWRIGHT_HTML_OUTPUT_DIR=playwright-report/<run> mise exec -- bun run test:browser --output=test-results/<run> --workers=4 <spec-or-grep>`
- This workspace runs over Remote SSH, where arbitrary `127.0.0.1:<port>` or
  `localhost:<port>` dev servers are not reachable from VS Code's integrated
  browser (`openBrowserPage`). Verify UI changes via Playwright browser tests
  and inspect their captured screenshots; only use `openBrowserPage` with a
  known reachable host/IP (`HOST=<host>`).
- Project skills live in `.agents/skills/`, not `.kilo/skills/`; the root
  `kilo.json` loads them via `skills.paths`. Put new skills there.

## 6. Learn From User Feedback

**Capture reusable lessons, not conversation history.**

- Treat explicit user corrections and stated long-term preferences as
  candidates for reusable project rules. Do not turn one-off requests or
  inferred preferences into permanent instructions.
- Check existing instructions first. If the lesson is already covered,
  follow the existing rule instead of adding a duplicate.
- For a new reusable lesson, propose the exact instruction change and obtain
  user approval before editing AGENTS.md.
- Prefer refining the relevant existing rule over adding a new section.
  Keep each lesson concise, actionable, and scoped to this project.
- If feedback conflicts with an existing rule, confirm whether it is a
  one-time exception or a lasting replacement before changing instructions.
- Never persist secrets, personal information, raw conversation transcripts,
  or temporary task details.

# Coding Rules

- Use `type` instead of `interface` when defining TypeScript types to ensure
  consistency and avoid unintended interface merging.
- Prefer [`ts-pattern@5`](https://github.com/gvergnaud/ts-pattern) for pattern
  matching and exhaustive type handling whenever possible.
- Don't use abbreviations, always use full names.
- Use `tsgo` instead of `tsc` for typechecking (e.g. `bun run typecheck` or
  `tsgo --noEmit`); the project uses `@typescript/native-preview`.
