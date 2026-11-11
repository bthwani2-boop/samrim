import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript-ast";
import { clientSessionKey } from "../access/client-session-scope.ts";
import { clientPushDestination } from "./notification-tap-destination.ts";

const source = readFileSync(new URL("./order-alert-monitor.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("order-alert-monitor.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const actor = (sessionId, subject = "client-a") =>
  ({ kind: "authenticated", identity: { role: "client", subject, sessionId } });

function production(runtime) {
  let helper = "";
  const arrows = new Map();
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "isCurrentAlertSession") {
      helper = node.getText(ast);
    }
    if (ts.isVariableDeclaration(node) && ["tick", "handleResponse"].includes(node.name.getText(ast))) {
      assert.ok(ts.isArrowFunction(node.initializer), "production callback must remain arrow function");
      arrows.set(node.name.getText(ast), node.initializer.getText(ast));
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(helper && arrows.size === 2, "source monitor callbacks are missing");
  const program = helper + "\nlet busy = false; let cancelled = false; let permissionRequested = false;\n" +
    "const openedResponses = new Set(); const scheduledSessions = new Map();\n" +
    "const handleResponse = " + arrows.get("handleResponse") + ";\n" +
    "const tick = " + arrows.get("tick") + ";\n({ tick, handleResponse, scheduledSessions })";
  const js = ts.transpileModule(program, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return runInNewContext(js, { clientSessionKey, clientPushDestination, ...runtime });
}

function harness(options = {}) {
  let identity = actor("session-1");
  const owner = clientSessionKey(identity);
  const observed = { requested: 0, registered: 0, cursors: [], resets: [], scheduled: [],
    cancelled: [], cleared: 0, routes: [] };
  const latest = { id: "alert-1", orderId: "order-1", title: "Arrived",
    body: "Delivery status", readAt: null, kind: "CAPTAIN_ARRIVED", createdAt: new Date().toISOString() };
  const api = { listNotifications: async () => {
    observed.requested++;
    return { notifications: [latest] };
  } };
  const notifications = {
    getLastNotificationResponseAsync: async () => null,
    getPermissionsAsync: async () => ({ granted: true }),
    requestPermissionsAsync: async () => ({ granted: true }),
    scheduleNotificationAsync: async payload => {
      observed.scheduled.push(payload);
      return "local-alert-1";
    },
    cancelScheduledNotificationAsync: async id => { observed.cancelled.push(id); },
    clearLastNotificationResponseAsync: async () => { observed.cleared++; },
    SchedulableTriggerInputTypes: { TIME_INTERVAL: "timeInterval" },
  };
  const runtime = {
    currentIdentityState: () => identity,
    getUsableIdentityAccessToken: async () => "session-1-token",
    process: { env: { EXPO_PUBLIC_DSH_API_URL: "http://dsh.invalid" } },
    AppState: { currentState: "active" },
    Crypto: { randomUUID: () => "uuid" },
    Notifications: notifications,
    ensureChannel: async () => {},
    currentAlertTone: async () => "classic",
    registerOwnPushDevice: async (_token, _actor, _tone, stillCurrent) => {
      observed.registered++;
      assert.equal(stillCurrent(), true);
      return Boolean(options.remoteActive);
    },
    createClientDsh: () => api,
    alerts: {
      reset: key => observed.resets.push(key),
      receive: (_role, key) => {
        observed.cursors.push(key);
        return options.urgent ? [latest] : [];
      },
    },
    channels: [["classic", "order-classic-v1", "order_classic.wav"]],
    role: "client",
    router: { push: path => observed.routes.push(path) },
    console: { warn: () => {} },
    ...options.runtime,
  };
  return {
    runtime, observed, notifications, api, owner,
    renew: () => { identity = actor("session-2"); },
    switchActor: () => { identity = actor("session-1", "client-b"); },
    logout: () => { identity = { kind: "signed_out" }; },
  };
}

function response(id, data) {
  return { notification: { request: { identifier: id, content: { data } } } };
}

test("foreground poll uses canonical Identity session, not just actor, for the cursor", async () => {
  const x = harness();
  const { tick } = production(x.runtime);
  await tick();
  assert.equal(x.observed.registered, 1);
  assert.equal(x.observed.requested, 1);
  assert.deepEqual(x.observed.cursors, [x.owner]);
});

test("same actor renewed before token completes cannot register old credentials or fetch", async () => {
  let unlock;
  let started;
  const tokenRequested = new Promise(resolve => { started = resolve; });
  const x = harness({ runtime: {
    getUsableIdentityAccessToken: () => {
      started();
      return new Promise(resolve => { unlock = resolve; });
    },
  } });
  const { tick } = production(x.runtime);
  const pending = tick();
  await tokenRequested;
  x.renew();
  unlock("old-token");
  await pending;
  assert.equal(x.observed.registered, 0);
  assert.equal(x.observed.requested, 0);
});

test("late inbox response for an old same-actor session does not prime or schedule alerts", async () => {
  let finish;
  let started;
  const called = new Promise(resolve => { started = resolve; });
  const x = harness({ urgent: true });
  x.api.listNotifications = () => {
    x.observed.requested++;
    started();
    return new Promise(resolve => { finish = resolve; });
  };
  const { tick } = production(x.runtime);
  const pending = tick();
  await called;
  x.renew();
  finish({ notifications: [] });
  await pending;
  assert.equal(x.observed.cursors.length, 0);
  assert.equal(x.observed.scheduled.length, 0);
});

test("local alert scheduled in one session cannot navigate after same-actor renewal", async () => {
  const x = harness({ urgent: true });
  const { tick, handleResponse } = production(x.runtime);
  await tick();
  assert.equal(x.observed.scheduled.length, 1);
  const data = x.observed.scheduled[0].content.data;
  assert.equal(data.actorId, "client-a");
  assert.equal(data.source, "client-foreground");
  assert.equal(data.sessionId, undefined, "never put Identity session ID in OS payload");
  x.renew();
  handleResponse(response("local-alert-1", data));
  await Promise.resolve();
  assert.equal(x.observed.routes.length, 0);
  assert.equal(x.observed.cleared, 1);
});

test("same-session local tap and legacy server push retain existing safe order routing", async () => {
  const x = harness({ urgent: true });
  const { tick, handleResponse } = production(x.runtime);
  await tick();
  handleResponse(response("local-alert-1", x.observed.scheduled[0].content.data));
  handleResponse(response("server-push-1", { actorId: "client-a", orderId: "order-2" }));
  assert.deepEqual(x.observed.routes, ["/orders/order-1", "/orders/order-2"]);
});

test("old local notification scheduling completion after renewal cancels that alert", async () => {
  let completeSchedule;
  let started;
  const scheduled = new Promise(resolve => { started = resolve; });
  const x = harness({ urgent: true });
  x.notifications.scheduleNotificationAsync = async payload => {
    x.observed.scheduled.push(payload);
    started();
    return new Promise(resolve => { completeSchedule = resolve; });
  };
  const { tick } = production(x.runtime);
  const pending = tick();
  await scheduled;
  x.renew();
  completeSchedule("late-local-alert");
  await pending;
  assert.deepEqual(x.observed.cancelled, ["late-local-alert"]);
});

test("remote push delivery owns alerts and suppresses duplicate local foreground bell", async () => {
  const x = harness({ urgent: true, remoteActive: true });
  const { tick } = production(x.runtime);
  await tick();
  assert.equal(x.observed.cursors.length, 1);
  assert.equal(x.observed.scheduled.length, 0);
});

test("logged out Client cannot fetch and clears the alert cursor", async () => {
  const x = harness();
  x.logout();
  const { tick } = production(x.runtime);
  await tick();
  assert.equal(x.observed.requested, 0);
  assert.deepEqual(x.observed.resets, [""]);
});

test("strictly reject cross-actor push and preserve canonical destination validation", () => {
  const x = harness();
  const { handleResponse } = production(x.runtime);
  handleResponse(response("wrong-actor", { actorId: "client-b", orderId: "order-1" }));
  handleResponse(response("unsafe-id", { actorId: "client-a", orderId: "../admin" }));
  assert.equal(x.observed.routes.length, 0);
});

test("source matches canonical Client session and retains actor-only remote Push payload compatibility", () => {
  assert.match(source, /const sessionKey = clientSessionKey\(session\)/);
  assert.match(source, /const stillCurrent = \(\) => !cancelled && AppState\.currentState === "active" && isCurrentAlertSession\(sessionKey\)/);
  assert.match(source, /alerts\.receive\(role, sessionKey, data\.notifications\)/);
  assert.match(source, /scheduledSessions\.get\(result\.notification\.request\.identifier\) !== clientSessionKey\(session\)/);
  assert.match(source, /cancelScheduledNotificationAsync\(notificationId\)/);
  assert.doesNotMatch(source, /data: \{[^}]*sessionId/);
  assert.notEqual(clientSessionKey(actor("session-1")), clientSessionKey(actor("session-2")));
});
