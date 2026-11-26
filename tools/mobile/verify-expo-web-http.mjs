#!/usr/bin/env node
// Isolated production-export acceptance: Expo owns server rendering and route
// middleware; its pinned send implementation serves the exported client files.
// A document alone is not a usable Web export: prove its executable assets too.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "../..");
const retired = ["/lab", "/foundation", "/health", "/not-a-real-application-route"];
const hosts = [
  {
    name: "customer",
    pages: [
      { route: "/", body: "جميع المتاجر", title: "بثواني — الرئيسية" },
      { route: "/stores", body: "متاجر بثواني" },
      { route: "/wallet", body: "جارٍ التحقق من الرصيد…" },
    ],
  },
  {
    name: "merchant",
    pages: [{ route: "/", body: "تسجيل الدخول أو الانضمام", title: "بثواني — التاجر" }],
    protectedRoutes: [
      "/orders", "/orders/example", "/products", "/products/import", "/products/export",
      "/products/quick-prices", "/wallet", "/more", "/onboarding", "/promotions", "/store",
      "/store/profile", "/store/availability", "/store/captains", "/store/agreements",
      "/store/public-link", "/store/team", "/account", "/activity", "/employees", "/insights", "/notifications",
    ],
  },
];

export function assertHtmlDocument(html, { body, title, route }) {
  const document = html.match(/<html\b[^>]*>/i)?.[0] ?? "";
  assert.match(document, /\blang=["']ar["']/i, route + ": missing Arabic document");
  assert.match(document, /\bdir=["']rtl["']/i, route + ": missing RTL document");
  const head = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1] ?? "";
  const rendered = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? "";
  assert.ok(rendered, route + ": missing rendered body");
  const visibleMarkup = rendered
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<[^>]*>/g, " ");
  assert.ok(visibleMarkup.includes(body), route + ": required product body text missing");
  if (title) {
    assert.equal(head.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1], title,
      route + ": wrong document title");
  }
  assert.doesNotMatch(rendered, /Requiring unknown module|EXPO_UNKNOWN_MODULE/i,
    route + ": Metro module error in document");
}

export function assertPublicRedirect(location, origin, route) {
  assert.ok(location, route + ": redirect location missing");
  assert.equal(new URL(location, origin).href, new URL("/", origin).href,
    route + ": only same-origin public gate allowed");
}

// Expo emits JS script preloads in SSR, including bundles imported by inline
// scripts. The manifest-derived client URLs must be actual same-origin files,
// not arbitrary endpoints, foreign scripts or a successful HTML fallback.
function attribute(tag, name) {
  return tag.match(new RegExp("\\s" + name + "\\s*=\\s*([\"'])(.*?)\\1", "i"))?.[2];
}
export function documentAssets(html, origin) {
  const assets = new Map();
  const markup = html.replace(/<!--[\s\S]*?-->/g, "");
  for (const tag of markup.matchAll(/<(script|link)\b[^>]*>/gi)) {
    const kind = tag[1].toLowerCase();
    const rel = attribute(tag[0], "rel")?.toLowerCase();
    const as = attribute(tag[0], "as")?.toLowerCase();
    const type = kind === "script" || rel === "modulepreload" || (rel === "preload" && as === "script")
      ? "script" : rel === "stylesheet" || (rel === "preload" && as === "style") ? "style" : null;
    if (!type) continue;
    const ref = attribute(tag[0], kind === "script" ? "src" : "href");
    if (kind === "script" && ref === undefined) continue;
    assert.ok(ref, "Missing executable asset URL");
    const url = new URL(ref, origin);
    assert.equal(url.origin, origin, "External executable asset: " + ref);
    assert.equal(url.search + url.hash, "", "Unexpected asset query or fragment: " + ref);
    const pathname = decodeURIComponent(url.pathname);
    assert.match(pathname, /^\/_expo\/static\/[a-zA-Z0-9_./@()[\]-]+$/, "Unexpected executable asset path: " + ref);
    assert.ok(pathname.split("/").every(part => part !== "." && part !== ".."), "Invalid asset path");
    assert.ok(pathname.endsWith(type === "script" ? ".js" : ".css"), "Asset type/path mismatch: " + ref);
    const previous = assets.get(url.pathname);
    assert.ok(!previous || previous.type === type, "Conflicting asset types: " + ref);
    assets.set(url.pathname, { url: url.pathname, file: pathname.slice(1), type });
  }
  assert.ok([...assets.values()].some(asset => asset.type === "script"), "No executable JavaScript referenced by SSR");
  return [...assets.values()];
}

export async function assertAssetResponse(response, expected, asset) {
  assert.equal(response.status, 200, asset.url + ": asset HTTP status");
  const mime = response.headers.get("content-type") ?? "";
  assert.match(mime, asset.type === "script" ? /^(application|text)\/(javascript|ecmascript)\b/i : /^text\/css\b/i,
    asset.url + ": asset MIME type");
  assert.ok(expected.length > 0, asset.url + ": empty exported asset");
  assert.ok(Buffer.from(await response.arrayBuffer()).equals(expected), asset.url + ": served bytes differ from export");
}

function exportedApplication(app) {
  const build = path.join(app, "dist", "server");
  const client = path.join(app, "dist", "client");
  assert.ok(statSync(client).isDirectory(), "Missing exported client directory");
  assert.ok(statSync(path.join(build, "_expo/server/render.js")).isFile(), "Missing Expo server renderer");
  const manifest = JSON.parse(readFileSync(path.join(build, "_expo/routes.json"), "utf8"));
  assert.notEqual(manifest.mode, "development", "Production export required");
  assert.ok(manifest.htmlRoutes?.length, "Missing SSR route inventory");
  const appRequire = createRequire(path.join(app, "package.json"));
  const expoRequire = createRequire(appRequire.resolve("expo/package.json"));
  const cliRequire = createRequire(expoRequire.resolve("@expo/cli/package.json"));
  const send = cliRequire("send");
  const { createRequestHandler } = cliRequire("expo-server/adapter/http");
  const render = createRequestHandler({ build, isDevelopment: false });
  const middleware = cliRequire("connect")();

  // Use the very same static-file transport used by the pinned Expo CLI's
  // serveAsync implementation. Its client root never includes server code.
  middleware.use((req, res, next) => {
    const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    if (!["GET", "HEAD"].includes(req.method) ||
      !["/_expo/static/", "/assets/"].some(prefix => pathname.startsWith(prefix))) return next();
    let fileFound = false;
    send(req, pathname, { root: client, index: false, dotfiles: "deny" })
      .on("file", () => { fileFound = true; })
      .on("error", error => {
        if (!fileFound && error.statusCode === 404) return next();
        return next(error);
      })
      .pipe(res);
  });
  middleware.use(render);
  return { client, middleware };
}

async function withLoopback(app, operation) {
  const { client, middleware } = exportedApplication(app);
  const server = createServer(middleware);
  server.requestTimeout = 15000;
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address !== "string" && address.address === "127.0.0.1");
    await operation("http://127.0.0.1:" + address.port, client);
  } finally {
    if (server.listening) {
      const closed = new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      server.closeAllConnections();
      await closed;
    }
  }
}

