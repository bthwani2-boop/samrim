import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import Module from "node:module";
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
      "--jsx", "react-jsx", "--inlineSourceMap", "--inlineSources", "--outDir", tmp,
    ], { cwd: root, encoding: "utf8", timeout: 20000, windowsHide: true });
    assert.equal(compile.status, 0, compile.stderr || compile.stdout);
    const source = readFileSync(path.join(tmp, "catalog-export.js"), "utf8").replace(
      /(\/\/# sourceMappingURL=data:application\/json;base64,)([A-Za-z0-9+/=]+)/,
      (_, prefix, encoded) => {
        const map = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
        map.sourceRoot = "";
        map.sources = [path.basename(src)];
        map.mappings = ";" + map.mappings;
        return prefix + Buffer.from(JSON.stringify(map)).toString("base64");
      },
    );
    const states = [], refs = [], requests = [], downloads = [], urls = new Map();
    let stateIndex = 0, refIndex = 0, cleanup, mounted = false;
    const platform = { OS: "web" };
    const nativeFiles = [];
    const shared = [];
    let sharingAvailable = true;
    let shareFails = false;
    let deferDelete = false, releaseDelete;
    let deferWrite = false, releaseWrite, writeFails = false;
    class NativeFile {
      constructor(_cache, name) {
        this.uri = `file:///synthetic-cache/${name}`;
        this.exists = false;
        nativeFiles.push(this);
      }
      create() { this.exists = true; }
      write(csv) {
        assert.equal(this.exists, true);
        if (!deferWrite) {
          if (writeFails) return Promise.reject(new Error("write failed"));
          this.csv = csv;
          return Promise.resolve();
        }
        return new Promise(resolve => { releaseWrite = () => { this.csv = csv; resolve(); }; });
      }
      delete() {
        if (!deferDelete) { this.exists = false; return Promise.resolve(); }
        return new Promise(resolve => { releaseDelete = () => { this.exists = false; resolve(); }; });
      }
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
    const filename = src + ".compiled.cjs";
    const mod = new Module(filename);
    mod.filename = filename;
    mod.require = name => { assert.ok(Object.hasOwn(mocks, name), name); return mocks[name]; };
    mod.fixtureGlobals = {
      document: doc, URL: url,
      setTimeout: (fn, delay) => { if (delay === 1000) fn(); return 0; },
      clearTimeout: () => {},
    };
    mod._compile("const { document, URL, setTimeout, clearTimeout } = module.fixtureGlobals;\n" + source, filename);
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
    deferDelete = true;
    deferWrite = true;
    button().props.onPress();
    requests[3].resolve(result);
    await tick();
    assert.equal(shared.length, 0, "sharing must wait for completed native write");
    assert.equal(button().props.disabled, true);
    releaseWrite();
    deferWrite = false;
    await tick();
    assert.equal(shared.length, 1);
    assert.match(shared[0], /قهوة يمنية/);
    assert.equal(nativeFiles[0].exists, true, "cleanup deliberately pending");
    assert.equal(button().props.disabled, true, "delivery remains busy until cleanup completes");
    releaseDelete();
    await tick();
    deferDelete = false;
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
    assert.equal(buttons.length, 3);
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

    // User cancellation must abort an in-flight read without creating a file.
    button().props.onPress();
    const canceled = requests[9];
    const cancel = nodes(render()).find(n => n.props?.accessibilityLabel === "إلغاء تجهيز التصدير");
    assert.ok(cancel, "cancel must be available during collection");
    cancel.props.onPress();
    assert.equal(canceled.signal.aborted, true);
    assert.equal(button().props.disabled, false);
    assert.ok(nodes(render()).some(n => n.props?.children === "أُلغي التصدير. يمكنك إعادة المحاولة."));
    button().props.onPress();
    assert.equal(requests[10].signal.aborted, false);
    canceled.resolve(result);
    await tick();
    assert.equal(downloads.length, 3);
    assert.equal(button().props.disabled, true, "late canceled read must not clear the new attempt");
    requests[10].resolve(result);
    await tick();
    assert.equal(downloads.length, 4);
    assert.equal(nodes(render()).some(n => n.props?.accessibilityLabel === "إلغاء تجهيز التصدير"), false);
    const draftResult = { ...result, items: [{ ...offer, productActive: false, variantSellable: false, requiredAttributesValid: false }] };
    const draftButton = () => nodes(render()).find(n => n.props?.accessibilityLabel === "تصدير ملف تعديل المسودات CSV");
    assert.ok(draftButton(), "draft template action missing");
    draftButton().props.onPress();
    assert.deepEqual(requests.at(-1).options, { limit: 50 });
    requests.at(-1).resolve(draftResult);
    await tick();
    assert.equal(downloads.length, 5);
    assert.match(await downloads.at(-1).blob.text(), /^\uFEFF?name,price_yer,stock_units\r\n/);
    draftButton().props.onPress();
    requests.at(-1).resolve(result);
    await tick();
    assert.equal(downloads.length, 5, "no file for ineligible offers");
    cleanup();
    mounted = false; states.length = 0; refs.length = 0;
    platform.OS = "android"; sharingAvailable = true; shareFails = false;
    draftButton().props.onPress();
    requests.at(-1).resolve(draftResult);
    await tick();
    assert.match(shared.at(-1), /^\uFEFFname,price_yer,stock_units\r\n/);
    assert.equal(nativeFiles.at(-1).exists, false);

    const sharesBeforeFailure = shared.length;
    writeFails = true;
    draftButton().props.onPress();
    requests.at(-1).resolve(draftResult);
    await tick();
    assert.equal(shared.length, sharesBeforeFailure, "rejected write cannot share a file");
    assert.equal(nativeFiles.at(-1).exists, false, "rejected write cleans temporary file");
    assert.equal(draftButton().props.disabled, false, "failed write permits retry");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
