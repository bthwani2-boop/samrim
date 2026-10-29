import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isCurrentOrderListRequest } from "../src/features/order-management/order-page-records.ts";

function deferred() {
  let resolve;
  const promise = new Promise((accept) => { resolve = accept; });
  return { promise, resolve };
}

test("stale store or query responses cannot replace the current order list", async () => {
  let currentGeneration = 1;
  let currentScopeKey = "actor-a|store-a|ACTIVE|";
  let visibleOrders = [];
  const oldRequest = deferred();
  const apply = async (request, generation, scopeKey) => {
    const orders = await request;
    if (isCurrentOrderListRequest(generation, scopeKey, currentGeneration, currentScopeKey)) visibleOrders = orders;
  };
  const oldRead = apply(oldRequest.promise, currentGeneration, currentScopeKey);

  currentGeneration += 1;
  currentScopeKey = "actor-a|store-b|ACTIVE|";
  const authorizedRead = deferred();
  const currentRead = apply(authorizedRead.promise, currentGeneration, currentScopeKey);
  authorizedRead.resolve(["store-b-order"]);
  await currentRead;
  oldRequest.resolve(["store-a-order"]);
  await oldRead;

  assert.deepEqual(visibleOrders, ["store-b-order"]);
});

test("a quiet refresh invalidates an older append, and its own page remains current", () => {
  const scope = "actor-a|store-a|ACTIVE|";
  assert.equal(isCurrentOrderListRequest(4, scope, 5, scope), false);
  assert.equal(isCurrentOrderListRequest(5, scope, 5, scope), true);
  assert.equal(isCurrentOrderListRequest(5, scope, 5, "actor-b|store-a|ACTIVE|"), false);
});

test("real partner order list clears prior scope and prevents old mutations from restarting stale reads", () => {
  const source = readFileSync(new URL("../src/features/order-management/order-management.tsx", import.meta.url), "utf8");
  assert.match(source, /function currentPartnerActor\(\): string \{[\s\S]*?currentIdentityState\(\)[\s\S]*?session\.identity\.subject\.trim\(\)/u);
  assert.match(source, /useSyncExternalStore\(subscribeIdentitySession, currentPartnerActor, \(\) => ""\)/u);
  assert.match(source, /const requestScopeKey = JSON\.stringify\(\[unreadScope, storeId \?\? "", filter, normalizedSearch\]\)/u);
  assert.match(source, /if \(requestScopeKey !== activeScopeKey\.current\) return;\s*const generation/u);
  assert.match(source, /useLayoutEffect\(\(\) => \{[\s\S]*?setOrders\(\[\]\);[\s\S]*?setAssignments\(\{\}\);[\s\S]*?setChatOrderId\(""\);/u);
  assert.match(source, /if \(!isCurrentOrderListRequest\(generation, requestScopeKey, loadGeneration\.current, activeScopeKey\.current\)\) return;/u);
  assert.match(source, /finally \{ releaseAction\(\); if \(requestScopeKey === activeScopeKey\.current\) setBusy\(""\); \}/u);
});
