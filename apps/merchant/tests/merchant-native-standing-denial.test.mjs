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

function nativeHarness({ storageDeletionFails = false } = {}) {
  let stored = oldBearer;
  let onStorageWrite = null;
  let ownerRead = async () => { throw new OwnerError(401); };
  let ownerRevoke = async () => {};
  let identityRead = async bearer => ({ actorId: bearer === oldBearer ? "old-actor" : "new-actor",
    role: "merchant", sessionExpiresAt: new Date(Date.now() + 60000).toISOString() });
  const secureStore = {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: "device-only",
    async getItemAsync() { return stored; },
    async setItemAsync(_key, value) { stored = value; onStorageWrite?.(); },
    async deleteItemAsync() { if (storageDeletionFails) throw new Error("device storage temporarily unavailable"); stored = null; },
  };
  const dependencies = {
    "@bthwani/identity": {
      IdentityClientError: OwnerError,
      async readVerifiedIdentitySession(_origin, bearer) { return identityRead(bearer); },
      async revokeVerifiedIdentitySession(_origin, bearer) { return ownerRevoke(bearer); },
      async issueCustomerPhoneChallenge() { return "ticket"; },
    },
    "expo-secure-store": secureStore,
    "react-native": { Platform: { OS: "android" } },
    "./admission": {
      async verifyMerchantAdmission() {
        return { bearer: newBearer, session: { actorId: "new-actor", role: "merchant" } };
      },
      async revokeUndeliveredAdmissionSession() {},
    },
    "./dsh-standing": {
      MerchantStandingError: OwnerError,
      readMerchantDSHStanding(_origin, bearer, signal) { return ownerRead(bearer, signal); },
      standingFrom(value) { return value; },
    },
  };
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
  return {
    transport: module.exports,
    setOwnerRead(fn) { ownerRead = fn; },
    setIdentityRead(fn) { identityRead = fn; },
    setOwnerRevoke(fn) { ownerRevoke = fn; },
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

test("cancelled native SecureStore write never restores a Merchant credential",async()=>{
  const h=nativeHarness();
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
