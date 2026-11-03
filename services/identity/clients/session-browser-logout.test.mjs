import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "./client") return nextResolve("./client.ts", context);
    if (specifier === "./generated/identity-operations") return nextResolve("./generated/identity-operations.ts", context);
    return nextResolve(specifier, context);
  },
});
const { IdentitySessionManager } = await import("./session.ts");

function testHarness(browser, restoreOverride) {
  const values = new Map();
  const storage = {
    getItem: async key => values.get(key) ?? null,
    setItem: async (key, value) => { values.set(key, value); },
    removeItem: async key => { values.delete(key); },
  };
  let online = false;
  const client = {
    logout: async () => { if (!online) throw {kind:"network",message:"connection unavailable"}; },
  };
  const identity = { subject:"test-actor",role:"client",surface:"app-client",expiresAt:"2027-11-01T00:00:00Z",sessionId:"test-session" };
  const pair = { accessToken:"test-access-token-long-enough",refreshToken:"test-refresh-token-long-enough",accessExpiresAt:identity.expiresAt,identity };
  const manager = new IdentitySessionManager(client,storage,async()=> "test-instance-id","client","app-client","bthwani.logout.test",()=> "stable-refresh-request-id-123456",undefined,browser ? (restoreOverride ?? (async()=>pair)) : undefined);
  return {manager,client,storage,values,pair,goOnline:()=>{online=true}};
}

test("browser logout while offline preserves live identity and cookie-backed recovery until server revocation",async()=>{
  const h=testHarness(true);
  await h.manager.adopt(h.pair);
  await assert.rejects(()=>h.manager.logout(),e=>e.kind==="network");
  assert.equal(h.manager.state.kind,"authenticated","must not display signed-out while server cookie remains valid");
  assert.ok(h.values.has("bthwani.logout.test.identity.session.v1"),"retry retains in-memory session");
  h.goOnline();
  await h.manager.logout();
  assert.deepEqual(h.manager.state,{kind:"signed_out",reason:"explicit_logout"});
  assert.equal(h.values.has("bthwani.logout.test.identity.session.v1"),false);
});

test("native logout retains existing fail-closed local deletion behavior",async()=>{
  const h=testHarness(false);
  await h.manager.adopt(h.pair);
  await assert.rejects(()=>h.manager.logout(),e=>e.kind==="network");
  assert.deepEqual(h.manager.state,{kind:"signed_out",reason:"explicit_logout"});
  assert.equal(h.values.size,0);
});

test("browser logout waits for a pending cookie restore, then remains signed out", async()=>{
  let markStarted;
  const started = new Promise(resolve=>{markStarted=resolve});
  let finishRestore;
  const pendingCookieResponse = new Promise(resolve=>{finishRestore=resolve});
  const h = testHarness(true, async()=>{
    markStarted();
    return pendingCookieResponse;
  });
  h.goOnline();
  const restoring = h.manager.restore();
  await started;
  const logout = h.manager.logout();
  assert.notEqual(h.manager.state.kind,"authenticated","pending restore must not reauthenticate during logout");
  finishRestore(h.pair);
  await restoring;
  await logout;
  assert.deepEqual(h.manager.state,{kind:"signed_out",reason:"explicit_logout"});
  assert.equal(h.values.size,0);
  assert.deepEqual(await h.manager.restore(),{kind:"signed_out",reason:"explicit_logout"},
    "late restore must not resuscitate the browser session");
});

test("browser logout waits for in-flight refresh and revokes the rotated session", async () => {
  const h = testHarness(true);
  await h.manager.adopt(h.pair);
  let signalStarted;
  const started = new Promise(resolve => { signalStarted = resolve; });
  let resolveRefresh;
  const delayedRefresh = new Promise(resolve => { resolveRefresh = resolve; });
  const revokedTokens = [];
  h.client.refresh = async () => {
    signalStarted();
    return delayedRefresh;
  };
  h.client.logout = async token => { revokedTokens.push(token); };
  const refreshing = h.manager.refresh();
  await started;
  const loggingOut = h.manager.logout();
  assert.deepEqual(revokedTokens, [], "revocation must wait for the in-flight rotation");
  const freshPair = {
    ...h.pair,
    accessToken: "rotated-access-token-long-enough",
    refreshToken: "rotated-refresh-token-long-enough",
  };
  resolveRefresh(freshPair);
  await refreshing;
  await loggingOut;
  assert.deepEqual(revokedTokens, [freshPair.accessToken], "revoke the latest rotated session");
  assert.deepEqual(h.manager.state, {kind: "signed_out", reason: "explicit_logout"});
  assert.equal(h.values.size, 0, "a completed refresh must not restore local credentials");
});

