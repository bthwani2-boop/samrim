import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript-ast";
import { captainSessionKey } from "../../bootstrap/captain-session-scope.ts";

const background = readFileSync(new URL("./captain-mission-location-background.ts", import.meta.url), "utf8");
const foreground = readFileSync(new URL("./captain-mission-location-publisher.tsx", import.meta.url), "utf8");
const B = ts.createSourceFile("background.ts", background, ts.ScriptTarget.Latest, true);
const F = ts.createSourceFile("foreground.tsx", foreground, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const identity = (sessionId, actor = "captain-7") => ({
  kind: "authenticated", identity: { role: "captain", subject: actor, sessionId },
});
const flush = async () => {
  for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve));
};
const requestedScope = state => ({
  actor: state.identity.subject, assignment: "assignment-1", sessionKey: captainSessionKey(state),
});

function compile(expressions, runtime) {
  const js = ts.transpileModule(expressions.join("\n"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return runInNewContext(js, runtime);
}

function backgroundFunctions(runtime) {
  const names = ["activeScope", "sameScope", "getScope", "scopeIsCurrent", "setBackgroundMissionConsent", "reconcileBackgroundMissionLocation"];
  const texts = [];
  for (const statement of B.statements) {
    if (ts.isFunctionDeclaration(statement) && names.includes(statement.name?.text)) {
      texts.push(statement.getText(B).replace(/^export\s+/, ""));
    }
  }
  assert.equal(texts.length, names.length, "all production background scope functions found");
  texts.push(`({ ${names.join(", ")} })`);
  return compile(texts, runtime);
}

function headlessTask(runtime) {
  let arrow = "";
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(B).includes("defineTask")) {
      arrow = node.arguments[1]?.getText(B) ?? "";
    }
    ts.forEachChild(node, visit);
  }
  visit(B);
  assert.ok(arrow, "native TaskManager callback not found");
  return compile([`const task = ${arrow}; ({task})`], runtime).task;
}

function foregroundEffect(runtime) {
  let arrow = "";
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(F) === "useEffect") {
      arrow = node.arguments[0]?.getText(F) ?? "";
    }
    ts.forEachChild(node, visit);
  }
  visit(F);
  assert.ok(arrow, "foreground publisher effect not found");
  return compile([`const effect = ${arrow}; ({effect})`], runtime).effect;
}

function nativeHarness() {
  const state = {
    current: identity("session-1"), storage: new Map(), started: false, stops: 0,
    posts: [], assignments: 0, taskReads: 0, consent: true, running: false,
  };
  const key = "bthwani.captain.mission.background.scope.v1";
  const enabledKey = "bthwani.captain.mission.background.enabled.v1";
  const runtime = {
    SCOPE_KEY: key,
    ENABLED_KEY: enabledKey,
    MISSION_LOCATION_TASK: "bthwani-captain-mission-background-v1",
    currentIdentityState: () => state.current,
    captainSessionKey,
    TaskManager: { defineTask: () => {} },
    AppState: { currentState: "active" },
    Platform: { OS: "android" },
    Location: {
      Accuracy: { Balanced: 3 },
      getForegroundPermissionsAsync: async () => ({ granted: true }),
      getBackgroundPermissionsAsync: async () => ({ granted: true }),
      hasServicesEnabledAsync: async () => true,
      startLocationUpdatesAsync: async () => { state.started = true; state.running = true; },
      requestBackgroundPermissionsAsync: async () => ({ granted: true }),
    },
    SecureStore: {
      getItemAsync: async keyName => state.storage.get(keyName) ?? null,
      setItemAsync: async (keyName, value) => { state.storage.set(keyName, value); },
      deleteItemAsync: async keyName => { state.storage.delete(keyName); },
    },
    hasBackgroundMissionConsent: async () => state.consent,
    backgroundMissionRunning: async () => state.running,
    stopBackgroundMissionLocation: async () => {
      state.stops++;
      state.running = false;
      state.storage.delete(key);
    },
    restoreIdentitySession: async () => state.current,
    getUsableIdentityAccessToken: async () => "authorized-token",
    captainClient: () => ({
      listOwnCaptainAssignments: async () => {
        state.assignments++;
        return { assignments: [{ id: "assignment-1", state: "assigned" }] };
      },
      readOwnCaptainDeliveryTask: async () => {
        state.taskReads++;
        return { task: { fulfillmentMode: "BTHWANI_CAPTAIN" } };
      },
    }),
    fetch: async (...args) => { state.posts.push(args); return { status: 200 }; },
    AbortSignal: { timeout: () => ({}) },
    process: { env: { EXPO_PUBLIC_DSH_API_URL: "https://fake.invalid/" } },
  };
  Object.assign(runtime, backgroundFunctions(runtime));
  return { state, runtime, task: headlessTask(runtime), scopeKey: key, enabledKey };
}

