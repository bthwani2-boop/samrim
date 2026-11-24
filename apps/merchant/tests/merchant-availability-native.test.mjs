import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import * as dshClient from "../../../services/dsh/clients/index.ts";
import * as identityClient from "../../../services/identity/clients/index.ts";

function compileTransport(relativePath, exports) {
  const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
  return stripTypeScriptTypes(source, { mode: "transform" })
  .replace(/import\s+\{([^}]*)\}\s+from\s+["']([^"']+)["'];/gs,
    (_match, names, moduleName) => `const {${names.replace(/\bas\b/g, ":")}} = require("${moduleName}");`)
  .replace(/import\s+\*\s+as\s+(\w+)\s+from\s+["']([^"']+)["'];/g,
    (_match, name, moduleName) => `const ${name} = require("${moduleName}");`)
  .replace(/export async function (\w+)\(/g, "async function $1(") +
  "\nmodule.exports = {" + exports.join(",") + "};";
}
const compiled = compileTransport("../src/features/access/admission-transport.ts", ["readAdmission", "readMerchantStanding", "withNativeMerchantSession"]);
const compiledAvailability = compileTransport("../src/features/stores/store-availability-transport.ts", ["readMerchantAvailability", "saveMerchantAvailability"]);
const compiledInventory = compileTransport("../src/features/catalog/catalog-transport.ts", ["readMerchantInventorySummary"]);
const bearer = Buffer.alloc(32, 8).toString("base64url");
const identity = "http://127.0.0.1:13009";
const dsh = "http://127.0.0.1:13010";
const availability = { storeId: "store-a", timezone: "Asia/Aden", weekly: null,
  preparationMinutes: 12, version: 3, actingActorId: "owner-a", reason: "reviewed" };
const inventorySummary = { actorId: "owner-a", storeId: "store-a", totalOffers: 64,
  publishedOffers: 50, availableOffers: 40, unavailableOffers: 10, stockoutOffers: 2 };
const json = (value, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });

function harness(t, { role = "merchant", initialBearer = bearer, marker = null, deletionFails = false,
  identityStatus = 200, dshStatus = 200, platform = "android", change, webReply, webMalformed = false,
  inventory = false, inventoryReply, cacheable = false, onDSH = () => {}, onIdentity = () => {} } = {}) {
  let stored = initialBearer;
  let pending = marker;
  // This suite exercises DSH Store authorization with an already-persisted,
  // still-valid native Identity session. Initial refresh enrollment has separate tests.
  let refreshStored = initialBearer && !marker ? Buffer.alloc(32, 54).toString("base64url") : null;
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url: String(url), options });
    if (platform === "web") {
      assert.equal(url, inventory ? "/api/admission?inventory=store-a" : "/api/admission?availability=store-a");
      assert.equal(options.credentials, "same-origin");
      onDSH();
      if (inventory) {
        assert.equal(options.headers["X-Merchant-Context"], "owner-a");
        return Response.json(webReply ?? { inventory: inventorySummary }, {
          status: dshStatus, headers: { "Cache-Control": cacheable ? "public" : "no-store" },
        });
      }
      if (webMalformed) return new Response("{", { status: 200, headers: { "Cache-Control": "no-store" } });
      return json(webReply ?? (change
        ? { availability: { ...availability, version: change.expectedVersion + 1 }, replay: false }
        : { availability }), dshStatus);
    }
    assert.equal(options.headers.Authorization, `Bearer ${bearer}`);
    const target = new URL(url);
    if (target.origin === identity) {
      assert.equal(options.method, "GET");
      onIdentity();
      return identityStatus === 200 ? json({ actorId: "owner-a", role,
        sessionExpiresAt: new Date(Date.now() + 15 * 60000).toISOString() }) : json({ error: "FORBIDDEN" }, identityStatus);
    }
    if (target.pathname === "/v1/stores/mine") {
      assert.equal(options.method, "GET");
      onDSH();
      return dshStatus === 200 ? json({ actorId: "owner-a", stores: [] }) :
        json({ code: "STORE_ACCESS_DENIED" }, dshStatus);
    }
    if (inventory) {
      assert.equal(target.href, `${dsh}/v1/stores/store-a/inventory-summary`);
      assert.equal(options.method, "GET");
      onDSH();
      return Response.json(dshStatus === 200 ? inventoryReply ?? inventorySummary : { code: "STORE_OPERATION_FORBIDDEN" }, {
        status: dshStatus, headers: { "Cache-Control": cacheable ? "public" : "no-store" },
      });
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
      async getItemAsync(key) {
        return key.endsWith(".pending.v1") ? pending :
          key.endsWith(".refresh.v1") ? refreshStored : stored;
      },
      async setItemAsync(key, value) {
        if (key.endsWith(".pending.v1")) pending = value;
        else if (key.endsWith(".refresh.v1")) refreshStored = value;
        else stored = value;
      },
      async deleteItemAsync(key) {
        if (deletionFails) throw new Error("storage unavailable");
        if (key.endsWith(".pending.v1")) pending = null;
        else if (key.endsWith(".refresh.v1")) refreshStored = null;
        else stored = null;
      },
    },
    "react-native": { Platform: { OS: platform } },
    "./admission": {}, "./dsh-standing": dshClient,
  };
  const module = { exports: {} };
  new Function("require", "module", "exports", "process", compiled)(
    name => { assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name]; }, module, module.exports,
    { env: { EXPO_PUBLIC_MERCHANT_SYNTHETIC_IDENTITY_ORIGIN: identity, EXPO_PUBLIC_MERCHANT_SYNTHETIC_DSH_ORIGIN: dsh } },
  );
  const availabilityModule = { exports: {} };
  new Function("require", "module", "exports", compiledAvailability)(
    name => {
      if (name === "../access/admission-transport") return module.exports;
      assert.ok(Object.hasOwn(dependencies, name), name);
      return dependencies[name];
    }, availabilityModule, availabilityModule.exports,
  );
  const inventoryModule = { exports: {} };
  new Function("require", "module", "exports", compiledInventory)(
    name => {
      if (name === "../access/admission-transport") return module.exports;
      assert.ok(Object.hasOwn(dependencies, name), name);
      return dependencies[name];
    }, inventoryModule, inventoryModule.exports,
  );
  return { transport: { ...module.exports, ...availabilityModule.exports, ...inventoryModule.exports }, calls, current: () => stored, switchBearer: () => { stored = Buffer.alloc(32, 9).toString("base64url"); } };
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

