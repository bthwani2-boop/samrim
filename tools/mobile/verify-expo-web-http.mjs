#!/usr/bin/env node
// Production-export acceptance using the HTML5 document tree and the pinned Expo server.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { assertHtmlDocument, attr, elements, htmlElement, javascriptMimes, mimeEssence, parseDocument, scriptKind } from "../dev/ssr-document.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const timeout = 15000;
const retiredRoutes = ["/lab", "/foundation", "/health", "/not-a-real-application-route"];
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

function sameOriginUrl(reference, base, origin, label) {
  const url = new URL(reference, base);
  assert.equal(url.origin, origin, label + ": external origin");
  assert.ok(!url.username && !url.password, label + ": credentials in URL");
  return url;
}

export function assertPublicRedirect(location, origin, route) {
  assert.ok(location, route + ": redirect location missing");
  const requestUrl = sameOriginUrl(route, origin, origin, route);
  assert.equal(sameOriginUrl(location, requestUrl, origin, route).href, new URL("/", origin).href,
    route + ": only same-origin public gate allowed");
}

function assetReference(element) {
  if (htmlElement(element, "script")) {
    const src = attr(element, "src");
    if (src === undefined) return null;
    const kind = scriptKind(element);
    assert.ok(kind, "Nonexecutable script has an external src: " + src);
    // Generated Expo documents do not use obsolete event-bound script execution.
    assert.ok(attr(element, "for") === undefined && attr(element, "event") === undefined,
      "Legacy event-bound script is not an Expo entry: " + src);
    return { ref: src, type: "script", entry: kind === "module" || attr(element, "nomodule") === undefined };
  }
  if (!htmlElement(element, "link")) return null;
  const rel = new Set((attr(element, "rel") ?? "").toLowerCase().split(/\s+/));
  const as = attr(element, "as")?.toLowerCase();
  if (rel.has("modulepreload") || (rel.has("preload") && as === "script"))
    return { ref: attr(element, "href"), type: "script", entry: false };
  if (rel.has("stylesheet") || (rel.has("preload") && as === "style"))
    return { ref: attr(element, "href"), type: "style", entry: false };
  return null;
}

export function documentAssets(html, origin, route = "/") {
  const documentUrl = sameOriginUrl(route, origin, origin, route);
  const assets = new Map();
  let hasExecutableEntry = false;
  for (const element of elements(parseDocument(html))) {
    // Expo's export does not use a base override. Refuse altered URL resolution
    // instead of pretending a root-relative fetch proves what the browser sees.
    if (htmlElement(element, "base") && attr(element, "href") !== undefined) {
      assert.equal(sameOriginUrl(attr(element, "href"), documentUrl, origin, "Document base").href,
        documentUrl.href, "Unexpected document base override");
    }
    const reference = assetReference(element);
    if (!reference) continue;
    const { ref, type, entry } = reference;
    assert.ok(ref?.trim(), "Missing executable asset URL");
    const url = sameOriginUrl(ref, documentUrl, origin, "Asset " + ref);
    assert.equal(url.href, origin + url.pathname, "Unexpected asset query or fragment: " + ref);
    const pathname = decodeURIComponent(url.pathname);
    assert.match(pathname, /^\/_expo\/static\/[a-zA-Z0-9_./@()[\]-]+$/, "Unexpected executable asset path: " + ref);
    assert.ok(pathname.split("/").every(part => part !== "." && part !== ".."), "Invalid asset path");
    assert.ok(pathname.endsWith(type === "script" ? ".js" : ".css"), "Asset type/path mismatch: " + ref);
    assert.ok(!assets.has(url.pathname) || assets.get(url.pathname).type === type, "Conflicting asset types: " + ref);
    assets.set(url.pathname, { url: url.pathname, file: pathname.slice(1), type });
    hasExecutableEntry ||= entry;
  }
  assert.ok(hasExecutableEntry, "No executable JavaScript entry referenced by SSR");
  return [...assets.values()];
}

