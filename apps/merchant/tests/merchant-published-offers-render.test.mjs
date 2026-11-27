import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const sourceFile = fileURLToPath(new URL("../src/features/catalog/merchant-published-offers.tsx", import.meta.url));

function nodes(tree) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}

function store(id, name) {
  return { id, name, published: true };
}

test("Merchant published-offer search uses live owner query, aborts stale requests and scopes by actor/Store", async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), "bthwani-merchant-search-"));
  try {
    const output = spawnSync(process.execPath, [
      path.join(root, "node_modules/@typescript/native/bin/tsc"), sourceFile,
      "--ignoreConfig", "--noResolve", "--noCheck", "--target", "es2022",
      "--module", "commonjs", "--jsx", "react-jsx", "--outDir", tmp,
    ], { cwd: root, encoding: "utf8", timeout: 20_000, windowsHide: true });
    assert.equal(output.status, 0, output.stderr || output.stdout);
    const compiled = readFileSync(path.join(tmp, "merchant-published-offers.js"), "utf8");
    const hooks = [];
    const effectState = [];
    const requests = [];
    let index = 0;
    let effects = [];
    const react = {
      useState(initial) {
        const at = index++;
        if (!(at in hooks)) hooks[at] = initial;
        return [hooks[at], value => {
          hooks[at] = typeof value === "function" ? value(hooks[at]) : value;
        }];
      },
      useRef(initial) {
        const at = index++;
        if (!(at in hooks)) hooks[at] = { current: initial };
        return hooks[at];
      },
      useEffect(callback, deps) {
        const at = index++;
        const previous = effectState[at];
        if (!previous || deps.some((value, i) => value !== previous.deps[i])) {
          effects.push(() => {
            previous?.cleanup?.();
            effectState[at] = { deps, cleanup: callback() };
          });
        }
      },
    };
    const jsx = (type, props) => ({ type, props: props ?? {} });
    const mocks = {
      "@bthwani/dsh": {
        listPublicOffers(origin, storeId, options) {
          const request = { origin, storeId, options };
          requests.push(request);
          return new Promise((resolve, reject) => { request.resolve = resolve; request.reject = reject; });
        },
      },
      "@bthwani/tamagui-config/appearance": {
        useMobileAppearance: () => ({ theme: {
          surface: "surface", color: "text", colorSecondary: "muted",
          interactiveText: "link", actionSoft: "selected", warningText: "warning", borderColor: "border",
        } }),
      },
      react,
      "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
      "react-native": {
        ActivityIndicator: "ActivityIndicator", Platform: { OS: "web" },
        Pressable: "Pressable", Text: "Text", TextInput: "TextInput", View: "View",
      },
    };
    const module = { exports: {} };
    const previousWindow = globalThis.window;
    let focusListener;
    globalThis.window = {
      location: { origin: "http://localhost:18102" },
      addEventListener(type, listener) {
        if (type === "focus") focusListener = listener;
      },
      removeEventListener(type, listener) {
        if (type === "focus" && focusListener === listener) focusListener = null;
      },
    };
    try {
      new Function("require", "module", "exports", compiled)(name => {
        assert.ok(Object.hasOwn(mocks, name), ["unexpected dependency ", name].join(""));
        return mocks[name];
      }, module, module.exports);
      function render(actorId, stores) {
        index = 0;
        effects = [];
        const view = module.exports.default({ actorId, stores });
        for (const effect of effects) effect();
        return view;
      }
      const stores = [store("store-one", "متجر أول"), store("store-two", "متجر ثان")];
      let tree = render("actor-one", stores);
      assert.equal(requests.length, 1);
      assert.equal(requests[0].storeId, "store-one");
      assert.equal(requests[0].origin, "http://localhost:18102");
      assert.equal(requests[0].options.query, undefined);

      const input = nodes(tree).find(n => n.props?.testID === "merchant-offers-search");
      assert.ok(input, "search input must be visible");
      input.props.onChangeText("ماء");
      tree = render("actor-one", stores);
      nodes(tree).find(n => n.props?.testID === "merchant-offers-search").props.onSubmitEditing();
      tree = render("actor-one", stores);
      assert.equal(requests.length, 2);
      assert.equal(requests[0].options.signal.aborted, true);
      assert.equal(requests[1].options.query, "ماء");
      assert.equal(requests[1].storeId, "store-one");

      const secondStore = nodes(tree).find(n =>
        n.type === "Pressable" && n.props?.children?.props?.children === "متجر ثان");
      assert.ok(secondStore);
      secondStore.props.onPress();
      tree = render("actor-one", stores);
      assert.equal(requests.length, 3);
      assert.equal(requests[1].options.signal.aborted, true);
      assert.equal(requests[2].storeId, "store-two");
      assert.equal(requests[2].options.query, "ماء");
      assert.equal(requests[2].options.cursor, undefined);

      requests[0].resolve({ items: [{ id: "old", name: "غير مسموح", priceYer: 1 }],
        revision: 1 });
      requests[1].resolve({ items: [{ id: "stale", name: "نتيجة قديمة", priceYer: 1 }],
        revision: 1 });
      await Promise.resolve();
      await Promise.resolve();
      tree = render("actor-one", stores);
      assert.ok(!nodes(tree).some(n => n.props?.children === "نتيجة قديمة"));

      requests[2].resolve({ items: [{ id: "fresh", name: "ماء", priceYer: 150 }],
        revision: 3 });
      await Promise.resolve();
      await Promise.resolve();
      tree = render("actor-one", stores);
      assert.ok(nodes(tree).some(n => n.props?.children === "ماء"));

      tree = render("actor-two", []);
      assert.equal(requests.length, 3, "no owner request without a verified Store");
      assert.ok(!nodes(tree).some(n => n.props?.children === "ماء"),
        "old actor's catalogue is never displayed");

      tree = render("actor-one", stores);
      assert.equal(requests.length, 4);
      assert.ok(!nodes(tree).some(n => n.props?.children === "تحديث المنتجات"),
        "a permanent refresh button must not be rendered");
      assert.ok(focusListener, "return to the browser must be observed");
      focusListener();
      tree = render("actor-one", stores);
      assert.equal(requests.length, 5, "return to browser refetches owner-backed products");
      assert.equal(requests[3].options.signal.aborted, true,
        "return refresh aborts the prior request");
    } finally {
      if (previousWindow === undefined) delete globalThis.window;
      else globalThis.window = previousWindow;
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
