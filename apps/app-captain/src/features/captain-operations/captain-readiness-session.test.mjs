import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript-ast";
import { captainSessionKey } from "../../bootstrap/captain-session-scope.ts";
import { visibleCaptainStoreMemberships } from "./captain-store-membership-policy.ts";

const source = readFileSync(new URL("./captain-readiness.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("captain-readiness.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const identity = (sessionId, actor = "captain-7") => ({
  kind: "authenticated", identity: { role: "captain", subject: actor, sessionId },
});
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };

function production(name, runtime) {
  let code = "";
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) code = node.getText(ast);
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name && node.initializer) {
      const exp = node.initializer;
      code = ts.isCallExpression(exp) && exp.expression.getText(ast) === "useCallback"
        ? exp.arguments[0]?.getText(ast) ?? "" : exp.getText(ast);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(code, ["Production callback not found: ", name].join(""));
  const text = code.startsWith("async function") || code.startsWith("function")
    ? `${code}; ({${name}})`
    : `const ${name} = ${code}; ({${name}})`;
  const js = ts.transpileModule(text, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None,
  } }).outputText;
  return runInNewContext(js, runtime)[name];
}

function harness(extractLoad = true) {
  const state = {
    current: identity("session-1"), updates: [], tokenReads: 0,
    admissionReads: 0, assignmentReads: 0, storeReads: 0,
    mutations: [], notifications: [], locations: 0, osSettings: 0, consents: [],
  };
  const runtime = {
    currentIdentityState: () => state.current,
    captainSessionKey,
    visibleCaptainStoreMemberships,
    readSequence: { current: 0 },
    getUsableIdentityAccessToken: async () => { state.tokenReads++; return "token"; },
    captainClient: () => ({
      readOwnCaptainAdmission: async () => {
        state.admissionReads++;
        return { admission: { state: "eligible", availabilityState: "unavailable", version: 9 } };
      },
      listOwnCaptainAssignments: async () => { state.assignmentReads++; return { assignments: [] }; },
      listOwnStoreCaptainMemberships: async () => { state.storeReads++; return { memberships: [] }; },
      setCaptainAvailability: async (...args) => { state.mutations.push(args); },
    }),
    setLoading: value => state.updates.push({ key: "loading", value }),
    setAdmission: value => state.updates.push({ key: "admission", value }),
    setStoreOnly: value => state.updates.push({ key: "storeOnly", value }),
    setHasActiveDelivery: value => state.updates.push({ key: "delivery", value }),
    setAssignmentsUnknown: value => state.updates.push({ key: "unknown", value }),
    setLoadedSessionKey: value => state.updates.push({ key: "loadedKey", value }),
    setError: value => state.updates.push({ key: "error", value }),
    setBusy: value => state.updates.push({ key: "busy", value }),
    setGpsReady: value => state.updates.push({ key: "gpsReady", value }),
    setLocationSettingsNeeded: value => state.updates.push({ key: "needsSettings", value }),
    setLocationRecoveryBusy: value => state.updates.push({ key: "recoveryBusy", value }),
    setBackgroundConsent: value => state.updates.push({ key: "consent", value }),
    setBackgroundBusy: value => state.updates.push({ key: "backgroundBusy", value }),
    Location: {
      requestForegroundPermissionsAsync: async () => ({ granted: true, canAskAgain: true }),
      hasServicesEnabledAsync: async () => true,
      enableNetworkProviderAsync: async () => {},
    },
    Platform: { OS: "android" },
    Linking: { openSettings: async () => {} },
    openPhoneLocationSettings: async () => { state.osSettings++; },
    refreshGps: async () => { state.locations++; return true; },
    publishCaptainPresence: async () => { state.notifications.push("presence"); },
    onAvailabilityConfirmed: () => { state.notifications.push("confirmed"); },
    missionActive: false,
    missionAssignmentId: "assignment-1",
    actorID: "captain-7",
    sessionKey: captainSessionKey(state.current),
    loadedSessionKey: captainSessionKey(state.current),
    currentSessionRead: true,
    current: { state: "eligible", availabilityState: "unavailable", version: 9 },
    eligible: true,
    busy: false,
    loading: false,
    available: false,
    assignmentsUnknown: false,
    hasActiveDelivery: false,
    locationRecoveryBusy: false,
    locationInFlight: { current: false },
    availabilityInFlight: { current: false },
    backgroundInFlight: { current: false },
    backgroundBusy: false,
    visibleStoreOnly: false,
    hasBackgroundMissionConsent: async () => false,
    setBackgroundMissionConsent: async (...args) => { state.consents.push(args); },
  };
  return { state, runtime, load: extractLoad ? production("load", runtime) : undefined };
}