export async function assertAssetResponse(response, expected, asset) {
  assert.equal(response.status, 200, asset.url + ": asset HTTP status");
  const mime = mimeEssence(response);
  assert.ok(asset.type === "script" ? javascriptMimes.has(mime) : mime === "text/css", asset.url + ": asset MIME type");
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
  const middleware = cliRequire("connect")();
  middleware.use((req, res, next) => {
    const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    if (!["GET", "HEAD"].includes(req.method) ||
      !["/_expo/static/", "/assets/"].some(prefix => pathname.startsWith(prefix))) return next();
    let found = false;
    send(req, pathname, { root: client, index: false, dotfiles: "deny" })
      .on("file", () => { found = true; })
      .on("error", error => next(!found && error.statusCode === 404 ? undefined : error))
      .pipe(res);
  });
  middleware.use(createRequestHandler({ build, isDevelopment: false }));
  return { client, middleware };
}

async function withLoopback(app, verify) {
  const { client, middleware } = exportedApplication(app);
  const server = createServer(middleware);
  server.requestTimeout = timeout;
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address !== "string" && address.address === "127.0.0.1");
    await verify("http://127.0.0.1:" + address.port, client);
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
      fetch(origin + route, { method, signal: AbortSignal.timeout(timeout), redirect: "manual" });
    let routes = 0;
    for (const page of pages) {
      const response = await request(page.route);
      assert.equal(response.status, 200, name + page.route + ": HTTP status");
      assert.equal(mimeEssence(response), "text/html");
      const html = await response.text();
      assertHtmlDocument(html, { ...page, route: name + page.route });
      for (const asset of documentAssets(html, origin, page.route)) assets.set(asset.url, asset);
      routes++;
    }
    for (const asset of assets.values()) {
      const expected = readFileSync(path.join(client, ...asset.file.split("/")));
      await assertAssetResponse(await request(asset.url), expected, asset);
    }
    for (const route of [...retiredRoutes, "/_expo/server/render.js", "/_expo/static/missing-client-chunk.js"]) {
      const response = await request(route);
      assert.equal(response.status, 404, name + route + ": retired/unknown or private export path must not render");
      if (retiredRoutes.includes(route)) assert.equal(mimeEssence(response), "text/html");
      await response.arrayBuffer();
      routes++;
    }
    const malformedAsset = await request("/_expo/static/%00.js");
    assert.equal(malformedAsset.status, 400, "Malformed asset path must be rejected");
    await malformedAsset.arrayBuffer();
    routes++;
    if (name === "customer") {
      const wallet = await request("/api/customer-auth/wallet");
      assert.equal(wallet.status, 503, "wallet read requires the isolated preview");
      assert.equal(wallet.headers.get("cache-control"), "no-store");
      assert.deepEqual(await wallet.json(), { error: "OWNER_UNAVAILABLE" });
      routes++;
    }
    for (const route of protectedRoutes) {
      const response = await request(route);
      assert.equal(response.status, 302, name + route + ": protected route must redirect");
      assertPublicRedirect(response.headers.get("location"), origin, route);
      await response.arrayBuffer();
      routes++;
    }
    if (protectedRoutes.length) {
      const denied = await request("/orders", "POST");
      assert.equal(denied.status, 403, "unauthenticated Merchant mutation must be denied");
      await denied.arrayBuffer();
      routes++;
    }
    console.log("EXPO_WEB_PRODUCTION_HTTP_PASS app=" + name + " routes=" + routes +
      " exactClientAssets=" + assets.size + " rtl=true loopback=true browser_hydration=NOT_RUN");
  });
}

async function main(args) {
  assert.notEqual(process.env.BTHWANI_ISOLATED_TEST_MODE, "true", "Refusing owner-connected preview");
  assert.notEqual(process.env.BTHWANI_DOCKER_WALLET_WEB_PREVIEW, "1", "Refusing wallet preview");
  assert.notEqual(process.env.BTHWANI_DOCKER_CART_WEB_PREVIEW, "1", "Refusing cart preview");
  process.env.NODE_ENV = "production";
  if (args.length) {
    const host = hosts.find(item => item.name === args[1]);
    assert.ok(args.length === 2 && args[0] === "--host" && host, "Unknown isolated Expo host");
    await verifyHost(host);
    return;
  }
  for (const host of hosts) {
    const result = spawnSync(process.execPath, [process.argv[1], "--host", host.name], {
      cwd: root, stdio: "inherit", windowsHide: true, timeout: 120000,
    });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, "Expo SSR host failed: " + host.name);
  }
  console.log("EXPO_WEB_SMOKE_PASS hosts=2 native_captain_web=NOT_ADMITTED browser_hydration=NOT_RUN");
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url)
  await main(process.argv.slice(2));
