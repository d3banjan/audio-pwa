import { readFile, readdir } from "node:fs/promises";

const distFiles = await readdir(new URL("../dist/assets/", import.meta.url));
const script = await readFile(
  new URL("../dist/service-worker.js", import.meta.url),
  "utf8",
);
const html = await readFile(
  new URL("../dist/index.html", import.meta.url),
  "utf8",
);

for (const file of distFiles.filter(
  (name) => name.endsWith(".js") || name.endsWith(".css"),
)) {
  if (!script.includes(`./assets/${file}`))
    throw new Error(`Service worker omits generated asset: ${file}`);
}
if (
  script.includes("self.skipWaiting(") ||
  script.includes("self.clients.claim(")
) {
  throw new Error("Service worker bypasses the safe update lifecycle.");
}
if (/\b(?:src|href)="\//.test(html))
  throw new Error("Release HTML contains root-absolute asset URLs.");
if (
  !script.includes("const cache = await caches.open(SHELL_CACHE)") ||
  !script.includes("await cache.match(")
)
  throw new Error("Service worker does not use named-cache matching.");
if (!script.includes("encodeURIComponent(self.registration.scope)"))
  throw new Error(
    "Service worker cache ownership is not bound to its registration scope.",
  );
if (
  !script.includes(
    "const cachedDocument = await cache.match(NAVIGATION_FALLBACK)",
  )
)
  throw new Error(
    "Controlled navigation is not pinned to controller-version HTML.",
  );
for (const failureCode of [
  "offline-document-missing",
  "controller-document-missing",
  "offline-asset-missing",
  "online-asset-unavailable",
  "asset-network-failure",
]) {
  if (!script.includes(failureCode))
    throw new Error(`Service worker omits explicit failure: ${failureCode}`);
}

console.log(
  `Release artifact verified: ${distFiles.length} generated assets are covered by the immutable shell.`,
);