test("native active scope requires a canonical authenticated Captain session", async () => {
  const h = nativeHarness();
  const scope = h.runtime.activeScope("captain-7", "assignment-1");
  assert.equal(scope?.sessionKey, captainSessionKey(h.state.current));
  assert.equal(h.runtime.activeScope("captain-8", "assignment-1"), null);
  h.state.current = { kind: "signed_out", reason: "explicit_logout" };
  assert.equal(h.runtime.activeScope("captain-7", "assignment-1"), null);
});

test("legacy actor-only encrypted scope fails closed without clearing consent", async () => {
  const h = nativeHarness();
  h.state.storage.set(h.scopeKey, JSON.stringify({ actor: "captain-7", assignment: "assignment-1" }));
  h.state.storage.set(h.enabledKey, JSON.stringify({ actor: "captain-7", assignment: "assignment-1" }));
  assert.equal(await h.runtime.getScope(), null);
  await h.task({ data: { locations: [{ coords: { latitude: 15.35, longitude: 44.2 }, timestamp: Date.now() }] } });
  assert.equal(h.state.stops, 1);
  assert.equal(h.state.posts.length, 0);
  assert.ok(h.state.storage.has(h.enabledKey), "user-approved actor+assignment consent retained");
});

test("native reconciliation persists session scope for a consented mission", async () => {
  const h = nativeHarness();
  assert.equal(await h.runtime.reconcileBackgroundMissionLocation("captain-7", "assignment-1"), true);
  const saved = await h.runtime.getScope();
  assert.equal(saved?.sessionKey, captainSessionKey(h.state.current));
  assert.equal(saved?.actor, "captain-7");
  assert.equal(saved?.assignment, "assignment-1");
  assert.equal(h.state.started, true);
});

test("same-actor session change during native permissions does not start background GPS", async () => {
  const h = nativeHarness();
  let resolvePermission;
  let waiting = false;
  const delayed = new Promise(resolve => { resolvePermission = resolve; });
  h.runtime.Location.getBackgroundPermissionsAsync = async () => {
    waiting = true;
    return delayed;
  };
  const promise = h.runtime.reconcileBackgroundMissionLocation("captain-7", "assignment-1");
  for (let i = 0; i < 8 && !waiting; i++) await flush();
  assert.equal(waiting, true);
  h.state.current = identity("session-2");
  resolvePermission({ granted: true });
  assert.equal(await promise, false);
  assert.equal(h.state.started, false);
  assert.equal(h.state.storage.has(h.scopeKey), false);
});

test("headless native task never sends location when same actor has a different session", async () => {
  const h = nativeHarness();
  h.state.storage.set(h.scopeKey, JSON.stringify(requestedScope(h.state.current)));
  h.state.current = identity("session-2");
  await h.task({ data: { locations: [{ coords: { latitude: 15.35, longitude: 44.2 }, timestamp: Date.now() }] } });
  assert.equal(h.state.posts.length, 0);
  assert.equal(h.state.assignments, 0);
  assert.equal(h.state.stops, 1);
});

test("headless native task rejects a replaced session after assignment read", async () => {
  const h = nativeHarness();
  h.state.storage.set(h.scopeKey, JSON.stringify(requestedScope(h.state.current)));
  let release;
  let began = false;
  const delayed = new Promise(resolve => { release = resolve; });
  h.runtime.captainClient = () => ({
    listOwnCaptainAssignments: async () => { began = true; return delayed; },
    readOwnCaptainDeliveryTask: async () => { h.state.taskReads++; return { task: { fulfillmentMode: "BTHWANI_CAPTAIN" } }; },
  });
  const pending = h.task({ data: { locations: [{ coords: { latitude: 15.35, longitude: 44.2 }, timestamp: Date.now() }] } });
  for (let i = 0; i < 8 && !began; i++) await flush();
  assert.equal(began, true);
  h.state.current = identity("session-2");
  release({ assignments: [{ id: "assignment-1", state: "assigned" }] });
  await pending;
  assert.equal(h.state.taskReads, 0);
  assert.equal(h.state.posts.length, 0);
});

