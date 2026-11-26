import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import * as identity from "@bthwani/identity";
import { loadMappedRenderFixture } from "../../../tools/dev/mapped-render-fixture.mjs";
import { readBoundedCustomerJSON } from "../src/features/access/bounded-customer-json.ts";

const root = path.resolve(import.meta.dirname, "../../..");
const source = path.resolve(import.meta.dirname, "../src/features/access/customer-session-transport.ts");
const temp = mkdtempSync(path.join(tmpdir(), "bthwani-customer-session-"));
let compiled;
try {
  const result = spawnSync(process.execPath, [path.join(root, "node_modules/typescript/bin/tsc"), source,
    "--ignoreConfig", "--noResolve", "--noCheck", "--target", "es2022", "--module", "commonjs",
    "--inlineSourceMap", "--inlineSources", "--outDir", temp], { cwd: root, encoding: "utf8", timeout: 20000, windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  compiled = readFileSync(path.join(temp, "customer-session-transport.js"), "utf8");
} finally { rmSync(temp, { recursive: true, force: true }); }
const retainedModules = [];

const original = Buffer.alloc(32, 1).toString("base64url");
const next = Buffer.alloc(32, 2).toString("base64url");
const expiry = new Date(Date.now() + 240000).toISOString();
const refreshGrant = Buffer.alloc(32, 3).toString("base64url");
class IdentityError extends Error {
  constructor(status, code = "UNAUTHORIZED") {
    super(code);
    this.status = status;
    this.code = code;
  }
}
const customer = bearer => ({ actorId: bearer === original ? "actor-old" : "actor-new",
  role: "customer", sessionExpiresAt: expiry });

function harness({ stored = original, nativeOrigin = "http://127.0.0.1:33221", ownerRole = "customer", storageDeletionFails = false, postDeleteMarkerThrows = false, lenovoPreview, legacySetting, platform = "android" } = {}) {
  let bearer = stored;
  let refresh = null;
  let pendingMarker = null;
  let read = async value => ({ ...customer(value), role: ownerRole });
  let codeVerification = async () => ({ accessToken: next, sessionExpiresAt: expiry });
  let enroll = async () => ({ refreshToken: refreshGrant, refreshExpiresAt: expiry });
  let revoke = async value => { revoked.push(value); };
  let onStorageWrite = () => {};
  let onRefreshWrite = () => {};
  const revoked = [];
  const storageReads = [];
  const secure = {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: "this-device",
    async getItemAsync(key) {
      storageReads.push(key);
      if (key.endsWith(".pending.v1")) return pendingMarker;
      if (key.endsWith(".refresh.v1")) return refresh;
      return bearer;
    },
    async setItemAsync(key, value) {
      if (key.endsWith(".pending.v1")) { pendingMarker = value; return; }
      if (key.endsWith(".refresh.v1")) { refresh = value; onRefreshWrite(); return; }
      bearer = value;
      onStorageWrite();
    },
    async deleteItemAsync(key) {
      if (key.endsWith(".pending.v1") && postDeleteMarkerThrows) {
        pendingMarker = null;
        throw new Error("pending marker deletion acknowledgement failed");
      }
      if (storageDeletionFails) throw new Error("device storage deletion temporarily unavailable");
      if (key.endsWith(".pending.v1")) pendingMarker = null;
      else if (key.endsWith(".refresh.v1")) refresh = null;
      else bearer = null;
    },
  };
  const fake = {
    "@bthwani/identity": {
      IdentityClientError: IdentityError,
      parseVerifiedIdentitySession: identity.parseVerifiedIdentitySession,
      parseCustomerPhoneChallenge: identity.parseCustomerPhoneChallenge,
      issueCustomerPhoneChallenge: async () => "ticket",
      readVerifiedIdentitySession: (_origin, value, signal) => read(value, signal),
      establishPersistentIdentitySession: (_origin, value, signal) => {
        assert.equal(value, next);
        return enroll(signal);
      },
      async readPersistentIdentityRole(_origin, value, token, role, signal) {
        assert.equal(token, refresh, "fixture must supply the persisted refresh credential");
        assert.ok(token === null || token === refreshGrant);
        const session = await read(value, signal);
        if (session.role !== role) throw new IdentityError(403, "FORBIDDEN");
        return { session, bearer: value };
      },
      async revokePersistentIdentitySession(_origin, value) {
        assert.equal(value, refreshGrant);
      },
      revokeVerifiedIdentitySession: (_origin, value, signal) => revoke(value, signal),
      verifyCustomerPhoneChallenge: (_origin, ticket, code, signal) => codeVerification(ticket, code, signal),
    },
    "../access/bounded-customer-json": { readBoundedCustomerJSON },
    "./bounded-customer-json": { readBoundedCustomerJSON },
    "expo-secure-store": secure,
    "react-native": { Platform: { OS: platform } },
  };
  const mount = () => {
    const env = {
      EXPO_PUBLIC_CUSTOMER_SYNTHETIC_IDENTITY_ORIGIN: nativeOrigin,
      EXPO_PUBLIC_BTHWANI_LENOVO_CUSTOMER_ANDROID_PREVIEW: lenovoPreview,
      EXPO_PUBLIC_BTHWANI_SURFACE_PREVIEW: legacySetting,
    };
    const saved = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
    try {
      for (const [key, value] of Object.entries(env)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
      const fixture = loadMappedRenderFixture(compiled, source, fake);
      retainedModules.push(fixture);
      return fixture.exports;
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
  };
  return {
    transport: mount(), reload: mount, revoked, storageReads, pending: () => pendingMarker,
    current: () => bearer,
    currentRefresh: () => refresh,
    setEnrollment(fn) { enroll = fn; },
    setCurrent(value) { bearer = value; },
    setRead(fn) { read = fn; },
    setVerification(fn) { codeVerification = fn; },
    setRevoke(fn) { revoke = fn; },
    setOnStorageWrite(fn) { onStorageWrite = fn; },
    setRefreshWrite(fn) { onRefreshWrite = fn; },
  };
}

const webJSON = (value, status = 200, cache = "no-store") => Response.json(value, { status, headers: { "Cache-Control": cache } });
const webSignal = () => new AbortController().signal;
const webSession = { actorId: "synthetic-web-actor", role: "customer", sessionExpiresAt: "2030-01-01T00:00:00Z" };
const webState = { enabled: true, session: webSession };
const webFailure = (status, code) => e => e.status === status && e.code === code;

function webHarness(t) {
  const h = harness({ platform: "web" });
  const replies = [], calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url, ...options });
    assert.ok(replies.length, "unexpected auth request");
    const next = replies.shift();
    if (next instanceof Error) throw next;
    return next;
  });
  return { api: h.transport, replies, calls };
}

