import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";
import { readOwnedMerchantCommercialAgreementReview } from "./commercial-agreement.ts";
import { readCurrentCustomerOrderPaymentAllocation } from "./order-payment-readback.ts";

const token=Buffer.alloc(32,9).toString("base64url");
const origin="http://127.0.0.1:3203";
const agreement={storeId:"store-a",proposal:null};
const allocation={actorId:"wallet-one",checkoutId:"checkout-0001",allocation:null};
const opts={headers:{"Content-Type":"application/json","Cache-Control":"no-store"}};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const readAgreement=s=>readOwnedMerchantCommercialAgreementReview(origin,token,"store-a",s);
const readAllocation=s=>readCurrentCustomerOrderPaymentAllocation(origin,token,"wallet-one","checkout-0001",s);
async function outcome(p){let timer;try{return await Promise.race([p.then(()=> "resolved",()=> "rejected"),new Promise(r=>{timer=setTimeout(()=>r("pending"),100);})]);}finally{clearTimeout(timer);}}
test("pre-cancelled read never dispatches bearer",async t=>{
 let calls=0;t.mock.method(globalThis,"fetch",async()=>{calls++;return Response.json(agreement,opts);});
 const c=new AbortController();c.abort();
 assert.equal(await outcome(readAgreement(c.signal)),"rejected");assert.equal(calls,0);
});
test("cancelled allocation awaiting headers settles and discards late response",async t=>{
 const wait=deferred();let cancelled=0;
 t.mock.method(globalThis,"fetch",()=>wait.promise);
 const c=new AbortController();const pending=readAllocation(c.signal);
 await Promise.resolve();c.abort();
 const actual=await outcome(pending);
 wait.resolve(new Response(new ReadableStream({cancel(){cancelled++;}}),opts));
 await new Promise(r=>setImmediate(r));
 assert.equal(actual,"rejected");assert.equal(cancelled,1);
});
test("cancelled agreement native text read settles before bridge reply",async t=>{
 const wait=deferred();const entered=deferred();
 t.mock.method(globalThis,"fetch",async()=>({status:200,headers:new Headers(opts.headers),body:null,text(){entered.resolve();return wait.promise;}}));
 const c=new AbortController();const pending=readAgreement(c.signal);
 await entered.promise;c.abort();
 const actual=await outcome(pending);wait.resolve(JSON.stringify(agreement));
 assert.equal(actual,"rejected");
});
test("cancelled stream releases reader and successor remains usable",async t=>{
 let cancel=0;const entered=deferred();const stream=new ReadableStream({pull(){entered.resolve();return new Promise(()=>{});},cancel(){cancel++;}},{highWaterMark:0});
 let count=0;t.mock.method(globalThis,"fetch",async()=>++count===1?new Response(stream,opts):Response.json(allocation,opts));
 const c=new AbortController();const pending=readAgreement(c.signal);
 await entered.promise;await Promise.resolve();c.abort();
 assert.equal(await outcome(pending),"rejected");
 await new Promise(r=>setImmediate(r));
 assert.equal(stream.locked,false);assert.equal(cancel,1);
 assert.deepEqual(await readAllocation(new AbortController().signal),allocation);
});
test("late rejected bridge and cancellation listener are released",async t=>{
 const wait=deferred();
 t.mock.method(globalThis,"fetch",()=>wait.promise);
 const c=new AbortController();const pending=readAllocation(c.signal);
 await Promise.resolve();c.abort();
 assert.equal(await outcome(pending),"rejected");
 assert.equal(getEventListeners(c.signal,"abort").length,0);
 wait.reject(new Error("late synthetic rejection"));
 await new Promise(r=>setImmediate(r));
});
test("real HTTP cancellation before headers permits a fresh read",async()=>{
 const entered=deferred();let requests=0;
 const server=createServer((req,res)=>{
  requests++;
  assert.equal(req.method,"GET");
  assert.equal(req.headers.authorization,"Bearer "+token);
  if(requests===1){entered.resolve();return;}
  res.writeHead(200,opts.headers);res.end(JSON.stringify(agreement));
 });
 await new Promise((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolve);});
 const url="http://127.0.0.1:"+server.address().port;
 const read=s=>readOwnedMerchantCommercialAgreementReview(url,token,"store-a",s);
 try{
  const c=new AbortController();const pending=read(c.signal);
  await entered.promise;c.abort();
  assert.equal(await outcome(pending),"rejected");
  assert.deepEqual(await read(AbortSignal.timeout(1000)),agreement);
  assert.equal(requests,2);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test("WLT enforces the existing twelve-second budget even when the caller never aborts", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const waiting = deferred();
  const entered = deferred();
  let fetchSignal;
  let discarded = false;
  t.mock.method(globalThis, "fetch", (_url, options) => {
    fetchSignal = options.signal;
    entered.resolve();
    return waiting.promise;
  });
  const caller = new AbortController();
  let result = "pending";
  const pending = readAgreement(caller.signal).then(() => { result = "resolved"; }, err => { result = err.status; });
  await entered.promise;
  t.mock.timers.tick(12000);
  await new Promise(r => setImmediate(r));
  const observed = result;
  const transportAborted = fetchSignal.aborted;
  caller.abort();
  waiting.resolve(new Response(new ReadableStream({cancel(){discarded=true;}}), opts));
  await pending;
  await new Promise(r => setImmediate(r));
  assert.equal(observed, 503, "uncooperative headers must settle within the existing budget");
  assert.equal(transportAborted, true);
  assert.equal(discarded, true);
  assert.equal(getEventListeners(caller.signal, "abort").length, 0);
});

test("WLT timeout also releases a stalled body without cancelling its caller", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const entered = deferred();
  let cancelled = false;
  const body = new ReadableStream({
    pull(){ entered.resolve(); return new Promise(() => {}); },
    cancel(){ cancelled = true; },
  }, {highWaterMark:0});
  t.mock.method(globalThis,"fetch",async()=>new Response(body,opts));
  const caller = new AbortController();
  let result = "pending";
  const pending = readAgreement(caller.signal).then(()=>{result="resolved";},err=>{result=err.status;});
  await entered.promise;
  t.mock.timers.tick(12000);
  await new Promise(r=>setImmediate(r));
  const observed={result,cancelled,locked:body.locked,callerAborted:caller.signal.aborted};
  caller.abort();
  await pending;
  assert.deepEqual(observed,{result:503,cancelled:true,locked:false,callerAborted:false});
});

