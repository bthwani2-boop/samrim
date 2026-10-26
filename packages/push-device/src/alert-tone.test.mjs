import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript-ast";

const file = resolve(import.meta.dirname, "alert-tone.ts");
const compiled = ts.transpileModule(readFileSync(file, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function setup(platform = "android", overrides = {}) {
  const storage = new Map();
  const calls = [];
  const exports = {};
  const modules = {
    "expo-crypto": {
      CryptoDigestAlgorithm: { SHA256: "SHA256" },
      digestStringAsync: async (_algorithm, actor) => "hashed-" + actor,
    },
    "expo-secure-store": {
      getItemAsync: async (key) => {
        calls.push(["get", key]);
        if (overrides.read) return overrides.read(key);
        return storage.get(key) ?? null;
      },
      setItemAsync: async (key, value) => {
        calls.push(["set", key, value]);
        storage.set(key, value);
      },
    },
    "react-native": { Platform: { OS: platform } },
  };
  runInNewContext(compiled, {
    exports,
    require: (name) => {
      if (!(name in modules)) throw new Error("Unexpected import: " + name);
      return modules[name];
    },
  }, { filename: "alert-tone.js" });
  return { api: exports, storage, calls };
}

test("two actors retain isolated tone preferences", async () => {
  const { api, storage } = setup();
  let actor = "actor-a";
  const isCurrent = (id) => id === actor;
  assert.equal(await api.saveAlertToneForActor("actor-a", "soft", isCurrent), true);
  actor = "actor-b";
  assert.equal(await api.saveAlertToneForActor("actor-b", "urgent", isCurrent), true);
  assert.equal(await api.readAlertToneForActor("actor-a"), "soft");
  assert.equal(await api.readAlertToneForActor("actor-b"), "urgent");
  assert.equal(storage.size, 2);
});

test("switching actor while reading never yields previous actor's sound", async () => {
  let fulfill;
  const { api } = setup("android", { read: () => new Promise((resolve) => { fulfill = resolve; }) });
  let actor = "actor-a";
  const pending = api.currentOrderAlertTone(() => actor);
  for (let i = 0; i < 20 && !fulfill; i++) await Promise.resolve();
  assert.equal(typeof fulfill, "function");
  actor = "actor-b";
  fulfill("urgent");
  assert.equal(await pending, "classic");
});

test("stale actor and web can never write a preference", async () => {
  const { api, calls } = setup();
  assert.equal(await api.saveAlertToneForActor("actor-a", "urgent", (id) => id === "actor-b"), false);
  assert.equal(await api.saveAlertToneForActor("actor-a", "invalid", () => true), false);
  assert.equal(calls.length, 0);
  const web = setup("web");
  assert.equal(await web.api.readAlertToneForActor("actor-a"), "classic");
  assert.equal(await web.api.saveAlertToneForActor("actor-a", "urgent", () => true), false);
  assert.equal(web.calls.length, 0);
});

test("unknown/corrupt tones and anonymous reads default safely", async () => {
  const { api } = setup("ios", { read: async () => "unexpected-value" });
  assert.equal(await api.readAlertToneForActor("actor-a"), "classic");
  assert.equal(await api.currentOrderAlertTone(() => ""), "classic");
});

test("actor changed while hashing blocks any write", async () => {
  const { api, calls } = setup();
  let checks = 0;
  const stillCurrent = () => ++checks === 1;
  assert.equal(await api.saveAlertToneForActor("actor-a", "soft", stillCurrent), false);
  assert.equal(calls.length, 0);
});
