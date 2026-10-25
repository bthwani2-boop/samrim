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
  const exports = {};
  const notifications = {
    getPermissionsAsync: async () => ({ granted: true }),
    getExpoPushTokenAsync: async () => ({ data: "ExponentPushToken[validTokenForIsolatedTest]" }),
    ...overrides.notifications,
  };
  const mock = {
    expo: { requireOptionalNativeModule: () => ({}) },
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
      if (!(name in mock)) throw new Error("Unmocked module: " + name);
      return mock[name];
    },
    fetch, AbortSignal, Date, Promise, process: { env: {} },
  }, { filename: "shared-push-device.js" });
  return { api: exports, requests, store };
}

const host = "http://127.0.0.1:18080";
test("iOS registration reuses an actor+tone and logout revokes its installation", async () => {
  const { api, requests } = device("ios");
  assert.equal(await api.registerOwnPushDevice("token-a", "actor-a", "classic", () => true, host), true);
  assert.equal(await api.registerOwnPushDevice("token-a", "actor-a", "classic", () => true, host), true);
  assert.equal(requests.filter((request) => request.method === "POST").length, 1);
  await api.unregisterOwnPushDevice("token-a", host);
  assert.equal(requests.filter((request) => request.method === "DELETE").length, 1);
  assert.ok(requests.every((request) => request.url.startsWith(host + "/dsh/notifications/devices")));
  assert.ok(requests.every((request) => request.authorization === "Bearer token-a"));
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
