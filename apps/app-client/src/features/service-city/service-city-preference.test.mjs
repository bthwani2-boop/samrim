import assert from "node:assert/strict";
import test from "node:test";
import { persistCitySelection, readCitySelection } from "./service-city-preference.ts";

const active = new Set(["sanaa", "ibb"]);
function storage(overrides = {}) {
  return {
    getItemAsync: async () => null,
    setItemAsync: async () => {},
    deleteItemAsync: async () => {},
    ...overrides,
  };
}

test("a keychain read error keeps the active in-session city rather than pretending DSH failed", async () => {
  const result = await readCitySelection(storage({ getItemAsync: async () => { throw Error("device locked"); } }), "city", active, "sanaa");
  assert.equal(result, "sanaa");
  assert.equal(await readCitySelection(storage({ getItemAsync: async () => { throw Error("device locked"); } }), "city", active, "inactive"), null);
});

test("valid saved city wins but cannot bypass the active-city list", async () => {
  assert.equal(await readCitySelection(storage({ getItemAsync: async () => " ibb " }), "city", active, "sanaa"), "ibb");
  assert.equal(await readCitySelection(storage(), "city", active, "sanaa"), "sanaa");
});

test("an inactive saved city is discarded without blocking discovery when cleanup fails", async () => {
  let attempted = false;
  const result = await readCitySelection(storage({
    getItemAsync: async () => "inactive",
    deleteItemAsync: async () => { attempted = true; throw Error("keychain unavailable"); },
  }), "city", active, "sanaa");
  assert.equal(result, null);
  assert.equal(attempted, true);
});

test("preference writes and clears never prevent a current-session choice", async () => {
  let saved = null;
  const port = storage({
    setItemAsync: async (_key, value) => { saved = value; throw Error("storage unavailable"); },
    deleteItemAsync: async () => { saved = null; throw Error("storage unavailable"); },
  });
  await assert.doesNotReject(persistCitySelection(port, "city", "sanaa"));
  assert.equal(saved, "sanaa");
  await assert.doesNotReject(persistCitySelection(port, "city", null));
  assert.equal(saved, null);
});
