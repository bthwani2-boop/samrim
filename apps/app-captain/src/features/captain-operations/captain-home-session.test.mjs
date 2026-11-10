import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript-ast";
import { captainSessionKey } from "../../bootstrap/captain-session-scope.ts";

const homeSource = readFileSync(new URL("../../../app/(app)/home.tsx", import.meta.url), "utf8");
const opportunitySource = readFileSync(new URL("./captain-opportunities.tsx", import.meta.url), "utf8");
const homeAst = ts.createSourceFile("home.tsx", homeSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const opportunityAst = ts.createSourceFile("captain-opportunities.tsx", opportunitySource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const identity = (sessionId, subject = "captain-7") =>
  ({ kind: "authenticated", identity: { role: "captain", subject, sessionId } });
const flush = async () => { for (let i = 0; i < 10; i++) await new Promise(done => setImmediate(done)); };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function production(ast, kind, runtime) {
  let expression = "";
  function walk(node) {
    if ((kind === "home" || kind === "opportunityFocus")
      && ts.isCallExpression(node) && node.expression.getText(ast) === "useFocusEffect") {
      const callback = node.arguments[0];
      if (ts.isCallExpression(callback)) expression = callback.arguments[0]?.getText(ast) ?? "";
    }
    if (kind === "refresh" && ts.isVariableDeclaration(node) && node.name.getText(ast) === "refresh") {
      if (ts.isCallExpression(node.initializer)) expression = node.initializer.arguments[0]?.getText(ast) ?? "";
    }
    ts.forEachChild(node, walk);
  }
  walk(ast);
  assert.ok(expression, "Production Identity session callback not found: " + kind);
  const source = "(() => { const result = " + expression + "; return result; })()";
  const js = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None,
  } }).outputText;
  return runInNewContext(js, runtime);
}

function homeHarness(overrides = {}) {
  const oldAssignments = deferred();
  const state = {
    session: identity("session-1"), mission: null, status: "loading", confirmed: "",
    reads: 0, tasks: 0, auth: 0, subscribe: null,
  };
  const runtime = {
    currentIdentityState: () => state.session,
    captainSessionKey,
    AppState: { currentState: "active", addEventListener: () => ({ remove: () => {} }) },
    getUsableIdentityAccessToken: async () => { state.auth++; return "token"; },
    captainClient: () => ({
      listOwnCaptainAssignments: async () => {
        state.reads++;
        return state.reads === 1 ? oldAssignments.promise : { assignments: [] };
      },
      readOwnCaptainDeliveryTask: async () => { state.tasks++; return { task: { customerAddressText: "private old address" } }; },
    }),
    setMission: update => { state.mission = typeof update === "function" ? update(state.mission) : update; },
    setMissionReadiness: value => { state.status = value; },
    setConfirmedMissionSession: value => { state.confirmed = value; },
    setInterval: () => 1, clearInterval: () => {},
    subscribeIdentitySession: callback => {
      state.subscribe = callback;
      return () => { state.subscribe = null; };
    },
    ...overrides,
  };
  const cleanup = production(homeAst, "home", runtime)();
  return { state, runtime, oldAssignments, cleanup };
}

test("Home starts a new authenticated mission read immediately after same-actor renewal", async () => {
  const h = homeHarness();
  await flush();
  assert.equal(h.state.reads, 1);
  h.state.session = identity("session-2");
  h.state.subscribe?.(h.state.session);
  await flush();
  assert.equal(h.state.reads, 2, "old request must not block current session");
  assert.equal(h.state.confirmed, captainSessionKey(h.state.session));
  assert.equal(h.state.status, "ready");
  assert.equal(h.state.mission, null);
  h.oldAssignments.resolve({ assignments: [{ state: "in_custody", id: "old-secret-assignment" }] });
  await flush();
  assert.equal(h.state.tasks, 0, "old session cannot fetch the former Customer destination");
  assert.equal(h.state.mission, null, "former response cannot reopen Customer address");
  assert.equal(h.state.confirmed, captainSessionKey(h.state.session));
  h.cleanup();
});

test("Home ignores a former same-actor token returned after session replacement", async () => {
  const oldToken = deferred();
  let authorizationCount = 0;
  const h = homeHarness({ getUsableIdentityAccessToken: async () => {
    authorizationCount++;
    return authorizationCount === 1 ? oldToken.promise : "fresh-token";
  } });
  await flush();
  assert.equal(authorizationCount, 1);
  h.state.session = identity("session-2");
  h.state.subscribe?.(h.state.session);
  await flush();
  assert.equal(h.state.reads, 1, "only the renewed session reads DSH");
  oldToken.resolve("old-token");
  await flush();
  assert.equal(h.state.reads, 1);
  assert.equal(h.state.mission, null);
  h.oldAssignments.resolve({ assignments: [] });
  await flush();
  assert.equal(h.state.confirmed, captainSessionKey(h.state.session));
  h.cleanup();
});

