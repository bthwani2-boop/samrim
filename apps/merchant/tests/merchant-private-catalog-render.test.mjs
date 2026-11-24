import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const src = fileURLToPath(new URL("../src/features/catalog/merchant-private-catalog.tsx", import.meta.url));
const offer = (id, name) => ({
  id, storeId: "store-b", productId: "p-a", name,
  variantId: "v-a", priceYer: "1500", stockUnits: 2, draftVersion: 1,
  productActive: true, variantSellable: true, requiredAttributesValid: true,
  published: false, available: false,
});
function nodes(tree) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
test("Merchant private catalog never reuses a previous actor/Store response, and ends pagination", async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), "bthwani-catalog-test-"));
  try {
    const compiled = spawnSync(process.execPath, [
      path.join(root, "node_modules/typescript/bin/tsc"), src, "--ignoreConfig",
      "--noResolve", "--noCheck", "--target", "es2022", "--module", "commonjs",
      "--jsx", "react-jsx", "--outDir", tmp,
    ], { cwd: root, encoding: "utf8", timeout: 20000, windowsHide: true });
    assert.equal(compiled.status, 0, compiled.stderr || compiled.stdout);
    const source = readFileSync(path.join(tmp, "merchant-private-catalog.js"), "utf8");
    const hooks = [];
    const effects = [];
    const requests = [];
    let index = 0;
    let scheduled = [];
    const react = {
      useState(initial) {
        const n = index++;
        if (!(n in hooks)) hooks[n] = initial;
        return [hooks[n], update => { hooks[n] = typeof update === "function" ? update(hooks[n]) : update; }];
      },
      useRef(initial) {
        const n = index++;
        if (!(n in hooks)) hooks[n] = { current: initial };
        return hooks[n];
      },
      useEffect(action, deps) {
        const n = index++;
        const prior = effects[n];
        if (!prior || deps.some((value, i) => prior.deps[i] !== value)) {
          scheduled.push(() => {
            prior?.cleanup?.();
            effects[n] = { deps, cleanup: action() };
          });
        }
      },
    };
    const jsx = (type, props) => ({ type, props: props ?? {} });
    const mocks = {
      "@bthwani/dsh": { validMerchantCatalogSearch: query => query.length <= 80 },
      "@bthwani/tamagui-config/appearance": {
        useMobileAppearance: () => ({ theme: {
          background: "back", surface: "surface", color: "text", colorSecondary: "secondary",
          borderColor: "border", actionSoft: "active", interactiveText: "link",
          successText: "good", warningText: "warning", dangerText: "danger",
        } }),
      },
      "./merchant-catalog-draft-form": { __esModule: true, default: "DraftForm" },
      "./catalog-export": { __esModule: true, default: "CatalogExport" },
      "./catalog-import": { __esModule: true, default: "CatalogImport" },
      "./inventory-summary": { __esModule: true, default: "InventorySummary" },
      "./catalog-transport": {
        readMerchantCatalogPage(storeId, actorId, signal, options) {
          const request = { storeId, actorId, signal, options };
          requests.push(request);
          return new Promise((resolve, reject) => { request.resolve = resolve; request.reject = reject; });
        },
      },
      react,
      "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
      "react-native": {
        ActivityIndicator: "ActivityIndicator", Platform: { OS: "web" },
        Pressable: "Pressable", Text: "Text", TextInput: "TextInput", View: "View",
        AppState: { addEventListener: () => ({ remove() {} }) },
      },
    };
    const previousWindow = globalThis.window;
    globalThis.window = { addEventListener() {}, removeEventListener() {} };
    try {
      const mod = { exports: {} };
      new Function("require", "module", "exports", source)(name => {
        assert.ok(Object.hasOwn(mocks, name), "unexpected dependency " + name);
        return mocks[name];
      }, mod, mod.exports);
      function render(actorId, stores, initialStoreId) {
        index = 0;
        scheduled = [];
        const tree = mod.exports.default({ actorId, stores, initialStoreId });
        for (const effect of scheduled) effect();
        return tree;
      }
      const stores = [{ id: "store-a", name: "متجر أول" }, { id: "store-b", name: "متجر ثان" }];
      let tree = render("merchant-a", stores);
      assert.equal(requests.length, 1);
      assert.equal(requests[0].storeId, "store-a");
      assert.equal(nodes(tree).find(n => n.type === "CatalogExport")?.props.storeId, "store-a");
      assert.equal(nodes(tree).find(n => n.type === "CatalogImport")?.props.storeId, "store-a");
      assert.equal(nodes(tree).find(n => n.type === "InventorySummary")?.props.storeId, "store-a");
      assert.equal(nodes(tree).find(n => n.type === "InventorySummary")?.props.actorId, "merchant-a");
      const choice = nodes(tree).find(n => n.props?.accessibilityLabel === "كتالوج متجر ثان");
      assert.ok(choice);
      choice.props.onPress();
      tree = render("merchant-a", stores);
      assert.equal(requests.length, 2);
      assert.equal(nodes(tree).find(n => n.type === "CatalogExport")?.props.storeId, "store-b");
      assert.equal(nodes(tree).find(n => n.type === "CatalogImport")?.props.storeId, "store-b");
      assert.equal(nodes(tree).find(n => n.type === "InventorySummary")?.props.storeId, "store-b");
      assert.equal(requests[0].signal.aborted, true);
      requests[0].resolve({ actorId: "merchant-a", storeId: "store-a",
        items: [offer("old-a", "بيانات قديمة")] });
      await Promise.resolve();
      await Promise.resolve();
      assert.ok(!nodes(render("merchant-a", stores)).some(n => n.props?.children === "بيانات قديمة"));

      requests[1].resolve({ actorId: "merchant-a", storeId: "store-b",
        items: [offer("of-a", "منتج أول")], nextCursor: "of-a" });
      await Promise.resolve();
      await Promise.resolve();
      tree = render("merchant-a", stores);
      assert.ok(nodes(tree).some(n => n.props?.children === "منتج أول"));
      const more = nodes(tree).find(n => n.props?.accessibilityRole === "button" &&
        n.props?.children?.props?.children === "عرض المزيد");
      assert.ok(more);
      more.props.onPress();
      assert.equal(requests.length, 3);
      assert.equal(requests[2].options.cursor, "of-a");
      requests[2].resolve({ actorId: "merchant-a", storeId: "store-b",
        items: [offer("of-b", "منتج ثان")] });
      await Promise.resolve();
      await Promise.resolve();
      tree = render("merchant-a", stores);
      assert.ok(nodes(tree).some(n => n.props?.children === "منتج ثان"));
      assert.ok(!nodes(tree).some(n => n.props?.children?.props?.children === "عرض المزيد"));

      const searchInput = nodes(tree).find(n => n.props?.accessibilityLabel === "البحث باسم المنتج");
      assert.ok(searchInput);
      searchInput.props.onChangeText("منتج");
      tree = render("merchant-a", stores);
      nodes(tree).find(n => n.props?.accessibilityLabel === "بحث في الكتالوج").props.onPress();
      tree = render("merchant-a", stores);
      assert.equal(requests.length, 4);
      assert.equal(requests[3].options.query, "منتج");
      assert.equal(requests[3].options.cursor, undefined);
      assert.ok(!nodes(tree).some(n => n.props?.children === "منتج ثان"));
      requests[3].resolve({ actorId: "merchant-a", storeId: "store-b",
        items: [offer("of-c", "منتج ثالث")], nextCursor: "of-c" });
      await Promise.resolve();
      await Promise.resolve();
      tree = render("merchant-a", stores);
      nodes(tree).find(n => n.props?.children?.props?.children === "عرض المزيد").props.onPress();
      assert.equal(requests[4].options.query, "منتج");
      assert.equal(requests[4].options.cursor, "of-c");
      tree = render("merchant-b", stores);
      assert.equal(nodes(tree).find(n => n.type === "InventorySummary")?.props.actorId, "merchant-b");
      assert.ok(!nodes(tree).some(n => n.props?.children === "منتج ثالث"));
      assert.equal(requests[5].options.query, undefined);
      assert.equal(nodes(tree).find(n => n.props?.accessibilityLabel === "البحث باسم المنتج").props.value, "");
      requests[4].resolve({ actorId: "merchant-a", storeId: "store-b", items: [offer("of-d", "قديم")] });
      await Promise.resolve();
      await Promise.resolve();
      assert.ok(!nodes(render("merchant-b", stores)).some(n => n.props?.children === "قديم"));
      assert.equal(requests.length, 6);
      const draftId = "of-1234567890abcdef1234567890abcdef";
      const draft = { ...offer(draftId, "مسودة للسعر"), productActive: false,
        variantSellable: false, requiredAttributesValid: false };
      requests[5].resolve({ actorId: "merchant-b", storeId: "store-b",
        items: [draft, { ...draft, id: "of-2234567890abcdef1234567890abcdef", name: "عرض منشور", published: true }] });
      await Promise.resolve(); await Promise.resolve();
      tree = render("merchant-b", stores);
      const quickMode = nodes(tree).find(n => n.props?.accessibilityLabel === "الأسعار والمخزون للمسودات");
      assert.ok(quickMode, "Merchant can open focused draft price editing");
      quickMode.props.onPress();
      tree = render("merchant-b", stores);
      assert.ok(!nodes(tree).some(n => n.type === "DraftForm" && !n.props.draft), "hide create form in focused mode");
      const quickEdit = nodes(tree).find(n => n.props?.accessibilityLabel === "تعديل سعر ومخزون مسودة للسعر");
      assert.ok(quickEdit);
      assert.ok(!nodes(tree).some(n => n.props?.accessibilityLabel === "تعديل سعر ومخزون عرض منشور"));
      quickEdit.props.onPress();
      tree = render("merchant-b", stores);
      const edit = nodes(tree).find(n => n.type === "DraftForm");
      assert.equal(edit.props.priceStockOnly, true);
      assert.equal(edit.props.storeId, "store-b");
      assert.equal(edit.props.draft.id, draftId);
      tree = render("merchant-c", stores);
      assert.ok(!nodes(tree).some(n => n.type === "DraftForm" && n.props.draft));
      assert.equal(nodes(tree).find(n => n.props?.accessibilityLabel === "الأسعار والمخزون للمسودات").props.accessibilityState.selected, false);

      // Remount via the directory with a second Store selected, then revoke that Store.
      for (const effect of effects) effect?.cleanup?.();
      hooks.length = 0;
      effects.length = 0;
      requests.length = 0;
      tree = render("merchant-a", stores, "store-b");
      assert.equal(requests[0].storeId, "store-b");
      assert.equal(nodes(tree).find(n => n.type === "DraftForm").props.storeId, "store-b");
      tree = render("merchant-a", stores.slice(0, 1), "store-b");
      assert.equal(requests.length, 1, "revoking Store B must not trigger a read of Store A");
      assert.equal(requests[0].signal.aborted, true);
      assert.ok(!nodes(tree).some(n => ["DraftForm", "CatalogExport", "CatalogImport", "InventorySummary"].includes(n.type)));
      nodes(tree).find(n => n.props?.accessibilityLabel === "كتالوج متجر أول").props.onPress();
      render("merchant-a", stores.slice(0, 1), "store-b");
      assert.equal(requests[1].storeId, "store-a");
      const filterView = render("merchant-a", stores.slice(0, 1), "store-b");
      const stockout = nodes(filterView).find(n => n.props?.accessibilityLabel === "نفد المخزون");
      assert.ok(stockout, "complete owner status filter is available");
      stockout.props.onPress();
      tree = render("merchant-a", stores.slice(0, 1), "store-b");
      assert.equal(requests[1].signal.aborted, true);
      assert.equal(requests[2].options.status, "stockout");
      assert.equal(nodes(tree).find(n => n.type === "CatalogExport").props.status, "stockout");
      assert.equal(requests[2].options.cursor, undefined);
      assert.equal(nodes(tree).find(n => n.props?.accessibilityLabel === "نفد المخزون").props.accessibilityState.selected, true);
      requests[1].resolve({ actorId: "merchant-a", storeId: "store-a", items: [{ ...draft, storeId: "store-a", name: "صفحة قديمة" }] });
      await Promise.resolve(); await Promise.resolve();
      assert.ok(!nodes(render("merchant-a", stores.slice(0, 1), "store-b")).some(n => n.props?.children === "صفحة قديمة"));
      nodes(tree).find(n => n.props?.accessibilityLabel === "كل العروض").props.onPress();
      render("merchant-a", stores.slice(0, 1), "store-b");
      assert.equal(requests[2].signal.aborted, true);
      assert.equal(requests[3].options.status, undefined);

      const privateRow = { ...draft, storeId: "store-a", id: "of-b", name: "بيانات متجر خاصة" };
      requests[3].resolve({ actorId: "merchant-a", storeId: "store-a", items: [privateRow], nextCursor: "of-b" });
      await Promise.resolve(); await Promise.resolve();
      tree = render("merchant-a", stores.slice(0, 1), "store-b");
      assert.ok(nodes(tree).some(n => n.props?.children === privateRow.name));
      nodes(tree).find(n => n.props?.children?.props?.children === "عرض المزيد").props.onPress();
      requests[4].reject(Object.assign(new Error("revoked"), { status: 403 }));
      await Promise.resolve(); await Promise.resolve();
      tree = render("merchant-a", stores.slice(0, 1), "store-b");
      const privateControls = n => ["DraftForm", "CatalogExport", "CatalogImport", "InventorySummary"].includes(n.type);
      assert.ok(!nodes(tree).some(n => n.props?.children === privateRow.name), "revocation must remove previously loaded rows");
      assert.ok(!nodes(tree).some(privateControls), "revocation must remove all scoped controls");
      nodes(tree).find(n => n.props?.accessibilityLabel === "نفد المخزون").props.onPress();
      tree = render("merchant-a", stores.slice(0, 1), "store-b");
      assert.ok(!nodes(tree).some(privateControls), "filter change cannot bypass the hold");
      requests[5].resolve({ actorId: "merchant-a", storeId: "store-a", items: [] });
      await Promise.resolve(); await Promise.resolve();
      tree = render("merchant-a", stores.slice(0, 1), "store-b");
      assert.ok(nodes(tree).some(privateControls), "fresh owner read can restore scoped controls");
      nodes(tree).find(n => n.props?.accessibilityLabel === "كل العروض").props.onPress();
      render("merchant-a", stores.slice(0, 1), "store-b");
      requests[6].resolve({ actorId: "merchant-a", storeId: "store-a", items: [privateRow], nextCursor: "of-b" });
      await Promise.resolve(); await Promise.resolve();
      tree = render("merchant-a", stores.slice(0, 1), "store-b");
      nodes(tree).find(n => n.props?.children?.props?.children === "عرض المزيد").props.onPress();
      requests[7].resolve({ actorId: "merchant-a", storeId: "store-a", items: [{ ...privateRow, id: "of-a", name: "صفحة غير صالحة" }] });
      await Promise.resolve(); await Promise.resolve();
      tree = render("merchant-a", stores.slice(0, 1), "store-b");
      assert.ok(!nodes(tree).some(n => [privateRow.name, "صفحة غير صالحة"].includes(n.props?.children)), "backward cursor must not render any stale or invalid rows");
      assert.ok(!nodes(tree).some(privateControls));
      nodes(tree).find(n => n.props?.children?.props?.children === "إعادة المحاولة").props.onPress();
      tree = render("merchant-a", stores.slice(0, 1), "store-b");
      assert.ok(!nodes(tree).some(privateControls), "retry must remain held while waiting for owner");
      requests[8].reject(new Error("owner unavailable"));
      await Promise.resolve(); await Promise.resolve();
      assert.ok(!nodes(render("merchant-a", stores.slice(0, 1), "store-b")).some(privateControls));
    } finally {
      if (previousWindow === undefined) delete globalThis.window;
      else globalThis.window = previousWindow;
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("inventory summary displays owner counts and never leaks a stale Store after switch or failure", async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), "bthwani-inventory-test-"));
  try {
    const inventorySrc = fileURLToPath(new URL("../src/features/catalog/inventory-summary.tsx", import.meta.url));
    const compiled = spawnSync(process.execPath, [
      path.join(root, "node_modules/typescript/bin/tsc"), inventorySrc, "--ignoreConfig",
      "--noResolve", "--noCheck", "--target", "es2022", "--module", "commonjs",
      "--jsx", "react-jsx", "--outDir", tmp,
    ], { cwd: root, encoding: "utf8", timeout: 20000, windowsHide: true });
    assert.equal(compiled.status, 0, compiled.stderr || compiled.stdout);
    const hooks = [], effects = [], requests = [];
    let index = 0, scheduled = [];
    const jsx = (type, props) => ({type,props:props ?? {}});
    const mocks = {
      "@bthwani/tamagui-config/appearance": {useMobileAppearance:()=>({theme:{}})},
      "react/jsx-runtime": {jsx,jsxs:jsx,Fragment:"Fragment"},
      "react-native": {ActivityIndicator:"ActivityIndicator",Pressable:"Pressable",Text:"Text",View:"View"},
      "./catalog-transport": {
        readMerchantInventorySummary(storeId,actorId,signal) {
          return new Promise((resolve,reject)=>requests.push({storeId,actorId,signal,resolve,reject}));
        },
      },
      react: {
        useState(initial) {
          const n = index++;
          if (!(n in hooks)) hooks[n] = initial;
          return [hooks[n],update=>{hooks[n]=typeof update==="function"?update(hooks[n]):update;}];
        },
        useEffect(action,deps) {
          const n = index++, prior=effects[n];
          if (!prior || deps.some((v,i)=>prior.deps[i]!==v)) scheduled.push(()=>{
            prior?.cleanup?.();
            effects[n]={deps,cleanup:action()};
          });
        },
      },
    };
    const mod = {exports:{}};
    new Function("require","module","exports",readFileSync(path.join(tmp,"inventory-summary.js"),"utf8"))(name=>{
      assert.ok(Object.hasOwn(mocks,name),name);
      return mocks[name];
    },mod,mod.exports);
    function render(actorId,storeId) {
      index=0; scheduled=[];
      const tree=mod.exports.default({actorId,storeId});
      for(const effect of scheduled) effect();
      return nodes(tree);
    }
    const counts = (actorId,storeId,totalOffers)=>({actorId,storeId,totalOffers,publishedOffers:0,availableOffers:0,unavailableOffers:0,stockoutOffers:0});
    const hasCount=(tree,n)=>tree.some(node=>node.props?.children===n.toLocaleString("ar-YE"));
    assert.ok(render("merchant-a","store-a").some(n=>n.type==="ActivityIndicator"));
    requests[0].resolve(counts("merchant-a","store-a",132));
    await Promise.resolve();
    assert.ok(hasCount(render("merchant-a","store-a"),132));
    assert.ok(!hasCount(render("merchant-a","store-b"),132));
    assert.equal(requests[0].signal.aborted,true);
    render("merchant-b","store-b");
    assert.equal(requests[1].signal.aborted,true);
    requests[1].resolve(counts("merchant-a","store-b",77));
    requests[2].reject(new Error("denied"));
    await Promise.resolve(); await Promise.resolve();
    const error=render("merchant-b","store-b");
    assert.ok(error.some(n=>n.props?.accessibilityRole==="alert"));
    assert.ok(!hasCount(error,77)); assert.ok(!hasCount(error,0));
    error.find(n=>n.type==="Pressable").props.onPress();
    render("merchant-b","store-b");
    requests[3].resolve(counts("merchant-b","store-b",0));
    await Promise.resolve();
    assert.ok(hasCount(render("merchant-b","store-b"),0));
  } finally { rmSync(tmp,{recursive:true,force:true}); }
});
