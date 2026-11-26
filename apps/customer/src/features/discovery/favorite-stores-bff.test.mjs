import assert from "node:assert/strict";
import { test } from "node:test";

process.env.BTHWANI_DOCKER_CART_WEB_PREVIEW = "1";
process.env.BTHWANI_ISOLATED_TEST_MODE = "true";
process.env.CUSTOMER_SYNTHETIC_DSH_ORIGIN="http://127.0.0.1:3202";
process.env.CUSTOMER_SYNTHETIC_IDENTITY_ORIGIN="http://127.0.0.1:3201";
const { handleCustomerFavorites }=await import("./favorite-stores-bff.ts");
const actor="customer-a", bearer=Buffer.alloc(32,14).toString("base64url");
const base="http://localhost/api/customer-auth/favorite-stores";
const json=value=>Response.json(value,{headers:{"Cache-Control":"no-store"}});
const session=actorId=>({actorId,role:"customer",sessionExpiresAt:"2030-01-01T00:00:00Z"});
function req(method="GET",suffix="",headers={}){
 return new Request(base+suffix,{method,headers:{Cookie:"bthwani_customer_auth="+bearer,"X-Customer-Context":actor,...(method==="PUT"?{Origin:"http://localhost"}:{}),...headers}});
}
test("rejects cross-site commands, duplicate and foreign selectors before owner requests",async t=>{
 let calls=0;t.mock.method(globalThis,"fetch",async()=>{calls++;throw Error("unexpected");});
 for(const [r,method,status] of [
 [new Request(base),"GET",401],
 [req("GET","?actorId=customer-b"),"GET",400],
 [req("PUT","?storeId=store-a&favorite=true&favorite=false"),"PUT",400],
 [req("PUT","?storeId=store-a&favorite=true",{Origin:"https://evil.test"}),"PUT",403],
 [req("GET","",{"Sec-Fetch-Site":"cross-site"}),"GET",403],
 ]) assert.equal((await handleCustomerFavorites(r,method)).status,status);
 assert.equal(calls,0);
});
test("verified Customer reads and changes only their own favorite; late actor changes are withheld",async t=>{
 let calls=[],changed=false,identityReads=0;
 t.mock.method(globalThis,"fetch",async (input,init)=>{
   const url=String(input);calls.push([url,init.method]);
   assert.equal(init.headers.Authorization,"Bearer "+bearer);
   if(url.startsWith("http://127.0.0.1:3201")) return json(session(changed&&++identityReads>1?"customer-b":actor));
   if(init.method==="PUT"){assert.deepEqual(JSON.parse(init.body),{favorite:true});return json({actorId:actor,storeId:"store-a",favorite:true});}
   return json({actorId:actor,storeIds:["store-a"]});
 });
 assert.deepEqual(await (await handleCustomerFavorites(req(),"GET")).json(),{actorId:actor,storeIds:["store-a"]});
 const result=await handleCustomerFavorites(req("PUT","?storeId=store-a&favorite=true"),"PUT");
 assert.equal(result.status,200);
 assert.deepEqual(await result.json(),{actorId:actor,storeId:"store-a",favorite:true});
 assert.deepEqual(calls.map(x=>x[1]),["GET","GET","GET","GET","PUT","GET"]);
 changed=true;identityReads=0;
 assert.equal((await handleCustomerFavorites(req(),"GET")).status,401);
});
