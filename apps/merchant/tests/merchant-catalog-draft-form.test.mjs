import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const src = fileURLToPath(new URL("../src/features/catalog/merchant-catalog-draft-form.tsx", import.meta.url));
function nodes(tree) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
test("Merchant draft form retries the identical operation after unknown outcome and clears state on Store switch", async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), "bthwani-draft-render-"));
  try {
    const run = spawnSync(process.execPath, [
      path.join(root, "node_modules/typescript/bin/tsc"), src, "--ignoreConfig",
      "--noResolve", "--noCheck", "--target", "es2022", "--module", "commonjs",
      "--jsx", "react-jsx", "--outDir", tmp,
    ], { cwd: root, encoding: "utf8", timeout: 20000, windowsHide: true });
    assert.equal(run.status, 0, run.stderr || run.stdout);
    const srcCode = readFileSync(path.join(tmp, "merchant-catalog-draft-form.js"), "utf8");
    let idCount = 0;
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
      "expo-crypto": { randomUUID: () => `draft-operation-${++idCount}` },
      "../access/admission-transport": {
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
        Pressable: "Pressable", Text: "Text", TextInput: "TextInput", View: "View",
      },
    };
    const mod = { exports: {} };
    new Function("require", "module", "exports", srcCode)(name => {
      assert.ok(Object.hasOwn(mocks, name), "unexpected module: " + name);
      return mocks[name];
    }, mod, mod.exports);
    let created = 0;
    function render(actorId = "merchant-a", storeId = "store-a", draft) {
      hooksCursor = 0;
      scheduled = [];
      const tree = mod.exports.default({ actorId, storeId, draft, onCreated: () => { created++; } });
      for (const effect of scheduled) effect();
      return tree;
    }
    function namedInput(tree, label) {
      return nodes(tree).find(n => n.type === "TextInput" && n.props.accessibilityLabel === label);
    }
    let tree = render();
    namedInput(tree, "اسم المنتج").props.onChangeText("منتج جديد");
    namedInput(render(), "السعر بالريال اليمني").props.onChangeText("١٥٠٠");
    namedInput(render(), "عدد الوحدات").props.onChangeText("3");
    tree = render();
    const save = nodes(tree).find(n => n.type === "Pressable" && n.props.accessibilityLabel === "حفظ مسودة المنتج");
    assert.ok(save && !save.props.disabled);
    save.props.onPress();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].change.priceYer, "1500");
    assert.equal(pending[0].change.operationId, "draft-operation-1");
    assert.deepEqual(Object.keys(pending[0].change).sort(), ["name", "operationId", "priceYer", "stockUnits"]);
    const first = pending[0];
    first.reject(new Error("ack lost after COMMIT"));
    await new Promise(setImmediate);
    tree = render();
    const retry = nodes(tree).find(n => n.type === "Pressable" &&
      n.props.accessibilityLabel === "إعادة تأكيد إنشاء المسودة");
    assert.ok(retry, "uncertain mutation must offer same-key retry");
    assert.equal(namedInput(tree, "اسم المنتج").props.editable, false);
    retry.props.onPress();
    assert.equal(pending.length, 2);
    assert.deepEqual(pending[1].change, first.change);
    assert.equal(idCount, 1);
    pending[1].resolve({ replay: true });
    await new Promise(setImmediate);
    assert.equal(created, 1);
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
    render("merchant-a", "store-a", existingDraft);
    tree = render("merchant-a", "store-a", existingDraft);
    assert.equal(namedInput(tree, "اسم المنتج").props.value, "مسودة أصلية");
    assert.equal(namedInput(tree, "السعر بالريال اليمني").props.value, "5000");
    namedInput(tree, "اسم المنتج").props.onChangeText("مسودة معدلة");
    tree = render("merchant-a", "store-a", existingDraft);
    const update = nodes(tree).find(n => n.type === "Pressable" &&
      n.props.accessibilityLabel === "حفظ تعديل المسودة");
    assert.ok(update && !update.props.disabled);
    update.props.onPress();
    assert.equal(pending.length, 3);
    assert.equal(pending[2].offerId, existingDraft.id);
    assert.equal(pending[2].change.expectedVersion, 1);
    assert.equal(pending[2].change.name, "مسودة معدلة");
    assert.equal(pending[2].change.operationId, "draft-operation-2");
    pending[2].reject(new Error("edit commit acknowledged by SQL but network failed"));
    await new Promise(setImmediate);
    tree = render("merchant-a", "store-a", existingDraft);
    const retryEdit = nodes(tree).find(n => n.type === "Pressable" &&
      n.props.accessibilityLabel === "إعادة تأكيد إنشاء المسودة");
    assert.ok(retryEdit);
    retryEdit.props.onPress();
    assert.equal(pending.length, 4);
    assert.deepEqual(pending[3].change, pending[2].change);
    assert.equal(idCount, 2);
    pending[3].resolve({ replay: true });
    await new Promise(setImmediate);
    assert.equal(created, 2);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
