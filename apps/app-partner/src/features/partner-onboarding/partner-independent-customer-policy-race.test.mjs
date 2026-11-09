import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript-ast";

// Run the production component's actual save() logic, not a duplicate of its decision rules.
const source = readFileSync(new URL("./partner-independent-customer-policy.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("partner-independent-customer-policy.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let saveNode;
function find(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.getText(ast) === "save") saveNode = node;
  ts.forEachChild(node, find);
}
find(ast);
assert.ok(saveNode, "Partner editor must retain the canonical save implementation");
const compiledSave = ts.transpileModule(saveNode.getText(ast) + "\nsave;", {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function harness() {
  const write = deferred();
  const calls = { writes: [], reads: 0, notices: [], states: [], drafts: [], pending: [], busy: [] };
  const input = {
    expectedVersion: 0, cancellationTerms: "Cancellation notice", returnsTerms: "Return instructions",
    fulfillmentTerms: "Pickup from merchant", collectionTerms: "Cash collected by merchant",
  };
  const current = { kind: "authenticated", identity: { role: "partner", subject: "partner-a", sessionId: "session-a" } };
  const scope = s => s?.kind === "authenticated" && s.identity?.role === "partner"
    ? JSON.stringify([s.identity.subject, s.identity.sessionId]) : "";
  let uuidCount = 0;
  const context = {
    busy: false, state: { kind: "ready", policy: { storeId: "store-a", version: 0 } }, pending: null,
    draft: { cancellationTerms: input.cancellationTerms, returnsTerms: input.returnsTerms,
      fulfillmentTerms: input.fulfillmentTerms, collectionTerms: input.collectionTerms },
    storeID: "store-a", Crypto: { randomUUID: () => "attempt-key-unique-" + ++uuidCount },
    currentIdentityState: () => current,
    partnerSetupSessionKey: scope, requestGeneration: { current: 0 },
    savingGeneration: { current: null },
    setBusy: x => calls.busy.push(x), setPending: x => calls.pending.push(x),
    setNotice: x => calls.notices.push(x),
    setState: x => calls.states.push(x), setDraft: x => calls.drafts.push(x),
    saveOwnIndependentCustomerPolicyDraft: (store, body, key, correlation) => {
      calls.writes.push({ store, body, key, correlation });
      return write.promise;
    },
    readOwnIndependentCustomerPolicyDraft: async store => {
      calls.reads++;
      return { draftOnly: true, policy: { storeId: store, version: 1,
        reviewState: "NOT_CHECKED", ...input } };
    },
    fromPolicy: policy => ({
      cancellationTerms: policy.cancellationTerms, returnsTerms: policy.returnsTerms,
      fulfillmentTerms: policy.fulfillmentTerms, collectionTerms: policy.collectionTerms,
    }),
    sameTerms: (policy, expected) => ["cancellationTerms", "returnsTerms", "fulfillmentTerms", "collectionTerms"]
      .every(key => policy[key] === expected[key]),
    isDefinitiveDshMobileClientRejection: cause => cause?.kind === "http" && cause.status >= 400 && cause.status < 500,
  };
  const save = vm.runInNewContext(compiledSave, context);
  return { save, write, calls, current, context };
}

for (const status of [403, 409, 422]) {
  test(`definitive HTTP ${status} cannot be recovered as success from a concurrent matching owner write`, async () => {
    const h = harness();
    h.context.saveOwnIndependentCustomerPolicyDraft = async (store, body, key, correlation) => {
      h.calls.writes.push({ store, body, key, correlation });
      throw { kind: "http", status, code: "REJECTED" };
    };
    await h.save();
    assert.equal(h.calls.reads, 0, "a definitive rejection must not infer success from a later owner read");
    assert.equal(h.calls.states.length, 0, "leave the last confirmed policy state unchanged");
    assert.equal(h.calls.pending.at(-1), null, "a rejected idempotency attempt is not replayed");
    assert.ok(!h.calls.notices.some(value => /تم حفظ/.test(value)), "must not claim the concurrent write as this save");
    assert.ok(h.calls.notices.at(-1), "show an actionable rejection notice");
    assert.equal(h.calls.busy.at(-1), false);
  });
}

test("ambiguous network or server failure still verifies the canonical owner with the same retry key", async () => {
  for (const failure of [new Error("offline"), { kind: "http", status: 503 }]) {
    const h = harness();
    h.context.saveOwnIndependentCustomerPolicyDraft = async (store, body, key, correlation) => {
      h.calls.writes.push({ store, body, key, correlation });
      throw failure;
    };
    await h.save();
    assert.equal(h.calls.reads, 1);
    assert.match(h.calls.notices.at(-1), /تم حفظ/);
    assert.equal(h.calls.pending.at(-1), null);
  }
});
test("two rapid save taps dispatch one canonical write and one readback", async () => {
  const h = harness();
  const first = h.save();
  const second = h.save();
  assert.equal(h.calls.writes.length, 1, "same-render double tap must not generate two idempotency keys");
  h.write.resolve({ draftOnly: true });
  await Promise.all([first, second]);
  assert.equal(h.calls.reads, 1, "only one owner readback is necessary");
  assert.equal(h.calls.pending.filter(Boolean).length, 1, "only one pending idempotency attempt");
  assert.match(h.calls.notices.join(" "), /تم حفظ مسودة السياسات/);
});

for (const scenario of [
  {
    name: "Identity actor switches before the subscription callback",
    invalidate: h => {
      h.current.identity.subject = "partner-b";
      h.current.identity.sessionId = "session-b";
    },
  },
  {
    name: "old editor unmounts with a pending PUT under the same Identity",
    invalidate: h => {
      h.context.requestGeneration.current += 1;
    },
  },
]) {
  test(scenario.name + " must not read or repaint the old Store", async () => {
    const h = harness();
    const pending = h.save();
    assert.equal(h.calls.writes.length, 1);
    scenario.invalidate(h);
    h.write.resolve({ draftOnly: true });
    await pending;
    assert.equal(h.calls.reads, 0, "old Store may never be queried after invalidation");
    assert.equal(h.calls.states.length, 0, "late PUT cannot publish old private state");
    assert.equal(h.calls.drafts.length, 0, "late PUT cannot publish old private terms");
  });
}