test("Web auth accepts only current owner session, exact challenge, verify and logout responses", async t => {
  const h = webHarness(t);
  const ticket = "f".repeat(48);
  h.replies.push(webJSON(webState), webJSON({ ticket }, 201), webJSON({ session: webSession }),
    new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } }));
  assert.deepEqual(await h.api.readCustomerAdmission(webSignal()), webState);
  assert.equal(await h.api.requestCustomerCode("+967770000077", webSignal()), ticket);
  assert.deepEqual(await h.api.verifyCustomerCode(ticket, "123456", webSignal()), webSession);
  assert.equal(await h.api.signOutCustomer(webSignal()), undefined);
  assert.deepEqual(h.calls.map(r => r.method), ["GET", "POST", "POST", "DELETE"]);
  assert.ok(h.calls.every(r => r.url === "/api/customer-auth" && r.credentials === "same-origin" && r.cache === "no-store" && r.redirect === "error"));
  assert.deepEqual(JSON.parse(h.calls[1].body), { phone: "+967770000077" });
  assert.deepEqual(JSON.parse(h.calls[2].body), { ticket, code: "123456" });
});

test("Web admission rejects invalid status, cache, MIME, size, and owner-session envelopes", async t => {
  const h = webHarness(t);
  const body = JSON.stringify(webState);
  for (const invalid of [
    new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } }),
    webJSON(webState, 200, "public"),
    new Response(body, { headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } }),
    new Response(body, { headers: { "Content-Type": "application/json", "Content-Length": "16385", "Cache-Control": "no-store" } }),
    new Response(body + " ".repeat(16385), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }),
    webJSON({ enabled: "true", session: webSession }),
    webJSON({ enabled: false, session: webSession }),
    webJSON({ enabled: true, session: { ...webSession, role: "merchant" } }),
    webJSON({ enabled: true, session: { ...webSession, sessionExpiresAt: "invalid" } }),
    webJSON({ enabled: true, session: { ...webSession, accessToken: "synthetic-unexpected" } }),
  ]) {
    h.replies.push(invalid);
    await assert.rejects(h.api.readCustomerAdmission(webSignal()), webFailure(502, "OWNER_RESPONSE_INVALID"));
  }
  for (const status of [401, 403]) {
    h.replies.push(webJSON({ code: "UNAUTHORIZED" }, status));
    assert.deepEqual(await h.api.readCustomerAdmission(webSignal()), { enabled: true, session: null });
  }
  h.replies.push(webJSON({ enabled: false, session: null }), webJSON({ enabled: true, session: null }));
  assert.deepEqual(await h.api.readCustomerAdmission(webSignal()), { enabled: false, session: null });
  assert.deepEqual(await h.api.readCustomerAdmission(webSignal()), { enabled: true, session: null });
});

