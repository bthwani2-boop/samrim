import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript-ast";

const root = resolve(import.meta.dirname);
function transpile(name) {
  return ts.transpileModule(readFileSync(resolve(root, name), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}
function run(source, modules) {
  const exports = {};
  runInNewContext(source, { exports, require: (name) => {
    if (!(name in modules)) throw new Error("Unmocked module: " + name);
    return modules[name];
  } });
  return exports;
}
const core = run(transpile("fulfillment-choice-core.ts"), {});
function fixture(readStorage) {
  let actor = "actor-a";
  const saved = new Map();
  const storage = {
    getItemAsync: readStorage || (async (key) => saved.get(key) ?? null),
    setItemAsync: async (key, value) => { saved.set(key, value); },
  };
  const api = run(transpile("fulfillment-choice.ts"), {
    "../../bootstrap/compatible-storage": storage,
    "../../bootstrap/identity": { currentIdentityState: () => ({ kind: "authenticated", identity: { subject: actor } }) },
    "./fulfillment-choice-core": core,
  });
  return { api, saved, setActor: (next) => { actor = next; } };
}
const all = ["BTHWANI_CAPTAIN", "PARTNER_CAPTAIN", "CUSTOMER_PICKUP"];

test("a completed storage read for the previous actor is discarded after account switch", async () => {
  let complete;
  const { api, setActor } = fixture(() => new Promise((resolve) => { complete = resolve; }));
  const pending = api.readSavedFulfillmentMode("store-1", "city-1", all);
  assert.equal(typeof complete, "function");
  setActor("actor-b");
  complete("PARTNER_CAPTAIN");
  assert.equal(await pending, null);
});

test("different actors persist distinct delivery modes for the same store", async () => {
  const { api, setActor } = fixture();
  await api.saveFulfillmentMode("store-1", "city-1", "PARTNER_CAPTAIN");
  setActor("actor-b");
  await api.saveFulfillmentMode("store-1", "city-1", "CUSTOMER_PICKUP");
  assert.equal(await api.readSavedFulfillmentMode("store-1", "city-1", all), "CUSTOMER_PICKUP");
  setActor("actor-a");
  assert.equal(await api.readSavedFulfillmentMode("store-1", "city-1", all), "PARTNER_CAPTAIN");
});

test("missing identity and disabled delivery choice fail safely", async () => {
  const { api, setActor } = fixture();
  setActor("");
  assert.equal(await api.readSavedFulfillmentMode("store-1", "city-1", all), null);
  await api.saveFulfillmentMode("store-1", "city-1", "CUSTOMER_PICKUP");
  setActor("actor-a");
  assert.equal(await api.readSavedFulfillmentMode("store-1", "city-1", all), null);
});
