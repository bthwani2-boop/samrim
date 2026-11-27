import assert from "node:assert/strict";
import { test } from "node:test";
import { configuredOrigin, readMutationBody } from "./browser-admission-http.ts";

const encoder = new TextEncoder();
const jsonHeaders = new Headers({"Content-Type":"application/json"});
const read = (body, headers = jsonHeaders, signal = new AbortController().signal, limit = 64) =>
  readMutationBody({body,headers,signal},limit);

test("unadmitted request metadata cancels unread bodies",async()=>{
  for(const headers of [
    new Headers(),
    new Headers({"Content-Type":"text/plain"}),
    new Headers({"Content-Type":"application/json","Content-Length":"65"}),
    new Headers({"Content-Type":"application/json","Content-Length":""}),
    new Headers({"Content-Type":"application/json","Content-Length":"invalid"}),
  ]){
    let cancelled=0;
    const stream=new ReadableStream({start(c){c.enqueue(encoder.encode('{"ok":true}'));},cancel(){cancelled++;}});
    const hold=setTimeout(()=>{},3000);
    try{assert.equal(await read(stream,headers),null);}
    finally{clearTimeout(hold);}
    assert.equal(cancelled,1);
    assert.equal(stream.locked,false);
  }
});

test("locked and absent bodies are rejected without taking ownership",async()=>{
  assert.equal(await read(null),null);
  const stream=new ReadableStream({});
  const reader=stream.getReader();
  try{assert.equal(await read(stream),null);assert.equal(stream.locked,true);}
  finally{await reader.cancel();reader.releaseLock();}
});

test("pre-cancelled bodies are rejected and released",async()=>{
  const c=new AbortController();c.abort();
  let cancelled=0;
  const stream=new ReadableStream({start(s){s.enqueue(encoder.encode('{"ok":true}'));},cancel(){cancelled++;}});
  assert.equal(await read(stream,jsonHeaders,c.signal),null);
  assert.equal(cancelled,1);
  assert.equal(stream.locked,false);
});

test("valid JSON media type is case insensitive and split UTF-8 respects the exact bound",async()=>{
  const data=encoder.encode('{"name":"صنعاء"}');
  const stream=new ReadableStream({start(s){s.enqueue(data.subarray(0,10));s.enqueue(data.subarray(10));s.close();}});
  assert.deepEqual(await read(stream,new Headers({"Content-Type":"Application/JSON; charset=utf-8","Content-Length":String(data.length)}),undefined,data.length),{name:"صنعاء"});
  assert.equal(stream.locked,false);
});

test("invalid JSON, invalid UTF-8, stream failure and actual overflow fail closed",async()=>{
  for(const data of [encoder.encode("{"),Uint8Array.of(255),encoder.encode('{"long":"123456"}')]){
    const stream=new ReadableStream({start(s){s.enqueue(data);s.close();}});
    assert.equal(await read(stream,jsonHeaders,undefined,8),null);
    assert.equal(stream.locked,false);
  }
  const errored=new ReadableStream({start(s){s.error(new Error("read failed"));}});
  assert.equal(await read(errored),null);
  assert.equal(errored.locked,false);
});

test("abort interrupts a stalled body and failed cleanup cannot hide rejection",async()=>{
  const c=new AbortController();
  let cancelled=0;
  const stream=new ReadableStream({pull(){return new Promise(()=>{});},cancel(){cancelled++;throw new Error("cleanup failed");}});
  const pending=read(stream,jsonHeaders,c.signal);
  c.abort();
  assert.equal(await pending,null);
  assert.equal(cancelled,1);
  assert.equal(stream.locked,false);
});

test("absolute deadline releases stalled body and next request succeeds",async()=>{
  let cancelled=0;
  const stream=new ReadableStream({pull(){return new Promise(()=>{});},cancel(){cancelled++;}});
  const hold=setTimeout(()=>{},3000);
  try{assert.equal(await read(stream),null);}
  finally{clearTimeout(hold);}
  assert.equal(cancelled,1);
  assert.equal(stream.locked,false);
  assert.deepEqual(await read(new Response('{"ok":true}').body),{ok:true});
});

test("readiness is not held by a stalled response cancellation",async t=>{
  const prev=process.env.NODE_ENV;
  const prevOrigin=process.env.MERCHANT_SYNTHETIC_IDENTITY_ORIGIN;
  process.env.NODE_ENV="development";
  delete process.env.MERCHANT_SYNTHETIC_IDENTITY_ORIGIN;
  t.after(()=>{if(prev===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=prev;if(prevOrigin===undefined)delete process.env.MERCHANT_SYNTHETIC_IDENTITY_ORIGIN;else process.env.MERCHANT_SYNTHETIC_IDENTITY_ORIGIN=prevOrigin;});
  let cancelled=0;
  t.mock.method(globalThis,"fetch",async()=>new Response(new ReadableStream({cancel(){cancelled++;return new Promise(()=>{});}}),{status:405,headers:{Allow:"POST"}}));
  let timer;
  try{
    assert.equal(await Promise.race([configuredOrigin(new Request("http://localhost/api/admission")),new Promise(resolve=>{timer=setTimeout(()=>resolve("stalled"),100);})]),"http://127.0.0.1:3201");
    assert.equal(cancelled,1);
  }finally{clearTimeout(timer);}
});

test("readiness rejects unavailable and malformed owner replies without waiting for cleanup",async t=>{
  const before={NODE_ENV:process.env.NODE_ENV,MERCHANT_SYNTHETIC_IDENTITY_ORIGIN:process.env.MERCHANT_SYNTHETIC_IDENTITY_ORIGIN};
  process.env.NODE_ENV="development";
  delete process.env.MERCHANT_SYNTHETIC_IDENTITY_ORIGIN;
  t.after(()=>{for(const [key,value] of Object.entries(before)){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
  const request=new Request("http://localhost/api/admission");
  let reply=()=>Promise.reject(new Error("owner unavailable"));
  t.mock.method(globalThis,"fetch",()=>reply());
  assert.equal(await configuredOrigin(request),undefined);
  reply=()=>Promise.resolve(new Response(null,{status:405}));
  assert.equal(await configuredOrigin(request),undefined);
  reply=()=>Promise.resolve(new Response(new ReadableStream({cancel(){throw new Error("cleanup rejected");}}),{status:405,headers:{Allow:"POST"}}));
  assert.equal(await configuredOrigin(request),"http://127.0.0.1:3201");
});

test("unadmitted request cancellation rejection remains a closed result",async()=>{
  const body=new ReadableStream({cancel(){throw new Error("cleanup rejected");}});
  assert.equal(await read(body,new Headers()),null);
  assert.equal(body.locked,false);
});
