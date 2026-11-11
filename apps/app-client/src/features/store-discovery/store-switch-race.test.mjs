import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript-ast";

const source = readFileSync(new URL("./store-detail.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("store-detail.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function productionStoreLoader() {
  let arrow;
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "load" &&
        node.initializer && ts.isCallExpression(node.initializer) &&
        node.initializer.expression.getText(ast) === "useCallback") {
      arrow = node.initializer.arguments[0];
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.ok(arrow && ts.isArrowFunction(arrow), "test must execute the actual Store loader");
  return ts.transpileModule("const load = " + arrow.getText(ast) + "; load;", {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
}

const compiledLoad = productionStoreLoader();

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function createHarness() {
  const refs = Object.fromEntries([
    "storeRequestID", "catalogRequestID", "detailRequestID", "cartReadRequestID",
    "actorRevisionRef",
    "promotionRequestID", "orderabilityRequestID", "bannerRequestID", "bannerAppliedRequestID",
  ].map((key) => [key, { current: 0 }]));
  let state = { kind: "loading" };
  let openCart = null;
  let fulfillmentMode = null;
  const events = [];
  const setters = {};
  for (const name of [
    "setDetailOffer", "setDetailLoading", "setCatalogTabs", "setSelectedCategoryID",
    "setActiveProductID", "setCatalogQuery", "setCatalogRefreshing", "setLoadingMore",
    "setPromotions", "setMarketingContents", "setBannerError", "setBannerIndex",
    "setBannerPaused", "setPromotionLoading", "setPromotionError",
    "setSelectedFulfillmentMode", "setOrderabilityByMode", "setCartReadError",
    "setFailedStoreImage", "setFailedStoreCover", "setFailedProductImageURIs",
    "setHeroVisible", "setFavoriteOfferIDs", "setFavoritesView", "setPopularView",
    "setFavoriteLoadError", "setError",
    "setFavoriteOfferBusyID", "setFavoriteLoading", "setBusyOfferId",
    "setAddedOfferId", "setQuantities", "setSelectedModifierOptionIds",
    "setShareTarget",
  ]) setters[name] = (value) => {
    events.push([name, value]);
    if (name === "setSelectedFulfillmentMode") fulfillmentMode = value;
  };
  setters.setOpenCart = (value) => { openCart = value; events.push(["setOpenCart", value]); };
  setters.setState = (value) => {
    state = typeof value === "function" ? value(state) : value;
    events.push(["setState", state]);
  };
  const bannerRef = { current: { scrollTo: () => {} } };
  function loader(storeId, store, catalog) {
    const env = {
      ...refs, ...setters, storeId, selectedCityID: "city-sanaa", categoryId: "",
      productId: "", bannerRef, currentIdentityState: () => ({ kind: "guest" }),
      readPublicStoreOrderability: async () => ({
        storeId, serviceCityId: "city-sanaa", orderabilityByMode: [],
      }),
      listPublicStoreBanners: async () => ({ items: [] }),
      listPublicPromotions: async () => ({ promotions: [] }),
      readPublishedStore: () => store.promise,
      readPublicStoreCatalog: () => catalog.promise,
      filterCatalogToProduct: (value) => value,
      storeReadFailureKind: (error) => error?.status === 404 ? "unavailable" : "error",
    };
    return vm.runInNewContext(compiledLoad, env);
  }
  return {
    refs, events, loader,
    current: () => ({ state, openCart, fulfillmentMode }),
  };
}

test("fast Store A to B navigation never paints A's late public catalog over B", async () => {
  const h = createHarness();
  const aStore = deferred(), aCatalog = deferred(), bStore = deferred(), bCatalog = deferred();
  const loadA = h.loader("store-a", aStore, aCatalog);
  const loadB = h.loader("store-b", bStore, bCatalog);

  const pendingA = loadA();
  const pendingB = loadB();
  assert.equal(h.current().state.kind, "loading");
  assert.equal(h.current().openCart, null);
  assert.equal(h.current().fulfillmentMode, null);

  bStore.resolve({ id: "store-b", name: "B" });
  bCatalog.resolve({ offers: [{ offerId: "offer-b" }], sections: [], categories: [] });
  await pendingB;
  assert.equal(h.current().state.store.id, "store-b");

  const updatesBeforeStaleA = h.events.length;
  aStore.resolve({ id: "store-a", name: "A" });
  aCatalog.resolve({ offers: [{ offerId: "offer-a" }], sections: [], categories: [] });
  await pendingA;

  assert.equal(h.current().state.store.id, "store-b");
  assert.equal(h.current().state.catalog.offers[0].offerId, "offer-b");
  assert.equal(h.events.length, updatesBeforeStaleA, "late Store A cannot publish any UI changes");
});

test("late Store A success cannot resurrect an unavailable Store B", async () => {
  const h = createHarness();
  const aStore = deferred(), aCatalog = deferred(), bStore = deferred(), bCatalog = deferred();
  const pendingA = h.loader("store-a", aStore, aCatalog)();
  const pendingB = h.loader("store-b", bStore, bCatalog)();

  bStore.reject({ kind: "http", status: 404 });
  bCatalog.resolve({ offers: [] });
  await pendingB;
  assert.equal(h.current().state.kind, "unavailable");

  aStore.resolve({ id: "store-a", name: "A" });
  aCatalog.resolve({ offers: [{ offerId: "private-A" }] });
  await pendingA;
  assert.equal(h.current().state.kind, "unavailable", "old Store content stays unavailable");
  assert.equal(h.current().openCart, null);
});

test("late Store A 404 must not mark a newer READY Store B unavailable", async () => {
  const h = createHarness();
  const aStore = deferred(), aCatalog = deferred(), bStore = deferred(), bCatalog = deferred();
  const pendingA = h.loader("store-a", aStore, aCatalog)();
  const pendingB = h.loader("store-b", bStore, bCatalog)();

  bStore.resolve({ id: "store-b", name: "B" });
  bCatalog.resolve({ offers: [{ offerId: "offer-b" }], sections: [], categories: [] });
  await pendingB;
  assert.equal(h.current().state.kind, "ready");
  assert.equal(h.current().state.store.id, "store-b");

  const updatesBeforeOldError = h.events.length;
  aStore.reject({ kind: "http", status: 404 });
  aCatalog.resolve({ offers: [{ offerId: "stale-offer-a" }] });
  await pendingA;
  assert.equal(h.current().state.kind, "ready");
  assert.equal(h.current().state.store.id, "store-b");
  assert.equal(h.events.length, updatesBeforeOldError, "old unavailable response cannot hide Store B");
});

function productionAction(name, environment) {
  let fn;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) fn = node;
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(fn, "test must execute the actual " + name + " handler");
  const code = ts.transpileModule(fn.getText(ast) + "; " + name + ";", {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return vm.runInNewContext(code, { currentStoreActorID: () => "actor-A", ...environment });
}

test("Store A late add-to-cart cannot replace B's cart after same-actor Store navigation", async () => {
  const h = createHarness();
  const pending = deferred();
  const add = productionAction("add", {
    busyOfferId: "", selectedFulfillmentMode: "CUSTOMER_PICKUP",
    orderabilityByMode: [{ fulfillmentMode: "CUSTOMER_PICKUP", state: "OPEN_FOR_ORDERS" }],
    state: { kind: "ready", store: { orderabilityByMode: [] } },
    currentIdentityState: () => ({ kind: "authenticated" }),
    quantities: {}, selectedModifierOptionIds: {},
    isQuantityAllowed: () => true, validateModifierSelection: () => null,
    actorRevisionRef: h.refs.actorRevisionRef,
    storeId: "store-a", cartReadRequestID: h.refs.cartReadRequestID,
    setBusyOfferId: (value) => h.events.push(["busy", value]),
    setAddedOfferId: (value) => h.events.push(["added", value]),
    setError: (value) => h.events.push(["error", value]),
    addCatalogOfferToCart: () => pending.promise,
    setOpenCart: (value) => h.events.push(["cart", value]),
    setCartReadError: (value) => h.events.push(["cartError", value]),
  });
  const oldWrite = add({ offerId: "offer-A", quantityMinBaseUnits: 1 });
  const storeB = deferred(), catalogB = deferred();
  void h.loader("store-B", storeB, catalogB)();
  const eventsAfterSwitch = h.events.length;
  pending.resolve({ cart: { id: "store-A-cart" } });
  await oldWrite;
  assert.equal(h.events.slice(eventsAfterSwitch).some(([kind]) => ["cart", "added", "cartError", "busy"].includes(kind)), false,
    "A's delayed add result must not write B UI or clear its busy state");
  assert.ok(h.events.some(([kind, value]) => kind === "setBusyOfferId" && value === ""),
    "new Store clears old Store's in-flight busy button");
});

test("withdrawn Store invalidates an in-flight cart mutation before stale completion", async () => {
  let focus;
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === "useFocusEffect") {
      focus = node.arguments[0]?.arguments?.[0];
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(focus && ts.isArrowFunction(focus), "test executes actual focused Store revalidation");
  const h = createHarness(), pendingCart = deferred(), pendingOrderability = deferred(), pendingBanners = deferred();
  const offer = { offerId: "store-A-offer", quantityMinBaseUnits: 1 };
  const add = productionAction("add", {
    busyOfferId: "", selectedFulfillmentMode: "CUSTOMER_PICKUP",
    orderabilityByMode: [{ fulfillmentMode: "CUSTOMER_PICKUP", state: "OPEN_FOR_ORDERS" }],
    state: { kind: "ready", store: { orderabilityByMode: [] } },
    currentIdentityState: () => ({ kind: "authenticated" }),
    quantities: {}, selectedModifierOptionIds: {},
    isQuantityAllowed: () => true, validateModifierSelection: () => null,
    actorRevisionRef: h.refs.actorRevisionRef,
    storeId: "store-A", cartReadRequestID: h.refs.cartReadRequestID,
    setBusyOfferId: (v) => h.events.push(["busy", v]),
    setAddedOfferId: (v) => h.events.push(["added", v]),
    setError: (v) => h.events.push(["error", v]),
    addCatalogOfferToCart: () => pendingCart.promise,
    setOpenCart: (v) => h.events.push(["cart", v]),
    setCartReadError: (v) => h.events.push(["cartError", v]),
  });
  const oldWrite = add(offer);
  const code = ts.transpileModule("const onFocus = " + focus.getText(ast) + "; onFocus;", {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const env = {
    ...h.refs, storeId: "store-A", selectedCityID: "city-sanaa",
    readPublicStoreOrderability: () => pendingOrderability.promise,
    listPublicStoreBanners: () => pendingBanners.promise,
    storeReadFailureKind: (err) => err?.status === 404 ? "unavailable" : "error",
    setOrderabilityByMode: (v) => h.events.push(["orderability", v]),
    setBusyOfferId: (v) => h.events.push(["busy", v]),
    setAddedOfferId: (v) => h.events.push(["added", v]),
    setFavoriteOfferBusyID: (v) => h.events.push(["offerBusy", v]),
    setFavoriteLoading: (v) => h.events.push(["favoriteLoading", v]),
    setState: (v) => h.events.push(["state", v]),
    setDetailOffer: (v) => h.events.push(["detail", v]),
    setOpenCart: (v) => h.events.push(["cart", v]),
    setMarketingContents: (v) => h.events.push(["banners", v]),
    setBannerError: (v) => h.events.push(["bannerError", v]),
    setInterval: () => 1,
    clearInterval: () => {},
  };
  const onFocus = vm.runInNewContext(code, env);
  const cleanup = onFocus();
  const previousRevision = h.refs.actorRevisionRef.current;
  pendingOrderability.reject({ status: 404 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(h.events.some(([kind, value]) => kind === "state" && value.kind === "unavailable"));
  assert.equal(h.refs.actorRevisionRef.current, previousRevision + 1);
  const eventsAfterWithdrawal = h.events.length;
  pendingBanners.resolve({ items: [{ id: "withdrawn-store-banner" }] });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.events.slice(eventsAfterWithdrawal).some(([kind]) => kind === "banners"), false,
    "old Store banner must not repaint an unavailable Store");
  const eventsAfterBanner = h.events.length;
  pendingCart.resolve({ cart: { id: "withdrawn-store-cart" } });
  await oldWrite;
  assert.equal(h.events.slice(eventsAfterBanner).some(([kind]) => ["cart", "added", "busy"].includes(kind)), false);
  cleanup();
});

test("leaving Store while a cart mutation is pending cannot repaint an unmounted screen", async () => {
  let effect;
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect" &&
        node.arguments[0]?.getText(ast).includes("subscribeClientCartActorChanges")) effect = node.arguments[0];
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(effect && ts.isArrowFunction(effect));
  const h = createHarness(), pending = deferred();
  const updates = [];
  const add = productionAction("add", {
    busyOfferId: "", selectedFulfillmentMode: "CUSTOMER_PICKUP",
    orderabilityByMode: [{ fulfillmentMode: "CUSTOMER_PICKUP", state: "OPEN_FOR_ORDERS" }],
    state: { kind: "ready", store: { orderabilityByMode: [] } },
    currentIdentityState: () => ({ kind: "authenticated" }),
    quantities: {}, selectedModifierOptionIds: {},
    isQuantityAllowed: () => true, validateModifierSelection: () => null,
    actorRevisionRef: h.refs.actorRevisionRef,
    storeId: "store-A", cartReadRequestID: h.refs.cartReadRequestID,
    setBusyOfferId: (v) => updates.push(["busy", v]),
    setAddedOfferId: (v) => updates.push(["added", v]),
    setError: () => {},
    addCatalogOfferToCart: () => pending.promise,
    setOpenCart: (v) => updates.push(["cart", v]),
    setCartReadError: (v) => updates.push(["cartError", v]),
  });
  const inFlight = add({ offerId: "offer-A", quantityMinBaseUnits: 1 });
  const code = ts.transpileModule("const runEffect = " + effect.getText(ast) + "; runEffect;", {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const runEffect = vm.runInNewContext(code, {
    ...h.refs, activeActorIDRef: { current: "actor-A" },
    currentStoreActorID: () => "actor-A",
    subscribeClientCartActorChanges: () => ({ changedDuringSync: true, unsubscribe: () => {} }),
    subscribeIdentitySession: () => () => {},
    load: async () => {},
  });
  const cleanup = runEffect();
  assert.equal(typeof cleanup, "function");
  const beforeCleanup = h.refs.actorRevisionRef.current;
  cleanup();
  assert.equal(h.refs.actorRevisionRef.current, beforeCleanup + 1);
  const afterCleanup = updates.length;
  pending.resolve({ cart: { id: "old-cart" } });
  await inFlight;
  assert.equal(updates.length, afterCleanup, "stale async operation cannot setState after cleanup");
});
