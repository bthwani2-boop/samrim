import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript-ast";

const source = readFileSync(new URL("./home-product-feed.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("home-product-feed.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function find(match) {
  let result;
  function visit(node) {
    if (!result && match(node)) result = node;
    if (!result) ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(result, "production handler not found");
  return result;
}

function evaluate(text, environment, name) {
  const js = ts.transpileModule(`${text}; ${name};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return vm.runInNewContext(js, environment);
}

function actorChange(environment) {
  const call = find((node) => ts.isCallExpression(node) && node.expression.getText(ast) === "subscribeClientCartActorChanges");
  const cb = call.arguments[3];
  assert.ok(cb && ts.isArrowFunction(cb));
  return evaluate(`const onActorChange = ${cb.getText(ast)}`, environment, "onActorChange");
}

function adjustHandler(environment) {
  const declaration = find((node) => ts.isVariableDeclaration(node) &&
    node.name.getText(ast) === "adjust" && node.initializer && ts.isArrowFunction(node.initializer));
  return evaluate(`const adjust = ${declaration.initializer.getText(ast)}`, environment, "adjust");
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const offer = { storeId: "store-A", offerId: "offer-A", quantityPolicy: "DISCRETE", modifierGroups: [], availability: true };

test("home product feed subscribes to the identity actor, not only isAuthenticated boolean", () => {
  assert.match(source, /subscribeClientCartActorChanges\(/);
  assert.match(source, /currentHomeSessionKey/);
  assert.match(source, /subscribeIdentitySession/);
  assert.match(source, /subscription\.unsubscribe\(\)/);
  assert.match(source, /cartReadRevisionRef.current \+= 1/);
  assert.match(source, /setActorRevision\(\(current\) => current \+ 1\)/);
  assert.match(source, /\[isAuthenticated, state, actorRevision\]/);
  assert.match(source, /cancelled \|\| revision !== cartReadRevisionRef.current/);
});

test("same-actor renewed session synchronously clears private cart badges and feedback", () => {
  const activeSessionKeyRef = { current: JSON.stringify(["actor-A", "session-A"]) };
  const cartReadRevisionRef = { current: 4 };
  const busyOfferRef = { current: "offer-A" };
  const events = [];
  const onActorChange = actorChange({
    activeSessionKeyRef, cartReadRevisionRef, busyOfferRef,
    setCartQuantities: (value) => events.push(["quantities", value]),
    setCartMessage: (value) => events.push(["message", value]),
    setBusyID: (value) => events.push(["busy", value]),
    setActorRevision: (update) => events.push(["revision", update(5)]),
  });
  onActorChange(JSON.stringify(["actor-A", "session-B"]));
  assert.equal(activeSessionKeyRef.current, JSON.stringify(["actor-A", "session-B"]));
  assert.equal(cartReadRevisionRef.current, 5);
  assert.equal(busyOfferRef.current, "");
  assert.equal(events[0][0], "quantities");
  assert.equal(Object.keys(events[0][1]).length, 0);
  assert.equal(events[1][1], "");
  assert.equal(events[2][1], "");
  assert.equal(events[3][1], 6);
});

test("old account delayed cart adjustment cannot show its quantities or haptics in B", async () => {
  const pending = deferred();
  const cartReadRevisionRef = { current: 4 };
  const busyOfferRef = { current: "" };
  const events = [];
  const adjust = adjustHandler({
    busyOfferRef, isAuthenticated: true, currentHomeSessionKey: () => "actor-A",
    cartReadRevisionRef,
    setBusyID: (v) => events.push(["busy", v]),
    setCartMessage: (v) => events.push(["message", v]),
    setCartQuantities: () => events.push(["quantities"]),
    adjustSimpleOfferQuantity: () => pending.promise,
    Haptics: { selectionAsync: () => { events.push(["haptic"]); return Promise.resolve(); } },
  });
  const operation = adjust(offer, 1);
  cartReadRevisionRef.current += 1;
  pending.resolve({ cart: { lines: [{ storeOfferId: "offer-A", quantityBaseUnits: 1 }] } });
  await operation;
  assert.equal(events.some(([kind]) => kind === "quantities" || kind === "haptic"), false);
  assert.equal(events.some(([kind, value]) => kind === "busy" && value === ""), false);
});

test("old account failed cart adjustment cannot show B an error or clear B's busy state", async () => {
  const pending = deferred();
  const cartReadRevisionRef = { current: 4 };
  const events = [];
  const adjust = adjustHandler({
    busyOfferRef: { current: "" }, isAuthenticated: true, currentHomeSessionKey: () => "actor-A",
    cartReadRevisionRef,
    setBusyID: (v) => events.push(["busy", v]),
    setCartMessage: (v) => events.push(["message", v]),
    adjustSimpleOfferQuantity: () => pending.promise,
  });
  const operation = adjust(offer, 1);
  cartReadRevisionRef.current += 1;
  pending.reject(new Error("actor-A network failed"));
  await operation;
  assert.equal(events.some(([kind, value]) => kind === "message" && value !== ""), false);
  assert.equal(events.some(([kind, value]) => kind === "busy" && value === ""), false);
});

test("same actor cart adjustments still update the right offer badges", async () => {
  const events = [];
  let values = {};
  const adjust = adjustHandler({
    busyOfferRef: { current: "" }, isAuthenticated: true, currentHomeSessionKey: () => "actor-A",
    cartReadRevisionRef: { current: 4 },
    setBusyID: (v) => events.push(["busy", v]),
    setCartMessage: () => {},
    setCartQuantities: (update) => { values = update({}); },
    adjustSimpleOfferQuantity: async () => ({ cart: { lines: [{ storeOfferId: "offer-A", quantityBaseUnits: 2 }] } }),
    Haptics: { selectionAsync: () => Promise.resolve() },
  });
  await adjust(offer, 1);
  assert.equal(values["offer-A"], 2);
  assert.deepEqual(events, [["busy", "offer-A"], ["busy", ""]]);
});
