import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript-ast";
import { captainSessionKey } from "../../bootstrap/captain-session-scope.ts";

const source = readFileSync(new URL("./notifications-inbox.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("notifications-inbox.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const identity = (subject, sessionId) => ({
  kind: "authenticated",
  identity: { role: "captain", subject, sessionId },
});

function production(names, runtime) {
  const found = new Map();
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text)) {
      found.set(node.name.text, node.getText(ast));
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  for (const name of names) assert.ok(found.has(name), `Missing production function ${name}`);
  const script = ts.transpileModule(
    `${found.values().toArray().join("\n")}\n({${names.join(",")}})`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
  ).outputText;
  return runInNewContext(script, runtime);
}

function productionLoad(runtime) {
  let initializer = "";
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "load" && node.initializer && ts.isCallExpression(node.initializer)) {
      initializer = node.initializer.arguments[0]?.getText(ast) ?? "";
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(initializer, "missing production inbox load callback");
  const compiled = ts.transpileModule(
    `const load = ${initializer}; ({load})`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
  ).outputText;
  return runInNewContext(compiled, runtime).load;
}

test("notification session key requires the same Captain session, not just the same actor", () => {
  let current = identity("captain-a", "session-1");
  const guard = production(["currentInboxSessionKey", "isCurrentInboxSession"], {
    captainSessionKey,
    currentIdentityState: () => current,
  });
  const formerSession = captainSessionKey(current);
  assert.equal(guard.isCurrentInboxSession(formerSession), true);
  current = identity("captain-a", "session-2");
  assert.equal(guard.isCurrentInboxSession(formerSession), false);
  assert.equal(guard.isCurrentInboxSession(captainSessionKey(current)), true);
  current = { kind: "unauthenticated" };
  assert.equal(guard.isCurrentInboxSession(formerSession), false);
});

test("a late inbox read cannot repopulate notifications from the old session", async () => {
  let current = identity("captain-a", "session-1");
  const sessionKey = captainSessionKey(current);
  let resolveRead;
  const readPending = new Promise(resolve => { resolveRead = resolve; });
  let started = false;
  const updates = [];
  const runtime = {
    captainSessionKey, currentIdentityState: () => current, sessionKey,
    requestID: { current: 0 },
    getUsableIdentityAccessToken: async () => "old-token",
    dshClient: () => ({ listNotifications: async () => { started = true; return readPending; } }),
    setLoading: () => {}, setRefreshing: () => {}, setError: () => {},
    setItems: values => updates.push(values),
    setUnreadCount: value => updates.push(value),
    console: { error: () => {} },
  };
  Object.assign(runtime, production(["currentInboxSessionKey", "isCurrentInboxSession"], runtime));
  const load = productionLoad(runtime);
  const pending = load();
  for (let i = 0; i < 4 && !started; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(started, true);
  current = identity("captain-a", "session-2");
  resolveRead({ notifications: [{ id: "old-private" }], unreadCount: 1 });
  await pending;
  assert.equal(updates.length, 0);
});

test("active session still loads its own notifications", async () => {
  const current = identity("captain-a", "session-live");
  const sessionKey = captainSessionKey(current);
  const updates = [];
  const runtime = {
    captainSessionKey, currentIdentityState: () => current, sessionKey,
    requestID: { current: 0 },
    getUsableIdentityAccessToken: async () => "live-token",
    dshClient: () => ({ listNotifications: async () => ({ notifications: [{ id: "live-private" }], unreadCount: 1 }) }),
    setLoading: () => {}, setRefreshing: () => {}, setError: () => {},
    setItems: values => updates.push(values.map(item => item.id)),
    setUnreadCount: value => updates.push(value),
    console: { error: () => {} },
  };
  Object.assign(runtime, production(["currentInboxSessionKey", "isCurrentInboxSession"], runtime));
  await productionLoad(runtime)();
  assert.deepEqual(updates, [["live-private"], 1]);
});

test("a delayed read acknowledgment from an old session cannot navigate to an offer", async () => {
  let current = identity("captain-a", "session-1");
  const sessionKey = captainSessionKey(current);
  let resolveMark;
  const marking = new Promise(resolve => { resolveMark = resolve; });
  let started = false;
  const navigations = [];
  const runtime = {
    captainSessionKey, currentIdentityState: () => current, sessionKey,
    busy: "", authenticated: true,
    getUsableIdentityAccessToken: async () => "old-token",
    dshClient: () => ({ markNotificationRead: async () => { started = true; return marking; } }),
    setBusy: () => {}, setError: () => {}, load: async () => {},
    router: { push: target => navigations.push(target) },
    console: { error: () => {} },
  };
  Object.assign(runtime, production(["currentInboxSessionKey", "isCurrentInboxSession"], runtime));
  const { openNotification } = production(["openNotification"], runtime);
  const pending = openNotification({ id: "notice-1", kind: "CAPTAIN_OFFER", orderId: "order-1", readAt: null });
  for (let i = 0; i < 4 && !started; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(started, true);
  current = identity("captain-a", "session-2");
  resolveMark();
  await pending;
  assert.equal(navigations.length, 0);
});

test("inbox resets and reloads when a Captain renews their session", () => {
  assert.match(source, /const sessionKey = captainSessionKey\(identityState\)/);
  assert.match(source, /const authenticated = isCurrentInboxSession\(sessionKey\)/);
  assert.match(source, /const visibleItems = authenticated \? items : \[\]/);
  assert.match(source, /setIdentityState\(currentIdentityState\(\)\)/);
  assert.match(source, /\}, \[sessionKey\]\)/);
  assert.match(source, /useFocusEffect\(useCallback\(\(\) => \{/);
  assert.doesNotMatch(source, /activeActorID\(\)/);
});

test("Captain notifications reuse the protected Safe Area shell rather than a duplicate auth wrapper", () => {
  const route = readFileSync(new URL("../../../app/notifications.tsx", import.meta.url), "utf8");
  const wrapper = readFileSync(new URL("../../shell/captain-protected-screen.tsx", import.meta.url), "utf8");
  assert.match(route, /<CaptainProtectedScreen>/);
  assert.match(route, /<CaptainScrollScreen>/);
  assert.match(route, /<NotificationsInbox \/>/);
  assert.match(route, /<OrderAlertPreferences currentIdentityState=\{currentIdentityState\} subscribeIdentitySession=\{subscribeIdentitySession\} \/>/);
  assert.match(wrapper, /SafeAreaView edges=\{\["top"\]\}/);
  assert.doesNotMatch(route, /AuthenticatedMobileBoundary|useRouter\(/);
});
