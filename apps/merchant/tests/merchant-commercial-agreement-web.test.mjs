import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import * as ownerClient from "@bthwani/wlt";
import { loadMappedRenderFixture } from "../../../tools/dev/mapped-render-fixture.mjs";
import { GET } from "../app/api/admission+api.ts";

const identity = "http://127.0.0.1:13009";
const wlt = "http://127.0.0.1:13011";
const bearer = Buffer.alloc(32, 8).toString("base64url");
function request(query = "?agreement=store-a", actor = "owner-a", token = bearer) {
  return new Request("http://localhost:18102/api/admission" + query, {
    headers: { ...(token ? { Cookie: "bthwani_merchant_admission=" + token } : {}),
      ...(actor ? { "X-Merchant-Context": actor } : {}) },
  });
}
function owners(t, { role = "merchant", status = 200, review = { storeId: "store-a", proposal: null } } = {}) {
  for (const [name, value] of Object.entries({ MERCHANT_SYNTHETIC_IDENTITY_ORIGIN: identity, MERCHANT_SYNTHETIC_WLT_ORIGIN: wlt })) {
    const old = process.env[name];
    t.after(() => { if (old === undefined) delete process.env[name]; else process.env[name] = old; });
    process.env[name] = value;
  }
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const target = new URL(url);
    calls.push(target.href);
    assert.equal(options.method, "GET");
    assert.equal(options.headers.Authorization, "Bearer " + bearer);
    assert.equal(options.credentials, "omit");
    assert.equal(options.redirect, "error");
    assert.equal(options.cache, "no-store");
    const json = (body, code = 200) => Response.json(body, { status: code, headers: { "Cache-Control": "no-store" } });
    if (target.origin === identity) return json({ actorId: "owner-a", role, sessionExpiresAt: new Date(Date.now() + 120000).toISOString() });
    assert.equal(target.href, wlt + "/v1/merchants/stores/store-a/commercial-agreement");
    return json(review, status);
  });
  return calls;
}
test("agreement reads verified store proposal from WLT, without writes", async t => {
  const calls = owners(t);
  const reply = await GET(request());
  assert.equal(reply.status, 200);
  assert.equal(reply.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await reply.json(), { agreement: { actorId: "owner-a", review: { storeId: "store-a", proposal: null } } });
  assert.equal(calls.length, 2);
});
test("agreement rejects missing or wrong actor and invalid query", async t => {
  const calls = owners(t);
  for (const actor of ["", "owner-b"]) assert.equal((await GET(request(undefined, actor))).status, 403);
  assert.equal((await GET(request(undefined, undefined, ""))).status, 401);
  assert.equal((await GET(request("?agreement=store-a&agreement=store-b"))).status, 400);
  assert.equal(calls.length, 2);
});
test("WLT store denial does not clear unrelated Merchant session", async t => {
  owners(t, { status: 403 });
  const reply = await GET(request());
  assert.equal(reply.status, 403);
  assert.equal(reply.headers.get("Set-Cookie"), null);
});
test("wrong store reply fails closed", async t => {
  owners(t, { review: { storeId: "store-b", proposal: null } });
  assert.equal((await GET(request())).status, 503);
});

const proposal = {
  version: 2, operationId: "proposal-0002", storeRelation: "DIRECT", feeModel: "SUBSCRIPTION",
  collector: "STORE_MANAGED", currency: "YER", commissionBasisPoints: null,
  subscriptionAmountYer: "9007199254740993", subscriptionPeriodDays: 30,
  fulfillmentModes: ["CUSTOMER_PICKUP"], proposedEffectiveAt: "2027-01-01T00:00:00Z",
  reviewState: "REVIEW_APPROVED_PENDING_ACTIVATION",
};
test("agreement preserves exact WLT proposed subscription and never claims activation", async t => {
  const review = { storeId: "store-a", proposal };
  owners(t, { review });
  const reply = await GET(request());
  assert.equal(reply.status, 200);
  assert.deepEqual(await reply.json(), { agreement: { actorId: "owner-a", review } });
});
test("non-Merchant actor cannot contact WLT", async t => {
  const calls = owners(t, { role: "customer" });
  assert.equal((await GET(request())).status, 401);
  assert.equal(calls.length, 1);
});
test("invalid owner origin never receives the Merchant bearer", async t => {
  const calls = owners(t);
  process.env.MERCHANT_SYNTHETIC_WLT_ORIGIN = "https://example.invalid";
  assert.equal((await GET(request())).status, 503);
  assert.equal(calls.length, 1);
});
test("WLT unavailability fails closed without discarding the Merchant session", async t => {
  owners(t, { status: 503 });
  const reply = await GET(request());
  assert.equal(reply.status, 503);
  assert.equal(reply.headers.get("Set-Cookie"), null);
});

