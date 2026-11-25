import assert from "node:assert/strict";
import { test } from "node:test";

process.env.BTHWANI_DOCKER_CART_WEB_PREVIEW = "1";
process.env.BTHWANI_ISOLATED_TEST_MODE = "true";
process.env.CUSTOMER_SYNTHETIC_DSH_ORIGIN="http://127.0.0.1:3202";
process.env.CUSTOMER_SYNTHETIC_IDENTITY_ORIGIN="http://127.0.0.1:3201";
const {handleCustomerAddresses}=await import("./address-bff.ts");
const {GET,PUT}=await import("../../../app/api/customer-auth/addresses+api.ts");
const bearer=Buffer.alloc(32,14).toString("base64url");
const actor="customer-a";
const id="addr-00000000000000000000000000000001";
const base="http://localhost/api/customer-auth/addresses";
const change={cityId:"sanaa",label:"بيت",details:"عنوان اصطناعي",latitude:15.3,longitude:44.2,expectedVersion:0};
const {expectedVersion:_version,...fields}=change;
const address={id,...fields,version:1};
const page={actorId:actor,items:[address]};
const result={actorId:actor,address,replay:false};
const session=actorId=>({actorId,role:"customer",sessionExpiresAt:"2030-01-01T00:00:00Z"});
const json=(body,status=200)=>Response.json(body,{status,headers:{"Cache-Control":"no-store"}});
function request(method="GET",url=base,headers={},body=change){
  return new Request(url,{method,headers:{Cookie:`bthwani_customer_auth=${bearer}`,"X-Customer-Context":actor,
    ...(method==="PUT"?{Origin:"http://localhost","Content-Type":"application/json"}:{}),...headers},
    ...(method==="PUT"?{body:JSON.stringify(body)}:{})});
}
test("address BFF rejects cross-site, malformed selectors and foreign commands before owner traffic",async t=>{
  let calls=0;t.mock.method(globalThis,"fetch",async()=>{calls++;throw Error("unexpected");});
  for(const [req,method,status] of [
    [new Request(base),"GET",401],
    [request("GET",base,{"Sec-Fetch-Site":"cross-site"}),"GET",403],
    [request("GET",base+"?actorId=customer-b"),"GET",400],
    [request("GET",base+"?after=x&after=y"),"GET",400],
    [request("PUT",base+"?addressId="+id,{Origin:"http://evil.test"}),"PUT",403],
    [request("PUT",base+"?addressId="+id,{}, {...change,actorId:"customer-b"}),"PUT",400],
  ]){
    const reply=await (method==="PUT"?PUT:GET)(req);assert.equal(reply.status,status);assert.equal(reply.headers.get("Cache-Control"),"no-store");
  }
  assert.equal(calls,0);
});
test("address BFF verifies current actor before and after DSH read and write",async t=>{
  const events=[];
  t.mock.method(globalThis,"fetch",async(input,init)=>{
    const url=input.toString();events.push([url,init.method,init.credentials]);
    assert.equal(init.headers.Authorization,`Bearer ${bearer}`);
    if(url.startsWith("http://127.0.0.1:3201"))return json(session(actor));
    if(init.method==="PUT"){assert.deepEqual(JSON.parse(init.body),change);return json(result);}
    return json(page);
  });
  const list=await GET(request());
  assert.equal(list.status,200);assert.deepEqual(await list.json(),page);
  const save=await PUT(request("PUT",base+"?addressId="+id));
  assert.equal(save.status,200);assert.deepEqual(await save.json(),result);
  assert.deepEqual(events.map(e=>e[1]),["GET","GET","GET","GET","PUT","GET"]);
  assert.equal(events[1][0],"http://127.0.0.1:3202/v1/addresses");
  assert.equal(events[4][0],`http://127.0.0.1:3202/v1/addresses/${id}`);
  assert.ok(events.every(e=>e[2]==="omit"));
});
test("address BFF never dispatches for a changed actor and hides a late owner response",async t=>{
  let reads=0,owner=0,switched=true;
  t.mock.method(globalThis,"fetch",async input=>{
    if(input.toString().startsWith("http://127.0.0.1:3201")){
      reads++;return json(session(switched||reads>1?"customer-b":actor));
    }
    owner++;return json(page);
  });
  assert.equal((await GET(request())).status,403);
  assert.equal(owner,0);
  switched=false;reads=0;
  const late=await GET(request());
  assert.equal(late.status,401);assert.deepEqual(await late.json(),{error:"UNAUTHORIZED"});
  assert.equal(owner,1);
});
test("exact address read uses the current actor and withholds a response after an account change", async t => {
  let ownerReads = 0;
  let identityReads = 0;
  let switchAfterRead = false;
  const value = {actorId:actor,address};
  const lookup = `${base}?addressId=${id}`;
  t.mock.method(globalThis,"fetch",async(input,init) => {
    if (input.toString().startsWith("http://127.0.0.1:3201")) {
      identityReads++;
      return json(session(switchAfterRead && identityReads === 2 ? "customer-b" : actor));
    }
    ownerReads++;
    assert.equal(input.toString(),`http://127.0.0.1:3202/v1/addresses/${id}`);
    assert.equal(init.method,"GET");
    return json(value);
  });
  assert.equal((await GET(request("GET",lookup+"&after="+id))).status,400);
  assert.equal(ownerReads,0);
  const accepted = await GET(request("GET",lookup));
  assert.equal(accepted.status,200);
  assert.deepEqual(await accepted.json(),value);
  switchAfterRead = true;
  identityReads = 0;
  const late = await GET(request("GET",lookup));
  assert.equal(late.status,401);
  assert.deepEqual(await late.json(),{error:"UNAUTHORIZED"});
  assert.equal(ownerReads,2);
});
test("lost address mutation outcome is not reported as rejected or retried",async t=>{
  let owner=0;
  t.mock.method(globalThis,"fetch",async input=>{
    if(input.toString().startsWith("http://127.0.0.1:3201"))return json(session(actor));
    owner++;throw Error("lost reply");
  });
  const reply=await PUT(request("PUT",base+"?addressId="+id));
  assert.equal(reply.status,503);assert.deepEqual(await reply.json(),{error:"OPERATION_RESULT_UNKNOWN"});assert.equal(owner,1);
});


