import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import Module from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadMappedRenderFixture } from "../../../tools/dev/mapped-render-fixture.mjs";

// Retain uncached inventory modules until Node collects source coverage.
const loadedInventoryModules = [];
process.once("exit", () => loadedInventoryModules.length);
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
      "--jsx", "react-jsx", "--inlineSourceMap", "--inlineSources", "--outDir", tmp,
    ], { cwd: root, encoding: "utf8", timeout: 20000, windowsHide: true });
    assert.equal(compiled.status, 0, compiled.stderr || compiled.stdout);
    const source = readFileSync(path.join(tmp, "merchant-private-catalog.js"), "utf8").replace(
      /(\/\/# sourceMappingURL=data:application\/json;base64,)([A-Za-z0-9+/=]+)/,
      (_, prefix, encoded) => {
        const map = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
        map.sourceRoot = "";
        map.sources = [path.basename(src)];
        return prefix + Buffer.from(JSON.stringify(map)).toString("base64");
      },
    );
    const hooks = [];
    const effects = [];
    const requests = [];
    let index = 0;
    let scheduled = [];
    const platform = { OS: "web" };
    let appStateChange, focus;
    let nativeRemoved = 0;
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
        ActivityIndicator: "ActivityIndicator", Platform: platform,
        Pressable: "Pressable", Text: "Text", TextInput: "TextInput", View: "View",
        AppState: { addEventListener: (_event, cb) => { appStateChange = cb; return { remove() { nativeRemoved++; } }; } },
      },
    };
    const previousWindow = globalThis.window;
    globalThis.window = { addEventListener(_event, cb) { focus = cb; }, removeEventListener() { focus = undefined; } };
    try {
      const filename = src + ".compiled.cjs";
      const mod = new Module(filename);
      mod.filename = filename;
      mod.require = name => {
        assert.ok(Object.hasOwn(mocks, name), name);
        return mocks[name];
      };
      mod._compile(source, filename);
      function render(actorId, stores, initialStoreId, initialPriceStockOnly = false, inventoryOnly = false) {
        index = 0;
        scheduled = [];
        const tree = mod.exports.default({ actorId, stores, initialStoreId, initialPriceStockOnly, inventoryOnly });
        for (const effect of scheduled) effect();
        return tree;
      }
      const stores = [{ id: "store-a", name: "متجر أول" }, { id: "store-b", name: "متجر ثان" }];
      const privateControls = n => ["DraftForm", "CatalogExport", "CatalogImport", "InventorySummary"].includes(n.type);
      let tree = render("merchant-a", stores);
      assert.equal(requests.length, 1);
      assert.equal(requests[0].storeId, "store-a");
      assert.ok(!nodes(tree).some(privateControls), "first Store read must verify scope before mounting private controls");
      const choice = nodes(tree).find(n => n.props?.accessibilityLabel === "كتالوج متجر ثان");
      assert.ok(choice);
      choice.props.onPress();
      tree = render("merchant-a", stores);
      assert.equal(requests.length, 2);
      assert.ok(!nodes(tree).some(privateControls), "the second Store must wait for its own verification");
      assert.equal(requests[0].signal.aborted, true);
      requests[0].resolve({ actorId: "merchant-a", storeId: "store-a",
        items: [offer("old-a", "بيانات قديمة")] });
      await Promise.resolve();
      await Promise.resolve();
      assert.ok(!nodes(render("merchant-a", stores)).some(n => privateControls(n) || n.props?.children === "بيانات قديمة"));

      requests[1].resolve({ actorId: "merchant-a", storeId: "store-b",
        items: [offer("of-a", "منتج أول")], nextCursor: "of-a" });
      await Promise.resolve();
      await Promise.resolve();
      tree = render("merchant-a", stores);
      assert.ok(nodes(tree).some(n => n.props?.children === "منتج أول"));
      assert.equal(nodes(tree).find(n => n.type === "CatalogExport")?.props.storeId, "store-b");
      assert.equal(nodes(tree).find(n => n.type === "CatalogImport")?.props.storeId, "store-b");
      assert.equal(nodes(tree).find(n => n.type === "InventorySummary")?.props.actorId, "merchant-a");
      const more = nodes(tree).find(n => n.props?.accessibilityRole === "button" &&
        n.props?.children?.props?.children === "عرض المزيد");
      assert.ok(more);
      more.props.onPress();
      more.props.onPress();
      assert.equal(requests.length, 3, "duplicate continuation must not start another page");
      assert.equal(requests[2].signal.aborted, false);
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
      more.props.onPress();
      assert.equal(requests.length, 4, "obsolete continuation must not start a previous cursor");
      assert.equal(requests[3].signal.aborted, false);
      assert.equal(requests[3].options.query, "منتج");
      assert.equal(requests[3].options.cursor, undefined);
      assert.ok(!nodes(tree).some(n => n.props?.children === "منتج ثان"));
      assert.equal(nodes(tree).find(n => n.type === "CatalogExport")?.props.query, "منتج");
      assert.equal(nodes(tree).find(n => n.type === "CatalogImport")?.props.storeId, "store-b");
      requests[3].resolve({ actorId: "merchant-a", storeId: "store-b",
        items: [offer("of-c", "منتج ثالث")], nextCursor: "of-c" });
      await Promise.resolve();
      await Promise.resolve();
      tree = render("merchant-a", stores);
      nodes(tree).find(n => n.props?.children?.props?.children === "عرض المزيد").props.onPress();
      assert.equal(requests[4].options.query, "منتج");
      assert.equal(requests[4].options.cursor, "of-c");
      tree = render("merchant-b", stores);
      assert.ok(!nodes(tree).some(privateControls), "a new actor must independently verify the same Store");
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
      assert.equal(nodes(tree).find(n => n.type === "InventorySummary")?.props.actorId, "merchant-b");
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
      tree = render("merchant-b", stores);
      assert.ok(!nodes(tree).some(privateControls), "returning to the previous actor still requires fresh verification");

      // Remount via the directory with a second Store selected, then revoke that Store.
      for (const effect of effects) effect?.cleanup?.();
      hooks.length = 0;
      effects.length = 0;
      requests.length = 0;
      tree = render("merchant-a", stores, "store-b", true);
      assert.equal(requests[0].storeId, "store-b");
      assert.equal(nodes(tree).find(n => n.props?.accessibilityLabel === "الأسعار والمخزون للمسودات").props.accessibilityState.selected, true);
      assert.ok(!nodes(tree).some(n => n.type === "DraftForm" && !n.props.draft));
      tree = render("merchant-a", stores, "store-b", true);
      assert.equal(nodes(tree).find(n => n.props?.accessibilityLabel === "الأسعار والمخزون للمسودات").props.accessibilityState.selected, true);
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
      assert.ok(!nodes(tree).some(privateControls), "a filter change before the first success cannot mount controls");
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
      nodes(render("merchant-a", stores.slice(0, 1), "store-b"))
        .find(n => n.props?.children?.props?.children === "إعادة المحاولة").props.onPress();
      render("merchant-a", stores.slice(0, 1), "store-b");
      requests[9].resolve({ actorId: "merchant-a", storeId: "store-a", items: [] });
      await Promise.resolve(); await Promise.resolve();
      const summary = nodes(render("merchant-a", stores.slice(0, 1), "store-b")).find(n => n.type === "InventorySummary");
      summary.props.onShowStockout();
      render("merchant-a", stores.slice(0, 1), "store-b");
      assert.equal(requests[10].storeId, "store-a");
      assert.equal(requests[10].options.status, "stockout");
      assert.equal(requests[10].options.query, undefined);

      // Leaving the products section must cancel the current continuation,
      // not just the already completed initial page.
      requests[10].resolve({ actorId: "merchant-a", storeId: "store-a",
        items: [privateRow], nextCursor: "of-b" });
      await Promise.resolve(); await Promise.resolve();
      tree = render("merchant-a", stores.slice(0, 1), "store-b");
      nodes(tree).find(n => n.props?.children?.props?.children === "عرض المزيد").props.onPress();
      const continuation = requests[11];
      assert.equal(continuation.options.cursor, "of-b");
      assert.equal(continuation.signal.aborted, false);
      for (const effect of effects) effect?.cleanup?.();
      assert.equal(continuation.signal.aborted, true, "unmount must cancel the active continuation");
      const afterUnmount = hooks.slice();
      continuation.resolve({ actorId: "merchant-a", storeId: "store-a",
        items: [{ ...privateRow, id: "of-c" }] });
      await Promise.resolve(); await Promise.resolve();
      assert.deepEqual(hooks, afterUnmount, "late continuation must not update unmounted state");

      hooks.length = 0;
      effects.length = 0;
      requests.length = 0;
      const inventory = (actor = "merchant-a", scoped = stores) => render(actor, scoped, undefined, false, true);
      tree = inventory();
      assert.equal(requests[0].storeId, "store-a");
      requests[0].resolve({ actorId: "merchant-a", storeId: "store-a", items: [{ ...draft, storeId: "store-a" }] });
      await Promise.resolve(); await Promise.resolve();
      tree = inventory();
      assert.ok(nodes(tree).some(n => n.props?.accessibilityLabel === "تعديل سعر ومخزون مسودة للسعر"));
      assert.equal(nodes(tree).find(n => n.type === "CatalogExport")?.props.storeId, "store-a", "Inventory must expose the existing bulk CSV workflow");
      assert.equal(nodes(tree).find(n => n.type === "CatalogImport")?.props.actorId, "merchant-a");
      assert.equal(nodes(tree).find(n => n.type === "CatalogImport")?.props.storeId, "store-a");
      assert.ok(!nodes(tree).some(n => n.type === "DraftForm" && !n.props.draft));
      assert.equal(nodes(tree).find(n => n.type === "InventorySummary")?.props.storeId, "store-a");
      nodes(tree).find(n => n.props?.accessibilityLabel === "كتالوج متجر ثان").props.onPress();
      tree = inventory();
      assert.equal(requests[1].storeId, "store-b");
      assert.ok(!nodes(tree).some(privateControls));
      requests[1].resolve({ actorId: "merchant-a", storeId: "store-b", items: [draft] });
      await Promise.resolve(); await Promise.resolve();
      tree = inventory();
      const focusedEdit = nodes(tree).find(n => n.props?.accessibilityLabel === "تعديل سعر ومخزون مسودة للسعر");
      assert.ok(focusedEdit);
      focusedEdit.props.onPress();
      tree = inventory();
      assert.equal(nodes(tree).find(n => n.type === "DraftForm")?.props.priceStockOnly, true);
      assert.equal(nodes(tree).find(n => n.type === "DraftForm")?.props.storeId, "store-b");
      assert.equal(nodes(tree).find(n => n.type === "CatalogImport")?.props.storeId, "store-b");
      assert.equal(nodes(tree).find(n => n.type === "CatalogExport")?.props.storeId, "store-b");
      assert.ok(!nodes(tree).some(n => n.props?.accessibilityLabel === "الأسعار والمخزون للمسودات"));
      tree = inventory("merchant-a", stores.slice(0, 1));
      assert.ok(!nodes(tree).some(privateControls), "revoked store hides inventory and editor");
      assert.equal(requests.length, 2, "no silent fallback to another Store");
      // Exercise the same owner read lifecycle on Android, including return to
      // foreground, empty authority, form acknowledgments and same-filter refresh.
      assert.equal(typeof focus, "function");
      for (const effect of effects) effect?.cleanup?.();
      assert.equal(focus, undefined);
      hooks.length = 0;
      effects.length = 0;
      requests.length = 0;
      platform.OS = "android";
      const native = (actor = "merchant-a", scoped = stores) => render(actor, scoped);
      const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
      const press = (view, label) => nodes(view).find(n =>
        n.props?.accessibilityLabel === label || n.props?.children?.props?.children === label);
      const nativeRows = [
        { ...draft, storeId: "store-a" },
        { ...draft, id: "of-available", name: "available", available: true },
        { ...draft, id: "of-active", name: "active", productActive: true },
        { ...draft, id: "of-sellable", name: "sellable", variantSellable: true },
        { ...draft, id: "of-validated", name: "validated", requiredAttributesValid: true },
        { ...draft, id: "invalid-draft-id", name: "invalid id" },
      ];
      const answer = async (items = nativeRows, nextCursor) => {
        requests.at(-1).resolve({ actorId: "merchant-a", storeId: "store-a", items, nextCursor });
        await flush();
        return native();
      };
      native("merchant-a", []);
      assert.equal(requests.length, 0);
      native("", stores);
      assert.equal(requests.length, 0);
      native();
      assert.equal(requests.length, 1);
      tree = await answer();
      assert.equal(nodes(tree).filter(n => n.props?.accessibilityLabel?.startsWith("تعديل ")).length, 1);
      const draftEdit = press(tree, "تعديل مسودة للسعر");
      draftEdit.props.onPress();
      tree = native();
      assert.equal(nodes(tree).find(n => n.type === "DraftForm" && n.props.draft)?.props.draft.id, draftId);
      press(tree, "تعديل مسودة للسعر").props.onPress();
      tree = native();
      assert.ok(!nodes(tree).some(n => n.type === "DraftForm" && n.props.draft));
      press(tree, "تعديل مسودة للسعر").props.onPress();
      tree = native();
      nodes(tree).find(n => n.type === "DraftForm" && n.props.draft).props.onCreated();
      native();
      assert.equal(requests.length, 2);
      tree = await answer();
      nodes(tree).find(n => n.type === "DraftForm" && !n.props.draft).props.onCreated();
      native();
      assert.equal(requests.length, 3);
      tree = await answer();
      nodes(tree).find(n => n.type === "CatalogImport").props.onChanged();
      native();
      assert.equal(requests.length, 4);
      tree = await answer();
      press(tree, "الأسعار والمخزون للمسودات").props.onPress();
      tree = native();
      press(tree, "الأسعار والمخزون للمسودات").props.onPress();
      tree = native();
      assert.ok(nodes(tree).some(n => n.type === "CatalogImport"));
      press(tree, "البحث باسم المنتج").props.onChangeText("x".repeat(81));
      tree = native();
      assert.equal(press(tree, "بحث في الكتالوج").props.disabled, true);
      press(tree, "البحث باسم المنتج").props.onChangeText("test");
      tree = native();
      press(tree, "بحث في الكتالوج").props.onPress();
      native();
      assert.equal(requests.at(-1).options.query, "test");
      tree = await answer();
      press(tree, "مسح البحث").props.onPress();
      native();
      assert.equal(requests.at(-1).options.query, undefined);
      tree = await answer([nativeRows[0]], "of-b");
      const oldMore = press(tree, "عرض المزيد");
      oldMore.props.onPress();
      const pendingPage = requests.at(-1);
      tree = native();
      assert.equal(press(tree, "جارٍ التحميل...").props.disabled, true);
      const count = requests.length;
      appStateChange("background");
      native();
      assert.equal(requests.length, count);
      appStateChange("active");
      native();
      assert.equal(requests.length, count + 1);
      assert.equal(pendingPage.signal.aborted, true);
      oldMore.props.onPress();
      assert.equal(requests.length, count + 1);
      pendingPage.reject(new Error("superseded page"));
      await flush();
      assert.equal(requests.at(-1).signal.aborted, false);
      tree = await answer([nativeRows[0]], "of-b");
      press(tree, "عرض المزيد").props.onPress();
      requests.at(-1).resolve({ actorId: "merchant-a", storeId: "store-a", items: [], nextCursor: "of-a" });
      await flush();
      tree = native();
      assert.ok(!nodes(tree).some(privateControls), "backward empty-page cursor must withdraw verified controls");
      press(tree, "إعادة المحاولة").props.onPress();
      native();
      tree = await answer([]);
      nodes(tree).find(n => n.type === "InventorySummary").props.onShowStockout();
      native();
      assert.equal(requests.at(-1).options.status, "stockout");
      tree = await answer([]);
      const beforeStockout = requests.length;
      nodes(tree).find(n => n.type === "InventorySummary").props.onShowStockout();
      native();
      assert.equal(requests.length, beforeStockout + 1, "same stockout shortcut must read fresh owner state");
      for (const effect of effects) effect?.cleanup?.();
      assert.equal(nativeRemoved, 1);
      // Dedicated Android Inventory uses the same owner-scoped import recovery and refresh.
      hooks.length = 0; effects.length = 0; requests.length = 0;
      const nativeInventory = () => render("merchant-a", stores, "store-a", false, true);
      tree = nativeInventory();
      assert.ok(!nodes(tree).some(privateControls));
      requests[0].resolve({actorId:"merchant-a",storeId:"store-a",items:[nativeRows[0]]});
      await flush();
      tree = nativeInventory();
      assert.equal(nodes(tree).find(n => n.type === "CatalogExport")?.props.storeId, "store-a");
      assert.ok(!nodes(tree).some(n => n.type === "DraftForm" && !n.props.draft));
      const importControl = nodes(tree).find(n => n.type === "CatalogImport");
      assert.equal(importControl?.props.actorId, "merchant-a");
      importControl.props.onChanged();
      nativeInventory();
      assert.equal(requests.length, 2, "confirmed bulk change refreshes owner catalog");
      requests[1].reject(new Error("denied"));
      await flush();
      assert.ok(!nodes(nativeInventory()).some(privateControls), "failed owner refresh withdraws the bulk workflow");
      for (const effect of effects) effect?.cleanup?.();
      assert.equal(nativeRemoved, 2);
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
      "--jsx", "react-jsx", "--inlineSourceMap", "--inlineSources", "--outDir", tmp,
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
    const mod = loadMappedRenderFixture(readFileSync(path.join(tmp, "inventory-summary.js"), "utf8"), inventorySrc, mocks);
    loadedInventoryModules.push(mod);
    let stockoutClicks = 0;
    const stockoutButton = tree => tree.find(n => n.type === "Pressable" && n.props?.children?.props?.children === "عرض العروض النافدة");
    function render(actorId,storeId,showStockout = true) {
      index=0; scheduled=[];
      const tree=mod.exports.default({actorId,storeId,onShowStockout: showStockout ? () => { stockoutClicks++; } : undefined});
      for(const effect of scheduled) effect();
      return nodes(tree);
    }
    const counts = (actorId,storeId,totalOffers)=>({actorId,storeId,totalOffers,publishedOffers:0,availableOffers:0,unavailableOffers:0,stockoutOffers:0});
    const hasCount=(tree,n)=>tree.some(node=>node.props?.children===n.toLocaleString("ar-YE"));
    assert.ok(render("merchant-a","store-a").some(n=>n.type==="ActivityIndicator"));
    requests[0].resolve({ ...counts("merchant-a","store-a",132), stockoutOffers: 3 });
    await Promise.resolve();
    assert.ok(hasCount(render("merchant-a","store-a"),132));
    stockoutButton(render("merchant-a","store-a")).props.onPress();
    assert.equal(stockoutClicks, 1);
    assert.equal(stockoutButton(render("merchant-a","store-a",false)), undefined, "embedded summary must not show a stockout action without a handler");
    const switchedStore = render("merchant-a","store-b");
    assert.ok(!hasCount(switchedStore,132));
    assert.equal(stockoutButton(switchedStore), undefined);
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
    const empty = render("merchant-b","store-b");
    assert.ok(hasCount(empty,0));
    assert.equal(stockoutButton(empty), undefined);
  } finally { rmSync(tmp,{recursive:true,force:true}); }
});
