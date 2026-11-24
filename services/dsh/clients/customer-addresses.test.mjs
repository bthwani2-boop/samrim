import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateDeliveryServiceability, listCustomerAddresses, parseCustomerAddressPage, parseCustomerAddressResult, parseDeliveryServiceability, saveCustomerAddress } from "./customer-addresses.ts";

const bearer=Buffer.alloc(32,14).toString("base64url");
const origin="http://127.0.0.1:3202";
const actor="customer-a";
const id="addr-00000000000000000000000000000001";
const change={cityId:"sanaa",label:"بيت",details:"عنوان اصطناعي",latitude:15.3,longitude:44.2,expectedVersion:0};
const {expectedVersion:_version,...fields}=change;
const address={id,...fields,version:1};
const page={actorId:actor,items:[address]};
const result={actorId:actor,address,replay:false};
const json=data=>Response.json(data,{headers:{"Cache-Control":"no-store"}});

test("address SDK uses generated private routes, exact payload and no cookies",async t=>{
  const calls=[];
  t.mock.method(globalThis,"fetch",async(url,init)=>{
    calls.push([url.toString(),init.method,init.credentials]);
    assert.equal(init.headers.Authorization,`Bearer ${bearer}`);
    if(init.method==="PUT"){assert.deepEqual(JSON.parse(init.body),change);return json(result);}
    return json(page);
  });
  assert.deepEqual(await listCustomerAddresses(origin,bearer,actor),page);
  assert.deepEqual(await saveCustomerAddress(origin,bearer,actor,id,change),result);
  assert.deepEqual(calls,[[`${origin}/v1/addresses`,"GET","omit"],[`${origin}/v1/addresses/${id}`,"PUT","omit"]]);
});
test("SDK rejects mismatched actor, stale resource or invalid coordinate",()=>{
  for(const bad of [{...page,actorId:"customer-b"},{...page,items:[address,address]},
    {...page,items:[{...address,latitude:91}]},{...page,nextCursor:id},
    {...page,items:[{...address,recipientPhone:"private"}]}]) {
    assert.throws(()=>parseCustomerAddressPage(bad,actor),{code:"OWNER_RESPONSE_INVALID"});
  }
  for(const bad of [{...result,actorId:"customer-b"},{...result,address:{...address,version:2}},
    {...result,address:{...address,label:"changed"}}]) {
    assert.throws(()=>parseCustomerAddressResult(bad,actor,id,change),{code:"OPERATION_RESULT_UNKNOWN"});
  }
});
test("bad input never dispatches; lost acknowledgement is unknown",async t=>{
  let calls=0;
  t.mock.method(globalThis,"fetch",async()=>{calls++;throw new Error("lost acknowledgement");});
  for(const invalid of [{...change,latitude:NaN},{...change,longitude:181},{...change,expectedVersion:-1},
    {...change,actorId:"customer-b"},{...change,label:"\u0000"}]) {
    await assert.rejects(saveCustomerAddress(origin,bearer,actor,id,invalid),{code:"INVALID_REQUEST"});
  }
  assert.equal(calls,0);
  await assert.rejects(saveCustomerAddress(origin,bearer,actor,id,change),{code:"OPERATION_RESULT_UNKNOWN"});
  assert.equal(calls,1);
});


test("serviceability SDK binds current actor, store, address and coherent policy evidence",async t=>{
  const value={actorId:actor,storeId:"store-a",addressId:id,status:"SERVICEABLE",evidence:{
    storeCityId:"sanaa",addressCityId:"sanaa",addressVersion:1,policyVersion:2,radiusMetres:30000,distanceMetres:30000}};
  let calls=0;
  t.mock.method(globalThis,"fetch",async(input,init)=>{
    calls++;assert.equal(input.toString(),`${origin}/v1/carts/store-a/serviceability?addressId=${id}`);
    assert.equal(init.method,"GET");assert.equal(init.credentials,"omit");return json(value);
  });
  assert.deepEqual(await evaluateDeliveryServiceability(origin,bearer,actor,"store-a",id),value);
  for(const bad of [{...value,actorId:"customer-b"},{...value,addressId:"addr-00000000000000000000000000000002"},
    {...value,storeId:"store-b"},{...value,status:"UNAVAILABLE"},
    {...value,evidence:{...value.evidence,distanceMetres:30001}},
    {...value,evidence:{...value.evidence,addressCityId:"aden"}},
    {...value,evidence:{...value.evidence,latitude:15.3}},
    {...value,evidence:{...value.evidence,policyVersion:0}}]) {
    assert.throws(()=>parseDeliveryServiceability(bad,actor,"store-a",id),{code:"OWNER_RESPONSE_INVALID"});
  }
  await assert.rejects(evaluateDeliveryServiceability(origin,bearer,actor,"store-a","invalid"),{code:"INVALID_REQUEST"});
  assert.equal(calls,1);
  const unknown={actorId:actor,storeId:"store-a",addressId:id,status:"UNAVAILABLE"};
  assert.deepEqual(parseDeliveryServiceability(unknown,actor,"store-a",id),unknown);
});
