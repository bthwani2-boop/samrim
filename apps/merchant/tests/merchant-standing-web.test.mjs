import assert from "node:assert/strict";
import { test } from "node:test";
import { DELETE, GET, POST } from "../app/api/admission+api.ts";

const bearer=Buffer.alloc(32,8).toString("base64url");
const expires=new Date(Date.now()+120000).toISOString();
const identity="http://127.0.0.1:13009";
const dsh="http://127.0.0.1:13010";
const json=value=>Response.json(value,{headers:{"Cache-Control":"no-store"}});
function request(path="?stores=mine",token=bearer){
  return new Request("http://localhost:18102/api/admission"+path,{
    headers: token?{ Cookie:"bthwani_merchant_admission="+token }:{},
  });
}
function mockOwners(t,{role="merchant",dshActor="owner-a",dshStatus=200}={}){
  t.mock.method(globalThis,"fetch",async(url,options)=>{
    const target=new URL(url);
    const used=options.headers.Authorization;
    assert.equal(used,"Bearer "+bearer);
    if(target.origin===identity) {
      assert.equal(target.pathname,"/v1/sessions/current");
      return json({actorId:"owner-a",role,sessionExpiresAt:expires});
    }
    if(target.origin===dsh){
      assert.equal(target.pathname,"/v1/stores/mine");
      if(dshStatus!==200) return Response.json({code:"STORE_OPERATION_FORBIDDEN"},{
        status:dshStatus,headers:{"Cache-Control":"no-store"}});
      return json({actorId:dshActor,stores:[{id:"s-1",name:"Store",relation:"DIRECT",published:false}]});
    }
    assert.fail("unknown owner endpoint "+url);
  });
}
test("Same-origin Merchant owner read returns only DSH-verified Store standing",async t=>{
  t.mock.method(globalThis,"fetch",async (url,options)=>{
    const u=new URL(url);
    assert.equal(options.headers.Authorization,"Bearer "+bearer);
    if(u.origin===identity) return json({actorId:"owner-a",role:"merchant",sessionExpiresAt:expires});
    if(u.origin===dsh) return json({actorId:"owner-a",stores:[{id:"s-1",name:"Store",relation:"DIRECT",published:false}]});
    assert.fail("unrecognized owner "+url);
  });
  process.env.MERCHANT_SYNTHETIC_IDENTITY_ORIGIN=identity;
  process.env.MERCHANT_SYNTHETIC_DSH_ORIGIN=dsh;
  const result=await GET(request());
  assert.equal(result.status,200);
  assert.equal(result.headers.get("Cache-Control"),"no-store");
  assert.deepEqual(await result.json(),{standing:{actorId:"owner-a",stores:[{id:"s-1",name:"Store",relation:"DIRECT",published:false}]}});
});
test("Cross-actor DSH standing fails closed",async t=>{
  mockOwners(t,{dshActor:"other-actor"});
  process.env.MERCHANT_SYNTHETIC_IDENTITY_ORIGIN=identity;
  process.env.MERCHANT_SYNTHETIC_DSH_ORIGIN=dsh;
  const result=await GET(request());
  assert.equal(result.status,503);
  assert.deepEqual(await result.json(),{code:"OWNER_UNAVAILABLE"});
});
test("Merchant cannot use a Customer role to inspect DSH",async t=>{
  let calls=0;
  t.mock.method(globalThis,"fetch",async(url)=>{
    calls++;
    assert.equal(new URL(url).origin,identity);
    return json({actorId:"owner-a",role:"customer",sessionExpiresAt:expires});
  });
  process.env.MERCHANT_SYNTHETIC_IDENTITY_ORIGIN=identity;
  process.env.MERCHANT_SYNTHETIC_DSH_ORIGIN=dsh;
  const result=await GET(request());
  assert.equal(result.status,401);
  assert.equal(calls,1);
});
test("Unauthenticated browser cannot query DSH",async t=>{
  t.mock.method(globalThis,"fetch",async()=>{assert.fail("owner contacted without bearer")});
  process.env.MERCHANT_SYNTHETIC_IDENTITY_ORIGIN=identity;
  const result=await GET(request("?stores=mine",""));
  assert.equal(result.status,401);
});

