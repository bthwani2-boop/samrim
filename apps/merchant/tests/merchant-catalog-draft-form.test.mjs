import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadMappedRenderFixture } from "../../../tools/dev/mapped-render-fixture.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const src = fileURLToPath(new URL("../src/features/catalog/merchant-catalog-draft-form.tsx", import.meta.url));
// Retain uncached modules until Node collects source coverage.
const loadedModules = [];
process.once("exit", () => loadedModules.length);
function nodes(tree) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
test("Merchant draft form retries the identical operation after unknown outcome and clears state on Store switch", async t => {
  const tmp = mkdtempSync(path.join(tmpdir(), "bthwani-draft-render-"));
  try {
    const run = spawnSync(process.execPath, [
      path.join(root, "node_modules/@typescript/native/bin/tsc"), src, "--ignoreConfig",
      "--noResolve", "--noCheck", "--target", "es2022", "--module", "commonjs",
      "--jsx", "react-jsx", "--inlineSourceMap", "--inlineSources", "--outDir", tmp,
    ], { cwd: root, encoding: "utf8", timeout: 20000, windowsHide: true });
    assert.equal(run.status, 0, run.stderr || run.stdout);
    const srcCode = readFileSync(path.join(tmp, "merchant-catalog-draft-form.js"), "utf8");
    let idCount = 0;
    const storage = new Map();
    let failWrite = false;
    const localStorage = {
      getItem: key => storage.get(key) ?? null,
      setItem(key, value) {
        if (failWrite) throw new Error("storage blocked");
        storage.set(key, value);
      },
      removeItem: key => storage.delete(key),
    };
    const platform = { OS: "web" };
    const pending = [];
    const hooks = [];
    const effects = [];
    let hooksCursor = 0;
    let scheduled = [];
    const react = {
      useState(initial) {
        const at = hooksCursor++;
        if (!(at in hooks)) hooks[at] = initial;
        return [hooks[at], next => { hooks[at] = typeof next === "function" ? next(hooks[at]) : next; }];
      },
      useRef(initial) {
        const at = hooksCursor++;
        if (!(at in hooks)) hooks[at] = { current: initial };
        return hooks[at];
      },
      useEffect(callback, deps) {
        const at = hooksCursor++;
        const prev = effects[at];
        if (!prev || deps.some((value, i) => value !== prev.deps[i])) {
          scheduled.push(() => { prev?.cleanup?.(); effects[at] = { deps, cleanup: callback() }; });
        }
      },
    };
    const jsx = (type, props) => ({ type, props: props ?? {} });
    const mocks = {
      "@bthwani/dsh": {
        validMerchantCatalogDraft(input) {
          return input.name.length > 0 && Number(input.priceYer) > 0 && input.stockUnits >= 0;
        },
        validMerchantCatalogDraftEdit(input) {
          return input.expectedVersion >= 1 && input.name.length > 0 && Number(input.priceYer) > 0;
        },
      },
      "@bthwani/tamagui-config/appearance": {
        useMobileAppearance: () => ({ theme: {
          color: "text", colorSecondary: "muted", borderColor: "border",
          surface: "surface", actionBackground: "action", onAction: "white",
          warningText: "warn", successText: "good",
        } }),
      },
      "expo-crypto": {
        randomUUID: () => `draft-operation-${++idCount}`,
        CryptoDigestAlgorithm: { SHA256: "sha256" },
        digestStringAsync: async (algorithm, value) => createHash(algorithm).update(value).digest("hex"),
      },
      "expo-secure-store": {
        getItemAsync: async key => localStorage.getItem(key),
        setItemAsync: async (key, value) => localStorage.setItem(key, value),
        deleteItemAsync: async key => localStorage.removeItem(key),
      },
      "./catalog-transport": {
        submitMerchantCatalogDraft(storeId, actorId, change, signal) {
          const request = { storeId, actorId, change, signal };
          pending.push(request);
          return new Promise((resolve, reject) => { request.resolve = resolve; request.reject = reject; });
        },
        submitMerchantCatalogDraftEdit(storeId, offerId, actorId, change, signal) {
          const request = { storeId, offerId, actorId, change, signal };
          pending.push(request);
          return new Promise((resolve, reject) => { request.resolve = resolve; request.reject = reject; });
        },
      },
      react,
      "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
      "react-native": {
        Pressable: "Pressable", Text: "Text", TextInput: "TextInput", View: "View", Platform: platform,
      },
    };
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    t.after(() => {
      if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
      else delete globalThis.window;
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true, writable: true, value: { localStorage },
    });
    const mod = loadMappedRenderFixture(srcCode, src, mocks);
    loadedModules.push(mod);
    let created = 0;
    function render(actorId = "merchant-a", storeId = "store-a", draft, priceStockOnly = false, initialPriceStock) {
      hooksCursor = 0;
      scheduled = [];
      const tree = mod.exports.default({ actorId, storeId, draft, priceStockOnly, initialPriceStock, onCreated: () => { created++; } });
      for (const effect of scheduled) effect();
      return tree;
    }
    function namedInput(tree, label) {
      return nodes(tree).find(n => n.type === "TextInput" && n.props.accessibilityLabel === label);
    }
    function restart() {
      for (const effect of effects) effect?.cleanup?.();
      hooks.length = 0;
      effects.length = 0;
    }
    const settle = () => new Promise(setImmediate);
    render();
    await settle();
    let tree = render();
    namedInput(tree, "اسم المنتج").props.onChangeText("منتج جديد");
    namedInput(render(), "السعر بالريال اليمني").props.onChangeText("١٥٠٠");
    namedInput(render(), "عدد الوحدات").props.onChangeText("3");
    tree = render();
    const save = nodes(tree).find(n => n.type === "Pressable" && n.props.accessibilityLabel === "حفظ مسودة المنتج");
    assert.ok(save && !save.props.disabled);
    save.props.onPress();
    await settle();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].change.priceYer, "1500");
    assert.equal(pending[0].change.operationId, "draft-operation-1");
    assert.deepEqual(Object.keys(pending[0].change).sort(), ["name", "operationId", "priceYer", "stockUnits"]);
    assert.equal(storage.size, 1, "save the operation before dispatch");
    assert.doesNotMatch([...storage.values()][0], /منتج جديد|1500|store-a|merchant-a/);
    const first = pending[0];
    first.reject(new Error("ack lost after COMMIT"));
    await new Promise(setImmediate);
    tree = render();
    const retry = nodes(tree).find(n => n.type === "Pressable" &&
      n.props.accessibilityLabel === "إعادة تأكيد المسودة");
    assert.ok(retry, "uncertain mutation must offer same-key retry");
    assert.equal(namedInput(tree, "اسم المنتج").props.editable, false);
    restart();
    render("merchant-b", "store-a");
    await settle();
    assert.ok(!nodes(render("merchant-b", "store-a")).some(n => n.props?.accessibilityLabel === "إعادة تأكيد المسودة"));
    render();
    await settle();
    const restore = nodes(render()).find(n => n.props?.accessibilityLabel === "إعادة تأكيد المسودة");
    assert.ok(restore, "restored account must recover the pending operation");
    namedInput(render(), "اسم المنتج").props.onChangeText("منتج مختلف");
    namedInput(render(), "السعر بالريال اليمني").props.onChangeText("1500");
    namedInput(render(), "عدد الوحدات").props.onChangeText("3");
    nodes(render()).find(n => n.props?.accessibilityLabel === "إعادة تأكيد المسودة").props.onPress();
    await settle();
    assert.equal(pending.length, 1, "a different payload must not replace an uncertain command");
    namedInput(render(), "اسم المنتج").props.onChangeText("منتج جديد");
    nodes(render()).find(n => n.props?.accessibilityLabel === "إعادة تأكيد المسودة").props.onPress();
    await settle();
    assert.equal(pending.length, 2);
    assert.deepEqual(pending[1].change, first.change);
    assert.equal(idCount, 1);
    pending[1].resolve({ replay: true });
    await new Promise(setImmediate);
    assert.equal(created, 1);
    assert.equal(storage.size, 0, "clear the replay marker after owner confirmation");
    tree = render();
    assert.equal(namedInput(tree, "اسم المنتج").props.value, "");
    assert.ok(nodes(tree).some(n => n.props?.accessibilityLabel === "حفظ مسودة المنتج"));
    tree = render("merchant-b", "store-b");
    assert.equal(pending.length, 2);
    assert.ok(!nodes(tree).some(n => n.props?.children === "منتج جديد"));

    const existingDraft = {
      id: "of-1234567890abcdef1234567890abcdef", storeId: "store-a",
      name: "مسودة أصلية", priceYer: "5000", stockUnits: 2, draftVersion: 1,
      published: false, available: false, productActive: false,
      variantSellable: false, requiredAttributesValid: false,
    };
    restart();
    const csvValues = { priceYer: "9223372036854775807", stockUnits: 0 };
    render("merchant-a", "store-a", existingDraft, true, csvValues);
    await settle();
    tree = render("merchant-a", "store-a", existingDraft, true, csvValues);
    assert.equal(namedInput(tree, "السعر بالريال اليمني").props.value, csvValues.priceYer);
    assert.equal(namedInput(tree, "عدد الوحدات").props.value, "0");
    assert.equal(namedInput(tree, "اسم المنتج"), undefined);
    assert.equal(pending.length, 2, "import selection must not dispatch without explicit save");
    restart();
    platform.OS = "android";
    render("merchant-a", "store-a", existingDraft);
    await settle();
    tree = render("merchant-a", "store-a", existingDraft);
    assert.equal(namedInput(tree, "اسم المنتج").props.value, "مسودة أصلية");
    assert.equal(namedInput(tree, "السعر بالريال اليمني").props.value, "5000");
    namedInput(tree, "اسم المنتج").props.onChangeText("مسودة معدلة");
    tree = render("merchant-a", "store-a", existingDraft);
    const update = nodes(tree).find(n => n.type === "Pressable" &&
      n.props.accessibilityLabel === "حفظ تعديل المسودة");
    assert.ok(update && !update.props.disabled);
    failWrite = true;
    update.props.onPress();
    await settle();
    assert.equal(pending.length, 2, "a failed write to recovery storage must prevent dispatch");
    failWrite = false;
    nodes(render("merchant-a", "store-a", existingDraft))
      .find(n => n.props?.accessibilityLabel === "حفظ تعديل المسودة").props.onPress();
    await settle();
    assert.equal(pending.length, 3);
    assert.equal(pending[2].offerId, existingDraft.id);
    assert.equal(pending[2].change.expectedVersion, 1);
    assert.equal(pending[2].change.name, "مسودة معدلة");
    assert.equal(pending[2].change.operationId, "draft-operation-3");
    pending[2].reject(new Error("edit commit acknowledged by SQL but network failed"));
    await new Promise(setImmediate);
    restart();
    const updatedDraft = { ...existingDraft, draftVersion: 2 };
    render("merchant-a", "store-a", updatedDraft);
    await settle();
    namedInput(render("merchant-a", "store-a", updatedDraft), "اسم المنتج").props.onChangeText("مسودة معدلة");
    tree = render("merchant-a", "store-a", updatedDraft);
    const retryEdit = nodes(tree).find(n => n.type === "Pressable" &&
      n.props.accessibilityLabel === "إعادة تأكيد المسودة");
    assert.ok(retryEdit);
    retryEdit.props.onPress();
    await settle();
    assert.equal(pending.length, 4);
    assert.deepEqual(pending[3].change, pending[2].change);
    assert.equal(idCount, 3);
    pending[3].resolve({ replay: true });
    await new Promise(setImmediate);
    assert.equal(created, 2);

    restart();
    render("merchant-a", "store-a", updatedDraft);
    await settle();
    namedInput(render("merchant-a", "store-a", updatedDraft), "اسم المنتج").props.onChangeText("تعديل متزامن");
    nodes(render("merchant-a", "store-a", updatedDraft))
      .find(n => n.props?.accessibilityLabel === "حفظ تعديل المسودة").props.onPress();
    await settle();
    pending[4].reject({ status: 409, code: "CATALOG_DRAFT_VERSION_CONFLICT" });
    await settle();
    assert.equal(storage.size, 0, "DSH confirmed this version conflict did not apply the edit");
    assert.ok(nodes(render("merchant-a", "store-a", updatedDraft))
      .some(n => n.props?.accessibilityLabel === "تحديث مسودة الكتالوج"));

    restart();
    render("merchant-a", "store-a", updatedDraft, true);
    await settle();
    tree = render("merchant-a", "store-a", updatedDraft, true);
    assert.equal(namedInput(tree, "اسم المنتج"), undefined, "focused pricing cannot rename a product");
    assert.ok(nodes(tree).some(n => n.props?.children === updatedDraft.name));
    namedInput(tree, "السعر بالريال اليمني").props.onChangeText("٦٥٠٠");
    tree = render("merchant-a", "store-a", updatedDraft, true);
    namedInput(tree, "عدد الوحدات").props.onChangeText("7");
    tree = render("merchant-a", "store-a", updatedDraft, true);
    const quickSave = nodes(tree).find(n => n.props?.accessibilityLabel === "حفظ تعديل المسودة");
    assert.ok(quickSave && !quickSave.props.disabled);
    quickSave.props.onPress();
    await settle();
    assert.equal(pending[5].change.name, updatedDraft.name);
    assert.equal(pending[5].change.priceYer, "6500");
    assert.equal(pending[5].change.stockUnits, 7);
    assert.equal(pending[5].change.expectedVersion, 2);
    pending[5].reject(new Error("unknown outcome"));
    await settle();
    tree = render("merchant-a", "store-a", updatedDraft, true);
    nodes(tree).find(n => n.props?.accessibilityLabel === "إعادة تأكيد المسودة").props.onPress();
    await settle();
    assert.deepEqual(pending[6].change, pending[5].change);
    pending[6].resolve({ replay: true });
    await settle();
    assert.equal(storage.size, 0);
    assert.equal(created, 3);

    restart();
    const latestDraft = { ...updatedDraft, draftVersion: 3 };
    render("merchant-a", "store-a", latestDraft, true, csvValues);
    await settle();
    const importedSave = nodes(render("merchant-a", "store-a", latestDraft, true, csvValues))
      .find(n => n.props?.accessibilityLabel === "حفظ تعديل المسودة");
    assert.ok(importedSave && !importedSave.props.disabled);
    importedSave.props.onPress();
    await settle();
    assert.equal(pending[7].offerId, latestDraft.id);
    assert.equal(pending[7].change.expectedVersion, 3);
    assert.equal(pending[7].change.name, latestDraft.name);
    assert.equal(pending[7].change.priceYer, csvValues.priceYer);
    assert.equal(pending[7].change.stockUnits, 0);
    pending[7].reject(new Error("unknown CSV edit outcome"));
    await settle();
    restart();
    render("merchant-a", "store-a", {...latestDraft,draftVersion:4}, true, csvValues);
    await settle();
    nodes(render("merchant-a", "store-a", {...latestDraft,draftVersion:4}, true, csvValues))
      .find(n => n.props?.accessibilityLabel === "إعادة تأكيد المسودة").props.onPress();
    await settle();
    assert.deepEqual(pending[8].change,pending[7].change);
    pending[8].resolve({ replay: true });
    await settle();
    assert.equal(storage.size,0);
    assert.equal(created,4);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
