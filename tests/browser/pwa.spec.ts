import { expect, test } from "@playwright/test";

type Manifest = {
  name: string;
  start_url: string;
  display: string;
  icons: Array<{ src: string; sizes: string; type: string; purpose: string }>;
};

test("serves the web app manifest, icons, and service worker", async ({ request }) => {
  const response = await request.get("/manifest.webmanifest");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/manifest+json");
  const manifest = (await response.json()) as Manifest;
  expect(manifest.name).toBe("Catania");
  expect(manifest.start_url).toBe("/");
  expect(manifest.display).toBe("standalone");
  const sizes = manifest.icons.map((icon) => icon.sizes);
  expect(sizes, "installable app icons").toContain("192x192");
  expect(sizes).toContain("512x512");

  for (const icon of manifest.icons) {
    const iconResponse = await request.get(icon.src);
    expect(iconResponse.status(), icon.src).toBe(200);
    expect(iconResponse.headers()["content-type"], icon.src).toContain("image/png");
  }

  const serviceWorker = await request.get("/sw.js");
  expect(serviceWorker.status()).toBe(200);
  expect(serviceWorker.headers()["content-type"]).toContain("javascript");
});

test("links the manifest and icons from the app shell", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.webmanifest");
  await expect(page.locator('link[rel="icon"][href="/favicon.svg"]')).toHaveCount(1);
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute("href", "/apple-touch-icon.png");
  await expect(page).toHaveTitle(/Catania/);
});

test("registers the service worker and launches offline", async ({ page, context }) => {
  await page.goto("/");
  // A fresh device opens on the profile screen; the offline check only needs the rendered shell.
  await expect(page.getByRole("heading", { name: "Your player profile" })).toBeVisible();
  await page.waitForFunction(() => navigator.serviceWorker.controller?.scriptURL.endsWith("/sw.js") === true);
  // The registration hands the loaded asset URLs to the worker; wait until they are cached.
  await page.waitForFunction(async () => {
    const keys = await caches.keys();
    if (keys.length === 0) return false;
    const cache = await caches.open(keys[0]!);
    const requests = await cache.keys();
    return requests.some((request) => request.url.endsWith(".js")) && requests.some((request) => request.url.endsWith(".css"));
  });

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Your player profile" }), "cached shell renders offline").toBeVisible();
});

test("serves static privacy policy and support pages in English and Japanese", async ({ page }) => {
  const privacyResponse = await page.goto("/privacy.html");
  expect(privacyResponse?.status()).toBe(200);
  expect(privacyResponse?.headers()["content-type"]).toContain("text/html");
  await expect(page.getByRole("heading", { name: "Privacy Policy (English)" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "プライバシーポリシー（日本語）" })).toBeVisible();

  const supportResponse = await page.goto("/support.html");
  expect(supportResponse?.status()).toBe(200);
  expect(supportResponse?.headers()["content-type"]).toContain("text/html");
  await expect(page.getByRole("heading", { name: "Support & FAQ (English)" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "サポート・よくある質問（日本語）" })).toBeVisible();
});