test("serviceability BFF binds actor and both resource selectors; denies cross-context and late replies",async t=>{
  const path="http://localhost/api/customer-auth/serviceability?storeId=store-a&addressId="+id;
  let calls=0,identityReads=0,switched=false;
  const value={actorId:actor,storeId:"store-a",addressId:id,status:"SERVICEABLE",evidence:{
    storeCityId:"sanaa",addressCityId:"sanaa",addressVersion:1,policyVersion:1,radiusMetres:30000,distanceMetres:10}};
  t.mock.method(globalThis,"fetch",async(input,init)=>{
    if(input.toString().startsWith("http://127.0.0.1:3201")){
      identityReads++;return json(session(switched&&identityReads>1?"customer-b":actor));
    }
    calls++;assert.equal(input.toString(),`http://127.0.0.1:3202/v1/carts/store-a/serviceability?addressId=${id}`);
    assert.equal(init.method,"GET");return json(value);
  });
  for(const req of [request("GET",path+"&actorId=customer-b"),request("GET",path+"&storeId=store-b"),request("GET",path+"&addressId="+id)]){
    assert.equal((await handleCustomerAddresses(req,"SERVICEABILITY")).status,400);
  }
  assert.equal(calls,0);
  const accepted=await handleCustomerAddresses(request("GET",path),"SERVICEABILITY");
  assert.equal(accepted.status,200);assert.deepEqual(await accepted.json(),value);
  switched=true;identityReads=0;
  const late=await handleCustomerAddresses(request("GET",path),"SERVICEABILITY");
  assert.equal(late.status,401);assert.deepEqual(await late.json(),{error:"UNAUTHORIZED"});
  assert.equal(calls,2);
});