test("WLT refuses non-owner paths and accepts the valid default loopback port", async t => {
  const {readOwner}=await import("./transport.ts");
  const signal=new AbortController().signal;
  let calls=0;
  t.mock.method(globalThis,"fetch",async()=>{calls++;return Response.json(agreement,opts);});
  for(const path of ["//elsewhere.test/a","https://elsewhere.test/a","/\\elsewhere.test/a"]) {
    await assert.rejects(()=>readOwner(origin,token,"GET",path,signal),{status:503});
  }
  assert.equal(calls,0);
  assert.deepEqual(await readOwner("http://127.0.0.1:80",token,"GET","/v1/wallets/me",signal),agreement);
  assert.equal(calls,1);
});

test("WLT cleanup failures do not replace the admitted error or hold the reader", async t => {
  for(const headers of [
    {"Content-Type":"text/html","Cache-Control":"no-store"},
    {"Content-Type":"application/json","Cache-Control":"no-store"},
  ]) {
    const body=new ReadableStream({
      pull(c){c.enqueue(new Uint8Array(4097));},
      cancel(){return Promise.reject(new Error("noncooperative cleanup"));},
    },{highWaterMark:0});
    t.mock.method(globalThis,"fetch",async()=>new Response(body,{headers}));
    await assert.rejects(()=>readAgreement(new AbortController().signal),
      {status:headers["Content-Type"]==="text/html"?503:502});
    assert.equal(body.locked,false);
    t.mock.restoreAll();
  }
});

