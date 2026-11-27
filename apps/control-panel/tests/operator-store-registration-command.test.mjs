import assert from "node:assert/strict";
import { test } from "node:test";
import {
  matchesPendingPolicy,
  parseRegistrationPolicy, readStoreRegistrationPolicy, reconcileRegistrationPolicy,
} from "../src/features/policies/store-registration-command.ts";

const endpoint = "/api/policies/cities/sanaa/store-registration/MARKETPLACE";
const city = "sanaa", relation = "MARKETPLACE", actor = "operator-a";
const change = { operationId: "policy-test-001", expectedVersion: 0, enabled: true,
  termsVersion: "terms-v1", termsText: "Merchant consent", reason: "Reviewed admission policy" };
const policy = { cityId: city, relation, version: 1, enabled: true,
  termsVersion: change.termsVersion, termsText: change.termsText,
  changedByActor: actor, changeReason: change.reason, updatedAt: new Date().toISOString() };
const reply = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

test("Operator policy parser refuses optimistic or cross-city data", () => {
  assert.equal(parseRegistrationPolicy(policy, city, relation)?.version, 1);
  assert.equal(parseRegistrationPolicy({ ...policy, cityId: "other" }, city, relation), null);
  assert.equal(parseRegistrationPolicy({ ...policy, enabled: "true" }, city, relation), null);
  assert.equal(matchesPendingPolicy(policy, actor, change), true);
  assert.equal(matchesPendingPolicy({ ...policy, changedByActor: "other" }, actor, change), false);
});
test("Operator policy PATCH is confirmed only after DSH owner GET readback", async t => {
  const methods = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(url, endpoint);
    methods.push(init.method);
    assert.equal(init.credentials, "same-origin");
    assert.equal(init.headers["X-BThwani-Operator"], actor);
    if (init.method === "PATCH") {
      assert.deepEqual(JSON.parse(init.body), change);
      return reply({ policy, replay: false });
    }
    return reply(policy);
  });
  assert.deepEqual(await reconcileRegistrationPolicy(endpoint, city, relation, actor, change),
    { status: "confirmed", current: policy, replay: false, superseded: false });
  assert.deepEqual(methods, ["PATCH", "GET"]);
});
test("Operator policy refuses a success body for another actor without readback", async t => {
  const calls = t.mock.method(globalThis, "fetch", async () =>
    reply({ policy: { ...policy, changedByActor: "another-operator" }, replay: false }));
  assert.deepEqual(await reconcileRegistrationPolicy(endpoint, city, relation, actor, change),
    { status: "unknown" });
  assert.equal(calls.mock.callCount(), 1);
});
test("Operator policy preserves original operation on unknown network outcome", async t => {
  const calls = t.mock.method(globalThis, "fetch", async () => { throw new Error("lost owner reply"); });
  assert.deepEqual(await reconcileRegistrationPolicy(endpoint, city, relation, actor, change),
    { status: "unknown" });
  assert.equal(calls.mock.callCount(), 1);
});
test("Operator policy distinguishes conflict, revoked permission, and bad inputs", async t => {
  let status = 409;
  t.mock.method(globalThis, "fetch", async () => reply({ code: ({409:"VERSION_CONFLICT",401:"UNAUTHORIZED",403:"FORBIDDEN",400:"INVALID_REQUEST"})[status] ?? "DSH_OWNER_UNAVAILABLE" }, status));
  for (const [next, expected] of [[409, "conflict"], [401, "denied"], [403, "denied"], [400, "rejected"], [503, "unknown"]]) {
    status = next;
    assert.deepEqual(await reconcileRegistrationPolicy(endpoint, city, relation, actor, change),
      { status: expected });
  }
});
test("Operator policy GET requires current owner payload rather than local saved UI state", async t => {
  t.mock.method(globalThis, "fetch", async () => reply({ ...policy, relation: "DIRECT" }));
  await assert.rejects(readStoreRegistrationPolicy(endpoint, city, relation, actor),
    /owner response invalid/);
});
test("A stale DSH readback after confirmed PATCH remains uncertain", async t => {
  let writes = 0;
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    if (init.method === "PATCH") {
      writes++;
      return reply({ policy, replay: true });
    }
    return reply({
      ...policy, version: 0, enabled: false,
      termsVersion: undefined, termsText: undefined, changedByActor: undefined,
      changeReason: undefined, updatedAt: undefined,
    });
  });
  assert.deepEqual(await reconcileRegistrationPolicy(endpoint, city, relation, actor, change),
    { status: "unknown" });
  assert.equal(writes, 1);
});

