import assert from "node:assert/strict";
import { test } from "node:test";
import * as dsh from "./index.ts";

const actor="customer-a", bearer=Buffer.alloc(32,13).toString("base64url"), origin="http://127.0.0.1:3202";
const first={storeId:"store-a",storeName:"Test Store",version:1,lineCount:2};
const page={actorId:actor,carts:[first]};
test("cart directory reads only the owner path and validates scope and cursor",async t=>{
  assert.equal(typeof dsh.listCurrentCustomerCarts,"function");
  const calls=[];
  t.mock.method(globalThis,"fetch",async(url,init)=>{
    calls.push([String(url),init.method,init.headers.Authorization]);
    return Response.json(page,{headers:{"Cache-Control":"no-store"}});
  });
  assert.deepEqual(await dsh.listCurrentCustomerCarts(origin,bearer,actor),page);
  assert.deepEqual(calls,[[origin+"/v1/carts","GET","Bearer "+bearer]]);
  for(const bad of [{...page,actorId:"customer-b"},{...page,carts:[first,first]},{...page,carts:[{...first,lineCount:0}]},{...page,nextCursor:"store-a"},{...page,carts:[{...first,version:0}]},{...page,carts:[{...first,storeName:123}]}]){
    assert.throws(()=>dsh.parseCustomerCartDirectory(bad,actor));
  }
  assert.throws(()=>dsh.parseCustomerCartDirectory(page,actor,"store-a"));
  await assert.rejects(dsh.listCurrentCustomerCarts(origin,bearer,actor,"../store-a"));
  assert.equal(calls.length,1);
});
test("directory requires admitted actor and cursor and detaches owner rows", () => {
  for (const invalidActor of ["", " customer-a", "customer\u0000a", "x".repeat(129)]) {
    assert.throws(() => dsh.parseCustomerCartDirectory({ ...page, actorId: invalidActor }, invalidActor), {status: 502});
  }
  assert.throws(() => dsh.parseCustomerCartDirectory(page, actor, "../store"), {status: 502});
  const raw = { actorId: actor, carts: [{ ...first }] };
  const accepted = dsh.parseCustomerCartDirectory(raw, actor);
  raw.carts[0].storeName = "Changed";
  raw.carts.push({ ...first, storeId: "store-b" });
  assert.deepEqual(accepted, page);
  const inherited = Object.assign(Object.create({ nextCursor: undefined }), page);
  assert.deepEqual(dsh.parseCustomerCartDirectory(inherited, actor), page);
});

test("directory rejects invalid runtime selectors before dispatch", async t => {
  const mock = t.mock.method(globalThis, "fetch", async () => Response.json(page, {headers: {"Cache-Control":"no-store"}}));
  await assert.rejects(dsh.listCurrentCustomerCarts(origin, bearer, "customer\u0000a"), {status: 401});
  await assert.rejects(dsh.listCurrentCustomerCarts(origin, bearer, actor, null), {status: 400});
  assert.equal(mock.mock.callCount(), 0);
});

test("directory enforces page shape, exact continuation and public IDs", () => {
  const carts = Array.from({length: 20}, (_, index) => ({ ...first, storeId: "store-" + String(index + 1).padStart(2, "0") }));
  const full = {actorId: actor, carts, nextCursor: "store-20"};
  assert.deepEqual(dsh.parseCustomerCartDirectory(full, actor), full);
  assert.deepEqual(dsh.parseCustomerCartDirectory({actorId:actor,carts:[]}, actor, "store-20"), {actorId:actor,carts:[]});
  for (const bad of [null, [], 1, {...page, nextCursor:undefined}, {...full,nextCursor:"store-19"}, {...full,carts:[...carts,first]},
    {...page,carts:[null]}, {...page,carts:[{...first,storeId:"BAD"}]}, {...page,carts:[{...first,storeName:"x".repeat(121)}]},
    {...page,carts:[{...first,storeName:"\ud800"}]}, {...page,carts:[{...first,lineCount:21}]}, {...page,carts:[{...first,version:Number.MAX_SAFE_INTEGER+1}]}]) {
    assert.throws(() => dsh.parseCustomerCartDirectory(bad, actor), {status:502});
  }
});

test("directory admits only loopback owner and verified continuation", async t => {
  const calls = [];
  const next = {actorId:actor,carts:[{...first,storeId:"store-b"}]};
  t.mock.method(globalThis,"fetch",async url => {
    calls.push(String(url));
    return Response.json(next,{headers:{"Cache-Control":"no-store"}});
  });
  assert.deepEqual(await dsh.listCurrentCustomerCarts(origin,bearer,actor,"store-a"),next);
  assert.deepEqual(calls,[`${origin}/v1/carts?after=store-a`]);
  for (const invalidOrigin of ["https://example.test", "http://127.0.0.1:65536", null]) {
    await assert.rejects(dsh.listCurrentCustomerCarts(invalidOrigin,bearer,actor),{status:503});
  }
  await assert.rejects(dsh.listCurrentCustomerCarts(origin,null,actor),{status:401});
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(dsh.listCurrentCustomerCarts(origin,bearer,actor,undefined,abort.signal),{status:0});
  assert.equal(calls.length,1);
});