test("Native Merchant standing validates the live Identity session before returning DSH stores", async t => {
  const h = harness(t);
  assert.deepEqual(await h.transport.readMerchantStanding(signal()), { actorId: "owner-a", stores: [] });
  assert.deepEqual(h.calls.map(call => new URL(call.url).pathname),
    ["/v1/sessions/current", "/v1/stores/mine"]);
});

test("Native Merchant standing rejects a Customer identity before contacting DSH", async t => {
  const h = harness(t, { role: "customer" });
  await assert.rejects(h.transport.readMerchantStanding(signal()), { status: 403 });
  assert.equal(h.calls.length, 1);
});

for (const stage of ["identity", "dsh"]) {
  test(`Native Merchant standing never exposes previous account after ${stage} switch`, async t => {
    let h;
    h = harness(t, { [stage === "identity" ? "onIdentity" : "onDSH"]: () => h.switchBearer() });
    await assert.rejects(h.transport.readMerchantStanding(signal()), { code: "OWNER_RESPONSE_STALE" });
    assert.notEqual(h.current(), bearer);
    assert.equal(h.calls.length, stage === "identity" ? 1 : 2);
  });
}

test("Native Merchant standing revokes the denied current bearer without invalidating a newer account", async t => {
  const same = harness(t, { dshStatus: 403 });
  await assert.rejects(same.transport.readMerchantStanding(signal()), { code: "STORE_ACCESS_DENIED" });
  assert.equal(same.current(), null, "current denied credential must be removed");

  let switched;
  switched = harness(t, { dshStatus: 403, onDSH: () => switched.switchBearer() });
  await assert.rejects(switched.transport.readMerchantStanding(signal()), { code: "STORE_ACCESS_DENIED" });
  assert.notEqual(switched.current(), bearer, "late rejection may not delete replacement credential");
});

test("Web Merchant PATCH must not confirm a stale or implausible DSH version", async t => {
  for (const version of [change.expectedVersion, change.expectedVersion + 2]) {
    const h = harness(t, { platform: "web", change,
      webReply: { availability: { ...availability, version }, replay: true } });
    await assert.rejects(
      h.transport.saveMerchantAvailability("store-a", "owner-a", change, signal()),
      { code: "OPERATION_RESULT_UNKNOWN", status: 502 },
    );
    assert.equal(h.calls.length, 1, "uncertain write must not be retried automatically");
  }
});

test("Web Merchant PATCH accepts only the next owner version for its original operation", async t => {
  const h = harness(t, { platform: "web", change });
  await h.transport.saveMerchantAvailability("store-a", "owner-a", change, signal());
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].options.method, "PATCH");
  assert.deepEqual(JSON.parse(h.calls[0].options.body), change);
});

test("Web Merchant PATCH network ambiguity remains unknown rather than a transport exception", async t => {
  const h = harness(t, { platform: "web", change, onDSH: () => {
    throw new TypeError("network disconnected after dispatch");
  } });
  await assert.rejects(
    h.transport.saveMerchantAvailability("store-a", "owner-a", change, signal()),
    { code: "OPERATION_RESULT_UNKNOWN", status: 0 },
  );
  assert.equal(h.calls.length, 1);
});

