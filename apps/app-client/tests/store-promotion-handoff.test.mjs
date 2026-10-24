import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(path.resolve(import.meta.dirname, "../src/features/store-discovery/store-detail.tsx"), "utf8");
const ast = ts.createSourceFile("store-detail.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
assert.equal(ast.parseDiagnostics.length, 0, "store detail JSX must parse without syntax errors");
let handler;
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "openStorePromotion") handler = node;
  ts.forEachChild(node, visit);
}
visit(ast);

test("store banners and promotion cards use the same store-scoped cart handoff", () => {
  assert.ok(handler, "canonical store promotion navigation must exist");
  assert.doesNotMatch(source, /onPress=\{\(\) => openStorePromotion\(item\.promotion\.code\)\}/);
  assert.match(source, /onUse=\{\(\) => openStorePromotion\(promotion\.code\)\}/);

  const urls = [];
  const js = ts.transpileModule(handler.getText(ast), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const openStorePromotion = vm.runInNewContext(js + "\nopenStorePromotion", {
    router: { push: (url) => urls.push(url) },
    storeId: "store/example",
    selectedFulfillmentMode: "CUSTOMER_PICKUP",
    encodeURIComponent,
  });
  openStorePromotion("SAVE 10");
  assert.equal(urls.length, 1);
  assert.equal(urls[0], "/cart/store%2Fexample?fulfillmentMode=CUSTOMER_PICKUP&promotionCode=SAVE%2010");
});

test("eligible store promotions are shown before products without duplicate hero promotion cards", () => {
  const header = source.indexOf('ListHeaderComponent=');
  const section = source.indexOf('title="عروض هذا المتجر"');
  const footer = source.indexOf('ListFooterComponent=');
  assert.ok(header >= 0 && section > header && section < footer, "promotions must be visible ahead of product catalog");
  assert.match(source, /remainingPromotions\.map\(\(promotion\) => <View key=\{promotion\.id\}/);
  assert.match(source, /const remainingPromotions = spotlightPromotion \? promotions\.filter\(item => item\.id !== spotlightPromotion\.id\) : promotions;/);
  assert.match(source, /<PromotionCard promotion=\{spotlightPromotion\} onUse=\{\(\) => openStorePromotion\(spotlightPromotion\.code\)\} \/>/);
  assert.doesNotMatch(source, /\.\.\.promotions\.map\(\(promotion\) => \(\{ kind: "promotion"/);
  assert.match(source, /promotionError \? <View style=\{styles\.promotionNotice\}/);
});
