import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript-ast";
import { isClientCartScopeCurrent, subscribeClientCartActorChanges } from "../src/features/cart-checkout/cart-session-scope.ts";

const source = fs.readFileSync(path.resolve(import.meta.dirname, "../src/features/cart-checkout/client-cart-screen.tsx"), "utf8");
const ast = ts.createSourceFile("client-cart-screen.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let loadAddresses;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "loadAddresses") loadAddresses = node.initializer;
  ts.forEachChild(node, visit);
}
visit(ast);

test("a cart scope belongs to one authenticated actor, Store and city", () => {
  assert.equal(isClientCartScopeCurrent("actor-a", "actor-a", "store-a", "store-a", "city-a", "city-a"), true);
  assert.equal(isClientCartScopeCurrent("actor-a", "actor-b", "store-a", "store-a", "city-a", "city-a"), false);
  assert.equal(isClientCartScopeCurrent("", "", "store-a", "store-a", "city-a", "city-a"), false);
  assert.equal(isClientCartScopeCurrent("actor-a", "actor-a", "store-a", "store-b", "city-a", "city-a"), false);
  assert.equal(isClientCartScopeCurrent("actor-a", "actor-a", "store-a", "store-a", "city-a", "city-b"), false);
});

test("addresses from the previous actor are discarded when a read resolves after switching", async () => {
  assert.ok(loadAddresses, "the production address loader must exist");
  const executable = "const loadAddresses = " + loadAddresses.getText(ast) + "; loadAddresses;";
  const compiled = ts.transpileModule(executable, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  let resolveRead;
  const states = [];
  const context = {
    addressRequestID: { current: 0 },
    scopeRef: { current: { actorID: "actor-a", storeId: "store-a", selectedCityID: "city-a" } },
    storeId: "store-a",
    selectedCityID: "city-a",
    isClientCartScopeCurrent,
    setAddressesState: (update) => states.push(typeof update === "function" ? update({ kind: "idle", addresses: [] }) : update),
    listOwnDeliveryAddresses: () => new Promise((resolve) => { resolveRead = resolve; }),
    useCallback: (callback) => callback,
  };
  const run = vm.runInNewContext(compiled, context);
  const pending = run();
  context.scopeRef.current.actorID = "actor-b";
  resolveRead({ addresses: [{ id: "private-address-a" }] });
  await pending;
  assert.equal(states.length, 1);
  assert.equal(states[0].kind, "loading");
  assert.equal(states[0].addresses.length, 0, "late private address data must not publish after an actor switch");
});

test("actor changes between render and subscription setup are reconciled and later changes are observed", () => {
  let currentActorID = "actor-b";
  let listener;
  let unsubscribeCalled = false;
  const changes = [];
  const subscription = subscribeClientCartActorChanges(
    "actor-a",
    () => currentActorID,
    (notify) => {
      listener = notify;
      return () => { unsubscribeCalled = true; };
    },
    (actorID) => changes.push(actorID),
  );

  assert.equal(subscription.changedDuringSync, true);
  assert.deepEqual(changes, ["actor-b"], "the current actor is reconciled even when the subscription does not replay it");
  currentActorID = "";
  listener(currentActorID);
  assert.deepEqual(changes, ["actor-b", ""], "logout clears the actor scope through the same listener");
  subscription.unsubscribe();
  assert.equal(unsubscribeCalled, true, "unmount releases the identity listener");
});
