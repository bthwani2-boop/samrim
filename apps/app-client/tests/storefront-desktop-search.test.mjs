import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
const feature = path.resolve(import.meta.dirname, "../src/features/store-discovery");
const detail = readFileSync(path.join(feature, "store-detail.tsx"), "utf8");
const styles = readFileSync(path.join(feature, "store-detail-styles.ts"), "utf8");

test("storefront desktop exposes semantic catalog search directly beside filters", () => {
  const toolbar = detail.slice(detail.indexOf("const renderCategoryRail = () => ("), detail.indexOf("  return (\n    <GestureHandlerRootView"));
  assert.match(toolbar, /desktopStorefront \? <><BthwaniSearchField/);
  assert.match(toolbar, /accessibilityLabel="البحث في منتجات المتجر مباشرة"/);
  assert.match(toolbar, /label="تنفيذ البحث داخل المتجر"/);
  assert.match(toolbar, /onSubmitEditing=\{\(\) => void reloadCatalog\(null, catalogQuery, false, false\)\}/);
  assert.match(styles, /desktopCatalogSearch: \{[^}]*minWidth: 220/);
});

test("search uses the store-scoped DSH catalog and retains failure recovery", () => {
  assert.match(detail, /readPublicStoreCatalog\(storeId, selectedCityID, categoryID \?\? "", query\.trim\(\)/);
  assert.match(detail, /تعذر تحديث الكتالوج\. يمكنك متابعة العناصر الحالية أو إعادة المحاولة/);
  assert.match(detail, /onClear=\{\(\) => \{ setCatalogQuery\(""\); void reloadCatalog\(null, "", false, false\); \}\}/);
});

test("draft catalog search cannot reuse a cursor from a previously submitted query", () => {
  assert.match(detail, /catalogQuery\.trim\(\) !== \(catalogTabs\[activeTab\]\?\.query \?\? ""\)\.trim\(\)/);
  assert.match(detail, /readPublicStoreCatalog\(storeId, selectedCityID, selectedCategoryID \?\? "", \(catalogTabs\[activeTab\]\?\.query \?\? ""\)\.trim\(\), 20, state\.catalog\.nextCursor/);
});
