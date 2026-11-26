import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as dsh from "@bthwani/dsh";
import { loadMappedRenderFixture } from "../../../../../tools/dev/mapped-render-fixture.mjs";
import { readBoundedCustomerJSON } from "../access/bounded-customer-json.ts";

const root=fileURLToPath(new URL("../../../../../",import.meta.url));
const entry=fileURLToPath(new URL("./favorite-stores-transport.ts",import.meta.url));
const temp=mkdtempSync(path.join(tmpdir(),"favorite-transport-"));
let compiled;
const loadedModules = [];
process.once("exit", () => loadedModules.length);
try {
  const result=spawnSync(process.execPath,[path.join(root,"node_modules/typescript/bin/tsc"),entry,
    "--ignoreConfig","--noResolve","--noCheck","--target","es2022","--module","commonjs",
    "--inlineSourceMap","--inlineSources","--outDir",temp],
    {cwd:root,encoding:"utf8",timeout:20000,windowsHide:true});
  assert.equal(result.status,0,result.stderr||result.stdout);
  compiled=readFileSync(path.join(temp,"favorite-stores-transport.js"),"utf8");
} finally {rmSync(temp,{recursive:true,force:true});}
const actor="customer-a", storeId="store-a";
const session=(actorId=actor)=>({enabled:true,session:{actorId,role:"customer",sessionExpiresAt:"2030-01-01T00:00:00Z"}});
function harness(platform, read, native, origin = "http://127.0.0.1:3202"){
  const modules={"@bthwani/dsh":dsh,"react-native":{Platform:{OS:platform}},
    "../access/customer-session-transport":{readCustomerAdmission:read,withVerifiedNativeCustomerRead:native},
    "../access/bounded-customer-json":{readBoundedCustomerJSON}};
  const previous = process.env.EXPO_PUBLIC_CUSTOMER_SYNTHETIC_DSH_ORIGIN;
  try {
    if (origin === null) delete process.env.EXPO_PUBLIC_CUSTOMER_SYNTHETIC_DSH_ORIGIN;
    else process.env.EXPO_PUBLIC_CUSTOMER_SYNTHETIC_DSH_ORIGIN = origin;
    const mod = loadMappedRenderFixture(compiled, entry, modules);
    loadedModules.push(mod);
    return mod.exports;
  } finally {
    if (previous === undefined) delete process.env.EXPO_PUBLIC_CUSTOMER_SYNTHETIC_DSH_ORIGIN;
    else process.env.EXPO_PUBLIC_CUSTOMER_SYNTHETIC_DSH_ORIGIN = previous;
  }
}
const validState={actorId:actor,storeId,favorite:true};
const reply=value=>Response.json(value,{headers:{"Cache-Control":"no-store"}});
const unknown=error=>error instanceof dsh.DshPublicError&&error.code==="OPERATION_RESULT_UNKNOWN";

test("Web loses post-write session proof: unknown, never automatically writes again; next read reconciles",async t=>{
  let reads=0,writes=0;
  const api=harness("web",async()=>session(++reads===2?"customer-b":actor));
  t.mock.method(globalThis,"fetch",async(_url,init)=>{
    if(init.method==="PUT")writes++;
    return reply(validState);
  });
  await assert.rejects(api.writeFavoriteStore(new AbortController().signal,actor,storeId,true),unknown);
  assert.equal(writes,1);
  assert.deepEqual((await api.readFavoriteStore(new AbortController().signal,storeId,actor)).value,validState);
  assert.equal(writes,1);
});

test("Android loses post-write session proof: unknown, never automatically writes again",async t=>{
  let writes=0;
  const api=harness("android",async()=>session(),async(_signal,invoke)=>{
    await invoke(Buffer.alloc(32,14).toString("base64url"));
    return {kind:"signed-out"};
  });
  t.mock.method(globalThis,"fetch",async()=>{writes++;return reply(validState);});
  await assert.rejects(api.writeFavoriteStore(new AbortController().signal,actor,storeId,true),unknown);
  assert.equal(writes,1);
});

test("owner network outage before a read is unavailable; failed mutation remains unknown",async t=>{
  const api=harness("web",async()=>session());
  let calls=0;
  t.mock.method(globalThis,"fetch",async()=>{calls++;throw new Error("offline");});
  await assert.rejects(api.readFavoriteStore(new AbortController().signal,storeId,actor),e=>e.code==="OWNER_UNAVAILABLE");
  await assert.rejects(api.writeFavoriteStore(new AbortController().signal,actor,storeId,true),unknown);
  assert.equal(calls,2);
});

test("pre-dispatch account mismatch does not invoke the owner",async t=>{
  const api=harness("web",async()=>session("customer-b"));
  let calls=0;
  t.mock.method(globalThis,"fetch",async()=>{calls++;return reply(validState);});
  await assert.rejects(api.writeFavoriteStore(new AbortController().signal,actor,storeId,true),e=>e.status===401);
  assert.equal(calls,0);
});

test("Web rejects incorrect response media type before exposing a favorite", async t=>{
  const api=harness("web",async()=>session());
  t.mock.method(globalThis,"fetch",async()=>new Response(JSON.stringify(validState),
    {headers:{"Cache-Control":"no-store","Content-Type":"text/html"}}));
  await assert.rejects(api.readFavoriteStore(new AbortController().signal,storeId,actor),
    e=>e instanceof dsh.DshPublicError&&e.code==="OWNER_RESPONSE_INVALID");
});

