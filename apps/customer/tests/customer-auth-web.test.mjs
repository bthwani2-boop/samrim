import assert from "node:assert/strict";
import { test } from "node:test";
import { DELETE, GET, POST } from "../app/api/customer-auth+api.ts";

const owner = "http://127.0.0.1:33221";
const host = "http://localhost:18101";
const token = Buffer.alloc(32, 11).toString("base64url");
const ticket = "f".repeat(48);
const expiry = new Date(Date.now() + 120000).toISOString();
const verified = { actorId: "customer-a", role: "customer", sessionExpiresAt: expiry };
const success = value => Response.json(value, { headers: { "Cache-Control": "no-store" } });
const cookie = "bthwani_customer_auth=" + token;
const request = (method = "GET", body, options = {}) => new Request(host + "/api/customer-auth" + (options.query ?? ""), {
  method,
  headers: {
    ...(options.cookie === false ? {} : { Cookie: cookie }),
    ...(method !== "GET" ? { Origin: options.origin ?? host } : {}),
    ...(body === undefined ? {} : { "Content-Type": "application/json" }),
  },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

function mockOwner(t, handler) {
  process.env.CUSTOMER_SYNTHETIC_IDENTITY_ORIGIN = owner;
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, opts) => {
    const path = new URL(url).pathname;
    calls.push({ path, method: opts.method, bearer: opts.headers.Authorization });
    return handler(path, opts);
  });
  return calls;
}

test("Customer guest GET does not contact Identity or expose credentials", async t => {
  mockOwner(t, () => assert.fail("guest read must not fetch owner"));
  const res = await GET(request("GET", undefined, { cookie: false }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { enabled: true, session: null });
  assert.equal(res.headers.get("Cache-Control"), "no-store");
});

test("Customer session GET returns only verified Customer role, never opaque bearer", async t => {
  const calls = mockOwner(t, (path, opts) => {
    assert.equal(path, "/v1/sessions/current");
    assert.equal(opts.headers.Authorization, "Bearer " + token);
    return success(verified);
  });
  const res = await GET(request());
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { enabled: true, session: verified });
  assert.equal(res.headers.get("Set-Cookie"), null);
  assert.equal(JSON.stringify(await GET(request())).includes(token), false);
  assert.equal(calls.length, 2);
});

for (const status of [401, 403]) {
  test(`Customer stale owner session ${status} clears only local cookie`, async t => {
    mockOwner(t, () => Response.json({ error: "UNAUTHORIZED" }, {
      status, headers: { "Cache-Control": "no-store" },
    }));
    const res = await GET(request());
    assert.equal(res.status, status === 401 ? 200 : 403);
    assert.match(res.headers.get("Set-Cookie") ?? "", /^bthwani_customer_auth=; Path=\/api\/customer-auth; HttpOnly; SameSite=Strict; Max-Age=0/);
  });
}

test("Merchant bearer cannot be accepted as Customer session", async t => {
  mockOwner(t, () => success({ ...verified, role: "merchant" }));
  const res = await GET(request());
  assert.equal(res.status, 403);
  assert.match(res.headers.get("Set-Cookie") ?? "", /Max-Age=0/);
});

test("Cross-site POST and DELETE cannot mutate Customer sessions", async t => {
  const calls = mockOwner(t, () => assert.fail("cross-site must not reach Identity"));
  assert.equal((await POST(request("POST", { phone: "+12025550177" }, { origin: "https://attacker.example" }))).status, 403);
  assert.equal((await DELETE(request("DELETE", undefined, { origin: "https://attacker.example" }))).status, 403);
  assert.equal(calls.length, 0);
});

test("Customer phone challenge uses bounded local BFF and returns no session", async t => {
  const calls = mockOwner(t, (path, opts) => {
    assert.equal(path, "/v1/customer-auth/phone-challenges");
    assert.equal(opts.method, "POST");
    assert.equal(opts.headers.Authorization, undefined);
    assert.deepEqual(JSON.parse(opts.body), { phone: "+12025550177" });
    return Response.json({ ticket }, { status: 201, headers: { "Cache-Control": "no-store" } });
  });
  const res = await POST(request("POST", { phone: "+12025550177" }, { cookie: false }));
  assert.equal(res.status, 201);
  assert.deepEqual(await res.json(), { ticket });
  assert.equal(res.headers.get("Set-Cookie"), null);
  assert.equal(calls.length, 1);
});

