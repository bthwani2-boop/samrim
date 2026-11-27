import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadMappedRenderFixture } from "../../../../../tools/dev/mapped-render-fixture.mjs";
import * as sharing from "./store-share.ts";

test("public share destination is canonical and excludes query and private context", () => {
  assert.equal(typeof sharing.publicStorefrontShareUrl, "function");
  assert.equal(sharing.publicStorefrontShareUrl("store-a", "https://customer.example"), "https://customer.example/storefront/store-a");
  assert.equal(sharing.publicStorefrontShareUrl("store-a", "http://localhost:18101"), "http://localhost:18101/storefront/store-a");
  for (const origin of ["", "javascript:alert(1)", "http://customer.example", "https://user:password@customer.example", "https://customer.example/private", "https://customer.example/?actorId=secret", "https://customer.example/#private"]) {
    assert.equal(sharing.publicStorefrontShareUrl("store-a", origin), null);
  }
  assert.equal(sharing.publicStorefrontShareUrl("../private", "https://customer.example"), null);
});

test("sharing rechecks exact current public Store and never returns a private or wrong-Store destination", async () => {
  assert.equal(typeof sharing.verifyStorefrontShare, "function");
  const controller = new AbortController();
  const origin = "https://customer.example";
  let reads = 0;
  const read = async (id, signal) => {
    reads++;
    assert.equal(id, "store-a");
    assert.equal(signal, controller.signal);
    return { id };
  };
  assert.equal(await sharing.verifyStorefrontShare("store-a", origin, read, controller.signal), `${origin}/storefront/store-a`);
  assert.equal(reads, 1);
  await assert.rejects(sharing.verifyStorefrontShare("store-a", origin, async () => ({ id: "store-b" }), controller.signal));
  await assert.rejects(sharing.verifyStorefrontShare("store-a", origin, async () => { throw new Error("NOT_FOUND"); }, controller.signal));
  assert.equal(await sharing.verifyStorefrontShare("../private", origin, read, controller.signal), null);
  assert.equal(reads, 1);
  const pending = sharing.verifyStorefrontShare("store-a", origin, async () => {
    controller.abort();
    return { id: "store-a" };
  }, controller.signal);
  await assert.rejects(pending);
});

const retainedFixtures = [];
process.once("exit", () => retainedFixtures.length);

test("Web clipboard and Android share receive only a freshly verified canonical public destination", async t => {
  const root = path.resolve(import.meta.dirname, "../../../../..");
  const source = fileURLToPath(new URL("./store-share-button.tsx", import.meta.url));
  const temp = mkdtempSync(path.join(tmpdir(), "bth-customer-share-"));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const result = spawnSync(process.execPath, [path.join(root, "node_modules/@typescript/native/bin/tsc"), source,
    "--ignoreConfig", "--noResolve", "--noCheck", "--target", "es2022", "--module", "commonjs",
    "--jsx", "react-jsx", "--inlineSourceMap", "--inlineSources", "--outDir", temp],
  { cwd: root, encoding: "utf8", timeout: 20000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const code = readFileSync(path.join(temp, "store-share-button.js"), "utf8");
  const priorOrigin = process.env.EXPO_PUBLIC_BTHWANI_CUSTOMER_WEB_ORIGIN;
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const clipboard = [];
  const native = [];
  process.env.EXPO_PUBLIC_BTHWANI_CUSTOMER_WEB_ORIGIN = "https://customer.example";
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { async writeText(url) { clipboard.push(url); } } } });
  t.after(() => {
    if (priorOrigin === undefined) delete process.env.EXPO_PUBLIC_BTHWANI_CUSTOMER_WEB_ORIGIN;
    else process.env.EXPO_PUBLIC_BTHWANI_CUSTOMER_WEB_ORIGIN = priorOrigin;
    if (navigatorDescriptor) Object.defineProperty(globalThis, "navigator", navigatorDescriptor);
    else delete globalThis.navigator;
  });
  const nodes = node => Array.isArray(node) ? node.flatMap(nodes) :
    node && typeof node === "object" ? [node, ...nodes(node.props?.children)] : [];
  function mount(os) {
    const hooks = [], requests = [];
    let index = 0, cleanup;
    const jsx = (type, props) => ({ type, props });
    const mod = loadMappedRenderFixture(code, source, {
      "@bthwani/dsh": { getPublicStore: (origin, id, signal) => new Promise((resolve, reject) => requests.push({ origin, id, signal, resolve, reject })) },
      "@bthwani/tamagui-config/appearance": { useMobileAppearance: () => ({ theme: {} }) },
      "./store-share": sharing,
      "react/jsx-runtime": { jsx, jsxs: jsx },
      react: {
        useState(initial) { const at = index++; hooks[at] ??= initial; return [hooks[at], value => { hooks[at] = value; }]; },
        useRef(initial) { const at = index++; hooks[at] ??= { current: initial }; return hooks[at]; },
        useEffect(fn) { index++; if (!cleanup) cleanup = fn(); },
      },
      "react-native": { Platform: { OS: os }, Share: { async share(value) { native.push(value); } }, Pressable: "Pressable", Text: "Text", View: "View" },
    });
    retainedFixtures.push(mod);
    return { requests, unmount: () => cleanup?.(), render() {
      index = 0;
      return mod.exports.default({ storeId: "store-a", ownerOrigin: "http://127.0.0.1:18101" });
    } };
  }
  const action = app => nodes(app.render()).find(node => node.props.testID === "customer-share-store");
  const settle = () => new Promise(resolve => setImmediate(resolve));
  const web = mount("web");
  action(web).props.onPress();
  action(web).props.onPress();
  assert.equal(web.requests.length, 1);
  assert.equal(web.requests[0].id, "store-a");
  assert.deepEqual(clipboard, []);
  web.requests[0].reject(new Error("NOT_FOUND"));
  await settle();
  assert.deepEqual(clipboard, []);
  assert.match(JSON.stringify(web.render()), /لم تتم مشاركة الرابط/);
  action(web).props.onPress();
  web.requests[1].resolve({ id: "store-b" });
  await settle();
  assert.deepEqual(clipboard, []);
  action(web).props.onPress();
  web.requests[2].resolve({ id: "store-a" });
  await settle();
  assert.deepEqual(clipboard, ["https://customer.example/storefront/store-a"]);
  action(web).props.onPress();
  web.unmount();
  assert.equal(web.requests[3].signal.aborted, true);
  web.requests[3].resolve({ id: "store-a" });
  await settle();
  assert.equal(clipboard.length, 1);
  const android = mount("android");
  action(android).props.onPress();
  assert.deepEqual(native, []);
  android.requests[0].resolve({ id: "store-a" });
  await settle();
  assert.deepEqual(native, [{ message: "https://customer.example/storefront/store-a" }]);
  android.unmount();
});
