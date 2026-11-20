import assert from "node:assert/strict";
import { test } from "node:test";
import { DELETE, GET } from "../app/api/admission+api.ts";

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
  test(`DSH ${deniedStatus} owner denial expires the stale Merchant Web cookie`, async t => {
    mockOwners(t, { dshStatus: deniedStatus });
    process.env.MERCHANT_SYNTHETIC_IDENTITY_ORIGIN = identity;
    process.env.MERCHANT_SYNTHETIC_DSH_ORIGIN = dsh;
    const result = await GET(request());
    assert.equal(result.status, deniedStatus);
    assert.equal(result.headers.get("Cache-Control"), "no-store");
    assert.match(result.headers.get("Set-Cookie") ?? "", /^bthwani_merchant_admission=; Path=\/api\/admission; HttpOnly; SameSite=Strict; Max-Age=0$/);
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
