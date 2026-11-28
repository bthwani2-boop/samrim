import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseMerchantRegistrationOptions, parseMerchantRegistrationResult,
  readMerchantRegistrationOptions, readMerchantRegistrationReceipt, registerMerchantStore, validMerchantStoreRegistration,
} from "./merchant-registration.ts";

const bearer = Buffer.alloc(32, 7).toString("base64url");
const dsh = "http://127.0.0.1:33222";
const opts = { choices: [{
  cityId: "sanaa", relation: "MARKETPLACE", policyVersion: 1,
  termsVersion: "merchant-terms-v1", termsText: "Isolated registration terms, no publication.",
}], verticals: ["grocery"] };
const request = { operationId: "register-store-001", name: "Store One", cityId: "sanaa",
  relation: "MARKETPLACE", verticalId: "grocery", latitude: 15.3694,
  longitude: 44.191, policyVersion: 1, termsVersion: "merchant-terms-v1", acceptedTerms: true };
const store = { id: "store-11111111111111111111111111111111", name: "Store One",
  relation: "MARKETPLACE", published: false };
const response = (v, status = 200) => Response.json(v, { status, headers: { "Cache-Control": "no-store" } });

test("Registration options accept only exact, bounded DSH policy and displayed terms", () => {
  assert.deepEqual(parseMerchantRegistrationOptions(opts), opts);
  for (const invalid of [
    { ...opts, choices: [{ ...opts.choices[0], termsText: "" }] },
    { ...opts, choices: [{ ...opts.choices[0], termsVersion: "../x" }] },
    { ...opts, choices: [{ ...opts.choices[0], policyVersion: 0 }] },
    { ...opts, choices: [...opts.choices, ...opts.choices] },
    { ...opts, verticals: ["grocery", "grocery"] },
    { ...opts, additional: "private" },
  ]) assert.throws(() => parseMerchantRegistrationOptions(invalid), { code: "OWNER_RESPONSE_INVALID" });
});
test("Registration accepts an unpublished DSH result and validates the exact envelope", () => {
  assert.deepEqual(parseMerchantRegistrationResult({ store, replay: false }), { store, replay: false });
  for (const invalid of [
    { store: { ...store, published: "false" }, replay: false },
    { store: { ...store, id: "../other" }, replay: false },
    { store, replay: "false" },
    { store, replay: false, ownerActorId: "forged" },
  ]) assert.throws(() => parseMerchantRegistrationResult(invalid), { code: "OPERATION_RESULT_UNKNOWN" });
});
test("Client-side registration fails closed for missing proof, location, or current terms", () => {
  assert.equal(validMerchantStoreRegistration(request), true);
  for (const invalid of [
    { ...request, operationId: "bad" }, { ...request, latitude: Number.NaN },
    { ...request, longitude: 182 }, { ...request, acceptedTerms: false },
    { ...request, termsVersion: "" }, { ...request, cityId: "../sanaa" },
  ]) assert.equal(validMerchantStoreRegistration(invalid), false);
});
test("Owner SDK options never put bearer or actor in URLs, cookies or bodies", async t => {
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(String(url), dsh + "/v1/stores/registration-options");
    assert.equal(init.method, "GET");
    assert.equal(init.headers.Authorization, "Bearer " + bearer);
    assert.equal(init.credentials, "omit");
    assert.equal(init.redirect, "error");
    assert.equal(init.body, undefined);
    return response(opts);
  });
  assert.deepEqual(await readMerchantRegistrationOptions(dsh, bearer), opts);
});
test("Owner SDK registration sends the exactly scoped, single-use Store command", async t => {
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(String(url), dsh + "/v1/stores");
    assert.equal(init.method, "POST");
    assert.equal(init.headers.Authorization, "Bearer " + bearer);
    assert.equal(init.credentials, "omit");
    assert.deepEqual(JSON.parse(init.body), request);
    return response({ store, replay: false }, 201);
  });
  assert.deepEqual(await registerMerchantStore(dsh, bearer, request), { store, replay: false });
});
test("Owner SDK rejects forged publication and response-status mismatches after a write", async t => {
  t.mock.method(globalThis, "fetch", async () => response({ store: { ...store, published: true }, replay: false }, 201));
  await assert.rejects(registerMerchantStore(dsh, bearer, request), { code: "OPERATION_RESULT_UNKNOWN" });
});
test("Owner SDK exposes unknown commit outcome and never retries with a new key", async t => {
  const calls = t.mock.method(globalThis, "fetch", async () => { throw Error("network lost after Store commit"); });
  await assert.rejects(registerMerchantStore(dsh, bearer, request), { code: "OPERATION_RESULT_UNKNOWN" });
  assert.equal(calls.mock.callCount(), 1);
});
test("Owner SDK blocks untrusted DSH base and invalid Merchant bearer before any network call", async t => {
  const calls = t.mock.method(globalThis, "fetch", async () => { assert.fail("unsafe network call"); });
  await assert.rejects(readMerchantRegistrationOptions(dsh, "not-a-bearer"), { code: "UNAUTHENTICATED" });
  await assert.rejects(registerMerchantStore("http://evil.example", bearer, request), { code: "DSH_ENDPOINT_UNSAFE" });
  assert.equal(calls.mock.callCount(), 0);
});

