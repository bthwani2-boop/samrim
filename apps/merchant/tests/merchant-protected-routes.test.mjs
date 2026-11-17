import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

const app = resolve(import.meta.dirname, "../app");
const publicRoutes = new Set(["index", "apply", "activate", "setup", "health"]);

function privateRouteNames(directory = app, prefix = "") {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (entry.isDirectory()) {
      if (entry.name === "(tabs)") return ["(tabs)"];
      return privateRouteNames(join(directory, entry.name), `${prefix}${entry.name}/`);
    }
    if (!entry.name.endsWith(".tsx") || entry.name.startsWith("+") || entry.name === "_layout.tsx") return [];
    const name = `${prefix}${entry.name.slice(0, -4)}`;
    return publicRoutes.has(name) ? [] : [name];
  });
}

test("every Merchant private route is explicitly registered in the fail-closed root guard", () => {
  const layout = readFileSync(join(app, "_layout.tsx"), "utf8");
  const protectedBlock = layout.match(/<Stack\.Protected guard=\{false\} redirectTo="\/">([\s\S]*?)<\/Stack\.Protected>/);
  assert.ok(protectedBlock, "private Merchant navigation must remain denied until Identity/DSH verification");
  const screens = Array.from(protectedBlock[1].matchAll(/<Stack\.Screen name="([^"]+)"\s*\/>/g), match => match[1]);
  assert.deepEqual(screens.sort(), privateRouteNames().sort(), "each private route must be protected exactly once");
  assert.equal(existsSync(join(app, "(workspace)")), false);
  assert.equal(existsSync(join(app, "(app)")), false);
});
test("Merchant SSR middleware redirects every protected entry route and rejects mutations", async () => {
  const pathname = join(app, "+middleware.ts");
  assert.ok(existsSync(pathname), "protected SSR deep links need a server-side deny gate");
  const { default: middleware, unstable_settings } = await import("../app/+middleware.ts");
  const patterns = unstable_settings.matcher.patterns;
  const guardedPaths = [
    "/orders", "/orders/example", "/products", "/products/import", "/wallet",
    "/more", "/onboarding", "/promotions", "/store/profile", "/account",
    "/activity", "/employees", "/insights", "/notifications",
  ];
  for (const route of guardedPaths) {
    assert.ok(patterns.some(pattern => pattern.test(route)), "missing SSR protected route " + route);
    const target = "https://merchant.example" + route;
    const denied = middleware(new Request(target));
    assert.equal(denied.status, 302, route + ": web navigation must redirect to the public entry");
    assert.equal(denied.headers.get("location"), "https://merchant.example/");
  }
  for (const route of ["/", "/apply", "/activate", "/setup", "/health", "/not-a-stage4-route"]) {
    assert.ok(patterns.every(pattern => !pattern.test(route)), route + ": public/unknown route must not be intercepted");
  }
  const mutation = middleware(new Request("https://merchant.example/orders", { method: "POST" }));
  assert.equal(mutation.status, 403, "unauthenticated mutation must not be redirected or accepted");
});