const values = (state, key) => state.updates.filter(item => item.key === key).map(item => item.value);

test("current Captain readiness loads one canonical admission, assignments and session key", async () => {
  const h = harness();
  assert.equal(await h.load(), true);
  assert.equal(h.state.admissionReads, 1);
  assert.equal(h.state.assignmentReads, 1);
  assert.equal(values(h.state, "loadedKey").at(-1), captainSessionKey(h.state.current));
  assert.equal(values(h.state, "admission").at(-1).version, 9);
  assert.equal(values(h.state, "loading").at(-1), false);
});

test("late readiness result is discarded after same actor renews their Identity session", async () => {
  const h = harness();
  let release;
  let started = false;
  const delayed = new Promise(resolve => { release = resolve; });
  h.runtime.captainClient = () => ({
    readOwnCaptainAdmission: async () => { started = true; return delayed; },
    listOwnCaptainAssignments: async () => ({ assignments: [] }),
  });
  const pending = h.load();
  for (let i = 0; i < 8 && !started; i++) await flush();
  assert.equal(started, true);
  h.state.current = identity("session-2");
  release({ admission: { state: "eligible", version: 1 } });
  assert.equal(await pending, false);
  assert.equal(values(h.state, "loadedKey").filter(Boolean).length, 0);
  assert.equal(values(h.state, "admission").filter(Boolean).length, 0);
});

test("a session replaced during token acquisition cannot start private admission read", async () => {
  const h = harness();
  let release;
  let started = false;
  const delayed = new Promise(resolve => { release = resolve; });
  h.runtime.getUsableIdentityAccessToken = async () => { started = true; return delayed; };
  const pending = h.load();
  for (let i = 0; i < 8 && !started; i++) await flush();
  assert.equal(started, true);
  h.state.current = identity("session-2");
  release("old-token");
  assert.equal(await pending, false);
  assert.equal(h.state.admissionReads, 0);
});

test("accepted Store Captain readiness does not depend on the display label", async () => {
  const h = harness();
  h.runtime.captainClient = () => ({
    readOwnCaptainAdmission: async () => { throw new Error("NO_GENERAL_DISPATCH_ADMISSION"); },
    listOwnStoreCaptainMemberships: async () => ({
      memberships: [{ id: "store-a", state: "active", displayNameAr: null }],
    }),
  });
  assert.equal(await h.load(), true);
  assert.equal(values(h.state, "storeOnly").at(-1), true);
  assert.equal(values(h.state, "loadedKey").at(-1), captainSessionKey(h.state.current));
  assert.equal(h.state.mutations.length, 0);
});

test("pending Store membership never grants active Store-only readiness", async () => {
  const h = harness();
  h.runtime.captainClient = () => ({
    readOwnCaptainAdmission: async () => { throw new Error("NO_GENERAL_DISPATCH_ADMISSION"); },
    listOwnStoreCaptainMemberships: async () => ({
      memberships: [{ id: "store-pending", state: "pending", displayNameAr: "بانتظار" }],
    }),
  });
  assert.equal(await h.load(), false);
  assert.equal(values(h.state, "storeOnly").at(-1), false);
  assert.equal(values(h.state, "loadedKey").filter(Boolean).length, 0);
  assert.equal(h.state.mutations.length, 0);
});

test("Store-only Captain fallback survives without joining the public dispatch pool", async () => {
  const h = harness();
  h.runtime.captainClient = () => ({
    readOwnCaptainAdmission: async () => { throw new Error("not public"); },
    listOwnStoreCaptainMemberships: async () => ({ memberships: [{ state: "active", displayNameAr: "كابتن متجر" }] }),
  });
  assert.equal(await h.load(), true);
  assert.equal(values(h.state, "storeOnly").at(-1), true);
  assert.equal(values(h.state, "loadedKey").at(-1), captainSessionKey(h.state.current));
});

function actions() {
  const h = harness(false);
  h.runtime.available = true;
  h.runtime.current.availabilityState = "available";
  h.runtime.load = async () => { h.state.notifications.push("readback"); return true; };
  h.runtime.enablePhoneLocationServices = production("enablePhoneLocationServices", h.runtime);
  return {
    ...h,
    toggleAvailability: production("toggleAvailability", h.runtime),
    togglePhoneGps: production("togglePhoneGps", h.runtime),
    toggleBackground: production("toggleBackground", h.runtime),
    recoverPhoneLocation: production("recoverPhoneLocation", h.runtime),
    refreshConsent: production("refreshConsent", h.runtime),
  };
}

