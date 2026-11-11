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

function createOrderLoader(runtime) {
  const declaration = findVariable("load");
  assert.ok(ts.isCallExpression(declaration.initializer));
  const callback = declaration.initializer.arguments[0];
  assert.ok(ts.isArrowFunction(callback));
  const compiled = ts.transpileModule(
    `const load = ${callback.getText(ast)};\nload;`,
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
  const listClientOrders = options.listClientOrders ?? (async () => ({ orders: [{ id: "old-order" }], nextCursor: "" }));
  const load = createOrderLoader({
    loadSequence, pageSequence, currentIdentityState,
    clientSessionKey,
    hasCurrentOrdersSession: scope => Boolean(scope) && clientSessionKey(currentIdentityState()) === scope,
    getUsableIdentityAccessToken: options.getUsableIdentityAccessToken ?? (async () => "token"),
    client: () => ({ listClientOrders: async (...args) => {
      dshCalls++;
      return listClientOrders(...args);
    } }),
    setLoadingMore: () => {},
    setLoadMoreError: () => {},
    setState: value => states.push(value),
    console: { error: () => {} },
  });
  return {
    load,
    states,
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

test("Orders UI, unread counts, pagination and repeat gate all bind to the current session", () => {
  assert.match(source, /state\.sessionKey !== activeSessionKey/);
  assert.match(source, /useConversationUnreadCounts\(visibleOrders\.map\(order => order\.id\), activeSessionKey/);
  assert.match(source, /current\.sessionKey !== sessionKey/);
  assert.match(source, /acquireRepeatOrder\(repeatOrderGate\.current, sessionKey, order\.id\)/);
  assert.match(source, /invalidateRepeatOrderForSessionChange\(repeatOrderGate\.current, clientSessionKey\(next\)\)/);
  assert.match(source, /\}, \[activeSessionKey, load\]\)/);
  assert.doesNotMatch(source, /hasCurrentOrdersActor\(/);
});