test("initial registration policy command survives reload, scoped to its operator", async () => {
  const { savePendingRegistrationPolicy, readPendingRegistrationPolicy, clearPendingRegistrationPolicy } =
    await import("../src/features/policies/store-registration-command.ts");
  const data = new Map();
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
  const pending = { cityId: city, relation, change };
  savePendingRegistrationPolicy(storage, actor, pending);
  assert.deepEqual(readPendingRegistrationPolicy(storage, actor), pending);
  assert.equal(readPendingRegistrationPolicy(storage, "operator-b"), null);
  assert.throws(() => savePendingRegistrationPolicy(storage, actor, { ...pending, change: { ...change, operationId: "different-op-001" } }));
  clearPendingRegistrationPolicy(storage, actor, pending);
  assert.equal(readPendingRegistrationPolicy(storage, actor), null);
  savePendingRegistrationPolicy(storage, actor, pending);
  const key = [...data.keys()][0];
  data.set(key, "{broken");
  assert.throws(() => readPendingRegistrationPolicy(storage, actor));
  assert.throws(() => savePendingRegistrationPolicy(storage, actor, pending));
});


test("registration command rejects wrong route and invalid actor before any network request", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async () => reply(policy));
  for (const path of ["https://example.invalid/policy", endpoint + "?history=1", endpoint + "/extra", endpoint.replace("sanaa", "aden"), endpoint.replace("MARKETPLACE", "DIRECT")]) {
    await assert.rejects(readStoreRegistrationPolicy(path, city, relation, actor), /scope/);
    assert.deepEqual(await reconcileRegistrationPolicy(path, city, relation, actor, change), { status: "rejected" });
  }
  await assert.rejects(readStoreRegistrationPolicy(endpoint, city, relation, ""), /scope/);
  assert.equal(fetch.mock.callCount(), 0);
});

test("registration history rejects integer overflow without contacting BFF", async t => {
  const { readRegistrationHistory } = await import("../src/features/policies/store-registration-command.ts");
  const fetch = t.mock.method(globalThis, "fetch", async () => reply({ entries: [] }));
  await assert.rejects(readRegistrationHistory(endpoint, city, relation, actor, "9223372036854775808"), /scope/);
  assert.equal(fetch.mock.callCount(), 0);
});

test("registration mutation cannot confirm a noncanonical write envelope", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async (_url, init) =>
    reply(init.method === "PATCH" ? { policy, replay: false, extra: "unexpected" } : policy));
  assert.deepEqual(await reconcileRegistrationPolicy(endpoint, city, relation, actor, change), { status: "unknown" });
  assert.equal(fetch.mock.callCount(), 1);
});

test("registration command refuses oversized or non-JSON successful response", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async () =>
    new Response(JSON.stringify(policy) + " ".repeat(65536), { headers: { "Cache-Control": "no-store", "Content-Type": "application/json" } }));
  await assert.rejects(readStoreRegistrationPolicy(endpoint, city, relation, actor), /response invalid/);
  fetch.mock.restore();
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify(policy), { headers: { "Cache-Control": "no-store", "Content-Type": "text/plain" } }));
  await assert.rejects(readStoreRegistrationPolicy(endpoint, city, relation, actor), /response invalid/);
});


test("scope admission validates real actor and city values without coercion", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async () => reply(policy));
  for (const invalid of [123, "", " actor", "x".repeat(129), "actor\nname", "\ud800"]) {
    await assert.rejects(readStoreRegistrationPolicy(endpoint, city, relation, invalid), /scope/);
  }
  for (const [invalidCity, invalidRelation] of [[123, relation], ["../sanaa", relation], [city, "OTHER"]]) {
    await assert.rejects(readStoreRegistrationPolicy(endpoint, invalidCity, invalidRelation, actor), /scope/);
  }
  assert.deepEqual(await reconcileRegistrationPolicy(endpoint, city, relation, actor, { ...change, reason: "" }), { status: "rejected" });
  assert.equal(fetch.mock.callCount(), 0);
});

test("response admission cancels rejected body and handles an unavailable reader", async t => {
  let canceled = 0;
  const stream = new ReadableStream({ cancel() { canceled++; throw new Error("cancel failed"); } });
  let response = new Response(stream, { headers: { "Cache-Control": "no-store", "Content-Type": "application/json", "Content-Length": "65537" } });
  t.mock.method(globalThis, "fetch", async () => response);
  await assert.rejects(readStoreRegistrationPolicy(endpoint, city, relation, actor), /response invalid/);
  assert.equal(canceled, 1);
  response = new Response(null, { headers: { "Cache-Control": "no-store", "Content-Type": "application/json" } });
  await assert.rejects(readStoreRegistrationPolicy(endpoint, city, relation, actor), /response invalid/);
  response = reply(policy);
  const reader = response.body.getReader();
  await assert.rejects(readStoreRegistrationPolicy(endpoint, city, relation, actor), /response invalid/);
  reader.releaseLock();
  response = new Response("{", { headers: { "Cache-Control": "no-store", "Content-Type": "application/json", "Content-Length": "invalid" } });
  await assert.rejects(readStoreRegistrationPolicy(endpoint, city, relation, actor), /response invalid/);
  response = new Response(Uint8Array.of(0xff), { headers: { "Cache-Control": "no-store", "Content-Type": "application/json" } });
  await assert.rejects(readStoreRegistrationPolicy(endpoint, city, relation, actor), /response invalid/);
  assert.equal(response.body.locked, false);
});

