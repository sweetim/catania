---
name: webapp-testing
description: Test and debug browser UI in Bun and Node.js projects using TypeScript and Playwright. Use after UI changes to verify interactions, inspect desktop and mobile layouts, capture screenshots, and diagnose browser errors.
license: Complete terms in LICENSE.txt
---

# Web Application Testing

Adapted from https://github.com/anthropics/skills/tree/main/skills/webapp-testing.
Local changes: replaced the upstream Python workflow and helpers with
Bun/TypeScript Playwright guidance. The upstream license is retained.

Use Playwright's JavaScript/TypeScript tooling, not Python. In Bun projects,
use Bun to manage dependencies and invoke commands. Follow the project's
existing test conventions instead of introducing another browser test framework.

## Check The Existing Setup

1. Read `AGENTS.md`, `package.json`, the lockfile, existing browser tests, and any
   `playwright.config.*` before changing tests or running commands.
2. Identify the development-server command, application URL, and affected routes
   from the project. Do not assume a port or invent selectors.
3. Check that `@playwright/test` and the required browser binaries are available.
   This skill does not install them. If missing, report the blocker and obtain
   approval before adding dependencies, configuration, or browser downloads.
4. Use an existing test script when available. Only use `bunx playwright` after
   confirming the project has the dependency; do not rely on automatic downloads.

## Run And Inspect The Application

- Reuse the existing Playwright `webServer` configuration when available.
- Otherwise, start the project's development server with the managed
  background-process tool when available, for example `bun run dev`. Wait for
  readiness and record its actual URL. Do not launch detached shell processes.
- Navigate to the affected route and inspect the rendered DOM before choosing
  locators. Prefer `getByRole`, `getByLabel`, and existing test identifiers.
- Capture relevant browser console errors, uncaught page errors, and failed
  application requests. Attach diagnostics to the test results when useful.
- Verify the affected desktop and mobile layouts. Capture screenshots and
  inspect them when image-viewing tooling is available.

## Write Focused TypeScript Tests

- Add or update tests for the changed behavior using `@playwright/test` when
  browser-test changes are in scope. Do not scaffold tests for a skill-only task.
- Exercise the real user interaction and assert its visible result, including
  relevant loading, error, or empty states.
- Use Playwright's auto-waiting locators and retrying `expect` assertions. Avoid
  fixed sleeps and blanket `networkidle` waits; assert the UI's readiness instead.
- Keep tests isolated. Use fixtures and test accounts, and avoid destructive
  operations against production services.
- Store screenshots and other artifacts with `testInfo.outputPath(...)` rather
  than hard-coded environment-specific directories.

Example pattern, assuming an existing Playwright configuration with `baseURL`:
replace the sample route and heading with the actual inspected UI.

```typescript
import { expect, test } from "@playwright/test";

test("the application renders", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Application" }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("application.png"),
    fullPage: true,
  });
});
```

## Execute And Report

Once the existing dependency and configuration are confirmed, run the affected
test first, then the relevant browser suite. Substitute the actual test path:

```bash
bunx playwright test tests/affected-page.spec.ts
bunx playwright test
```

- Use `--headed` or `--debug` only when an interactive display is available.
- Stop only development servers started for this task. Leave existing servers
  and unrelated processes running.
- Report the exact commands, pass/fail results, routes and viewports checked,
  and any verification that could not be completed.
- Provide concise manual testing steps for the affected UI. Do not claim a
  browser check passed when only source inspection or test discovery was done.
