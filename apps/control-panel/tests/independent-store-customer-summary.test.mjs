import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript-ast";

const src = readFileSync(new URL("../src/features/stores/store-customer-activity-summary.tsx", import.meta.url), "utf8");
const parent = readFileSync(new URL("../src/features/stores/store-profile-detail-panels.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("summary.tsx", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let wrapper;
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "StoreCustomerActivitySummary") wrapper = node.getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(wrapper, "canonical exported wrapper must exist");
const compiled = ts.transpileModule(wrapper + "\nStoreCustomerActivitySummary;", {
  compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const marketplace = function MarketplaceCustomerActivitySummary() { throw Error("wrong surface"); };
const React = { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) };
const render = runInNewContext(compiled, { exports: {}, React, MarketplaceCustomerActivitySummary: marketplace });

test("independent Store cannot render marketplace customer counts or trigger its fetch-owning component", () => {
  const element = render({ storeId: "independent-one", relationModel: "INDEPENDENT_STORE" });
  assert.equal(element.type, "section");
  assert.equal(element.props.children[0].type, "p");
  assert.match(element.props.children[0].props.children[0], /المتجر مستقل/);
  assert.match(element.props.children[0].props.children[0], /لا تمثل عملاء الطلبات المباشرة/);
  assert.doesNotMatch(wrapper, /fetch\s*\(/, "independent rendering must not call the market endpoint");
});

test("marketplace Store keeps its original canonical summary and current Store ID", () => {
  const element = render({ storeId: "market-one", relationModel: "BTHWANI_PARTNER" });
  assert.equal(element.type, marketplace);
  assert.equal(element.props.storeId, "market-one");
  assert.match(src, /function MarketplaceCustomerActivitySummary/);
  assert.match(src, /\/orders\/summary\?period=/);
});

test("operator Store profile passes canonical DSH relation instead of query or browser state", () => {
  assert.match(parent, /StoreCustomerActivitySummary\s+key=\{store\.id\}\s+storeId=\{store\.id\}\s+relationModel=\{store\.relationModel\}/);
});

test("independent operator tabs never mount marketplace Orders, ratings, or WLT finance widgets", () => {
  assert.match(parent, /const isMarketplaceStore = store\.relationModel === "BTHWANI_PARTNER"/);
  assert.match(parent, /!isMarketplaceStore \? <Unavailable title="طلبات المتجر المستقل"/);
  assert.match(parent, /isMarketplaceStore \? <Card title="تقييمات الطلبات المكتملة"/);
  assert.match(parent, /isMarketplaceStore \? <>[\s\S]*?<PartnerFinancialRegister/);
  assert.match(parent, /const publicationLabel = isMarketplaceStore \? publicationStateLabel/);
  assert.match(parent, /جاهزية الموقع المستقل غير معتمدة/);
});

test("unknown DSH relation fails closed without mounting marketplace summary", () => {
  const element = render({ storeId: "store-a", relationModel: "UNEXPECTED_RELATION" });
  assert.equal(element.type, "section");
  assert.equal(element.props.children[0].type, "p");
  assert.equal(element.props.children[0].props.role, "alert");
  assert.match(element.props.children[0].props.children[0], /تعذر تحديد علاقة المتجر/);
  assert.notEqual(element.type, marketplace);
});
