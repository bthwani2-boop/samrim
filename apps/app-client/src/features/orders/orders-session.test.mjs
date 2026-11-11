import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript-ast";
import { clientSessionKey } from "../access/client-session-scope.ts";

const source = readFileSync(new URL("./orders.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("orders.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function findVariable(name) {
  let found;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) {
      found = node;
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(found, `missing production variable ${name}`);
  return found;
}

function createOrderLoader(name, runtime) {
  const declaration = findVariable(name);
  assert.ok(ts.isCallExpression(declaration.initializer));
  const callback = declaration.initializer.arguments[0];
  assert.ok(ts.isArrowFunction(callback));
  const compiled = ts.transpileModule(
    `(${callback.getText(ast)});`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
  ).outputText;
  return runInNewContext(compiled, runtime);
}

function deferred() {
  let resolve;
  const promise = new Promise(next => { resolve = next; });
  return { promise, resolve };
}

const identity = (sessionId) => ({
  kind: "authenticated",
  identity: { role: "client", subject: "customer-1", sessionId },
});

function harness(options = {}) {
  let current = identity("session-old");
  let dshCalls = 0;
  const states = [];
  const loadSequence = { current: 0 };
  const pageSequence = { current: 0 };
  const currentIdentityState = () => current;
  const historyFilters = options.historyFilters ?? { q: "" };
  const historyQueryKey = JSON.stringify(historyFilters);
  const requests = [];
  const readyState = {
    kind: "ready", orders: [{ id: "order-1" }], actorID: "customer-1",
    sessionKey: clientSessionKey(current), queryKey: historyQueryKey, nextCursor: "next",
  };
  const listClientOrders = options.listClientOrders ?? (async () => ({ orders: [{ id: "old-order" }], nextCursor: "" }));
  const runtime = {
    loadSequence, pageSequence, currentIdentityState,
    clientSessionKey,
    historyFilters, historyQueryKey, readyState, loadingMore: false, activeActorID: "customer-1",
    isClientActorScopeCurrent: (actor, active) => actor === active,
    hasCurrentOrdersSession: scope => Boolean(scope) && clientSessionKey(currentIdentityState()) === scope,
    getUsableIdentityAccessToken: options.getUsableIdentityAccessToken ?? (async () => "token"),
    createClientDsh: () => ({ listClientOrders: async (...args) => {
      dshCalls++;
      requests.push(args);
      return listClientOrders(...args);
    } }),
    setLoadingMore: () => {},
    setLoadMoreError: () => {},
    setState: value => states.push(typeof value === "function" ? value(readyState) : value),
    console: { error: () => {} },
  };
  return {
    load: createOrderLoader("load", runtime),
    loadMore: createOrderLoader("loadMore", runtime),
    states, requests,
    supersede: () => { loadSequence.current++; pageSequence.current++; },
    get dshCalls() { return dshCalls; },
    switchSession: sessionId => { current = identity(sessionId); },
    currentSession: () => clientSessionKey(current),
  };
}

test("session replaced during token acquisition must not issue former-session Orders read", async () => {
  const token = deferred();
  const scope = harness({ getUsableIdentityAccessToken: () => token.promise });
  const operation = scope.load();
  assert.equal(scope.states.at(-1).kind, "loading");
  scope.switchSession("session-new");
  token.resolve("former-token");
  await operation;
  assert.equal(scope.dshCalls, 0);
  assert.equal(scope.states.some(s => s.kind === "ready"), false);
});

test("late DSH Orders response of a renewed same-actor session never becomes ready", async () => {
  const request = deferred();
  const scope = harness({ listClientOrders: () => request.promise });
  const operation = scope.load();
  for (let i = 0; i < 4 && scope.dshCalls === 0; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(scope.dshCalls, 1);
  scope.switchSession("session-new");
  request.resolve({ orders: [{ id: "private-former-session" }], nextCursor: "" });
  await operation;
  assert.equal(scope.states.some(s => s.kind === "ready"), false);
});

test("Orders load in a current session retains canonical pagination and actor scope", async () => {
  const scope = harness({
    listClientOrders: async () => ({ orders: [{ id: "order-1" }], nextCursor: "next" }),
  });
  await scope.load();
  const ready = scope.states.at(-1);
  assert.equal(ready.kind, "ready");
  assert.equal(ready.actorID, "customer-1");
  assert.equal(ready.sessionKey, scope.currentSession());
  assert.equal(ready.nextCursor, "next");
  assert.equal(ready.orders[0].id, "order-1");
  assert.equal(scope.dshCalls, 1);
});

test("Orders sends the same filters on the first and next owner-backed pages", async () => {
  const filters = { q: "متجر", status: "completed", fulfillmentMode: "CUSTOMER_PICKUP" };
  const scope = harness({
    historyFilters: filters,
    listClientOrders: async (_, options) => ({
      orders: [{ id: options.cursor ? "order-2" : "order-1" }],
      nextCursor: options.cursor ? "" : "next",
    }),
  });
  await scope.load();
  await scope.loadMore();
  assert.deepEqual(scope.requests.map(([, options]) => ({ ...options })), [
    { ...filters, limit: 50 },
    { ...filters, limit: 50, cursor: "next" },
  ]);
  assert.deepEqual(Array.from(scope.states.at(-1).orders, order => order.id), ["order-1", "order-2"]);
});

test("a superseded history query cannot append late continuation rows", async () => {
  const request = deferred();
  const scope = harness({ listClientOrders: () => request.promise });
  const operation = scope.loadMore();
  for (let i = 0; i < 4 && scope.dshCalls === 0; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(scope.dshCalls, 1);
  scope.supersede();
  request.resolve({ orders: [{ id: "former-filter-order" }], nextCursor: "" });
  await operation;
  assert.deepEqual(scope.states, []);
});

test("the search timer discards replaced input and cannot apply former-session text", () => {
  const searchEffect = ast.getChildren().flatMap(node => node.getChildren())
    .find(node => ts.isFunctionDeclaration(node) && node.name?.text === "ClientOrders")
    ?.body?.statements.find(statement => ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression)
      && statement.expression.expression.getText(ast) === "useEffect" && statement.getText(ast).includes("setTimeout"));
  assert.ok(searchEffect, "missing search debounce effect");
  const compiled = ts.transpileModule(`(${searchEffect.expression.arguments[0].getText(ast)});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  let session = "first";
  let timerID = 0;
  const timers = new Map();
  const applied = [];
  const schedule = (search) => runInNewContext(compiled, {
    search, activeSessionKey: session,
    hasCurrentOrdersSession: key => key === session,
    setAppliedSearch: value => applied.push(value),
    setTimeout: (callback, delay) => { assert.equal(delay, 300); timers.set(++timerID, callback); return timerID; },
    clearTimeout: id => timers.delete(id),
  })();
  const cancelFirst = schedule("previous input");
  cancelFirst();
  const cancelSecond = schedule("  متجر  ");
  for (const callback of timers.values()) callback();
  assert.deepEqual(applied, ["متجر"]);
  cancelSecond();
  schedule("former session query");
  session = "second";
  for (const callback of timers.values()) callback();
  assert.deepEqual(applied, ["متجر"]);
});

test("Orders UI, unread counts, pagination and repeat gate all bind to the current session", () => {
  assert.match(source, /state\.queryKey === historyQueryKey && state\.sessionKey === activeSessionKey/);
  assert.match(source, /useConversationUnreadCounts\(visibleOrders\.map\(order => order\.id\), activeSessionKey/);
  assert.match(source, /current\.sessionKey !== sessionKey/);
  assert.match(source, /acquireRepeatOrder\(repeatOrderGate\.current, sessionKey, order\.id\)/);
  assert.match(source, /invalidateRepeatOrderForSessionChange\(repeatOrderGate\.current, nextSessionKey\)/);
  assert.match(source, /\}, \[activeSessionKey, load\]\)/);
  assert.doesNotMatch(source, /hasCurrentOrdersActor\(/);
});
