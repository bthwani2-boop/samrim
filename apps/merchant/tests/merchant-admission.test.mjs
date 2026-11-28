import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { DshPublicError, MerchantStandingError } from "@bthwani/dsh";
import { IdentityClientError } from "@bthwani/identity";
import { loadMappedRenderFixture } from "../../../tools/dev/mapped-render-fixture.mjs";
import { verifyMerchantAdmission } from "../src/features/access/admission.ts";
import * as merchantAdmissionWeb from "../src/features/access/merchant-admission-web.ts";

const origin = "https://identity.bthwani.test";
const customerBearer = Buffer.alloc(32, 1).toString("base64url");
const merchantBearer = Buffer.alloc(32, 2).toString("base64url");

function verifyAgainstOwner(t, readMerchantSession, onRevoke = () => {}) {
  const revoked = [];
  const sessionExpiresAt = new Date(Date.now() + 60_000).toISOString();
  const merchant = { actorId: "actor-one", role: "merchant", sessionExpiresAt };
  const json = (value, status = 200) => Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
  t.mock.method(globalThis, "fetch", async (url, request) => {
    const path = new URL(url).pathname;
    const bearer = request.headers.Authorization?.slice("Bearer ".length);
    switch (`${request.method} ${path}`) {
      case "POST /v1/customer-auth/phone-verification":
        return json({ accessToken: customerBearer, sessionExpiresAt });
      case "GET /v1/sessions/current":
        if (bearer === customerBearer) return json({ ...merchant, role: "customer" });
        assert.equal(bearer, merchantBearer);
        return readMerchantSession(json, merchant);
      case "POST /v1/actors/me/merchant-role":
        assert.equal(bearer, customerBearer);
        return json({ accessToken: merchantBearer, sessionExpiresAt }, 201);
      case "DELETE /v1/sessions/current":
        assert.equal(request.signal.aborted, false);
        revoked.push(bearer);
        onRevoke(bearer);
        return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
      default:
        assert.fail(`Unexpected owner call ${request.method} ${path}`);
    }
  });
  const signal = new AbortController();
  return { merchant, revoked, signal, verify: () =>
    verifyMerchantAdmission(origin, Buffer.alloc(32, 3).toString("base64url"), "123456", signal.signal) };
}

test("Merchant admission retains only the verified session for the same actor", async t => {
  const { merchant, revoked, verify } = verifyAgainstOwner(t, (json, session) => json(session));
  assert.deepEqual(await verify(), { bearer: merchantBearer, session: merchant });
  assert.deepEqual(revoked, [customerBearer]);
});

test("Merchant admission revokes an issued bearer when its owner read selects another actor", async t => {
  const { revoked, verify } = verifyAgainstOwner(t, (json, session) =>
    json({ ...session, actorId: "actor-two" }));
  await assert.rejects(verify, { code: "OWNER_RESPONSE_INVALID" });
  assert.deepEqual(revoked.sort(), [customerBearer, merchantBearer].sort());
});

test("Merchant admission cleans up after the caller cancels the owner read", async t => {
  const { revoked, signal, verify } = verifyAgainstOwner(t, (json, session) => {
    signal.abort();
    return json(session);
  });
  await assert.rejects(verify, { code: "OWNER_RESPONSE_STALE" });
  assert.deepEqual(revoked.sort(), [customerBearer, merchantBearer].sort());
});

test("Merchant admission revokes its session if cancellation occurs during Customer cleanup", async t => {
  const { revoked, signal, verify } = verifyAgainstOwner(t, (json, session) => json(session), bearer => {
    if (bearer === customerBearer) signal.abort();
  });
  await assert.rejects(verify, { code: "OPERATION_RESULT_UNKNOWN" });
  assert.deepEqual(revoked, [customerBearer, merchantBearer]);
});

