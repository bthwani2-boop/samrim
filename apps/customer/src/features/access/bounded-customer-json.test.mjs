import assert from "node:assert/strict";
import { test } from "node:test";
import { discardCustomerResponse, readBoundedCustomerJSON } from "./bounded-customer-json.ts";

const headers = new Headers({"Content-Type":"application/json"});
const encoder = new TextEncoder();
const read = (body, signal = new AbortController().signal, metadata = headers, limit = 8192) =>
  readBoundedCustomerJSON({headers:metadata,body,signal},limit);

test("reject an already cancelled buffered response without exposing its payload", async () => {
  const c = new AbortController();
  c.abort();
  let cancelled = 0;
  const stream = new ReadableStream({start(s){s.enqueue(encoder.encode('{"actorId":"old"}'));},cancel(){cancelled++;}});
  assert.equal(await read(stream,c.signal),null);
  assert.equal(cancelled,1);
  assert.equal(stream.locked,false);
});

test("cancel unadmitted response without consuming it", async () => {
  for (const metadata of [new Headers({"Content-Type":"text/plain"}),new Headers({"Content-Type":"application/json","Content-Length":""}),new Headers({"Content-Type":"application/json","Content-Length":"99999"}),new Headers({"Content-Type":"application/json","Content-Length":"oops"})]) {
    let cancelled=0;
    const stream=new ReadableStream({cancel(){cancelled++;}});
    assert.equal(await read(stream,undefined,metadata),null);
    assert.equal(cancelled,1);
    assert.equal(stream.locked,false);
  }
});

test("locked and absent bodies fail closed without stealing the reader",async()=>{
  assert.equal(await read(null),null);
  const stream=new ReadableStream({});
  const reader=stream.getReader();
  try {assert.equal(await read(stream),null);assert.equal(stream.locked,true);}
  finally {await reader.cancel();reader.releaseLock();}
});

test("valid split UTF-8 JSON and exact limit are accepted",async()=>{
  const bytes=encoder.encode('{"name":"صنعاء"}');
  const stream=new ReadableStream({start(s){s.enqueue(bytes.subarray(0,10));s.enqueue(bytes.subarray(10));s.close();}});
  assert.deepEqual(await read(stream,undefined,headers,bytes.length),{name:"صنعاء"});
  assert.equal(stream.locked,false);
});

test("invalid JSON, UTF-8 and actual oversized payload are rejected",async()=>{
  for(const bytes of [encoder.encode("{"),Uint8Array.of(255),encoder.encode('{"long":"12345"}')]){
    const stream=new ReadableStream({start(s){s.enqueue(bytes);s.close();}});
    assert.equal(await read(stream,undefined,headers,8),null);
    assert.equal(stream.locked,false);
  }
});

test("abort during pending read settles and releases ownership",async()=>{
  const c=new AbortController();
  let cancel=0;
  const stream=new ReadableStream({pull(){return new Promise(()=>{});},cancel(){cancel++;}});
  const pending=read(stream,c.signal);
  c.abort();
  assert.equal(await pending,null);
  assert.equal(cancel,1);
  assert.equal(stream.locked,false);
});

test("absolute body deadline cancels stalled stream and a subsequent valid read works",async()=>{
  let cancel=0;
  const stream=new ReadableStream({pull(){return new Promise(()=>{});},cancel(){cancel++;}});
  const hold=setTimeout(()=>{},3000);
  try {assert.equal(await read(stream),null);}
  finally {clearTimeout(hold);}
  assert.equal(cancel,1);
  assert.equal(stream.locked,false);
  assert.deepEqual(await read(new Response('{"ok":true}').body),{ok:true});
});


test("missing media type and rejected cleanup do not admit a response",async()=>{
  const stream=new ReadableStream({cancel(){throw new Error("synthetic cancel failure");}});
  assert.equal(await read(stream,undefined,new Headers()),null);
  assert.equal(stream.locked,false);
});

test("stream failure and failed overflow cleanup fail closed",async()=>{
  const errored=new ReadableStream({start(s){s.error(new Error("synthetic read failure"));}});
  assert.equal(await read(errored),null);
  assert.equal(errored.locked,false);
  const large=new ReadableStream({start(s){s.enqueue(encoder.encode('{"large":true}'));},cancel(){throw new Error("synthetic cleanup failure");}});
  assert.equal(await read(large,undefined,headers,8),null);
  assert.equal(large.locked,false);
});

test("valid advertised length and JSON charset are admitted",async()=>{
  const stream=new Response('{"ok":true}').body;
  assert.deepEqual(await read(stream,undefined,new Headers({"Content-Type":"application/json; charset=utf-8","Content-Length":"11"}),11),{ok:true});
});

