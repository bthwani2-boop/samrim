#!/usr/bin/env node
// Production-export acceptance using the HTML5 document tree and the pinned Expo server.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "parse5";

const root = path.resolve(import.meta.dirname, "../..");
const htmlNamespace = "http://www.w3.org/1999/xhtml";
const excludedText = new Set(["script", "style", "template", "noscript", "textarea"]);
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

const parseDocument = html => parse(html, { sourceCodeLocationInfo: true, scriptingEnabled: true });
const htmlElement = (node, tag) => node.namespaceURI === htmlNamespace && node.tagName === tag;
const child = (node, tag) => node.childNodes?.find(item => htmlElement(item, tag));
const attr = (node, name) => node.attrs?.find(item => item.name === name && !item.namespace)?.value;

function* elements(node) {
  if (node.tagName && node.namespaceURI !== htmlNamespace) return;
  if (htmlElement(node, "template") || htmlElement(node, "noscript")) return;
  if (node.tagName) yield node;
  for (const item of node.childNodes ?? []) yield* elements(item);
}

function bodyText(node) {
  if (node.nodeName === "#text") return node.value;
  if (node.tagName && (node.namespaceURI !== htmlNamespace ||
    excludedText.has(node.tagName) || attr(node, "hidden") !== undefined)) return "";
  return (node.childNodes ?? []).map(bodyText).join(" ");
}

export function assertHtmlDocument(html, { body, title, route }) {
  const doc = child(parseDocument(html), "html");
  assert.ok(doc?.sourceCodeLocation?.startTag && attr(doc, "lang")?.toLowerCase() === "ar",
    route + ": missing Arabic document");
  assert.equal(attr(doc, "dir")?.toLowerCase(), "rtl", route + ": missing RTL document");
  const head = child(doc, "head");
  const rendered = child(doc, "body");
  assert.ok(rendered?.sourceCodeLocation?.startTag, route + ": missing rendered body");
  assert.ok(bodyText(rendered).includes(body), route + ": required product body text missing");
  if (title) {
    const titleNode = head && child(head, "title");
    assert.equal(titleNode?.childNodes?.map(item => item.value ?? "").join(""), title,
      route + ": wrong document title");
  }
  assert.doesNotMatch(html, /Requiring unknown module|EXPO_UNKNOWN_MODULE/i,
    route + ": Metro module error in document");
}

export function assertPublicRedirect(location, origin, route) {
  assert.ok(location, route + ": redirect location missing");
  assert.equal(new URL(location, origin).href, new URL("/", origin).href,
    route + ": only same-origin public gate allowed");
}

function assetReference(element) {
  if (htmlElement(element, "script")) {
    const src = attr(element, "src");
    return src === undefined ? null : { ref: src, type: "script" };
  }
  if (!htmlElement(element, "link")) return null;
  const rel = new Set((attr(element, "rel") ?? "").toLowerCase().split(/\s+/));
  const as = attr(element, "as")?.toLowerCase();
  if (rel.has("modulepreload") || (rel.has("preload") && as === "script"))
    return { ref: attr(element, "href"), type: "script" };
  if (rel.has("stylesheet") || (rel.has("preload") && as === "style"))
    return { ref: attr(element, "href"), type: "style" };
  return null;
}

export function documentAssets(html, origin) {
  const assets = new Map();
  for (const element of elements(parseDocument(html))) {
    const reference = assetReference(element);
    if (!reference) continue;
    const { ref, type } = reference;
    assert.ok(ref, "Missing executable asset URL");
    const url = new URL(ref, origin);
    assert.equal(url.origin, origin, "External executable asset: " + ref);
    assert.equal(url.search + url.hash, "", "Unexpected asset query or fragment: " + ref);
    const pathname = decodeURIComponent(url.pathname);
    assert.match(pathname, /^\/_expo\/static\/[a-zA-Z0-9_./@()[\]-]+$/, "Unexpected executable asset path: " + ref);
    assert.ok(pathname.split("/").every(part => part !== "." && part !== ".."), "Invalid asset path");
    assert.ok(pathname.endsWith(type === "script" ? ".js" : ".css"), "Asset type/path mismatch: " + ref);
    assert.ok(!assets.has(url.pathname) || assets.get(url.pathname).type === type, "Conflicting asset types: " + ref);
    assets.set(url.pathname, { url: url.pathname, file: pathname.slice(1), type });
  }
  assert.ok([...assets.values()].some(asset => asset.type === "script"), "No executable JavaScript referenced by SSR");
  return [...assets.values()];
}

export async function assertAssetResponse(response, expected, asset) {
  assert.equal(response.status, 200, asset.url + ": asset HTTP status");
  const mime = response.headers.get("content-type") ?? "";
  const expectedMime = asset.type === "script" ? /^(application|text)\/(javascript|ecmascript)\b/i : /^text\/css\b/i;
  assert.match(mime, expectedMime, asset.url + ": asset MIME type");
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
      assert.match(response.headers.get("content-type") ?? "", /text\/html/i);
      const html = await response.text();
      assertHtmlDocument(html, { ...page, route: name + page.route });
      for (const asset of documentAssets(html, origin)) assets.set(asset.url, asset);
      routes++;
    }
    for (const asset of assets.values()) {
      const expected = readFileSync(path.join(client, ...asset.file.split("/")));
      await assertAssetResponse(await request(asset.url), expected, asset);
    }
    for (const route of [...retiredRoutes, "/_expo/server/render.js", "/_expo/static/missing-client-chunk.js"]) {
      const response = await request(route);
      assert.equal(response.status, 404, name + route + ": retired/unknown or private export path must not render");
      if (retiredRoutes.includes(route)) assert.match(response.headers.get("content-type") ?? "", /text\/html/i);
      await response.arrayBuffer();
      routes++;
    }
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
      assertPublicRedirect(response.headers.get("location"), origin, name + route);
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
