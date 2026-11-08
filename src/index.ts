import path from "node:path";
import { serve } from "bun";
import index from "./index.html";

const publicFile = (relative: string) => Bun.file(path.join(import.meta.dir, "..", "public", relative));

const server = serve({
  hostname: process.env.HOST,
  routes: {
    // Serve index.html for all unmatched routes.
    "/*": index,

    "/manifest.webmanifest": () =>
      new Response(publicFile("manifest.webmanifest"), {
        headers: { "Content-Type": "application/manifest+json" },
      }),

    "/sw.js": () =>
      new Response(publicFile("sw.js"), {
        headers: { "Content-Type": "application/javascript", "Cache-Control": "no-cache" },
      }),

    "/favicon.svg": () => new Response(publicFile("favicon.svg")),

    "/apple-touch-icon.png": () => new Response(publicFile("apple-touch-icon.png")),

    "/icons/*": (request) => {
      const name = decodeURIComponent(new URL(request.url).pathname.replace(/^\/icons\//, ""));
      if (!name || name.includes("/") || name.includes("..")) return new Response(null, { status: 404 });
      return new Response(publicFile(path.join("icons", name)));
    },

    "/api/hello": {
      async GET(req) {
        return Response.json({
          message: "Hello, world!",
          method: "GET",
        });
      },
      async PUT(req) {
        return Response.json({
          message: "Hello, world!",
          method: "PUT",
        });
      },
    },

    "/api/hello/:name": async req => {
      const name = req.params.name;
      return Response.json({
        message: `Hello, ${name}!`,
      });
    },
  },

  development: process.env.NODE_ENV !== "production" && {
    // Enable browser hot reloading in development
    hmr: true,

    // Echo console logs from the browser to the server
    console: true,
  },
});

console.log(`🚀 Server running at ${server.url}`);