test("native task posts only the latest valid authorized mission GPS fix", async () => {
  const h = nativeHarness();
  h.state.storage.set(h.scopeKey, JSON.stringify(requestedScope(h.state.current)));
  const now = Date.now();
  await h.task({ data: { locations: [
    { coords: { latitude: 15.2, longitude: 44.1 }, timestamp: now - 20_000 },
    { coords: { latitude: 15.35, longitude: 44.2, accuracy: 5 }, timestamp: now },
  ] } });
  assert.equal(h.state.posts.length, 1);
  const [url, request] = h.state.posts[0];
  assert.match(url, /\/dsh\/captains\/me\/assignments\/assignment-1\/mission-location$/);
  assert.equal(request.headers.Authorization, "Bearer authorized-token");
  const body = JSON.parse(request.body);
  assert.equal(body.latitude, 15.35);
  assert.equal(body.longitude, 44.2);
  assert.equal(body.accuracyMeters, 5);
  assert.equal(h.state.taskReads, 1);
});

function foregroundHarness() {
  const state = {
    current: identity("session-1"), watchers: [], cleanupCount: 0,
    posts: [], backgroundStops: 0, consentReads: 0, assignmentsRead: 0,
    identityListener: null,
  };
  const runtime = {
    currentIdentityState: () => state.current,
    captainSessionKey,
    AppState: {
      currentState: "active",
      addEventListener: () => ({ remove: () => {} }),
    },
    Location: {
      Accuracy: { Balanced: 3 },
      getForegroundPermissionsAsync: async () => ({ granted: true }),
      watchPositionAsync: async (_options, onPosition) => {
        const record = { onPosition, removed: false };
        state.watchers.push(record);
        return { remove: () => { record.removed = true; state.cleanupCount++; } };
      },
    },
    captainClient: () => ({
      listOwnCaptainAssignments: async () => {
        state.assignmentsRead++;
        return { assignments: [{ id: "assignment-1", state: "assigned" }] };
      },
      readOwnCaptainDeliveryTask: async () => ({ task: { fulfillmentMode: "BTHWANI_CAPTAIN" } }),
    }),
    getUsableIdentityAccessToken: async () => "test-token",
    reconcileBackgroundMissionLocation: async () => { state.consentReads++; return false; },
    stopBackgroundMissionLocation: async () => { state.backgroundStops++; },
    subscribeIdentitySession: callback => {
      state.identityListener = callback;
      return () => { state.identityListener = null; };
    },
    AbortController,
    setTimeout, clearTimeout,
    setInterval: () => 5,
    clearInterval: () => {},
    fetch: async (...args) => { state.posts.push(args); return { ok: true, status: 200 }; },
    process: { env: { EXPO_PUBLIC_DSH_API_URL: "https://fake.invalid/" } },
  };
  const cleanup = foregroundEffect(runtime)();
  return { state, runtime, cleanup };
}

test("foreground mission watcher rejects callbacks from old same-actor session", async () => {
  const h = foregroundHarness();
  await flush();
  assert.equal(h.state.watchers.length, 1);
  const old = h.state.watchers[0];
  h.state.current = identity("session-2");
  h.state.identityListener?.(h.state.current);
  old.onPosition({ coords: { latitude: 15.36, longitude: 44.19 }, timestamp: Date.now() });
  await flush();
  assert.equal(h.state.posts.length, 0);
  assert.equal(old.removed, true);
  assert.ok(h.state.backgroundStops > 0);
  assert.equal(h.state.watchers.length >= 2, true, "new session is rediscovered");
  h.cleanup();
});