test("Web auth mutation refuses invalid receipts and preserves unknown result without replay", async t => {
  const h = webHarness(t);
  const ticket = "f".repeat(48);
  for (const response of [webJSON({ ticket }, 200), webJSON({ ticket: "invalid" }, 201),
    webJSON({ ticket }, 201, "public"), webJSON({ ticket, accessToken: "unexpected" }, 201)]) {
    h.replies.push(response);
    await assert.rejects(h.api.requestCustomerCode("+967770000077", webSignal()), webFailure(502, "OPERATION_RESULT_UNKNOWN"));
  }
  for (const response of [webJSON({ session: { ...webSession, role: "captain" } }),
    webJSON({ session: webSession, accessToken: "unexpected" }), webJSON({ session: { ...webSession, sessionExpiresAt: "invalid" } })]) {
    h.replies.push(response);
    await assert.rejects(h.api.verifyCustomerCode(ticket, "123456", webSignal()), webFailure(502, "OPERATION_RESULT_UNKNOWN"));
  }
  h.replies.push(new Response(null, { status: 204, headers: { "Cache-Control": "public" } }));
  await assert.rejects(h.api.signOutCustomer(webSignal()), webFailure(502, "OPERATION_RESULT_UNKNOWN"));
  h.replies.push(webJSON({ code: "SIGN_OUT_REQUIRED" }, 409));
  await assert.rejects(h.api.verifyCustomerCode(ticket, "123456", webSignal()), webFailure(409, "SIGN_OUT_REQUIRED"));
  assert.equal(h.calls.length, 9, "one dispatch per explicit action");
});

