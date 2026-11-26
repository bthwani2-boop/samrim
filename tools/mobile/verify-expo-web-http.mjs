#!/usr/bin/env node
// Real production-export SSR and HTTP route proof. The pinned Expo HTTP
// adapter owns rendering, middleware and API dispatch. Node binds the test
// socket atomically to loopback; no persistent app host, proxy or service.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
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

// Check the actual rendered body separately from metadata. A title, script,
// style or inert template containing the expected words is not a rendered UI.
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
  const target = new URL(location, origin);
  assert.equal(target.href, new URL("/", origin).href, route + ": only same-origin public gate allowed");
}

function requestHandler(app) {
  const build = path.join(app, "dist", "server");
  for (const artifact of ["_expo/server/render.js", "_expo/routes.json"]) {
    assert.ok(existsSync(path.join(build, artifact)), "Build the approved Expo Web SSR output first: " + app);
  }
  // Resolve through the exact frozen Expo CLI dependency graph, never from
  // an unrelated global package or a second dependency version.
  const appRequire = createRequire(path.join(app, "package.json"));
  const expoRequire = createRequire(appRequire.resolve("expo/package.json"));
  const cliRequire = createRequire(expoRequire.resolve("@expo/cli/package.json"));
  const { createRequestHandler } = cliRequire("expo-server/adapter/http");
  return createRequestHandler({ build, isDevelopment: false });
}

async function withLoopback(app, operation) {
  const handler = requestHandler(app);
  const server = createServer((req, res) => {
    // The official adapter uses the error callback to propagate asynchronous
    // render failures. Never turn an exception into successful HTML.
    void handler(req, res, error => {
      if (res.headersSent) { res.destroy(error); return; }
      res.writeHead(error ? 500 : 404, { "content-type": "text/plain" });
      res.end(error ? "EXPO_RENDER_FAILED" : "NOT_FOUND");
    });
  });
  server.requestTimeout = 15000;
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address !== "string" && address.address === "127.0.0.1");
    await operation("http://127.0.0.1:" + address.port);
  } finally {
    if (server.listening) {
      const closed = new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      server.closeAllConnections();
      await closed;
    }
  }
}

async function verifyHost({ name, pages, protectedRoutes = [] }) {
  await withLoopback(path.join(root, "apps", name), async origin => {
    function request(route, method = "GET") {
      return fetch(origin + route, { method, signal: AbortSignal.timeout(15000), redirect: "manual" });
    }
    for (const page of pages) {
      const response = await request(page.route);
      assert.equal(response.status, 200, name + page.route + ": HTTP status");
      assert.match(response.headers.get("content-type") ?? "", /text\/html/i);
      assertHtmlDocument(await response.text(), { ...page, route: name + page.route });
    }
    for (const route of retired) {
      const response = await request(route);
      assert.equal(response.status, 404, name + route + ": retired/unknown route must not render");
      assert.match(response.headers.get("content-type") ?? "", /text\/html/i);
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
      " routes=" + (pages.length + retired.length + protectedRoutes.length + 1) +
      " rtl=true loopback=true browser_hydration=NOT_RUN");
  });
}

async function main() {
  const args = process.argv.slice(2);
  // Do not connect the production-export proof to a serving owner or inherit
  // a privileged preview. These checks never send cookies or credentials.
  assert.notEqual(process.env.BTHWANI_ISOLATED_TEST_MODE, "true", "Refusing owner-connected preview");
  assert.notEqual(process.env.BTHWANI_DOCKER_WALLET_WEB_PREVIEW, "1", "Refusing wallet preview");
  assert.notEqual(process.env.BTHWANI_DOCKER_CART_WEB_PREVIEW, "1", "Refusing cart preview");
  process.env.NODE_ENV = "production";
  if (args.length === 0) {
    // Expo's generated server modules are process-scoped. Loading two app
    // exports in one module cache can produce a false Merchant render failure.
    // Each host has its own bounded process, with only one loopback listener.
    for (const host of hosts) {
      const child = spawnSync(process.execPath, [process.argv[1], "--host", host.name], {
        cwd: root, stdio: "inherit", windowsHide: true, timeout: 120000,
      });
      if (child.error) throw child.error;
      assert.equal(child.status, 0, "Expo SSR host failed: " + host.name);
    }
    console.log("EXPO_WEB_SMOKE_PASS hosts=2 native_captain_web=NOT_ADMITTED static_assets_and_browser_hydration=NOT_RUN");
    return;
  }
  const host = hosts.find(entry => entry.name === args[1]);
  assert.ok(args.length === 2 && args[0] === "--host" && host, "Unknown isolated Expo host");
  await verifyHost(host);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main();