async function verifyHost({ name, pages, protectedRoutes = [] }) {
  await withLoopback(path.join(root, "apps", name), async (origin, client) => {
    const assets = new Map();
    const request = (route, method = "GET") =>
      fetch(origin + route, { method, signal: AbortSignal.timeout(15000), redirect: "manual" });
    for (const page of pages) {
      const response = await request(page.route);
      assert.equal(response.status, 200, name + page.route + ": HTTP status");
      assert.match(response.headers.get("content-type") ?? "", /text\/html/i);
      const html = await response.text();
      assertHtmlDocument(html, { ...page, route: name + page.route });
      for (const asset of documentAssets(html, origin)) assets.set(asset.url, asset);
    }
    for (const asset of assets.values()) {
      const expected = readFileSync(path.join(client, ...asset.file.split("/")));
      await assertAssetResponse(await request(asset.url), expected, asset);
    }
    for (const route of [...retired, "/_expo/server/render.js", "/_expo/static/missing-client-chunk.js"]) {
      const response = await request(route);
      assert.equal(response.status, 404, name + route + ": retired/unknown or private export path must not render");
      if (retired.includes(route)) assert.match(response.headers.get("content-type") ?? "", /text\/html/i);
      await response.arrayBuffer();
    }
    if (name === "customer") {
      const wallet = await request("/api/customer-auth/wallet");
      assert.equal(wallet.status, 503, "wallet read requires the isolated preview");
      assert.equal(wallet.headers.get("cache-control"), "no-store");
      assert.deepEqual(await wallet.json(), { error: "OWNER_UNAVAILABLE" });
    }
    for (const route of protectedRoutes) {
      const response = await request(route);
      assert.equal(response.status, 302, name + route + ": protected route must redirect");
      assertPublicRedirect(response.headers.get("location"), origin, name + route);
      await response.arrayBuffer();
    }
    if (protectedRoutes.length) {
      const denied = await request("/orders", "POST");
      assert.equal(denied.status, 403, "unauthenticated Merchant mutation must be denied");
      await denied.arrayBuffer();
    }
    console.log("EXPO_WEB_PRODUCTION_HTTP_PASS app=" + name +
      " routes=" + (pages.length + retired.length + 2 + protectedRoutes.length + 1) +
      " exactClientAssets=" + assets.size + " rtl=true loopback=true browser_hydration=NOT_RUN");
  });
}

async function main() {
  const args = process.argv.slice(2);
  assert.notEqual(process.env.BTHWANI_ISOLATED_TEST_MODE, "true", "Refusing owner-connected preview");
  assert.notEqual(process.env.BTHWANI_DOCKER_WALLET_WEB_PREVIEW, "1", "Refusing wallet preview");
  assert.notEqual(process.env.BTHWANI_DOCKER_CART_WEB_PREVIEW, "1", "Refusing cart preview");
  process.env.NODE_ENV = "production";
  if (args.length === 0) {
    // Each Expo renderer has a process-local module registry. Do not load
    // different app exports in one process or launch another persistent host.
    for (const host of hosts) {
      const child = spawnSync(process.execPath, [process.argv[1], "--host", host.name], {
        cwd: root, stdio: "inherit", windowsHide: true, timeout: 120000,
      });
      if (child.error) throw child.error;
      assert.equal(child.status, 0, "Expo SSR host failed: " + host.name);
    }
    console.log("EXPO_WEB_SMOKE_PASS hosts=2 native_captain_web=NOT_ADMITTED browser_hydration=NOT_RUN");
    return;
  }
  const host = hosts.find(entry => entry.name === args[1]);
  assert.ok(args.length === 2 && args[0] === "--host" && host, "Unknown isolated Expo host");
  await verifyHost(host);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main();
