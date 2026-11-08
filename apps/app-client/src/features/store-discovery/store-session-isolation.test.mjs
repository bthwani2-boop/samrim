import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript-ast";

const source = readFileSync(new URL("./store-detail.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("store-detail.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function executableFunction(name, environment) {
  let declaration;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) declaration = node;
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(declaration, `the Store screen must implement ${name}`);
  const js = ts.transpileModule(`${declaration.getText(ast)}; ${name};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return vm.runInNewContext(js, { currentStoreActorID: () => "actor-A", ...environment });
}

function deferred() {
  let resolve;
  const promise = new Promise((next) => { resolve = next; });
  return { promise, resolve };
}

test("Store detail subscribes to account changes and clears private state before refetching", () => {
  const subscription = source.split("const subscription = subscribeClientCartActorChanges(")[1]?.split("if (!subscription.changedDuringSync)", 1)[0];
  assert.ok(subscription, "reuse the existing client-cart actor subscription");
  assert.match(subscription, /currentStoreActorID/);
  assert.match(subscription, /subscribeIdentitySession/);
  assert.match(subscription, /actorRevisionRef.current \+= 1/);
  for (const reset of [
    "setFavoriteBusy(false)", 'setFavoriteOfferBusyID("")',
    "setFavoriteLoading(false)", 'setBusyOfferId("")', 'setAddedOfferId("")',
    "setQuantities({})", "setSelectedModifierOptionIds({})",
    'setError("")', "void load()",
  ]) assert.ok(subscription.includes(reset), `missing mutation-state cleanup: ${reset}`);
  assert.doesNotMatch(subscription, /setCatalogTabs\(/, "the actor callback must not duplicate the load owner's catalog reset");
  const beforeNetwork = source.split("const load = useCallback(async () => {")[1]?.split("    try {", 1)[0];
  assert.ok(beforeNetwork, "the production Store loader must have synchronous initialization");
  for (const reset of [
    "setCatalogTabs({})", "setFavoritesView(false)", "setPopularView(false)",
    "setFavoriteLoadError(false)", "setCatalogRefreshing(false)", "setOpenCart(null)",
    "setCartReadError(false)", "setIsFavorite(false)", "setFavoriteOfferIDs(new Set())",
    "setDetailOffer(null)", 'setState({ kind: "loading" })',
  ]) assert.ok(beforeNetwork.includes(reset), `load must synchronously clear actor-private state: ${reset}`);
  assert.match(source, /subscription\.unsubscribe\(\)/);
  assert.match(source, /if \(!subscription\.changedDuringSync\) void load\(\)/);
});

test("an in-flight add-to-cart from actor A cannot display actor A's cart after switching to B", async () => {
  const request = deferred();
  const events = [];
  const actorRevisionRef = { current: 1 };
  const environment = {
    busyOfferId: "", selectedFulfillmentMode: "CUSTOMER_PICKUP",
    orderabilityByMode: [{ fulfillmentMode: "CUSTOMER_PICKUP", state: "OPEN_FOR_ORDERS" }],
    state: { kind: "ready", store: { orderabilityByMode: [] } },
    currentIdentityState: () => ({ kind: "authenticated" }),
    quantities: {}, selectedModifierOptionIds: {},
    isQuantityAllowed: () => true, validateModifierSelection: () => null,
    actorRevisionRef, storeId: "store-a", cartReadRequestID: { current: 0 },
    setBusyOfferId: (value) => events.push(["busy", value]),
    setAddedOfferId: (value) => events.push(["added", value]),
    setError: (value) => events.push(["error", value]),
    addCatalogOfferToCart: () => request.promise,
    setOpenCart: (value) => events.push(["cart", value]),
    setCartReadError: (value) => events.push(["cartError", value]),
  };
  const add = executableFunction("add", environment);
  const pending = add({ offerId: "offer-a", quantityMinBaseUnits: 1 });
  actorRevisionRef.current = 2;
  request.resolve({ cart: { id: "private-cart-of-A" } });
  await pending;
  assert.equal(events.some(([kind, value]) => kind === "cart" || (kind === "added" && value === "offer-a")), false);
  assert.equal(events.some(([kind, value]) => kind === "busy" && value === ""), false, "old request cannot clear B's busy state");
});

test("old actor favorite mutation and recovery results cannot overwrite the new actor", async () => {
  const favorite = deferred();
  const actorRevisionRef = { current: 1 };
  const events = [];
  const run = executableFunction("toggleFavorite", {
    favoriteBusy: false, isFavorite: false, storeId: "store-a",
    currentIdentityState: () => ({ kind: "authenticated" }),
    actorRevisionRef, setFavoriteBusy: (v) => events.push(["busy", v]),
    setError: (v) => events.push(["error", v]),
    setFavoriteStore: () => favorite.promise,
    setIsFavorite: (v) => events.push(["favorite", v]),
  });
  const pending = run();
  actorRevisionRef.current = 2;
  favorite.resolve(true);
  await pending;
  assert.equal(events.some(([kind]) => kind === "favorite"), false);
  assert.equal(events.some(([kind, value]) => kind === "busy" && value === false), false);
});

test("old actor favorites refresh cannot expose previous account lists", async () => {
  const stores = deferred();
  const offers = deferred();
  const actorRevisionRef = { current: 10 };
  const events = [];
  const reload = executableFunction("reloadFavorites", {
    actorRevisionRef, storeId: "store-a",
    currentIdentityState: () => ({ kind: "authenticated" }),
    setFavoriteLoading: (value) => events.push(["loading", value]),
    listFavoriteStoreIDs: () => stores.promise,
    listFavoriteStoreOfferIDs: () => offers.promise,
    setIsFavorite: (value) => events.push(["favorite", value]),
    setFavoriteOfferIDs: (value) => events.push(["offers", value]),
    setFavoriteLoadError: (value) => events.push(["error", value]),
  });
  const pending = reload();
  actorRevisionRef.current += 1;
  stores.resolve(["store-a"]);
  offers.resolve(["private-offer-a"]);
  await pending;
  assert.equal(events.some(([kind]) => kind === "favorite" || kind === "offers"), false);
  assert.equal(events.some(([kind, value]) => kind === "loading" && value === false), false);
});

test("an in-flight offer favorite from actor A cannot update actor B's catalog or favorites", async () => {
  const favorite = deferred();
  const actorRevisionRef = { current: 3 };
  const events = [];
  const toggle = executableFunction("toggleOfferFavorite", {
    favoriteOfferBusyID: "", storeId: "store-a",
    currentIdentityState: () => ({ kind: "authenticated" }),
    actorRevisionRef, favoriteOfferIDs: new Set(), favoritesView: false,
    setFavoriteOfferBusyID: (value) => events.push(["busy", value]),
    setError: (value) => events.push(["error", value]),
    setFavoriteStoreOffer: () => favorite.promise,
    setCatalogTabs: (value) => events.push(["catalog", value]),
    setFavoriteOfferIDs: (value) => events.push(["offers", value]),
    setFavoriteLoadError: (value) => events.push(["loadError", value]),
  });
  const pending = toggle("offer-a");
  actorRevisionRef.current += 1;
  favorite.resolve(true);
  await pending;
  assert.equal(events.some(([kind]) => ["catalog", "offers", "loadError"].includes(kind)), false);
  assert.equal(events.some(([kind, value]) => kind === "busy" && value === ""), false);
});

test("same-actor add-to-cart still displays the new authoritative cart", async () => {
  const request = deferred();
  const updates = [];
  const actorRevisionRef = { current: 8 };
  const add = executableFunction("add", {
    busyOfferId: "", selectedFulfillmentMode: "CUSTOMER_PICKUP",
    orderabilityByMode: [{ fulfillmentMode: "CUSTOMER_PICKUP", state: "OPEN_FOR_ORDERS" }],
    state: { kind: "ready", store: { orderabilityByMode: [] } },
    currentIdentityState: () => ({ kind: "authenticated" }),
    quantities: {}, selectedModifierOptionIds: {},
    isQuantityAllowed: () => true, validateModifierSelection: () => null,
    actorRevisionRef, storeId: "store-a", cartReadRequestID: { current: 0 },
    setBusyOfferId: (value) => updates.push(["busy", value]),
    setAddedOfferId: (value) => updates.push(["added", value]),
    setError: (value) => updates.push(["error", value]),
    addCatalogOfferToCart: () => request.promise,
    setOpenCart: (value) => updates.push(["cart", value]),
    setCartReadError: (value) => updates.push(["cartError", value]),
  });
  const pending = add({ offerId: "offer-a", quantityMinBaseUnits: 1 });
  const ownCart = { id: "actor-own-cart" };
  request.resolve({ cart: ownCart });
  await pending;
  assert.equal(updates.find(([kind]) => kind === "cart")?.[1]?.id, ownCart.id);
  assert.ok(updates.some(([kind, value]) => kind === "added" && value === "offer-a"));
  assert.ok(updates.some(([kind, value]) => kind === "busy" && value === ""));
});

test("actor switch invokes the Store loader's synchronous private-cache reset before a failed refresh", async () => {
  let handler;
  function findActorHandler(node) {
    if (ts.isCallExpression(node) &&
        node.expression.getText(ast) === "subscribeClientCartActorChanges") {
      handler = node.arguments[3];
    }
    ts.forEachChild(node, findActorHandler);
  }
  findActorHandler(ast);
  assert.ok(handler, "production Identity subscription must provide an actor-change callback");

  const aOnlyOffer = { offerId: "private-A-offer" };
  let tabs = { 1: { catalog: { offers: [aOnlyOffer] } } };
  let favoriteView = true;
  let favoriteError = true;
  let catalogRefreshing = true;
  let error = "old actor error";
  const activeActorIDRef = { current: "actor-A" };
  const actorRevisionRef = { current: 1 };
  let failRead;
  const slowRead = new Promise((resolve, reject) => { failRead = reject; });
  let refresh;
  const changes = [];
  const record = (name) => (value) => changes.push([name, value]);
  const context = {
    activeActorIDRef, actorRevisionRef,
    setCatalogTabs: (value) => { tabs = value; changes.push(["tabs", value]); },
    setFavoritesView: (value) => { favoriteView = value; changes.push(["favoritesView", value]); },
    setFavoriteLoadError: (value) => { favoriteError = value; },
    setCatalogRefreshing: (value) => { catalogRefreshing = value; },
    setError: (value) => { error = value; },
    setOpenCart: record("cart"),
    setCartReadError: record("cartError"),
    setIsFavorite: record("favorite"),
    setFavoriteOfferIDs: record("favoriteOfferIDs"),
    setPopularView: record("popularView"),
    setFavoriteBusy: record("favoriteBusy"),
    setFavoriteOfferBusyID: record("favoriteOfferBusyID"),
    setFavoriteLoading: record("favoriteLoading"),
    setBusyOfferId: record("busyOffer"),
    setAddedOfferId: record("addedOffer"),
    setQuantities: record("quantities"),
    setSelectedModifierOptionIds: record("modifiers"),
    setDetailOffer: record("detail"),
    load: () => {
      // The source assertion above checks these calls are in the production
      // load() before network I/O; execute the same callback contract here.
      context.setCatalogTabs({});
      context.setFavoritesView(false);
      context.setFavoriteLoadError(false);
      context.setCatalogRefreshing(false);
      refresh = slowRead.catch(() => { changes.push(["refresh", "failed"]); });
    },
  };
  const compiled = ts.transpileModule(
    `const onActorChange = ${handler.getText(ast)}; onActorChange;`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
  ).outputText;
  const onActorChange = vm.runInNewContext(compiled, context);
  onActorChange("actor-B");

  assert.equal(activeActorIDRef.current, "actor-B");
  assert.equal(actorRevisionRef.current, 2);
  assert.deepEqual(Object.keys(tabs), [], "actor A's private tab is removed before awaiting DSH");
  assert.equal(favoriteView, false, "the previous actor's favorites filter must close");
  assert.equal(favoriteError, false);
  assert.equal(catalogRefreshing, false);
  assert.equal(error, "");
  assert.equal(changes.filter(([name]) => name === "tabs").length, 1, "the loader is the sole owner of cached catalog clearing");

  failRead(new Error("DSH unavailable"));
  await refresh;
  assert.deepEqual(Object.keys(tabs), [], "failed DSH refresh must not restore actor A's private catalog");
  assert.equal(favoriteView, false);
});
