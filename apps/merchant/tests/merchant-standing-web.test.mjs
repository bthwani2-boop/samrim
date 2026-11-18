import assert from "node:assert/strict";
import { test } from "node:test";
import { GET } from "../app/api/admission+api.ts";

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