test("audit accepts exclusive int64 cursor and rejects malformed page", async t => {
  const { readRegistrationHistory } = await import("../src/features/policies/store-registration-command.ts");
  const entries = [{ version: 1, enabled: true, termsVersion: "terms-v1", changedByActor: actor, changeReason: "Reviewed", updatedAt: policy.updatedAt }];
  let body = { entries };
  t.mock.method(globalThis, "fetch", async () => reply(body));
  assert.deepEqual(await readRegistrationHistory(endpoint, city, relation, actor, "9223372036854775807"), body);
  body = { entries: [null] };
  await assert.rejects(readRegistrationHistory(endpoint, city, relation, actor), /audit owner response invalid/);
});

test("recovery refuses invalid or mismatched pending data and retains the original command", async () => {
  const { savePendingRegistrationPolicy, readPendingRegistrationPolicy, clearPendingRegistrationPolicy } = await import("../src/features/policies/store-registration-command.ts");
  const data = new Map();
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
  const pending = { cityId: city, relation, change };
  assert.throws(() => clearPendingRegistrationPolicy(storage, actor, pending));
  assert.throws(() => savePendingRegistrationPolicy(storage, actor, { ...pending, relation: "OTHER" }));
  savePendingRegistrationPolicy(storage, actor, pending);
  savePendingRegistrationPolicy(storage, actor, pending);
  for (const different of [{ ...pending, cityId: "aden" }, { ...pending, relation: "DIRECT" }, ...Object.keys(change).map(key => ({ ...pending, change: { ...change, [key]: key === "enabled" ? false : key === "expectedVersion" ? 1 : "different-value" } }))]) {
    assert.throws(() => clearPendingRegistrationPolicy(storage, actor, different));
  }
  assert.deepEqual(readPendingRegistrationPolicy(storage, actor), pending);
  data.set([...data.keys()][0], JSON.stringify({ ...pending, extra: true }));
  assert.throws(() => readPendingRegistrationPolicy(storage, actor), /Invalid pending/);
});

test("mutation cannot confirm unexpected response status or malformed envelope", async t => {
  let response = reply({ policy, replay: true }, 201);
  t.mock.method(globalThis, "fetch", async () => response);
  assert.deepEqual(await reconcileRegistrationPolicy(endpoint, city, relation, actor, change), { status: "unknown" });
  for (const body of [null, [], { policy, replay: "yes" }, { policy: null, replay: true }]) {
    response = reply(body);
    assert.deepEqual(await reconcileRegistrationPolicy(endpoint, city, relation, actor, change), { status: "unknown" });
  }
});

test("browser confirms the same Go-normalized policy receipt as the owner SDK", async t => {
  const requested = { ...change, termsText: "\u0085\uFEFFterms\u0085", reason: "\u0085Reviewed\u0085" };
  const committed = { ...policy, termsText: "\uFEFFterms", changeReason: "Reviewed" };
  assert.equal(matchesPendingPolicy(committed, actor, requested), true);
  const calls = t.mock.method(globalThis, "fetch", async (_url, init) => {
    if (init.method === "PATCH") {
      assert.deepEqual(JSON.parse(init.body), requested);
      return reply({ policy: committed, replay: true });
    }
    return reply(committed);
  });
  assert.deepEqual(await reconcileRegistrationPolicy(endpoint, city, relation, actor, requested),
    { status: "confirmed", current: committed, replay: true, superseded: false });
  assert.equal(calls.mock.callCount(), 2);
});

