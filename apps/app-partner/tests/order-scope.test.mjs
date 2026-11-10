import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript-ast";
import { isCurrentOrderListRequest } from "../src/features/order-management/order-page-records.ts";
import { partnerSetupSessionKey } from "../src/features/partner-onboarding/partner-setup-session-scope.ts";
import { canUseStoreOrders, derivePartnerAuthority, isMarketplaceStore } from "../src/shell/partner-authority.ts";

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
  assert.match(source, /function currentPartnerSessionKey\(\): string \{[\s\S]*?partnerSetupSessionKey\(currentIdentityState\(\)\)/u);
  assert.match(source, /useSyncExternalStore\(subscribeIdentitySession, currentPartnerSessionKey, \(\) => ""\)/u);
  assert.match(source, /const requestScopeKey = JSON\.stringify\(\[unreadScope, requestedStoreIDs, filter, normalizedSearch\]\)/u);
  assert.match(source, /if \(requestScopeKey !== activeScopeKey\.current \|\| !unreadScope \|\| currentPartnerSessionKey\(\) !== unreadScope\) return;\s*const generation/u);
  assert.match(source, /useLayoutEffect\(\(\) => \{[\s\S]*?setOrders\(\[\]\);[\s\S]*?setAssignments\(\{\}\);[\s\S]*?setChatOrderId\(""\);/u);
  assert.match(source, /if \(currentPartnerSessionKey\(\) !== unreadScope \|\| !isCurrentOrderListRequest\(generation, requestScopeKey, loadGeneration\.current, activeScopeKey\.current\)\) return;/u);
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
  assert.match(parent, /<OrderManagement key=\{`orders:\$\{identityScope\}:\$\{selectedStore\.id\}`\} storeId=\{selectedStore\.id\}/);
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

function runAuthorizedOrderDeepLink({ targetStoreId, selectedStoreId, permitted = true, kind = "ready", identityScope = "partner-session-a" }, appliedTargetStore, selected) {
  const source = readFileSync(new URL("../src/features/partner-onboarding/partner-orders.tsx", import.meta.url), "utf8");
  const tree = ts.createSourceFile("partner-orders.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback;
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(tree) === "useEffect" &&
        node.arguments[0]?.getText(tree).includes("appliedTargetStore.current")) {
      callback = node.arguments[0].getText(tree);
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(callback, "the production deep-link effect must be present");
  const targetAlreadyApplied = appliedTargetStore.current.session === identityScope &&
    appliedTargetStore.current.storeId === targetStoreId;
  runInNewContext(`(${callback})()`, {
    identityScope,
    targetAlreadyApplied,
    state: { kind },
    targetStoreId,
    targetStorePermitted: permitted,
    appliedTargetStore,
    selectedStore: selectedStoreId ? { id: selectedStoreId } : undefined,
    selectStore: value => selected.push(value),
  });
}

test("Orders deep link selects once and never overrides a later manual Store choice", () => {
  const appliedTargetStore = { current: { session: "", storeId: "", observed: false } };
  const selected = [];
  const visit = (targetStoreId, selectedStoreId, permitted) =>
    runAuthorizedOrderDeepLink({ targetStoreId, selectedStoreId, permitted }, appliedTargetStore, selected);

  visit("store-a", "store-b", true);
  assert.deepEqual(selected, ["store-a"]);
  visit("store-a", "store-a", true);
  visit("store-a", "store-b", true); // Merchant manually selects B while URL still names A.
  assert.deepEqual(selected, ["store-a"], "the unchanged URL must not reselect Store A");

  visit("store-c", "store-b", true);
  assert.deepEqual(selected, ["store-a", "store-c"], "a new URL target is a new explicit intent");
  visit(undefined, "store-c", true);
  assert.equal(appliedTargetStore.current.storeId, "", "removing the parameter clears old URL intent");
  visit("store-a", "store-c", true);
  assert.deepEqual(selected, ["store-a", "store-c", "store-a"]);
});

test("unauthorized and unresolved Orders deep links never override the active Store", () => {
  const appliedTargetStore = { current: { session: "", storeId: "", observed: false } };
  const selected = [];
  const drive = (kind, permitted) => runAuthorizedOrderDeepLink({
    targetStoreId: "store-secret", selectedStoreId: "store-owned", permitted, kind,
  }, appliedTargetStore, selected);
  drive("loading", true);
  drive("ready", false);
  drive("error", true);
  assert.deepEqual(selected, []);
  assert.equal(appliedTargetStore.current.storeId, "", "no unauthorized target is consumed");
  drive("ready", true);
  assert.deepEqual(selected, ["store-secret"]);
});

function productionInitializer(source, name) {
  const tree = ts.createSourceFile("merchant-order-scope.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name && node.initializer) {
      expression = node.initializer.getText(tree);
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(expression, "missing production initializer: " + name);
  return ts.transpileModule("const " + name + " = " + expression + "; " + name + ";", {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
}

const ordersPage = readFileSync(new URL("../src/features/partner-onboarding/partner-orders.tsx", import.meta.url), "utf8");
const ordersManagement = readFileSync(new URL("../src/features/order-management/order-management.tsx", import.meta.url), "utf8");

test("marketplace aggregate builds only authorized marketplace Store IDs from canonical Store scopes", () => {
  const stores = [
    { id: "market-b", relationModel: "BTHWANI_PARTNER", owned: true, permissions: [] },
    { id: "independent", relationModel: "INDEPENDENT_STORE", owned: true, permissions: ["orders"] },
    { id: "market-a", relationModel: "BTHWANI_PARTNER", owned: false, permissions: ["orders"] },
    { id: "market-forbidden", relationModel: "BTHWANI_PARTNER", owned: false, permissions: ["catalog"] },
  ];
  const ids = runInNewContext(productionInitializer(ordersPage, "marketOrderStoreIDs"), {
    stores, useMemo: fn => fn(), isMarketplaceStore, canUseStoreOrders,
  });
  assert.deepEqual(Array.from(ids), ["market-a", "market-b"]);
  assert.match(ordersPage, /aggregateMode \? <OrderManagement key=\{`all-marketplace:\$\{identityScope\}:\$\{marketOrderStoreIDs\.join\(","\)\}`\} storeIds=\{marketOrderStoreIDs\}/);
  assert.match(ordersPage, /marketAggregateTooLarge = marketOrderStoreIDs\.length > 200/);
  assert.match(ordersPage, /غير متاح لأكثر من 200 متجر/);
});

function invokeProductionOrderLoad(requestedStoreIDs, response = { orders: [], nextCursor: "", attention: null }) {
  const requests = [];
  const errors = [];
  const displayed = [];
  let liveSessionKey = "actor-a:scope-a";
  const activeScopeKey = { current: "actor-a:scope-a" };
  const loadGeneration = { current: 0 };
  const context = {
    useCallback: fn => fn,
    requestScopeKey: "actor-a:scope-a",
    activeScopeKey, loadGeneration, requestedStoreIDs,
    unreadScope: "actor-a:scope-a", currentPartnerSessionKey: () => liveSessionKey,
    targetOrderId: "", filter: "ACTIVE", normalizedSearch: "",
    queueFilters: [{ key: "ACTIVE", states: ["CREATED"] }],
    canFulfillOrder: () => false,
    getUsableIdentityAccessToken: async () => "token-a",
    client: () => ({ listPartnerOrders: async (token, options) => {
      requests.push({ token, options });
      return response;
    } }),
    isCurrentOrderListRequest: (generation, key, currentGeneration, activeKey) =>
      generation === currentGeneration && key === activeKey,
    setLoading: () => {}, setLoadingMore: () => {}, setCursor: () => {},
    setHasMore: () => {}, setSidecarError: () => {}, setAttention: () => {},
    setError: value => errors.push(value),
    setOrders: updater => displayed.push(typeof updater === "function" ? updater([]) : updater),
    console: { error: () => {} },
  };
  const load = runInNewContext(productionInitializer(ordersManagement, "load"), context);
  return { run: () => load(), requests, errors, displayed, activeScopeKey,
    switchSession: key => { liveSessionKey = key; } };
}

test("canonical Partner order reader sends exact selected market scope and rejects a foreign Store in readback", async () => {
  const good = invokeProductionOrderLoad(["market-a", "market-b"], {
    orders: [{ id: "order-a", storeId: "market-a", state: "CREATED", fulfillmentMode: "CUSTOMER_PICKUP" }],
    nextCursor: "", attention: null,
  });
  await good.run();
  assert.equal(good.requests.length, 1);
  assert.equal(good.requests[0].token, "token-a");
  assert.deepEqual(Array.from(good.requests[0].options.storeIds), ["market-a", "market-b"]);
  assert.equal(good.displayed.length, 1);

  const foreign = invokeProductionOrderLoad(["market-a", "market-b"], {
    orders: [{ id: "independent-order", storeId: "independent", state: "CREATED", fulfillmentMode: "CUSTOMER_PICKUP" }],
    nextCursor: "", attention: null,
  });
  await foreign.run();
  assert.equal(foreign.requests.length, 1);
  assert.equal(foreign.displayed.length, 0, "foreign relation readback must never reach visible Order state");
  assert.ok(foreign.errors.some(Boolean));
});

test("missing or oversized Store scope fails closed without falling back to all authorized Orders", async () => {
  for (const ids of [[], Array.from({ length: 201 }, (_, i) => "market-" + i)]) {
    const run = invokeProductionOrderLoad(ids);
    await run.run();
    assert.equal(run.requests.length, 0, "unscoped/oversized reads must never reach DSH");
    assert.equal(run.displayed.length, 0);
    assert.ok(run.errors.some(Boolean));
  }
  assert.match(ordersManagement, /JSON\.stringify\(\[unreadScope, requestedStoreIDs, filter, normalizedSearch\]\)/);
});


test("Order list session selector distinguishes renewals of the same Merchant without inventing another identity owner", () => {
  const source = readFileSync(new URL("../src/features/order-management/order-management.tsx", import.meta.url), "utf8");
  const ast = ts.createSourceFile("order-management.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const selector = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "currentPartnerSessionKey");
  assert.ok(selector, "production Orders identity selector exists");
  const runnable = ts.transpileModule(selector.getText(ast) + "\ncurrentPartnerSessionKey()", {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const identity = (subject, sessionId, role = "partner") =>
    ({ kind: "authenticated", identity: { role, subject, sessionId } });
  const key = state => runInNewContext(runnable, {
    currentIdentityState: () => state,
    partnerSetupSessionKey,
  });
  const first = key(identity("merchant-a", "session-1"));
  const refreshed = key(identity("merchant-a", "session-2"));
  const another = key(identity("merchant-b", "session-1"));
  assert.ok(first && refreshed && another);
  assert.notEqual(first, refreshed, "re-authentication by same actor must invalidate Orders and unread messages");
  assert.notEqual(first, another, "different actor must not share Store Orders");
  assert.equal(key(identity("merchant-a", "session-2", "operator")), "");
  assert.equal(key({ kind: "unauthenticated" }), "");
  const orderScope = session => JSON.stringify([session, ["store-a"], "ACTIVE", ""]);
  assert.equal(isCurrentOrderListRequest(3, orderScope(first), 3, orderScope(refreshed)), false);
  assert.match(source, /currentPartnerSessionKey\(\) !== unreadScope \|\| !isCurrentOrderListRequest/);
  assert.match(source, /useConversationUnreadCounts\(orders\.map\(order => order\.id\), unreadScope/);
});

test("late same-actor session replacement cannot publish a pending DSH Orders response", async () => {
  const oldRequest = deferred();
  const harness = invokeProductionOrderLoad(["market-a"], oldRequest.promise);
  const operation = harness.run();
  for (let pass = 0; pass < 4 && !harness.requests.length; pass++) {
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.equal(harness.requests.length, 1, "original session must have issued a real scoped query");
  harness.switchSession("actor-a:renewed-session");
  oldRequest.resolve({
    orders: [{ id: "private-old", storeId: "market-a", state: "CREATED", fulfillmentMode: "CUSTOMER_PICKUP" }],
    nextCursor: "",
    attention: null,
  });
  await operation;
  assert.equal(harness.displayed.length, 0, "former-session results cannot become visible");
  assert.equal(harness.errors.filter(Boolean).length, 0, "former-session error must not replace the new session's UI");
});
