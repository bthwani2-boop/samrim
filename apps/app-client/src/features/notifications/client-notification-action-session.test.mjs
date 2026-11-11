import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript-ast";
import { clientSessionKey } from "../access/client-session-scope.ts";

const source = readFileSync(new URL("./client-notification-action.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("client-notification-action.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const actor = (sessionId, subject = "client-a") =>
  ({ kind: "authenticated", identity: { role: "client", subject, sessionId } });

function production(runtime) {
  let helper = "";
  let focused = "";
  let identityEffect = "";
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "currentClientNotificationSessionKey") {
      helper = node.getText(ast);
    }
    if (ts.isCallExpression(node) && node.expression.getText(ast) === "useFocusEffect") {
      const wrapped = node.arguments[0];
      assert.ok(ts.isCallExpression(wrapped) && wrapped.expression.getText(ast) === "useCallback");
      focused = wrapped.arguments[0].getText(ast);
    }
    if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect") {
      identityEffect = node.arguments[0].getText(ast);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(helper && focused && identityEffect, "production callbacks must be present");
  const text = helper + "\nconst focus = " + focused + ";\nconst identityEffect = " + identityEffect +
    ";\n({ focus, identityEffect })";
  const js = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return runInNewContext(js, { clientSessionKey, ...runtime });
}

async function flush() {
  await new Promise(resolve => setImmediate(resolve));
}

function fixture(overrides = {}) {
  let identity = actor("session-1");
  let eventListener;
  const observed = { unread: [], owner: [], requests: 0 };
  const requestID = { current: 0 };
  const sessionKey = clientSessionKey(identity);
  const sessionKeyRef = { current: sessionKey };
  const api = {
    listNotifications: async () => { observed.requests++; return { unreadCount: 4 }; },
    listClientShares: async () => ({ unreadCount: 2 }),
  };
  const runtime = {
    sessionKey, sessionKeyRef, loadedSessionKey: "",
    requestID, setUnreadCount: value => { observed.unread.push(value); },
    setLoadedSessionKey: value => { observed.owner.push(value); },
    setSessionKey: () => {},
    currentIdentityState: () => identity,
    subscribeIdentitySession: callback => { eventListener = callback; return () => {}; },
    getUsableIdentityAccessToken: async () => "token-session-1",
    process: { env: { EXPO_PUBLIC_DSH_API_URL: "http://dsh.invalid" } },
    createClientDsh: () => api,
    Crypto: { randomUUID: () => "random" },
    ...overrides,
  };
  return {
    runtime, api, observed, sessionKey, requestID,
    renew: () => { identity = actor("session-2"); },
    changeActor: () => { identity = actor("session-1", "client-b"); },
    tokenRefresh: () => { identity = actor("session-1"); },
    notify: () => { assert.ok(eventListener); eventListener(); },
  };
}

test("current Identity session loads server unread count plus shares into exact owner", async () => {
  const x = fixture();
  const { focus } = production(x.runtime);
  focus();
  await flush();
  assert.deepEqual(x.observed.unread, [6]);
  assert.deepEqual(x.observed.owner, [x.sessionKey]);
});

test("same-actor renewed session before token completion cannot send old-token DSH requests", async () => {
  let unlock;
  const x = fixture({ getUsableIdentityAccessToken: () => new Promise(resolve => { unlock = resolve; }) });
  const { focus } = production(x.runtime);
  focus();
  x.renew();
  unlock("old-token");
  await flush();
  assert.equal(x.observed.requests, 0);
  assert.deepEqual(x.observed.unread, []);
});

test("late first-page and shares replies cannot change badge for a renewed same actor", async () => {
  let finish;
  let started;
  const called = new Promise(resolve => { started = resolve; });
  const x = fixture();
  x.api.listNotifications = async () => {
    x.observed.requests++;
    started();
    return new Promise(resolve => { finish = resolve; });
  };
  const { focus } = production(x.runtime);
  focus();
  await called;
  x.renew();
  finish({ unreadCount: 40 });
  await flush();
  assert.deepEqual(x.observed.unread, []);
  assert.deepEqual(x.observed.owner, []);
});

test("identity subscription skips same-session token refresh but resets on session renewal", async () => {
  const x = fixture();
  const { identityEffect } = production(x.runtime);
  identityEffect();
  x.tokenRefresh();
  x.notify();
  assert.equal(x.requestID.current, 0, "token refresh must not clear the same session");
  x.renew();
  x.notify();
  assert.equal(x.requestID.current, 1);
  assert.deepEqual(x.observed.unread, [0]);
  assert.deepEqual(x.observed.owner, [""]);
});

test("private badge and accessibility count fail closed even before Identity effects run", () => {
  assert.match(source, /loadedSessionKey === sessionKey && currentClientNotificationSessionKey\(\) === sessionKey \? unreadCount : 0/);
  assert.match(source, /label=\{visibleUnreadCount \?/);
  assert.match(source, /\{visibleUnreadCount > 0 \?/);
  assert.doesNotMatch(source, /currentClientActorID|setActorID/);
  assert.notEqual(clientSessionKey(actor("session-1")), clientSessionKey(actor("session-2")));
});