const transportSource = fileURLToPath(new URL("../src/features/access/admission-transport.ts", import.meta.url));
const root = path.resolve(import.meta.dirname, "../../..");
const temporary = mkdtempSync(path.join(tmpdir(), "merchant-admission-coverage-"));
let compiled;
try {
  const result = spawnSync(process.execPath, [
    path.join(root, "node_modules/@typescript/native/bin/tsc"), transportSource,
    "--ignoreConfig", "--noResolve", "--noCheck", "--target", "es2022",
    "--module", "commonjs", "--inlineSourceMap", "--inlineSources", "--outDir", temporary,
  ], { cwd: root, timeout: 20_000, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  compiled = readFileSync(path.join(temporary, "admission-transport.js"), "utf8");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

const installedKey = "bthwani.merchant.synthetic-admission.v1";
const refreshKey = `${installedKey}.refresh.v1`;
const pendingKey = `${installedKey}.pending.v1`;
const refreshToken = Buffer.alloc(32, 4).toString("base64url");
function transportHarness() {
  const storage = new Map();
  const revoked = [];
  const state = { actorId: "merchant-fixture", role: "merchant", sessionExpiresAt: new Date(Date.now() + 60_000).toISOString() };
  let read = async (bearer) => ({ session: state, bearer });
  let verifyCalls = 0;
  const dependencies = {
    "./merchant-admission-web.ts": merchantAdmissionWeb,
    "@bthwani/identity": {
      IdentityClientError,
      async establishPersistentIdentitySession(_origin, bearer) {
        assert.equal(bearer, merchantBearer);
        return { refreshToken };
      },
      async issueCustomerPhoneChallenge(_origin, phone) { assert.equal(phone, "770000001"); return "fixture-ticket"; },
      async readPersistentIdentityRole(_origin, bearer, refresh, role, signal, beforeRotate, storeIssued) {
        assert.equal(role, "merchant");
        return read(bearer, refresh, signal, beforeRotate, storeIssued);
      },
      async revokePersistentIdentitySession(_origin, token) { revoked.push(token); },
      async revokeVerifiedIdentitySession(_origin, bearer) { revoked.push(bearer); },
    },
    "expo-secure-store": {
      WHEN_UNLOCKED_THIS_DEVICE_ONLY: "device-only",
      async getItemAsync(key, options) { assert.equal(options.keychainAccessible, "device-only"); return storage.get(key) ?? null; },
      async setItemAsync(key, value) { storage.set(key, value); },
      async deleteItemAsync(key) { storage.delete(key); },
    },
    "react-native": { Platform: { OS: "android" } },
    "./admission": {
      async verifyMerchantAdmission() { verifyCalls++; return { session: state, bearer: merchantBearer }; },
      async revokeUndeliveredAdmissionSession(_origin, bearer) { revoked.push(bearer); },
    },
    "@bthwani/dsh": { DshPublicError,
      MerchantStandingError,
      standingFrom(value) { return value; },
      async readMerchantDSHStanding(_origin, bearer) { assert.equal(bearer, merchantBearer); return { stores: [] }; },
    },
  };
  function load({ legacySetting = false, platform = "android", enabled = true } = {}) {
    const env = {
      EXPO_PUBLIC_MERCHANT_SYNTHETIC_IDENTITY_ORIGIN: enabled ? "http://127.0.0.1:3201" : "",
      EXPO_PUBLIC_MERCHANT_SYNTHETIC_DSH_ORIGIN: "http://127.0.0.1:3202",
      EXPO_PUBLIC_BTHWANI_SURFACE_PREVIEW: legacySetting ? "1" : "0",
    };
    const previous = new Map(Object.keys(env).map(key => [key, process.env[key]]));
    try {
      Object.assign(process.env, env);
      dependencies["react-native"].Platform.OS = platform;
      return loadMappedRenderFixture(compiled, transportSource, dependencies).exports;
    } finally {
      for (const [key, value] of previous) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  }
  return {
    storage, revoked, state, load,
    setRead(fn) { read = fn; },
    get verifyCalls() { return verifyCalls; },
  };
}

test("native Merchant admission requires the owner and ignores the retired Surface setting", async () => {
  const h = transportHarness();
  const signal = new AbortController().signal;
  const retiredKey = "bthwani.merchant.synthetic-admission.surface.v1";
  h.storage.set(installedKey, merchantBearer);
  h.storage.set(refreshKey, refreshToken);
  h.setRead(async bearer => {
    assert.equal(bearer, merchantBearer);
    return { session: h.state, bearer };
  });
  assert.deepEqual(await h.load({ enabled: false }).readAdmission(signal), { enabled: false, session: null });
  const api = h.load({ legacySetting: true });
  assert.deepEqual(await api.readAdmission(signal), { enabled: true, session: h.state });
  h.storage.set(retiredKey, customerBearer);
  assert.deepEqual(await api.readAdmission(signal), { enabled: true, session: h.state });
  const isolated = transportHarness();
  isolated.storage.set(retiredKey, customerBearer);
  isolated.storage.set(retiredKey + ".refresh.v1", refreshToken);
  const retired = isolated.load({ legacySetting: true });
  assert.deepEqual(await retired.readAdmission(signal), { enabled: true, session: null });
  await retired.signOutOfAdmission(signal);
  assert.deepEqual(isolated.revoked, []);
  assert.equal(isolated.storage.get(retiredKey), customerBearer);
  assert.equal(isolated.storage.get(retiredKey + ".refresh.v1"), refreshToken);
  assert.deepEqual(h.revoked, []);
  assert.equal(h.storage.get(installedKey), merchantBearer);
  assert.equal(h.storage.get(refreshKey), refreshToken);
});

test("Merchant browser admission ignores retired cookies and the retired Surface setting", async () => {
  const previous = process.env.BTHWANI_SURFACE_PREVIEW;
  try {
    process.env.BTHWANI_SURFACE_PREVIEW = "1";
    const api = await import("../src/features/access/browser-admission-http.ts?retired-surface-cookie");
    const canonical = "bthwani_merchant_admission";
    const retired = "bthwani_surface_merchant_admission";
    assert.equal(api.cookieName, canonical);
    assert.equal(api.refreshCookieName, canonical + ".refresh");
    const oldCookies = retired + "=" + customerBearer + "; " + retired + ".refresh=" + customerBearer;
    const request = cookies => new Request("https://localhost/api/admission", { headers: { cookie: cookies } });
    assert.equal(api.bearerFrom(request(oldCookies)), undefined);
    assert.equal(api.refreshFrom(request(oldCookies)), null);
    const both = request(oldCookies + "; " + canonical + "=" + merchantBearer + "; " + canonical + ".refresh=" + refreshToken);
    assert.equal(api.bearerFrom(both), merchantBearer);
    assert.equal(api.refreshFrom(both), refreshToken);
    assert.equal(api.sessionCookie(both, merchantBearer, 60), canonical + "=" + merchantBearer + "; Path=/api/admission; HttpOnly; SameSite=Strict; Max-Age=60; Secure");
  } finally {
    if (previous === undefined) delete process.env.BTHWANI_SURFACE_PREVIEW;
    else process.env.BTHWANI_SURFACE_PREVIEW = previous;
  }
});

test("native Merchant admission persists its credential pair, verifies the current role and revokes only that pair on sign-out", async () => {
  const h = transportHarness();
  const api = h.load();
  const signal = new AbortController().signal;
  assert.deepEqual(await api.readAdmission(signal), { enabled: true, session: null });
  assert.equal(await api.requestAdmissionCode("770000001", signal), "fixture-ticket");
  assert.deepEqual(await api.submitAdmissionCode("fixture-ticket", "123456", signal), h.state);
  assert.equal(h.storage.get(installedKey), merchantBearer);
  assert.equal(h.storage.get(refreshKey), refreshToken);
  assert.equal(h.storage.has(pendingKey), false);
  assert.deepEqual(await api.readAdmission(signal), { enabled: true, session: h.state });
  await assert.rejects(() => api.submitAdmissionCode("fixture-ticket", "123456", signal), { code: "SIGN_OUT_REQUIRED" });
  assert.equal(h.verifyCalls, 1);
  await api.signOutOfAdmission(signal);
  assert.deepEqual(h.revoked, [refreshToken, merchantBearer]);
  assert.equal(h.storage.size, 0);
});

test("native Merchant admission preserves a credential on owner outage but clears it on definitive denial", async () => {
  const h = transportHarness();
  const signal = new AbortController().signal;
  h.storage.set(installedKey, merchantBearer);
  h.storage.set(refreshKey, refreshToken);
  const api = h.load();
  h.setRead(async () => { throw new IdentityClientError(503, "OWNER_UNAVAILABLE"); });
  await assert.rejects(() => api.readAdmission(signal), { code: "OWNER_UNAVAILABLE" });
  assert.equal(h.storage.get(installedKey), merchantBearer);
  h.setRead(async () => { throw new IdentityClientError(401, "UNAUTHORIZED"); });
  assert.deepEqual(await api.readAdmission(signal), { enabled: true, session: null });
  assert.equal(h.storage.size, 0);
});

test("cold-start Merchant recovery revokes a quarantined refresh before exposing any session", async () => {
  const h = transportHarness();
  h.storage.set(installedKey, merchantBearer);
  h.storage.set(refreshKey, refreshToken);
  h.storage.set(pendingKey, "in-flight");
  h.setRead(async () => assert.fail("quarantined bearer must never be verified"));
  const api = h.load();
  assert.deepEqual(await api.readAdmission(new AbortController().signal), { enabled: true, session: null });
  assert.deepEqual(h.revoked, [refreshToken]);
  assert.equal(h.storage.size, 0);
});

test("native Merchant owner requests reject mismatched actor and discard stale read and uncertain write results", async () => {
  const h = transportHarness();
  const signal = new AbortController().signal;
  const api = h.load();
  h.storage.set(installedKey, merchantBearer);
  await assert.rejects(() => api.withNativeMerchantSession(signal, async () => assert.fail("wrong actor"), "other-actor"), { code: "MERCHANT_CONTEXT_CHANGED" });
  assert.deepEqual(await api.readMerchantStanding(signal), { stores: [] });
  for (const isWrite of [false, true]) {
    h.storage.set(installedKey, merchantBearer);
    await assert.rejects(() => api.withNativeMerchantSession(signal, async (bearer, dshOrigin) => {
      assert.equal(bearer, merchantBearer);
      assert.equal(dshOrigin, "http://127.0.0.1:3202");
      h.storage.set(installedKey, customerBearer);
      return "late response";
    }, h.state.actorId, isWrite), { code: isWrite ? "OPERATION_RESULT_UNKNOWN" : "OWNER_RESPONSE_STALE" });
    assert.equal(h.storage.get(installedKey), customerBearer);
  }
});

test("web Merchant transport uses same-origin no-store requests and distinguishes scoped denial from session errors", async t => {
  const h = transportHarness();
  const api = h.load({ platform: "web" });
  const signal = new AbortController().signal;
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, request) => {
    assert.equal(request.credentials, "same-origin");
    assert.equal(request.cache, "no-store");
    assert.equal(request.signal, signal);
    calls.push([url, request.method, request.body && JSON.parse(request.body)]);
    if (request.method === "DELETE") return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
    if (url.endsWith("stores=mine")) return Response.json({ code: "STORE_ACCESS_DENIED" }, { status: 403, headers: { "Cache-Control": "no-store" } });
    if (request.method === "GET") return Response.json({ code: "UNAUTHORIZED" }, { status: 401, headers: { "Cache-Control": "no-store" } });
    if (JSON.parse(request.body).phone) return Response.json({ ticket: "a".repeat(48) }, { status: 201, headers: { "Cache-Control": "no-store" } });
    return Response.json({ session: h.state }, { headers: { "Cache-Control": "no-store" } });
  });
  assert.equal(await api.requestAdmissionCode("770000001", signal), "a".repeat(48));
  assert.deepEqual(await api.submitAdmissionCode("fixture-ticket", "123456", signal), h.state);
  await assert.rejects(() => api.readMerchantStanding(signal), { name: "MerchantStandingError", code: "STORE_ACCESS_DENIED" });
  await assert.rejects(() => api.readAdmission(signal), { code: "UNAUTHORIZED" });
  await api.signOutOfAdmission(signal);
  assert.deepEqual(calls.map(([url, method]) => [url, method]), [
    ["/api/admission", "POST"], ["/api/admission", "POST"],
    ["/api/admission?stores=mine", "GET"], ["/api/admission", "GET"], ["/api/admission", "DELETE"],
  ]);
  assert.equal(h.storage.size, 0);
});

test("Web admission cannot accept another role or cacheable identity response", async t => {
  const h = transportHarness();
  const api = h.load({ platform: "web" });
  const signal = new AbortController().signal;
  let reply = Response.json({ enabled: true, session: { ...h.state, role: "customer" } }, {
    headers: { "Cache-Control": "no-store" },
  });
  t.mock.method(globalThis, "fetch", async () => reply);
  await assert.rejects(api.readAdmission(signal), { code: "OWNER_RESPONSE_INVALID" });
  reply = Response.json({ enabled: true, session: h.state }, { headers: { "Cache-Control": "public" } });
  await assert.rejects(api.readAdmission(signal), { code: "OWNER_RESPONSE_INVALID" });
});

test("Web admission does not treat a malformed sign-in acknowledgement as success", async t => {
  const h = transportHarness();
  const api = h.load({ platform: "web" });
  const signal = new AbortController().signal;
  t.mock.method(globalThis, "fetch", async () => Response.json({ session: { ...h.state, role: "operator" } }, {
    headers: { "Cache-Control": "no-store" },
  }));
  await assert.rejects(api.submitAdmissionCode("fixture-ticket", "123456", signal), { code: "OPERATION_RESULT_UNKNOWN" });
});