function opportunityHarness(overrides = {}) {
  const firstResponse = deferred();
  const state = {
    current: identity("session-1"), data: null, dataSessionKey: "", center: null,
    centerSessionKey: "", errors: [], calls: 0, gps: 0,
  };
  const runtime = {
    currentIdentityState: () => state.current,
    captainSessionKey,
    sessionKey: captainSessionKey(state.current),
    mission: null,
    missionReadiness: "ready",
    availabilityRevision: 0,
    requestSequence: { current: 0 },
    setData: value => { state.data = typeof value === "function" ? value(state.data) : value; },
    setDataSessionKey: value => { state.dataSessionKey = value; },
    setLoading: () => {},
    setError: value => { state.errors.push(value); },
    setOwnMapCenter: value => { state.center = value; },
    setCenterSessionKey: value => { state.centerSessionKey = value; },
    getUsableIdentityAccessToken: async () => "token",
    captainClient: () => ({
      readOwnCaptainOpportunities: async () => {
        state.calls++;
        return state.calls === 1 ? firstResponse.promise : sample(15.6);
      },
      readOwnCaptainAdmission: async () => ({ admission: { state: "eligible", availabilityState: "available" } }),
    }),
    isFreshOpportunitySample: () => true,
    radii: { LOW: 1050, MEDIUM: 1750, HIGH: 2450 },
    Location: {
      Accuracy: { Balanced: 3 },
      getForegroundPermissionsAsync: async () => ({ granted: true }),
      hasServicesEnabledAsync: async () => true,
      getLastKnownPositionAsync: async () => null,
      getCurrentPositionAsync: async () => { state.gps++; return { coords: { latitude: 15.4, longitude: 44.3 } }; },
    },
    setInterval: () => 1,
    clearInterval: () => {},
    ...overrides,
  };
  return { state, runtime, firstResponse };
}
function sample(latitude) {
  return { signalType: "RECENT_ACTIVITY", measuredAt: new Date().toISOString(),
    cells: [{ latitude, longitude: 44.3, intensity: "LOW", kind: "ORDERS" }] };
}

test("Opportunities rejects previous-session late activity while rendering the renewed session only", async () => {
  const h = opportunityHarness();
  const old = production(opportunityAst, "refresh", h.runtime)();
  await flush();
  assert.equal(h.state.calls, 1);
  h.state.current = identity("session-2");
  h.runtime.sessionKey = captainSessionKey(h.state.current);
  const current = production(opportunityAst, "refresh", h.runtime)();
  await current;
  assert.equal(h.state.data?.cells[0].latitude, 15.6);
  assert.equal(h.state.dataSessionKey, h.runtime.sessionKey);
  h.firstResponse.resolve(sample(15.1));
  await old;
  assert.equal(h.state.data?.cells[0].latitude, 15.6);
  assert.equal(h.state.dataSessionKey, captainSessionKey(h.state.current));
});

test("Opportunities cannot request former-session activity after a delayed token", async () => {
  const pendingToken = deferred();
  let tokenStarted = false;
  const h = opportunityHarness({
    getUsableIdentityAccessToken: async () => { tokenStarted = true; return pendingToken.promise; },
  });
  const pending = production(opportunityAst, "refresh", h.runtime)();
  await flush();
  assert.equal(tokenStarted, true);
  h.state.current = identity("session-2");
  pendingToken.resolve("old-token");
  await pending;
  assert.equal(h.state.calls, 0);
  assert.equal(h.state.dataSessionKey, "");
});

test("Opportunities refuses old GPS permission result on same-actor session renewal", async () => {
  const oldPermission = deferred();
  const h = opportunityHarness();
  let requesting = false;
  h.runtime.refresh = async () => {};
  h.runtime.Location.getForegroundPermissionsAsync = async () => {
    requesting = true;
    return oldPermission.promise;
  };
  const cleanup = production(opportunityAst, "opportunityFocus", h.runtime)();
  for (let i = 0; i < 10 && !requesting; i++) await flush();
  assert.equal(requesting, true);
  h.state.current = identity("session-2");
  oldPermission.resolve({ granted: true });
  await flush();
  assert.equal(h.state.gps, 0);
  assert.equal(h.state.centerSessionKey, "");
  assert.equal(h.state.center, null);
  cleanup();
});

test("Opportunities centers only current verified available Captain without publishing location", async () => {
  const h = opportunityHarness();
  h.runtime.refresh = async () => {};
  const cleanup = production(opportunityAst, "opportunityFocus", h.runtime)();
  await flush();
  assert.equal(h.state.gps, 1);
  assert.deepEqual(Object.assign({}, h.state.center), { latitude: 15.4, longitude: 44.3 });
  assert.equal(h.state.centerSessionKey, captainSessionKey(h.state.current));
  cleanup();
});

test("Home and map present no Customer markers or activity circles without confirmed session", () => {
  assert.match(homeSource, /const missionReadiness = !currentSession \? "unavailable"/);
  assert.match(homeSource, /confirmedMissionSession === currentSession \? missionStatus : "loading"/);
  assert.match(homeSource, /const mission = missionReadiness === "ready" \? missionSource : null/);
  assert.match(opportunitySource, /const visibleData = sessionCurrent && dataSessionKey === sessionKey \? data : null/);
  assert.match(opportunitySource, /const visibleMapCenter = sessionCurrent && centerSessionKey === sessionKey \? ownMapCenter : null/);
  assert.match(opportunitySource, /subscribeIdentitySession\(setIdentityState\)/);
  assert.match(opportunitySource, /admission\.admission\.availabilityState !== "available"/);
  assert.doesNotMatch(homeSource, /isCurrentCaptainActor/);
  assert.doesNotMatch(opportunitySource, /isCurrentCaptainActor/);
});