test("foreground mission waits for token and never sends a former session fix", async () => {
  const h = foregroundHarness();
  await flush();
  let release;
  let began = false;
  const delayed = new Promise(resolve => { release = resolve; });
  h.runtime.getUsableIdentityAccessToken = async () => { began = true; return delayed; };
  h.state.watchers[0].onPosition({ coords: { latitude: 15.36, longitude: 44.19 }, timestamp: Date.now() });
  for (let i = 0; i < 8 && !began; i++) await flush();
  assert.equal(began, true);
  h.state.current = identity("session-2");
  h.state.identityListener?.(h.state.current);
  release("old-token");
  await flush();
  assert.equal(h.state.posts.length, 0);
  h.cleanup();
});

test("native consent and mission lifecycle still use their existing owners", () => {
  assert.match(background, /hasBackgroundMissionConsent\(scope\.actor, scope\.assignment\)/);
  assert.match(background, /Location\.requestBackgroundPermissionsAsync\(\)/);
  assert.match(background, /TaskManager\?\.defineTask/);
  assert.match(background, /Location\.stopLocationUpdatesAsync\(MISSION_LOCATION_TASK\)/);
  assert.match(background, /const fix = data\.locations\[data\.locations\.length - 1\]/);
  assert.match(foreground, /subscribeIdentitySession/);
  assert.match(foreground, /stopBackgroundMissionLocation\(false\)/);
  assert.doesNotMatch(background, /movementTrail|client\/orders\/|customerDestination/);
});

test("background consent cannot be persisted by the former same-actor session", async () => {
  const h = nativeHarness();
  let release;
  let requesting = false;
  const pendingPermission = new Promise(resolve => { release = resolve; });
  h.runtime.Location.requestBackgroundPermissionsAsync = async () => {
    requesting = true;
    return pendingPermission;
  };
  const changing = h.runtime.setBackgroundMissionConsent(true, "captain-7", "assignment-1");
  for (let i = 0; i < 8 && !requesting; i++) await flush();
  assert.equal(requesting, true);
  h.state.current = identity("session-2");
  release({ granted: true });
  await assert.rejects(changing, /CAPTAIN_MISSION_SESSION_CHANGED/);
  assert.equal(h.state.storage.has(h.enabledKey), false);
});

test("late native registration after session renewal shuts down the former active scope", async () => {
  const h = nativeHarness();
  let release;
  let starting = false;
  const pendingRegistration = new Promise(resolve => { release = resolve; });
  h.runtime.Location.startLocationUpdatesAsync = async () => {
    starting = true;
    h.state.running = true;
    return pendingRegistration;
  };
  const reconciling = h.runtime.reconcileBackgroundMissionLocation("captain-7", "assignment-1");
  for (let i = 0; i < 8 && !starting; i++) await flush();
  assert.equal(starting, true);
  h.state.current = identity("session-2");
  release();
  assert.equal(await reconciling, false);
  assert.equal(h.state.stops, 1);
  assert.equal(h.state.storage.has(h.scopeKey), false);
});

test("foreground mission aborts the former session's in-flight GPS request", async () => {
  const h = foregroundHarness();
  await flush();
  let release;
  let sent = false;
  const pendingResponse = new Promise(resolve => { release = resolve; });
  h.runtime.fetch = async (...args) => {
    h.state.posts.push(args);
    sent = true;
    return pendingResponse;
  };
  h.state.watchers[0].onPosition({
    coords: { latitude: 15.36, longitude: 44.19, accuracy: 10 }, timestamp: Date.now(),
  });
  for (let i = 0; i < 8 && !sent; i++) await flush();
  assert.equal(sent, true);
  const oldRequest = h.state.posts[0][1];
  assert.equal(oldRequest.signal.aborted, false);
  h.state.current = identity("session-2");
  h.state.identityListener?.(h.state.current);
  assert.equal(oldRequest.signal.aborted, true);
  release({ ok: true, status: 200 });
  await flush();
  assert.equal(h.state.posts.length, 1);
  h.cleanup();
});

test("a failed native stop does not immediately register a new foreground watcher", async () => {
  const h = foregroundHarness();
  await flush();
  assert.equal(h.state.watchers.length, 1);
  h.runtime.stopBackgroundMissionLocation = async () => {
    throw new Error("native stop unconfirmed");
  };
  h.state.current = identity("session-2");
  h.state.identityListener?.(h.state.current);
  await flush();
  assert.equal(h.state.watchers[0].removed, true);
  assert.equal(h.state.watchers.length, 1);
  assert.equal(h.state.posts.length, 0);
  h.cleanup();
});
