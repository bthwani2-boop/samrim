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