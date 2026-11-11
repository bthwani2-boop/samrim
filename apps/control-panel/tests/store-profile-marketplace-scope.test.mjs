import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript-ast";

const source = readFileSync(new URL("../src/features/stores/store-profile-dashboard.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("store-profile-dashboard.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
assert.equal(ast.parseDiagnostics.length, 0);

function initializer(name) {
  let value;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) value = node.initializer?.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(value, `real Store dashboard must derive ${name} in production`);
  return value;
}

const projection = [
  "isMarketplaceStore", "canViewMarketplaceOperations", "canViewMarketplaceFinance",
  "ready", "publication",
].map((name) => `const ${name} = ${initializer(name)};`).join("\n");

function scope(relationModel, canViewOperations = true, canViewFinance = true) {
  const store = {
    id: "store-a", relationModel, publicationState: "published",
    publicationReadiness: { ready: true, blockedReason: null, blockedReasons: [] },
  };
  return runInNewContext(`(() => { ${projection} return {
    market: isMarketplaceStore, operations: canViewMarketplaceOperations,
    finance: canViewMarketplaceFinance, ready, publication
  }; })()`, {
    store, canViewOperations, canViewFinance,
    publicationStateLabel: (value) => value,
  });
}

test("published independent Store cannot inherit Marketplace readiness, order widgets or WLT finance", () => {
  const independent = scope("INDEPENDENT_STORE");
  assert.equal(independent.market, false);
  assert.equal(independent.operations, false);
  assert.equal(independent.finance, false);
  assert.equal(independent.ready, false);
  assert.match(independent.publication, /المستقل/);
});

test("marketplace Store preserves authorized operational, finance and publication displays", () => {
  const partner = scope("BTHWANI_PARTNER");
  assert.equal(partner.market, true);
  assert.equal(partner.operations, true);
  assert.equal(partner.finance, true);
  assert.equal(partner.ready, true);
  assert.equal(partner.publication, "published");
  assert.equal(scope("BTHWANI_PARTNER", false, false).operations, false);
  assert.equal(scope("BTHWANI_PARTNER", false, false).finance, false);
  assert.equal(scope("UNKNOWN").operations, false);
  assert.equal(scope("UNKNOWN").finance, false);
});

test("market-only widgets and indicators are guarded in the real Store dashboard", () => {
  assert.match(source, /\{canViewMarketplaceOperations \? <section id="store-profile-overview"/);
  assert.match(source, /\{canViewMarketplaceOperations \? <div className="store-profile-readiness"/);
  assert.match(source, /<StoreOperationsPreview storeId=\{store\.id\}/);
  assert.match(source, /\{canViewMarketplaceOperations \? <button type="button" className="store-profile-operating-state"/);
  assert.match(source, /\(canViewMarketplaceFinance \? \[\["finance"/);
  assert.match(source, /data-has-finance=\{canViewMarketplaceFinance\}/);
  assert.match(source, /canViewFinance=\{canViewMarketplaceFinance\}/);
  assert.match(source, /\{isMarketplaceStore \? <PublicationIndicator/);
  assert.match(source, /نشر الموقع المستقل غير مفعّل/);
  assert.doesNotMatch(source, /\{canViewOperations \? <div className="store-profile-readiness"/);
});

test("Store relation, version and identity changes cannot reuse previous marketplace metrics", () => {
  const scopeExpression = initializer("orderSummaryScope");
  const summaryExpression = initializer("currentOrderSummary");
  const operationsExpression = initializer("currentOperationalReadback");
  const base = { id: "store-a", relationModel: "BTHWANI_PARTNER", version: 5 };
  const key = (store) => runInNewContext(scopeExpression, { store });
  const original = key(base);
  assert.equal(key({ ...base }), original);
  assert.notEqual(key({ ...base, id: "store-b" }), original);
  assert.notEqual(key({ ...base, relationModel: "INDEPENDENT_STORE" }), original);
  assert.notEqual(key({ ...base, version: 6 }), original);

  const counts = { activeCount: 3 };
  const summary = (orderSummaryScope) => runInNewContext(summaryExpression, {
    orderSummary: { scope: original, summary: counts }, orderSummaryScope,
  });
  const operations = (orderSummaryScope) => runInNewContext(operationsExpression, {
    operationalReadback: { scope: original, value: { availability: { storeId: "store-a" } } }, orderSummaryScope,
  });
  assert.equal(summary(original).activeCount, 3);
  assert.equal(operations(original).availability.storeId, "store-a");
  assert.equal(summary(key({ ...base, relationModel: "INDEPENDENT_STORE" })), null);
  assert.equal(operations(key({ ...base, relationModel: "INDEPENDENT_STORE" })), null);
  assert.equal(summary(key({ ...base, id: "store-b" })), null);
  assert.equal(operations(key({ ...base, version: 6 })), null);
  assert.match(source, /\[orderSummaryScope\]\);/, "summary callbacks stay stable for the current Store scope");
});
