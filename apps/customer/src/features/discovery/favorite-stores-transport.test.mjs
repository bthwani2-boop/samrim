import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as dsh from "@bthwani/dsh";

const root=fileURLToPath(new URL("../../../../../",import.meta.url));
const entry=fileURLToPath(new URL("./favorite-stores-transport.ts",import.meta.url));
const temp=mkdtempSync(path.join(tmpdir(),"favorite-transport-"));
let compiled;
try {
  const result=spawnSync(process.execPath,[path.join(root,"node_modules/typescript/bin/tsc"),entry,
    "--ignoreConfig","--noResolve","--noCheck","--target","es2022","--module","commonjs","--outDir",temp],
    {cwd:root,encoding:"utf8",timeout:20000,windowsHide:true});
  assert.equal(result.status,0,result.stderr||result.stdout);
  compiled=readFileSync(path.join(temp,"favorite-stores-transport.js"),"utf8");
} finally {rmSync(temp,{recursive:true,force:true});}
const actor="customer-a", storeId="store-a";
const session=(actorId=actor)=>({enabled:true,session:{actorId,role:"customer",sessionExpiresAt:"2030-01-01T00:00:00Z"}});
function harness(platform, read, native){
  const modules={"@bthwani/dsh":dsh,"react-native":{Platform:{OS:platform}},
    "../access/customer-session-transport":{readCustomerAdmission:read,withVerifiedNativeCustomerRead:native}};
  const mod={exports:{}};
  const env={EXPO_PUBLIC_CUSTOMER_SYNTHETIC_DSH_ORIGIN:"http://127.0.0.1:3202"};
  new Function("require","module","exports","process",compiled)(name=>{
    assert.ok(Object.hasOwn(modules,name),name);return modules[name];
  },mod,mod.exports,{env});
  return mod.exports;
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