test("registration refuses cached success or unproven definitive refusal",async t=>{
  let response=Response.json(policy);
  t.mock.method(globalThis,"fetch",async()=>response);
  await assert.rejects(readStoreRegistrationPolicy(endpoint,city,relation,actor),/response invalid/);
  response=Response.json({code:"VERSION_CONFLICT"},{status:409});
  assert.deepEqual(await reconcileRegistrationPolicy(endpoint,city,relation,actor,change),{status:"unknown"});
  response=Response.json({code:"VERSION_CONFLICT",extra:true},{status:409,headers:{"Cache-Control":"no-store"}});
  assert.deepEqual(await reconcileRegistrationPolicy(endpoint,city,relation,actor,change),{status:"unknown"});
});
test("registration receipt cannot confirm a command with a different immutable audit timestamp",async t=>{
  t.mock.method(globalThis,"fetch",async(_url,init)=>Response.json(init.method==="PATCH"?{policy,replay:true}:{...policy,updatedAt:"2026-11-19T00:00:00Z"},{headers:{"Cache-Control":"no-store"}}));
  assert.deepEqual(await reconcileRegistrationPolicy(endpoint,city,relation,actor,change),{status:"unknown"});
});

test("one policy transport rejects malformed scope, nonprivate and oversized failures",async t=>{
  const {requestPolicyOwner}=await import("../src/features/policies/policy-owner-web.ts");
  let response=reply(policy);
  const calls=t.mock.method(globalThis,"fetch",async()=>response);
  for(const [url,who] of [["https://example.invalid",actor],[endpoint," actor"],[endpoint,[]]]) {
    await assert.rejects(requestPolicyOwner(url,who),/scope/);
  }
  assert.equal(calls.mock.callCount(),0);
  for(const [status,code] of [[400,"INVALID_REQUEST"],[401,"UNAUTHORIZED"],[403,"FORBIDDEN"],[409,"VERSION_CONFLICT"]]){
    response=reply({code},status);
    assert.deepEqual(await requestPolicyOwner(endpoint,actor,"PATCH",change),{status,document:null});
  }
  for(const bad of [reply(null,409),reply({code:"WRONG"},409),reply({code:"VERSION_CONFLICT",extra:true},409),
    reply({code:"VERSION_CONFLICT",text:"x".repeat(4096)},409),Response.json({code:"FORBIDDEN"},{status:403}),
    reply({code:"DSH_OWNER_UNAVAILABLE"},503),reply(policy,201)]){
    response=bad;
    await assert.rejects(requestPolicyOwner(endpoint,actor,"PATCH",change),/response invalid/);
  }
});
test("policy transport cancels a stalled body and refuses late or pre-abandoned responses",async t=>{
  const {requestPolicyOwner}=await import("../src/features/policies/policy-owner-web.ts");
  const pre=new AbortController();pre.abort();
  let cancelled=0;
  let resolveFetch;
  const calls=t.mock.method(globalThis,"fetch",()=>new Promise(resolve=>{resolveFetch=resolve}));
  await assert.rejects(requestPolicyOwner(endpoint,actor,"GET",undefined,pre.signal),/response invalid/);
  assert.equal(calls.mock.callCount(),0);
  const late=new AbortController();
  const lateReply=requestPolicyOwner(endpoint,actor,"GET",undefined,late.signal);
  late.abort();
  await assert.rejects(lateReply,/response invalid/);
  resolveFetch(new Response(new ReadableStream({cancel(){cancelled++;}}),{
    headers:{"Content-Type":"application/json","Cache-Control":"no-store"},
  }));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(cancelled,1);
  const body=new ReadableStream({cancel(){cancelled++;}});
  calls.mock.mockImplementation(async()=>new Response(body,{headers:{"Content-Type":"application/json","Cache-Control":"no-store"}}));
  const interrupted=new AbortController();
  const read=requestPolicyOwner(endpoint,actor,"GET",undefined,interrupted.signal);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(body.locked,true);
  interrupted.abort();
  await assert.rejects(read,/response invalid/);
  assert.equal(cancelled,2);assert.equal(body.locked,false);
});
test("registration reconciles immutable submitted snapshot even when caller mutates during fetch",async t=>{
  const input={...change};
  t.mock.method(globalThis,"fetch",async(_url,init)=>{
    if(init.method==="PATCH"){
      assert.deepEqual(JSON.parse(init.body),change);
      input.reason="different";
      return reply({policy,replay:false});
    }
    return reply(policy);
  });
  assert.deepEqual(await reconcileRegistrationPolicy(endpoint,city,relation,actor,input),
    {status:"confirmed",current:policy,replay:false,superseded:false});
});

test("the shared policy deadline bounds even a fetch that ignores abort",async t=>{
  const {requestPolicyOwner}=await import("../src/features/policies/policy-owner-web.ts");
  t.mock.timers.enable({apis:["setTimeout"]});
  let signal;
  t.mock.method(globalThis,"fetch",(_url,init)=>{signal=init.signal;return new Promise(()=>{});});
  const pending=requestPolicyOwner(endpoint,actor);
  const refused=assert.rejects(pending,/response invalid/);
  t.mock.timers.tick(10000);
  await refused;
  assert.equal(signal.aborted,true);
});
