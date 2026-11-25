import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

process.env.BTHWANI_SURFACE_PREVIEW = "0";
process.env.BTHWANI_DOCKER_CART_WEB_PREVIEW = "1";
process.env.BTHWANI_ISOLATED_TEST_MODE = "true";
process.env.CUSTOMER_SYNTHETIC_IDENTITY_ORIGIN = "http://127.0.0.1:3201";
process.env.CUSTOMER_SYNTHETIC_DSH_ORIGIN = "http://127.0.0.1:3202";

const { GET, PUT } = await import("../app/api/customer-auth/cart+api.ts");
const { GET: ESTIMATE } = await import("../app/api/customer-auth/cart-estimate+api.ts");
const bearer = Buffer.alloc(32, 28).toString("base64url");
const base = "http://localhost:28111/api/customer-auth/";
const cookie = `bthwani_customer_auth=${bearer}`;
const headers = { Cookie: cookie, "Sec-Fetch-Site": "same-origin" };
const cart = {
  actorId: "customer-a", storeId: "store-a", version: 2,
  lines: [{ offerId: "offer-a", variantId: "variant-a", name: "Synthetic item",
    quantity: 1, previewUnitYer: "150", previewAvailable: true }],
};
const estimate = {
  actorId: "customer-a", storeId: "store-a", cartVersion: 2,
  lines: [{ offerId: "offer-a", variantId: "variant-a", quantity: 1,
    unitYer: "150", lineTotalYer: "150" }],
  merchandiseSubtotalYer: "150", checkoutReady: false,
};
function identitySession() {
  return Response.json({ actorId: "customer-a", role: "customer",
    sessionExpiresAt: new Date(Date.now() + 60000).toISOString() },
  { headers: { "Cache-Control": "no-store" } });
}
function ok(body) {
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}

test("Docker-only Customer Cart Web uses current Identity and DSH without exposing a Native bearer", async t => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const owner = new URL(url);
    calls.push([owner.origin, owner.pathname, options.method]);
    assert.equal(options.headers.Authorization, `Bearer ${bearer}`);
    assert.equal(options.credentials, "omit");
    if (owner.pathname === "/v1/sessions/current") {
      assert.equal(owner.origin, "http://127.0.0.1:3201");
      return identitySession();
    }
    assert.equal(owner.origin, "http://127.0.0.1:3202");
    if (owner.pathname.endsWith("/merchandise-estimate")) return ok(estimate);
    if (options.method === "PUT") return ok({ cart, replay: false });
    return ok(cart);
  });
  const read = await GET(new Request(`${base}cart?storeId=store-a`, { headers }));
  assert.equal(read.status, 200);
  assert.deepEqual(await read.json(), cart);
  const write = await PUT(new Request(`${base}cart?storeId=store-a`, {
    method: "PUT", headers: { ...headers, Origin: "http://localhost:28111",
      "Content-Type": "application/json", "X-Customer-Context": "customer-a" },
    body: JSON.stringify({ operationId: "docker-cart-001", expectedVersion: 1,
      lines: [{ offerId: "offer-a", quantity: 1 }] }),
  }));
  assert.equal(write.status, 200);
  assert.deepEqual(await write.json(), { cart, replay: false });
  const priced = await ESTIMATE(new Request(base +
    "cart-estimate?storeId=store-a&expectedVersion=2", { headers }));
  assert.equal(priced.status, 200);
  assert.deepEqual(await priced.json(), estimate);
  assert.equal(calls.length, 9, "each owner operation requires two current Identity reads");
});

test("Docker Cart refuses flag-only, unisolated, unpinned and non-local owner configurations", async t => {
  const names = ["BTHWANI_SURFACE_PREVIEW", "BTHWANI_DOCKER_CART_WEB_PREVIEW",
    "BTHWANI_ISOLATED_TEST_MODE", "CUSTOMER_SYNTHETIC_IDENTITY_ORIGIN",
    "CUSTOMER_SYNTHETIC_DSH_ORIGIN"];
  const saved = names.map(n => process.env[n]);
  t.after(() => names.forEach((n, i) => {
    if (saved[i] === undefined) delete process.env[n];
    else process.env[n] = saved[i];
  }));
  let ownerCalls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    ownerCalls++;
    throw new Error("denied configuration must not dispatch a bearer");
  });
  for (const [name, value] of [
    ["BTHWANI_DOCKER_CART_WEB_PREVIEW", "0"],
    ["BTHWANI_ISOLATED_TEST_MODE", "false"],
    ["CUSTOMER_SYNTHETIC_IDENTITY_ORIGIN", "http://127.0.0.1:3205"],
    ["CUSTOMER_SYNTHETIC_DSH_ORIGIN", "http://127.0.0.1:3290"],
    ["BTHWANI_SURFACE_PREVIEW", "1"],
  ]) {
    const before = process.env[name];
    process.env[name] = value;
    const read = await GET(new Request(`${base}cart?storeId=store-a`, { headers }));
    assert.equal(read.status, 503, name);
    const priced = await ESTIMATE(new Request(base +
      "cart-estimate?storeId=store-a&expectedVersion=2", { headers }));
    assert.equal(priced.status, 503, name);
    process.env[name] = before;
  }
  const remote = await GET(new Request("https://example.org/api/customer-auth/cart?storeId=store-a", { headers }));
  assert.equal(remote.status, 503);
  assert.equal(ownerCalls, 0);
});

test("Docker Cart launcher is explicit, validates both isolated owners and never configures a Native DSH URL", () => {
  const script = readFileSync(new URL("../../../tools/dev/Start-App.ps1", import.meta.url), "utf8");
  assert.match(script, /\[switch\]\$EnableDockerCartWebPreview/);
  assert.match(script, /DOCKER_CART_WEB_PREVIEW_REQUIRES_LENOVO_CUSTOMER_ONLY/);
  assert.match(script, /DSH_ENABLE_ISOLATED_CUSTOMER_CART=true/);
  assert.match(script, /CUSTOMER_SYNTHETIC_DSH_ORIGIN='http:\/\/127\.0\.0\.1:3202'/);
  assert.match(script, /BTHWANI_DOCKER_CART_WEB_PREVIEW='1'/);
  assert.match(script, /EXPO_PUBLIC_BTHWANI_SURFACE_PREVIEW='0'/);
  assert.match(script, /Remove-Item Env:EXPO_PUBLIC_CUSTOMER_SYNTHETIC_DSH_ORIGIN/);
});

test("Docker Customer Cart opt-in rejects Surface and a different app before launching anything", t => {
  if (process.platform !== "win32") return t.skip("PowerShell launcher checked on Surface");
  const launcher = new URL("../../../tools/dev/Start-App.ps1", import.meta.url).pathname.slice(1).replaceAll("/", "\\");
  for (const args of [["-App", "customer", "-Surface"], ["-App", "merchant"]]) {
    const invoked = spawnSync("pwsh", [
      "-NoProfile", "-File", launcher, ...args, "-EnableDockerCartWebPreview",
    ], { encoding: "utf8", timeout: 12000, windowsHide: true });
    assert.equal(invoked.status, 1, invoked.stderr || invoked.error?.message);
    assert.match(invoked.stderr, /DOCKER_CART_WEB_PREVIEW_REQUIRES_LENOVO_CUSTOMER_ONLY/);
  }
});
