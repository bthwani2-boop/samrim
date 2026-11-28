import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import * as radioGroup from "@bthwani/tamagui-config/radio-group";
import { loadMappedRenderFixture } from "../../../../../tools/dev/mapped-render-fixture.mjs";
import { merchantNavigation } from "../navigation/merchant-workspace-model.ts";

const root = path.resolve(import.meta.dirname, "../../../../..");
const source = path.join(import.meta.dirname, "insights-screen.tsx");
const scratch = mkdtempSync(path.join(tmpdir(), "merchant-insights-render-"));
let compiled;
try {
  const result = spawnSync(process.execPath, [
    path.join(root, "node_modules/@typescript/native/bin/tsc"), source,
    "--ignoreConfig", "--noResolve", "--noCheck", "--target", "es2022",
    "--module", "commonjs", "--jsx", "react-jsx", "--inlineSourceMap",
    "--inlineSources", "--outDir", scratch,
  ], { cwd: root, encoding: "utf8", timeout: 20000, windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  compiled = readFileSync(path.join(scratch, "insights-screen.js"), "utf8");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

const stores = [
  { id: "store-a", name: "متجر أ", relation: "DIRECT", published: false },
  { id: "store-b", name: "متجر ب", relation: "MARKETPLACE", published: true },
];
function nodes(tree) {
  if (!tree || typeof tree !== "object") return [];
  return Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
}
function harness() {
  const opened = [];
  const hooks = [];
  const pendingEffects = [];
  let hookIndex = 0;
  const jsx = (type, props, key) => ({ type, props, key });
  const mocks = {
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    react: {
      useState(initial) {
        const slot = hookIndex++;
        if (!(slot in hooks)) hooks[slot] = initial;
        return [hooks[slot], next => {
          hooks[slot] = typeof next === "function" ? next(hooks[slot]) : next;
        }];
      },
      useRef(initial) {
        const slot = hookIndex++;
        if (!(slot in hooks)) hooks[slot] = { current: initial };
        return hooks[slot];
      },
      useEffect(effect, deps) {
        const slot = hookIndex++;
        const prior = hooks[slot];
        if (prior && deps.length === prior.deps.length &&
            deps.every((dependency, index) => Object.is(dependency, prior.deps[index]))) return;
        pendingEffects.push(() => {
          prior?.cleanup?.();
          hooks[slot] = { deps, cleanup: effect() };
        });
      },
    },
    "react-native": { Platform: { OS: "web" }, Pressable: "Pressable", Text: "Text", View: "View" },
    "@bthwani/tamagui-config/radio-group": radioGroup,
    "@bthwani/tamagui-config/appearance": { useMobileAppearance: () => ({ theme: {} }) },
    "../../components/merchant-capability-screen": { __esModule: true, default: "Capability" },
    "../catalog/inventory-summary": { __esModule: true, default: "InventorySummary" },
    "../catalog/catalog-export": { __esModule: true, default: "CatalogExport" },
  };
  const module = loadMappedRenderFixture(compiled, source, mocks);
  const Component = module.exports.default;
  return {
    opened,
    render(actorId = "merchant-a", available = stores, withAction = false, initialStoreId) {
      hookIndex = 0;
      const rendered = Component({ actorId, stores: available, initialStoreId,
        ...(withAction ? { onOpenCatalog: (...args) => opened.push(args) } : {}) });
      for (const effect of pendingEffects.splice(0)) effect();
      return nodes(rendered);
    },
  };
}

test("reports are reachable in the verified Merchant workspace", () => {
  assert.equal(merchantNavigation.some(item => item.id === "insights"), true);
});

test("reports require explicit current Store selection and reuse the owner-backed report and export", () => {
  const h = harness();
  const first = h.render();
  assert.ok(!first.some(n => n.type === "InventorySummary" || n.type === "CatalogExport"));
  const laterInitialStore = h.render("merchant-a", stores, false, "store-a");
  assert.ok(!laterInitialStore.some(n => n.type === "InventorySummary" || n.type === "CatalogExport"));
  const pick = first.find(n => n.props?.accessibilityLabel === "تقارير متجر ب");
  assert.ok(pick, "a Store in the verified directory must be selectable");
  assert.equal(pick.props.accessibilityRole, "radio");
  assert.equal(pick.props["aria-checked"], false);
  pick.props.onPress();
  const report = h.render();
  assert.equal(report.find(n => n.props?.accessibilityLabel === "تقارير متجر ب").props["aria-checked"], true);
  assert.deepEqual(report.find(n => n.type === "InventorySummary")?.props, { actorId: "merchant-a", storeId: "store-b" });
  assert.deepEqual(report.find(n => n.type === "CatalogExport")?.props, { actorId: "merchant-a", storeId: "store-b" });
  assert.ok(!h.render("merchant-a", stores.slice(0, 1)).some(n => n.type === "InventorySummary" || n.type === "CatalogExport"));
  assert.ok(!h.render("merchant-b").some(n => n.type === "InventorySummary" || n.type === "CatalogExport"));
  assert.ok(!h.render("", stores).some(n => n.type === "InventorySummary" || n.type === "CatalogExport"));
  assert.ok(!h.render("merchant-a", []).some(n => n.type === "InventorySummary" || n.type === "CatalogExport"));
  h.render().find(n => n.props?.accessibilityLabel === "تقارير متجر أ").props.onPress();
  assert.equal(h.render().find(n => n.type === "InventorySummary").props.storeId, "store-a");
});

test("refresh reloads only the selected Store report and ignores obsolete refresh actions", () => {
  const h = harness();
  h.render().find(n => n.props?.accessibilityLabel === "تقارير متجر أ").props.onPress();
  const current = h.render();
  const oldKey = current.find(n => n.type === "InventorySummary").key;
  const refresh = current.find(n => n.props?.accessibilityLabel === "تحديث تقرير المخزون").props.onPress;
  refresh();
  const updated = h.render();
  assert.notEqual(updated.find(n => n.type === "InventorySummary").key, oldKey);
  assert.equal(updated.find(n => n.type === "InventorySummary").props.storeId, "store-a");
  updated.find(n => n.props?.accessibilityLabel === "تقارير متجر أ").props.onPress();
  assert.equal(h.render().find(n => n.type === "InventorySummary").key, updated.find(n => n.type === "InventorySummary").key);
  h.render().find(n => n.props?.accessibilityLabel === "تقارير متجر ب").props.onPress();
  refresh();
  assert.equal(h.render().find(n => n.type === "InventorySummary").props.storeId, "store-b");
});

test("report drilldown preserves Store and filter, rejects obsolete or revoked selection", () => {
  const h = harness();
  const first = h.render("merchant-a", stores, true, "store-b");
  const summary = first.find(n => n.type === "InventorySummary");
  assert.ok(summary, "return to report restores the authorized selected Store");
  assert.equal(summary.props.storeId, "store-b");
  const old = summary.props.onShowStatus;
  assert.equal(typeof old, "function");
  old("stockout");
  assert.deepEqual(h.opened, [["store-b", "stockout"]]);
  first.find(n => n.props?.accessibilityLabel === "تقارير متجر أ").props.onPress();
  const current = h.render("merchant-a", stores, true);
  old("published");
  assert.equal(h.opened.length, 1);
  current.find(n => n.type === "InventorySummary").props.onShowStatus(undefined);
  assert.deepEqual(h.opened.at(-1), ["store-a", undefined]);
  h.render("merchant-a", stores.slice(1), true);
  current.find(n => n.type === "InventorySummary").props.onShowStatus("available");
  assert.equal(h.opened.length, 2);
  h.render("merchant-b", stores, true);
  old("stockout");
  assert.equal(h.opened.length, 2);
});
