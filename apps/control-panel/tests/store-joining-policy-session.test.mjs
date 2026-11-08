import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const source = readFileSync(path.resolve(import.meta.dirname, "../src/features/policies/store-joining-policy-workspace.tsx"), "utf8");
const start = source.indexOf(" async function save(){");
const end = source.indexOf("\n return <section", start);
assert.ok(start >= 0 && end > start, "production operator policy mutation must be testable");
const saveSource = source.slice(start, end)
  .replaceAll(" as {policy?:Policy;error?:{message?:string}}", "")
  .replaceAll(" as {items?:Policy[]}", "")
  .replaceAll("confirmedBody.items!", "confirmedBody.items");

const policy = (relationModel, enrollmentEnabled, version) => ({
  relationModel, enrollmentEnabled, version, updatedAt: "", updatedBy: "", reason: "",
});
const confirmedItems = [
  policy("BTHWANI_PARTNER", false, 2),
  policy("INDEPENDENT_STORE", true, 1),
];

function executeSave(fetch) {
  const changes = [];
  const inFlightSave = { current: null };
  const state = {
    policies: null, loadedSession: null, error: null, notice: null,
    enabled: null, reason: null, saving: [],
  };
  const running = runInNewContext(saveSource + "\n({ operation: save(), saveAgain: save })", {
    path: "/api/policies/store-joining",
    readbackReady: true, current: policy("BTHWANI_PARTNER", true, 1), saving: false,
    enabled: false, reason: "Policy change approved for testing", selected: "BTHWANI_PARTNER",
    actorSession: '["operator-a","session-1"]',
    window: { confirm: () => true },
    crypto: { randomUUID: () => "single-idempotency-key" },
    AbortController,
    inFlightSave,
    fetch: async (...args) => { changes.push({ path: args[0], options: args[1] }); return fetch(...args); },
    validStoreJoiningPolicyReadback: items =>
      Array.isArray(items) && items.length === 2 && items.every(item => Number.isSafeInteger(item.version) && item.version > 0),
    setPolicies: value => { state.policies = value; },
    setLoadedSession: value => { state.loadedSession = value; },
    setEnabled: value => { state.enabled = value; },
    setReason: value => { state.reason = value; },
    setNotice: value => { state.notice = value; },
    setError: value => { state.error = value; },
    setSaving: value => { state.saving.push(value); },
  });
  return { operation: running.operation, saveAgain: running.saveAgain, changes, state, inFlightSave };
}

test("operator policy save aborts old-session result without applying stale policy, banner, or readback", async () => {
  let deliver;
  const put = new Promise(resolve => { deliver = resolve; });
  const run = executeSave((_path, options) => {
    assert.equal(options.method, "PUT");
    return put;
  });
  assert.equal(run.changes.length, 1);
  assert.ok(run.changes[0].options.signal);
  run.inFlightSave.current.abort(); // session cleanup after Identity changes
  deliver({ ok: true, json: async () => ({ policy: policy("BTHWANI_PARTNER", false, 2) }) });
  await run.operation;
  assert.equal(run.changes.length, 1, "no confirmation GET from an invalidated session");
  assert.equal(run.state.policies, null);
  assert.equal(run.state.loadedSession, null);
  assert.equal(run.state.notice, "");
  assert.equal(run.state.error, "");
  assert.equal(run.state.saving.at(-1), true, "new session's load effect resets saving state instead");
  assert.equal(run.inFlightSave.current, null);
});

test("a confirmed same-session PUT only reports success after fresh DSH readback", async () => {
  const run = executeSave((_path, options) => {
    if (options.method === "PUT") {
      return { ok: true, json: async () => ({ policy: policy("BTHWANI_PARTNER", false, 2) }) };
    }
    return { ok: true, json: async () => ({ items: confirmedItems }) };
  });
  await run.operation;
  assert.equal(run.changes.length, 2);
  assert.strictEqual(run.changes[0].options.signal, run.changes[1].options.signal);
  assert.equal(run.state.loadedSession, '["operator-a","session-1"]');
  assert.equal(run.state.policies?.length, 2);
  assert.equal(run.state.enabled, false);
  assert.match(run.state.notice, /الإصدار 2/);
  assert.equal(run.state.saving.at(-1), false);
});

