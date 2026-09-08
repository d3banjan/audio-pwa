import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const port = Number(process.env.PWA_TEST_PORT ?? 4173);
const distRoot = new URL("../dist/", import.meta.url).pathname;
let release = 1;
const unavailable = new Set();

const types = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".webmanifest", "application/manifest+json"],
  [".svg", "image/svg+xml"],
]);

function reply(response, status, body, headers = {}) {
  response.writeHead(status, { "Cache-Control": "no-store", ...headers });
  response.end(body);
}

createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
  if (request.method === "POST" && url.pathname === "/__release") {
    release = Number(url.searchParams.get("value")) || 1;
    reply(response, 204, "");
    return;
  }
  if (request.method === "POST" && url.pathname === "/__unavailable") {
    const path = url.searchParams.get("path");
    if (path) unavailable.add(path);
    reply(response, 204, "");
    return;
  }
  if (request.method === "POST" && url.pathname === "/__reset") {
    release = 1;
    unavailable.clear();
    reply(response, 204, "");
    return;
  }
  if (unavailable.has(url.pathname)) {
    reply(response, 404, "fixture resource unavailable", {
      "Content-Type": "text/plain",
    });
    return;
  }
  if (!url.pathname.startsWith("/audio-pwa/")) {
    reply(response, 404, "outside fixture scope", {
      "Content-Type": "text/plain",
    });
    return;
  }

  const relative = url.pathname.slice("/audio-pwa/".length) || "index.html";
  const safeRelative = normalize(relative).replace(/^(\.\.(\/|\\|$))+/, "");
  try {
    let body = await readFile(join(distRoot, safeRelative));
    if (safeRelative === "service-worker.js") {
      body = Buffer.from(
        body
          .toString()
          .replace(
            /const RELEASE_ID = "[^"]+";/,
            `const RELEASE_ID = "fixture-release-${release}";`,
          ),
      );
    } else if (safeRelative === "index.html") {
      body = Buffer.from(
        body
          .toString()
          .replace(
            "</head>",
            `<meta name="fixture-release" content="${release}"></head>`,
          ),
      );
    }
    reply(response, 200, body, {
      "Content-Type":
        types.get(extname(safeRelative)) ?? "application/octet-stream",
      ...(safeRelative === "service-worker.js"
        ? {
            "Service-Worker-Allowed": "/audio-pwa/",
            ETag: `"fixture-worker-${release}"`,
          }
        : {}),
    });
  } catch {
    reply(response, 404, "fixture file missing", {
      "Content-Type": "text/plain",
    });
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`PWA fixture listening on http://127.0.0.1:${port}/audio-pwa/`);
});
