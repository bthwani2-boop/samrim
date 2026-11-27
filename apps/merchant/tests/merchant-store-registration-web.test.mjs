import assert from "node:assert/strict";
import { test } from "node:test";
import { GET, POST } from "../app/api/admission+api.ts";

const identity = "http://127.0.0.1:13009";
const dsh = "http://127.0.0.1:13010";
const bearer = Buffer.alloc(32, 8).toString("base64url");
const options = { choices: [{
  cityId: "sanaa", relation: "MARKETPLACE", policyVersion: 1,
  termsVersion: "merchant-terms-v1", termsText: "موافقة اختبار معزول، دون نشر أو تفعيل مالي.",
}], verticals: ["grocery"] };
const input = { operationId: "registration-merchant-a-001", cityId: "sanaa",
  verticalId: "grocery", relation: "MARKETPLACE", name: "متجر صنعاء",
  latitude: 15.3694, longitude: 44.191, policyVersion: 1,
  termsVersion: "merchant-terms-v1", acceptedTerms: true };
const store = { id: "store-11111111111111111111111111111111",
  name: input.name, relation: input.relation, published: false };
const ownerJSON = (body, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
function setEnv(t, key, value) {
  const before = process.env[key];
  t.after(() => { if (before === undefined) delete process.env[key]; else process.env[key] = before; });
  process.env[key] = value;
}
function ownerEnvironment(t, { role = "merchant", dshStatus = 200, replay = false, invalid = false, abort = false } = {}) {
  setEnv(t, "MERCHANT_SYNTHETIC_IDENTITY_ORIGIN", identity);
  setEnv(t, "MERCHANT_SYNTHETIC_DSH_ORIGIN", dsh);
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, req) => {
    const target = new URL(url);
    calls.push({ pathname: target.pathname, method: req.method, body: req.body });
    assert.equal(req.redirect, "error");
    assert.equal(req.credentials, "omit");
    assert.equal(req.headers.Authorization, `Bearer ${bearer}`);
    if (target.origin === identity) {
      assert.equal(target.pathname, "/v1/sessions/current");
      assert.equal(req.method, "GET");
      return ownerJSON({ actorId: "owner-a", role,
        sessionExpiresAt: new Date(Date.now() + 120_000).toISOString() });
    }
    assert.equal(target.origin, dsh);
    if (target.pathname === "/v1/stores/registration-options") {
      assert.equal(req.method, "GET");
      return ownerJSON(invalid ? { ...options, choices: [{ ...options.choices[0], termsText: "" }] } : options);
    }
    assert.equal(target.pathname, "/v1/stores");
    assert.equal(req.method, "POST");
    assert.deepEqual(JSON.parse(req.body), input);
    if (abort) throw new Error("write may have committed");
    if (dshStatus !== 200) return ownerJSON({ code: "STORE_REGISTRATION_CLOSED" }, dshStatus);
    return ownerJSON({ store: invalid ? { ...store, published: true } : store, replay },
      replay ? 200 : 201);
  });
  return calls;
}
const cookies = token => token ? { Cookie: `bthwani_merchant_admission=${token}` } : {};
const get = (query = "?registration=options", token = bearer, extra = {}) =>
  new Request(`http://localhost:18102/api/admission${query}`, {
    headers: { ...cookies(token), ...extra },
  });
const post = (payload = input, token = bearer, extra = {}, query = "?registration=create") =>
  new Request(`http://localhost:18102/api/admission${query}`, {
    method: "POST", headers: {
      ...cookies(token), Origin: "http://localhost:18102",
      "Content-Type": "application/json", ...extra,
    },
    body: JSON.stringify({ storeRegistration: payload }),
  });

