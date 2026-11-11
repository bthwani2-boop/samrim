import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript-ast";
import { clientSessionKey } from "../access/client-session-scope.ts";

const source = readFileSync(new URL("./store-access-invitation-inbox.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("store-access-invitation-inbox.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const actor = (subject, sessionId) => ({
  kind: "authenticated", identity: { role: "client", subject, sessionId },
});

function production(runtime, names) {
  const nodes = new Map();
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text) {
      nodes.set(node.name.text, node.getText(ast));
    }
    if (ts.isVariableDeclaration(node) && ["reload", "isCurrentSession"].includes(node.name.getText(ast))) {
      const id = node.name.getText(ast);
      const value = node.initializer;
      const arrow = id === "reload" && ts.isCallExpression(value) ? value.arguments[0] : value;
      assert.ok(arrow && ts.isArrowFunction(arrow));
      nodes.set(id, `const ${id} = ${arrow.getText(ast)};`);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  const keys = ["currentInvitationSessionKey", "isCurrentSession", "reload", "decide"];
  for (const key of keys) assert.ok(nodes.has(key), `production function not found: ${key}`);
  const program = `${keys.map(key => nodes.get(key)).join("\n")}\n({ reload, decide, isCurrentSession })`;
  const js = ts.transpileModule(program, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const value = runInNewContext(js, { clientSessionKey, ...runtime });
  return Object.fromEntries(names.map(name => [name, value[name]]));
}

function harness(overrides = {}) {
  let identity = actor("client-a", "session-1");
  const sessionKey = clientSessionKey(identity);
  const observed = { requests: 0, decisions: 0, items: [], owners: [], errors: [], busy: [], loads: [] };
  const data = { items: [{ id: "grant-a", state: "pending_acceptance", version: 3, storeName: "Store" }] };
  const api = {
    listActorStoreAccessInvitations: async () => { observed.requests++; return data; },
    decideActorStoreAccessInvitation: async () => { observed.decisions++; },
  };
  const attempts = { current: new Map() };
  let uuidSequence = 0;
  const runtime = {
    currentIdentityState: () => identity,
    sessionKey,
    loadedSessionKey: sessionKey,
    busyGrantID: "",
    busyGrantRef: { current: "" },
    requestID: { current: 0 },
    getAccessToken: async () => "token-session-1",
    createClient: () => api,
    setLoading: value => { observed.loads.push(value); },
    setError: value => { observed.errors.push(value); },
    setItems: value => { observed.items = value; },
    setLoadedSessionKey: value => { observed.owners.push(value); },
    setBusyGrantID: value => { observed.busy.push(value); },
    cryptoRandomUUID: () => `123e4567-e89b-42d3-a456-${String(++uuidSequence).padStart(12, "0")}`,
    attempts,
    ...overrides,
  };
  return {
    runtime, api, observed, sessionKey, attempts, grant: data.items[0],
    renew: () => { identity = actor("client-a", "session-2"); },
    other: () => { identity = actor("client-b", "session-1"); },
    signOut: () => { identity = { kind: "signed_out" }; },
  };
}

test("current Client session reads canonical DSH invitation list", async () => {
  const x = harness();
  const { reload } = production(x.runtime, ["reload"]);
  await reload();
  assert.equal(x.observed.requests, 1);
  assert.equal(x.observed.items[0].id, "grant-a");
  assert.deepEqual(x.observed.owners, [x.sessionKey]);
});

test("new same-actor session rejects an old token before any DSH read", async () => {
  let unlock;
  const x = harness({ getAccessToken: () => new Promise(resolve => { unlock = resolve; }) });
  const { reload } = production(x.runtime, ["reload"]);
  const reading = reload();
  x.renew();
  unlock("old-token");
  await reading;
  assert.equal(x.observed.requests, 0);
  assert.deepEqual(x.observed.items, []);
});

test("late invitation response from replaced session must never render", async () => {
  let finish, started;
  const requested = new Promise(resolve => { started = resolve; });
  const x = harness();
  x.api.listActorStoreAccessInvitations = () => {
    x.observed.requests++;
    started();
    return new Promise(resolve => { finish = resolve; });
  };
  const { reload } = production(x.runtime, ["reload"]);
  const reading = reload();
  await requested;
  x.renew();
  finish({ items: [x.grant] });
  await reading;
  assert.deepEqual(x.observed.items, []);
  assert.deepEqual(x.observed.owners, []);
});

test("a stale acceptance token cannot mutate a Store invitation in new session", async () => {
  let unlock;
  const x = harness({ getAccessToken: () => new Promise(resolve => { unlock = resolve; }) });
  const { decide } = production(x.runtime, ["decide"]);
  const task = decide(x.grant, "accept");
  x.renew();
  unlock("old-token");
  await task;
  assert.equal(x.observed.decisions, 0);
  assert.equal(x.observed.errors.length, 1, "the initial error clear is permitted");
  assert.equal(x.attempts.current.size, 1, "retain idempotency evidence after uncertain interruption");
});

test("late acceptance acknowledgement cannot refresh or show success to a new session", async () => {
  let finish, started;
  const mutationStarted = new Promise(resolve => { started = resolve; });
  const x = harness();
  x.api.decideActorStoreAccessInvitation = () => {
    x.observed.decisions++;
    started();
    return new Promise(resolve => { finish = resolve; });
  };
  const { decide } = production(x.runtime, ["decide"]);
  const task = decide(x.grant, "accept");
  await mutationStarted;
  x.renew();
  finish();
  await task;
  assert.equal(x.observed.decisions, 1, "the canonical write had already started");
  assert.equal(x.observed.requests, 0, "old session must not trigger a new read");
  assert.equal(x.attempts.current.size, 1, "retry key retained until verified in current session");
});

test("current session can decline and reread after definitive canonical acknowledgement", async () => {
  const x = harness();
  const { decide } = production(x.runtime, ["decide"]);
  await decide(x.grant, "decline");
  assert.equal(x.observed.decisions, 1);
  assert.equal(x.observed.requests, 1);
  assert.equal(x.attempts.current.size, 0);
  assert.deepEqual(x.observed.owners, [x.sessionKey]);
});

test("failed current-session decision rereads DSH and retains idempotency retry key", async () => {
  const x = harness();
  x.api.decideActorStoreAccessInvitation = async () => {
    x.observed.decisions++;
    throw Error("temporary");
  };
  const { decide } = production(x.runtime, ["decide"]);
  await decide(x.grant, "accept");
  assert.equal(x.observed.requests, 1);
  assert.equal(x.attempts.current.size, 1);
  assert.match(x.observed.errors.at(-1), /تعذر تأكيد القرار/);
});

test("same-account new session and logout hide old private invites before effect runs", () => {
  const x = harness();
  const { isCurrentSession } = production(x.runtime, ["isCurrentSession"]);
  assert.equal(isCurrentSession(), true);
  x.renew();
  assert.equal(isCurrentSession(), false);
  x.signOut();
  assert.equal(isCurrentSession(), false);
  assert.match(source, /currentItems = isCurrentSession\(\) && loadedSessionKey === sessionKey \? items : \[\]/);
  assert.match(source, /if \(!isCurrentSession\(\)\) return null/);
  assert.match(source, /\{currentItems\.map\(\(grant\)/);
  assert.match(source, /next === sessionKeyRef\.current\) return/);
});

function productionSubscription(runtime) {
  let callback = "";
  let helper = "";
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "currentInvitationSessionKey") {
      helper = node.getText(ast);
    }
    if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect" &&
        node.arguments[0]?.getText(ast).includes("subscribeIdentitySession")) {
      callback = node.arguments[0].getText(ast);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(helper && callback, "production identity subscription must be present");
  const program = `${helper}\nconst install = ${callback};\ninstall;`;
  const js = ts.transpileModule(program, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return runInNewContext(js, { clientSessionKey, ...runtime });
}

function identitySubscriptionFixture() {
  let current = actor("client-a", "session-1");
  let listener;
  const events = [];
  const runtime = {
    currentIdentityState: () => current,
    sessionKeyRef: { current: clientSessionKey(current) },
    requestID: { current: 7 },
    subscribeIdentitySession: cb => { listener = cb; return () => {}; },
    setSessionKey: key => events.push(["session", key]),
    setLoadedSessionKey: key => events.push(["owner", key]),
    setItems: list => events.push(["items", Array.from(list)]),
    setError: message => events.push(["error", message]),
    setBusyGrantID: id => events.push(["busy", id]),
    busyGrantRef: { current: "" },
  };
  const install = productionSubscription(runtime);
  install();
  return { runtime, events, notify: () => listener(),
    setSession: sessionId => { current = actor("client-a", sessionId); },
    nextKey: sessionId => clientSessionKey(actor("client-a", sessionId)),
  };
}

test("token refresh in the same Identity session preserves Store access invitation state", () => {
  const x = identitySubscriptionFixture();
  x.setSession("session-1");
  x.notify();
  assert.equal(x.runtime.requestID.current, 7);
  assert.deepEqual(x.events, []);
});

test("the exact new Identity session immediately invalidates stale invitation state", () => {
  const x = identitySubscriptionFixture();
  x.setSession("session-2");
  x.notify();
  assert.equal(x.runtime.requestID.current, 8);
  assert.equal(x.runtime.sessionKeyRef.current, x.nextKey("session-2"));
  assert.deepEqual(x.events, [
    ["session", x.nextKey("session-2")],
    ["owner", ""], ["items", []], ["error", ""], ["busy", ""],
  ]);
});


test("a second immediate accept or decline cannot race the first Store decision", async () => {
  const x = harness();
  let finish, started;
  const mutationStarted = new Promise(resolve => { started = resolve; });
  x.api.decideActorStoreAccessInvitation = () => {
    x.observed.decisions++;
    started();
    return new Promise(resolve => { finish = resolve; });
  };
  const { decide } = production(x.runtime, ["decide"]);
  const first = decide(x.grant, "accept");
  await mutationStarted;
  await decide(x.grant, "decline");
  assert.equal(x.observed.decisions, 1, "cross-decision double click must not reach DSH");
  finish();
  await first;
  assert.equal(x.runtime.busyGrantRef.current, "");
  assert.equal(x.observed.requests, 1);
});

test("an uncertain retry key is retained for same actor but not reused by another actor", async () => {
  const x = harness();
  const recorded = [];
  x.api.decideActorStoreAccessInvitation = async (...args) => {
    recorded.push(args[3]);
    throw new Error("uncertain-commit");
  };
  const { decide } = production(x.runtime, ["decide"]);
  await decide(x.grant, "accept");
  assert.equal(x.attempts.current.size, 1);
  assert.equal(recorded.length, 1);
  x.other();
  x.api.decideActorStoreAccessInvitation = async (...args) => {
    recorded.push(args[3]);
  };
  const otherKey = clientSessionKey(actor("client-b", "session-1"));
  const next = production({ ...x.runtime, sessionKey: otherKey, loadedSessionKey: otherKey }, ["decide"]);
  await next.decide(x.grant, "accept");
  assert.equal(recorded.length, 2);
  assert.notEqual(recorded[0], recorded[1], "idempotency evidence must not leak between accounts");
  assert.equal(x.attempts.current.size, 1, "only the uncertain former actor decision remains");
});