test("GPS readiness and mission recovery share the same Android service activation", async () => {
  const availability = actions();
  availability.runtime.available = false;
  availability.runtime.current.availabilityState = "unavailable";
  let availabilityChecks = 0;
  let availabilityActivations = 0;
  availability.runtime.Location.hasServicesEnabledAsync = async () => ++availabilityChecks >= 2;
  availability.runtime.Location.enableNetworkProviderAsync = async () => { availabilityActivations++; };
  await availability.toggleAvailability(true);
  assert.equal(availabilityActivations, 1);
  assert.equal(availabilityChecks, 2);
  assert.equal(availability.state.mutations.length, 1);
  assert.equal(availability.state.mutations[0][1], true);
  assert.deepEqual(availability.state.notifications, ["readback", "confirmed", "presence"]);

  const mission = actions();
  mission.runtime.missionActive = true;
  let missionChecks = 0;
  let missionActivations = 0;
  mission.runtime.Location.hasServicesEnabledAsync = async () => ++missionChecks >= 2;
  mission.runtime.Location.enableNetworkProviderAsync = async () => { missionActivations++; };
  await mission.recoverPhoneLocation();
  assert.equal(missionActivations, 1);
  assert.equal(missionChecks, 2);
  assert.equal(mission.state.mutations.length, 0, "mission GPS must never grant DSH public availability");
  assert.equal(mission.state.locations, 1);
  assert.equal(mission.state.notifications.length, 0, "mission recovery must not publish public dispatch presence");
});

test("GPS services still disabled after recovery block public availability", async () => {
  const h = actions();
  h.runtime.available = false;
  h.runtime.current.availabilityState = "unavailable";
  let requestedEnable = 0;
  h.runtime.Location.hasServicesEnabledAsync = async () => false;
  h.runtime.Location.enableNetworkProviderAsync = async () => { requestedEnable++; };
  await h.toggleAvailability(true);
  assert.equal(requestedEnable, 1);
  assert.equal(h.state.mutations.length, 0);
  assert.equal(h.state.notifications.length, 0);
  assert.match(values(h.state, "error").at(-1), /فعّل موقع الهاتف/);
  assert.equal(values(h.state, "gpsReady").at(-1), false);
});

test("renewed Identity session while Android location enabling cannot mutate DSH", async () => {
  const h = actions();
  h.runtime.available = false;
  h.runtime.current.availabilityState = "unavailable";
  let release;
  let started = false;
  const pendingEnable = new Promise(resolve => { release = resolve; });
  h.runtime.Location.hasServicesEnabledAsync = async () => false;
  h.runtime.Location.enableNetworkProviderAsync = async () => {
    started = true;
    return pendingEnable;
  };
  const pending = h.toggleAvailability(true);
  for (let i = 0; i < 10 && !started; i++) await flush();
  assert.equal(started, true);
  h.state.current = identity("session-2");
  release();
  await pending;
  assert.equal(h.state.mutations.length, 0);
  assert.equal(h.state.notifications.length, 0);
  assert.equal(h.runtime.availabilityInFlight.current, false);
});

test("availability off writes once with the canonical DSH expected version and verifies readback", async () => {
  const h = actions();
  h.runtime.available = true;
  h.runtime.current.availabilityState = "available";
  await h.toggleAvailability(false);
  assert.equal(h.state.mutations.length, 1);
  assert.equal(h.state.mutations[0][1], false);
  assert.equal(h.state.mutations[0][2], 9);
  assert.deepEqual(h.state.notifications, ["readback", "confirmed"]);
  assert.equal(h.runtime.availabilityInFlight.current, false);
});

test("double availability taps cannot issue duplicate writes before React re-renders", async () => {
  const h = actions();
  let release;
  const pendingMutation = new Promise(resolve => { release = resolve; });
  h.runtime.captainClient = () => ({
    setCaptainAvailability: async (...args) => { h.state.mutations.push(args); return pendingMutation; },
  });
  const first = h.toggleAvailability(false);
  await flush();
  const second = h.toggleAvailability(false);
  assert.equal(h.state.mutations.length, 1);
  release();
  await Promise.all([first, second]);
  assert.equal(h.state.mutations.length, 1);
});

test("renewal while the availability token is pending blocks all DSH mutations", async () => {
  const h = actions();
  let release;
  let started = false;
  const pendingToken = new Promise(resolve => { release = resolve; });
  h.runtime.getUsableIdentityAccessToken = async () => { started = true; return pendingToken; };
  const pending = h.toggleAvailability(false);
  for (let i = 0; i < 8 && !started; i++) await flush();
  assert.equal(started, true);
  h.state.current = identity("session-2");
  release("old-token");
  await pending;
  assert.equal(h.state.mutations.length, 0);
  assert.equal(h.state.notifications.length, 0);
});

