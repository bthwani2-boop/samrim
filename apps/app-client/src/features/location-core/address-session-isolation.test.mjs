import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript-ast";

const source = readFileSync(new URL("./location-core.tsx", import.meta.url), "utf8");
const clientSource = readFileSync(new URL("./delivery-address-client.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("location-core.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const clientAst = ts.createSourceFile("delivery-address-client.ts", clientSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

function find(astRoot, predicate) {
  let match;
  function visit(node) {
    if (!match && predicate(node)) match = node;
    if (!match) ts.forEachChild(node, visit);
  }
  visit(astRoot);
  assert.ok(match, "Expected production function/handler not found");
  return match;
}
function execute(body, environment, binding) {
  const javascript = ts.transpileModule(body + "\n" + binding + ";", {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return vm.runInNewContext(javascript, environment);
}
function method(name, environment, astRoot = ast) {
  const fn = find(astRoot, (node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
  return execute(fn.getText(astRoot), environment, name);
}
function loader(environment) {
  const variable = find(ast, (node) => ts.isVariableDeclaration(node) && node.name.getText(ast) === "load" &&
    node.initializer && ts.isCallExpression(node.initializer) &&
    node.initializer.expression.getText(ast) === "useCallback");
  return execute("const load = " + variable.initializer.arguments[0].getText(ast), environment, "load");
}
function onActorChange(environment) {
  const subscription = find(ast, (node) => ts.isCallExpression(node) &&
    node.expression.getText(ast) === "subscribeClientCartActorChanges");
  const callback = subscription.arguments[3];
  assert.ok(callback && ts.isArrowFunction(callback));
  return execute("const onChange = " + callback.getText(ast), environment, "onChange");
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("actor switch clears A address rows, edit, precise coordinates and text before B fetch", async () => {
  let actor = "actor-A";
  let addressState = { kind: "ready", actorID: actor, addresses: [{ id: "private-A", addressText: "private" }], nextCursor: "" };
  const pageGeneration = { current: 3 }, locationGeneration = { current: 8 }, actorRevision = { current: 2 };
  const firstSuccessfulLoad = { current: false }, activeActorIDRef = { current: actor };
  const pending = deferred(), events = [];
  const env = {
    pageGeneration, locationGeneration, actorRevision, firstSuccessfulLoad, activeActorIDRef,
    currentAddressActorID: () => actor,
    listOwnDeliveryAddresses: () => pending.promise,
    setState: (value) => { addressState = value; events.push(["state", value.kind]); },
    setError: (value) => events.push(["error", value]),
    setFormOpen: (value) => events.push(["form", value]),
    setEditing: (value) => events.push(["editing", value]),
    setAddressText: (value) => events.push(["text", value]),
    setAddressCityID: (value) => events.push(["city", value]),
    setCoordinates: (value) => events.push(["coordinates", value]),
    setBusy: (value) => events.push(["busy", value]),
    setLoadingMore: (value) => events.push(["more", value]),
    setLocationBusy: (value) => events.push(["locationBusy", value]),
    setNotice: (value) => events.push(["notice", value]),
  };
  const load = loader(env);
  const change = onActorChange({ ...env, load });
  actor = "actor-B";
  change("actor-B");
  assert.equal(activeActorIDRef.current, "actor-B");
  assert.equal(addressState.kind, "loading");
  assert.equal(actorRevision.current, 3);
  for (const key of ["editing", "text", "city", "coordinates", "notice"]) {
    assert.ok(events.some(([type, value]) => type === key && (value === "" || value === null)), "missing reset: " + key);
  }
  assert.equal(firstSuccessfulLoad.current, true);
  pending.resolve({ addresses: [{ id: "B-address" }], nextCursor: "" });
  await tick();
  assert.equal(addressState.kind, "ready");
  assert.equal(addressState.actorID, "actor-B");
  assert.equal(addressState.addresses[0].id, "B-address");
});

test("A's slow address list read cannot replace B's completed address state", async () => {
  let actor = "actor-A";
  const pendingA = deferred(), pendingB = deferred();
  let state = { kind: "loading" };
  const generation = { current: 0 }, firstSuccessfulLoad = { current: false };
  const read = () => actor === "actor-A" ? pendingA.promise : pendingB.promise;
  const load = loader({
    pageGeneration: generation, firstSuccessfulLoad,
    currentAddressActorID: () => actor,
    listOwnDeliveryAddresses: read,
    setState: (value) => { state = value; },
    setLoadingMore: () => {},
    setError: () => {}, setFormOpen: () => {},
  });
  const oldRequest = load();
  actor = "actor-B";
  const newRequest = load();
  pendingB.resolve({ addresses: [{ id: "private-B" }], nextCursor: "" });
  await newRequest;
  pendingA.resolve({ addresses: [{ id: "private-A" }], nextCursor: "" });
  await oldRequest;
  assert.equal(state.kind, "ready");
  assert.equal(state.actorID, "actor-B");
  assert.equal(state.addresses[0].id, "private-B");
});

test("A's failed paginated read cannot update B's list, errors or busy status", async () => {
  let actor = "actor-A";
  const pending = deferred(), events = [], pageGeneration = { current: 2 };
  const more = method("loadMore", {
    loadingMore: false,
    state: { kind: "ready", actorID: actor, addresses: [{ id: "A-1" }], nextCursor: "cursor-A" },
    currentAddressActorID: () => actor,
    pageGeneration, listOwnDeliveryAddresses: () => pending.promise,
    setLoadingMore: (value) => events.push(["more", value]),
    setError: (value) => events.push(["error", value]),
    setState: (value) => events.push(["state", value]),
    appendDistinctDeliveryAddresses: () => { throw new Error("stale pagination merged"); },
    errorText: () => "error from actor A",
  });
  const oldRead = more();
  actor = "actor-B";
  pageGeneration.current += 1;
  pending.reject(new Error("stale A network error"));
  await oldRead;
  assert.equal(events.some(([type, value]) => type === "error" && value !== ""), false);
  assert.equal(events.some(([type]) => type === "state"), false);
  assert.equal(events.some(([type, value]) => type === "more" && value === false), false);
});

test("A's delayed GPS permission cannot display precise coordinates in B or continue geolocation", async () => {
  let actor = "actor-A";
  const permission = deferred(), events = [], locationGeneration = { current: 4 };
  let startedLocationServices = 0;
  const capture = method("captureLocation", {
    busy: false, locationBusy: false, currentAddressActorID: () => actor, locationGeneration,
    Location: {
      requestForegroundPermissionsAsync: () => permission.promise,
      hasServicesEnabledAsync: () => { startedLocationServices += 1; return Promise.resolve(true); },
      PermissionStatus: { GRANTED: "granted" },
      Accuracy: { Balanced: 3 },
      getCurrentPositionAsync: async () => ({ coords: { latitude: 15, longitude: 44 } }),
    },
    setLocationBusy: (value) => events.push(["busy", value]),
    setCoordinates: (value) => events.push(["coordinates", value]),
    setError: (value) => events.push(["error", value]),
    setNotice: (value) => events.push(["notice", value]),
  });
  const oldGPS = capture();
  actor = "actor-B";
  locationGeneration.current += 1;
  permission.resolve({ status: "granted" });
  await oldGPS;
  assert.equal(startedLocationServices, 0);
  assert.equal(events.some(([key]) => key === "coordinates"), false);
  assert.equal(events.some(([key, value]) => key === "busy" && value === false), false);
});

test("stale A address save cannot display notice or trigger A refresh in B", async () => {
  let actor = "actor-A";
  const actorRevision = { current: 1 }, pending = deferred(), events = [];
  const save = method("save", {
    addressText: "delivery address A", actorRevision,
    coordinates: { latitude: 15, longitude: 44 },
    addressCityID: "city-A", editing: { id: "A-1", version: 1 },
    state: { kind: "ready", actorID: "actor-A" }, busy: false,
    activeActorIDRef: { current: "actor-A" }, currentAddressActorID: () => actor,
    updateOwnDeliveryAddress: () => pending.promise,
    setBusy: (v) => events.push(["busy", v]),
    setError: (v) => events.push(["error", v]),
    setNotice: (v) => events.push(["notice", v]),
    cancelEdit: () => events.push(["cancel"]),
    setFormOpen: (value) => events.push(["form", value]),
    load: () => { events.push(["reload"]); return Promise.resolve(); },
    isLocationHttpError: () => false,
  });
  const oldSave = save();
  actor = "actor-B";
  actorRevision.current += 1;
  pending.resolve({ id: "A-1" });
  await oldSave;
  assert.equal(events.some(([type]) => ["cancel", "form", "reload"].includes(type)), false);
  assert.equal(events.some(([type, value]) => type === "notice" && value !== ""), false);
  assert.equal(events.some(([type, value]) => type === "busy" && value === false), false);
});

test("same actor address save preserves success, clears busy and refreshes the owner list", async () => {
  const events = [], actorRevision = { current: 8 };
  const save = method("save", {
    addressText: "new address for B", actorRevision,
    coordinates: { latitude: 15, longitude: 44 },
    addressCityID: "city-B", editing: null,
    state: { kind: "ready", actorID: "actor-B" }, busy: false,
    activeActorIDRef: { current: "actor-B" }, currentAddressActorID: () => "actor-B",
    createOwnDeliveryAddress: async (_, actorID) => { assert.equal(actorID, "actor-B"); return { id: "B-new" }; },
    setBusy: (v) => events.push(["busy", v]),
    setError: (v) => events.push(["error", v]),
    setNotice: (v) => events.push(["notice", v]),
    cancelEdit: () => events.push(["cancel"]),
    setFormOpen: (value) => events.push(["form", value]),
    load: () => { events.push(["reload"]); return Promise.resolve(); },
    isLocationHttpError: () => false,
  });
  await save();
  assert.equal(events.filter(([type]) => type === "reload").length, 1);
  assert.equal(events.some(([type, value]) => type === "busy" && value === false), true);
  assert.equal(events.some(([type, value]) => type === "form" && value === false), true);
});

test("a token resolving after A to B switch is denied before any address write", async () => {
  let actor = "actor-A";
  const pendingToken = deferred(), writes = [];
  const tokenForActor = method("tokenForActor", {
    token: () => pendingToken.promise,
    currentIdentityState: () => ({ kind: "authenticated", identity: { subject: actor } }),
    Error,
  }, clientAst);
  const attempt = tokenForActor("actor-A");
  actor = "actor-B";
  pendingToken.resolve("token-for-B");
  await assert.rejects(attempt, /CLIENT_ADDRESS_SESSION_CHANGED/);

  const create = method("createOwnDeliveryAddress", {
    exports: {},
    tokenForActor: () => Promise.reject(new Error("CLIENT_ADDRESS_SESSION_CHANGED")),
    createClientDsh: () => ({ createOwnDeliveryAddress: () => writes.push("write") }),
  }, clientAst);
  await assert.rejects(create({ addressText: "A" }, "actor-A"), /CLIENT_ADDRESS_SESSION_CHANGED/);
  assert.deepEqual(writes, []);
});

test("rendering is actor-tagged and the correct auth-protected route owns address access", () => {
  assert.match(source, /state\.actorID !== currentAddressActorID\(\)/);
  assert.match(source, /displayState\.addresses\.map/);
  assert.match(source, /displayState\.nextCursor/);
  assert.match(source, /state\.actorID !== actorID/);
  const route = readFileSync(new URL("../../../app/addresses.tsx", import.meta.url), "utf8");
  assert.match(route, /<ClientProtectedScreen>/);
  assert.match(clientSource, /tokenForActor\(actorID\)/);
});

test("current actor may capture location normally without stale-session rejection", async () => {
  const events = [], locationGeneration = { current: 1 };
  const capture = method("captureLocation", {
    busy: false, locationBusy: false, currentAddressActorID: () => "actor-B", locationGeneration,
    Location: {
      requestForegroundPermissionsAsync: async () => ({ status: "granted" }),
      PermissionStatus: { GRANTED: "granted" },
      hasServicesEnabledAsync: async () => true,
      Accuracy: { Balanced: 3 },
      getCurrentPositionAsync: async () => ({ coords: { latitude: 15.2, longitude: 44.5 } }),
    },
    setLocationBusy: (v) => events.push(["busy", v]),
    setCoordinates: (v) => events.push(["coordinates", v]),
    setError: (v) => events.push(["error", v]),
    setNotice: (v) => events.push(["notice", v]),
  });
  await capture();
  assert.equal(events.find(([k]) => k === "coordinates")?.[1]?.longitude, 44.5);
  assert.deepEqual(events.filter(([k]) => k === "busy").map(([, v]) => v), [true, false]);
});

test("a valid current actor receives an authenticated address write token", async () => {
  const tokenForActor = method("tokenForActor", {
    token: async () => "token-B",
    currentIdentityState: () => ({ kind: "authenticated", identity: { subject: "actor-B" } }),
  }, clientAst);
  assert.equal(await tokenForActor("actor-B"), "token-B");
});

test("an A-owned address cannot be opened for editing from B's current identity", () => {
  const address = { id: "A-1", version: 2, addressText: "private address A", latitude: 15, longitude: 44, serviceCityId: "city-A" };
  const events = [];
  const handler = method("beginEdit", {
    state: { kind: "ready", actorID: "actor-A", addresses: [address] },
    currentAddressActorID: () => "actor-B",
    selectedCityID: "city-A",
    setFormOpen: (value) => events.push(["form", value]),
    setEditing: (value) => events.push(["editing", value]),
    setAddressText: (value) => events.push(["text", value]),
    setAddressCityID: (value) => events.push(["city", value]),
    setCoordinates: (value) => events.push(["coordinates", value]),
    setError: (value) => events.push(["error", value]),
    setNotice: (value) => events.push(["notice", value]),
  });
  handler(address);
  assert.deepEqual(events, []);
});

test("the same actor can open their own address for editing", () => {
  const address = { id: "B-1", version: 2, addressText: "synthetic address B", latitude: 15, longitude: 44, serviceCityId: "city-B" };
  const events = [];
  const handler = method("beginEdit", {
    state: { kind: "ready", actorID: "actor-B", addresses: [address] },
    currentAddressActorID: () => "actor-B",
    selectedCityID: "city-B",
    setFormOpen: (value) => events.push(["form", value]),
    setEditing: (value) => events.push(["editing", value]),
    setAddressText: (value) => events.push(["text", value]),
    setAddressCityID: (value) => events.push(["city", value]),
    setCoordinates: (value) => events.push(["coordinates", value]),
    setError: (value) => events.push(["error", value]),
    setNotice: (value) => events.push(["notice", value]),
  });
  handler(address);
  assert.equal(events.find(([key]) => key === "editing")?.[1]?.id, "B-1");
  assert.equal(events.find(([key]) => key === "text")?.[1], "synthetic address B");
});

test("refresh invalidates a pending same-actor next page and clears pagination busy", async () => {
  const actorID = "actor-B", pending = deferred(), events = [];
  const pageGeneration = { current: 5 };
  const load = loader({
    pageGeneration, firstSuccessfulLoad: { current: false },
    currentAddressActorID: () => actorID,
    listOwnDeliveryAddresses: () => pending.promise,
    setLoadingMore: (value) => events.push(["more", value]),
    setState: (value) => events.push(["state", value]),
    setError: () => {},
    setFormOpen: () => {},
  });
  const inFlight = load();
  assert.ok(events.some(([key, value]) => key === "more" && value === false),
    "fresh load must reset stale pagination state before owner fetch");
  pending.resolve({ addresses: [{ id: "B-2" }], nextCursor: "" });
  await inFlight;
  assert.equal(events.findLast(([key]) => key === "state")?.[1]?.actorID, actorID);
});

test("unmount invalidates a pending same-actor save before it may repaint the closed screen", async () => {
  const effect = find(ast, (node) => ts.isCallExpression(node) &&
    node.expression.getText(ast) === "useEffect" &&
    node.arguments[0]?.getText(ast).includes("subscribeClientCartActorChanges"));
  const pageGeneration = { current: 10 };
  const locationGeneration = { current: 20 };
  const actorRevision = { current: 30 };
  const events = [];
  const hook = execute("const hook = " + effect.arguments[0].getText(ast), {
    activeActorIDRef: { current: "actor-A" },
    currentAddressActorID: () => "actor-A",
    subscribeIdentitySession: () => () => {},
    subscribeClientCartActorChanges: () => ({
      changedDuringSync: false,
      unsubscribe: () => events.push(["unsubscribe"]),
    }),
    pageGeneration, locationGeneration, actorRevision,
    load: async () => {},
  }, "hook");
  const cleanup = hook();
  assert.equal(typeof cleanup, "function");

  const pending = deferred();
  const save = method("save", {
    addressText: "safe test address", actorRevision,
    coordinates: { latitude: 15, longitude: 44 }, addressCityID: "city-A",
    editing: { id: "A-1", version: 2 }, busy: false,
    state: { kind: "ready", actorID: "actor-A" },
    activeActorIDRef: { current: "actor-A" }, currentAddressActorID: () => "actor-A",
    updateOwnDeliveryAddress: () => pending.promise,
    setBusy: (value) => events.push(["busy", value]),
    setError: (value) => events.push(["error", value]),
    setNotice: (value) => events.push(["notice", value]),
    cancelEdit: () => events.push(["cancel"]),
    setFormOpen: (value) => events.push(["form", value]),
    load: () => { events.push(["reload"]); return Promise.resolve(); },
    isLocationHttpError: () => false,
  });
  const pendingSave = save();
  cleanup();
  pending.resolve({ id: "A-1" });
  await pendingSave;
  assert.equal(pageGeneration.current, 11);
  assert.equal(locationGeneration.current, 21);
  assert.equal(actorRevision.current, 31);
  assert.ok(events.some(([kind]) => kind === "unsubscribe"));
  assert.equal(events.some(([kind]) => ["cancel", "form", "reload"].includes(kind)), false);
  assert.equal(events.some(([kind, value]) => kind === "notice" && value !== ""), false);
  assert.equal(events.some(([kind, value]) => kind === "busy" && value === false), false);
});

test("private form and precise map are gated until the current actor's addresses are ready", () => {
  const declaration = find(ast, node => ts.isVariableDeclaration(node) &&
    node.name.getText(ast) === "privateFormReady");
  const guard = (displayState, activeActor, currentActor) => execute(
    "const privateFormReady = " + declaration.initializer.getText(ast),
    { displayState, activeActorIDRef: { current: activeActor }, currentAddressActorID: () => currentActor },
    "privateFormReady",
  );
  const readyA = { kind: "ready", actorID: "actor-A", addresses: [], nextCursor: "" };
  const readyB = { kind: "ready", actorID: "actor-B", addresses: [], nextCursor: "" };
  assert.equal(guard(readyA, "actor-A", "actor-A"), true);
  assert.equal(guard(readyA, "actor-A", "actor-B"), false, "actor changed before subscription callback");
  assert.equal(guard(readyA, "actor-B", "actor-B"), false, "callback changed actor before stale state cleared");
  assert.equal(guard({ kind: "loading" }, "actor-B", "actor-B"), false, "old form must remain hidden while B loads");
  assert.equal(guard({ kind: "error" }, "actor-B", "actor-B"), false, "failed B read cannot expose stale A form");
  assert.equal(guard(readyB, "actor-B", "actor-B"), true, "new actor can edit after canonical readback");
  assert.match(source, /\{notice && privateFormReady \?/);
  assert.match(source, /\{privateFormReady && !formOpen \?/);
  assert.match(source, /\{privateFormReady && formOpen \?/);
});

test("old A new-address form cannot be submitted using B's authenticated bearer before UI reset", async () => {
  const writes = [], events = [];
  const save = method("save", {
    addressText: "Private address from actor A",
    coordinates: { latitude: 15, longitude: 44 }, addressCityID: "city-A",
    editing: null, busy: false, state: { kind: "ready", actorID: "actor-A" },
    activeActorIDRef: { current: "actor-A" }, actorRevision: { current: 6 },
    currentAddressActorID: () => "actor-B",
    createOwnDeliveryAddress: async (input, owner) => { writes.push([input.addressText, owner]); },
    setBusy: value => events.push(["busy", value]),
    setError: value => events.push(["error", value]),
    setNotice: value => events.push(["notice", value]),
    cancelEdit: () => events.push(["cancel"]),
    setFormOpen: value => events.push(["form", value]),
    load: async () => { events.push(["reload"]); },
    isLocationHttpError: () => false,
  });
  await save();
  assert.deepEqual(writes, [], "old A private draft must never be written under B's identity");
  assert.equal(events.length, 0, "stale A form cannot trigger B UI updates");
});
