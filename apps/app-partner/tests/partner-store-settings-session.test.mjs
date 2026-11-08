import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript-ast";

const source = readFileSync(new URL("../src/features/partner-onboarding/partner-store-settings-overview.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("partner-store-settings-overview.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let focusArgument;
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useFocusEffect") focusArgument = node.arguments[0];
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(focusArgument, "exercise the production focused Store settings read");
const compiledFocus = ts.transpileModule("const focus = " + focusArgument.getText(ast) + "; focus;", {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
let identityEffect;
function findIdentityEffect(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect" &&
      node.arguments[0]?.getText(ast).includes("subscribeIdentitySession")) identityEffect = node.arguments[0];
  ts.forEachChild(node, findIdentityEffect);
}
findIdentityEffect(ast);
assert.ok(identityEffect, "subscribe to canonical Identity session changes");
const compiledIdentityEffect = ts.transpileModule("const subscribe = " + identityEffect.getText(ast) + "; subscribe;", {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function actor(subject, sessionId = "session-a") {
  return { kind: "authenticated", identity: { role: "partner", subject, sessionId } };
}
const sessionKey = state => state?.kind === "authenticated" && state.identity?.role === "partner"
  ? JSON.stringify([state.identity.subject, state.identity.sessionId]) : "";
function response(storeId = "store-a", modeStoreId = storeId) {
  return {
    availability: { storeId, paused: false, scheduleMode: "ALWAYS_OPEN", preparationMinutes: 15 },
    orderabilityByMode: [{ storeId: modeStoreId, fulfillmentMode: "CUSTOMER_PICKUP", state: "OPEN_FOR_ORDERS" }],
  };
}
function focusedRead({ value = response(), pending = false } = {}) {
  let identity = actor("partner-a");
  const wait = deferred();
  const events = [];
  const generations = { current: 0 };
  const focus = runInNewContext(compiledFocus, {
    useCallback: callback => callback,
    currentIdentityState: () => identity,
    partnerSetupSessionKey: sessionKey,
    requestGeneration: generations,
    storeID: "store-a",
    retry: 0,
    sessionKey: sessionKey(identity),
    readOwnStoreOperationalAvailability: () => pending ? wait.promise : Promise.resolve(value),
    setState: state => events.push(state),
    Error,
  });
  const cleanup = focus();
  return { cleanup, events, generations, switchIdentity: next => { identity = next; }, resolve: data => wait.resolve(data) };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test("settings GET drops a former Partner response while the screen remains focused", async () => {
  const h = focusedRead({ pending: true });
  h.switchIdentity(actor("partner-b", "session-b"));
  h.resolve(response());
  await flush();
  assert.deepEqual(h.events.map(state => state.kind), ["loading"]);
  h.cleanup();
});

test("settings GET rejects availability owned by another Store", async () => {
  const h = focusedRead({ value: response("store-b") });
  await flush();
  assert.deepEqual(h.events.map(state => state.kind), ["loading", "error"]);
  h.cleanup();
});

test("settings GET rejects orderability rows owned by another Store", async () => {
  const h = focusedRead({ value: response("store-a", "store-b") });
  await flush();
  assert.deepEqual(h.events.map(state => state.kind), ["loading", "error"]);
  h.cleanup();
});

test("same-session settings GET accepts canonical availability and matching orderability", async () => {
  const h = focusedRead();
  await flush();
  assert.deepEqual(h.events.map(state => state.kind), ["loading", "ready"]);
  assert.equal(h.events.at(-1).value.availability.storeId, "store-a");
  assert.ok(h.events.at(-1).value.orderabilityByMode.every(mode => mode.storeId === "store-a"));
  h.cleanup();
});

test("Identity subscription clears visible data and invalidates requests for the previous Partner", () => {
  let listener;
  let identity = actor("partner-a");
  let retry = 0;
  const events = [];
  const generation = { current: 4 };
  const subscribe = runInNewContext(compiledIdentityEffect, {
    useEffect: effect => effect(),
    subscribeIdentitySession: callback => { listener = callback; return () => {}; },
    partnerSetupSessionKey: sessionKey,
    sessionScope: { current: sessionKey(identity) },
    requestGeneration: generation,
    setIdentityState: value => { identity = value; events.push(["identity", value]); },
    setState: value => events.push(["state", value]),
    setRetry: update => { retry = update(retry); },
  });
  subscribe();
  listener(actor("partner-b", "session-b"));
  assert.equal(generation.current, 5);
  assert.equal(identity.identity.subject, "partner-b");
  assert.equal(retry, 1);
  assert.deepEqual(events.map(([kind]) => kind), ["identity", "state"]);
  assert.equal(events.at(-1)[1].kind, "loading");
});
