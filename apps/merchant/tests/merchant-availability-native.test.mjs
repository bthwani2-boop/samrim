import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import * as dshClient from "../../../services/dsh/clients/index.ts";
import * as identityClient from "../../../services/identity/clients/index.ts";

const source = readFileSync(new URL("../src/features/access/admission-transport.ts", import.meta.url), "utf8");
const compiled = stripTypeScriptTypes(source, { mode: "transform" })
  .replace(/import\s+\{([^}]*)\}\s+from\s+["']([^"']+)["'];/gs,
    (_match, names, moduleName) => `const {${names}} = require("${moduleName}");`)
  .replace(/import\s+\*\s+as\s+(\w+)\s+from\s+["']([^"']+)["'];/g,
    (_match, name, moduleName) => `const ${name} = require("${moduleName}");`)
  .replace(/export async function (\w+)\(/g, "async function $1(") +
  "\nmodule.exports = {readAdmission, readMerchantAvailability, saveMerchantAvailability};";
const bearer = Buffer.alloc(32, 8).toString("base64url");
const identity = "http://127.0.0.1:13009";
const dsh = "http://127.0.0.1:13010";
const availability = { storeId: "store-a", timezone: "Asia/Aden", weekly: null,
  preparationMinutes: 12, version: 3, actingActorId: "owner-a", reason: "reviewed" };
const json = (value, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });

function harness(t, { role = "merchant", initialBearer = bearer, marker = null, deletionFails = false,
  identityStatus = 200, dshStatus = 200, platform = "android", change,
  onDSH = () => {}, onIdentity = () => {} } = {}) {
  let stored = initialBearer;
  let pending = marker;
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url: String(url), options });
    if (platform === "web") {
      assert.equal(url, "/api/admission?availability=store-a");
      assert.equal(options.credentials, "same-origin");
      onDSH();
      return json({ availability });
    }
    assert.equal(options.headers.Authorization, `Bearer ${bearer}`);
    const target = new URL(url);
    if (target.origin === identity) {
      assert.equal(options.method, "GET");
      onIdentity();
      return identityStatus === 200 ? json({ actorId: "owner-a", role,
        sessionExpiresAt: new Date(Date.now() + 120000).toISOString() }) : json({ error: "FORBIDDEN" }, identityStatus);
    }
    assert.equal(target.href, `${dsh}/v1/stores/store-a/availability`);
    assert.equal(options.method, change ? "PATCH" : "GET");
    if (change) assert.deepEqual(JSON.parse(options.body), change);
    onDSH();
    const result = change ? { availability: { ...availability, weekly: [], version: 4 }, replay: false } : availability;
    return dshStatus === 200 ? json(result) : json({ code: "STORE_OPERATION_FORBIDDEN" }, dshStatus);
  });
  const dependencies = {
    "@bthwani/dsh": dshClient,
    "@bthwani/identity": identityClient,
    "expo-secure-store": {
      WHEN_UNLOCKED_THIS_DEVICE_ONLY: "device-only",
      async getItemAsync(key) { return key.endsWith(".pending.v1") ? pending : stored; },
      async deleteItemAsync(key) {
        if (deletionFails) throw new Error("storage unavailable");
        if (key.endsWith(".pending.v1")) pending = null;
        else stored = null;
      },
    },
    "react-native": { Platform: { OS: platform } },
    "./admission": {}, "./dsh-standing": {},
  };
  const module = { exports: {} };
  new Function("require", "module", "exports", "process", compiled)(
    name => { assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name]; }, module, module.exports,
    { env: { EXPO_PUBLIC_MERCHANT_SYNTHETIC_IDENTITY_ORIGIN: identity, EXPO_PUBLIC_MERCHANT_SYNTHETIC_DSH_ORIGIN: dsh } },
  );
  return { transport: module.exports, calls, current: () => stored, switchBearer: () => { stored = Buffer.alloc(32, 9).toString("base64url"); } };
}
const signal = () => new AbortController().signal;

test("Native Merchant availability uses current private bearer with real owner-client validation", async t => {
  const h = harness(t);
  assert.deepEqual(await h.transport.readMerchantAvailability("store-a", signal()), availability);
  assert.equal(h.calls.length, 2);
  assert.equal(h.current(), bearer);
});

test("Native availability rejects absent credentials and interrupted admission quarantine", async t => {
  for (const options of [{ initialBearer: null }, { marker: "in-flight" }]) {
    const h = harness(t, options);
    await assert.rejects(h.transport.readMerchantAvailability("store-a", signal()), { status: 401 });
    assert.equal(h.calls.length, 0);
  }
});