for (const deniedStatus of [401, 403]) {
  test(`DSH ${deniedStatus} owner denial preserves the verified Merchant Web cookie`, async t => {
    mockOwners(t, { dshStatus: deniedStatus });
    process.env.MERCHANT_SYNTHETIC_IDENTITY_ORIGIN = identity;
    process.env.MERCHANT_SYNTHETIC_DSH_ORIGIN = dsh;
    const result = await GET(request());
    assert.equal(result.status, deniedStatus);
    assert.equal(result.headers.get("Cache-Control"), "no-store");
    assert.equal(result.headers.get("Set-Cookie"), null);
    const restored = await GET(request(""));
    assert.equal((await restored.json()).session?.actorId, "owner-a");
    assert.deepEqual(await result.json(), { code: "STORE_ACCESS_DENIED" });
  });
}

test("DSH 503 outage retains Merchant cookie for a safe retry", async t => {
  mockOwners(t, { dshStatus: 503 });
  process.env.MERCHANT_SYNTHETIC_IDENTITY_ORIGIN = identity;
  process.env.MERCHANT_SYNTHETIC_DSH_ORIGIN = dsh;
  const result = await GET(request());
  assert.equal(result.status, 503);
  assert.equal(result.headers.get("Set-Cookie"), null);
  assert.deepEqual(await result.json(), { code: "OWNER_UNAVAILABLE" });
});

test("Identity 403 invalidation also expires the stale Merchant Web cookie", async t => {
  t.mock.method(globalThis, "fetch", async url => {
    assert.equal(new URL(url).origin, identity);
    return Response.json({ code: "MERCHANT_NOT_ACTIVE" }, {
      status: 403,
      headers: { "Cache-Control": "no-store" },
    });
  });
  process.env.MERCHANT_SYNTHETIC_IDENTITY_ORIGIN = identity;
  const result = await GET(request());
  assert.equal(result.status, 403);
  assert.match(result.headers.get("Set-Cookie") ?? "", /Max-Age=0/);
});

function developmentWithoutConfiguredOwners(t, mode) {
  for (const [name, value] of Object.entries({
    NODE_ENV: mode,
    MERCHANT_SYNTHETIC_IDENTITY_ORIGIN: undefined,
    MERCHANT_SYNTHETIC_DSH_ORIGIN: undefined,
  })) {
    const previous = process.env[name];
    t.after(() => {
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    });
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

test("local Merchant admission recovers when the isolated phone owner becomes available after startup", async t => {
  developmentWithoutConfiguredOwners(t, "development");
  let healthy = false;
  let readinessReads = 0;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const target = new URL(url);
    if (target.pathname === "/v1/customer-auth/phone-challenges") {
      readinessReads++;
      assert.equal(target.origin, "http://127.0.0.1:3201");
      assert.equal(options.redirect, "error");
      assert.ok(!options.headers);
      return new Response(null, { status: healthy ? 405 : 404, headers: { Allow: "POST" } });
    }
    assert.equal(options.headers.Authorization, "Bearer " + bearer);
    if (target.href === "http://127.0.0.1:3201/v1/sessions/current") {
      return json({ actorId: "owner-a", role: "merchant", sessionExpiresAt: expires });
    }
    assert.equal(target.href, "http://127.0.0.1:3202/v1/stores/mine");
    return json({ actorId: "owner-a", stores: [] });
  });
  const initial = await GET(request("", ""));
  assert.deepEqual(await initial.json(), { enabled: false, session: null });
  healthy = true;
  const afterRecovery = await GET(request("", ""));
  assert.deepEqual(await afterRecovery.json(), { enabled: true, session: null });
  const stores = await GET(request());
  assert.deepEqual(await stores.json(), { standing: { actorId: "owner-a", stores: [] } });
  const external = await GET(new Request("https://merchant.example/api/admission"));
  assert.deepEqual(await external.json(), { enabled: false, session: null });
  assert.equal(readinessReads, 3);
});

test("unconfigured production Merchant does not look up a development identity owner", async t => {
  developmentWithoutConfiguredOwners(t, "production");
  const fetch = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("unexpected owner connection");
  });
  const response = await GET(request("", ""));
  assert.deepEqual(await response.json(), { enabled: false, session: null });
  assert.equal(fetch.mock.callCount(), 0);
});

