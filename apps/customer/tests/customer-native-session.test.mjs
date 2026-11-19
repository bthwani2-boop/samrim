import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";

const source = readFileSync(new URL("../src/features/access/customer-session-transport.ts", import.meta.url), "utf8");
const compiled = stripTypeScriptTypes(source, { mode: "transform" })
  .replace(/import\s+\{([^}]*)\}\s+from\s+["']([^"']+)["'];/gs,
    (_match, names, moduleName) => `const {${names}} = require("${moduleName}");`)
  .replace(/import\s+\*\s+as\s+(\w+)\s+from\s+["']([^"']+)["'];/g,
    (_match, name, moduleName) => `const ${name} = require("${moduleName}");`)
  .replace(/export async function (\w+)\(/g, "async function $1(") +
  "\nmodule.exports = {readCustomerAdmission, requestCustomerCode, verifyCustomerCode, signOutCustomer};";

const original = Buffer.alloc(32, 1).toString("base64url");
const next = Buffer.alloc(32, 2).toString("base64url");
const expiry = new Date(Date.now() + 240000).toISOString();
class IdentityError extends Error {
  constructor(status, code = "UNAUTHORIZED") {
    super(code);
    this.status = status;
    this.code = code;
  }
}
const customer = bearer => ({ actorId: bearer === original ? "actor-old" : "actor-new",
  role: "customer", sessionExpiresAt: expiry });

function harness({ stored = original, nativeOrigin = "http://127.0.0.1:33221", ownerRole = "customer" } = {}) {
  let bearer = stored;
  let read = async value => ({ ...customer(value), role: ownerRole });
  let codeVerification = async () => ({ accessToken: next, sessionExpiresAt: expiry });
  let revoke = async value => { revoked.push(value); };
  let onStorageWrite = () => {};
  const revoked = [];
  const secure = {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: "this-device",
    async getItemAsync() { return bearer; },
    async setItemAsync(_key, value) { bearer = value; onStorageWrite(); },
    async deleteItemAsync() { bearer = null; },
  };
  const fake = {
    "@bthwani/identity": {
      IdentityClientError: IdentityError,
      issueCustomerPhoneChallenge: async () => "ticket",
      readVerifiedIdentitySession: (_origin, value, signal) => read(value, signal),
      revokeVerifiedIdentitySession: (_origin, value, signal) => revoke(value, signal),
      verifyCustomerPhoneChallenge: (_origin, ticket, code, signal) => codeVerification(ticket, code, signal),
    },
    "expo-secure-store": secure,
    "react-native": { Platform: { OS: "android" } },
  };
  const module = { exports: {} };
  new Function("require", "module", "exports", "process", compiled)(
    key => { assert.ok(Object.hasOwn(fake, key)); return fake[key]; },
    module, module.exports, { env: { EXPO_PUBLIC_CUSTOMER_SYNTHETIC_IDENTITY_ORIGIN: nativeOrigin } },
  );
  return {
    transport: module.exports, revoked,
    current: () => bearer,
    setCurrent(value) { bearer = value; },
    setRead(fn) { read = fn; },
    setVerification(fn) { codeVerification = fn; },
    setRevoke(fn) { revoke = fn; },
    setOnStorageWrite(fn) { onStorageWrite = fn; },
  };
}

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

test("native verified phone proof stores only Customer bearer after owner read", async () => {
  const h = harness({ stored: null });
  const entry = await h.transport.verifyCustomerCode("ticket", "123456", new AbortController().signal);
  assert.deepEqual(entry, customer(next));
  assert.equal(h.current(), next);
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
  h.setVerification(() => new Promise(resolve => { complete = resolve; }));
  const pending = h.transport.verifyCustomerCode("ticket", "123456", new AbortController().signal);
  await Promise.resolve();
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
