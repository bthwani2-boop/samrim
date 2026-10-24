import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const code = ts.transpileModule(
  readFileSync(new URL("../src/features/store-discovery/discovery-analytics.ts", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;

function harness(failClick = false) {
  const saved = new Map();
  const events = [];
  let serial = 0;
  const modules = {
    "expo-crypto": { randomUUID: () => "event-" + ++serial },
    "../../bootstrap/compatible-storage": {
      getItemAsync: async (key) => saved.get(key) ?? null,
      setItemAsync: async (key, value) => { saved.set(key, value); },
      deleteItemAsync: async (key) => { saved.delete(key); },
    },
    "./store-discovery-client": {
      recordPublicDiscoveryContentEvent: async (event) => {
        if (event.eventType === "CLICK" && failClick) throw Error("DSH offline");
        events.push({ ...event, lastClickAtSend: [...saved].find(([key]) => key.includes("last-click"))?.[1] ?? null });
      },
    },
  };
  const exports = {};
  runInNewContext(code, {
    exports,
    require: (name) => {
      if (!(name in modules)) throw Error("Unexpected dependency " + name);
      return modules[name];
    },
    Date,
    JSON,
    console: { warn() {} },
  });
  return { api: exports, saved, events };
}

test("failed DSH click cannot become an attributed last click", async () => {
  const h = harness(true);
  await h.api.recordDiscoveryClick("content-a");
  assert.equal(h.events.length, 0);
  assert.equal([...h.saved.keys()].some((key) => key.includes("last-click")), false);
});

test("acknowledged click is persisted only after DSH records it", async () => {
  const h = harness();
  await h.api.recordDiscoveryClick("content-a");
  assert.equal(h.events[0].eventType, "CLICK");
  assert.equal(h.events[0].lastClickAtSend, null);
  const click = JSON.parse([...h.saved].find(([key]) => key.includes("last-click"))[1]);
  assert.equal(click.contentId, "content-a");
  assert.equal(click.clickEventId, h.events[0].clientEventId);
  assert.equal(await h.api.acknowledgedDiscoveryClickForCheckout(), click.clickEventId);
  // The client passes a reference into checkout; conversion is server-owned.
  assert.equal(h.events.length, 1);
  assert.equal([...h.saved.keys()].some((key) => key.includes("last-click")), true);
});

test("expired, legacy and future clicks never become checkout attribution", async () => {
  const h = harness();
  await h.api.recordDiscoveryClick("content-a");
  const key = [...h.saved.keys()].find((entry) => entry.includes("last-click"));
  const current = JSON.parse(h.saved.get(key));
  h.saved.set(key, JSON.stringify({ ...current, clickedAt: Date.now() - 25 * 60 * 60 * 1000 }));
  assert.equal(await h.api.acknowledgedDiscoveryClickForCheckout(), undefined);
  h.saved.set(key, JSON.stringify({ ...current, clickedAt: Date.now() + 60_000 }));
  assert.equal(await h.api.acknowledgedDiscoveryClickForCheckout(), undefined);
  h.saved.set(key, JSON.stringify({ contentId: "content-a", clickedAt: Date.now() }));
  assert.equal(await h.api.acknowledgedDiscoveryClickForCheckout(), undefined);
  assert.equal(h.events.length, 1);
});