test("Merchant Web logout expires rejected Identity session cookie on 403", async t => {
  process.env.MERCHANT_SYNTHETIC_IDENTITY_ORIGIN = identity;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    assert.equal(options.method, "DELETE");
    assert.equal(options.headers.Authorization, `Bearer ${bearer}`);
    return Response.json({ error: "FORBIDDEN" }, {
      status: 403,
      headers: { "Cache-Control": "no-store" },
    });
  });
  const result = await DELETE(new Request("http://localhost:18102/api/admission", {
    method: "DELETE",
    headers: {
      Origin: "http://localhost:18102",
      Cookie: `bthwani_merchant_admission=${bearer}`,
    },
  }));
  assert.equal(result.status, 204);
  assert.match(result.headers.get("Set-Cookie") ?? "", /Max-Age=0/);
  assert.equal(result.headers.get("Cache-Control"), "no-store");
});

test("Merchant Web logout does not discard cookie on Identity outage", async t => {
  process.env.MERCHANT_SYNTHETIC_IDENTITY_ORIGIN = identity;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    assert.equal(options.method, "DELETE");
    return Response.json({ error: "OWNER_UNAVAILABLE" }, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  });
  const result = await DELETE(new Request("http://localhost:18102/api/admission", {
    method: "DELETE",
    headers: {
      Origin: "http://localhost:18102",
      Cookie: `bthwani_merchant_admission=${bearer}`,
    },
  }));
  assert.equal(result.status, 503);
  assert.equal(result.headers.get("Set-Cookie"), null);
});

test("Merchant browser restores an expired session through Identity without re-entering the phone",async t=>{
  process.env.MERCHANT_SYNTHETIC_IDENTITY_ORIGIN=identity;
  const oldRefresh=Buffer.alloc(32,38).toString("base64url");
  const newAccess=Buffer.alloc(32,39).toString("base64url");
  const newRefresh=Buffer.alloc(32,40).toString("base64url");
  const newExpiry=new Date(Date.now()+15*60_000).toISOString();
  const paths=[];
  t.mock.method(globalThis,"fetch",async(url,options)=>{
    const path=new URL(url).pathname;
    paths.push(path);
    if(path==="/v1/sessions/current" && options.headers.Authorization==="Bearer "+bearer)
      return Response.json({error:"UNAUTHORIZED"},{status:401,headers:{"Cache-Control":"no-store"}});
    if(path==="/v1/sessions/refresh"){
      assert.equal(options.method,"POST");
      assert.equal(options.headers.Authorization,"Bearer "+oldRefresh);
      return json({accessToken:newAccess,sessionExpiresAt:newExpiry,refreshToken:newRefresh,
        refreshExpiresAt:new Date(Date.now()+30*24*60*60_000).toISOString()});
    }
    if(path==="/v1/sessions/current" && options.headers.Authorization==="Bearer "+newAccess)
      return json({actorId:"owner-a",role:"merchant",sessionExpiresAt:newExpiry});
    assert.fail(path);
  });
  const req=new Request("http://localhost:18102/api/admission",{
    headers:{Cookie:"bthwani_merchant_admission="+bearer+"; bthwani_merchant_admission.refresh="+oldRefresh}});
  const result=await GET(req);
  assert.equal(result.status,200);
  assert.deepEqual(await result.json(),{enabled:true,session:{actorId:"owner-a",role:"merchant",sessionExpiresAt:newExpiry}});
  const cookie=result.headers.get("Set-Cookie")??"";
  assert.match(cookie,/bthwani_merchant_admission=/);
  assert.ok(cookie.includes("bthwani_merchant_admission.refresh="));
  assert.deepEqual(paths,["/v1/sessions/current","/v1/sessions/refresh","/v1/sessions/current","/v1/sessions/current"]);
});

