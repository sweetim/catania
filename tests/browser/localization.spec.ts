import { expect, test as base, type Page } from "@playwright/test";

const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    page.on("requestfailed", request => errors.push(`${request.failure()?.errorText}: ${request.url()}`));
    await use(page);
    await testInfo.attach("localization-diagnostics", { body: JSON.stringify(errors), contentType: "application/json" });
    expect(errors).toEqual([]);
  },
});

async function expectLanguage(page: Page, language: "en" | "ja") {
  await expect(page.locator("html")).toHaveAttribute("lang", language);
  // The selector can live inside a closed menu, where role queries cannot reach it.
  await expect(page.locator(`select[aria-label="${language === "ja" ? "言語" : "Language"}"]`)).toHaveValue(language);
}

async function expectNoHorizontalOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)))
    .toBeLessThanOrEqual(page.viewportSize()!.width);
}

async function selectInGameLanguage(page: Page, currentLanguage: "en" | "ja", nextLanguage: "en" | "ja") {
  await page.getByRole("button", { name: currentLanguage === "ja" ? "ゲーム" : "Game", exact: true }).click();
  await page.getByRole("combobox", { name: currentLanguage === "ja" ? "言語" : "Language", exact: true }).selectOption(nextLanguage);
  await page.keyboard.press("Escape");
}

async function selectHomeLanguage(page: Page, currentLanguage: "en" | "ja", nextLanguage: "en" | "ja") {
  await page.getByRole("button", { name: currentLanguage === "ja" ? "メニュー" : "Menu", exact: true }).click();
  await page.getByRole("combobox", { name: currentLanguage === "ja" ? "言語" : "Language", exact: true }).selectOption(nextLanguage);
  await page.keyboard.press("Escape");
}

test.describe("Japanese browser locale", () => {
  test.use({ locale: "ja-JP" });

  test("Seafarers selection and rules localize without changing the selected version", async ({ page }) => {
    await page.goto("/");
    const versions = page.getByRole("combobox", { name: "ゲームの種類", exact: true });
    await expect(versions).toHaveValue("original");
    await versions.selectOption("seafarers");
    await expect(page.locator(".terrain-hex")).toHaveCount(42);
    await page.getByRole("button", { name: "メニュー", exact: true }).click();
    await page.getByRole("button", { name: "ヘルプ", exact: true }).click();
    const help = page.getByRole("dialog", { name: "ヘルプ", exact: true });
    await expect(help.getByRole("heading", { name: "航海者のルール", exact: true })).toBeVisible();
    await expect(help.getByText("よき隣人、巧みな交易。目指すは13勝利点。", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await selectHomeLanguage(page, "ja", "en");
    await expect(page.getByRole("combobox", { name: "Game version", exact: true })).toHaveValue("seafarers");
    await expect(page.locator(".terrain-hex")).toHaveCount(42);
    await expectNoHorizontalOverflow(page);
  });

  test("defaults to Japanese, remembers a manual choice, and shares it between modes", async ({ page }, testInfo) => {
    await page.goto("/");
    await expectLanguage(page, "ja");
    await expect(page.locator("h1")).toContainText(/[\u3040-\u30ff\u3400-\u9fff]/);
    await expect(page).toHaveTitle("Catania | 小さな島、無限の可能性");
    expect(await page.evaluate(() => localStorage.getItem("catania.language"))).toBeNull();
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath("japanese-home.png"), fullPage: true });

    await selectHomeLanguage(page, "ja", "en");
    await expectLanguage(page, "en");
    await expect(page.getByRole("button", { name: "Let's settle in" })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("catania.language"))).toBe("en");
    await page.reload();
    await expectLanguage(page, "en");
    await page.routeWebSocket(/\/peerjs\?/, () => {});
    await page.getByRole("link", { name: "Play across devices" }).click();
    await expect(page.getByRole("heading", { name: "Scan. Join. Settle in.", exact: true })).toBeVisible();
    await expectLanguage(page, "en");
    await page.getByRole("button", { name: "Game", exact: true }).click();
    await expect(page.getByRole("group", { name: "Game menu", exact: true }).getByRole("button")).toHaveText(["Help", "Settings", "Leave room"]);
    await page.getByRole("combobox", { name: "Language", exact: true }).selectOption("ja");
    await expectLanguage(page, "ja");
    await expect(page.locator("h1")).toContainText(/[\u3040-\u30ff\u3400-\u9fff]/);
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath("japanese-multiplayer-setup.png"), fullPage: true });
    await page.goto("/");
    await expectLanguage(page, "ja");
  });

  test("ignores invalid saved languages and still switches when storage is blocked", async ({ page }) => {
    await page.addInitScript(() => {
      try { localStorage.setItem("catania.language", "jp"); } catch { /* Storage is blocked in the second visit. */ }
    });
    await page.goto("/");
    await expectLanguage(page, "ja");
    await page.addInitScript(() => {
      Object.defineProperty(window, "localStorage", { get() { throw new DOMException("Blocked", "SecurityError"); } });
    });
    await page.reload();
    await expectLanguage(page, "ja");
    await selectHomeLanguage(page, "ja", "en");
    await expectLanguage(page, "en");
    await expect(page.getByRole("button", { name: "Let's settle in" })).toBeVisible();
  });
});

