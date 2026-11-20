import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";

const source = readFileSync(new URL("../src/features/access/admission-transport.ts", import.meta.url), "utf8");
const compiled = stripTypeScriptTypes(source, { mode: "transform" })
  .replace(/import\s+\{([^}]*)\}\s+from\s+["']([^"']+)["'];/gs,
    (_match, names, moduleName) => `const {${names}} = require("${moduleName}");`)
  .replace(/import\s+\*\s+as\s+(\w+)\s+from\s+["']([^"']+)["'];/g,
    (_match, name, moduleName) => `const ${name} = require("${moduleName}");`)
  .replace(/export async function (\w+)\(/g, "async function $1(") +
  "\nmodule.exports = {readAdmission, readMerchantStanding, submitAdmissionCode, signOutOfAdmission};";
const oldBearer = Buffer.alloc(32, 7).toString("base64url");
const newBearer = Buffer.alloc(32, 8).toString("base64url");

class OwnerError extends Error {
  constructor(status, code = "STORE_ACCESS_DENIED") {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function nativeHarness({ storageDeletionFails = false, postDeleteMarkerThrows = false, initialBearer = oldBearer } = {}) {
  let stored = initialBearer;
  let pendingMarker = null;
  let onStorageWrite = null;
  let ownerRead = async () => { throw new OwnerError(401); };
  let ownerRevoke = async () => {};
  let admissionCalls = 0;
  const cleanupRevocations = [];
  let merchantAdmission = async () => ({ bearer: newBearer, session: { actorId: "new-actor", role: "merchant" } });
  let identityRead = async bearer => ({ actorId: bearer === oldBearer ? "old-actor" : "new-actor",
    role: "merchant", sessionExpiresAt: new Date(Date.now() + 60000).toISOString() });
  const secureStore = {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: "device-only",
    async getItemAsync(key) {
      return key.endsWith(".pending.v1") ? pendingMarker : stored;
    },
    async setItemAsync(key, value) {
      if (key.endsWith(".pending.v1")) { pendingMarker = value; return; }
      stored = value;
      onStorageWrite?.();
    },
    async deleteItemAsync(key) {
      if (key.endsWith(".pending.v1") && postDeleteMarkerThrows) {
        pendingMarker = null;
        throw new Error("pending marker deletion acknowledgement failed");
      }
      if (storageDeletionFails) throw new Error("device storage temporarily unavailable");
      if (key.endsWith(".pending.v1")) pendingMarker = null;
      else stored = null;
    },
  };
  const dependencies = {
    "@bthwani/dsh": { DshPublicError: OwnerError },
    "@bthwani/identity": {
      IdentityClientError: OwnerError,
      async readVerifiedIdentitySession(_origin, bearer) { return identityRead(bearer); },
      async revokeVerifiedIdentitySession(_origin, bearer) { return ownerRevoke(bearer); },
      async issueCustomerPhoneChallenge() { return "ticket"; },
    },
    "expo-secure-store": secureStore,
    "react-native": { Platform: { OS: "android" } },
    "./admission": {
      async verifyMerchantAdmission() { admissionCalls++; return merchantAdmission(); },
      async revokeUndeliveredAdmissionSession(_origin, bearer) { cleanupRevocations.push(bearer); },
    },
    "./dsh-standing": {
      MerchantStandingError: OwnerError,
      readMerchantDSHStanding(_origin, bearer, signal) { return ownerRead(bearer, signal); },
      standingFrom(value) { return value; },
    },
  };
  const mount = () => {
    const module = { exports: {} };
    new Function("require", "module", "exports", "process", compiled)(
      key => {
        assert.ok(Object.hasOwn(dependencies, key), `unexpected module ${key}`);
        return dependencies[key];
      },
      module, module.exports, { env: {
        EXPO_PUBLIC_MERCHANT_SYNTHETIC_IDENTITY_ORIGIN: "http://127.0.0.1:33221",
        EXPO_PUBLIC_MERCHANT_SYNTHETIC_DSH_ORIGIN: "http://127.0.0.1:33222",
      } },
    );
    return module.exports;
  };
  return {
    transport: mount(),
    reload: mount,
    pending: () => pendingMarker,
    setOwnerRead(fn) { ownerRead = fn; },
    setIdentityRead(fn) { identityRead = fn; },
    setOwnerRevoke(fn) { ownerRevoke = fn; },
    setAdmission(fn) { merchantAdmission = fn; },
    admissionCalls() { return admissionCalls; },
    cleanupRevocations,
    onStorageWrite(fn) { onStorageWrite = fn; },
    current() { return stored; },
  };
}

for (const status of [401, 403]) {
  test(`native DSH ${status} denial removes only the denied bearer before re-entry`, async () => {
    const h = nativeHarness();
    h.setOwnerRead(async () => { throw new OwnerError(status); });
    const signal = new AbortController().signal;
    await assert.rejects(h.transport.readMerchantStanding(signal), { status });
    assert.equal(h.current(), null);
    assert.deepEqual(await h.transport.readAdmission(signal), { enabled: true, session: null });
  });
}

for (const storageDeletionFails of [false, true]) {
  test(`native Identity 403 revocation fails closed (storage deletion fails=${storageDeletionFails})`, async () => {
    const h = nativeHarness({ storageDeletionFails });
    h.setIdentityRead(async () => { throw new OwnerError(403, "FORBIDDEN"); });
    const signal = new AbortController().signal;
    assert.deepEqual(await h.transport.readAdmission(signal), { enabled: true, session: null });
    assert.equal(h.current(), storageDeletionFails ? oldBearer : null);
    assert.deepEqual(await h.transport.readAdmission(signal), { enabled: true, session: null });
  });
}

test("native Identity 503 outage keeps bearer for recoverable retry", async () => {
  const h = nativeHarness();
  h.setIdentityRead(async () => { throw new OwnerError(503, "OWNER_UNAVAILABLE"); });
  await assert.rejects(h.transport.readAdmission(new AbortController().signal), { status: 503 });
  assert.equal(h.current(), oldBearer);
});

test("native Merchant sign-out clears a suspended role despite Identity 403", async () => {
  const h = nativeHarness();
  h.setOwnerRevoke(async () => { throw new OwnerError(403, "FORBIDDEN"); });
  await h.transport.signOutOfAdmission(new AbortController().signal);
  assert.equal(h.current(), null);
  assert.deepEqual(await h.transport.readAdmission(new AbortController().signal),
    { enabled: true, session: null });
});

test("native Merchant sign-out preserves bearer on owner outage for safe retry", async () => {
  const h = nativeHarness();
  h.setOwnerRevoke(async () => { throw new OwnerError(503, "OWNER_UNAVAILABLE"); });
  await assert.rejects(h.transport.signOutOfAdmission(new AbortController().signal),
    { status: 503 });
  assert.equal(h.current(), oldBearer);
});

test("native Merchant re-entry requires logout from an active verified role", async () => {
  const h = nativeHarness();
  await assert.rejects(h.transport.submitAdmissionCode("ticket", "123456", new AbortController().signal),
    { status: 409, code: "SIGN_OUT_REQUIRED" });
  assert.equal(h.current(), oldBearer);
  assert.equal(h.admissionCalls(), 0, "must not consume a new phone proof for another actor");
});

test("native Merchant must not issue a new credential when existing owner is unavailable", async () => {
  const h = nativeHarness();
  h.setIdentityRead(async () => { throw new OwnerError(503, "OWNER_UNAVAILABLE"); });
  await assert.rejects(h.transport.submitAdmissionCode("ticket", "123456", new AbortController().signal),
    { status: 503 });
  assert.equal(h.current(), oldBearer);
  assert.equal(h.admissionCalls(), 0);
});

for (const status of [401, 403]) {
  test(`native Merchant recovers from a terminated existing bearer (Identity ${status})`, async () => {
    const h = nativeHarness();
    h.setIdentityRead(async () => { throw new OwnerError(status, "UNAUTHORIZED"); });
    const session = await h.transport.submitAdmissionCode("ticket", "123456", new AbortController().signal);
    assert.equal(session.actorId, "new-actor");
    assert.equal(h.current(), newBearer);
    assert.equal(h.admissionCalls(), 1);
  });
}

test("parallel native Merchant proofs never issue two owner sessions", async () => {
  const h = nativeHarness({ initialBearer: null });
  let notifyStarted;
  const started = new Promise(resolve => { notifyStarted = resolve; });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  h.setAdmission(async () => {
    notifyStarted();
    await gate;
    return { bearer: newBearer, session: { actorId: "first-actor", role: "merchant" } };
  });
  const signal = new AbortController().signal;
  const first = h.transport.submitAdmissionCode("ticket-a", "111111", signal);
  await started;
  const second = h.transport.submitAdmissionCode("ticket-b", "222222", signal);
  await Promise.resolve();
  await Promise.resolve();
  release();
  const results = await Promise.allSettled([first, second]);
  assert.equal(h.admissionCalls(), 1, "second proof must not reach Identity while first is pending");
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  const denied = results.filter(result => result.status === "rejected");
  assert.equal(denied.length, 1);
  assert.equal(denied[0].reason.code, "SIGN_OUT_REQUIRED");
  assert.equal(h.current(), newBearer);
  assert.deepEqual(h.cleanupRevocations, []);
});

test("failed native Merchant admission releases concurrency guard for owner recovery", async () => {
  const h = nativeHarness({ initialBearer: null });
  h.setAdmission(async () => { throw new OwnerError(503, "OWNER_UNAVAILABLE"); });
  const signal = new AbortController().signal;
  await assert.rejects(h.transport.submitAdmissionCode("ticket-a", "111111", signal), { status: 503 });
  assert.equal(h.current(), null);
  h.setAdmission(async () => ({ bearer: newBearer, session: { actorId: "new-actor", role: "merchant" } }));
  const session = await h.transport.submitAdmissionCode("ticket-b", "222222", signal);
  assert.equal(session.actorId, "new-actor");
  assert.equal(h.current(), newBearer);
  assert.equal(h.admissionCalls(), 2);
});

test("native DSH outage keeps bearer for legitimate retry", async () => {
  const h = nativeHarness();
  h.setOwnerRead(async () => { throw new OwnerError(503, "OWNER_UNAVAILABLE"); });
  await assert.rejects(h.transport.readMerchantStanding(new AbortController().signal), { status: 503 });
  assert.equal(h.current(), oldBearer);
});

test("aborted denied DSH response does not clear stored bearer", async () => {
  const h = nativeHarness();
  const controller = new AbortController();
  h.setOwnerRead(async () => { controller.abort(); throw new OwnerError(403); });
  await assert.rejects(h.transport.readMerchantStanding(controller.signal), { status: 403 });
  assert.equal(h.current(), oldBearer);
});

test("late denial from old actor preserves a new concurrent native admission", async () => {
  const h = nativeHarness();
  let decline;
  const checked = new Promise((_resolve, reject) => { decline = () => reject(new OwnerError(403)); });
  h.setOwnerRead(() => checked);
  const signal = new AbortController().signal;
  const oldStanding = h.transport.readMerchantStanding(signal);
  await Promise.resolve();
  h.setIdentityRead(async bearer => {
    if (bearer === oldBearer) throw new OwnerError(401, "UNAUTHORIZED");
    return { actorId: "new-actor", role: "merchant", sessionExpiresAt: new Date(Date.now() + 60000).toISOString() };
  });
  await h.transport.submitAdmissionCode("ticket", "123456", signal);
  decline();
  await assert.rejects(oldStanding, { status: 403 });
  assert.equal(h.current(), newBearer);
  const next = await h.transport.readAdmission(signal);
  assert.equal(next.session.actorId, "new-actor");
});

test("native owner denial stays fail-closed when SecureStore deletion fails", async () => {
  const h = nativeHarness({ storageDeletionFails: true });
  h.setOwnerRead(async () => { throw new OwnerError(403); });
  const signal = new AbortController().signal;
  await assert.rejects(h.transport.readMerchantStanding(signal), { status: 403 });
  const entry = await h.transport.readAdmission(signal);
  assert.equal(entry.session, null);
});

for (const storageDeletionFails of [false, true]) {
  test(`Merchant post-write storage error cannot restore undelivered bearer (delete fails=${storageDeletionFails})`, async () => {
    const h = nativeHarness({ initialBearer: null, storageDeletionFails });
    h.onStorageWrite(() => { throw new Error("device write acknowledgement failed"); });
    await assert.rejects(
      h.transport.submitAdmissionCode("ticket", "123456", new AbortController().signal),
      /device write acknowledgement failed/,
    );
    assert.equal(h.current(), storageDeletionFails ? newBearer : null);
    assert.deepEqual(h.cleanupRevocations, [newBearer]);
    assert.deepEqual(await h.transport.readAdmission(new AbortController().signal),
      { enabled: true, session: null },
      "an undelivered Merchant bearer must never authenticate after a storage error");
  });
}

test("cancelled native SecureStore write never restores a Merchant credential",async()=>{
  const h=nativeHarness({ initialBearer: null });
  const controller=new AbortController();
  h.onStorageWrite(()=>controller.abort());
  await assert.rejects(
    h.transport.submitAdmissionCode("ticket","123456",controller.signal),
    {code:"OPERATION_RESULT_UNKNOWN"},
  );
  assert.equal(h.current(),null,"cancelled bearer must be removed from device storage");
  const refresh=await h.transport.readAdmission(new AbortController().signal);
  assert.equal(refresh.session,null);
});

test("Merchant undelivered token remains quarantined across process restart when deletion and revoke fail", async () => {
  const h = nativeHarness({ initialBearer: null, storageDeletionFails: true });
  h.onStorageWrite(() => { throw new Error("device write acknowledgement failed"); });
  await assert.rejects(h.transport.submitAdmissionCode("ticket", "123456", new AbortController().signal),
    /device write acknowledgement failed/);
  assert.equal(h.current(), newBearer);
  assert.ok(h.pending(), "quarantine must be stored durably before bearer write");
  const restarted = h.reload();
  assert.deepEqual(await restarted.readAdmission(new AbortController().signal),
    { enabled: true, session: null }, "reloaded module must never read undelivered bearer");
  await assert.rejects(restarted.readMerchantStanding(new AbortController().signal),
    { status: 401, code: "UNAUTHENTICATED" }, "Store-scoped reads must also reject quarantined bearer");
  assert.equal(h.current(), newBearer);
  assert.ok(h.pending());
  await assert.rejects(restarted.submitAdmissionCode("another-ticket", "111111", new AbortController().signal),
    { status: 409, code: "SIGN_OUT_REQUIRED" },
    "a stuck pending credential must block a second Identity issuance");
  assert.equal(h.admissionCalls(), 1);
  assert.deepEqual(h.cleanupRevocations, [newBearer], "remote revoke was attempted but not confirmed");
});

test("Merchant successful login clears durable pending write marker before returning session", async () => {
  const h = nativeHarness({ initialBearer: null });
  const session = await h.transport.submitAdmissionCode("ticket", "123456", new AbortController().signal);
  assert.equal(session.role, "merchant");
  assert.equal(h.pending(), null);
  const restarted = h.reload();
  assert.equal((await restarted.readAdmission(new AbortController().signal)).session.role, "merchant");
});

test("Merchant aborted incomplete login does not store an accepted bearer after reload", async () => {
  const h = nativeHarness({ initialBearer: null, storageDeletionFails: true });
  const controller = new AbortController();
  h.onStorageWrite(() => controller.abort());
  await assert.rejects(h.transport.submitAdmissionCode("ticket", "123456", controller.signal),
    { code: "OPERATION_RESULT_UNKNOWN" });
  const restarted = h.reload();
  assert.deepEqual(await restarted.readAdmission(new AbortController().signal),
    { enabled: true, session: null });
});

test("Merchant marker-deletion post-effect error cannot reject an already committed bearer", async () => {
  const h = nativeHarness({ initialBearer: null, storageDeletionFails: true, postDeleteMarkerThrows: true });
  const session = await h.transport.submitAdmissionCode("ticket", "123456", new AbortController().signal);
  assert.equal(session.actorId, "new-actor");
  assert.equal(h.current(), newBearer);
  assert.equal(h.pending(), null, "the marker deletion persisted even though acknowledgement failed");
  assert.equal((await h.reload().readAdmission(new AbortController().signal)).session.role, "merchant");
  assert.deepEqual(h.cleanupRevocations, [], "a successful device commit must not revoke active bearer");
});

test("Merchant marker-delete pre-effect failure keeps bearer quarantined on cold start", async () => {
  const h = nativeHarness({ initialBearer: null, storageDeletionFails: true });
  const session = await h.transport.submitAdmissionCode("ticket", "123456", new AbortController().signal);
  assert.equal(session.role, "merchant", "owner-verified bearer write already succeeded");
  assert.ok(h.pending(), "failed marker deletion remains a durable quarantine");
  assert.deepEqual(await h.reload().readAdmission(new AbortController().signal),
    { enabled: true, session: null }, "restarted app cannot promote an uncertain marker");
});
