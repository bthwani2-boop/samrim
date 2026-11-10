import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript-ast";
import { OrderAlertCursor } from "../../../../../services/dsh/clients/notification-alert-policy.ts";
import { captainSessionKey } from "../../bootstrap/captain-session-scope.ts";

const source = readFileSync(new URL("./order-alert-monitor.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("order-alert-monitor.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const identity = (subject, sessionId) => ({
  kind: "authenticated",
  identity: { role: "captain", subject, sessionId },
});
const notice = id => ({
  id,
  orderId: "delivery-5",
  kind: "CAPTAIN_OFFER",
  title: "طلب توصيل جديد",
  body: "عرض توصيل",
  readAt: null,
  createdAt: new Date(Date.now() - 1_000).toISOString(),
});

function production(name, runtime) {
  let expression = "";
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) {
      expression = node.initializer?.getText(ast) ?? "";
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(expression, `Missing production callback: ${name}`);
  const compiled = ts.transpileModule(
    `const ${name} = ${expression}; ({${name}})`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
  ).outputText;
  return runInNewContext(compiled, runtime)[name];
}

function harness() {
  const state = {
    current: identity("captain-7", "session-1"),
    notifications: [],
    scheduled: [],
    cancelledIds: [],
    requests: 0,
    remotePushActive: false,
  };
  const scheduledSessions = new Map();
  const alerts = new OrderAlertCursor();
  const Notifications = {
    getLastNotificationResponseAsync: async () => null,
    getPermissionsAsync: async () => ({ granted: true }),
    requestPermissionsAsync: async () => ({ granted: true }),
    scheduleNotificationAsync: async options => {
      state.scheduled.push(options);
      return `local-${state.scheduled.length}`;
    },
    cancelScheduledNotificationAsync: async id => { state.cancelledIds.push(id); },
    SchedulableTriggerInputTypes: { TIME_INTERVAL: "timeInterval" },
  };
  const runtime = {
    busy: false,
    cancelled: false,
    permissionRequested: false,
    AppState: { currentState: "active" },
    currentIdentityState: () => state.current,
    captainSessionKey,
    isCurrentAlertSession: key => !!key && captainSessionKey(state.current) === key,
    Notifications,
    ensureChannel: async () => {},
    getUsableIdentityAccessToken: async () => "current-token",
    currentAlertTone: async () => "classic",
    registerOwnPushDevice: async (_token, _actor, _tone, stillCurrent) => {
      assert.equal(stillCurrent(), true);
      return state.remotePushActive;
    },
    createDshMobileClient: () => ({
      listNotifications: async () => {
        state.requests++;
        return { notifications: state.notifications };
      },
    }),
    Crypto: { randomUUID: () => "random-id" },
    process: { env: { EXPO_PUBLIC_DSH_API_URL: "http://mock-only.invalid" } },
    channels: [["classic", "order-classic-v1", "order_classic.wav"]],
    alerts,
    role: "captain",
    scheduledSessions,
    handleResponse: () => {},
    console: { warn: () => {} },
  };
  return { state, runtime, Notifications, scheduledSessions, alerts, tick: production("tick", runtime) };
}

test("foreground alerts baseline once, ring new offers once, and keep session IDs out of payload", async () => {
  const h = harness();
  h.state.notifications = [notice("offer-1")];
  await h.tick();
  assert.equal(h.state.scheduled.length, 0);
  h.state.notifications = [notice("offer-2"), notice("offer-1")];
  await h.tick();
  await h.tick();
  assert.equal(h.state.scheduled.length, 1);
  assert.equal(h.state.scheduled[0].content.data.source, "captain-foreground");
  assert.equal(h.state.scheduled[0].content.data.actorId, "captain-7");
  assert.equal(Object.values(h.state.scheduled[0].content.data).includes("session-1"), false);
  assert.equal(h.scheduledSessions.get("local-1"), captainSessionKey(h.state.current));
});

test("late notification fetch from former same-actor session never rings or primes the new session", async () => {
  const h = harness();
  h.state.notifications = [notice("offer-1")];
  await h.tick();
  let release;
  const delayed = new Promise(resolve => { release = resolve; });
  h.runtime.createDshMobileClient = () => ({
    listNotifications: async () => { h.state.requests++; return delayed; },
  });
  const staleTick = h.tick();
  for (let i = 0; i < 6 && h.state.requests < 2; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.state.requests, 2);
  h.state.current = identity("captain-7", "session-2");
  release({ notifications: [notice("late-offer"), notice("offer-1")] });
  await staleTick;
  assert.equal(h.state.scheduled.length, 0);
  h.runtime.createDshMobileClient = () => ({
    listNotifications: async () => ({ notifications: [notice("late-offer"), notice("offer-1")] }),
  });
  await h.tick();
  assert.equal(h.state.scheduled.length, 0, "new session primes its own baseline");
  h.runtime.createDshMobileClient = () => ({
    listNotifications: async () => ({ notifications: [notice("fresh-session-2"), notice("late-offer")] }),
  });
  await h.tick();
  assert.equal(h.state.scheduled.length, 1, "new session is still allowed to ring fresh offers");
});

test("old local notification taps never navigate after same-actor renewal; valid remote push still works", async () => {
  let current = identity("captain-7", "session-2");
  const navigations = [];
  const cleared = [];
  const prior = captainSessionKey(identity("captain-7", "session-1"));
  const currentKey = captainSessionKey(current);
  const scheduledSessions = new Map([["old-local", prior], ["current-local", currentKey]]);
  const runtime = {
    currentIdentityState: () => current,
    captainSessionKey,
    scheduledSessions,
    openedResponses: new Set(),
    Notifications: { clearLastNotificationResponseAsync: async () => { cleared.push(true); } },
    router: { push: route => navigations.push(route) },
  };
  const handleResponse = production("handleResponse", runtime);
  const response = (id, data) => ({
    notification: { request: { identifier: id, content: { data } } },
  });
  handleResponse(response("old-local", { actorId: "captain-7", orderId: "delivery-5", source: "captain-foreground" }));
  assert.equal(navigations.length, 0);
  handleResponse(response("current-local", { actorId: "captain-7", orderId: "delivery-6", source: "captain-foreground" }));
  handleResponse(response("current-local", { actorId: "captain-7", orderId: "delivery-6", source: "captain-foreground" }));
  assert.equal(navigations.length, 1, "current local notification opens exactly once");
  handleResponse(response("server-push", { actorId: "captain-7", orderId: "delivery-7" }));
  assert.equal(navigations.length, 2, "actor-scoped server Push navigation remains intact");
  current = identity("different-captain", "session-3");
  handleResponse(response("other-actor", { actorId: "captain-7", orderId: "delivery-8" }));
  assert.equal(navigations.length, 2);
  await Promise.resolve();
  assert.ok(cleared.length >= 2);
});

test("a locally scheduled notification completing after logout is cancelled, not retained", async () => {
  const h = harness();
  h.state.notifications = [notice("baseline")];
  await h.tick();
  let release;
  const delayed = new Promise(resolve => { release = resolve; });
  h.Notifications.scheduleNotificationAsync = async options => {
    h.state.scheduled.push(options);
    return delayed;
  };
  h.state.notifications = [notice("new-offer"), notice("baseline")];
  const pending = h.tick();
  for (let i = 0; i < 6 && !h.state.scheduled.length; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.state.scheduled.length, 1);
  h.state.current = { kind: "unauthenticated" };
  release("late-local");
  await pending;
  assert.deepEqual(h.state.cancelledIds, ["late-local"]);
  assert.equal(h.scheduledSessions.size, 0);
});

test("server Push ownership prevents a second audible foreground alert", async () => {
  const h = harness();
  h.state.remotePushActive = true;
  h.state.notifications = [notice("baseline")];
  await h.tick();
  h.state.notifications = [notice("fresh"), notice("baseline")];
  await h.tick();
  assert.equal(h.state.scheduled.length, 0);
});
