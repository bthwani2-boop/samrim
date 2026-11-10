import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isCurrentOrderListRequest } from "../src/features/order-management/order-page-records.ts";
import { canUseStoreOrders, derivePartnerAuthority } from "../src/shell/partner-authority.ts";

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

test("Partner Orders uses the canonical OrderManagement for both relations", () => {
  const parent = readFileSync(new URL("../src/features/partner-onboarding/partner-orders.tsx", import.meta.url), "utf8");
  const management = readFileSync(new URL("../src/features/order-management/order-management.tsx", import.meta.url), "utf8");
  assert.match(parent, /<OrderManagement key=\{"orders:" \+ selectedStore\.id\} storeId=\{selectedStore\.id\}/);
  assert.doesNotMatch(parent, /IndependentPickupOrders|independent-pickup-orders|relationModel === "INDEPENDENT_STORE"/);
  assert.match(management, /client\(\)\.listPartnerOrders\(token,/);
  assert.match(parent, /canManageOrders && !isMarketplaceStore\(selectedStore\)[\s\S]*?استقبال الطلبات المباشرة غير مفعّل/);
});

test("More, header selection and Orders honor one authorization rule for both Store relations", () => {
  const more = readFileSync(new URL("../src/features/partner-onboarding/partner-more.tsx", import.meta.url), "utf8");
  assert.match(more, /const canOrders=authority\.canUse\("orders"\)/);
  assert.match(more, /canOrders\?\[\{label:"الطلبات",description:independent\?/);
  for (const relationModel of ["BTHWANI_PARTNER", "INDEPENDENT_STORE", "UNKNOWN"]) {
    for (const [owned, permissions] of [[true, []], [false, ["orders"]], [false, ["catalog"]]]) {
      const store = { relationModel, owned, permissions };
      const allowed = relationModel !== "UNKNOWN" && (owned || permissions.includes("orders"));
      assert.equal(canUseStoreOrders(store), allowed);
      assert.equal(derivePartnerAuthority([store]).canUse("orders"), allowed);
    }
  }
});
