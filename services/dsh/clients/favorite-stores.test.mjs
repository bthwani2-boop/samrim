import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import YAML from "yaml";
import {
  dshOperations, getCustomerFavoriteStore, listCustomerFavoriteStores,
  parseFavoriteStorePage, parseFavoriteStoreState, setCustomerFavoriteStore,
} from "./index.ts";

const actor = "customer-a";
const bearer = Buffer.alloc(32, 13).toString("base64url");
const origin = "http://127.0.0.1:3202";
const collection = "/v1/customers/me/favorite-stores";
const item = collection + "/{storeID}";
const state = { actorId: actor, storeId: "store-a", favorite: true };
const page = { actorId: actor, storeIds: ["store-a", "store-b"] };
const reply = (value, status = 200) => Response.json(value, {
  status, headers: { "Cache-Control": "no-store" },
});

const entry = new URL("../contracts/openapi/dsh.openapi.yaml", import.meta.url);
function resolve(value, file) {
  while (value?.$ref) {
    const [relative, pointer] = value.$ref.split("#");
    file = new URL(relative || file.href, file);
    value = pointer.slice(1).split("/").reduce(
      (node, key) => node[key.replaceAll("~1", "/").replaceAll("~0", "~")],
      YAML.parse(readFileSync(file, "utf8")),
    );
  }
  return { value, file };
}

test("favorite contract describes the exact owner error codes for each operation", () => {
  const paths = YAML.parse(readFileSync(entry, "utf8")).paths;
  const denial = {
    400: ["INVALID_REQUEST"],
    401: ["UNAUTHORIZED_OR_OWNER_UNAVAILABLE"],
    403: ["UNAUTHORIZED_OR_OWNER_UNAVAILABLE"],
    503: ["OWNER_UNAVAILABLE", "UNAUTHORIZED_OR_OWNER_UNAVAILABLE"],
  };
  for (const [route, method, id, errors] of [
    [collection, "get", "listCurrentCustomerFavoriteStores", denial],
    [item, "get", "getCurrentCustomerFavoriteStore", denial],
    [item, "put", "setCurrentCustomerFavoriteStore", {
      ...denial,
      404: ["STORE_UNAVAILABLE"],
      503: [...denial[503], "OPERATION_RESULT_UNKNOWN"],
    }],
  ]) {
    const group = resolve(paths[route], entry);
    const operation = group.value[method];
    assert.equal(operation.operationId, id);
    assert.deepEqual(dshOperations[id], { method: method.toUpperCase(), path: route });
    assert.deepEqual(operation.security, [{ OpaqueSession: [] }]);
    assert.deepEqual(Object.keys(operation.responses).sort(), ["200", ...Object.keys(errors)].sort());
    for (const [status, expected] of Object.entries(errors)) {
      const response = resolve(operation.responses[status], group.file);
      const schema = resolve(response.value.content["application/json"].schema, response.file).value;
      assert.equal(schema.type, "object");
      assert.equal(schema.additionalProperties, false);
      assert.deepEqual(schema.required, ["error"]);
      const error = schema.properties.error;
      assert.deepEqual([...(error.enum ?? [error.const])].sort(), [...expected].sort(), method + " " + route + " " + status);
    }
  }
});

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
    [origin + collection, "GET", undefined],
    [origin + collection + "/store-a", "GET", undefined],
    [origin + collection + "/store-a", "PUT", JSON.stringify({ favorite: true })],
  ]);
  assert.throws(() => parseFavoriteStoreState({ ...state, actorId: "customer-b" }, actor, "store-a"));
  assert.throws(() => parseFavoriteStoreState({ ...state, favorite: false }, actor, "store-a", true));
  assert.throws(() => parseFavoriteStorePage({ ...page, storeIds: ["store-a", "store-a"] }, actor));
  assert.throws(() => parseFavoriteStorePage({ ...page, nextCursor: "store-b" }, actor));
  await assert.rejects(getCustomerFavoriteStore(origin, bearer, actor, "../store-a"));
  assert.equal(calls.length, 3);
});

test("favorite SDK preserves definitive refusal and never retries an uncertain write", async t => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    calls.push(init.method);
    return calls.length === 1
      ? reply({ error: "STORE_UNAVAILABLE" }, 404)
      : reply({ error: "OWNER_UNAVAILABLE" }, 503);
  });
  await assert.rejects(setCustomerFavoriteStore(origin, bearer, actor, "store-a", true),
    { status: 404, code: "STORE_UNAVAILABLE" });
  await assert.rejects(setCustomerFavoriteStore(origin, bearer, actor, "store-a", true),
    { status: 503, code: "OPERATION_RESULT_UNKNOWN" });
  assert.deepEqual(calls, ["PUT", "PUT"]);
});