test("Web session read and OTP mutation release stalled bodies on abort", async t => {
  const h = webHarness(t);
  for (const method of ["GET", "POST"]) {
    const ctl = new AbortController();
    let stream, cancelled = false, timer;
    h.replies.push(new Response(new ReadableStream({ start(c) { stream = c; }, cancel() { cancelled = true; } }),
      { status: method === "GET" ? 200 : 201, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }));
    const pending = (method === "GET" ? h.api.readCustomerAdmission(ctl.signal) : h.api.requestCustomerCode("+967770000077", ctl.signal))
      .then(() => "UNEXPECTED", e => e.code);
    try {
      await new Promise(resolve => setImmediate(resolve));
      ctl.abort();
      assert.equal(await Promise.race([pending, new Promise(resolve => { timer = setTimeout(() => resolve("STALLED"), 500); })]),
        method === "GET" ? "OWNER_RESPONSE_STALE" : "OPERATION_RESULT_UNKNOWN");
      assert.equal(cancelled, true);
    } finally {
      clearTimeout(timer);
      if (!cancelled) stream.close();
      await pending;
    }
  }
});

test("Lenovo Android admission uses its own storage and accepts only the opted-in USB loopback origin", async () => {
  const signal = new AbortController().signal;
  const nativeOrigin = "http://127.0.0.1:3201";
  const approved = harness({ nativeOrigin, lenovoPreview: "1" });
  assert.deepEqual(await approved.transport.readCustomerAdmission(signal), { enabled: true, session: customer(original) });
  assert.ok(approved.storageReads.length > 0);
  assert.ok(approved.storageReads.every(key => key.startsWith("bthwani.customer.synthetic-identity.lenovo-android.v1")));

  for (const settings of [
    { nativeOrigin: "http://127.0.0.1:33221", lenovoPreview: "1" },
    { nativeOrigin, lenovoPreview: "1", platform: "ios" },
  ]) {
    const rejected = harness(settings);
    assert.deepEqual(await rejected.transport.readCustomerAdmission(signal), { enabled: false, session: null });
    await rejected.transport.signOutCustomer(signal);
    assert.deepEqual(rejected.storageReads, []);
  }
});

test("Customer role-scoped native admission reads only current Identity actor", async () => {
  const h = harness();
  const state = await h.transport.readCustomerAdmission(new AbortController().signal);
  assert.deepEqual(state, { enabled: true, session: customer(original) });
  assert.equal(h.current(), original);
});

for (const status of [401, 403]) {
  test(`native invalidated Customer bearer ${status} is erased, not restored on app resume`, async () => {
    const h = harness();
    h.setRead(async () => { throw new IdentityError(status); });
    const signal = new AbortController().signal;
    assert.deepEqual(await h.transport.readCustomerAdmission(signal), { enabled: true, session: null });
    assert.equal(h.current(), null);
    assert.deepEqual(await h.transport.readCustomerAdmission(signal), { enabled: true, session: null });
  });
}

test("native wrong-role token never authenticates Customer and is removed", async () => {
  const h = harness({ ownerRole: "operator" });
  assert.deepEqual(await h.transport.readCustomerAdmission(new AbortController().signal),
    { enabled: true, session: null });
  assert.equal(h.current(), null);
});

test("native owner outage retains bearer for retry instead of authorizing user", async () => {
  const h = harness();
  h.setRead(async () => { throw new IdentityError(503, "OWNER_UNAVAILABLE"); });
  await assert.rejects(h.transport.readCustomerAdmission(new AbortController().signal), { status: 503 });
  assert.equal(h.current(), original);
});

test("native verified phone proof stores both Customer credentials before success", async () => {
  const h = harness({ stored: null });
  const entry = await h.transport.verifyCustomerCode("ticket", "123456", new AbortController().signal);
  assert.deepEqual(entry, customer(next));
  assert.equal(h.current(), next);
  assert.equal(h.currentRefresh(), refreshGrant);
  assert.equal(h.pending(), null);
});

test("wrong-role result after proof never stores token and revokes issued credential", async () => {
  const h = harness({ stored: null, ownerRole: "merchant" });
  await assert.rejects(h.transport.verifyCustomerCode("ticket", "123456", new AbortController().signal),
    { code: "OWNER_RESPONSE_INVALID" });
  assert.equal(h.current(), null);
  assert.deepEqual(h.revoked, [next]);
});

