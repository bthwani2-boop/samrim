import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript-ast";

const source = readFileSync(resolve(import.meta.dirname, "index.ts"), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function device(platform, overrides = {}) {
  const store = new Map();
  const requests = [];
  const notificationCalls = [];
  const exports = {};
  const notifications = {
    getPermissionsAsync: async () => ({ granted: true }),
    getExpoPushTokenAsync: async () => ({ data: "ExponentPushToken[validTokenForIsolatedTest]" }),
    dismissAllNotificationsAsync: async () => { notificationCalls.push("dismiss"); },
    cancelAllScheduledNotificationsAsync: async () => { notificationCalls.push("cancel"); },
    clearLastNotificationResponseAsync: async () => { notificationCalls.push("clear-response"); },
    ...overrides.notifications,
  };
  const mock = {
    expo: { requireOptionalNativeModule: () => overrides.nativeModule === null ? null : ({}) },
    "expo-constants": { __esModule: true, default: { expoConfig: { extra: { eas: { projectId: "isolated-project" } } } } },
    "expo-crypto": { randomUUID: () => "00000000-0000-4000-8000-000000000001" },
    "expo-secure-store": {
      getItemAsync: async (key) => store.get(key) ?? null,
      setItemAsync: async (key, value) => { store.set(key, value); },
    },
    "expo-notifications": notifications,
    "react-native": { Platform: { OS: platform } },
  };
  const fetch = async (url, options) => {
    requests.push({ url, method: options.method, authorization: options.headers.Authorization });
    if (overrides.fetch) return overrides.fetch(url, options);
    return { ok: true, json: async () => ({ registered: true, pushEnabled: true }) };
  };
  runInNewContext(compiled, {
    exports, require: (name) => {
      if (name === "expo-notifications" && overrides.notificationsImportFails) throw new Error("Native notification module unavailable");
      if (!(name in mock)) throw new Error("Unmocked module: " + name);
      return mock[name];
    },
    fetch, AbortSignal, Date, Promise, setTimeout, clearTimeout, process: { env: {} },
  }, { filename: "shared-push-device.js" });
  return { api: exports, requests, store, notificationCalls };
}

const host = "http://127.0.0.1:18080";
test("iOS registration reuses an actor+tone and logout revokes its installation", async () => {
  const { api, requests, notificationCalls } = device("ios");
  assert.equal(await api.registerOwnPushDevice("token-a", "actor-a", "classic", () => true, host), true);
  assert.equal(await api.registerOwnPushDevice("token-a", "actor-a", "classic", () => true, host), true);
  assert.equal(requests.filter((request) => request.method === "POST").length, 1);
  await api.unregisterOwnPushDevice("token-a", host);
  assert.equal(requests.filter((request) => request.method === "DELETE").length, 1);
  assert.ok(requests.every((request) => request.url.startsWith(host + "/dsh/notifications/devices")));
  assert.ok(requests.every((request) => request.authorization === "Bearer token-a"));
  assert.deepEqual(notificationCalls, ["dismiss", "cancel", "clear-response"]);
});

test("Android rebinds on actor change; web never accesses notification storage", async () => {
  const android = device("android");
  assert.equal(await android.api.registerOwnPushDevice("token-a", "actor-a", "soft", () => true, host), true);
  assert.equal(await android.api.registerOwnPushDevice("token-b", "actor-b", "soft", () => true, host), true);
  assert.deepEqual(android.requests.map((request) => request.authorization), ["Bearer token-a", "Bearer token-b"]);
  const web = device("web");
  assert.equal(await web.api.registerOwnPushDevice("token-a", "actor-a", "classic", () => true, host), false);
  await web.api.unregisterOwnPushDevice("token-a", host);
  assert.equal(web.requests.length, 0);
  assert.equal(web.store.size, 0);
});

test("denied permission and a stale actor cannot post a push token", async () => {
  const denied = device("ios", { notifications: { getPermissionsAsync: async () => ({ granted: false }) } });
  assert.equal(await denied.api.registerOwnPushDevice("token", "actor", "urgent", () => true, host), false);
  assert.equal(denied.requests.length, 0);
  await denied.api.unregisterOwnPushDevice("", undefined);
  assert.deepEqual(denied.notificationCalls, ["dismiss", "cancel", "clear-response"]);
  const stale = device("android");
  assert.equal(await stale.api.registerOwnPushDevice("token", "actor", "urgent", () => false, host), false);
  assert.equal(stale.requests.length, 0);
});

test("logout waits for in-flight registration before deleting its installation", async () => {
  let completePost;
  const network = device("ios", {
    fetch: (url, options) => options.method === "POST"
      ? new Promise((resolve) => { completePost = resolve; })
      : Promise.resolve({ ok: true }),
  });
  const task = network.api.registerOwnPushDevice("actor-token", "actor-a", "classic", () => true, host);
  for (let i = 0; i < 20 && !completePost; i++) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(typeof completePost, "function");
  const logout = network.api.unregisterOwnPushDevice("actor-token", host);
  completePost({ ok: true, json: async () => ({ registered: true, pushEnabled: true }) });
  assert.equal(await task, true);
  await logout;
  assert.deepEqual(network.requests.map((request) => request.method), ["POST", "DELETE"]);
});

test("native logout clears alerts without a token or stored installation id", async () => {
  const native = device("ios");
  await native.api.unregisterOwnPushDevice("", undefined);
  assert.deepEqual(native.notificationCalls, ["dismiss", "cancel", "clear-response"]);
  assert.equal(native.requests.length, 0);
  assert.equal(native.store.size, 0);

  const unsupported = device("android", { nativeModule: null });
  await unsupported.api.unregisterOwnPushDevice("token-a", host);
  assert.deepEqual(unsupported.notificationCalls, []);
  assert.equal(unsupported.requests.length, 0);
});

test("offline deregistration still clears local notifications", async () => {
  const offline = device("android", { fetch: async () => { throw new Error("offline"); } });
  await offline.api.registerOwnPushDevice("token-a", "actor-a", "soft", () => true, host);
  await offline.api.unregisterOwnPushDevice("token-a", host);
  assert.deepEqual(offline.notificationCalls, ["dismiss", "cancel", "clear-response"]);
  assert.equal(offline.requests.at(-1).method, "DELETE");
});

test("late logout completion preserves a newer actor registration", async () => {
  let completeDelete;
  const network = device("ios", {
    fetch: (url, options) => options.method === "DELETE"
      ? new Promise((resolve) => { completeDelete = resolve; })
      : Promise.resolve({ ok: true, json: async () => ({ registered: true, pushEnabled: true }) }),
  });
  assert.equal(await network.api.registerOwnPushDevice("token-a", "actor-a", "classic", () => true, host), true);
  const logout = network.api.unregisterOwnPushDevice("token-a", host);
  for (let i = 0; i < 20 && !completeDelete; i++) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(typeof completeDelete, "function");
  assert.equal(await network.api.registerOwnPushDevice("token-b", "actor-b", "soft", () => true, host), true);
  completeDelete({ ok: true });
  await logout;
  assert.equal(await network.api.registerOwnPushDevice("token-b", "actor-b", "soft", () => true, host), true);
  assert.equal(network.requests.filter((request) => request.method === "POST").length, 2);
  assert.deepEqual(network.notificationCalls, ["dismiss", "cancel", "clear-response"]);
});

test("missing notifications native import never blocks server device revocation", async () => {
  const failingImport = device("android", { notificationsImportFails: true });
  failingImport.store.set("bthwani.order-alert.installation-v1", "existing-installation");
  await failingImport.api.unregisterOwnPushDevice("actor-token", host);
  assert.deepEqual(failingImport.requests.map((request) => request.method), ["DELETE"]);
  assert.deepEqual(failingImport.notificationCalls, []);
});

test("native dismissal error does not skip remaining cleanup or server revocation", async () => {
  const partialFailure = device("ios", {
    notifications: { dismissAllNotificationsAsync: async () => { throw new Error("OS dismissal failed"); } },
  });
  partialFailure.store.set("bthwani.order-alert.installation-v1", "existing-installation");
  await partialFailure.api.unregisterOwnPushDevice("actor-token", host);
  assert.deepEqual(partialFailure.notificationCalls, ["cancel", "clear-response"]);
  assert.deepEqual(partialFailure.requests.map((request) => request.method), ["DELETE"]);
});
