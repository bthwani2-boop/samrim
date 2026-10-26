import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript-ast";

const source = readFileSync(new URL("./client-cart-screen.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("client-cart-screen.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let onSelect;
function findSelector(node) {
  if (ts.isJsxAttribute(node) && node.name.getText(ast) === "onSelect" && node.initializer && ts.isJsxExpression(node.initializer) && node.initializer.expression && ts.isArrowFunction(node.initializer.expression)) {
    onSelect = node.initializer.expression;
  }
  ts.forEachChild(node, findSelector);
}
findSelector(ast);
assert.ok(onSelect, "fulfillment selector must have an onSelect handler");

function handlerContext() {
  const calls = { route: [], selected: [], serviceability: [], saved: [], expanded: [] };
  const expression = ts.transpileModule(`const handler = ${onSelect.getText(ast)}; handler;`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const handler = runInNewContext(expression, {
    router: { setParams: (value) => calls.route.push(value) },
    fulfillmentMode: "BTHWANI_CAPTAIN",
    setFulfillmentMode: (value) => calls.selected.push(value),
    serviceabilityRequestID: { current: 0 },
    setServiceability: (value) => calls.serviceability.push(value),
    setExpandedAddresses: (value) => calls.expanded.push(value),
    setExpandedFulfillment: (value) => calls.expanded.push(value),
    selectedCityID: "city-1",
    storeId: "store-1",
    saveFulfillmentMode: async (...args) => calls.saved.push(args),
    addressesState: { kind: "ready", addresses: [] },
    loadAddresses: () => calls.saved.push(["unexpected-address-load"]),
  });
  return { calls, handler };
}

test("changing fulfillment updates the cart route and invalidates address quote context", () => {
  const { calls, handler } = handlerContext();
  handler("PARTNER_CAPTAIN");
  assert.equal(calls.route.length, 1);
  assert.equal(calls.route[0].fulfillmentMode, "PARTNER_CAPTAIN");
  assert.deepEqual(calls.selected, ["PARTNER_CAPTAIN"]);
  assert.equal(calls.serviceability.length, 1);
  assert.equal(calls.serviceability[0].kind, "idle");
  assert.equal(calls.saved[0][0], "store-1");
  assert.equal(calls.saved[0][1], "city-1");
  assert.equal(calls.saved[0][2], "PARTNER_CAPTAIN");
});

test("reselecting the current mode only closes the picker and does not rewrite navigation", () => {
  const { calls, handler } = handlerContext();
  handler("BTHWANI_CAPTAIN");
  assert.equal(calls.route.length, 0);
  assert.equal(calls.selected.length, 0);
  assert.equal(calls.serviceability.length, 0);
  assert.deepEqual(calls.expanded, [false]);
});