test("native actor switch requires logout before another phone credential issuance", async () => {
  const h = harness();
  let issued = false;
  h.setVerification(async () => { issued = true; return { accessToken: next, sessionExpiresAt: expiry }; });
  await assert.rejects(h.transport.verifyCustomerCode("ticket", "123456", new AbortController().signal),
    { status: 409, code: "SIGN_OUT_REQUIRED" });
  assert.equal(issued, false);
  assert.equal(h.current(), original);
});

test("concurrent new native session cannot be overwritten by an older proof response", async () => {
  const h = harness({ stored: null });
  let complete;
  let onOwnerRead;
  const atOwner = new Promise(resolve => { onOwnerRead = resolve; });
  h.setVerification(() => new Promise(resolve => { complete = resolve; onOwnerRead(); }));
  const pending = h.transport.verifyCustomerCode("ticket", "123456", new AbortController().signal);
  await atOwner;
  h.setCurrent(original);
  complete({ accessToken: next, sessionExpiresAt: expiry });
  await assert.rejects(pending, { status: 409, code: "SIGN_OUT_REQUIRED" });
  assert.equal(h.current(), original);
  assert.deepEqual(h.revoked, [next]);
});

test("cancelled native Customer SecureStore write never restores an issued credential", async () => {
  const h = harness({ stored: null });
  const controller = new AbortController();
  h.setOnStorageWrite(() => controller.abort());
  await assert.rejects(h.transport.verifyCustomerCode("ticket", "123456", controller.signal),
    { code: "OPERATION_RESULT_UNKNOWN" });
  assert.equal(h.current(), null);
  assert.deepEqual(h.revoked, [next]);
  const session = await h.transport.readCustomerAdmission(new AbortController().signal);
  assert.deepEqual(session, { enabled: true, session: null });
});

test("Customer SecureStore error after write does not retain an undelivered credential", async () => {
  const h = harness({ stored: null });
  h.setOnStorageWrite(() => { throw new Error("device storage acknowledgement failed"); });
  await assert.rejects(h.transport.verifyCustomerCode("ticket", "123456", new AbortController().signal),
    /device storage acknowledgement failed/);
  assert.equal(h.current(), null);
  assert.deepEqual(h.revoked, [next]);
});

test("Customer logout revokes only current role-specific bearer", async () => {
  const h = harness();
  await h.transport.signOutCustomer(new AbortController().signal);
  assert.deepEqual(h.revoked, [original]);
  assert.equal(h.current(), null);
});

test("wrong-role token logout only clears app token without revoking another role", async () => {
  const h = harness({ ownerRole: "merchant" });
  await h.transport.signOutCustomer(new AbortController().signal);
  assert.equal(h.current(), null);
  assert.deepEqual(h.revoked, []);
});

test("Customer disabled environment offers no synthetic native session", async () => {
  const h = harness({ nativeOrigin: "", stored: null });
  assert.deepEqual(await h.transport.readCustomerAdmission(new AbortController().signal),
    { enabled: false, session: null });
});

test("overlapping Customer native phone proofs issue only one Identity credential", async () => {
  const h = harness({ stored: null });
  let started;
  const issued = new Promise(resolve => { started = resolve; });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let verificationCount = 0;
  h.setVerification(async () => {
    verificationCount++;
    started();
    await gate;
    return { accessToken: next, sessionExpiresAt: expiry };
  });
  const signal = new AbortController().signal;
  const first = h.transport.verifyCustomerCode("ticket-a", "111111", signal);
  await issued;
  const second = h.transport.verifyCustomerCode("ticket-b", "222222", signal);
  await Promise.resolve();
  await Promise.resolve();
  release();
  const outcomes = await Promise.allSettled([first, second]);
  assert.equal(verificationCount, 1, "a second native proof must not consume another owner challenge");
  assert.equal(outcomes.filter(outcome => outcome.status === "fulfilled").length, 1);
  const rejected = outcomes.filter(outcome => outcome.status === "rejected");
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason.code, "SIGN_OUT_REQUIRED");
  assert.equal(h.current(), next);
  assert.deepEqual(h.revoked, [], "a losing proof must not revoke the winning credential");
});

