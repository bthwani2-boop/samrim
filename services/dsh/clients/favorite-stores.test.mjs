import assert from "node:assert/strict";
import { test } from "node:test";
import { getCustomerFavoriteStore, listCustomerFavoriteStores, setCustomerFavoriteStore, parseFavoriteStorePage, parseFavoriteStoreState } from "./index.ts";

const actor = "customer-a";
const bearer = Buffer.alloc(32, 13).toString("base64url");
const origin = "http://127.0.0.1:3202";
const state = { actorId: actor, storeId: "store-a", favorite: true };
const page = { actorId: actor, storeIds: ["store-a", "store-b"] };
const reply = value => Response.json(value, { headers: { "Cache-Control": "no-store" } });

test("favorite SDK uses owner operation paths and rejects foreign or malformed replies", async t => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push([String(url), init.method, init.body]);
    assert.equal(init.headers.Authorization, "Bearer " + bearer);
    return reply(String(url).endsWith("favorite-stores") ? page : state);
  });
  assert.deepEqual(await listCustomerFavoriteStores(origin, bearer, actor), page);
  assert.deepEqual(await getCustomerFavoriteStore(origin, bearer, actor, "store-a"), state);
  assert.deepEqual(await setCustomerFavoriteStore(origin, bearer, actor, "store-a", true), state);
  assert.deepEqual(calls, [
    [origin+"/v1/customers/me/favorite-stores","GET",undefined],
    [origin+"/v1/customers/me/favorite-stores/store-a","GET",undefined],
    [origin+"/v1/customers/me/favorite-stores/store-a","PUT",JSON.stringify({favorite:true})],
  ]);
  assert.throws(() => parseFavoriteStoreState({...state, actorId:"customer-b"},actor,"store-a"));
  assert.throws(() => parseFavoriteStoreState({...state, favorite:false},actor,"store-a",true));
  assert.throws(() => parseFavoriteStorePage({...page,storeIds:["store-a","store-a"]},actor));
  assert.throws(() => parseFavoriteStorePage({...page,nextCursor:"store-b"},actor));
  await assert.rejects(getCustomerFavoriteStore(origin,bearer,actor,"../store-a"));
  assert.equal(calls.length,3);
});
