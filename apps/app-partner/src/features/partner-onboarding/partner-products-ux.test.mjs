import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const products = readFileSync(new URL("./partner-products.tsx", import.meta.url), "utf8");
const selector = readFileSync(new URL("./partner-store-scope-selector.tsx", import.meta.url), "utf8");
const shell = readFileSync(new URL("../../shell/partner-shell.tsx", import.meta.url), "utf8");

test("catalog header keeps store switching inside the catalog-authorized scope", () => {
  assert.match(shell, /isCatalogSurface=\{headerRoute\.name === "products"\}/);
  assert.match(shell, /const scopedStores = isCatalogSurface \? stores\.filter\(\(store\) => store\.owned \|\| store\.permissions\.includes\("catalog"\)\) : stores/);
  assert.match(shell, /isProducts && selectedScopedStore/);
  assert.match(shell, /scopedStores\.map\(\(store\)/);
  assert.doesNotMatch(products, /PartnerStoreScopeSelector/);
});

test("product management never mounts for an unauthorized selected store", () => {
  assert.match(products, /const catalogStore = selectedStore && \(selectedStore\.owned \|\| selectedStore\.permissions\.includes\("catalog"\)\)/);
  assert.match(products, /catalogStore\?\.primaryVerticalId \? <StoreOfferManagement/);
  assert.match(products, /const switchingStore = state\.kind === "ready" && !catalogStore && permittedStores\.length > 0/);
  assert.match(products, /state\.kind === "ready" && permittedStores\.length === 0/);
  assert.doesNotMatch(products, /لا تتوفر صلاحية المنتجات لهذا المتجر/);
});

test("catalog navigation and store selection retain native theme and accessible touch targets", () => {
  assert.match(products, /import \{ Button, Host \} from "@expo\/ui"/);
  assert.match(products, /colorScheme=\{themeName\} matchContents seedColor=\{theme\.brandAction\}/);
  assert.match(products, /testID="partner-products-back-to-list"/);
  assert.match(products, /router\.replace\("\/products" as Href\)/);
  assert.match(selector, /accessibilityLabel=\{`اختيار المتجر:/);
  assert.match(selector, /minHeight: sizing\.controlLg/);
});
