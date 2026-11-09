import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript-ast";

const source = readFileSync(new URL("./store-discovery.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("store-discovery.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function findNode(match) {
  let result;
  function visit(node) {
    if (!result && match(node)) result = node;
    if (!result) ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(result, "expected production code node");
  return result;
}

function execute(sourceText, environment, resultName) {
  const code = ts.transpileModule(`${sourceText}; ${resultName};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return vm.runInNewContext(code, environment);
}

function productionFunction(name, environment) {
  const declaration = findNode((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
  return execute(declaration.getText(ast), environment, name);
}

function actorChangeCallback(environment) {
  const call = findNode((node) => ts.isCallExpression(node) &&
    node.expression.getText(ast) === "subscribeClientCartActorChanges");
  const callback = call.arguments[3];
  assert.ok(callback && ts.isArrowFunction(callback), "production subscription needs an actor switch callback");
  return execute(`const onActorChange = ${callback.getText(ast)}`, environment, "onActorChange");
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("discovery subscribes to actual actor identity and reloads private fields before network I/O", () => {
  const entry = source.split("const subscription = subscribeClientCartActorChanges(")[1]?.split("if (!subscription.changedDuringSync)", 1)[0];
  assert.ok(entry);
  assert.match(entry, /currentDiscoveryActorID/);
  assert.match(entry, /subscribeIdentitySession/);
  assert.match(entry, /void load\(\)/);
  assert.match(source, /subscription\.unsubscribe\(\)/);
  assert.match(source, /if \(!subscription.changedDuringSync\) void load\(\)/);
  const beforeFetch = source.split("const load = useCallback(async () => {")[1]?.split("    try {", 1)[0];
  assert.ok(beforeFetch);
  for (const reset of [
    "++discoveryLoadRequestID.current",
    "directoryRequestID.current += 1",
    "nearbyAddressRequestID.current += 1",
    'setState({ kind: "loading" })',
    'setFavoriteError("")',
    'setFavoriteBusyStoreID("")',
    "setDirectoryLocation(undefined)",
    "setNearestAddress(null)",
    'setNearbyAddressState({ kind: "closed" })',
  ]) assert.ok(beforeFetch.includes(reset), `private field reset missing before request: ${reset}`);
  assert.match(source, /if \(isAuthenticated && currentDiscoveryActorID\(\)\)/);
});

test("actor A-to-B switch initiates one synchronous private-data reset, not only boolean auth rerender", () => {
  const activeActorIDRef = { current: "actor-A" };
  const events = [];
  const onActorChange = actorChangeCallback({
    activeActorIDRef,
    load: () => events.push("reset-and-reload"),
  });
  onActorChange("actor-B");
  assert.equal(activeActorIDRef.current, "actor-B");
  assert.deepEqual(events, ["reset-and-reload"]);
});

test("A's delayed favorite toggle cannot overwrite B's favorites or clear B's busy state", async () => {
  const write = deferred();
  const requestID = { current: 9 };
  const events = [];
  const currentIdentityState = () => ({ kind: "authenticated", identity: { subject: "actor-A" } });
  const environment = {
    isAuthenticated: true, currentDiscoveryActorID: () => currentIdentityState().identity.subject,
    favoriteBusyStoreID: "", state: { kind: "ready", favoriteStoreIDs: ["store-A"] },
    discoveryLoadRequestID: requestID,
    setFavoriteBusyStoreID: (value) => events.push(["busy", value]),
    setFavoriteError: (value) => events.push(["error", value]),
    setState: (update) => events.push(["favorites", update({ kind: "ready", favoriteStoreIDs: [] })]),
    setFavoriteStore: () => write.promise,
    onRequireAuthentication: () => events.push(["login"]),
  };
  const toggle = productionFunction("toggleFavorite", environment);
  const pending = toggle("store-A");
  requestID.current = 10; // actor switch invokes load(), invalidating the old request
  write.resolve(false);
  await pending;
  assert.equal(events.some(([kind]) => kind === "favorites"), false);
  assert.equal(events.some(([kind, value]) => kind === "busy" && value === ""), false);
  assert.equal(events.some(([kind]) => kind === "login"), false);
});

test("A's rejected favorite toggle cannot raise errors in B's session", async () => {
  const write = deferred();
  const requestID = { current: 8 };
  const events = [];
  const toggle = productionFunction("toggleFavorite", {
    isAuthenticated: true, currentDiscoveryActorID: () => "actor-A",
    favoriteBusyStoreID: "", state: { kind: "ready", favoriteStoreIDs: [] },
    discoveryLoadRequestID: requestID, setFavoriteBusyStoreID: (v) => events.push(["busy", v]),
    setFavoriteError: (v) => events.push(["error", v]),
    setFavoriteStore: () => write.promise, setState: () => events.push(["favorites"]),
  });
  const pending = toggle("store-A");
  requestID.current += 1;
  write.reject(new Error("A request failed"));
  await pending;
  assert.equal(events.some(([kind, value]) => kind === "error" && value !== ""), false);
  assert.equal(events.some(([kind, value]) => kind === "busy" && value === ""), false);
});

test("same actor favorite mutation still updates the authorized directory", async () => {
  const events = [];
  let updatedIDs = [];
  const toggle = productionFunction("toggleFavorite", {
    isAuthenticated: true, currentDiscoveryActorID: () => "actor-A",
    favoriteBusyStoreID: "", state: { kind: "ready", favoriteStoreIDs: [] },
    discoveryLoadRequestID: { current: 7 },
    setFavoriteBusyStoreID: (v) => events.push(["busy", v]),
    setFavoriteError: () => {},
    setFavoriteStore: async () => true,
    setState: (update) => { updatedIDs = update({ kind: "ready", favoriteStoreIDs: [] }).favoriteStoreIDs; },
  });
  await toggle("store-A");
  assert.equal(updatedIDs[0], "store-A");
  assert.deepEqual(events, [["busy", "store-A"], ["busy", ""]]);
});

test("late private address fetch cannot display A's addresses after switching to B", async () => {
  const pendingRead = deferred();
  const requestID = { current: 5 };
  const updates = [];
  const openChooser = productionFunction("openNearbyAddressChooser", {
    selectedCityID: "city-A", nearbyAddressState: { kind: "closed" },
    nearestAddress: null, directoryLocation: undefined,
    nearbyAddressRequestID: requestID,
    setNearbyAddressState: (v) => updates.push(v),
    listOwnDeliveryAddresses: () => pendingRead.promise,
    uniqueNearbyAddress: () => null,
  });
  const inFlight = openChooser();
  requestID.current += 1; // production actor switch calls load() and invalidates old read
  pendingRead.resolve({ addresses: [{ id: "private-address-A", serviceCityId: "city-A" }], nextCursor: "" });
  await inFlight;
  assert.equal(updates.some((v) => v.kind === "ready"), false);
  assert.equal(updates[0]?.kind, "loading");
});

test("production discovery reload rejects A's delayed favorites after B becomes active", async () => {
  const declaration = findNode((node) => ts.isVariableDeclaration(node) &&
    node.name.getText(ast) === "load" && node.initializer &&
    ts.isCallExpression(node.initializer) && node.initializer.expression.getText(ast) === "useCallback");
  const arrow = declaration.initializer.arguments[0];
  assert.ok(arrow && ts.isArrowFunction(arrow));
  const aFavorite = deferred();
  const bFavorite = deferred();
  const discoveryLoadRequestID = { current: 0 };
  const directoryRequestID = { current: 0 };
  const directoryRequestKey = { current: "" };
  const nearbyAddressRequestID = { current: 0 };
  let actor = "actor-A";
  let state = { kind: "loading" };
  const context = {
    discoveryLoadRequestID, directoryRequestID, directoryRequestKey, nearbyAddressRequestID,
    selectedCityID: "city-Sana", isAuthenticated: true,
    currentDiscoveryActorID: () => actor,
    setState: (next) => { state = typeof next === "function" ? next(state) : next; },
    setFavoriteError: () => {}, setFavoriteBusyStoreID: () => {},
    setMarketing: () => {}, setDirectoryLoading: () => {}, setDirectoryError: () => {},
    setLoadingMoreStores: () => {}, setLoadMoreStoresError: () => {},
    setDirectoryLocation: () => {}, setNearestAddress: () => {},
    setStoreFilter: () => {}, setNearbyAddressState: () => {},
    listPublishedStores: async () => ({ stores: [{ id: "shared-public-store" }], verticals: [], categories: [], shortcuts: [], nextCursor: "" }),
    normalizeDiscoveryTaxonomy: () => ({ verticals: [], categories: [] }),
    listPublicDiscoveryContent: async () => ({ items: [] }),
    listPublicPromotions: async () => ({ promotions: [] }),
    listFavoriteStoreIDs: () => actor === "actor-A" ? aFavorite.promise : bFavorite.promise,
  };
  const load = execute(`const load = ${arrow.getText(ast)}`, context, "load");
  await load();
  assert.equal(state.kind, "ready");
  assert.equal(state.favoriteStoreIDs.length, 0);
  const activeActorIDRef = { current: "actor-A" };
  const onActorChange = actorChangeCallback({ activeActorIDRef, load });
  actor = "actor-B";
  onActorChange("actor-B");
  assert.equal(state.kind, "loading", "private favorites are cleared before B's DSH read");
  await Promise.resolve();
  await Promise.resolve();
  aFavorite.resolve(["secret-A-store"]);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(state.kind, "ready");
  assert.equal(state.favoriteStoreIDs.length, 0, "A's old response must not restore favorites in B");
  bFavorite.resolve(["store-B"]);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(state.favoriteStoreIDs.length, 1);
  assert.equal(state.favoriteStoreIDs[0], "store-B");
});