test("WLT normalizes network failures and malformed metadata without exposing a reply", async t => {
  const signal=new AbortController().signal;
  t.mock.method(globalThis,"fetch",async()=>{throw new Error("synthetic network failure");});
  await assert.rejects(()=>readAgreement(signal),{status:503});
  for (const length of ["not-a-number","4097"]) {
    globalThis.fetch.mock.mockImplementation(async()=>new Response("{}",{headers:{...opts.headers,"Content-Length":length}}));
    await assert.rejects(()=>readAgreement(signal),{status:502});
  }
  globalThis.fetch.mock.mockImplementation(async()=>({status:200,headers:new Headers(opts.headers),body:null,text:async()=>"{bad"}));
  await assert.rejects(()=>readAgreement(signal),{status:502});
  assert.equal(getEventListeners(signal,"abort").length,0);
});

test("WLT uses a single budget across headers and body and clears it on recovery", async t => {
  t.mock.timers.enable({apis:["setTimeout"]});
  const waiting=deferred(),entered=deferred(),reading=deferred();
  let cancelled=false;
  const stream=new ReadableStream({pull(){reading.resolve();return new Promise(()=>{});},
    cancel(){cancelled=true;}},{highWaterMark:0});
  t.mock.method(globalThis,"fetch",()=>{entered.resolve();return waiting.promise;});
  const caller=new AbortController();
  const pending=assert.rejects(()=>readAgreement(caller.signal),{status:503});
  await entered.promise;
  t.mock.timers.tick(11000);
  waiting.resolve(new Response(stream,opts));
  await reading.promise;
  t.mock.timers.tick(1000);
  await pending;
  assert.equal(cancelled,true);
  assert.equal(stream.locked,false);
  assert.equal(caller.signal.aborted,false);
  globalThis.fetch.mock.mockImplementation(async()=>Response.json(agreement,opts));
  assert.deepEqual(await readAgreement(caller.signal),agreement);
  t.mock.timers.tick(12000);
  assert.equal(getEventListeners(caller.signal,"abort").length,0);
});

test("WLT never dispatches an invalid credential or a synchronously abandoned read", async t => {
  const {readOwner}=await import("./transport.ts");
  let calls=0;
  t.mock.method(globalThis,"fetch",async()=>{calls++;return Response.json(agreement,opts);});
  await assert.rejects(()=>readOwner(origin,"invalid","GET","/v1/wallets/me",new AbortController().signal),{status:401});
  const caller=new AbortController();
  const pending=readAgreement(caller.signal);
  caller.abort();
  await assert.rejects(pending,{status:503});
  assert.equal(calls,0);
  assert.equal(getEventListeners(caller.signal,"abort").length,0);
});

test("WLT retains denial even when a native body accessor throws during discard", async t => {
  t.mock.method(globalThis,"fetch",async()=>({
    status:403, headers:new Headers(opts.headers),
    get body(){throw new Error("bridge cleanup error");},
  }));
  await assert.rejects(()=>readAgreement(new AbortController().signal),{status:403});
});

test("private WLT transport dispatches only contracted read paths and cursor operation", async t => {
  const { readOwner } = await import("./transport.ts");
  const signal = new AbortController().signal;
  const sent = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    sent.push([url.pathname, url.search, options.method]);
    return Response.json(agreement, opts);
  });
  for (const path of ["/health", "/v1/unknown", "/v1/wallets/me?actorId=other",
    "/v1/wallets/me#fragment", "/v1/wallets/../wallets/me",
    "/v1/wallets/me/order-payment-allocations/%2e%2e",
    "/v1/merchants/stores/INVALID/commercial-agreement",
    "/v1/operators/stores/store-a/commercial-agreement/"]) {
    await assert.rejects(() => readOwner(origin, token, "GET", path, signal), {status:503});
  }
  await assert.rejects(() => readOwner(origin, token, "POST", "/v1/wallets/me", signal), {status:503});
  const cursor = Buffer.from("2026-11-20T00:00:00Z|funding-page-00").toString("base64url");
  await assert.rejects(() => readOwner(origin, token, "GET", "/v1/wallets/me", signal, cursor), {status:400});
  assert.deepEqual(sent, []);
  const paths = ["/v1/wallets/me", "/v1/wallets/me/transactions",
    "/v1/wallets/me/order-payment-allocations/checkout-0001",
    "/v1/merchants/stores/store-a/commercial-agreement",
    "/v1/operators/stores/store-a/commercial-agreement"];
  for (const path of paths) await readOwner(origin, token, "GET", path, signal);
  await readOwner(origin, token, "GET", paths[1], signal, cursor);
  assert.deepEqual(sent, [...paths.map(path => [path, "", "GET"]), [paths[1], "?cursor=" + cursor, "GET"]]);
});