test("Web refuses oversized owner replies even when the JSON shape is valid", async t=>{
  const api=harness("web",async()=>session());
  const body=JSON.stringify(validState)+" ".repeat(33000);
  t.mock.method(globalThis,"fetch",async()=>new Response(body,
    {headers:{"Cache-Control":"no-store","Content-Type":"application/json"}}));
  await assert.rejects(api.readFavoriteStore(new AbortController().signal,storeId,actor),
    e=>e instanceof dsh.DshPublicError&&e.code==="OWNER_RESPONSE_INVALID");
  await assert.rejects(api.writeFavoriteStore(new AbortController().signal,actor,storeId,true),unknown);
});

test("invalid or expired admission evidence cannot dispatch a favorite request", async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return reply(validState); });
  for (const sessionExpiresAt of ["invalid", "", "2000-01-01T00:00:00Z"]) {
    const api = harness("web", async () => ({ ...session(), session: { ...session().session, sessionExpiresAt } }));
    await assert.rejects(api.readFavoriteStore(new AbortController().signal, storeId, actor), e => e.status === 401);
    await assert.rejects(api.writeFavoriteStore(new AbortController().signal, actor, storeId, true), e => e.status === 401);
  }
  assert.equal(calls, 0);
});

test("Web list and mutation use the current actor and bound session deadline", async t => {
  const signal = new AbortController().signal;
  const calls = [];
  const deadline = "2029-01-01T00:00:00Z";
  let reads = 0;
  const api = harness("web", async () => ({
    ...session(), session: { ...session().session, sessionExpiresAt: ++reads % 2 ? session().session.sessionExpiresAt : deadline },
  }));
  const page = { actorId: actor, storeIds: ["store-b"] };
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push([url, init]);
    return reply(init.method === "PUT" ? validState : page);
  });
  assert.deepEqual(await api.readFavoriteStores(signal, actor, storeId), { value: page, expiresAt: Date.parse(deadline) });
  assert.deepEqual(await api.writeFavoriteStore(signal, actor, storeId, true), { value: validState, expiresAt: Date.parse(deadline) });
  assert.deepEqual(calls.map(([url, init]) => [url, init.method]), [
    ["/api/customer-auth/favorite-stores?after=store-a", "GET"],
    ["/api/customer-auth/favorite-stores?storeId=store-a&favorite=true", "PUT"],
  ]);
  for (const [, init] of calls) {
    assert.equal(init.headers["X-Customer-Context"], actor);
    assert.equal(init.cache, "no-store");
    assert.equal(init.credentials, "same-origin");
    assert.equal(init.redirect, "error");
    assert.equal(init.signal, signal);
  }
});

test("invalid selectors, disabled admission and cancellation fail before owner dispatch", async t => {
  let admissions = 0;
  let calls = 0;
  const api = harness("web", async () => { admissions++; return session(); });
  t.mock.method(globalThis, "fetch", async () => { calls++; return reply(validState); });
  const signal = new AbortController().signal;
  await assert.rejects(api.readFavoriteStores(signal, actor, "../other"), e => e.status === 400);
  await assert.rejects(api.readFavoriteStore(signal, "../other", actor), e => e.status === 400);
  await assert.rejects(api.writeFavoriteStore(signal, actor, "../other", true), e => e.status === 400);
  assert.equal(admissions, 0);
  const disabled = harness("web", async () => ({ enabled: false, session: null }));
  await assert.rejects(disabled.readFavoriteStores(signal), e => e.status === 401);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(api.readFavoriteStore(controller.signal, storeId, actor), e => e.name === "AbortError");
  assert.equal(calls, 0);
});

test("Web rejects cacheable responses and preserves definitive rejection versus unknown write outcome", async t => {
  const api = harness("web", async () => session());
  const signal = new AbortController().signal;
  let status = 200;
  t.mock.method(globalThis, "fetch", async () => Response.json(validState, { status }));
  await assert.rejects(api.readFavoriteStore(signal, storeId, actor), e => e.code === "OWNER_RESPONSE_INVALID");
  await assert.rejects(api.writeFavoriteStore(signal, actor, storeId, true), unknown);
  status = 404;
  await assert.rejects(api.writeFavoriteStore(signal, actor, storeId, true), e => e.status === 404);
  status = 503;
  await assert.rejects(api.writeFavoriteStore(signal, actor, storeId, true), unknown);
});

test("Android requires native origin and verified readback; successful results retain the earlier deadline", async t => {
  const signal = new AbortController().signal;
  let calls = 0;
  const page = { actorId: actor, storeIds: [storeId] };
  const expiresAt = Date.parse("2029-01-01T00:00:00Z");
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    calls++;
    return reply(init.method === "PUT" || calls === 2 ? validState : page);
  });
  const native = async (_signal, invoke, expectedActor) => {
    assert.equal(expectedActor, actor);
    return { kind: "ready", value: await invoke(Buffer.alloc(32, 14).toString("base64url")), expiresAt };
  };
  const missing = harness("android", async () => session(), native, null);
  await assert.rejects(missing.readFavoriteStores(signal, actor), e => e.code === "OWNER_UNAVAILABLE");
  assert.equal(calls, 0);
  const api = harness("android", async () => session(), native);
  assert.deepEqual(await api.readFavoriteStores(signal, actor), { value: page, expiresAt });
  assert.deepEqual(await api.readFavoriteStore(signal, storeId, actor), { value: validState, expiresAt });
  assert.deepEqual(await api.writeFavoriteStore(signal, actor, storeId, true), { value: validState, expiresAt });
  assert.equal(calls, 3);
  const unavailable = harness("android", async () => session(), async () => ({ kind: "unavailable" }));
  await assert.rejects(unavailable.readFavoriteStores(signal, actor), e => e.status === 503);
});