test("Merchant logout revokes its persistent refresh family before clearing cookies",async t=>{
  process.env.MERCHANT_SYNTHETIC_IDENTITY_ORIGIN=identity;
  const refresh=Buffer.alloc(32,41).toString("base64url");
  const methods=[];
  t.mock.method(globalThis,"fetch",async(url,options)=>{
    methods.push(options.method+" "+new URL(url).pathname);
    if(options.method==="DELETE" && new URL(url).pathname==="/v1/sessions/refresh"){
      assert.equal(options.headers.Authorization,"Bearer "+refresh);
      return new Response(null,{status:204,headers:{"Cache-Control":"no-store"}});
    }
    if(options.method==="DELETE" && new URL(url).pathname==="/v1/sessions/current"){
      assert.equal(options.headers.Authorization,"Bearer "+bearer);
      return Response.json({error:"UNAUTHORIZED"},{status:401,headers:{"Cache-Control":"no-store"}});
    }
    assert.fail(url);
  });
  const req=new Request("http://localhost:18102/api/admission",{method:"DELETE",headers:{
    Origin:"http://localhost:18102",Cookie:"bthwani_merchant_admission="+bearer+"; bthwani_merchant_admission.refresh="+refresh}});
  const response=await DELETE(req);
  assert.equal(response.status,204);
  assert.deepEqual(methods,["DELETE /v1/sessions/refresh","DELETE /v1/sessions/current"]);
  assert.ok((response.headers.get("Set-Cookie")??"").includes("bthwani_merchant_admission.refresh=;"));
});

test("Concurrent Merchant refresh conflict preserves both cookies", async t => {
  process.env.MERCHANT_SYNTHETIC_IDENTITY_ORIGIN=identity;
  const refresh=Buffer.alloc(32,59).toString("base64url");
  t.mock.method(globalThis,"fetch",async(url,opts)=>{
    const path=new URL(url).pathname;
    if(path==="/v1/sessions/current") return Response.json({error:"UNAUTHORIZED"},{
      status:401,headers:{"Cache-Control":"no-store"}});
    if(path==="/v1/sessions/refresh") {
      assert.equal(opts.headers.Authorization,"Bearer "+refresh);
      return Response.json({error:"CONFLICT"},{status:409,headers:{"Cache-Control":"no-store"}});
    }
    assert.fail(path);
  });
  const req=new Request("http://localhost:18102/api/admission",{
    headers:{Cookie:"bthwani_merchant_admission="+bearer+"; bthwani_merchant_admission.refresh="+refresh},
  });
  const reply=await GET(req);
  assert.equal(reply.status,409);
  assert.equal(reply.headers.get("Set-Cookie"),null);
});

test("Merchant must explicitly sign out before phone verification with a retained refresh family", async t => {
  process.env.MERCHANT_SYNTHETIC_IDENTITY_ORIGIN = identity;
  const refresh = Buffer.alloc(32, 68).toString("base64url");
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    assert.fail("existing session family must not consume another proof");
  });
  const host = "http://localhost:18102";
  for (const existing of ["", "bthwani_merchant_admission=" + bearer + "; "]) {
    const reply = await POST(new Request(host + "/api/admission", {
      method: "POST", headers: { Origin: host, "Content-Type": "application/json",
        Cookie: existing + "bthwani_merchant_admission.refresh=" + refresh },
      body: JSON.stringify({ ticket: "f".repeat(48), code: "123456" }),
    }));
    assert.equal(reply.status, 409);
    assert.deepEqual(await reply.json(), { code: "SIGN_OUT_REQUIRED" });
    assert.equal(reply.headers.get("Set-Cookie"), null);
  }
  assert.equal(calls, 0);
});

test("Merchant admission abandons an aborted stalled JSON body without contacting Identity", async t => {
  process.env.MERCHANT_SYNTHETIC_IDENTITY_ORIGIN = identity;
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; assert.fail("owner contacted"); });
  const abort = new AbortController();
  let cancelled = false;
  let fallback;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"ticket":'));
      fallback = setTimeout(() => controller.close(), 250);
    },
    cancel() { cancelled = true; clearTimeout(fallback); },
  });
  const host = "http://localhost:18102";
  const pending = POST(new Request(host + "/api/admission", {
    method: "POST", headers: { Origin: host, "Content-Type": "application/json" },
    body: stream, duplex: "half", signal: abort.signal,
  }));
  abort.abort();
  try {
    const reply = await pending;
    assert.equal(reply.status, 400);
    assert.equal(cancelled, true);
    assert.equal(calls, 0);
  } finally {
    clearTimeout(fallback);
  }
});