test("failed Customer native owner proof unlocks the next authorized attempt", async () => {
  const h = harness({ stored: null });
  h.setVerification(async () => { throw new IdentityError(503, "OWNER_UNAVAILABLE"); });
  const signal = new AbortController().signal;
  await assert.rejects(h.transport.verifyCustomerCode("ticket-a", "111111", signal), { status: 503 });
  h.setVerification(async () => ({ accessToken: next, sessionExpiresAt: expiry }));
  assert.deepEqual(await h.transport.verifyCustomerCode("ticket-b", "222222", signal), customer(next));
  assert.equal(h.current(), next);
});

test("aborted native Customer verification cannot consume another phone proof", async () => {
  const h = harness({ stored: null });
  const controller = new AbortController();
  let consumed = 0;
  h.setVerification(async () => {
    consumed++;
    return { accessToken: next, sessionExpiresAt: expiry };
  });
  controller.abort();
  await assert.rejects(h.transport.verifyCustomerCode("ticket", "123456", controller.signal),
    { code: "OPERATION_RESULT_UNKNOWN" });
  assert.equal(consumed, 0);
  assert.equal(h.current(), null);
  assert.deepEqual(h.revoked, []);
});

test("Customer undelivered bearer never resurrects after reload when device deletion and owner revocation fail", async () => {
  const h = harness({ stored: null, storageDeletionFails: true });
  h.setOnStorageWrite(() => { throw new Error("device storage acknowledgement failed"); });
  await assert.rejects(h.transport.verifyCustomerCode("ticket", "123456", new AbortController().signal),
    /device storage acknowledgement failed/);
  assert.equal(h.current(), next);
  assert.ok(h.pending(), "a durable write-intent marker must be written before the bearer");
  const restarted = h.reload();
  assert.deepEqual(await restarted.readCustomerAdmission(new AbortController().signal),
    { enabled: true, session: null }, "restart must not recover an undelivered credential");
  assert.equal(h.current(), next);
  assert.ok(h.pending(), "failed deletion cannot remove the durable quarantine marker");
  await assert.rejects(restarted.verifyCustomerCode("another-ticket", "111111", new AbortController().signal),
    { status: 409, code: "SIGN_OUT_REQUIRED" }, "a stuck marker must block another proof");
  assert.deepEqual(h.revoked, [next], "owner revoke attempted but assumed unavailable");
});

test("Customer successful native proof removes durable pending marker before accepting a session", async () => {
  const h = harness({ stored: null });
  assert.equal((await h.transport.verifyCustomerCode("ticket", "123456", new AbortController().signal)).role,
    "customer");
  assert.equal(h.pending(), null);
  assert.equal((await h.reload().readCustomerAdmission(new AbortController().signal)).session.role, "customer");
});

test("Customer cancelled native device write cannot authorize a bearer after module restart", async () => {
  const h = harness({ stored: null, storageDeletionFails: true });
  const controller = new AbortController();
  h.setOnStorageWrite(() => controller.abort());
  await assert.rejects(h.transport.verifyCustomerCode("ticket", "123456", controller.signal),
    { code: "OPERATION_RESULT_UNKNOWN" });
  assert.deepEqual(await h.reload().readCustomerAdmission(new AbortController().signal),
    { enabled: true, session: null });
});

test("Customer marker-deletion post-effect error cannot reject a committed bearer", async () => {
  const h = harness({ stored: null, storageDeletionFails: true, postDeleteMarkerThrows: true });
  const session = await h.transport.verifyCustomerCode("ticket", "123456", new AbortController().signal);
  assert.equal(session.actorId, "actor-new");
  assert.equal(h.current(), next);
  assert.equal(h.pending(), null);
  assert.equal((await h.reload().readCustomerAdmission(new AbortController().signal)).session.role, "customer");
  assert.deepEqual(h.revoked, [], "committed bearer cannot be treated as an undelivered failure");
});

