import assert from "node:assert/strict";
import { test } from "node:test";
import { GET, PATCH } from "../app/api/admission+api.ts";

test("Store profile BFF binds the owner, exact command, current session and same-origin mutation", async t => {
  const identity = "http://127.0.0.1:13310", dsh = "http://127.0.0.1:13311";
  const bearer = Buffer.alloc(32, 12).toString("base64url");
  const env = ["MERCHANT_SYNTHETIC_IDENTITY_ORIGIN", "MERCHANT_SYNTHETIC_DSH_ORIGIN"];
  const previous = env.map(k => process.env[k]);
  process.env[env[0]] = identity;
  process.env[env[1]] = dsh;
  t.after(() => env.forEach((key, i) => {
    if (previous[i] === undefined) delete process.env[key]; else process.env[key] = previous[i];
  }));
  const profile = { storeId:"store-a",actorId:"merchant-a",name:"متجر",description:"",published:false,version:1 };
  const change = {operationId:"profile-operation-1",expectedVersion:1,name:"متجر جديد",description:"وصف"};
  const result = {profile:{...profile,name:change.name,description:change.description,version:2},replay:false};
  const reply = (value,status=200) => Response.json(value,{status,headers:{"Cache-Control":"no-store"}});
  let role = "merchant", ownerStatus=200, forged=false;
  const calls=[];
  t.mock.method(globalThis,"fetch",async (url,config)=>{
    const target=new URL(url);
    calls.push(target.pathname);
    assert.equal(config.credentials,"omit");
    assert.equal(config.headers.Authorization,"Bearer "+bearer);
    if(target.origin===identity) return reply({actorId:"merchant-a",role,sessionExpiresAt:new Date(Date.now()+120000).toISOString()});
    assert.equal(target.origin,dsh);
    assert.equal(target.pathname,"/v1/stores/store-a/profile");
    if(ownerStatus!==200) return reply({code:"STORE_PROFILE_VERSION_CONFLICT"},ownerStatus);
    if(config.method==="PATCH") {
      assert.deepEqual(JSON.parse(config.body),change);
      return reply(forged?{...result,profile:{...result.profile,actorId:"merchant-b"}}:result);
    }
    return reply(forged?{...profile,actorId:"merchant-b"}:profile);
  });
  const request = (method="GET",query="profile=store-a",actor="merchant-a",token=bearer,origin="http://localhost:18102",body=change) => new Request("http://localhost:18102/api/admission?"+query,{
    method,headers:{...(token?{Cookie:"bthwani_merchant_admission="+token}:{}),"X-Merchant-Context":actor,Origin:origin,"Content-Type":"application/json"},
    ...(method==="PATCH"?{body:JSON.stringify(body)}:{})
  });
  let response=await GET(request());
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{profile});
  response=await PATCH(request("PATCH"));
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),result);
  assert.equal(calls.filter(p=>p.endsWith("/profile")).length,2);
  for(const query of ["profile=store-a&profile=store-b","profile=../x","profile=store-a&availability=store-a"]) {
    assert.equal((await GET(request("GET",query))).status,400);
    assert.equal((await PATCH(request("PATCH",query))).status,400);
  }
  assert.equal((await GET(request("GET","profile=store-a","merchant-a",""))).status,401);
  assert.equal((await PATCH(request("PATCH","profile=store-a","merchant-b"))).status,403);
  assert.equal((await PATCH(request("PATCH","profile=store-a","merchant-a",bearer,"https://evil.test"))).status,403);
  assert.equal((await PATCH(request("PATCH","profile=store-a","merchant-a",bearer,"http://localhost:18102",{...change,published:true}))).status,400);
  role="customer";
  assert.equal((await GET(request())).status,401);
  role="merchant";
  assert.equal(calls.filter(p=>p.endsWith("/profile")).length,2);
  ownerStatus=409;
  assert.equal((await PATCH(request("PATCH"))).status,409);
  ownerStatus=200;forged=true;
  assert.equal((await GET(request())).status,503);
  assert.equal((await PATCH(request("PATCH"))).status,503);
});
