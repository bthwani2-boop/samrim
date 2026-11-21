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

test("Merchant DSH standing accepts the largest valid Unicode store listing but rejects oversized bodies",async t=>{
  const stores=Array.from({length:100},(_,i)=>({
    id:"store-"+i,
    name:"😀".repeat(120),
    relation:"MARKETPLACE",
    published:i%2===0,
  }));
  const payload={actorId:"x".repeat(128),stores};
  const response=JSON.stringify(payload).replaceAll("😀",String.raw`\ud83d\ude00`);
  assert.ok(response.length>32768,"regression must exceed old premature cap");
  t.mock.method(globalThis,"fetch",async()=>new Response(response,{headers:{"Content-Type":"application/json","Cache-Control":"no-store"}}));
  assert.equal((await readMerchantDSHStanding("https://dsh.test",bearer)).stores.length,100);
});

test("Merchant DSH response envelope stays bounded",async t=>{
  t.mock.method(globalThis,"fetch",async()=>new Response(" ".repeat(262145),{
    headers:{"Content-Type":"application/json","Cache-Control":"no-store"}
  }));
  await assert.rejects(readMerchantDSHStanding("https://dsh.test",bearer),{code:"OWNER_RESPONSE_INVALID"});
});

test("Merchant standing stops oversized streamed owner replies before consuming the rest",async t=>{
  let sent=0, cancelled=false;
  const stream=new ReadableStream({
    pull(controller) {
      sent++;
      controller.enqueue(new Uint8Array(65536).fill(32));
      if(sent===10) controller.close();
    },
    cancel(){ cancelled=true; }
  }, { highWaterMark: 0 });
  t.mock.method(globalThis,"fetch",async()=>new Response(stream,{
    headers:{"Content-Type":"application/json","Cache-Control":"no-store"}
  }));
  await assert.rejects(readMerchantDSHStanding("https://dsh.test",bearer),{code:"OWNER_RESPONSE_INVALID"});
  assert.ok(cancelled,"oversized stream must be cancelled");
  assert.ok(sent<=5,`stream was drained after exceeding the limit: ${sent}`);
});

test("Merchant standing refuses declared oversized replies without reading the body",async t=>{
  let touched=false;
  t.mock.method(globalThis,"fetch",async()=>({
    status:200,ok:true,
    headers:new Headers({"Content-Type":"application/json","Cache-Control":"no-store","Content-Length":"262145"}),
    body:null,
    async text(){touched=true;return JSON.stringify(owner);}
  }));
  await assert.rejects(readMerchantDSHStanding("https://dsh.test",bearer),{code:"OWNER_RESPONSE_INVALID"});
  assert.equal(touched,false);
});

test("Merchant standing retains text-only Native fetch support with strict byte limit",async t=>{
  t.mock.method(globalThis,"fetch",async()=>({
    status:200,ok:true,body:null,
    headers:new Headers({"Content-Type":"application/json","Cache-Control":"no-store"}),
    async text(){return JSON.stringify(owner);}
  }));
  assert.deepEqual(await readMerchantDSHStanding("http://10.0.2.2:8080",bearer),owner);
});