test("all registration fields are checked without coercion or exceptions", () => {
  for (const invalid of [null, [], {}, {...request, name: 42}, {...request, cityId:["sanaa"]},
    {...request, name:"a\u0085b"}, {...request, name:"\ud800"}, {...request, operationId:["register-store-001"]},
    {...request, extra:"private"}, {...request, termsVersion:["merchant-terms-v1"]}]) {
    assert.equal(validMerchantStoreRegistration(invalid), false);
  }
  assert.equal(validMerchantStoreRegistration({...request, name:"\uFEFF"}), true);
});
test("options follow owner vertical eligibility and Unicode scalar limits", () => {
  for(const value of [{...opts, verticals:[]}, {...opts, choices:[{...opts.choices[0],termsText:"\ud800"}]},
    {...opts, choices:[{...opts.choices[0],termsText:"\u0085"}]}]) {
    assert.throws(()=>parseMerchantRegistrationOptions(value), {code:"OWNER_RESPONSE_INVALID"});
  }
  const valid={...opts,choices:[{...opts.choices[0],termsText:"😀".repeat(4000)}]};
  assert.deepEqual(parseMerchantRegistrationOptions(valid),valid);
});
test("complete contract-bounded options are not truncated at 64 KiB", async t => {
  const value={choices:Array.from({length:100},(_,i)=>({...opts.choices[0],cityId:"city-"+i,termsText:"<".repeat(4000)})),verticals:["grocery"]};
  const json=JSON.stringify(value).replaceAll("<","\\u003c");
  t.mock.method(globalThis,"fetch",async()=>new Response(json,{headers:{"Content-Type":"application/json","Cache-Control":"no-store"}}));
  assert.deepEqual(await readMerchantRegistrationOptions(dsh,bearer),value);
});
test("pre-abandoned operations never dispatch; conflicting owner error cannot clear a retry", async t => {
  const calls=t.mock.method(globalThis,"fetch",async()=>response({code:"STORE_REGISTRATION_CLOSED"},409));
  const abort=new AbortController();abort.abort();
  await assert.rejects(readMerchantRegistrationOptions(dsh,bearer,abort.signal),{code:"OWNER_RESPONSE_STALE"});
  await assert.rejects(registerMerchantStore(dsh,bearer,request,abort.signal),{code:"OPERATION_RESULT_UNKNOWN"});
  assert.equal(calls.mock.callCount(),0);
  await assert.rejects(registerMerchantStore(dsh,bearer,request),{code:"OPERATION_RESULT_UNKNOWN"});
  assert.equal(calls.mock.callCount(),1);
});
test("fresh receipt matches actual Go normalization; replay may expose current published name",async t=>{
  const input={...request,name:"\u00a0\uFEFFStore One\u00a0"};
  let reply=response({store:{...store,name:"\uFEFFStore One"},replay:false},201);
  t.mock.method(globalThis,"fetch",async()=>reply);
  assert.deepEqual(await registerMerchantStore(dsh,bearer,input),{store:{...store,name:"\uFEFFStore One"},replay:false});
  reply=response({store:{...store,name:"Renamed",published:true},replay:true},200);
  assert.equal((await registerMerchantStore(dsh,bearer,input)).store.name,"Renamed");
});