test("Customer marker deletion pre-effect failure leaves cold start quarantined", async () => {
  const h = harness({ stored: null, storageDeletionFails: true });
  const session = await h.transport.verifyCustomerCode("ticket", "123456", new AbortController().signal);
  assert.equal(session.role, "customer");
  assert.ok(h.pending());
  assert.deepEqual(await h.reload().readCustomerAdmission(new AbortController().signal),
    { enabled: true, session: null });
});

test("late successful owner read cannot revive an actor after the local Customer bearer changed", async () => {
  const h = harness();
  let didStart;
  const started = new Promise(resolve => { didStart = resolve; });
  let finish;
  const delayed = new Promise(resolve => { finish = resolve; });
  h.setRead(async () => {
    didStart();
    await delayed;
    return customer(original);
  });
  const pending = h.transport.readCustomerAdmission(new AbortController().signal);
  await started;
  h.setCurrent(next);
  finish();
  assert.deepEqual(await pending, { enabled: true, session: null },
    "a response authorized for the previous bearer cannot render as the new actor");
  assert.equal(h.current(), next, "an old read must not remove the replacement bearer");
});

test("native Customer logout quarantines the bearer on Identity outage until owner revocation can be reconciled", async () => {
  const h = harness();
  h.setRead(async () => { throw new IdentityError(503, "OWNER_UNAVAILABLE"); });
  await assert.rejects(h.transport.signOutCustomer(new AbortController().signal),
    { status: 503, code: "OWNER_UNAVAILABLE" });
  assert.equal(h.current(), original, "the bearer stays available for safe owner revocation retry");
  assert.equal(h.pending(), "sign-out", "durable quarantine must precede an uncertain owner response");
  assert.deepEqual(await h.reload().readCustomerAdmission(new AbortController().signal),
    { enabled: true, session: null }, "restart cannot authorize a quarantined bearer");
  assert.equal(h.current(), null, "cleanup may delete the bearer only after the test owner recovers");
  assert.equal(h.pending(), null);
});

test("uncertain Customer owner revocation with failed device deletion stays quarantined after restart", async () => {
  const h = harness({ storageDeletionFails: true });
  h.setRevoke(async () => {
    throw new IdentityError(0, "OPERATION_RESULT_UNKNOWN");
  });
  await assert.rejects(h.transport.signOutCustomer(new AbortController().signal),
    error => error.code === "OPERATION_RESULT_UNKNOWN" || /device storage deletion/.test(String(error)));
  assert.equal(h.current(), original, "mock storage still retains the physical bearer");
  assert.equal(h.pending(), "sign-out", "a durable logout marker must block recovery");
  assert.deepEqual(await h.reload().readCustomerAdmission(new AbortController().signal),
    { enabled: true, session: null }, "a crash must not resurrect a bearer retained by device failure");
});

test("native financial reader uses one verified bearer and enforces the same actor after WLT readback", async () => {
  const h = harness();
  let sends = 0;
  const result = await h.transport.withVerifiedNativeCustomerRead(new AbortController().signal,
    async bearer => {
      sends++;
      assert.equal(bearer, original);
      return { actorId: "actor-old", balanceYer: "2400" };
    });
  assert.equal(sends, 1);
  assert.equal(result.kind, "ready");
  assert.equal(result.value.balanceYer, "2400");
  assert.ok(result.expiresAt > Date.now());
});