test("Valid Identity phone OTP produces app-specific HttpOnly Customer cookie", async t => {
  const calls = mockOwner(t, (path, opts) => {
    if (path === "/v1/customer-auth/phone-verification") {
      assert.deepEqual(JSON.parse(opts.body), { ticket, code: "123456" });
      return success({ accessToken: token, sessionExpiresAt: expiry });
    }
    if (path === "/v1/sessions/current" && opts.method === "GET") {
      assert.equal(opts.headers.Authorization, "Bearer " + token);
      return success(verified);
    }
    assert.fail(`Unexpected Identity call ${opts.method} ${path}`);
  });
  const res = await POST(request("POST", { ticket, code: "123456" }, { cookie: false }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body, { session: verified });
  assert.equal(JSON.stringify(body).includes(token), false);
  assert.match(res.headers.get("Set-Cookie") ?? "", /^bthwani_customer_auth=[A-Za-z0-9_-]+; Path=\/api\/customer-auth; HttpOnly; SameSite=Strict; Max-Age=/);
  assert.deepEqual(calls.map(x => x.path), ["/v1/customer-auth/phone-verification", "/v1/sessions/current"]);
});

test("Identity response of wrong role after phone proof revokes issued token", async t => {
  let revoked = false;
  mockOwner(t, (path, opts) => {
    if (path === "/v1/customer-auth/phone-verification") return success({ accessToken: token, sessionExpiresAt: expiry });
    if (opts.method === "GET") return success({ ...verified, role: "captain" });
    if (opts.method === "DELETE") { revoked = true; return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } }); }
    assert.fail(path);
  });
  const res = await POST(request("POST", { ticket, code: "123456" }, { cookie: false }));
  assert.equal(res.status, 503);
  assert.equal(res.headers.get("Set-Cookie"), null);
  assert.equal(revoked, true);
});

test("Active Customer cookie must sign out before issuing another Customer credential", async t => {
  const calls = mockOwner(t, path => {
    assert.equal(path, "/v1/sessions/current");
    return success(verified);
  });
  const res = await POST(request("POST", { ticket, code: "123456" }));
  assert.equal(res.status, 409);
  assert.deepEqual(await res.json(), { code: "SIGN_OUT_REQUIRED" });
  assert.equal(calls.length, 1);
});

test("Revocation only affects verified Customer bearer and expires BFF cookie", async t => {
  const calls = mockOwner(t, (path, opts) => {
    assert.equal(path, "/v1/sessions/current");
    if (opts.method === "GET") return success(verified);
    if (opts.method === "DELETE") return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
    assert.fail(opts.method);
  });
  const res = await DELETE(request("DELETE"));
  assert.equal(res.status, 204);
  assert.match(res.headers.get("Set-Cookie") ?? "", /Max-Age=0/);
  assert.deepEqual(calls.map(x => x.method), ["GET", "DELETE"]);
});

test("Identity 503 outage preserves Customer cookie for safe retry", async t => {
  mockOwner(t, () => Response.json({ error: "OWNER_UNAVAILABLE" }, {
    status: 503, headers: { "Cache-Control": "no-store" },
  }));
  const res = await DELETE(request("DELETE"));
  assert.equal(res.status, 503);
  assert.equal(res.headers.get("Set-Cookie"), null);
});

test("Unknown query parameters, unconfigured host and oversized body fail closed", async t => {
  mockOwner(t, () => assert.fail("invalid request must not reach Identity"));
  assert.equal((await GET(request("GET", undefined, { query: "?admin=1" }))).status, 400);
  const oversized = new Request(host + "/api/customer-auth", {
    method: "POST", headers: { Origin: host, "Content-Type": "application/json" },
    body: JSON.stringify({ phone: "a".repeat(1024) }),
  });
  assert.equal((await POST(oversized)).status, 400);
  const remote = new Request("https://bthwani.example/api/customer-auth");
  assert.deepEqual(await (await GET(remote)).json(), { enabled: false, session: null });
});
