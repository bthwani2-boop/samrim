import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript-ast";
import { partnerSetupSessionKey } from "../partner-onboarding/partner-setup-session-scope.ts";

const source = readFileSync(new URL("./order-alert-monitor.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("order-alert-monitor.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
assert.equal(ast.parseDiagnostics.length, 0);

function production(runtime) {
  let helper = "";
  const arrows = new Map();
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "isCurrentAlertSession") {
      helper = node.getText(ast);
    }
    if (ts.isVariableDeclaration(node) && ["tick", "handleResponse"].includes(node.name.getText(ast))) {
      assert.ok(ts.isArrowFunction(node.initializer));
      arrows.set(node.name.getText(ast), node.initializer.getText(ast));
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(helper && arrows.size === 2, "read the actual production partner monitor callbacks");
  const program = helper + "\nlet busy = false; let cancelled = false; let permissionRequested = false;\n" +
    "const openedResponses = new Set(); const scheduledSessions = new Map();\n" +
    "const handleResponse = " + arrows.get("handleResponse") + ";\n" +
    "const tick = " + arrows.get("tick") + ";\n({ tick, handleResponse, scheduledSessions })";
  const compiled = ts.transpileModule(program, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return runInNewContext(compiled, { partnerSetupSessionKey, ...runtime });
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function harness({ urgent = true, remotePushActive = false } = {}) {
  let identity = { kind: "authenticated", identity: { role: "partner", subject: "partner-a", sessionId: "session-one" } };
  const state = { registered: 0, requested: 0, scopes: [], scheduled: [], cancelled: [], cleared: 0, routes: [] };
  const alert = { id: "new-order", orderId: "order-1", title: "طلب جديد", body: "طلب متجر", readAt: null, kind: "ORDER_CREATED", createdAt: new Date().toISOString() };
  const Notifications = {
    getLastNotificationResponseAsync: async () => null,
    getPermissionsAsync: async () => ({ granted: true }),
    requestPermissionsAsync: async () => ({ granted: true }),
    scheduleNotificationAsync: async payload => { state.scheduled.push(payload); return "local-alert"; },
    cancelScheduledNotificationAsync: async id => { state.cancelled.push(id); },
    clearLastNotificationResponseAsync: async () => { state.cleared++; },
    SchedulableTriggerInputTypes: { TIME_INTERVAL: "timeInterval" },
  };
  const runtime = {
    currentIdentityState: () => identity,
    getUsableIdentityAccessToken: async () => "valid-token",
    AppState: { currentState: "active" },
    process: { env: { EXPO_PUBLIC_DSH_API_URL: "http://isolated.invalid" } },
    Crypto: { randomUUID: () => "uuid" },
    Notifications,
    ensureChannel: async () => {},
    currentAlertTone: async () => "classic",
    registerOwnPushDevice: async (_token, _actor, _tone, stillCurrent) => {
      assert.equal(stillCurrent(), true);
      state.registered++;
      return remotePushActive;
    },
    createDshMobileClient: () => ({ listNotifications: async () => { state.requested++; return { notifications: [alert] }; } }),
    alerts: { reset: () => {}, receive: (_role, scope) => { state.scopes.push(scope); return urgent ? [alert] : []; } },
    channels: [["classic", "order-classic-v1", "order_classic.wav"]],
    role: "partner",
    router: { push: target => state.routes.push(target) },
    console: { warn: () => {} },
  };
  return {
    state, runtime, Notifications,
    renew: () => { identity = { ...identity, identity: { ...identity.identity, sessionId: "session-two" } }; },
    logout: () => { identity = { kind: "unauthenticated" }; },
    owner: () => partnerSetupSessionKey(identity),
  };
}

function response(id, data) {
  return { notification: { request: { identifier: id, content: { data } } } };
}

test("the Partner alert cursor and Push registration use one exact Identity session", async () => {
  const h = harness();
  const { tick } = production(h.runtime);
  await tick();
  assert.equal(h.state.registered, 1);
  assert.equal(h.state.requested, 1);
  assert.deepEqual(h.state.scopes, [h.owner()]);
  assert.equal(h.state.scheduled[0].content.data.source, "partner-foreground");
  assert.equal(h.state.scheduled[0].content.data.sessionId, undefined);
});

test("renewing the same Partner while token read is pending rejects old registration", async () => {
  const h = harness();
  const entered = deferred();
  const released = deferred();
  h.runtime.getUsableIdentityAccessToken = async () => { entered.resolve(); return released.promise; };
  const { tick } = production(h.runtime);
  const pending = tick();
  await entered.promise;
  h.renew();
  released.resolve("old-token");
  await pending;
  assert.equal(h.state.registered, 0);
  assert.equal(h.state.requested, 0);
});

test("renewing the same Partner during a DSH read cannot prime or schedule old alerts", async () => {
  const h = harness();
  const entered = deferred();
  const released = deferred();
  h.runtime.createDshMobileClient = () => ({ listNotifications: async () => {
    h.state.requested++;
    entered.resolve();
    return released.promise;
  } });
  const { tick } = production(h.runtime);
  const pending = tick();
  await entered.promise;
  h.renew();
  released.resolve({ notifications: [] });
  await pending;
  assert.deepEqual(h.state.scopes, []);
  assert.deepEqual(h.state.scheduled, []);
});

test("an OS schedule completing after Partner logout is cancelled before storing ownership", async () => {
  const h = harness();
  const entered = deferred();
  const released = deferred();
  h.Notifications.scheduleNotificationAsync = async options => {
    h.state.scheduled.push(options);
    entered.resolve();
    return released.promise;
  };
  const { tick, scheduledSessions } = production(h.runtime);
  const pending = tick();
  await entered.promise;
  h.logout();
  released.resolve("late-local");
  await pending;
  assert.deepEqual(h.state.cancelled, ["late-local"]);
  assert.equal(scheduledSessions.size, 0);
});

test("a previous same-actor local tap is refused; current remote Push still routes", async () => {
  const h = harness();
  const { tick, handleResponse } = production(h.runtime);
  await tick();
  h.renew();
  handleResponse(response("local-alert", h.state.scheduled[0].content.data));
  assert.equal(h.state.routes.length, 0);
  assert.equal(h.state.cleared, 1);
  handleResponse(response("remote-alert", { actorId: "partner-a", orderId: "order-2" }));
  assert.equal(h.state.routes.length, 1);
  assert.equal(h.state.routes[0].pathname, "/orders");
  assert.equal(h.state.routes[0].params.orderId, "order-2");
});

test("remote Push ownership suppresses a duplicate local foreground bell", async () => {
  const h = harness({ remotePushActive: true });
  await production(h.runtime).tick();
  assert.equal(h.state.registered, 1);
  assert.equal(h.state.scheduled.length, 0);
});
