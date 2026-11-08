import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript-ast";

const source = readFileSync(new URL("../src/features/partner-onboarding/partner-store-public-contact.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("contact.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let saveNode;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "save" && node.initializer) saveNode = node;
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(saveNode, "exercise the actual partner contact save function");
const production = ts.transpileModule("const " + saveNode.getText(ast) + "; save;", {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const initialContact = {
  storeId: "store-a", phoneE164: "+967711111111", email: "store@example.com",
  whatsappPhoneE164: "+967711111111", whatsappEnabled: true, version: 7,
};
function freshContact() {
  return { ...initialContact, phoneE164: "+967733333333", version: 8 };
}
function harness({ write, read, initialStore = "store-a" } = {}) {
  let actor = "actor-a:session-a";
  let serial = 0;
  let busy = false;
  let currentState = { kind: "ready", contact: initialContact };
  const attempts = [];
  const events = { state: [], draft: [], message: [], pending: [], busy: [], read: 0 };
  const environment = {
    busy: false,
    savingGeneration: { current: null }, requestGeneration: { current: 1 },
    state: currentState,
    storeID: initialStore,
    draft: { ...freshContact() },
    pending: null,
    currentIdentityState: () => actor,
    partnerSetupSessionKey: identity => identity,
    isDefinitiveDshMobileClientRejection: cause => cause?.kind === "http" && cause.status >= 400 && cause.status < 500,
    Crypto: { randomUUID: () => String(++serial).padStart(16, "x") },
    savePartnerStoreContact: async (storeId, input, key, correlation) => {
      attempts.push({ storeId, input, key, correlation });
      return write ? write({ storeId, input, key, correlation }) : {};
    },
    readPartnerStoreContact: async storeId => {
      events.read++;
      return read ? read(storeId) : { contact: freshContact() };
    },
    setBusy: v => { busy = v; events.busy.push(v); },
    setPending: v => events.pending.push(v),
    setMessage: v => events.message.push(v),
    setState: v => { currentState = v; events.state.push(v); },
    setDraft: v => events.draft.push(v),
    fromContact: v => ({ ...v }),
    same: (contact, input) => contact.phoneE164 === input.phoneE164 &&
      contact.email === input.email &&
      contact.whatsappPhoneE164 === input.whatsappPhoneE164 &&
      contact.whatsappEnabled === input.whatsappEnabled,
    Error,
  };
  const save = runInNewContext(production, environment);
  return { save, attempts, events, setActor: value => { actor = value; }, get busy() { return busy; } };
}

test("Store Contact editor guards the session boundary during reads and does not use a foreign Store readback", () => {
  assert.match(source, /subscribeIdentitySession\(/, "same Store may remain mounted across Identity changes");
  assert.match(source, /partnerSetupSessionKey\(currentIdentityState\(\)\)/);
  assert.match(source, /contact\.storeId !== storeID/, "fail closed on mismatched DSH record");
  assert.match(source, /requestGeneration\.current/, "invalidate obsolete outstanding GET and PUT");
});

test("two same-render contact save taps send exactly one mutation", async () => {
  let resolve;
  const h = harness({ write: () => new Promise(r => { resolve = r; }) });
  const first = h.save();
  const second = h.save();
  await new Promise(r => setImmediate(r));
  assert.equal(h.attempts.length, 1);
  resolve({});
  await Promise.all([first, second]);
  assert.equal(h.events.read, 1);
  assert.match(h.events.message.at(-1), /تم حفظ بيانات التواصل/);
});

test("Identity switch while contact mutation is in flight prevents any old-Store readback or success notice", async () => {
  let resolve;
  const h = harness({ write: () => new Promise(r => { resolve = r; }) });
  const pending = h.save();
  await new Promise(r => setImmediate(r));
  h.setActor("actor-b:session-b");
  resolve({});
  await pending;
  assert.equal(h.attempts.length, 1);
  assert.equal(h.events.read, 0);
  assert.equal(h.events.state.length, 0);
  assert.ok(!h.events.message.some(value => /تم حفظ/.test(value)));
});

test("sign-out and stale response after canonical read cannot show previous Store data", async () => {
  let deliver;
  const h = harness({ read: () => new Promise(r => { deliver = r; }) });
  const pending = h.save();
  await new Promise(r => setImmediate(r));
  assert.equal(h.events.read, 1);
  h.setActor("");
  deliver({ contact: freshContact() });
  await pending;
  assert.equal(h.events.state.length, 0);
  assert.equal(h.events.draft.length, 0);
  assert.ok(!h.events.message.some(value => /تم حفظ/.test(value)));
});

test("another Store's DSH contact record is rejected, not displayed as saved", async () => {
  const h = harness({ read: async () => ({ contact: { ...freshContact(), storeId: "store-b" } }) });
  await h.save();
  assert.equal(h.attempts.length, 1);
  assert.ok(!h.events.state.some(state => state.kind === "ready"));
  assert.ok(!h.events.message.some(value => /تم حفظ/.test(value)));
});

test("lost mutation response with verified same-Store canonical version is recoverable", async () => {
  const h = harness({
    write: async () => { throw new Error("response lost after commit"); },
    read: async () => ({ contact: freshContact() }),
  });
  await h.save();
  assert.equal(h.attempts.length, 1);
  assert.equal(h.events.read, 1);
  assert.match(h.events.message.at(-1), /تم حفظ بيانات التواصل/);
  assert.equal(h.events.pending.at(-1), null);
});

test("unavailable canonical readback does not fabricate success and keeps retry correlation", async () => {
  const h = harness({
    write: async () => { throw new Error("timeout"); },
    read: async () => { throw new Error("offline"); },
  });
  await h.save();
  assert.equal(h.attempts.length, 1);
  assert.match(h.events.message.at(-1), /لم يمكن تأكيد/);
  assert.ok(h.events.pending.some(value => value?.key), "the existing attempt key is retained for safe retry");
  assert.ok(!h.events.message.some(value => /تم حفظ/.test(value)));
});

let focusNode;
function findFocus(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useFocusEffect") focusNode = node.arguments[0];
  ts.forEachChild(node, findFocus);
}
findFocus(ast);
assert.ok(focusNode, "use the production focused DSH GET effect");
const productionFocus = ts.transpileModule("const focus = " + focusNode.getText(ast) + "; focus;", {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

function focusedRead({ value = initialContact, deferred = false } = {}) {
  let actor = "actor-a:session-a";
  let deliver;
  const events = { states: [], drafts: [], messages: [], pending: [] };
  const scope = { current: 0 };
  const read = deferred
    ? () => new Promise(resolve => { deliver = resolve; })
    : async () => ({ contact: value });
  const focus = runInNewContext(productionFocus, {
    useCallback: callback => callback,
    requestGeneration: scope,
    currentIdentityState: () => actor,
    partnerSetupSessionKey: identity => identity,
    storeID: "store-a",
    reloadToken: 0,
    readPartnerStoreContact: read,
    setState: value => events.states.push(value),
    setDraft: value => events.drafts.push(value),
    setMessage: value => events.messages.push(value),
    setPending: value => events.pending.push(value),
    fromContact: value => ({ ...value }),
  });
  const cleanup = focus();
  return { cleanup, events, setActor: value => { actor = value; }, deliver: value => deliver(value) };
}
const flushRead = () => new Promise(resolve => setImmediate(resolve));

test("focus read after switching actor cannot expose the previous actor's Store contact", async () => {
  const h = focusedRead({ deferred: true });
  h.setActor("actor-b:session-b");
  h.deliver({ contact: initialContact });
  await flushRead();
  assert.deepEqual(h.events.states.map(s => s.kind), ["loading"]);
  assert.equal(h.events.drafts.length, 0);
  h.cleanup();
});

test("focus read drops a response after screen blur and rejects wrong Store record", async () => {
  const stale = focusedRead({ deferred: true });
  stale.cleanup();
  stale.deliver({ contact: initialContact });
  await flushRead();
  assert.deepEqual(stale.events.states.map(s => s.kind), ["loading"]);
  const wrong = focusedRead({ value: { ...initialContact, storeId: "other-store" } });
  await flushRead();
  assert.deepEqual(wrong.events.states.map(s => s.kind), ["loading", "error"]);
  assert.equal(wrong.events.drafts.length, 0);
  wrong.cleanup();
});

test("same-session focused read accepts only exact Store and recovers into ready state", async () => {
  const h = focusedRead();
  await flushRead();
  assert.deepEqual(h.events.states.map(s => s.kind), ["loading", "ready"]);
  assert.equal(h.events.states.at(-1).contact.storeId, "store-a");
  assert.equal(h.events.drafts.length, 1);
  h.cleanup();
});

test("definitive 403/409 contact update rejection is never recovered as a successful write", async () => {
  for (const status of [403, 409]) {
    const h = harness({
      write: async () => { throw { kind: "http", status, code: "REJECTED", message: "rejected" }; },
      read: async () => ({ contact: freshContact() }),
    });
    await h.save();
    assert.equal(h.attempts.length, 1, `status ${status}`);
    assert.equal(h.events.read, 0, `status ${status}: no spurious GET after definitive rejection`);
    assert.ok(!h.events.message.some(value => /تم حفظ/.test(value)), `status ${status}: no success`);
    assert.ok(h.events.message.some(value => /رفض|تحديث|مراجعة/.test(value)), `status ${status}: actionable error`);
    assert.equal(h.events.pending.at(-1), null, `status ${status}: rejected attempt is not retried with old key`);
    assert.equal(h.busy, false, `status ${status}: UI is not stuck busy`);
  }
});