test("an ambiguous policy readback fails closed and does not retry the PUT", async () => {
  const run = executeSave((_path, options) => {
    if (options.method === "PUT") {
      return { ok: true, json: async () => ({ policy: policy("BTHWANI_PARTNER", false, 2) }) };
    }
    throw new Error("DSH readback unavailable after PUT");
  });
  await run.operation;
  assert.equal(run.changes.filter(call => call.options.method === "PUT").length, 1);
  assert.equal(run.state.loadedSession, "");
  assert.equal(run.state.policies?.length, 0);
  assert.match(run.state.error, /أعد قراءة الحالة من DSH/);
  assert.equal(run.state.notice, "");
});

test("operator policy GET cleanup aborts any in-flight mutation on session switch", () => {
  assert.match(source, /inFlightSave\.current\?\.abort\(\)/);
  assert.match(source, /inFlightSave\.current=null;/);
  assert.match(source, /saving\|\|inFlightSave\.current\|\|enabled===current\.enrollmentEnabled/);
  assert.match(source, /setPolicies\(\[\]\);setLoadedSession\("?"\);setLoading\(true\);setError\("?"\);setNotice\("?"\);setSaving\(false\)/);
  assert.match(source, /if\(controller\.signal\.aborted\)return;/);
  assert.match(source, /if\(!controller\.signal\.aborted\)setSaving\(false\)/);
});

test("switching operator session while DSH confirmation GET is pending ignores the old reply", async () => {
  let deliverReadback;
  const awaitingReadback = new Promise(resolve => { deliverReadback = resolve; });
  const run = executeSave((_path, options) => {
    if (options.method === "PUT") {
      return { ok: true, json: async () => ({ policy: policy("BTHWANI_PARTNER", false, 2) }) };
    }
    return awaitingReadback;
  });
  // Drain the successful PUT/JSON microtasks until the verification GET starts.
  for (let i = 0; i < 8 && run.changes.length < 2; i += 1) await Promise.resolve();
  assert.equal(run.changes.length, 2);
  run.inFlightSave.current.abort();
  deliverReadback({ ok: true, json: async () => ({ items: confirmedItems }) });
  await run.operation;
  assert.equal(run.state.loadedSession, null, "old DSH readback must not authorize a new operator");
  assert.equal(run.state.policies, null);
  assert.equal(run.state.notice, "");
  assert.equal(run.state.error, "");
});

test("version-mismatched DSH confirmation never reports success or issues another PUT", async () => {
  const mismatched = [
    policy("BTHWANI_PARTNER", false, 3),
    policy("INDEPENDENT_STORE", true, 1),
  ];
  const run = executeSave((_path, options) =>
    options.method === "PUT"
      ? { ok: true, json: async () => ({ policy: policy("BTHWANI_PARTNER", false, 2) }) }
      : { ok: true, json: async () => ({ items: mismatched }) },
  );
  await run.operation;
  assert.equal(run.changes.filter(call => call.options.method === "PUT").length, 1);
  assert.equal(run.state.loadedSession, "");
  assert.deepEqual(Array.from(run.state.policies), []);
  assert.equal(run.state.notice, "");
  assert.match(run.state.error, /أعد قراءة الحالة من DSH/);
});

test("double submit during in-flight operator policy save only dispatches one PUT", async () => {
  let deliver;
  const put = new Promise(resolve => { deliver = resolve; });
  const run = executeSave((_path, options) => {
    assert.equal(options.method, "PUT");
    return put;
  });
  await run.saveAgain();
  assert.equal(run.changes.length, 1, "duplicate invocation must not generate a new idempotency key or PUT");
  run.inFlightSave.current.abort();
  deliver({ ok: true, json: async () => ({ policy: policy("BTHWANI_PARTNER", false, 2) }) });
  await run.operation;
  assert.equal(run.changes.length, 1);
});
