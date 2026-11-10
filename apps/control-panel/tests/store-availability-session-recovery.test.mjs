import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript-ast";

const source = readFileSync(new URL("../src/features/stores/store-availability-controls.tsx", import.meta.url), "utf8");

function productionFunction(name) {
  const tree = ts.createSourceFile("store-availability-controls.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node;
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(found, `missing canonical ${name} function`);
  const compiled = ts.transpileModule(`${found.getText(tree)}\n${name};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return context => runInNewContext(compiled, context);
}
const actualSave = productionFunction("save");
const actualCompatible = productionFunction("compatible")({ ordered: rows => [...rows] });
const base = {
  storeId: "store-one", scheduleMode: "ALWAYS_OPEN", weeklySchedule: [],
  paused: false, pauseReason: null, pauseUntil: null, preparationMinutes: null,
  unavailableFulfillmentModes: [], version: 2,
};
const draft = { ...base, storeId: undefined, version: undefined, expectedVersion: 2 };

function harness({ write, read, sourceStore = "store-one" } = {}) {
  let nonce = 0;
  const state = { writes: [], reads: 0, errors: [], notices: [], sources: [], saving: [] };
  const inFlightSave = { current: null };
  const attemptedMutation = { current: null };
  const context = {
    storeId: "store-one", endpoint: "/api/stores/store-one/operational-availability",
    source: { availability: { ...base, storeId: sourceStore } },
    draft, saving: false, inFlightSave, attemptedMutation,
    validWeeklyWindows: () => true,
    ordered: items => [...items],
    crypto: { randomUUID: () => `request-${++nonce}-unique-id` },
    AbortController, Error,
    compatible: actualCompatible,
    asDraft: item => ({ ...item, expectedVersion: item.version }),
    setError: value => state.errors.push(value),
    setNotice: value => state.notices.push(value),
    setSource: value => state.sources.push(value),
    setDraft: () => {},
    setEditing: () => {},
    setSaving: value => state.saving.push(value),
    partnerErrorMessage: async () => "DSH refused update",
    read: async signal => {
      state.reads++;
      return read ? read(signal) : { availability: { ...base, version: 3 } };
    },
    fetch: async (_url, options) => {
      state.writes.push(options);
      return write ? write(options) : { ok: true, status: 200 };
    },
  };
  return { save: actualSave(context), state, inFlightSave, attemptedMutation };
}

test("same-tick double save creates one DSH PATCH with one stable mutation identity", async () => {
  let deliver;
  const delayed = new Promise(resolve => { deliver = resolve; });
  const h = harness({ write: () => delayed });
  const first = h.save();
  const second = h.save();
  assert.equal(h.state.writes.length, 1);
  assert.equal(h.state.writes[0].method, "PATCH");
  assert.ok(h.state.writes[0].signal);
  deliver({ ok: true, status: 200 });
  await Promise.all([first, second]);
  assert.equal(h.state.reads, 1);
  assert.equal(h.state.notices.filter(Boolean).length, 1);
  assert.equal(h.inFlightSave.current, null);
  assert.equal(h.attemptedMutation.current, null);
});

test("ambiguous network failure retries with the exact key and correlation, not a new mutation", async () => {
  let calls = 0;
  const h = harness({
    write: async () => { if (++calls === 1) throw new Error("lost response"); return { ok: true, status: 200 }; },
  });
  await h.save();
  assert.equal(h.state.reads, 0);
  assert.ok(h.attemptedMutation.current, "unknown outcome must preserve its mutation identity");
  await h.save();
  assert.equal(h.state.writes.length, 2);
  for (const header of ["Idempotency-Key", "X-Correlation-ID"]) {
    assert.equal(h.state.writes[0].headers[header], h.state.writes[1].headers[header]);
  }
  assert.equal(h.state.notices.filter(Boolean).length, 1);
});

test("aborting a pending save prevents old Store confirmation and stale notices", async () => {
  let deliver;
  const h = harness({ write: () => new Promise(resolve => { deliver = resolve; }) });
  const pending = h.save();
  h.inFlightSave.current.abort();
  deliver({ ok: true, status: 200 });
  await pending;
  assert.equal(h.state.reads, 0);
  assert.equal(h.state.notices.filter(Boolean).length, 0);
  assert.equal(h.state.sources.length, 0);
});

test("former Store readback cannot mutate a newly selected Store", async () => {
  const old = harness({ sourceStore: "other-store" });
  await old.save();
  assert.equal(old.state.writes.length, 0);
  const foreign = harness({ read: async () => ({ availability: { ...base, storeId: "other-store" } }) });
  await foreign.save();
  assert.equal(foreign.state.sources.length, 0);
  assert.equal(foreign.state.notices.filter(Boolean).length, 0);
  assert.ok(foreign.state.errors.length > 0);
});

test("readback must match pauseUntil, not only paused and schedule", () => {
  const sent = { ...draft, pauseUntil: "2026-11-11T09:00:00Z" };
  assert.equal(actualCompatible(sent, { ...base, pauseUntil: null }), false);
  assert.equal(actualCompatible(sent, { ...base, pauseUntil: sent.pauseUntil }), true);
});

test("both Store profile presentations remount the availability editor on Store identity changes", () => {
  for (const name of ["store-profile-tabs.tsx", "store-profile-detail-panels.tsx"]) {
    const parent = readFileSync(new URL(`../src/features/stores/${name}`, import.meta.url), "utf8");
    assert.match(parent, /<StoreAvailabilityControls key=\{store\.id\} storeId=\{store\.id\}/);
  }
  assert.match(source, /inFlightSave\.current\?\.abort\(\)/);
  assert.match(source, /source\?\.availability\.storeId===storeId/);
});
