/**
 * Regenerates the PWA icons in public/ from the Logo hexagon mark (src/components/GameUi.tsx).
 * Uses Playwright's Chromium to rasterize the SVG at exact sizes; run `bunx playwright install
 * chromium` once, then `bun run scripts/generate-icons.ts`.
 */
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const paper = "#f6f3eb";
const mark = (width: number, height: number) =>
  `<svg viewBox="0 0 40 44" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <path d="m20 1 18 10v22L20 43 2 33V11Z" fill="#b0cdc1" />
  <path d="m9 28 8-15 5 9 4-6 6 12H9Z" fill="#253b36" />
  <path d="m13 28 4-8 5 8" fill="#b0cdc1" />
</svg>`;

const targets = [
  { file: "public/icons/icon-192.png", size: 192, markHeight: 0.55 },
  { file: "public/icons/icon-512.png", size: 512, markHeight: 0.55 },
  { file: "public/icons/icon-maskable-192.png", size: 192, markHeight: 0.45 },
  { file: "public/icons/icon-maskable-512.png", size: 512, markHeight: 0.45 },
  { file: "public/apple-touch-icon.png", size: 180, markHeight: 0.55 },
];

const browser = await chromium.launch();
for (const target of targets) {
  await mkdir(target.file.slice(0, target.file.lastIndexOf("/")), { recursive: true });
  const page = await browser.newPage({ viewport: { width: target.size, height: target.size }, deviceScaleFactor: 1 });
  const height = Math.round(target.size * target.markHeight);
  const width = Math.round((height * 40) / 44);
  await page.setContent(
    `<body style="margin:0"><div style="display:flex;align-items:center;justify-content:center;width:${target.size}px;height:${target.size}px;background:${paper}">${mark(width, height)}</div></body>`,
  );
  await page.screenshot({ path: target.file });
  await page.close();
  console.log(` ${target.file}  ${target.size}x${target.size}`);
}
await browser.close();
