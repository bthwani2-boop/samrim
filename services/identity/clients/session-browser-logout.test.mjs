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
  return {manager,storage,values,pair,goOnline:()=>{online=true}};
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