test("a DSH availability result after same-actor session renewal cannot confirm the old change", async () => {
  const h = actions();
  let release;
  let started = false;
  const pendingWrite = new Promise(resolve => { release = resolve; });
  h.runtime.captainClient = () => ({
    setCaptainAvailability: async (...args) => {
      h.state.mutations.push(args);
      started = true;
      return pendingWrite;
    },
  });
  const pending = h.toggleAvailability(false);
  for (let i = 0; i < 8 && !started; i++) await flush();
  assert.equal(started, true);
  h.state.current = identity("session-2");
  release();
  await pending;
  assert.equal(h.state.notifications.length, 0);
});

test("GPS off cannot silently disable a phone while dispatch or mission is active", async () => {
  const h = actions();
  h.runtime.available = true;
  await h.togglePhoneGps(false);
  assert.equal(h.state.osSettings, 0);
  assert.match(values(h.state, "error").at(-1), /أوقف التوفر/);
  h.runtime.available = false;
  h.runtime.missionActive = true;
  await h.togglePhoneGps(false);
  assert.equal(h.state.osSettings, 0);
});

test("GPS off while verified offline opens only OS settings, without changing DSH", async () => {
  const h = actions();
  h.runtime.available = false;
  await h.togglePhoneGps(false);
  assert.equal(h.state.osSettings, 1);
  assert.equal(h.state.mutations.length, 0);
});

test("GPS on while offline requests phone permission without silently enabling DSH availability", async () => {
  const h = actions();
  h.runtime.available = false;
  h.runtime.recoverPhoneLocation = async onlyGps => { h.state.notifications.push(onlyGps); };
  // The production handler calls its lexical recovery owner.
  const toggle = production("togglePhoneGps", h.runtime);
  await toggle(true);
  assert.deepEqual(h.state.notifications, [true]);
  assert.equal(h.state.mutations.length, 0);
});

test("background consent read cannot reveal a former Captain session's result", async () => {
  const h = actions();
  let release;
  const pendingConsent = new Promise(resolve => { release = resolve; });
  h.runtime.hasBackgroundMissionConsent = async () => pendingConsent;
  const pending = h.refreshConsent();
  h.state.current = identity("session-2");
  release(true);
  await pending;
  assert.equal(values(h.state, "consent").length, 0);
});

test("background mission permission completion cannot update a replaced session", async () => {
  const h = actions();
  h.runtime.missionActive = true;
  let release;
  const pendingConsent = new Promise(resolve => { release = resolve; });
  h.runtime.setBackgroundMissionConsent = async (...args) => {
    h.state.consents.push(args);
    return pendingConsent;
  };
  const toggle = production("toggleBackground", h.runtime);
  const pending = toggle(true);
  await flush();
  h.state.current = identity("session-2");
  release();
  await pending;
  assert.equal(h.state.consents.length, 1);
  assert.equal(values(h.state, "consent").length, 0);
  assert.equal(values(h.state, "backgroundBusy").at(-1), true);
});

test("rendering of private Captain readiness and Store-only state requires the exact session", () => {
  assert.match(source, /const currentSessionRead = Boolean\(sessionKey\) && loadedSessionKey === sessionKey/);
  assert.match(source, /captainSessionKey\(currentIdentityState\(\)\) === sessionKey/);
  assert.match(source, /const visibleStoreOnly = currentSessionRead && storeOnly/);
  assert.match(source, /const visibleBackgroundConsent = currentSessionRead && backgroundConsent/);
  assert.match(source, /useFocusEffect\(useCallback\(\(\) => \{/);
  assert.match(source, /sessionKey\]\)\)/);
  assert.equal((source.match(/accessibilityLabel="مفتاح GPS الهاتف"/g) ?? []).length, 2);
  assert.doesNotMatch(source, /loadedActorID|isCurrentCaptainActor/);
});

test("stale GPS recovery and GPS switch never open OS permission or settings", async () => {
  const h = actions();
  let permissions = 0;
  h.runtime.Location.requestForegroundPermissionsAsync = async () => {
    permissions++;
    return { granted: true, canAskAgain: true };
  };
  h.state.current = identity("session-2");
  await h.recoverPhoneLocation();
  await h.togglePhoneGps(false);
  assert.equal(permissions, 0);
  assert.equal(h.state.osSettings, 0);
  assert.equal(h.state.mutations.length, 0);
});

test("GPS recovery while available reuses authorized current-session presence refresh", async () => {
  const h = actions();
  h.runtime.recoverPhoneLocation = async onlyGps => { h.state.notifications.push(onlyGps); };
  const toggle = production("togglePhoneGps", h.runtime);
  await toggle(true);
  assert.deepEqual(h.state.notifications, [false]);
});