for (const enrollmentFails of [true, false]) {
test("Fresh Merchant proof requires durable enrollment (failure=" + enrollmentFails + ")", async t => {
  process.env.MERCHANT_SYNTHETIC_IDENTITY_ORIGIN = identity;
  const customer = Buffer.alloc(32, 70).toString("base64url");
  const merchant = Buffer.alloc(32, 71).toString("base64url");
  const sessionExpiresAt = new Date(Date.now() + 120000).toISOString();
  const verified = { actorId: "merchant-new", role: "merchant", sessionExpiresAt };
  const calls = [];
  const revoked = [];
  const refresh = Buffer.alloc(32, 72).toString("base64url");
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const path = new URL(url).pathname;
    const credential = options.headers.Authorization;
    calls.push(options.method + " " + path);
    if (path === "/v1/customer-auth/phone-verification") return json({ accessToken: customer, sessionExpiresAt });
    if (path === "/v1/actors/me/merchant-role") {
      assert.equal(credential, "Bearer " + customer);
      return Response.json({ accessToken: merchant, sessionExpiresAt }, { status: 201, headers: {"Cache-Control":"no-store"} });
    }
    if (path === "/v1/sessions/current") {
      if (options.method === "DELETE") {
        revoked.push(credential);
        return new Response(null, { status: 204, headers: {"Cache-Control":"no-store"} });
      }
      return json(credential === "Bearer " + customer ? { ...verified, role: "customer" } : verified);
    }
    if (path === "/v1/sessions/persistent") {
      assert.equal(credential, "Bearer " + merchant);
      if (!enrollmentFails) return Response.json({ refreshToken: refresh, refreshExpiresAt: sessionExpiresAt }, { status: 201, headers: {"Cache-Control":"no-store"} });
      return Response.json({ error: "OWNER_UNAVAILABLE" }, { status: 503, headers: {"Cache-Control":"no-store"} });
    }
    assert.fail(path);
  });
  const host = "http://localhost:18102";
  const reply = await POST(new Request(host + "/api/admission", {
    method: "POST", headers: { Origin: host, "Content-Type": "application/json", Cookie: "bthwani_merchant_admission.refresh=invalid" },
    body: JSON.stringify({ ticket: "f".repeat(48), code: "123456" }),
  }));
  assert.equal(reply.status, enrollmentFails ? 503 : 200);
  if (enrollmentFails) {
    assert.deepEqual(await reply.json(), { code: "OWNER_UNAVAILABLE" });
    assert.equal(reply.headers.get("Set-Cookie"), null);
    assert.deepEqual(revoked, ["Bearer " + customer, "Bearer " + merchant]);
  } else {
    assert.deepEqual(await reply.json(), { session: verified });
    assert.ok(reply.headers.getSetCookie().some(value => value.startsWith("bthwani_merchant_admission=" + merchant + ";")));
    assert.ok(reply.headers.getSetCookie().some(value => value.startsWith("bthwani_merchant_admission.refresh=" + refresh + ";")));
    assert.deepEqual(revoked, ["Bearer " + customer]);
  }
  assert.deepEqual(calls, ["POST /v1/customer-auth/phone-verification", "GET /v1/sessions/current",
    "POST /v1/actors/me/merchant-role", "GET /v1/sessions/current", "DELETE /v1/sessions/current", "POST /v1/sessions/persistent",
    ...(enrollmentFails ? ["DELETE /v1/sessions/current"] : [])]);
});
}

test("Merchant body deadline rejects an unfinished JSON stream even without caller cancellation", async t => {
  process.env.MERCHANT_SYNTHETIC_IDENTITY_ORIGIN = identity;
  t.mock.method(globalThis, "fetch", async () => assert.fail("owner contacted"));
  let streamController;
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) { streamController = controller; },
    cancel() { cancelled = true; },
  });
  const host = "http://localhost:18102";
  const pending = POST(new Request(host + "/api/admission", {
    method: "POST", headers: { Origin: host, "Content-Type": "application/json" },
    body: stream, duplex: "half",
  }));
  let fallback;
  const reply = await Promise.race([pending, new Promise(resolve => { fallback = setTimeout(() => resolve(null), 3500); })]);
  clearTimeout(fallback);
  if (reply === null) {
    streamController.close();
    await pending;
  }
  assert.ok(reply, "body read exceeded its deadline");
  assert.equal(reply.status, 400);
  assert.equal(cancelled, true);
});