test("Web Merchant PATCH aborted after dispatch cannot confirm a possibly committed write", async t => {
  const controller = new AbortController();
  const h = harness(t, { platform: "web", change, onDSH: () => controller.abort() });
  await assert.rejects(
    h.transport.saveMerchantAvailability("store-a", "owner-a", change, controller.signal),
    { code: "OPERATION_RESULT_UNKNOWN", status: 0 },
  );
  assert.equal(h.calls.length, 1);
});

test("Web Merchant PATCH malformed acknowledged body remains an unknown write", async t => {
  const h = harness(t, { platform: "web", change, webMalformed: true });
  await assert.rejects(
    h.transport.saveMerchantAvailability("store-a", "owner-a", change, signal()),
    { code: "OPERATION_RESULT_UNKNOWN", status: 502 },
  );
  assert.equal(h.calls.length, 1);
});

test("Web Merchant PATCH owner 5xx preserves the original operation as uncertain", async t => {
  const h = harness(t, { platform: "web", change, dshStatus: 503, webReply: { code: "OWNER_UNAVAILABLE" } });
  await assert.rejects(
    h.transport.saveMerchantAvailability("store-a", "owner-a", change, signal()),
    { code: "OPERATION_RESULT_UNKNOWN", status: 503 },
  );
  assert.equal(h.calls.length, 1);
});

test("Native Merchant PATCH after an account switch keeps the committed result uncertain", async t => {
  let h;
  h = harness(t, { change, onDSH: () => h.switchBearer() });
  await assert.rejects(
    h.transport.saveMerchantAvailability("store-a", "owner-a", change, signal()),
    { code: "OPERATION_RESULT_UNKNOWN", status: 0 },
  );
  assert.notEqual(h.current(), bearer, "a previous operation must not erase the replacement account");
  assert.deepEqual(h.calls.map(call => call.options.method), ["GET", "PATCH"]);
});


test("Native inventory reads the complete owner summary using a verified Merchant session", async t => {
  const h = harness(t, { inventory: true });
  assert.deepEqual(await h.transport.readMerchantInventorySummary("store-a", "owner-a", signal()), inventorySummary);
  assert.deepEqual(h.calls.map(call => new URL(call.url).pathname),
    ["/v1/sessions/current", "/v1/stores/store-a/inventory-summary"]);
  assert.equal(h.current(), bearer);
});

test("Native inventory denies a previous actor before contacting DSH", async t => {
  const h = harness(t, { inventory: true });
  await assert.rejects(h.transport.readMerchantInventorySummary("store-a", "old-owner", signal()),
    { code: "MERCHANT_CONTEXT_CHANGED" });
  assert.equal(h.calls.length, 1);
  assert.equal(h.current(), bearer);
});

test("Native inventory rejects another role or revoked Identity before the owner read", async t => {
  for (const options of [{ role: "customer" }, { identityStatus: 403 }]) {
    const h = harness(t, { inventory: true, ...options });
    await assert.rejects(h.transport.readMerchantInventorySummary("store-a", "owner-a", signal()), { status: 403 });
    assert.equal(h.calls.length, 1);
  }
});

test("Native inventory preserves a valid session on foreign Store denial", async t => {
  const h = harness(t, { inventory: true, dshStatus: 403 });
  await assert.rejects(h.transport.readMerchantInventorySummary("store-a", "owner-a", signal()), { status: 403 });
  assert.equal(h.current(), bearer);
});

test("Native inventory discards an in-flight response after account replacement", async t => {
  let h;
  h = harness(t, { inventory: true, onDSH: () => h.switchBearer() });
  await assert.rejects(h.transport.readMerchantInventorySummary("store-a", "owner-a", signal()),
    { code: "OWNER_RESPONSE_STALE" });
  assert.notEqual(h.current(), bearer);
});

test("Web inventory uses same-origin context and rejects a foreign Store, unsafe cache or late abort", async t => {
  const valid = harness(t, { inventory: true, platform: "web" });
  assert.deepEqual(await valid.transport.readMerchantInventorySummary("store-a", "owner-a", signal()), inventorySummary);
  assert.equal(valid.calls.length, 1);
  for (const options of [
    { webReply: { inventory: { ...inventorySummary, storeId: "store-b" } } },
    { cacheable: true },
  ]) {
    const h = harness(t, { inventory: true, platform: "web", ...options });
    await assert.rejects(h.transport.readMerchantInventorySummary("store-a", "owner-a", signal()), { code: "OWNER_RESPONSE_INVALID" });
  }
  const controller = new AbortController();
  const aborted = harness(t, { inventory: true, platform: "web", onDSH: () => controller.abort() });
  await assert.rejects(aborted.transport.readMerchantInventorySummary("store-a", "owner-a", controller.signal),
    { code: "OWNER_RESPONSE_STALE" });
});
