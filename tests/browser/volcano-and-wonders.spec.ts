import { expect, test } from "./fixtures";

test.describe("Volcano Islands and Custom World Volcanoes", () => {
  test("selects Volcano Islands, renders volcano hexes, and displays help in English and Japanese", async ({ page }) => {
    await page.goto("/?map=23456789&variant=volcano-islands");
    const islandTab = page.getByRole("button", { name: "Island", exact: true });
    const setupTab = page.getByRole("button", { name: "Setup", exact: true });
    if (await islandTab.isVisible()) await islandTab.click();
    await expect(page.locator(".volcano-artwork")).toHaveCount(3);

    if (await setupTab.isVisible()) await setupTab.click();
    const variantButton = page.getByRole("button", { name: "Game version" });
    await expect(variantButton).toContainText("Volcano Islands");

    await page.getByRole("button", { name: "Let's settle in" }).click();
    const navigation = page.getByRole("navigation", { name: "Game views" });
    if (await navigation.isVisible()) {
      await navigation.getByRole("button", { name: "board", exact: true }).click();
    }
    await expect(page.locator(".volcano-artwork")).toHaveCount(3);

    // Open Help and confirm Volcano Islands rules note robber exclusion.
    await page.getByRole("button", { name: "Game", exact: true }).click();
    await page.getByRole("button", { name: "Help", exact: true }).click();
    await expect(page.getByText(/The robber cannot be placed on a volcano/).first()).toBeVisible();
    await page.getByRole("button", { name: "Close dialog" }).click();

    // Switch to Japanese and verify translated help.
    await page.getByRole("button", { name: "Game", exact: true }).click();
    await page.getByRole("combobox", { name: "Language", exact: true }).selectOption("ja");
    await page.getByRole("button", { name: "ヘルプ", exact: true }).click();
    await expect(page.getByText(/盗賊は火山タイルには配置できません/).first()).toBeVisible();
  });

  test("configures Volcano tiles in Custom World and omits Wonders from the variant selector", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 680 });
    await page.goto("/?map=23456789&variant=custom-world");

    const setupTab = page.getByRole("button", { name: "Setup", exact: true });
    if (await setupTab.isVisible()) await setupTab.click();

    await page.getByRole("button", { name: "Game version" }).click();
    await expect(page.getByRole("option", { name: "Volcano Islands" })).toBeVisible();
    await expect(page.getByRole("option", { name: "Wonders of Catania" })).toHaveCount(0);
    await page.getByRole("option", { name: "Custom World" }).click();

    // Decrease Sea by 2 and increase Volcano by 2 in Custom World.
    const decreaseSea = page.getByRole("button", { name: "Decrease Sea tiles" });
    const increaseVolcano = page.getByRole("button", { name: "Increase Volcano tiles" });
    await decreaseSea.click();
    await decreaseSea.click();
    await increaseVolcano.click();
    await increaseVolcano.click();

    // Verify no horizontal overflow at 320px.
    const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(hasOverflow).toBe(false);

    const islandTab = page.getByRole("button", { name: "Island", exact: true });
    if (await islandTab.isVisible()) await islandTab.click();
    await expect(page.locator(".volcano-artwork")).toHaveCount(2);
  });

  test("animates a curved crater-to-corner volcano eruption and fades out cleanly without lingering", async ({ page }, testInfo) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.addInitScript(() => {
      // Return ~0.45 for single-Uint32 RNG draws so each die rolls 3 (total 6), guaranteeing an
      // eruption on Volcano Islands where outlying volcanoes always carry 6 and 8.
      const originalGetRandomValues = crypto.getRandomValues.bind(crypto);
      crypto.getRandomValues = ((array: ArrayBufferView) => {
        if (array instanceof Uint32Array && array.length === 1) {
          array[0] = 0x73333333;
          return array;
        }
        return originalGetRandomValues(array as Parameters<typeof crypto.getRandomValues>[0]);
      }) as typeof crypto.getRandomValues;
    });
    await page.goto("/?map=23456789&variant=volcano-islands");
    const setupTab = page.getByRole("button", { name: "Setup", exact: true });
    if (await setupTab.isVisible()) await setupTab.click();
    await page.getByRole("button", { name: "Let's settle in" }).click();

    const navigation = page.getByRole("navigation", { name: "Game views" });
    if (await navigation.isVisible()) {
      await navigation.getByRole("button", { name: "board", exact: true }).click();
    }

    // Complete both initial setup placements for the human player (bots place automatically).
    for (let round = 0; round < 2; round++) {
      await page.getByRole("button", { name: /^Place settlement at / }).first().click();
      const confirm = page.getByRole("button", { name: "Confirm" });
      if (await confirm.isVisible()) await confirm.click();
      await page.getByRole("button", { name: /^Build (road|ship) at / }).first().click();
      if (await confirm.isVisible()) await confirm.click();
    }

    const eruption = page.locator("[data-eruption-tile][data-eruption-vertex]");
    // Either a computer player rolls 6 first, or it becomes our turn to roll the dice.
    await expect.poll(async () => {
      if (await eruption.isVisible()) return "erupted";
      const rollButton = page.getByRole("button", { name: "Roll the dice" });
      if (await rollButton.isVisible() && await rollButton.isEnabled()) {
        await rollButton.click();
        return "rolled";
      }
      return "waiting";
    }, { timeout: 15000 }).not.toBe("waiting");

    await expect(eruption).toBeVisible();
    await expect(eruption.locator("line")).toHaveCount(0);
    await expect(eruption.locator(".board-volcano-scorch")).toHaveCount(0);
    await expect(eruption.locator(".board-volcano-lava-body")).toHaveCount(1);
    await expect(eruption.locator(".board-volcano-lava-core")).toHaveCount(1);
    await expect(eruption.locator(".board-volcano-crater-flare")).toHaveCount(1);
    await expect(eruption.locator(".board-volcano-smoke")).toHaveCount(3);
    await expect(eruption.locator(".board-volcano-impact-pool")).toHaveCount(1);

    const lavaPath = await eruption.locator(".board-volcano-lava-body").getAttribute("d");
    expect(lavaPath).toMatch(/^M [\d.-]+ [\d.-]+ C /);

    // Capture mid-eruption frame and post-fade frame when CAPTURE_SCREENSHOTS is enabled.
    if (process.env.CAPTURE_SCREENSHOTS && testInfo.project.name === "desktop") {
      const box = await eruption.boundingBox();
      expect(box).not.toBeNull();
      const clip = {
        x: Math.max(0, box!.x - 42),
        y: Math.max(0, box!.y - 42),
        width: box!.width + 84,
        height: box!.height + 84,
      };
      await page.waitForTimeout(550);
      await page.screenshot({ path: "test-results/volcano-eruption-mid.png", clip });
      await page.waitForTimeout(2100);
      await page.screenshot({ path: "test-results/volcano-eruption-cooled.png", clip });
    } else {
      await page.waitForTimeout(2400);
    }

    // Verify the active eruption fades out completely with no lingering mark.
    const lavaOpacity = await eruption.locator(".board-volcano-lava-body").evaluate(
      element => Number.parseFloat(getComputedStyle(element).opacity),
    );
    const poolOpacity = await eruption.locator(".board-volcano-impact-pool").evaluate(
      element => Number.parseFloat(getComputedStyle(element).opacity),
    );
    expect(lavaOpacity).toBe(0);
    expect(poolOpacity).toBe(0);
  });
});
