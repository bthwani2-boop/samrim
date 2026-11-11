import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript-ast";

const file = new URL("../src/features/stores/operator-store-creation-form.tsx", import.meta.url);
const source = readFileSync(file, "utf8");
const tree = ts.createSourceFile(String(file), source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let submission;
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "submit") submission = node;
  ts.forEachChild(node, visit);
}
visit(tree);
assert.ok(submission, "exercise the actual Operator Store creation submission");
const runnable = ts.transpileModule(submission.getText(tree) + "\nsubmit;", {
  compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
}).outputText;

function harness({ post, read, actorId = "merchant-1" } = {}) {
  const requests = [];
  const events = { error: [], success: [], busy: [], created: 0 };
  const attempt = { current: null };
  const saveInFlight = { current: false };
  const generation = { current: 2 };
  const sample = { id: "store-created" };
  const makeResponse = (body, status = 200) => new Response(JSON.stringify(body), { status });
  const context = {
    busy: false, ready: true, loading: false, success: "",
    saveInFlight, generation, attempt, actorId,
    name: "متجر جديد", address: "صنعاء شارع عام",
    city: "city", vertical: "vertical", storeType: "type", relation: "BTHWANI_PARTNER",
    latitude: "15.354", longitude: "44.214", mode: "CUSTOMER_PICKUP",
    cities: [{ id: "city" }], verticals: [{ id: "vertical" }],
    types: [{ id: "type", verticalId: "vertical" }],
    setBusy: (value) => events.busy.push(value),
    setError: (value) => events.error.push(value),
    setSuccess: (value) => events.success.push(value),
    onCreated: () => { events.created++; },
    crypto: { randomUUID: () => "guid-001" },
    partnerErrorMessage: async (response) => "HTTP " + response.status,
    identityFetch: async (url, init) => {
      requests.push({ url, init });
      if (init?.method === "POST") return post ? post() : makeResponse({
        storeId: sample.id, relationModel: "BTHWANI_PARTNER", publicationState: "unpublished",
      }, 201);
      return read ? read() : makeResponse({ stores: [sample], nextCursor: "" });
    },
  };
  return {
    submit: runInNewContext(runnable, context),
    events, requests, attempt, generation, saveInFlight,
  };
}
const event = { preventDefault() {} };

test("two same-tick save actions produce one DSH POST and one verified readback", async () => {
  const h = harness();
  await Promise.all([h.submit(event), h.submit(event)]);
  assert.equal(h.requests.filter(x => x.init?.method === "POST").length, 1);
  assert.equal(h.requests.filter(x => !x.init?.method).length, 1);
  assert.equal(h.events.created, 1);
  assert.match(h.events.success.at(-1), /DSH/);
  assert.equal(h.attempt.current, null);
  assert.equal(h.saveInFlight.current, false);
});

test("a definitive conflict releases the retry key, preserving correction flow", async () => {
  const h = harness({ post: async () => new Response("{}", { status: 409 }) });
  await h.submit(event);
  assert.equal(h.events.created, 0);
  assert.equal(h.requests.length, 1);
  assert.equal(h.attempt.current, null);
  assert.match(h.events.error.at(-1), /409/);
});

test("unknown outcome keeps the same request key and never fabricates success", async () => {
  const h = harness({ post: async () => { throw Error("network unavailable"); } });
  await h.submit(event);
  const remembered = h.attempt.current;
  assert.ok(remembered?.key);
  assert.equal(h.events.created, 0);
  await h.submit(event);
  assert.equal(h.requests.length, 2);
  assert.equal(h.attempt.current.key, remembered.key);
  assert.deepEqual(h.events.success, []);
});

test("an old Merchant's delayed completion cannot update a changed Actor workspace", async () => {
  let resolve;
  const h = harness({ post: () => new Promise(r => { resolve = r; }) });
  const pending = h.submit(event);
  await new Promise(done => setImmediate(done));
  assert.equal(typeof resolve, "function");
  h.generation.current++;
  resolve(new Response(JSON.stringify({ storeId: "store-created", relationModel: "BTHWANI_PARTNER", publicationState: "unpublished" }), { status: 201 }));
  await pending;
  assert.equal(h.events.created, 0);
  assert.deepEqual(h.events.success, []);
});