test("browser refresh and token reads cannot start while remote logout is pending", async () => {
  const h = testHarness(true);
  await h.manager.adopt(h.pair);
  let completeLogout;
  const remoteLogout = new Promise(resolve => { completeLogout = resolve; });
  let refreshCalls = 0;
  h.client.logout = async () => remoteLogout;
  h.client.refresh = async () => { refreshCalls++; return h.pair; };
  const loggingOut = h.manager.logout();
  const duringLogout = await h.manager.refresh();
  assert.equal(duringLogout.kind, "authenticated", "do not claim sign-out before cookie revocation");
  await assert.rejects(() => h.manager.getUsableAccessToken(), /IDENTITY_BROWSER_LOGOUT_IN_PROGRESS/);
  assert.equal(refreshCalls, 0, "a pending logout must not issue another refresh request");
  completeLogout();
  await loggingOut;
  assert.deepEqual(h.manager.state, {kind: "signed_out", reason: "explicit_logout"});
  assert.equal(h.values.size, 0);
});

test("failed browser logout releases its guard and permits an authenticated retry", async () => {
  const h = testHarness(true);
  await h.manager.adopt(h.pair);
  await assert.rejects(() => h.manager.logout(), error => error.kind === "network");
  assert.equal(h.manager.state.kind, "authenticated");
  const refreshed = { ...h.pair, accessToken: "fresh-after-failed-logout-access" };
  h.client.refresh = async () => refreshed;
  assert.equal((await h.manager.refresh()).kind, "authenticated", "refresh is no longer blocked after failure");
  assert.ok(h.values.size > 0);
  h.goOnline();
  await h.manager.logout();
  assert.deepEqual(h.manager.state, {kind: "signed_out", reason: "explicit_logout"});
});

test("browser logout waits for pending-refresh session recovery before revoking credentials", async () => {
  const h = testHarness(true);
  await h.manager.adopt(h.pair);
  h.values.set("bthwani.logout.test.identity.session.v1", JSON.stringify({
    accessToken: h.pair.accessToken,
    refreshToken: h.pair.refreshToken,
    pendingRefresh: {
      previous: { accessToken: h.pair.accessToken, refreshToken: h.pair.refreshToken },
      requestId: "stable-refresh-request-id-123456",
    },
  }));
  let signalSessionStarted;
  const sessionStarted = new Promise(resolve => { signalSessionStarted = resolve; });
  let completeSession;
  const pendingSession = new Promise(resolve => { completeSession = resolve; });
  let sessionChecks = 0;
  h.client.session = async () => { sessionChecks++; signalSessionStarted(); return pendingSession; };
  const revoked = [];
  h.client.logout = async token => { revoked.push(token); };

  const refreshing = h.manager.refresh();
  const overlappingRefresh = h.manager.refresh();
  await sessionStarted;
  assert.equal(sessionChecks, 1, "pending session recovery must be shared across concurrent refresh callers");
  const loggingOut = h.manager.logout();
  assert.deepEqual(revoked, [], "logout must await the pending-refresh session check");

  completeSession(h.pair.identity);
  await Promise.all([refreshing, overlappingRefresh]);
  await loggingOut;
  assert.deepEqual(revoked, [h.pair.accessToken]);
  assert.deepEqual(h.manager.state, { kind: "signed_out", reason: "explicit_logout" });
  assert.equal(h.values.size, 0, "the late session recovery cannot restore tokens after logout");
});

for (const readFailure of [false, true]) {
  test(`browser logout remains terminal when a pre-logout storage read settles afterward (${readFailure ? "error" : "stale data"})`, async () => {
    const h = testHarness(true);
    await h.manager.adopt(h.pair);
    h.goOnline();
    const key = "bthwani.logout.test.identity.session.v1";
    const stale = h.values.get(key);
    let readStarted;
    const started = new Promise(resolve => { readStarted = resolve; });
    let releaseRead;
    const delayedRead = new Promise(resolve => { releaseRead = resolve; });
    let tokenWrites = 0;
    const write = h.storage.setItem;
    h.storage.setItem = async (...args) => { tokenWrites++; return write(...args); };
    let sessionCalls = 0;
    let refreshCalls = 0;
    h.client.session = async () => { sessionCalls++; return h.pair.identity; };
    h.client.refresh = async () => { refreshCalls++; return h.pair; };
    h.storage.getItem = async () => {
      readStarted();
      await delayedRead;
      if (readFailure) throw new Error("delayed storage failure");
      return stale;
    };

    const inFlight = h.manager.refresh();
    await started;
    await h.manager.logout();
    assert.deepEqual(h.manager.state, { kind: "signed_out", reason: "explicit_logout" });
    releaseRead();
    await inFlight;
    assert.deepEqual(h.manager.state, { kind: "signed_out", reason: "explicit_logout" },
      "late read must not degrade or restore the completed logout");
    assert.equal(sessionCalls, 0);
    assert.equal(refreshCalls, 0);
    assert.equal(tokenWrites, 0);
    assert.equal(h.values.size, 0);
  });
}
