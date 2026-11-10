import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript-ast";
import { captainSessionKey } from "../../bootstrap/captain-session-scope.ts";
import { shouldPublishCaptainPresence } from "./captain-presence-policy.ts";

const source = readFileSync(new URL("./captain-presence-publisher.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("captain-presence-publisher.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const identity = (subject, sessionId) => ({
  kind: "authenticated", identity: { role: "captain", subject, sessionId },
});

function production(name, runtime) {
  let code = "";
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) code = node.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(code, ["Production function missing: ", name].join(""));
  const js = ts.transpileModule([code.replace(/^export\s+/, ""), "; ({", name, "})"].join(""), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return runInNewContext(js, runtime)[name];
}

function harness() {
  const state = {
    current: identity("captain-7", "session-1"),
    granted: true,
    gpsOn: true,
    eligible: true,
    posts: [],
    gpsReads: 0,
    tokenReads: 0,
    admissionReads: 0,
  };
  const runtime = {
    currentIdentityState: () => state.current,
    captainSessionKey,
    AppState: { currentState: "active" },
    Location: {
      getForegroundPermissionsAsync: async () => ({ granted: state.granted }),
      hasServicesEnabledAsync: async () => state.gpsOn,
      getCurrentPositionAsync: async () => {
        state.gpsReads++;
        return { coords: { latitude: 15.36, longitude: 44.19 } };
      },
      Accuracy: { Balanced: "balanced" },
    },
    getUsableIdentityAccessToken: async () => { state.tokenReads++; return "test-token"; },
    captainClient: () => ({
      readOwnCaptainAdmission: async () => {
        state.admissionReads++;
        return { admission: { state: state.eligible ? "eligible" : "review", availabilityState: "available" } };
      },
    }),
    shouldPublishCaptainPresence,
    process: { env: { EXPO_PUBLIC_DSH_API_URL: "https://test.invalid/" } },
    AbortSignal: { timeout: () => ({}) },
    fetch: async (...args) => { state.posts.push(args); return { ok: true }; },
    lastSubmittedAt: 0,
    lastSubmittedSession: "",
  };
  return { state, runtime, send: production("sendCurrentPresence", runtime) };
}

test("current eligible Captain publishes only one real foreground presence fix", async () => {
  const h = harness();
  await h.send();
  assert.equal(h.state.posts.length, 1);
  assert.equal(h.state.gpsReads, 1);
  const [url, options] = h.state.posts[0];
  assert.equal(url, "https://test.invalid/dsh/captains/me/presence");
  assert.equal(options.method, "POST");
  assert.equal(options.headers.Authorization, "Bearer test-token");
  assert.deepEqual(JSON.parse(options.body), { latitude: 15.36, longitude: 44.19 });
  assert.equal(h.runtime.lastSubmittedSession, captainSessionKey(h.state.current));
  assert.ok(h.runtime.lastSubmittedAt > 0);
});

test("foreground permission, GPS and admission guards still prevent location publishes", async () => {
  for (const blocked of ["granted", "gpsOn", "eligible"]) {
    const h = harness();
    h.state[blocked] = false;
    await h.send();
    assert.equal(h.state.posts.length, 0, ["Unexpected request while ", blocked, " is false"].join(""));
  }
  const background = harness();
  background.runtime.AppState.currentState = "background";
  await background.send();
  assert.equal(background.state.tokenReads, 0);
  assert.equal(background.state.gpsReads, 0);
  assert.equal(background.state.posts.length, 0);
});

test("same-actor session renewed during permission read stops before any token request", async () => {
  const h = harness();
  let release;
  let started = false;
  const permission = new Promise(resolve => { release = resolve; });
  h.runtime.Location.getForegroundPermissionsAsync = async () => { started = true; return permission; };
  const pending = h.send();
  for (let i = 0; i < 6 && !started; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(started, true);
  h.state.current = identity("captain-7", "session-2");
  release({ granted: true });
  await pending;
  assert.equal(h.state.tokenReads, 0);
  assert.equal(h.state.posts.length, 0);
});

test("same-actor renewal while awaiting token cannot read admission or GPS", async () => {
  const h = harness();
  let release;
  let started = false;
  const pendingToken = new Promise(resolve => { release = resolve; });
  h.runtime.getUsableIdentityAccessToken = async () => { started = true; return pendingToken; };
  const pending = h.send();
  for (let i = 0; i < 6 && !started; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(started, true);
  h.state.current = identity("captain-7", "session-2");
  release("old-token");
  await pending;
  assert.equal(h.state.admissionReads, 0);
  assert.equal(h.state.gpsReads, 0);
  assert.equal(h.state.posts.length, 0);
});

test("an old admission read cannot trigger GPS after the session changes", async () => {
  const h = harness();
  let release;
  let started = false;
  const delayed = new Promise(resolve => { release = resolve; });
  h.runtime.captainClient = () => ({
    readOwnCaptainAdmission: async () => { started = true; return delayed; },
  });
  const pending = h.send();
  for (let i = 0; i < 6 && !started; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(started, true);
  h.state.current = identity("captain-7", "session-2");
  release({ admission: { state: "eligible", availabilityState: "available" } });
  await pending;
  assert.equal(h.state.gpsReads, 0);
  assert.equal(h.state.posts.length, 0);
});

test("a location fix arriving from the old same-actor session is never posted", async () => {
  const h = harness();
  let release;
  let started = false;
  const location = new Promise(resolve => { release = resolve; });
  h.runtime.Location.getCurrentPositionAsync = async () => { started = true; return location; };
  const pending = h.send();
  for (let i = 0; i < 6 && !started; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(started, true);
  h.state.current = identity("captain-7", "session-2");
  release({ coords: { latitude: 15.36, longitude: 44.19 } });
  await pending;
  assert.equal(h.state.posts.length, 0);
  assert.equal(h.runtime.lastSubmittedSession, "");
});

test("a sent fix completing after session renewal does not throttle the new session", async () => {
  const h = harness();
  let release;
  let started = false;
  const pendingFetch = new Promise(resolve => { release = resolve; });
  h.runtime.fetch = async (...args) => {
    h.state.posts.push(args);
    started = true;
    return pendingFetch;
  };
  const pending = h.send();
  for (let i = 0; i < 6 && !started; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(started, true);
  h.state.current = identity("captain-7", "session-2");
  release({ ok: true });
  await pending;
  assert.equal(h.state.posts.length, 1, "request was issued before session changed");
  assert.equal(h.runtime.lastSubmittedSession, "", "old response cannot suppress current session");
});

test("failed DSH presence posts are not counted as successful presence", async () => {
  const h = harness();
  h.runtime.fetch = async (...args) => { h.state.posts.push(args); return { ok: false }; };
  await assert.rejects(h.send(), /CAPTAIN_PRESENCE_NOT_ACCEPTED/);
  assert.equal(h.runtime.lastSubmittedSession, "");
  assert.equal(h.runtime.lastSubmittedAt, 0);
});

test("presence throttle is session-bound, and forced refresh retains existing override", async () => {
  const state = { current: identity("captain-7", "session-1"), sends: 0 };
  const key = captainSessionKey(state.current);
  const runtime = {
    currentIdentityState: () => state.current,
    captainSessionKey,
    lastSubmittedSession: key,
    lastSubmittedAt: Date.now(),
    sendCurrentPresence: async () => { state.sends++; },
  };
  const publish = production("publishCaptainPresence", runtime);
  await publish(false);
  assert.equal(state.sends, 0);
  state.current = identity("captain-7", "session-2");
  await publish(false);
  assert.equal(state.sends, 1);
  await publish(true);
  assert.equal(state.sends, 2);
});

test("foreground presence reuses one canonical session scope and existing DSH endpoint", () => {
  assert.match(source, /const sessionKey = captainSessionKey\(currentIdentityState\(\)\)/);
  assert.match(source, /const isCurrent = \(\) => Boolean\(sessionKey\)/);
  assert.match(source, /if \(!isCurrent\(\)\) return/);
  assert.match(source, /lastSubmittedSession = sessionKey/);
  assert.match(source, /captainPresenceIntervalMs/);
  assert.match(source, /shouldPublishCaptainPresence\(/);
  assert.match(source, /\/dsh\/captains\/me\/presence/);
  assert.doesNotMatch(source, /lastSubmittedActor|before\.identity\.subject/);
});

function productionCallback(name, runtime) {
  let code = "";
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name && node.initializer) {
      code = node.initializer.getText(ast);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(code, ["Production callback missing: ", name].join(""));
  const js = ts.transpileModule(["const ", name, " = ", code, "; ({", name, "})"].join(""), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return runInNewContext(js, runtime)[name];
}

test("new session refresh is queued once while prior presence request is in flight", async () => {
  let releaseFirst;
  const delayed = new Promise(resolve => { releaseFirst = resolve; });
  const state = { sends: 0 };
  const runtime = {
    AppState: { currentState: "active" },
    inFlight: { current: false },
    disposed: false,
    refreshPending: false,
    publishCaptainPresence: async () => {
      state.sends++;
      if (state.sends === 1) await delayed;
    },
  };
  const tick = productionCallback("tick", runtime);
  const pending = tick();
  assert.equal(state.sends, 1);
  await tick();
  await tick();
  assert.equal(state.sends, 1, "no duplicate overlapping GPS sends");
  releaseFirst();
  await pending;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(state.sends, 2, "coalesced current-session refresh after prior send settles");
  assert.equal(runtime.inFlight.current, false);
  assert.equal(runtime.refreshPending, false);
});

test("new session subscription only refreshes on session replacement and cleans up on unmount", () => {
  assert.match(source, /let observedSession = captainSessionKey\(currentIdentityState\(\)\)/);
  assert.match(source, /const unsubscribeIdentity = subscribeIdentitySession\(\(identity\) =>/);
  assert.match(source, /const nextSession = captainSessionKey\(identity\)/);
  assert.match(source, /if \(nextSession === observedSession\) return/);
  assert.match(source, /observedSession = nextSession/);
  assert.match(source, /void tick\(\)/);
  assert.match(source, /refreshPending = true/);
  assert.match(source, /unsubscribeIdentity\(\)/);
});