test("WLT normalizes synchronous native response accessor and reader acquisition failures", async t => {
  const signal = new AbortController().signal;
  for (const response of [
    { status: 200, headers: new Headers(opts.headers), get body() { throw new Error("bridge"); } },
    { status: 200, headers: new Headers(opts.headers), body: { getReader() { throw new Error("reader"); } } },
  ]) {
    t.mock.method(globalThis, "fetch", async () => response);
    await assert.rejects(() => readAgreement(signal), {status:502});
    t.mock.restoreAll();
  }
  t.mock.method(globalThis, "fetch", async () => Response.json(agreement, opts));
  assert.deepEqual(await readAgreement(signal), agreement);
});
test("WLT invalid origins, malformed cursor and broken header bridge never admit a read", async t => {
  const { readOwner } = await import("./transport.ts");
  const signal = new AbortController().signal;
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return { status: 200, get headers() { throw new Error("bridge headers"); }, body: null };
  });
  for (const source of ["https://127.0.0.1:3203", "http://127.0.0.1:65536", "http://127.0.0.1:0"]) {
    await assert.rejects(() => readOwner(source, token, "GET", "/v1/wallets/me", signal), {status:503});
  }
  for (const cursor of [null, "short", "a".repeat(241)]) {
    await assert.rejects(() => readOwner(origin, token, "GET", "/v1/wallets/me/transactions", signal, cursor), {status:400});
  }
  assert.equal(calls, 0);
  await assert.rejects(() => readAgreement(signal), {status:502});
  assert.equal(calls, 1);
  globalThis.fetch.mock.mockImplementation(async () => Response.json(agreement, opts));
  assert.deepEqual(await readAgreement(signal), agreement);
});
test("WLT refuses contradictory framing and declared-length mismatch before publishing a financial reply", async t => {
  const payload = JSON.stringify(agreement);
  const exact = String(Buffer.byteLength(payload));
  const cases = [
    { "Content-Length": "0" },
    { "Content-Length": String(Number(exact) - 1) },
    { "Content-Length": String(Number(exact) + 1) },
    { "Content-Length": exact, "Transfer-Encoding": "chunked" },
    { "Transfer-Encoding": "gzip, chunked" },
    { "Content-Encoding": "gzip" },
  ];
  let next;
  t.mock.method(globalThis, "fetch", async () => next);
  for (const extra of cases) {
    next = new Response(payload, { headers: {...opts.headers, ...extra} });
    await assert.rejects(() => readAgreement(new AbortController().signal), {status:502}, JSON.stringify(extra));
    assert.equal(next.body.locked, false);
  }
  for (const extra of cases) {
    next = {status:200, headers:new Headers({...opts.headers, ...extra}), body:null, text:async()=>payload};
    await assert.rejects(() => readAgreement(new AbortController().signal), {status:502}, JSON.stringify(extra));
  }
  for (const extra of [{"Content-Length":exact}, {"Transfer-Encoding":"chunked"}, {}]) {
    next = new Response(payload, {headers:{...opts.headers,...extra}});
    assert.deepEqual(await readAgreement(new AbortController().signal), agreement);
    next = {status:200, headers:new Headers({...opts.headers,...extra}), body:null, text:async()=>payload};
    assert.deepEqual(await readAgreement(new AbortController().signal), agreement);
  }
});