test("Native availability rejects a denied bearer even when credential deletion failed", async t => {
  const h = harness(t, { identityStatus: 403, deletionFails: true });
  assert.deepEqual(await h.transport.readAdmission(signal()), { enabled: true, session: null });
  const before = h.calls.length;
  await assert.rejects(h.transport.readMerchantAvailability("store-a", signal()), { status: 401 });
  assert.equal(h.calls.length, before);
  assert.equal(h.current(), bearer);
});

test("Native availability rejects non-Merchant identity before reading DSH", async t => {
  const h = harness(t, { role: "customer" });
  await assert.rejects(h.transport.readMerchantAvailability("store-a", signal()), { status: 403 });
  assert.equal(h.calls.length, 1);
  assert.equal(h.current(), null);
});

test("Native scoped Store denial preserves valid identity for another Store", async t => {
  const h = harness(t, { dshStatus: 403 });
  await assert.rejects(h.transport.readMerchantAvailability("store-a", signal()), { status: 403 });
  assert.equal(h.current(), bearer);
  assert.equal((await h.transport.readAdmission(signal())).session.role, "merchant");
});

for (const stage of ["identity", "dsh"]) {
  test(`Native account change during ${stage} read cannot return the previous Store`, async t => {
    let h;
    h = harness(t, { [stage === "identity" ? "onIdentity" : "onDSH"]: () => h.switchBearer() });
    await assert.rejects(h.transport.readMerchantAvailability("store-a", signal()), { code: "OWNER_RESPONSE_STALE" });
    assert.notEqual(h.current(), bearer);
    assert.equal(h.calls.length, stage === "identity" ? 1 : 2);
  });
}

test("Native abort and invalid Store ID cannot contact owners", async t => {
  const h = harness(t);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(h.transport.readMerchantAvailability("store-a", controller.signal), { code: "OWNER_RESPONSE_STALE" });
  await assert.rejects(h.transport.readMerchantAvailability("../store-a", signal()), { code: "STORE_ID_INVALID" });
  assert.equal(h.calls.length, 0);
});

test("Native late DSH result after abort is not displayed as a current read", async t => {
  const controller = new AbortController();
  const h = harness(t, { onDSH: () => controller.abort() });
  await assert.rejects(h.transport.readMerchantAvailability("store-a", controller.signal), { code: "OWNER_RESPONSE_STALE" });
});

test("Native owner outage keeps credentials for retry", async t => {
  const h = harness(t, { dshStatus: 503 });
  await assert.rejects(h.transport.readMerchantAvailability("store-a", signal()), { status: 503 });
  assert.equal(h.current(), bearer);
});

test("Native Identity outage fails before DSH and retains credentials for retry", async t => {
  const h = harness(t, { identityStatus: 503 });
  await assert.rejects(h.transport.readMerchantAvailability("store-a", signal()), { status: 503 });
  assert.equal(h.current(), bearer);
  assert.equal(h.calls.length, 1);
});

test("Web availability transport returns the selected Store through the fixed same-origin BFF", async t => {
  const h = harness(t, { platform: "web" });
  assert.deepEqual(await h.transport.readMerchantAvailability("store-a", signal()), availability);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].options.method, "GET");
  assert.equal(h.calls[0].options.redirect, "error");
});

test("Web availability transport uses only the fixed same-origin BFF and rejects a late abort", async t => {
  const controller = new AbortController();
  const h = harness(t, { platform: "web", onDSH: () => controller.abort() });
  await assert.rejects(h.transport.readMerchantAvailability("store-a", controller.signal), { code: "OWNER_RESPONSE_STALE" });
  assert.equal(h.calls.length, 1);
});

const change = {
  operationId: "native-save-pause", expectedVersion: 3, weekly: [], pausedUntil: null,
  preparationMinutes: 12, reason: "انتهاء الإيقاف",
};
test("Native PATCH verifies the current actor and sends the exact command to DSH", async t => {
  const h = harness(t, { change });
  await h.transport.saveMerchantAvailability("store-a", "owner-a", change, signal());
  assert.deepEqual(h.calls.map(call => call.options.method), ["GET", "PATCH"]);
});

test("Native PATCH for an earlier actor does not contact DSH or discard the newer session", async t => {
  const h = harness(t, { change });
  await assert.rejects(h.transport.saveMerchantAvailability("store-a", "old-owner", change, signal()),
    { code: "MERCHANT_CONTEXT_CHANGED" });
  assert.equal(h.calls.length, 1);
  assert.equal(h.current(), bearer);
});
