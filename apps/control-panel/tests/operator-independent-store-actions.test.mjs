import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript-ast";

const workspace = readFileSync(new URL("../src/features/stores/store-workspace.tsx", import.meta.url), "utf8");
const controls = readFileSync(new URL("../src/features/stores/store-mode-controls.tsx", import.meta.url), "utf8");
function productionFunction(source, name) {
  const ast = ts.createSourceFile("operator-store.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node;
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(found, "missing actual production handler " + name);
  const code = ts.transpileModule(found.getText(ast) + "\n" + name + ";", {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return context => runInNewContext(code, context);
}

const publisher = productionFunction(workspace, "changePublication");
const workspaceModes = productionFunction(workspace, "saveFulfillmentModes");
const editorSave = productionFunction(controls, "save");
const modes = ["BTHWANI_CAPTAIN", "PARTNER_CAPTAIN", "CUSTOMER_PICKUP"];
const initialStore = (relationModel, publicationState = "unpublished") => ({
  id: "store-a", relationModel, publicationState, publicationReadiness: { ready: true, blockedReason: null },
  version: 3, fulfillmentModes: ["CUSTOMER_PICKUP"], primaryVerticalId: "vertical-a",
});

function publishHarness({ relation = "INDEPENDENT_STORE", state = "unpublished", status = 200, readback, ready = true } = {}) {
  const store = initialStore(relation, state);
  store.publicationReadiness.ready = ready;
  const events = { writes: [], reads: 0, errors: [], notices: [], updated: 0, setStore: [] };
  const context = {
    storeId: "store-a", publication: { store }, busy: false,
    setBusy: () => {}, setError: value => events.errors.push(value),
    setNotice: value => events.notices.push(value),
    publicationReadinessBlockedReasonLabel: () => "غير جاهز",
    partnerMutationHeaders: () => ({ "Idempotency-Key": "test-attempt-123" }),
    fetch: async (url, options) => {
      events.writes.push({ url, options });
      return { ok: status < 400, status, json: async () => ({ store: { ...store, publicationState: state === "published" ? "hidden" : "published" } }) };
    },
    partnerErrorMessage: async () => "تم رفض العملية",
    reconcileFailure: async () => { events.reads++; events.errors.push("تم رفض العملية"); },
    readStore: async () => {
      events.reads++;
      events.errors.push("");
      return readback === undefined ? { store: { ...store, publicationState: state === "published" ? "hidden" : "published" } } : readback;
    },
    setPublication: value => events.setStore.push(value),
    setSelectedModes: () => {},
    onUpdated: () => { events.updated++; },
  };
  return { run: publisher(context), events };
}

function workspaceModesHarness(relation, selection, readback) {
  const store = initialStore(relation);
  const events = { writes: [], errors: [], notices: [], reads: 0, updated: 0 };
  const context = {
    storeId: "store-a", fulfillmentModeOptions: modes.map(value => ({ value })),
    publication: { store }, busy: false, selectedModes: selection,
    setError: text => events.errors.push(text), setNotice: text => events.notices.push(text),
    setBusy: () => {}, setSelectedModes: () => {},
    partnerMutationHeaders: () => ({}), partnerErrorMessage: async () => "رفض حفظ أوضاع التنفيذ",
    reconcileFailure: async () => { events.reads++; events.errors.push("رفض حفظ أوضاع التنفيذ"); },
    fetch: async (_url, options) => {
      events.writes.push(options);
      return { ok: true, json: async () => ({ fulfillmentModes: selection }) };
    },
    readStore: async () => { events.reads++; return readback ?? { store: { ...store, fulfillmentModes: selection } }; },
    onUpdated: () => { events.updated++; },
  };
  return { run: workspaceModes(context), events };
}

function editorHarness(relation, selection, readbackRelation = relation) {
  const store = initialStore(relation);
  const events = { writes: [], errors: [], notices: [], updated: 0 };
  const ctx = {
    store, modeChoices: modes, selected: selection, changed: true, busy: false,
    setBusy: () => {}, setError: message => events.errors.push(message),
    setNotice: message => events.notices.push(message), setEditing: () => {},
    partnerMutationHeaders: () => ({}), partnerErrorMessage: async () => "رفض DSH",
    fetch: async (url, options) => {
      if (options?.method === "POST") {
        events.writes.push({ url, options });
        return { ok: true, json: async () => ({}) };
      }
      return { ok: true, json: async () => ({ store: { ...store, relationModel: readbackRelation, fulfillmentModes: selection } }) };
    },
    onUpdated: () => { events.updated++; },
  };
  return { run: editorSave(ctx), events };
}

test("independent ready Store cannot publish marketplace even when action is invoked directly", async () => {
  for (const relation of ["INDEPENDENT_STORE", "UNKNOWN"]) {
    const h = publishHarness({ relation });
    await h.run();
    assert.equal(h.events.writes.length, 0, relation + " cannot send a publish mutation");
    assert.equal(h.events.updated, 0);
    assert.match(h.events.errors.at(-1), /غير مفعّل/, "owner reread must not erase the final denial notice");
  }
});
test("marketplace partner publishes, and an already-published independent Store can still be hidden", async () => {
  for (const scenario of [{ relation: "BTHWANI_PARTNER" }, { relation: "INDEPENDENT_STORE", state: "published" }]) {
    const h = publishHarness(scenario);
    await h.run();
    assert.equal(h.events.writes.length, 1);
    const body = JSON.parse(h.events.writes[0].options.body);
    assert.equal(body.state, scenario.state === "published" ? "hidden" : "published");
    assert.equal(h.events.updated, 1);
  }
});
test("publication 403/409 and wrong Store owner readback never report success", async () => {
  for (const status of [403, 409]) {
    const h = publishHarness({ relation: "BTHWANI_PARTNER", status });
    await h.run();
    assert.equal(h.events.writes.length, 1);
    assert.equal(h.events.reads, 1);
    assert.equal(h.events.updated, 0);
    assert.ok(!h.events.notices.some(value => /سُجل|تم تنفيذ/.test(value)));
  }
  const wrong = publishHarness({ relation: "BTHWANI_PARTNER", readback: { store: initialStore("BTHWANI_PARTNER") } });
  wrong.events.reads = 0;
  await wrong.run();
  assert.equal(wrong.events.updated, 0, "unconfirmed owner version/state cannot publish success");
});
test("Workspace refuses Captain mode for independent even with stale manually selected values", async () => {
  const h = workspaceModesHarness("INDEPENDENT_STORE", ["BTHWANI_CAPTAIN", "CUSTOMER_PICKUP"]);
  await h.run();
  assert.equal(h.events.writes.length, 0);
  assert.ok(h.events.errors.some(Boolean));
});
test("Workspace preserves valid partner modes and rejects an owner readback changing to independent", async () => {
  const valid = workspaceModesHarness("BTHWANI_PARTNER", modes);
  await valid.run();
  assert.equal(valid.events.writes.length, 1);
  assert.equal(valid.events.updated, 1);
  const switched = workspaceModesHarness("BTHWANI_PARTNER", modes, {
    store: { ...initialStore("INDEPENDENT_STORE"), fulfillmentModes: modes },
  });
  await switched.run();
  assert.equal(switched.events.updated, 0);
  assert.ok(!switched.events.notices.some(value => /حُفظت/.test(value)));
});
test("compact Store mode editor rejects independent Captain and preserves partner positive", async () => {
  const blocked = editorHarness("INDEPENDENT_STORE", ["BTHWANI_CAPTAIN", "CUSTOMER_PICKUP"]);
  await blocked.run();
  assert.equal(blocked.events.writes.length, 0);
  assert.ok(blocked.events.errors.some(Boolean));
  const valid = editorHarness("BTHWANI_PARTNER", ["BTHWANI_CAPTAIN", "CUSTOMER_PICKUP"]);
  await valid.run();
  assert.equal(valid.events.writes.length, 1);
  assert.equal(valid.events.updated, 1);
});
test("compact editor refuses success when canonical readback changes Store relation", async () => {
  const h = editorHarness("BTHWANI_PARTNER", ["BTHWANI_CAPTAIN", "CUSTOMER_PICKUP"], "INDEPENDENT_STORE");
  await h.run();
  assert.equal(h.events.writes.length, 1);
  assert.equal(h.events.updated, 1, "failed owner readback requests a fresh parent read");
  assert.ok(h.events.errors.some(value => /تتطابق/.test(value)), "relation switch remains an error");
  assert.ok(!h.events.notices.some(value => /حُفظت/.test(value)), "a refresh is not success");
});
test("render contracts hide unsupported publish and Captain controls for independent Store", () => {
  assert.match(workspace, /canChangePublication/);
  assert.match(workspace, /store\.relationModel === "INDEPENDENT_STORE"/);
  assert.match(workspace, /\{canChangePublication \? <button/);
  assert.match(workspace, /fulfillmentModeOptions\.filter\(/);
  assert.match(controls, /modeChoices\.filter\(/);
});
test("canonical Store publication read must compare exact Store ID before updating UI", () => {
  assert.match(workspace, /next\.store\?\.id !== storeId/);
});

function ownerReadHarness({ record = initialStore("BTHWANI_PARTNER"), deferred = false } = {}) {
  const tree = ts.createSourceFile("store-workspace.tsx", workspace, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === "readStore") callback = node.initializer;
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(callback, "extract production DSH owner read");
  const compiled = ts.transpileModule("const readStore = " + callback.getText(tree) + "; readStore;", {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  let resolveFetch;
  const events = { publications: [], errors: [], loading: [], modes: [] };
  const requestSequence = { current: 0 };
  const context = {
    storeId: "store-a",
    useCallback: fn => fn,
    requestSequence,
    fetch: async () => {
      if (deferred) await new Promise(resolve => { resolveFetch = resolve; });
      return { ok: true, json: async () => ({ store: record }) };
    },
    setLoading: value => events.loading.push(value),
    setError: value => events.errors.push(value),
    setPublication: value => events.publications.push(value),
    setSelectedModes: value => events.modes.push(value),
    setSelectedCommercialTypeID: () => {},
    setCommercialTypes: () => {},
    readCommercialStoreTypes: async () => [],
    partnerErrorMessage: async () => "رفضت القراءة",
    Error,
  };
  return { readStore: runInNewContext(compiled, context), requestSequence, events, deliver: () => resolveFetch() };
}
test("canonical owner GET never displays another Store ID or unknown relation", async () => {
  for (const record of [
    { ...initialStore("BTHWANI_PARTNER"), id: "store-b" },
    initialStore("UNKNOWN"),
    { ...initialStore("BTHWANI_PARTNER"), publicationReadiness: {} },
  ]) {
    const h = ownerReadHarness({ record });
    const result = await h.readStore();
    assert.equal(result, null);
    assert.ok(h.events.publications.every(value => value === null), "no foreign record shown");
    assert.ok(h.events.errors.some(Boolean));
  }
});
test("canonical owner GET accepts only exact Store identity and relation", async () => {
  const h = ownerReadHarness();
  const result = await h.readStore();
  assert.equal(result.store.id, "store-a");
  assert.equal(h.events.publications.length, 1);
  assert.equal(h.events.publications[0].store.relationModel, "BTHWANI_PARTNER");
});
test("late GET from a closed Store inspector is ignored even when owner returns valid data", async () => {
  const h = ownerReadHarness({ deferred: true });
  const pending = h.readStore();
  await new Promise(resolve => setImmediate(resolve));
  h.requestSequence.current++;
  h.deliver();
  assert.equal(await pending, null);
  assert.equal(h.events.publications.length, 0);
});

test("marketplace Partner not ready cannot publish even after direct action invocation", async () => {
  const h = publishHarness({ relation: "BTHWANI_PARTNER", ready: false });
  await h.run();
  assert.equal(h.events.writes.length, 0);
  assert.match(h.events.errors.at(-1), /لا يمكن نشر/);
});
test("marketplace publish confirmation rejects a canonical transition to an independent Store", async () => {
  const store = { ...initialStore("INDEPENDENT_STORE"), publicationState: "published" };
  const h = publishHarness({ relation: "BTHWANI_PARTNER", readback: { store } });
  await h.run();
  assert.equal(h.events.writes.length, 1);
  assert.equal(h.events.reads, 1);
  assert.equal(h.events.updated, 0);
  assert.ok(h.events.errors.some(value => /لم تتطابق/.test(value)), "do not call changed relationship a successful marketplace publication");
});