test("registration rejects malformed envelopes, invalid choices and out-of-range coordinates",()=>{
  for(const value of [null,{...opts,choices:null},{...opts,verticals:null},{...opts,choices:Array(101).fill(opts.choices[0])},
    {...opts,verticals:Array(101).fill("grocery")},{...opts,verticals:["../x"]},{...opts,choices:[null]},
    {...opts,choices:[{...opts.choices[0],cityId:"INVALID"}]},{...opts,choices:[{...opts.choices[0],relation:"unknown"}]},
    {...opts,choices:[{...opts.choices[0],termsText:"a\u0000b"}]}]){
    assert.throws(()=>parseMerchantRegistrationOptions(value),{code:"OWNER_RESPONSE_INVALID"});
  }
  for(const value of [null,{store:null,replay:false},{store:{...store,name:"x".repeat(121)},replay:false},
    {store:{...store,name:"\u0085"},replay:false},{store:{...store,relation:"UNKNOWN"},replay:false}]){
    assert.throws(()=>parseMerchantRegistrationResult(value),{code:"OPERATION_RESULT_UNKNOWN"});
  }
  for(const value of [{...request,latitude:"15.3694"},{...request,latitude:91},{...request,policyVersion:0},
    {...request,policyVersion:1.5},{...request,relation:"OTHER"},{...request,name:"x".repeat(121)},
    {...request,name:"\u00a0"},{...request,verticalId:42}])assert.equal(validMerchantStoreRegistration(value),false);
});
test("owner failures cannot become definitive without exact private JSON and status",async t=>{
  let reply=response({code:"INVALID_STORE_REGISTRATION"},400);
  t.mock.method(globalThis,"fetch",async()=>reply);
  const write=()=>registerMerchantStore(dsh,bearer,request);
  for(const [status,code] of [[400,"INVALID_STORE_REGISTRATION"],[401,"UNAUTHENTICATED"],
    [403,"STORE_OPERATION_FORBIDDEN"],[403,"STORE_REGISTRATION_CLOSED"],
    [409,"IDEMPOTENCY_KEY_REUSED"],[409,"STORE_REGISTRATION_POLICY_CHANGED"]]){
    reply=response({code},status);await assert.rejects(write(),{status,code});
  }
  for(const value of [Response.json({code:"STORE_REGISTRATION_CLOSED"},{status:403}),
    response({code:"STORE_REGISTRATION_CLOSED",extra:true},403),
    new Response("{",{status:403,headers:{"Cache-Control":"no-store","Content-Type":"application/json"}}),
    response({code:"OWNER_UNKNOWN"},503)]){
    reply=value;await assert.rejects(write(),{code:"OPERATION_RESULT_UNKNOWN"});
  }
  for(const code of ["IDENTITY_OWNER_UNAVAILABLE","STORE_OWNER_UNAVAILABLE"]){
    reply=response({code},503);await assert.rejects(readMerchantRegistrationOptions(dsh,bearer),{code});
  }
  reply=response({code:"UNRECOGNIZED"},503);
  await assert.rejects(readMerchantRegistrationOptions(dsh,bearer),{code:"OWNER_UNAVAILABLE"});
});
test("unadmitted success metadata and invalid bodies never authorize a read or write",async t=>{
  let reply=Response.json(opts);
  t.mock.method(globalThis,"fetch",async()=>reply);
  const read=()=>readMerchantRegistrationOptions(dsh,bearer);
  const write=()=>registerMerchantStore(dsh,bearer,request);
  await assert.rejects(read(),{code:"OWNER_RESPONSE_INVALID"});
  reply=response(opts,201);await assert.rejects(read(),{code:"OWNER_RESPONSE_INVALID"});
  reply=response({store,replay:false},202);await assert.rejects(write(),{code:"OPERATION_RESULT_UNKNOWN"});
  reply=new Response("{",{headers:{"Cache-Control":"no-store","Content-Type":"application/json"}});
  await assert.rejects(read(),{code:"OWNER_RESPONSE_INVALID"});
  reply=new Response("{",{status:201,headers:{"Cache-Control":"no-store","Content-Type":"application/json"}});
  await assert.rejects(write(),{code:"OPERATION_RESULT_UNKNOWN"});
  reply=response({store:{...store,relation:"DIRECT"},replay:true},200);
  await assert.rejects(write(),{code:"OPERATION_RESULT_UNKNOWN"});
  reply=response({store,replay:true},201);await assert.rejects(write(),{code:"OPERATION_RESULT_UNKNOWN"});
  await assert.rejects(registerMerchantStore(dsh,bearer,{...request,name:1}),{code:"INVALID_STORE_REGISTRATION"});
  await assert.rejects(readMerchantRegistrationOptions(dsh,[bearer]),{code:"UNAUTHENTICATED"});
});
test("an owner read outage and late cancellation do not expose stale data",async t=>{
  t.mock.method(globalThis,"fetch",async()=>{throw Error("network");});
  await assert.rejects(readMerchantRegistrationOptions(dsh,bearer),{code:"OWNER_UNAVAILABLE"});
  t.mock.restoreAll();
  const abort=new AbortController();
  t.mock.method(globalThis,"fetch",async()=>{abort.abort();return response(opts);});
  await assert.rejects(readMerchantRegistrationOptions(dsh,bearer,abort.signal),{code:"OWNER_RESPONSE_STALE"});
});

test("receipt is a bounded private GET bound to the exact operation and current owner", async t => {
  const operationId = request.operationId;
  let reply = response({ operationId, store: { ...store, published: true } });
  const fetch = t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(String(url), dsh + "/v1/store-registration-receipts/" + operationId);
    assert.equal(init.method, "GET");
    assert.equal(init.headers.Authorization, "Bearer " + bearer);
    assert.equal(init.body, undefined);
    return reply;
  });
  assert.deepEqual(await readMerchantRegistrationReceipt(dsh, bearer, operationId), { operationId, store: { ...store, published: true } });
  reply = response({ operationId: "other-operation", store });
  await assert.rejects(readMerchantRegistrationReceipt(dsh, bearer, operationId), { code: "OWNER_RESPONSE_INVALID" });
  reply = response({ code: "REGISTRATION_RECEIPT_NOT_FOUND" }, 404);
  await assert.rejects(readMerchantRegistrationReceipt(dsh, bearer, operationId), { status: 404, code: "REGISTRATION_RECEIPT_NOT_FOUND" });
  const count = fetch.mock.callCount();
  await assert.rejects(readMerchantRegistrationReceipt(dsh, bearer, "../other"), { code: "INVALID_STORE_REGISTRATION" });
  assert.equal(fetch.mock.callCount(), count);
});