test("native financial reader cannot send an unverified token changed between admission and transport", async () => {
  const h = harness();
  let reads = 0;
  h.setRead(async bearer => {
    reads++;
    if (reads === 2) h.setCurrent(next);
    return customer(bearer);
  });
  let sends = 0;
  const result = await h.transport.withVerifiedNativeCustomerRead(new AbortController().signal,
    async () => { sends++; return { actorId: "actor-old" }; });
  assert.equal(sends, 0);
  assert.equal(result.kind, "signed-out");
});

test("native financial reader refuses a different current Customer before sending a history request", async () => {
  const h = harness();
  let sends = 0;
  const result = await h.transport.withVerifiedNativeCustomerRead(new AbortController().signal,
    async () => { sends++; return { actorId: "actor-old" }; }, "actor-new");
  assert.deepEqual(result, { kind: "signed-out" });
  assert.equal(sends, 0);
});

test("native financial reader rejects a token rotated during an owner read, even to the same actor", async () => {
  const h = harness();
  let calls = 0;
  const result = await h.transport.withVerifiedNativeCustomerRead(new AbortController().signal,
    async bearer => {
      calls++;
      assert.equal(bearer, original);
      h.setCurrent(next);
      h.setRead(async () => ({ ...customer(original), actorId: "actor-old" }));
      return { actorId: "actor-old", balanceYer: "2500" };
    });
  assert.equal(calls, 1);
  assert.equal(result.kind, "signed-out");
});

test("native financial reader suppresses a revoked or expired Customer without calling WLT", async () => {
  for (const revoked of [true, false]) {
    const h = harness();
    h.setRead(async bearer => revoked
      ? Promise.reject(new IdentityError(401))
      : { ...customer(bearer), sessionExpiresAt: new Date(Date.now() - 1000).toISOString() });
    let calls = 0;
    const result = await h.transport.withVerifiedNativeCustomerRead(
      new AbortController().signal, async () => { calls++; return { actorId: "actor-old" }; });
    assert.equal(result.kind, "signed-out");
    assert.equal(calls, 0);
  }
});

test("native Customer enrollment failure cannot report successful short-lived login", async () => {
  const h = harness({ stored: null });
  h.setEnrollment(async () => { throw new IdentityError(503, "OWNER_UNAVAILABLE"); });
  await assert.rejects(h.transport.verifyCustomerCode("ticket", "123456", new AbortController().signal),
    { status: 503 });
  assert.equal(h.current(), null);
  assert.equal(h.currentRefresh(), null);
  assert.deepEqual(h.revoked, [next]);
});

test("Customer refresh write uncertainty cannot expose an incomplete durable login after restart", async () => {
  const h = harness({ stored: null });
  h.setRefreshWrite(() => { throw new Error("refresh write acknowledgment lost"); });
  const signal = new AbortController().signal;
  await assert.rejects(h.transport.verifyCustomerCode("ticket", "123456", signal), /refresh write acknowledgment lost/);
  assert.equal(h.current(), null);
  assert.equal(h.currentRefresh(), refreshGrant);
  assert.ok(h.pending());
  assert.deepEqual(await h.reload().readCustomerAdmission(signal), { enabled: true, session: null });
  assert.equal(h.currentRefresh(), null);
  assert.equal(h.pending(), null);
});

test("retired Surface flag cannot select another native Customer storage namespace", async () => {
  const signal = new AbortController().signal;
  for (const lenovoPreview of [undefined, "1"]) {
    const nativeOrigin = lenovoPreview ? "http://127.0.0.1:3201" : "http://127.0.0.1:33221";
    const h = harness({ legacySetting: "1", lenovoPreview, nativeOrigin });
    assert.deepEqual(await h.transport.readCustomerAdmission(signal), { enabled: true, session: customer(original) });
    const key = lenovoPreview ? "bthwani.customer.synthetic-identity.lenovo-android.v1" : "bthwani.customer.synthetic-identity.v1";
    assert.ok(h.storageReads.length > 0);
    assert.ok(h.storageReads.every(name => [key, key + ".refresh.v1", key + ".pending.v1"].includes(name)));
  }
});