test("WLT verifies declared UTF-8 length rather than JavaScript string length", async t => {
  const {readCurrentCustomerWallet} = await import("./wallet-balance.ts");
  const reply = {actorId:"عميل-أ",currency:"YER",balanceYer:"17",availableYer:"17"};
  const payload = JSON.stringify(reply);
  let response;
  t.mock.method(globalThis,"fetch",async()=>response);
  for (const length of [payload.length, Buffer.byteLength(payload)]) {
    response = {status:200,headers:new Headers({...opts.headers,"Content-Length":String(length)}),body:null,text:async()=>payload};
    const read = () => readCurrentCustomerWallet(origin,token,new AbortController().signal);
    if (length === payload.length) await assert.rejects(read,{status:502});
    else assert.deepEqual(await read(),reply);
  }
});

test("every WLT owner read rejects ambiguous JSON member identities on both response paths", async t => {
  const { readOwner } = await import("./transport.ts");
  const paths = [
    "/v1/wallets/me",
    "/v1/wallets/me/transactions",
    "/v1/wallets/me/order-payment-allocations/checkout-0001",
    "/v1/merchants/stores/store-a/commercial-agreement",
    "/v1/operators/stores/store-a/commercial-agreement",
  ];
  const bad = [
    '{"actorId":"wallet-other","actorId":"wallet-one"}',
    '{"actorId":"wallet-one","\\u0061ctorId":"wallet-one"}',
    '{"allocation":{"totalYer":"999","totalYer":"12"}}',
    '{"items":[{"fundingId":"one","fundingId":"two"}]}',
    '{"nested":{"a\\\"b":1,"a\\u0022b":2}}',
    '{"nested":{"😀":1,"\\ud83d\\ude00":2}}',
    '{"__proto__":1,"__proto__":2}',
    '\uFEFF{"actorId":"wallet-one"}',
    '{"invalid":}',
    '[{"actorId":"wallet-one"}]',
    'null',
  ];
  const good = {
    actorId: "wallet-one",
    items: [{ fundingId: "one" }, { fundingId: "two" }],
    nested: { 'a"b': "string with { [ \" : }", other: { 'a"b': 2 } },
  };
  let raw;
  let native = false;
  let last;
  t.mock.method(globalThis, "fetch", async () => {
    last = native
      ? { status: 200, headers: new Headers(opts.headers), body: null, text: async () => raw }
      : new Response(raw, opts);
    return last;
  });
  const signal = new AbortController().signal;
  for (const path of paths) {
    for (const isNative of [false, true]) {
      native = isNative;
      for (raw of bad) {
        await assert.rejects(() => readOwner(origin, token, "GET", path, signal), { status: 502 }, raw);
        if (!native) assert.equal(last.body.locked, false);
        assert.equal(getEventListeners(signal, "abort").length, 0);
      }
      raw = JSON.stringify(good);
      assert.deepEqual(await readOwner(origin, token, "GET", path, signal), good);
    }
  }
});

test("actual loopback WLT read rejects contradictory financial evidence and recovers", async () => {
  const { readCurrentCustomerWallet } = await import("./wallet-balance.ts");
  const valid = { actorId: "wallet-one", currency: "YER", balanceYer: "12", availableYer: "12" };
  const raw = '{"actorId":"wallet-other","actorId":"wallet-one","currency":"YER","balanceYer":"999","balanceYer":"12","availableYer":"12"}';
  let requests = 0;
  const server = createServer((req, res) => {
    assert.equal(req.url, "/v1/wallets/me");
    assert.equal(req.headers.authorization, "Bearer " + token);
    const payload = ++requests === 1 ? raw : JSON.stringify(valid);
    res.writeHead(200, { ...opts.headers, "Content-Length": String(Buffer.byteLength(payload)) });
    res.end(payload);
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const url = "http://127.0.0.1:" + server.address().port;
  try {
    await assert.rejects(() => readCurrentCustomerWallet(url, token, AbortSignal.timeout(2000)), { status: 502 });
    assert.deepEqual(await readCurrentCustomerWallet(url, token, AbortSignal.timeout(2000)), valid);
    assert.equal(requests, 2);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
