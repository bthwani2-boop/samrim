import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { collectCatalogExport } from "../src/features/catalog/catalog-export-data.ts";

const root = path.resolve(import.meta.dirname, "../../..");
const src = path.resolve(import.meta.dirname, "../src/features/catalog/catalog-export.tsx");
const offer = { id: "of-a", storeId: "store-a", productId: "p-a", variantId: "v-a",
  name: "قهوة يمنية", priceYer: "1500", stockUnits: 4, draftVersion: 1,
  productActive: true, variantSellable: true, requiredAttributesValid: true,
  published: false, available: false };
const result = { actorId: "merchant-a", storeId: "store-a", items: [offer] };
const tick = () => new Promise(setImmediate);
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== "object") return [];
  return [tree, ...nodes(tree.props?.children)];
}

test("export button hands off fresh CSV only in its current owner scope", async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), "bthwani-export-render-"));
  try {
    const compile = spawnSync(process.execPath, [
      path.join(root, "node_modules/typescript/bin/tsc"), src, "--ignoreConfig",
      "--noResolve", "--noCheck", "--target", "es2022", "--module", "commonjs",
      "--jsx", "react-jsx", "--outDir", tmp,
    ], { cwd: root, encoding: "utf8", timeout: 20000, windowsHide: true });
    assert.equal(compile.status, 0, compile.stderr || compile.stdout);
    const source = readFileSync(path.join(tmp, "catalog-export.js"), "utf8");
    const states = [], refs = [], requests = [], downloads = [], urls = new Map();
    let stateIndex = 0, refIndex = 0, cleanup, mounted = false;
    const platform = { OS: "web" };
    const nativeFiles = [];
    const shared = [];
    let sharingAvailable = true;
    let shareFails = false;
    class NativeFile {
      constructor(_cache, name) {
        this.uri = `file:///synthetic-cache/${name}`;
        this.exists = false;
        nativeFiles.push(this);
      }
      create() { this.exists = true; }
      write(csv) { assert.equal(this.exists, true); this.csv = csv; }
      delete() { this.exists = false; }
    }
    const react = {
      useState(initial) {
        const i = stateIndex++;
        if (!(i in states)) states[i] = initial;
        return [states[i], next => { states[i] = next; }];
      },
      useRef(initial) {
        const i = refIndex++;
        if (!(i in refs)) refs[i] = { current: initial };
        return refs[i];
      },
      useLayoutEffect(fn) { if (!mounted) { cleanup = fn(); mounted = true; } },
    };
    const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
    const mocks = {
      "@bthwani/tamagui-config/appearance": { useMobileAppearance: () => ({ theme: {} }) },
      "expo-crypto": { randomUUID: () => "synthetic" },
      react,
      "react/jsx-runtime": { jsx, jsxs: jsx },
      "react-native": { Platform: platform, Pressable: "Pressable", Text: "Text", View: "View" },
      "expo-file-system": { File: NativeFile, Paths: { cache: "synthetic-cache" } },
      "expo-sharing": {
        isAvailableAsync: async () => sharingAvailable,
        async shareAsync(uri, options) {
          const file = nativeFiles.findLast(entry => entry.uri === uri);
          assert.ok(file?.exists);
          assert.equal(options.mimeType, "text/csv");
          shared.push(file.csv);
          if (shareFails) throw new Error("share failed");
        },
      },
      "../../components/merchant-capability-screen": { __esModule: true, default: "Unavailable" },
      "./catalog-export-data": { collectCatalogExport },
      "./catalog-transport": { readMerchantCatalogPage(storeId, actorId, signal, options) {
        const call = { storeId, actorId, signal, options };
        requests.push(call);
        return new Promise((resolve, reject) => { call.resolve = resolve; call.reject = reject; });
      } },
    };
    const doc = { body: { appendChild() {} }, createElement: () => ({
      click() { downloads.push({ name: this.download, blob: urls.get(this.href) }); },
      remove() {},
    }) };
    const url = {
      createObjectURL(blob) { urls.set("blob:synthetic", blob); return "blob:synthetic"; },
      revokeObjectURL(value) { urls.delete(value); },
    };
    const mod = { exports: {} };
    new Function("require", "module", "exports", "document", "URL", "setTimeout", "clearTimeout", source)(
      name => { assert.ok(Object.hasOwn(mocks, name), name); return mocks[name]; },
      mod, mod.exports, doc, url, (fn, delay) => { if (delay === 1000) fn(); return 0; }, () => {},
    );
    const scope = { actorId: "merchant-a", storeId: "store-a" };
    function render() {
      stateIndex = 0; refIndex = 0;
      const component = mod.exports.default(scope);
      return component.type(component.props);
    }
    const button = () => nodes(render()).find(n => n.type === "Pressable");
    assert.equal(mod.exports.default().type, "Unavailable");
    button().props.onPress();
    button().props.onPress();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].storeId, "store-a");
    assert.equal(requests[0].actorId, "merchant-a");
    requests[0].resolve(result);
    await tick();
    assert.equal(downloads.length, 1);
    assert.equal(downloads[0].name, "bthwani-catalog-synthetic.csv");
    assert.match(await downloads[0].blob.text(), /قهوة يمنية/);
    assert.equal(urls.size, 0);

    button().props.onPress();
    requests[1].reject(new Error("denied"));
    await tick();
    assert.equal(downloads.length, 1);

    button().props.onPress();
    cleanup();
    assert.equal(requests[2].signal.aborted, true);
    requests[2].resolve(result);
    await tick();
    assert.equal(downloads.length, 1, "late response after scope unmount cannot download");

    // Exercise the actual Native delivery branch with synthetic Expo adapters.
    mounted = false;
    states.length = 0;
    refs.length = 0;
    platform.OS = "android";
    button().props.onPress();
    requests[3].resolve(result);
    await tick();
    assert.equal(shared.length, 1);
    assert.match(shared[0], /قهوة يمنية/);
    assert.equal(nativeFiles[0].exists, false, "temporary file cleaned after share");
    shareFails = true;
    button().props.onPress();
    requests[4].resolve(result);
    await tick();
    assert.equal(nativeFiles[1].exists, false, "failed share also cleans temporary file");
    sharingAvailable = false;
    button().props.onPress();
    requests[5].resolve(result);
    await tick();
    assert.equal(nativeFiles.length, 2, "unavailable sharing creates no file");

    // A change in the accepted selectors remounts and aborts the old export.
    cleanup();
    mounted = false;
    states.length = 0;
    refs.length = 0;
    platform.OS = "web";
    const filterScope = { ...scope, query: "قهوة", status: "unpublished" };
    const selected = mod.exports.default(filterScope);
    const replacement = mod.exports.default({ ...filterScope, status: "stockout" });
    assert.notEqual(selected.key, replacement.key);
    stateIndex = 0; refIndex = 0;
    const buttons = nodes(selected.type(selected.props)).filter(n => n.type === "Pressable");
    assert.equal(buttons.length, 2);
    buttons.find(n => n.props.accessibilityLabel === "تصدير نتائج التصفية CSV").props.onPress();
    assert.deepEqual(requests[6].options, { limit: 50, query: "قهوة", status: "unpublished" });
    cleanup();
    assert.equal(requests[6].signal.aborted, true);
    requests[6].resolve(result);
    await tick();
    assert.equal(downloads.length, 1, "old filtered export cannot hand off a file");

    mounted = false; states.length = 0; refs.length = 0; stateIndex = 0; refIndex = 0;
    const fresh = nodes(selected.type(selected.props)).filter(n => n.type === "Pressable");
    fresh.find(n => n.props.accessibilityLabel === "تصدير كتالوج المتجر CSV").props.onPress();
    assert.deepEqual(requests[7].options, { limit: 50 }, "whole export stays unfiltered");
    requests[7].resolve(result);
    await tick();
    assert.equal(downloads.length, 2);
    stateIndex = 0; refIndex = 0;
    nodes(selected.type(selected.props)).find(n => n.props?.accessibilityLabel === "تصدير نتائج التصفية CSV").props.onPress();
    assert.deepEqual(requests[8].options, { limit: 50, query: "قهوة", status: "unpublished" });
    requests[8].resolve(result);
    await tick();
    assert.equal(downloads.length, 3);
    assert.match(await downloads[2].blob.text(), /قهوة يمنية/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
