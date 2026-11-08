import { expect, test } from "./fixtures";

test("home page scans a host's invitation to join its board", async ({ page }) => {
  await page.goto("/");
  const multiplayer = page.getByRole("region", { name: "Cross-device play" });
  await expect(multiplayer.getByRole("link", { name: "Play across devices" })).toBeVisible();
  await multiplayer.getByRole("button", { name: "Scan to join a board" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Scan to join a board" })).toBeVisible();
  // Chromium here exposes no camera device, so the dialog guides the player to the phone camera instead.
  await expect(dialog.getByRole("alert")).toContainText("phone's camera app");
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  await expect(dialog).toBeHidden();
});