test("falls back to English for unsupported locales", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "languages", { value: ["fr-FR", "de-DE"] });
    Object.defineProperty(navigator, "language", { value: "fr-FR" });
  });
  await page.goto("/");
  await expectLanguage(page, "en");
  await expect(page.getByRole("button", { name: "Let's settle in" })).toBeVisible();
});

test("uses the browser language when its preferred-language list is empty", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "languages", { value: [] });
    Object.defineProperty(navigator, "language", { value: "ja-JP" });
  });
  await page.goto("/");
  await expectLanguage(page, "ja");
});

test("home language selection and help live inside the Menu dropdown", async ({ page }, testInfo) => {
  await page.goto("/");
  const menuButton = page.getByRole("button", { name: "Menu", exact: true });
  const menu = page.getByRole("group", { name: "Main menu", exact: true });
  const languageSelector = page.getByRole("combobox", { name: "Language", exact: true });

  await expect(menuButton).toBeVisible();
  await expect(languageSelector).toHaveCount(0);
  await menuButton.focus();
  await page.keyboard.press("Enter");
  await expect(menuButton).toHaveAttribute("aria-expanded", "true");
  await expect(menu.getByRole("button")).toHaveText(["Help"]);
  await expect(languageSelector).toBeVisible();
  await expect(languageSelector).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: testInfo.outputPath("home-menu-language-open.png"), fullPage: true });
  await languageSelector.selectOption("ja");
  await expect(page.locator("html")).toHaveAttribute("lang", "ja");
  await expect(page.getByRole("group", { name: "メインメニュー", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("group", { name: "メインメニュー", exact: true })).toBeHidden();
  await expect(page.getByRole("button", { name: "メニュー", exact: true })).toBeFocused();

  await page.getByRole("button", { name: "メニュー", exact: true }).click();
  await page.getByRole("button", { name: "ヘルプ", exact: true }).click();
  const help = page.getByRole("dialog", { name: "ヘルプ", exact: true });
  await expect(help).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "メニュー", exact: true })).toBeFocused();
});

