import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isCurrentOrderListRequest, reconcileVersionedOrderPage } from "../src/features/order-management/order-page-records.ts";

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

test("failed Partner order search can clear both q and pinned orderId without hiding empty-result recovery", () => {
  const source = readFileSync(new URL("../src/features/order-management/order-management.tsx", import.meta.url), "utf8");
  assert.match(source, /!loading && !orders\.length && !error \? <View/);
  assert.match(source, /!loading && error && normalizedSearch \? <View/);
  const clearActions = source.match(/label="مسح بحث الطلبات"[^\n]*[\s\S]*?onPress=\{\(\) => router\.setParams\(\{ q: "", orderId: "" \}\)\}/g) ?? [];
  assert.equal(clearActions.length, 2, "empty and failed searches must each have a scoped clear action");
});

test("Partner orders route scope resets to selected Store when the aggregate parameter disappears", () => {
  const source = readFileSync(new URL("../src/features/partner-onboarding/partner-orders.tsx", import.meta.url), "utf8");
  assert.match(source, /useEffect\(\(\) => \{ setScope\(routeScope === "all" \? "ALL_AUTHORIZED" : "SELECTED_STORE"\); \}, \[routeScope\]\)/);
});

test("independent pickup order UI includes Store-scoped render and pre-dispatch guards", () => {
  const source = readFileSync(new URL("../src/features/order-management/independent-pickup-orders.tsx", import.meta.url), "utf8");
  const storeA = JSON.stringify(["actor-a", "store-a"]);
  const storeB = JSON.stringify(["actor-a", "store-b"]);
  assert.equal(isCurrentOrderListRequest(2, storeA, 2, storeB), false);
  assert.match(source, /const scopeKey = JSON\.stringify\(\[scope, storeID\]\)/u);
  assert.match(source, /isCurrentOrderListRequest\(request, scopeKey, generation\.current, activeScopeKey\.current\)/u);
  assert.match(source, /const visible = visibleScopeKey === scopeKey/u);
  assert.match(source, /!loading && visible && orders\.map\(order =>/u);
  assert.match(source, /confirm && visible && confirm\.order\.storeId === storeID/u);
  assert.match(source, /const token = await scopedToken\(scope\);[\s\S]*?if \(!isCurrentAction\(\)\) return;[\s\S]*?transitionIndependentPickupOrder\(token, storeID/u);
});

test("A-B-A Store switching invalidates an earlier direct-order mutation", () => {
  const source = readFileSync(new URL("../src/features/order-management/independent-pickup-orders.tsx", import.meta.url), "utf8");
  const scopeA = JSON.stringify(["actor-a", "store-a"]);
  const scopeB = JSON.stringify(["actor-a", "store-b"]);
  const requestEpoch = 3;
  assert.equal(isCurrentOrderListRequest(requestEpoch, scopeA, requestEpoch + 1, scopeB), false);
  assert.equal(isCurrentOrderListRequest(requestEpoch, scopeA, requestEpoch + 2, scopeA), false);
  assert.equal(isCurrentOrderListRequest(requestEpoch + 2, scopeA, requestEpoch + 2, scopeA), true);
  assert.equal((source.match(/scopeEpoch\.current \+= 1/g) ?? []).length, 2);
  assert.match(source, /isCurrentOrderListRequest\(requestedEpoch, requestedScopeKey, scopeEpoch\.current, activeScopeKey\.current\)/u);
});

test("fresh direct-order readback never rolls back a confirmed higher-version transition", () => {
  const accepted = { orderId: "order-a", storeId: "store-a", version: 2, state: "ACCEPTED" };
  const preparing = { ...accepted, version: 3, state: "PREPARING" };
  const second = { orderId: "order-b", storeId: "store-a", version: 1, state: "SUBMITTED" };
  assert.deepEqual(reconcileVersionedOrderPage([preparing], [accepted, second], false), [preparing, second]);
  assert.deepEqual(reconcileVersionedOrderPage([preparing, second], [second], false), [second],
    "a fresh authorized read must remove orders absent from the owner response");
});

test("older paginated direct-order pages cannot duplicate or downgrade a changed order", () => {
  const first = { orderId: "order-a", version: 3, state: "PREPARING" };
  const second = { orderId: "order-b", version: 1, state: "SUBMITTED" };
  const updatedSecond = { ...second, version: 2, state: "ACCEPTED" };
  const olderFirst = { ...first, version: 2, state: "ACCEPTED" };
  const third = { orderId: "order-c", version: 1, state: "SUBMITTED" };
  assert.deepEqual(reconcileVersionedOrderPage([first, second], [olderFirst, updatedSecond, third], true),
    [first, updatedSecond, third]);
});

test("the real direct-order list uses version-aware owner readback", () => {
  const source = readFileSync(new URL("../src/features/order-management/independent-pickup-orders.tsx", import.meta.url), "utf8");
  assert.match(source, /setOrders\(previous => reconcileVersionedOrderPage\(previous, result\.orders, Boolean\(after\)\)\)/);
});
