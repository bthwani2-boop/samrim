import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  filterMerchantStores,
  merchantMobileSections,
  merchantNavigation,
  merchantStoreSummary,
} from "./merchant-workspace-model.ts";

test("Merchant workspace has unique functional navigation targets on desktop and mobile", () => {
  const ids = merchantNavigation.map(item => item.id);
  assert.deepEqual(ids, ["home", "stores", "orders", "products", "wallet", "more"]);
  assert.equal(new Set(ids).size, ids.length);
  for (const section of merchantMobileSections) {
    assert.ok(ids.includes(section), `mobile section ${section} must also exist on desktop`);
  }
  assert.deepEqual(merchantMobileSections, ["home", "orders", "products", "wallet", "more"]);
});

test("Merchant directory combines Store name or ID search with publication state", () => {
  const stores = [
    { id: "market-aden", name: "مخبز عدن", relation: "MARKETPLACE", published: true },
    { id: "direct-sanaa", name: "مخبز صنعاء", relation: "DIRECT", published: false },
    { id: "market-sanaa", name: "مكتبة صنعاء", relation: "MARKETPLACE", published: true },
  ];
  assert.deepEqual(filterMerchantStores(stores, " مخبز ", "all"), stores.slice(0, 2));
  assert.deepEqual(filterMerchantStores(stores, "صنعاء", "all"), stores.slice(1));
  assert.deepEqual(filterMerchantStores(stores, "SANAA", "unpublished"), [stores[1]]);
  assert.deepEqual(filterMerchantStores(stores, "صنعاء", "published"), [stores[2]]);
  assert.deepEqual(filterMerchantStores(stores, "", "all"), stores);
  assert.deepEqual(filterMerchantStores([], "مخبز", "published"), []);
  assert.deepEqual(filterMerchantStores(stores, "صنعاء", "all", "DIRECT"), [stores[1]]);
  assert.deepEqual(filterMerchantStores(stores, "صنعاء", "unpublished", "MARKETPLACE"), []);
});

test("Merchant workspace metrics depend exclusively on owner-verified DSH stores", () => {
  assert.deepEqual(merchantStoreSummary([]), { total: 0, published: 0, unpublished: 0 });
  const stores = [
    { id: "a", name: "أ", relation: "DIRECT", published: true },
    { id: "b", name: "ب", relation: "MARKETPLACE", published: false },
    { id: "c", name: "ج", relation: "DIRECT", published: true },
  ];
  assert.deepEqual(merchantStoreSummary(stores), { total: 3, published: 2, unpublished: 1 });
  assert.equal(merchantStoreSummary(stores).total, stores.length);
});

