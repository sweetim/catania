/**
 * Serves the production bundle in dist/ for local preview and the PWA browser tests.
 * Run `bun run build` first: `PORT=4180 bun run scripts/serve-dist.ts`.
 */
import path from "node:path";
import { serve } from "bun";

const dist = path.join(process.cwd(), "dist");

const server = serve({
  port: Number(process.env.PORT ?? 4180),
  routes: {
    "/*": async (request) => {
      const pathname = decodeURIComponent(new URL(request.url).pathname);
      const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
      if (relative.includes("..")) return new Response(null, { status: 404 });
      const file = Bun.file(path.join(dist, relative));
      if (await file.exists()) {
        const headers: Record<string, string> | undefined =
          relative === "sw.js"
            ? { "Cache-Control": "no-cache" }
            : relative === ".well-known/apple-app-site-association" || relative === ".well-known/assetlinks.json"
              ? { "Content-Type": "application/json" }
              : undefined;
        return new Response(file, headers ? { headers } : undefined);
      }
      return new Response(Bun.file(path.join(dist, "index.html")), {
        headers: { "Cache-Control": "no-cache" },
      });
    },
  },
});

console.log(`Dist server running at ${server.url}`);
