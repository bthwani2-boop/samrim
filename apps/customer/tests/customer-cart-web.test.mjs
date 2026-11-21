import assert from "node:assert/strict";
import { test } from "node:test";

process.env.BTHWANI_SURFACE_PREVIEW = "1";
process.env.CUSTOMER_SYNTHETIC_DSH_ORIGIN = "http://127.0.0.1:33222";
process.env.CUSTOMER_SYNTHETIC_IDENTITY_ORIGIN = "http://127.0.0.1:33221";
const { GET, PUT } = await import("../app/api/customer-auth/cart+api.ts");
const bearer = Buffer.alloc(32, 14).toString("base64url");
const base = "http://localhost:18101/api/customer-auth/cart?storeId=store-a";
const cookie = `bthwani_surface_customer_auth=${bearer}`;
const cart = { actorId: "customer-a", storeId: "store-a", version: 2, lines: [{
  offerId: "offer-a", variantId: "variant-a", name: "مقاضي",
  quantity: 2, previewUnitYer: "9007199254740993", previewAvailable: true,
}] };
const change = { operationId: "cart-command-001", expectedVersion: 1,
  lines: [{ offerId: "offer-a", quantity: 2 }] };
function credentials(extra = {}) {
  return { Cookie: cookie, "Sec-Fetch-Site": "same-origin", ...extra };
}
function identitySession(actorId = "customer-a") {
  return Response.json({
    actorId, role: "customer", sessionExpiresAt: new Date(Date.now() + 60000).toISOString(),
  }, { headers: { "Cache-Control": "no-store" } });
}
function okJSON(body, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
function request(method, data = undefined, headers = credentials()) {
  return new Request(base, {
    method, headers: {
      ...headers,
      ...(method === "PUT" ? { Origin: "http://localhost:18101", "Content-Type": "application/json" } : {}),
    },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
}

test("Customer Cart Web BFF binds two Identity reads and DSH draft to the cookie actor", async t => {
  const routes = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    routes.push(new URL(url).pathname);
    if (new URL(url).pathname === "/v1/sessions/current") {
      assert.equal(options.headers.Authorization, `Bearer ${bearer}`);
      return identitySession();
    }
    if (new URL(url).pathname === "/v1/carts/store-a") {
      assert.equal(options.credentials, "omit");
      assert.equal(options.method, "GET");
      return okJSON(cart);
    }
    assert.fail("unknown owner path");
  });
  const result = await GET(request("GET"));
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await result.json(), cart);
  assert.deepEqual(routes, ["/v1/sessions/current", "/v1/carts/store-a", "/v1/sessions/current"]);
});

test("Customer Cart Web BFF preserves owner-only payload and operation identity", async t => {
  let transmitted;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    if (new URL(url).pathname === "/v1/sessions/current") return identitySession();
    assert.equal(options.method, "PUT");
    assert.equal(options.credentials, "omit");
    transmitted = JSON.parse(options.body);
    return okJSON({ cart, replay: false });
  });
  const result = await PUT(request("PUT", change));
  assert.equal(result.status, 200);
  assert.equal((await result.json()).cart.actorId, "customer-a");
  assert.deepEqual(transmitted, change);
});

test("Customer Cart Web BFF rejects CSRF, extra actors, duplicate selectors and missing sessions before owner reads", async t => {
  let reads = 0;
  t.mock.method(globalThis, "fetch", async () => { reads++; return identitySession(); });
  for (const req of [
    new Request(base, { method: "GET" }),
    new Request(base + "&actorId=customer-b", { method: "GET", headers: credentials() }),
    new Request(base + "&storeId=store-a", { method: "GET", headers: credentials() }),
    new Request(base, { method: "PUT", headers: credentials(),
      body: JSON.stringify(change) }),
    request("PUT", { ...change, actorId: "customer-a" }),
    request("PUT", change, credentials({ "Sec-Fetch-Site": "cross-site" })),
  ]) {
    const handler = req.method === "PUT" ? PUT : GET;
    const response = await handler(req);
    assert.ok([400, 401, 403].includes(response.status), response.status.toString());
  }
  assert.equal(reads, 0);
});

test("Uncertain Cart write and after-read actor changes cannot report successful mutation", async t => {
  let swap = false, unavailable = false, reads = 0;
  t.mock.method(globalThis, "fetch", async (url) => {
    const path = new URL(url).pathname;
    if (path === "/v1/sessions/current") {
      reads++;
      return identitySession(swap && reads % 2 === 0 ? "customer-b" : "customer-a");
    }
    if (unavailable) return new Response("", { status: 503 });
    return okJSON({ cart, replay: false });
  });
  unavailable = true;
  const lost = await PUT(request("PUT", change));
  assert.equal(lost.status, 503);
  assert.equal((await lost.json()).error, "OPERATION_RESULT_UNKNOWN");
  unavailable = false;
  swap = true;
  reads = 0;
  const switched = await PUT(request("PUT", change));
  assert.equal(switched.status, 503);
  assert.equal((await switched.json()).error, "OPERATION_RESULT_UNKNOWN");
});

test("Owner returned a cross-account Cart, so no original Customer data is exposed", async t => {
  t.mock.method(globalThis, "fetch", async (url) =>
    new URL(url).pathname === "/v1/sessions/current" ? identitySession() :
      okJSON({ ...cart, actorId: "customer-b" }));
  const result = await GET(request("GET"));
  assert.equal(result.status, 503);
  assert.deepEqual(await result.json(), { error: "OWNER_UNAVAILABLE" });
});
