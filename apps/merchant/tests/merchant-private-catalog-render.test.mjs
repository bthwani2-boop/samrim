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
      "@bthwani/tamagui-config/appearance": {
        useMobileAppearance: () => ({ theme: {
          background: "back", surface: "surface", color: "text", colorSecondary: "secondary",
          borderColor: "border", actionSoft: "active", interactiveText: "link",
          successText: "good", warningText: "warning", dangerText: "danger",
        } }),
      },
      "./merchant-catalog-draft-form": { default: "DraftForm" },
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
        Pressable: "Pressable", Text: "Text", View: "View",
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
      function render(actorId, stores) {
        index = 0;
        scheduled = [];
        const tree = mod.exports.default({ actorId, stores });
        for (const effect of scheduled) effect();
        return tree;
      }
      const stores = [{ id: "store-a", name: "متجر أول" }, { id: "store-b", name: "متجر ثان" }];
      let tree = render("merchant-a", stores);
      assert.equal(requests.length, 1);
      assert.equal(requests[0].storeId, "store-a");
      const choice = nodes(tree).find(n => n.props?.accessibilityLabel === "كتالوج متجر ثان");
      assert.ok(choice);
      choice.props.onPress();
      tree = render("merchant-a", stores);
      assert.equal(requests.length, 2);
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

      tree = render("merchant-b", []);
      assert.ok(!nodes(tree).some(n => n.props?.children === "منتج ثان"));
      assert.equal(requests.length, 3);
    } finally {
      if (previousWindow === undefined) delete globalThis.window;
      else globalThis.window = previousWindow;
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
