import assert from "node:assert/strict";
import { test } from "node:test";
import { changeMerchantStoreProfile, confirmMerchantStoreProfileResult, getMerchantStoreProfile, parseMerchantStoreProfile, validMerchantStoreProfileChange } from "./merchant-profile.ts";

const change={operationId:"profile-operation-001",expectedVersion:1,name:"متجر",description:"وصف"};
const profile={storeId:"store-a",actorId:"merchant-a",name:change.name,description:change.description,published:false,version:2};
test("profile command exact and bounded",()=>{
 assert.equal(validMerchantStoreProfileChange(change),true);
 for(const value of [null,{...change,name:" "},{...change,description:null},{...change,published:false},{...change,expectedVersion:0},{...change,expectedVersion:Number.MAX_SAFE_INTEGER},{...change,description:"\u0000"},{...change,description:"x".repeat(1001)}]) assert.equal(validMerchantStoreProfileChange(value),false);
});
test("profile scope and exact command receipt",()=>{
 assert.deepEqual(parseMerchantStoreProfile(profile,"store-a","merchant-a"),profile);
 for(const p of [{...profile,actorId:"merchant-b"},{...profile,storeId:"store-b"},{...profile,version:0},{...profile,unknown:1}]) assert.throws(()=>parseMerchantStoreProfile(p,"store-a","merchant-a"),{code:"OWNER_RESPONSE_INVALID"});
 assert.deepEqual(confirmMerchantStoreProfileResult({profile,replay:true},"store-a","merchant-a",change),{profile,replay:true});
 for(const p of [{...profile,published:true},{...profile,name:"different"},{...profile,description:""},{...profile,version:3}]) assert.throws(()=>confirmMerchantStoreProfileResult({profile:p,replay:false},"store-a","merchant-a",change),{code:"OPERATION_RESULT_UNKNOWN"});
});
test("generated owner endpoints send only exact profile command",async t=>{
 const calls=[];
 t.mock.method(globalThis,"fetch",async (url,init)=>{
  calls.push([url,init]);
  return Response.json(init.method==="GET"?profile:{profile,replay:false},{headers:{"Cache-Control":"no-store"}});
 });
 const origin="http://127.0.0.1:33222",bearer="synthetic-token";
 assert.deepEqual(await getMerchantStoreProfile(origin,"store-a","merchant-a",bearer),profile);
 assert.deepEqual(await changeMerchantStoreProfile(origin,"store-a","merchant-a",bearer,change),{profile,replay:false});
 assert.equal(calls[0][0],origin+"/v1/stores/store-a/profile");
 assert.equal(calls[1][1].method,"PATCH");
 assert.deepEqual(JSON.parse(calls[1][1].body),change);
 await assert.rejects(getMerchantStoreProfile(origin,"../other","merchant-a",bearer),{code:"STORE_ID_INVALID"});
 await assert.rejects(changeMerchantStoreProfile(origin,"store-a","merchant-a",bearer,{...change,name:""}),{code:"INVALID_STORE_PROFILE"});
 assert.equal(calls.length,2);
});