test("in-game language selection lives inside the Game menu", async ({ page, isMobile }, testInfo) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Let's settle in" }).click();
  const gameButton = page.getByRole("button", { name: "Game", exact: true });
  const menu = page.getByRole("group", { name: "Game menu", exact: true });
  const languageSelector = page.getByRole("combobox", { name: "Language", exact: true });

  await expect(gameButton).toBeVisible();
  await expect(page.getByRole("combobox")).toHaveCount(0);
  await gameButton.focus();
  await page.keyboard.press("Enter");
  await expect(gameButton).toHaveAttribute("aria-expanded", "true");
  await expect(languageSelector).toBeVisible();
  await expect(languageSelector).toBeInViewport({ ratio: 1 });
  expect((await languageSelector.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.keyboard.press("Tab");
  await expect(menu.getByRole("button", { name: "Help", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(menu.getByRole("button", { name: "Settings", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(languageSelector).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath("game-menu-language-open.png"), fullPage: true });
  await languageSelector.selectOption("ja");
  await expect(page.locator("html")).toHaveAttribute("lang", "ja");
  await expect(page.getByRole("group", { name: "ゲームメニュー", exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "言語", exact: true }).selectOption("en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(menu).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("catania.language"))).toBe("en");
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(gameButton).toBeFocused();

  if (isMobile) {
    await gameButton.tap();
    await expect(languageSelector).toBeVisible();
    await languageSelector.selectOption("ja");
    await expect(page.getByRole("group", { name: "ゲームメニュー", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
  }
});

test("Japanese help, themes, handoffs, board controls, and settings remain usable", async ({ page, isMobile }, testInfo) => {
  await page.goto("/");
  await selectHomeLanguage(page, "en", "ja");
  await page.getByRole("button", { name: "メニュー", exact: true }).click();
  await page.getByRole("button", { name: "ヘルプ", exact: true }).click();
  const help = page.getByRole("dialog", { name: "ヘルプ", exact: true });
  await expect(help.getByRole("heading", { name: "遊び方", exact: true })).toBeVisible();
  await expect(help.getByRole("heading", { name: "建設と費用", exact: true })).toBeVisible();
  await expect(help).toContainText("騎士");
  await expect(help).toContainText("最長交易路");
  await expect(help).toContainText("1台の端末で、みんなと遊ぶ。");
  await page.screenshot({ path: testInfo.outputPath("japanese-help.png"), fullPage: true });
  await page.keyboard.press("Escape");

  await page.getByRole("region", { name: "ゲームの準備", exact: true }).getByRole("button", { name: "テーマを変更", exact: true }).click();
  const themes = page.getByRole("dialog", { name: "テーマを選択", exact: true });
  await expect(themes.getByRole("radio")).toHaveCount(6);
  await themes.getByRole("radio", { name: /宇宙の開拓地/ }).check();
  await page.keyboard.press("Escape");
  await expect(page.locator(".home-theme")).toContainText("宇宙の開拓地");

  await page.getByRole("combobox", { name: "人間のプレイヤー" }).selectOption("3");
  await page.getByRole("textbox", { name: "プレイヤー1の名前" }).fill("太郎");
  await page.getByRole("textbox", { name: "プレイヤー2の名前" }).fill("太郎");
  await page.getByRole("textbox", { name: "プレイヤー3の名前" }).fill("Alex");
  await page.getByRole("button", { name: "開拓を始めよう" }).click();
  await expect(page.getByRole("alert")).toContainText("異なる名前");
  await selectHomeLanguage(page, "ja", "en");
  await expect(page.getByRole("alert")).toHaveText("Use a different name for each player so private handoffs are clear.");
  await selectHomeLanguage(page, "en", "ja");
  await page.getByRole("textbox", { name: "プレイヤー2の名前" }).fill("花子");
  await page.getByRole("button", { name: "開拓を始めよう" }).click();
  await expect(page.getByRole("heading", { name: /に端末を渡してください。$/ })).toBeVisible();
  await expect(page.locator(".hand-resources")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("japanese-handoff.png"), fullPage: true });
  await page.getByRole("button", { name: /^私は.+です。手札を表示$/ }).click();

  await page.getByRole("button", { name: "ゲーム", exact: true }).click();
  await page.getByRole("button", { name: "設定", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "設定", exact: true })).toBeVisible();
  await page.getByRole("checkbox", { name: "地図全体を海で埋める" }).check();
  await page.keyboard.press("Escape");

  const board = page.getByRole("region", { name: "ゲームボード", exact: true });
  await expect(board.getByRole("group", { name: "地図の拡大・縮小操作", exact: true })).toBeVisible();
  await expect(board.locator(".board-map > svg")).toHaveAccessibleName(/地形タイル19枚と沿岸の港9か所/);
  const location = board.getByRole("button", { name: /に開拓地を配置$/ }).first();
  await location.focus();
  await page.keyboard.press("Enter");
  const confirmation = page.getByRole("group", { name: "配置の確認", exact: true });
  await expect(confirmation.getByRole("button", { name: "配置を確定", exact: true })).toBeFocused();
  const selection = await confirmation.getAttribute("data-selection-id");
  await selectInGameLanguage(page, "ja", "en");
  await expect(page.getByRole("group", { name: "Placement confirmation", exact: true })).toHaveAttribute("data-selection-id", selection!);
  await expect(page.getByText("Settle here?", { exact: true })).toBeVisible();
  await selectInGameLanguage(page, "en", "ja");
  await expect(confirmation).toHaveAttribute("data-selection-id", selection!);
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("japanese-placement.png"), fullPage: true });
  await confirmation.getByRole("button", { name: "配置を確定", exact: true }).click();
  await expect(board.getByRole("button", { name: /に街道を建設$/ }).first()).toBeVisible();

  if (isMobile) {
    await page.getByRole("navigation", { name: "ゲームの表示切り替え", exact: true }).getByRole("button", { name: "手札", exact: true }).click();
  }
  await expect(page.locator(".hand-resource-card").filter({ hasText: "木材" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("japanese-hand.png"), fullPage: true });
  await page.setViewportSize({ width: 320, height: 568 });
  await expectNoHorizontalOverflow(page);
  await expect(page.getByRole("button", { name: "ゲーム", exact: true })).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole("combobox")).toHaveCount(0);
  await page.getByRole("button", { name: "ゲーム", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "言語", exact: true })).toBeInViewport({ ratio: 1 });
  await page.keyboard.press("Escape");
  await page.screenshot({ path: testInfo.outputPath("japanese-narrow-hand.png"), fullPage: true });
});
