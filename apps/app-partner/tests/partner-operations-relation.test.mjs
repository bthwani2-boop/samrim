import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const storePath = path.resolve(import.meta.dirname, "../src/features/partner-onboarding/partner-store.tsx");
const shellPath = path.resolve(import.meta.dirname, "../src/shell/partner-desktop-workspace.tsx");
const storeSource = readFileSync(storePath, "utf8");
const shellSource = readFileSync(shellPath, "utf8");

const begin = storeSource.indexOf("function eligibleForSection(");
const end = storeSource.indexOf("\nfunction isStoreFulfillmentMode(", begin);
assert.ok(begin >= 0 && end > begin, "extract the production section authority rule");
const declaration = storeSource.slice(begin, end);
const js = declaration.replace(
  "function eligibleForSection(store: PartnerAccessibleStore, section: StoreSection): boolean {",
  "function eligibleForSection(store, section) {",
);
const eligibleForSection = runInNewContext(js + "\neligibleForSection", {
  mayPrepareIndependentStoreBanners: store => store?.relationModel === "INDEPENDENT_STORE" && store.owned === true,
});
const store = (relationModel, owned, permissions = []) => ({ relationModel, owned, permissions });

test("the existing hours editor admits the independent owner without admitting other market tools", () => {
  assert.equal(eligibleForSection(store("BTHWANI_PARTNER", true), "operations"), true);
  assert.equal(eligibleForSection(store("BTHWANI_PARTNER", false, ["store_operations"]), "operations"), true);
  assert.equal(eligibleForSection(store("BTHWANI_PARTNER", false), "operations"), false);
  assert.equal(eligibleForSection(store("INDEPENDENT_STORE", true), "operations"), true);
  assert.equal(eligibleForSection(store("INDEPENDENT_STORE", false, ["store_operations"]), "operations"), false);
  for (const section of ["promotions", "commercial", "team"])
    assert.equal(eligibleForSection(store("INDEPENDENT_STORE", true), section), false);
  for (const relation of [undefined, null, "", "UNKNOWN"]) {
    assert.equal(eligibleForSection(store(relation, true), "operations"), false, "owner cannot bypass unknown relation");
    assert.equal(eligibleForSection(store(relation, false, ["store_operations"]), "operations"), false,
      "a stale permission must not grant marketplace operations");
    for (const section of ["promotions", "commercial", "team"])
      assert.equal(eligibleForSection(store(relation, true), section), false);
  }
});

test("non-marketplace owner retains safe Store settings and independent banners", () => {
  assert.equal(eligibleForSection(store("INDEPENDENT_STORE", true), "settings"), true);
  assert.equal(eligibleForSection(store("BTHWANI_PARTNER", true), "settings"), true);
  assert.equal(eligibleForSection(store("INDEPENDENT_STORE", true), "banners"), true);
  assert.equal(eligibleForSection(store(undefined, true), "banners"), false);
  assert.equal(eligibleForSection(store(undefined, true), "settings"), true);
});

test("website policy management admits only the owner of an independent Store", () => {
  assert.equal(eligibleForSection(store("INDEPENDENT_STORE", true), "website"), true);
  assert.equal(eligibleForSection(store("INDEPENDENT_STORE", false, ["store_operations"]), "website"), false);
  assert.equal(eligibleForSection(store("BTHWANI_PARTNER", true), "website"), false);
  assert.equal(eligibleForSection(store("UNKNOWN", true), "website"), false);
});

test("desktop workspace offers the verified public link, not a private preview share", () => {
  assert.doesNotMatch(shellSource, /Link href=\{\(\x60\/storefront-preview\?storeId=/);
  assert.match(shellSource, /usePartnerIndependentPublicLink/);
  assert.match(shellSource, /Clipboard\.setStringAsync\(storefrontLink\.url\)/);
  assert.match(storeSource, /section === "website" \? <View[\s\S]*?<PartnerIndependentCustomerPolicyDraftEditor/);
  assert.doesNotMatch(storeSource, /PartnerIndependentStorePreview/);
});

test("desktop Store actions open and copy the same approved Client Web site for both relations", () => {
  const start = shellSource.indexOf('{(isMarketplace || (isOwner && selectedStore?.relationModel === "INDEPENDENT_STORE")) ? <>');
  const end = shellSource.indexOf('{copyMessage ? <Text', start);
  assert.ok(start >= 0 && end > start, "one footer action group must serve both Store models");
  const footer = shellSource.slice(start, end);
  assert.match(footer, /accessibilityLabel="فتح موقع المتجر"/);
  assert.match(footer, /accessibilityLabel="نسخ رابط المتجر"/);
  assert.equal((footer.match(/disabled=\{!storefrontLink\}/g) ?? []).length, 2);
  assert.match(footer, /Linking\.openURL\(storefrontLink\.url\)/);
  assert.match(footer, /Clipboard\.setStringAsync\(storefrontLink\.url\)/);
  assert.match(footer, /independentPublic\.checking/);
  assert.match(footer, /اعتماد نشره في DSH/);
  assert.doesNotMatch(footer, /independent-preview|storefront-preview|readOwnIndependentStorePreview/);
  assert.match(shellSource, /selectedStore\?\.relationModel === "INDEPENDENT_STORE"\s*\? independentPublic\.link/);
  assert.match(shellSource, /buildPartnerStorefrontURL\(selectedStore, process\.env\.EXPO_PUBLIC_CLIENT_WEB_ORIGIN, __DEV__\)/);
});

test("desktop navigation refuses marketplace operations without exact relation", () => {
  assert.match(shellSource, /const isMarketplace = selectedStore\?\.relationModel === "BTHWANI_PARTNER";/);
  assert.match(shellSource, /if \(isMarketplace && can\("store_operations"\)\) management\.push/);
  assert.doesNotMatch(shellSource, /if \(can\("store_operations"\)\) management\.push/);
  assert.match(storeSource, /eligible=\{\(store\) => eligibleForSection\(store, section\)\}/,
    "the selector and screen must use the same section authority");
});

test("Store settings guidance never advertises publication for an unknown relation", () => {
  const match = storeSource.match(/<Text style=\{styles\.value\}>\{(selectedStore\.relationModel[^}]+)\}<\/Text>/);
  assert.ok(match, "read the real Store-settings heading expression");
  const label = relationModel => runInNewContext(match[1], {selectedStore: {relationModel}});
  assert.equal(label("BTHWANI_PARTNER"), "تجهيز المتجر للنشر");
  assert.equal(label("INDEPENDENT_STORE"), "تجهيز محتوى المتجر المستقل");
  for (const relation of [undefined, null, "", "UNKNOWN"]) {
    assert.equal(label(relation), "تعذر التحقق من نموذج المتجر");
  }
});
