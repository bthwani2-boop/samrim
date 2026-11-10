import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript-ast";

const shell = readFileSync(new URL("./partner-shell.tsx", import.meta.url), "utf8");
const source = ts.createSourceFile("partner-shell.tsx", shell, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let expression;

function findAvailabilityGuard(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === "showOrderAvailability") {
    expression = node.initializer?.getText(source);
  }
  ts.forEachChild(node, findAvailabilityGuard);
}
findAvailabilityGuard(source);
assert.ok(expression, "extract the production header availability guard");

function headerVisible({ target, selected = "store-a", market = true, orders = true, operations = true } = {}) {
  return vm.runInNewContext(expression, {
    isOrders: orders,
    selectedStore: selected ? {
      id: selected, relationModel: market ? "BTHWANI_PARTNER" : "INDEPENDENT_STORE",
      owned: false, permissions: operations ? ["store_operations"] : [],
    } : undefined,
    orderTargetStoreId: target,
    isMarketplaceStore: store => store?.relationModel === "BTHWANI_PARTNER",
  });
}

test("Orders header receives Store URL target from the screen route, not a separate session or query", () => {
  assert.match(shell, /storeId\?: string \| string\[\]/);
  assert.match(shell, /orderTargetStoreId=\{headerRoute\.name === "orders" \? params\?\.storeId : undefined\}/);
  assert.match(shell, /const orderTargetStoreId = Array\.isArray\(rawOrderTargetStoreId\) \? rawOrderTargetStoreId\[0\] : rawOrderTargetStoreId/);
});

test("wrong Store and denied deep links cannot expose another Store's operations badge", () => {
  assert.equal(headerVisible({ target: "store-b" }), false);
  assert.equal(headerVisible({ target: "store-a" }), true);
  assert.equal(headerVisible(), true);
  assert.equal(headerVisible({ target: "store-a", operations: false }), false);
  assert.equal(headerVisible({ target: "store-a", market: false }), false);
  assert.equal(headerVisible({ target: "store-a", selected: "" }), false);
  assert.equal(headerVisible({ target: "store-a", orders: false }), false);
  assert.match(shell, /showOrderAvailability && selectedStore \? <PartnerOrderAvailability/);
});

test("product and authorized Store header navigation retain existing routes", () => {
  assert.match(shell, /: isOrders \? stores\.filter\(canUseStoreOrders\) : stores/);
  assert.match(shell, /isProducts && selectedScopedStore/);
  assert.match(shell, /scopedStores\.map\(\(store\)/);
  assert.match(shell, /isProducts \? "بحث المنتجات" : "البحث في الطلبات"/);
});