test("Merchant admission options are bound to current Identity and a live DSH policy", async t => {
  const calls = ownerEnvironment(t);
  const reply = await GET(get());
  assert.equal(reply.status, 200);
  assert.deepEqual(await reply.json(), { options });
  assert.equal(reply.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(calls.map(x => x.pathname), ["/v1/sessions/current", "/v1/stores/registration-options"]);
});
test("Merchant BFF creates an unpublished Store and forwards no caller-supplied owner authority", async t => {
  const calls = ownerEnvironment(t);
  const reply = await POST(post());
  assert.equal(reply.status, 201);
  assert.deepEqual(await reply.json(), { registration: { store, replay: false } });
  assert.deepEqual(calls.map(x => x.pathname), ["/v1/sessions/current", "/v1/stores"]);
});
test("Merchant BFF supports owner-backed idempotency replay, not a second Store", async t => {
  ownerEnvironment(t, { replay: true });
  const reply = await POST(post());
  assert.equal(reply.status, 200);
  assert.deepEqual(await reply.json(), { registration: { store, replay: true } });
});
test("Merchant registration requires a live Merchant session before contacting DSH", async t => {
  const calls = ownerEnvironment(t, { role: "customer" });
  assert.equal((await GET(get())).status, 401);
  assert.equal((await POST(post())).status, 403);
  assert.deepEqual(calls.map(x => x.pathname), ["/v1/sessions/current", "/v1/sessions/current"]);
});
test("Merchant registration rejects anonymous, cross-actor, malformed and cross-site requests", async t => {
  const calls = ownerEnvironment(t);
  assert.equal((await GET(get(undefined, ""))).status, 401);
  assert.equal((await POST(post(input, ""))).status, 401);
  assert.equal((await GET(get("?registration=options&actorId=other"))).status, 400);
  assert.equal((await POST(post(input, bearer, { Origin: "http://evil.test" }))).status, 403);
  assert.equal((await POST(post(input, bearer, { "X-Merchant-Context": "other" }))).status, 403);
  assert.equal((await POST(post(input, bearer, {}, "?registration=create&actorId=other"))).status, 400);
  assert.deepEqual(calls.map(x => x.pathname), ["/v1/sessions/current"]);
});
test("Merchant refuses invalid DSH terms text and published Store result", async t => {
  ownerEnvironment(t, { invalid: true });
  assert.equal((await GET(get())).status, 503);
  assert.equal((await POST(post())).status, 503);
});
test("Owner policy denial preserves Merchant session; never manufactures a Store", async t => {
  ownerEnvironment(t, { dshStatus: 403 });
  const reply = await POST(post());
  assert.equal(reply.status, 403);
  assert.deepEqual(await reply.json(), { code: "STORE_REGISTRATION_CLOSED" });
  assert.equal(reply.headers.get("Set-Cookie"), null);
});
test("Unknown DSH write outcome requires same operation id retry, not a false success", async t => {
  ownerEnvironment(t, { abort: true });
  const reply = await POST(post());
  assert.equal(reply.status, 503);
  assert.deepEqual(await reply.json(), { code: "OPERATION_RESULT_UNKNOWN" });
  assert.equal(reply.headers.get("Set-Cookie"), null);
});

test("Merchant BFF accepts a published Store only on confirmed owner replay", async t => {
  ownerEnvironment(t, { replay: true, invalid: true });
  const reply = await POST(post());
  assert.equal(reply.status, 200);
  assert.deepEqual(await reply.json(), { registration: { store: { ...store, published: true }, replay: true } });
});

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as registrationOwner from "@bthwani/dsh";
import { loadMappedRenderFixture } from "../../../tools/dev/mapped-render-fixture.mjs";
import * as merchantOwnerWeb from "../src/features/access/merchant-owner-web.ts";

const loadedTransports=[];
process.once("exit",()=>loadedTransports.length);
function registrationTransport(platform="web", withNativeMerchantSession=()=>assert.fail("unexpected native session")) {
  const temp=mkdtempSync(path.join(tmpdir(),"merchant-registration-transport-"));
  try {
    const root=path.resolve(import.meta.dirname,"../../..");
    const source=path.resolve(import.meta.dirname,"../src/features/onboarding/store-registration-transport.ts");
    const compile=spawnSync(process.execPath,[
      path.join(root,"node_modules/@typescript/native/bin/tsc"),source,
      "--ignoreConfig","--noResolve","--noCheck","--target","es2022","--module","commonjs",
      "--inlineSourceMap","--inlineSources","--outDir",temp,
    ],{cwd:root,encoding:"utf8",timeout:20000,windowsHide:true});
    assert.equal(compile.status,0,compile.stderr||compile.stdout);
    const mod=loadMappedRenderFixture(readFileSync(path.join(temp,"store-registration-transport.js"),"utf8"),source,{
      "@bthwani/dsh":registrationOwner,
      "react-native":{Platform:{OS:platform}},
      "../access/admission-transport":{withNativeMerchantSession},
      "../access/merchant-owner-web.ts":merchantOwnerWeb,
    });
    loadedTransports.push(mod);
    return mod.exports;
  } finally {rmSync(temp,{recursive:true,force:true});}
}

test("Web registration rejects a wrong fresh name or forged publication and retains valid replay",async t=>{
  const transport=registrationTransport();
  const signal=new AbortController().signal;
  let reply=()=>ownerJSON({registration:{store:{...store,name:"Wrong"},replay:false}},201);
  const calls=t.mock.method(globalThis,"fetch",async(url,init)=>{
    assert.equal(url,"/api/admission?registration=create");
    assert.equal(init.headers["X-Merchant-Context"],"owner-a");
    assert.deepEqual(JSON.parse(init.body),{storeRegistration:input});
    return reply();
  });
  const create=()=>transport.createMerchantStore("owner-a",input,signal);
  await assert.rejects(create(),{code:"OPERATION_RESULT_UNKNOWN"});
  reply=()=>ownerJSON({registration:{store:{...store,published:true},replay:false}},201);
  await assert.rejects(create(),{code:"OPERATION_RESULT_UNKNOWN"});
  reply=()=>ownerJSON({registration:{store:{...store,name:"Renamed",published:true},replay:true}},200);
  assert.equal((await create()).store.name,"Renamed");
  reply=()=>ownerJSON({registration:{store,replay:false},private:"unexpected"},201);
  await assert.rejects(create(),{code:"OPERATION_RESULT_UNKNOWN"});
  assert.equal(calls.mock.callCount(),4);
});
test("Web registration admits only private bounded JSON with contract-sized options",async t=>{
  const transport=registrationTransport();
  const signal=new AbortController().signal;
  let reply=()=>Response.json({options});
  t.mock.method(globalThis,"fetch",async()=>reply());
  const read=()=>transport.readMerchantStoreRegistrationOptions("owner-a",signal);
  await assert.rejects(read(),{code:"OWNER_RESPONSE_INVALID"});
  const full={choices:Array.from({length:100},(_,i)=>({...options.choices[0],cityId:"city-"+i,termsText:"<".repeat(4000)})),verticals:["grocery"]};
  reply=()=>ownerJSON({options:full});
  assert.deepEqual(await read(),full);
  reply=()=>ownerJSON({options,extra:true});
  await assert.rejects(read(),{code:"OWNER_RESPONSE_INVALID"});
  reply=()=>ownerJSON({options,padding:"x".repeat(2_500_001)});
  await assert.rejects(read(),{code:"OWNER_RESPONSE_INVALID"});
});
test("Web policy denial is definitive only for the matching owner status",async t=>{
  const transport=registrationTransport();
  const signal=new AbortController().signal;
  let reply=()=>ownerJSON({code:"STORE_REGISTRATION_CLOSED"},409);
  t.mock.method(globalThis,"fetch",async()=>reply());
  const create=()=>transport.createMerchantStore("owner-a",input,signal);
  await assert.rejects(create(),{code:"OPERATION_RESULT_UNKNOWN"});
  reply=()=>ownerJSON({code:"STORE_REGISTRATION_CLOSED"},403);
  await assert.rejects(create(),{code:"STORE_REGISTRATION_CLOSED"});
  reply=()=>ownerJSON({code:"STORE_REGISTRATION_POLICY_CHANGED"},409);
  await assert.rejects(create(),{code:"STORE_REGISTRATION_POLICY_CHANGED"});
});
test("Native registration continues to use the current verified Merchant owner session",async t=>{
  const signal=new AbortController().signal;
  const invocations=[];
  const transport=registrationTransport("android",async(s,run,actor,writing)=>{
    invocations.push([s,actor,writing]);return run(bearer,dsh);
  });
  t.mock.method(globalThis,"fetch",async(url,req)=>{
    assert.equal(req.headers.Authorization,"Bearer "+bearer);
    return req.method==="GET"?ownerJSON(options):ownerJSON({store,replay:false},201);
  });
  assert.deepEqual(await transport.readMerchantStoreRegistrationOptions("owner-a",signal),options);
  assert.deepEqual(await transport.createMerchantStore("owner-a",input,signal),{store,replay:false});
  assert.deepEqual(invocations,[[signal,"owner-a",undefined],[signal,"owner-a",true]]);
});

test("registration Web and native entry reject invalid or stale context before dispatch",async t=>{
  const transport=registrationTransport();
  const controller=new AbortController();
  const calls=t.mock.method(globalThis,"fetch",async()=>assert.fail("stale or invalid request"));
  await assert.rejects(transport.readMerchantStoreRegistrationOptions("",controller.signal),{code:"INVALID_STORE_REGISTRATION"});
  await assert.rejects(transport.createMerchantStore("owner-a",{...input,name:1},controller.signal),{code:"INVALID_STORE_REGISTRATION"});
  controller.abort();
  await assert.rejects(transport.readMerchantStoreRegistrationOptions("owner-a",controller.signal),{code:"OWNER_RESPONSE_STALE"});
  await assert.rejects(transport.createMerchantStore("owner-a",input,controller.signal),{code:"OPERATION_RESULT_UNKNOWN"});
  assert.equal(calls.mock.callCount(),0);
});

test("shared Web admission never trusts cached or contaminated refusal documents",async t=>{
  const transport=registrationTransport();
  const signal=new AbortController().signal;
  let reply=()=>Response.json({code:"STORE_REGISTRATION_CLOSED"},{status:403});
  t.mock.method(globalThis,"fetch",async()=>reply());
  const create=()=>transport.createMerchantStore("owner-a",input,signal);
  await assert.rejects(create(),{code:"OPERATION_RESULT_UNKNOWN"});
  reply=()=>ownerJSON({code:"STORE_REGISTRATION_CLOSED",extra:true},403);
  await assert.rejects(create(),{code:"OPERATION_RESULT_UNKNOWN"});
  reply=()=>ownerJSON({code:"STORE_REGISTRATION_CLOSED"},403);
  await assert.rejects(create(),{code:"STORE_REGISTRATION_CLOSED"});
});