test("Merchant home opens the matching Store list and existing catalog", () => {
  const root = fileURLToPath(new URL("../../../../../", import.meta.url));
  const temp = mkdtempSync(path.join(tmpdir(), "merchant-workspace-navigation-"));
  try {
    const sources = ["merchant-workspace.tsx", "merchant-store-directory.tsx"]
      .map(file => fileURLToPath(new URL(`./${file}`, import.meta.url)));
    const result = spawnSync(process.execPath, [
      path.join(root, "node_modules/typescript/bin/tsc"), ...sources,
      "--ignoreConfig", "--noResolve", "--noCheck", "--target", "es2022",
      "--module", "commonjs", "--jsx", "react-jsx", "--outDir", temp,
    ], { cwd: root, encoding: "utf8", timeout: 20000 });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const compiled = readFileSync(path.join(temp, "merchant-workspace.js"), "utf8");
    let values = [], index = 0, desktop = true;
    const jsx = (type, props, key) => ({ type, props, key });
    const mocks = {
      "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
      "react": { useState(initial) {
        const i = index++;
        if (!(i in values)) values[i] = initial;
        return [values[i], next => { values[i] = typeof next === "function" ? next(values[i]) : next; }];
      } },
      "react-native": { Pressable: "Pressable", ScrollView: "ScrollView", Text: "Text", TextInput: "TextInput", View: "View" },
      "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" },
      "@bthwani/tamagui-config/appearance": { useMobileAppearance: () => ({ theme: {} }) },
      "@bthwani/tamagui-config/navigation": { usePrimaryNavigation: () => ({ desktop }) },
      "../account/account-screen": { __esModule: true, default: "Account" },
      "../catalog/merchant-private-catalog": { __esModule: true, default: "Catalog" },
      "../onboarding/merchant-store-registration": { __esModule: true, default: "Registration" },
      "./merchant-store-directory": { __esModule: true, default: "Directory" },
      "../stores/merchant-public-link": { __esModule: true, default: "PublicLink" },
      "../stores/store-availability": { __esModule: true, default: "Availability" },
      "./merchant-workspace-model": { filterMerchantStores, merchantNavigation, merchantMobileSections, merchantStoreSummary },
    };
    const load = code => {
      const mod = { exports: {} };
      new Function("require", "module", "exports", code)(name => {
        assert.ok(Object.hasOwn(mocks, name), name);
        return mocks[name];
      }, mod, mod.exports);
      return mod.exports.default;
    };
    const Workspace = load(compiled);
    const stores = [{ id: "a", name: "أ", relation: "MARKETPLACE", published: true },
      { id: "b", name: "ب", relation: "DIRECT", published: false }];
    const nodes = tree => !tree || typeof tree !== "object" ? [] : Array.isArray(tree) ?
      tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
    const render = () => { index = 0; return nodes(Workspace({ actorId: "merchant-a", stores, onRefresh() {}, onSignOut() {} })); };
    const click = (label) => {
      const button = render().find(n => n.props?.accessibilityLabel === label);
      assert.ok(button, label);
      button.props.onPress();
    };
    click("عرض المتاجر المنشورة");
    let directory = render().find(n => n.type === "Directory");
    assert.equal(directory.props.initialPublication, "published");
    assert.deepEqual(directory.props.stores, stores);
    click("الرئيسية");
    click("عرض المتاجر غير المنشورة");
    directory = render().find(n => n.type === "Directory");
    assert.equal(directory.props.initialPublication, "unpublished");
    directory.props.onOpenCatalog("another-merchant-store");
    assert.ok(render().some(n => n.type === "Directory"));
    directory.props.onOpenCatalog("b");
    assert.equal(render().find(n => n.type === "Catalog")?.props.initialStoreId, "b");
    click("العودة إلى تفاصيل المتجر السابق");
    assert.equal(render().find(n => n.type === "Directory")?.props.initialStoreId, "b");
    click("الرئيسية");
    click("إدارة المنتجات");
    assert.deepEqual(render().find(n => n.type === "Catalog").props.stores, stores);
    assert.equal(render().find(n => n.type === "Catalog").props.initialStoreId, undefined);

    click("المزيد");
    assert.ok(render().some(n => n.type === "Account"), "Desktop More must expose working account preferences");
    desktop = false;
    click("الرئيسية");
    click("المزيد");
    assert.ok(render().some(n => n.type === "Account"), "Mobile More must expose working account preferences");

    const Directory = load(readFileSync(path.join(temp, "merchant-store-directory.js"), "utf8"));
    values = [];
    const opened = [];
    const renderDirectory = (scopedStores = stores) => {
      index = 0;
      return nodes(Directory({ actorId: "merchant-a", stores: scopedStores, onOpenCatalog: id => opened.push(id) }));
    };
    const action = label => renderDirectory().find(n => n.type === "Pressable" && n.props.children?.props?.children === label);
    action("مباشر").props.onPress();
    assert.deepEqual(renderDirectory().map(n => n.props.accessibilityLabel).filter(label => label?.startsWith("عرض ")), ["عرض ب"]);
    action("مسح التصفية").props.onPress();
    assert.deepEqual(renderDirectory().map(n => n.props.accessibilityLabel).filter(label => label?.startsWith("عرض ")), ["عرض أ", "عرض ب"]);
    renderDirectory().find(n => n.props.accessibilityLabel === "عرض ب").props.onPress();
    action("إدارة منتجات هذا المتجر").props.onPress();
    assert.deepEqual(opened, ["b"]);
    assert.ok(!renderDirectory(stores.slice(0, 1)).some(n => n.props?.testID === "merchant-store-details"));
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
