import assert from "node:assert/strict";
import { test } from "node:test";
import { readMerchantDSHStanding } from "../src/features/access/dsh-standing.ts";

const bearer = Buffer.alloc(32,7).toString("base64url");
const owner = { actorId:"merchant-one",stores:[{ id:"store-a",name:"A Store",relation:"MARKETPLACE",published:false }] };
const good = value => Response.json(value,{headers:{"Cache-Control":"no-store"}});
test("Merchant DSH standing verifies owner read and does not send credentials as cookies",async t=>{
  t.mock.method(globalThis,"fetch",async(url,opts)=>{
    assert.equal(new URL(url).pathname,"/v1/stores/mine");
    assert.equal(opts.method,"GET");
    assert.equal(opts.headers.Authorization,"Bearer "+bearer);
    assert.equal(opts.credentials,"omit");
    return good(owner);
  });
  assert.deepEqual(await readMerchantDSHStanding("http://127.0.0.1:8080",bearer),owner);
});
test("Merchant Store standing never accepts a cross-actor or malformed DSH response",async t=>{
  const payload={...owner,stores:[{...owner.stores[0],published:"yes"}]};
  t.mock.method(globalThis,"fetch",async()=>good(payload));
  await assert.rejects(readMerchantDSHStanding("https://dsh.test",bearer),{code:"OWNER_RESPONSE_INVALID"});
});
test("Owner denial and outage fail closed",async t=>{
  t.mock.method(globalThis,"fetch",async()=>Response.json({code:"STORE_OPERATION_FORBIDDEN"},{status:403,headers:{"Cache-Control":"no-store"}}));
  await assert.rejects(readMerchantDSHStanding("https://dsh.test",bearer),{code:"STORE_ACCESS_DENIED"});
});
test("Untrusted endpoint and malformed bearer cannot trigger owner fetch",async t=>{
  let calls=0;t.mock.method(globalThis,"fetch",async()=>{calls++;return good(owner)});
  await assert.rejects(readMerchantDSHStanding("http://evil.example",bearer),{code:"OWNER_UNAVAILABLE"});
  await assert.rejects(readMerchantDSHStanding("https://dsh.test","not-a-bearer"),{code:"UNAUTHENTICATED"});
  assert.equal(calls,0);
});
test("Aborted response cannot revive a previous account's standing",async t=>{
  const controller=new AbortController();
  t.mock.method(globalThis,"fetch",async()=>{controller.abort();return good(owner)});
  await assert.rejects(readMerchantDSHStanding("https://dsh.test",bearer,controller.signal),{code:"OWNER_RESPONSE_STALE"});
});
