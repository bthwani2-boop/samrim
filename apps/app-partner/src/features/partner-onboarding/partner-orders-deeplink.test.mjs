import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript-ast";

const source = readFileSync(new URL("./partner-orders.tsx", import.meta.url), "utf8");
const tree = ts.createSourceFile("partner-orders.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ["targetWasShown", "deniedTarget", "targetSwitchPending", "canRenderOrders"];
const expressions = new Map();

function visit(node) {
  if (ts.isVariableDeclaration(node) && names.includes(node.name.getText(tree))) {
    expressions.set(node.name.getText(tree), node.initializer?.getText(tree));
  }
  ts.forEachChild(node, visit);
}
visit(tree);
for (const name of names) assert.ok(expressions.get(name), `extract production guard ${name}`);

const guards = names.map(name => `const ${name} = ${expressions.get(name)};`).join("\n") +
  "\n({ deniedTarget, targetSwitchPending, canRenderOrders })";

function decide({ state = "ready", target = "store-b", permitted = true, selected = "store-a", applied = false, observed = false } = {}) {
  return vm.runInNewContext(guards, {
    state: { kind: state },
    targetStoreId: target,
    targetStorePermitted: permitted,
    selectedStore: selected ? { id: selected } : undefined,
    targetAlreadyApplied: applied,
    appliedTargetStore: { current: { observed } },
  });
}

test("explicit denied Store target cannot mount an unrelated Store's orders", () => {
  const result = decide({ permitted: false });
  assert.equal(result.deniedTarget, true);
  assert.equal(result.canRenderOrders, false);
  assert.match(source, /accessibilityRole="alert"[^>]*>لا توجد صلاحية لطلبات هذا المتجر/);
  assert.match(source, /router\.replace\("\/orders" as Href\)/);
});

test("authorized deep link waits for requested Store selection before mounting Orders", () => {
  const pending = decide({ permitted: true, selected: "store-a", applied: false });
  assert.equal(pending.targetSwitchPending, true);
  assert.equal(pending.canRenderOrders, false);
  assert.equal(decide({ selected: "store-b" }).canRenderOrders, true);
  assert.equal(decide({ selected: "store-a", applied: true, observed: false }).canRenderOrders, false,
    "a selection request is not proof the target Store was ever shown");
  assert.equal(decide({ selected: "store-a", applied: true, observed: true }).canRenderOrders, true,
    "user manually choosing another authorized Store after arrival must not be trapped");
  assert.equal(decide({ selected: "store-a", observed: true }).canRenderOrders, false,
    "observed target from another Identity session cannot unlock an old Store");
  assert.equal(decide({ target: "", selected: "store-a" }).canRenderOrders, true);
});

test("scope loading and errors never show cached Orders; explicit URL target wins over aggregate mode", () => {
  for (const state of ["loading", "error"]) {
    assert.equal(decide({ state }).canRenderOrders, false);
  }
  assert.match(source, /state\.kind !== "ready" \? <PartnerStoreScopeSelector eligible=\{canUseStoreOrders\}/);
  assert.match(source, /const showMarketAggregate = !targetStoreId &&/);
  assert.match(source, /canRenderOrders && !aggregateMode && selectedStore && canManageOrders \? <OrderManagement/);
  assert.match(source, /canRenderOrders && aggregateMode \? <OrderManagement/);
});

test("deep-link application and OrderManagement mount are isolated by Identity session", () => {
  assert.match(source, /partnerSetupSessionKey\(currentIdentityState\(\)\)/);
  assert.match(source, /appliedTargetStore\.current\.session === identityScope/);
  assert.match(source, /appliedTargetStore\.current = \{ session: identityScope, storeId: targetStoreId, observed: selectedStore\?\.id === targetStoreId \}/);
  assert.match(source, /if \(selectedStore\?\.id === targetStoreId\) appliedTargetStore\.current\.observed = true/);
  assert.match(source, /key=\{`orders:\$\{identityScope\}:\$\{selectedStore\.id\}`\}/);
  assert.match(source, /key=\{`all-marketplace:\$\{identityScope\}:\$\{marketOrderStoreIDs\.join\(","\)\}`\}/);
});
