import { expect, test } from "@playwright/test";

// Repro: an AI rolls a 7. Who gets to choose the robber movement?
// The human must NOT see "Move robber to ..." buttons while a computer is
// controlling the robber phase. Also detects a stall where the AI never
// resolves its own robber phase.
test("AI-rolled seven keeps robber control with the AI", async ({ page }, testInfo) => {
  test.setTimeout(220_000);

  const moveRobber = page.getByRole("button", { name: /^Move robber to / });
  const computerStatus = page.getByRole("status", { name: "Computer activity" }).first();
  const dice = page.getByRole("img", { name: /^Dice[,:] / });
  const rollButton = page.getByRole("button", { name: "Roll the dice", exact: true });
  const endTurn = page.getByRole("button", { name: /End turn/ }).first();
  const confirmDiscard = page.getByRole("button", { name: "Confirm discard", exact: true });

  page.on("pageerror", error => testInfo.attach(`pageerror-${Date.now()}`, { body: String(error), contentType: "text/plain" }));

  await page.goto("/");
  await page.getByRole("button", { name: "Let's settle in", exact: true }).click();

  // Single human: setup placements appear whenever it is this human's turn.
  for (let placement = 0; placement < 2; placement++) {
    const settlement = page.getByRole("button", { name: /^Place settlement at/ }).first();
    await settlement.waitFor({ state: "visible", timeout: 60_000 });
    await settlement.click();
    await page.getByRole("button", { name: "Confirm placement", exact: true }).click();
    const road = page.getByRole("button", { name: /^Build road at/ }).first();
    await road.waitFor({ state: "visible", timeout: 10_000 });
    await road.click();
    await page.getByRole("button", { name: "Confirm placement", exact: true }).click();
    await page.waitForTimeout(600);
  }

  async function diceTotal(): Promise<number | null> {
    const label = await dice.getAttribute("aria-label").catch(() => null);
    if (!label) return null;
    const values = label.match(/(\d)\D+(\d)/);
    if (!values) return null;
    return Number(values[1]) + Number(values[2]);
  }

  async function handleHumanRobber() {
    const first = moveRobber.first();
    await first.waitFor({ state: "visible", timeout: 3_000 });
    await first.click();
    await page.getByRole("button", { name: "Confirm placement", exact: true }).click();
    await page.waitForTimeout(300);
    const victims = page.locator("section").filter({
      has: page.getByRole("heading", { name: "Choose a player to steal from", exact: true }),
    });
    if (await victims.count()) {
      await victims.getByRole("button").first().click();
      await page.getByRole("dialog", { name: "Confirm theft" }).getByRole("button", { name: "Confirm", exact: true }).click();
    }
  }

  async function handleHumanDiscard() {
    await confirmDiscard.waitFor({ state: "visible", timeout: 3_000 });
    const guidance = await page.getByText(/Choose exactly \d+ resources/).first().innerText();
    const needed = Number(guidance.match(/Choose exactly (\d+)/)![1]);
    for (let index = 0; index < needed; index++) {
      const addButtons = page.getByRole("button", { name: /^Add \w+ to Return to the bank$/ });
      const enabled = addButtons.filter({ has: page.locator(":enabled") }).first();
      // Click the first enabled add button; wait for the count text to update.
      await enabled.click();
      await page.waitForTimeout(80);
    }
    await expect(confirmDiscard).toBeEnabled();
    await confirmDiscard.click();
    await page.waitForTimeout(400);
  }

  const deadline = Date.now() + 180_000;
  let aiSevenSeen = false;
  let lastProgress = Date.now();
  let lastDice: number | null = null;
  const violations: string[] = [];

  while (Date.now() < deadline) {
    // 1) Violation check: human gets robber buttons while a computer controls the game.
    if ((await moveRobber.count()) > 0 && (await computerStatus.count()) > 0) {
      violations.push(`Human saw ${await moveRobber.count()} robber buttons while computer controls the game`);
      await page.screenshot({ path: testInfo.outputPath("violation-robber-control.png"), fullPage: true });
      break;
    }

    const total = await diceTotal();
    if (total !== lastDice) {
      lastDice = total;
      lastProgress = Date.now();
    }

    // 2) Human's own duties.
    if (await rollButton.isVisible().catch(() => false)) {
      if (await rollButton.isEnabled()) {
        await rollButton.click();
        await page.waitForTimeout(1700);
        if ((await diceTotal()) === 7) {
          // The human's own seven: robber choice belongs to the human.
          if ((await moveRobber.count()) > 0) await handleHumanRobber();
        }
        lastProgress = Date.now();
        continue;
      }
    }
    if (await confirmDiscard.isVisible().catch(() => false)) {
      await handleHumanDiscard();
      lastProgress = Date.now();
      continue;
    }
    if ((await moveRobber.count()) > 0 && (await computerStatus.count()) === 0) {
      await handleHumanRobber();
      lastProgress = Date.now();
      continue;
    }
    if (await endTurn.isVisible().catch(() => false) && await endTurn.isEnabled()) {
      await endTurn.click();
      await page.waitForTimeout(400);
      lastProgress = Date.now();
      continue;
    }

    // 3) AI activity: a seven observed without the human rolling is an AI seven.
    if (total === 7 && !(await rollButton.isVisible().catch(() => false))) {
      if (await computerStatus.isVisible().catch(() => false)) {
        aiSevenSeen = true;
        await page.screenshot({ path: testInfo.outputPath(`ai-seven-${Date.now()}.png`), fullPage: true });
      }
    }

    // 4) Stall detection: nothing progresses for 25 seconds.
    if (Date.now() - lastProgress > 25_000) {
      if (await computerStatus.isVisible().catch(() => false)) {
        violations.push("Stall: computer controls the game but nothing progressed for 25s");
        await page.screenshot({ path: testInfo.outputPath("violation-stall.png"), fullPage: true });
      }
      lastProgress = Date.now();
    }

    await page.waitForTimeout(120);
  }

  console.log(JSON.stringify({ aiSevenSeen, violations }));
  expect(violations, "robber control violations").toEqual([]);
  expect(aiSevenSeen, "an AI seven was observed during the run").toBe(true);
});