const loadedModules = [];
process.once("exit", () => loadedModules.length);
function agreementTransport(platform, withNativeMerchantSession) {
  const temp = mkdtempSync(path.join(tmpdir(), "merchant-agreement-transport-"));
  try {
    const root = path.resolve(import.meta.dirname, "../../..");
    const source = path.resolve(import.meta.dirname, "../src/features/finance/commercial-agreement-transport.ts");
    const result = spawnSync(process.execPath, [
      path.join(root, "node_modules/typescript/bin/tsc"), source,
      "--ignoreConfig", "--noResolve", "--noCheck", "--target", "es2022", "--module", "commonjs",
      "--inlineSourceMap", "--inlineSources", "--outDir", temp,
    ], { cwd: root, encoding: "utf8", timeout: 20_000, windowsHide: true });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const mod = loadMappedRenderFixture(readFileSync(path.join(temp, "commercial-agreement-transport.js"), "utf8"), source, {
      "@bthwani/wlt": ownerClient,
      "react-native": { Platform: { OS: platform } },
      "../access/admission-transport": { withNativeMerchantSession },
    });
    loadedModules.push(mod);
    return mod.exports.readMerchantCommercialAgreement;
  } finally { rmSync(temp, { recursive: true, force: true }); }
}
const noStore = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

test("actual Web agreement transport validates scope, exact terms and late responses", async t => {
  const read = agreementTransport("web", () => assert.fail("Web must not call native session"));
  const signal = new AbortController().signal;
  const review = { storeId: "store-a", proposal };
  const calls = [];
  let respond = () => noStore({ agreement: { actorId: "owner-a", review } });
  t.mock.method(globalThis, "fetch", async (url, options) => { calls.push({ url, options }); return respond(); });
  assert.deepEqual(await read("owner-a", "store-a", signal), review);
  assert.deepEqual(calls[0], {
    url: "/api/admission?agreement=store-a",
    options: { method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error", signal,
      headers: { "X-Merchant-Context": "owner-a" } },
  });
  await assert.rejects(read("", "store-a", signal), { status: 400 });
  await assert.rejects(read("owner-a", "../store", signal), { status: 400 });
  assert.equal(calls.length, 1);
  respond = () => noStore({ agreement: { actorId: "owner-a", review: { storeId: "store-a", proposal: null } } });
  assert.deepEqual(await read("owner-a", "store-a", signal), { storeId: "store-a", proposal: null });
  for (const body of [
    null, {},
    { agreement: { actorId: "owner-b", review } },
    { agreement: { actorId: "owner-a", review: { ...review, storeId: "store-b" } } },
    { agreement: { actorId: "owner-a", review: { ...review, proposal: { ...proposal, reviewState: "ACTIVE" } } } },
    { agreement: { actorId: "owner-a", review: { ...review, proposal: { ...proposal, subscriptionAmountYer: 9007199254740992 } } } },
  ]) {
    respond = () => noStore(body);
    await assert.rejects(read("owner-a", "store-a", signal), { status: 502 });
  }
  respond = () => Response.json({ agreement: { actorId: "owner-a", review } });
  await assert.rejects(read("owner-a", "store-a", signal), { status: 502 });
  for (const status of [401, 403, 503]) {
    respond = () => noStore({}, status);
    await assert.rejects(read("owner-a", "store-a", signal), { status });
  }
  const late = new AbortController();
  respond = () => ({ ok: true, headers: new Headers({ "Cache-Control": "no-store" }),
    json: async () => { late.abort(); return { agreement: { actorId: "owner-a", review } }; } });
  await assert.rejects(read("owner-a", "store-a", late.signal), { name: "AbortError" });
});

test("actual Android agreement transport uses the verified actor and canonical WLT read only", async t => {
  const envName = "EXPO_PUBLIC_MERCHANT_SYNTHETIC_WLT_ORIGIN";
  const previous = process.env[envName];
  t.after(() => { if (previous === undefined) delete process.env[envName]; else process.env[envName] = previous; });
  process.env[envName] = wlt;
  const scopes = [], calls = [];
  const read = agreementTransport("android", async (signal, invoke, actor, write = false) => {
    scopes.push({ signal, actor, write });
    return invoke(bearer);
  });
  let body = { storeId: "store-a", proposal };
  let status = 200;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url: String(url), options });
    return noStore(body, status);
  });
  const signal = new AbortController().signal;
  assert.deepEqual(await read("owner-a", "store-a", signal), body);
  assert.deepEqual(scopes, [{ signal, actor: "owner-a", write: false }]);
  assert.equal(calls[0].url, `${wlt}/v1/merchants/stores/store-a/commercial-agreement`);
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${bearer}`);
  assert.equal(calls[0].options.credentials, "omit");
  assert.equal(calls[0].options.redirect, "error");
  assert.equal(calls[0].options.cache, "no-store");
  body = { storeId: "store-b", proposal };
  await assert.rejects(read("owner-a", "store-a", signal), { status: 502 });
  status = 403;
  await assert.rejects(read("owner-a", "store-a", signal), { status: 403 });
  delete process.env[envName];
  await assert.rejects(read("owner-a", "store-a", signal), { status: 503 });
  assert.equal(calls.length, 3);
  assert.ok(scopes.every(scope => scope.actor === "owner-a" && !scope.write));
});
