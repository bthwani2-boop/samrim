import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript-ast";
import { partnerSetupSessionKey } from "../partner-onboarding/partner-setup-session-scope.ts";

const source = readFileSync(new URL("./notifications-inbox.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("notifications-inbox.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const identity = (subject, sessionId) => ({
  kind: "authenticated", identity: { role: "partner", subject, sessionId },
});

function production(runtime, names) {
  const declarations = new Map();
  let loadBody = "";
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text) {
      declarations.set(node.name.text, node.getText(ast));
    }
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "load" &&
        ts.isCallExpression(node.initializer)) {
      loadBody = node.initializer.arguments[0]?.getText(ast) ?? "";
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  const helpers = ["currentNotificationsSessionKey", "isCurrentNotificationsSession"];
  for (const name of [...helpers, ...names]) assert.ok(declarations.has(name), `missing production function ${name}`);
  const text = [...helpers, ...names].map(name => declarations.get(name)).join("\n") +
    (loadBody ? "\nconst load = " + loadBody + ";" : "") +
    "\n({ " + [...names, ...(loadBody ? ["load"] : [])].join(", ") + " })";
  const code = ts.transpileModule(text, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return runInNewContext(code, { partnerSetupSessionKey, console: { error: () => {} }, ...runtime });
}

function readContext(options = {}) {
  let current = identity("merchant-a", "session-1");
  const sessionKey = partnerSetupSessionKey(current);
  const observed = { items: [], count: -1, owner: "", writes: 0, navigation: 0, refresh: 0, errors: [] };
  const runtime = {
    sessionKey, requestID: { current: 0 },
    currentIdentityState: () => current,
    setLoading: () => {}, setError: value => observed.errors.push(value),
    setItems: value => { observed.items = value; },
    setUnreadCount: value => { observed.count = value; },
    setLoadedSessionKey: value => { observed.owner = value; },
    getUsableIdentityAccessToken: async () => "session-1-token",
    dshClient: () => ({
      listNotifications: async () => ({ notifications: [{ id: "old-private", readAt: null }], unreadCount: 1 }),
      markNotificationRead: async () => { observed.writes++; },
    }),
    setBusy: () => {}, busy: "",
    loadedSessionKey: sessionKey,
    destination: () => "/orders",
    router: { push: () => { observed.navigation++; } },
    stores: [], selectedStore: null, selectStore: () => {},
    ...options,
  };
  return {
    runtime, observed, sessionKey,
    switchSession: () => { current = identity("merchant-a", "session-2"); },
    logout: () => { current = { kind: "unauthenticated" }; },
  };
}

test("same actor, renewed session rejects a notification response that returns late", async () => {
  let resolveResponse;
  let started;
  const called = new Promise(resolve => { started = resolve; });
  const ctx = readContext({
    dshClient: () => ({ listNotifications: () => {
      started();
      return new Promise(resolve => { resolveResponse = resolve; });
    } }),
  });
  const { load } = production(ctx.runtime, []);
  const pending = load();
  await called;
  ctx.switchSession();
  resolveResponse({ notifications: [{ id: "private-previous-session" }], unreadCount: 1 });
  await pending;
  assert.equal(ctx.observed.items.length, 0);
  assert.equal(ctx.observed.count, -1);
  assert.equal(ctx.observed.owner, "");
});

test("renewal after token retrieval prevents requests with stale credentials", async () => {
  let unlockToken;
  let called = 0;
  const ctx = readContext({
    getUsableIdentityAccessToken: () => new Promise(resolve => { unlockToken = resolve; }),
    dshClient: () => ({ listNotifications: async () => { called++; return { notifications: [], unreadCount: 0 }; } }),
  });
  const { load } = production(ctx.runtime, []);
  const pending = load();
  ctx.switchSession();
  unlockToken("previous-session-token");
  await pending;
  assert.equal(called, 0);
  assert.equal(ctx.observed.owner, "");
});

test("current session can load notifications and records the exact owner", async () => {
  const ctx = readContext();
  const { load } = production(ctx.runtime, []);
  await load();
  assert.deepEqual(Array.from(ctx.observed.items, item => item.id), ["old-private"]);
  assert.equal(ctx.observed.count, 1);
  assert.equal(ctx.observed.owner, ctx.sessionKey);
});

test("notification press from a prior same-actor session cannot write or navigate", async () => {
  let unlockToken;
  const ctx = readContext({ getUsableIdentityAccessToken: () => new Promise(resolve => { unlockToken = resolve; }) });
  const { markRead } = production(ctx.runtime, ["markRead"]);
  const task = markRead({ id: "notification-1", readAt: null });
  ctx.switchSession();
  unlockToken("old-token");
  await task;
  assert.equal(ctx.observed.writes, 0);
  assert.equal(ctx.observed.navigation, 0);
});

test("late mark-read confirmation cannot refresh or route to previous session's Store", async () => {
  let resolveWrite;
  let started;
  const called = new Promise(resolve => { started = resolve; });
  const ctx = readContext({
    dshClient: () => ({ markNotificationRead: () => {
      ctx.observed.writes++;
      started();
      return new Promise(resolve => { resolveWrite = resolve; });
    } }),
    load: async () => { ctx.observed.refresh++; },
  });
  const { markRead } = production(ctx.runtime, ["markRead"]);
  const task = markRead({ id: "notification-1", readAt: null });
  await called;
  ctx.switchSession();
  resolveWrite();
  await task;
  assert.equal(ctx.observed.writes, 1, "the write was already sent before renewal");
  assert.equal(ctx.observed.refresh, 0);
  assert.equal(ctx.observed.navigation, 0);
});

test("rendering and interaction fail closed before Identity effect clears old state", () => {
  assert.match(source, /const authenticated = isCurrentNotificationsSession\(sessionKey\)/);
  assert.match(source, /if \(sessionKeyRef.current === nextSessionKey\) return/);
  assert.match(source, /const visibleItems = authenticated && loadedSessionKey === sessionKey \? items : \[\]/);
  assert.match(source, /visibleUnreadCount = authenticated && loadedSessionKey === sessionKey \? unreadCount : 0/);
  assert.match(source, /loading \|\| loadedSessionKey !== sessionKey/);
  assert.match(source, /if \(busy \|\| loadedSessionKey !== sessionKey \|\| !isCurrentNotificationsSession\(sessionKey\)\) return/);
  assert.doesNotMatch(source, /activeActorID/);
});