test("synchronous adapter cleanup failure preserves rejected body admission", async () => {
  const body = { locked: false, cancel() { throw new Error("synthetic synchronous cancel failure"); } };
  assert.equal(await read(body,undefined,new Headers()), null);
});
test("unread response disposal never waits, steals a reader or changes a rejection", async () => {
  let cancelled = 0;
  const pending = new Response(new ReadableStream({cancel() { cancelled++; return new Promise(() => {}); }}));
  assert.equal(discardCustomerResponse(pending), undefined);
  assert.equal(cancelled, 1);
  const locked = new Response(new ReadableStream({cancel() { assert.fail("locked body"); }}));
  const reader = locked.body.getReader();
  try { assert.equal(discardCustomerResponse(locked), undefined); assert.equal(locked.body.locked, true); }
  finally { reader.releaseLock(); }
  for (const reply of [
    {get body() { throw new Error("adapter accessor"); }},
    {bodyUsed:false,body:{locked:false,cancel(){throw new Error("sync");}}},
    {bodyUsed:false,body:{locked:false,cancel(){return Promise.reject(new Error("async"));}}},
    {bodyUsed:true,body:{locked:false,cancel(){assert.fail("consumed body");}}},
  ]) assert.equal(discardCustomerResponse(reply), undefined);
  await new Promise(resolve => setImmediate(resolve));
});

test("unencoded JSON requires exact declared UTF-8 bytes and unambiguous framing", async () => {
  const payload = '{"name":"صنعاء"}';
  const bytes = encoder.encode(payload);
  for (const extra of [
    {"Content-Length":"0"},
    {"Content-Length":String(payload.length)},
    {"Content-Length":String(bytes.length+1)},
    {"Content-Length":String(bytes.length),"Transfer-Encoding":"chunked"},
    {"Transfer-Encoding":"gzip, chunked"},
  ]) {
    const response = new Response(payload,{headers:{"Content-Type":"application/json",...extra}});
    assert.equal(await read(response.body,undefined,response.headers),null,JSON.stringify(extra));
    assert.equal(response.body.locked,false);
  }
  for (const extra of [{"Content-Length":String(bytes.length)},{"Transfer-Encoding":"chunked"},{}]) {
    const response = new Response(payload,{headers:{"Content-Type":"application/json",...extra}});
    assert.deepEqual(await read(response.body,undefined,response.headers),{name:"صنعاء"});
  }
});

test("decoded browser compression retains the decoded byte ceiling without equating wire length", async () => {
  const payload='{"ok":true}';
  const metadata=new Headers({"Content-Type":"application/json","Content-Encoding":"gzip","Content-Length":"25"});
  assert.deepEqual(await read(new Response(payload).body,undefined,metadata,32),{ok:true});
  assert.equal(await read(new Response('{"long":"'+ "x".repeat(40)+'"}').body,undefined,metadata,32),null);
  const unknown=new Headers({"Content-Type":"application/json","Content-Encoding":"unknown"});
  assert.equal(await read(new Response(payload).body,undefined,unknown),null);
});

test("failed metadata and reader acquisition dispose only the unowned body", async () => {
  for (const failure of ["headers","acquire"]) {
    let cancel=0;
    const stream={
      locked:false,
      getReader(){throw new Error("reader acquisition");},
      cancel(){cancel++;return Promise.resolve();},
    };
    const message={body:stream,signal:new AbortController().signal,
      get headers(){if(failure==="headers")throw new Error("headers");return headers;}};
    assert.equal(await readBoundedCustomerJSON(message),null);
    assert.equal(cancel,1,failure);
  }
});

test("invalid bounds and non-byte chunks are rejected without leaving the reader locked", async () => {
  for (const limit of [0,-1,NaN,1.5,Infinity]) {
    let cancel=0;
    const stream=new ReadableStream({cancel(){cancel++;}});
    assert.equal(await read(stream,undefined,headers,limit),null);
    assert.equal(cancel,1);
  }
  const stream=new ReadableStream({start(s){s.enqueue([123,125]);s.close();}});
  assert.equal(await read(stream),null);
  assert.equal(stream.locked,false);
});

test("inbound Request rejects compressed bodies rather than treating wire bytes as decoded", async () => {
  const payload='{"ok":true}';
  const encoded = new Request("http://127.0.0.1/api/customer-auth", {
    method:"POST", headers:{"Content-Type":"application/json","Content-Encoding":"gzip"}, body:payload,
  });
  assert.equal(await readBoundedCustomerJSON(encoded),null);
  const plain = new Request("http://127.0.0.1/api/customer-auth", {
    method:"POST", headers:{"Content-Type":"application/json","Content-Length":String(encoder.encode(payload).length)},body:payload,
  });
  assert.deepEqual(await readBoundedCustomerJSON(plain),{ok:true});
});

test("actual loopback Fetch decodes gzip and retains wire length without bypassing the body bound", async () => {
  const {createServer}=await import("node:http");
  const {gzipSync}=await import("node:zlib");
  const payload='{"name":"صنعاء"}';
  const compressed=gzipSync(payload);
  const server=createServer((_req,res)=>{
    res.writeHead(200,{"Content-Type":"application/json","Content-Encoding":"gzip","Content-Length":compressed.length});
    res.end(compressed);
  });
  await new Promise((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolve);});
  try{
    const url="http://127.0.0.1:"+server.address().port;
    const reply=await fetch(url);
    assert.equal(reply.headers.get("Content-Length"),String(compressed.length));
    assert.deepEqual(await read(reply.body,undefined,reply.headers,128),{name:"صنعاء"});
    const tooSmall=await fetch(url);
    assert.equal(await read(tooSmall.body,undefined,tooSmall.headers,8),null);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
