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
    "promotionRequestID", "orderabilityRequestID", "bannerRequestID", "bannerAppliedRequestID",
  ].map((key) => [key, { current: 0 }]));
  let state = { kind: "loading" };
  let openCart = null;
  let fulfillmentMode = null;
  let favorite = false;
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
  ]) setters[name] = (value) => {
    events.push([name, value]);
    if (name === "setSelectedFulfillmentMode") fulfillmentMode = value;
  };
  setters.setOpenCart = (value) => { openCart = value; events.push(["setOpenCart", value]); };
  setters.setIsFavorite = (value) => { favorite = value; events.push(["setIsFavorite", value]); };
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
    current: () => ({ state, openCart, fulfillmentMode, favorite }),
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
  assert.equal(h.current().favorite, false);

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
