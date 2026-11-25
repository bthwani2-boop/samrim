import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { publicStorefrontLink } from "../src/features/stores/public-storefront-link.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const component = fileURLToPath(new URL("../src/features/stores/merchant-public-link.tsx", import.meta.url));

function nodes(tree) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}

test("Merchant link uses Customer's canonical public path and rejects forged origins", () => {
  for (const id of ["market-sanaa", "shop-42", "store-1"]) {
    assert.equal(publicStorefrontLink(id), null, "relative Merchant links are not Customer share URLs");
    assert.equal(publicStorefrontLink(id, "https://customer.example"), `https://customer.example/storefront/${id}`);
    assert.equal(publicStorefrontLink(id, "http://127.0.0.1:18101"), `http://127.0.0.1:18101/storefront/${id}`);
  }
  for (const id of ["", "../danger", "UPPER", " a", "%2F", "a/b", "a".repeat(65)]) {
    assert.equal(publicStorefrontLink(id), null);
  }
  for (const origin of [
    "http://customer.example", "https://customer.example.evil/path",
    "https://customer.example/?redirect=https://evil.example",
    "https://user:password@customer.example", "https://customer.example#h",
    "javascript:alert(1)", "//customer.example",
  ]) assert.equal(publicStorefrontLink("shop-42", origin), null, origin);
  const customer = readFileSync(new URL("../../customer/src/features/sharing/store-share.ts", import.meta.url), "utf8");
  assert.match(customer, /\x60\/storefront\/\$\{encodeURIComponent\(value\)\}\x60/);
});

test("Merchant copies only after fresh DSH publication proof; actor/Store switch cancels stale copy", async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), "bthwani-merchant-share-"));
  const previousOrigin = process.env.EXPO_PUBLIC_BTHWANI_CUSTOMER_WEB_ORIGIN;
  const previousWindow = globalThis.window;
  process.env.EXPO_PUBLIC_BTHWANI_CUSTOMER_WEB_ORIGIN = "https://customer.example";
  globalThis.window = { location: { origin: "http://localhost:18102" } };
  try {
    const compiled = spawnSync(process.execPath, [
      path.join(root, "node_modules/typescript/bin/tsc"), component,
      "--ignoreConfig", "--noResolve", "--noCheck", "--target", "es2022",
      "--module", "commonjs", "--jsx", "react-jsx", "--outDir", tmp,
    ], { cwd: root, encoding: "utf8", timeout: 20_000, windowsHide: true });
    assert.equal(compiled.status, 0, compiled.stderr || compiled.stdout);
    const code = readFileSync(path.join(tmp, "merchant-public-link.js"), "utf8");
    let index = 0;
    let effects = [];
    const hooks = [];
    const effectState = [];
    const requests = [];
    const copied = [];
    let clipboardSucceeds = true;
    let clipboardRejects = false;
    const react = {
      useState(initial) {
        const at = index++;
        if (!(at in hooks)) hooks[at] = initial;
        return [hooks[at], value => { hooks[at] = typeof value === "function" ? value(hooks[at]) : value; }];
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
      "@bthwani/dsh": { getPublicStore(origin, id, signal) {
        const request = { origin, id, signal };
        requests.push(request);
        return new Promise((resolve, reject) => { request.resolve = resolve; request.reject = reject; });
      } },
      "@bthwani/tamagui-config/appearance": { useMobileAppearance: () => ({ theme: {
        surface: "surface", borderColor: "border", color: "color",
        colorSecondary: "muted", interactiveText: "action", warningText: "warning",
      } }) },
      "expo-clipboard": { setStringAsync: async value => {
        if (clipboardRejects) throw new Error("clipboard unavailable");
        if (clipboardSucceeds) copied.push(value);
        return clipboardSucceeds;
      } },
      "./public-storefront-link": { publicStorefrontLink },
      react,
      "react/jsx-runtime": { jsx, jsxs: jsx },
      "react-native": { Platform: { OS: "web" }, Pressable: "Pressable", Text: "Text", View: "View" },
    };
    const mod = { exports: {} };
    new Function("require", "module", "exports", code)(
      name => { assert.ok(Object.hasOwn(mocks, name), name); return mocks[name]; }, mod, mod.exports,
    );
    function render(actorId, storeId, published = true) {
      index = 0;
      effects = [];
      const tree = mod.exports.default({ actorId, storeId, published });
      for (const effect of effects) effect();
      return tree;
    }
    const action = tree => nodes(tree).find(n =>
      n.type === "Pressable" && n.props?.accessibilityLabel === "نسخ رابط المتجر العام");

    let tree = render("actor-a", "store-one");
    assert.ok(action(tree));
    action(tree).props.onPress();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].origin, "http://localhost:18102");
    assert.equal(requests[0].id, "store-one");
    assert.deepEqual(copied, []);

    tree = render("actor-b", "store-two");
    assert.equal(requests[0].signal.aborted, true);
    requests[0].resolve({ id: "store-one" });
    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(copied, [], "older actor's link must never be copied");

    tree = render("actor-b", "store-two");
    action(tree).props.onPress();
    assert.equal(requests.length, 2);
    requests[1].resolve({ id: "store-two" });
    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(copied, ["https://customer.example/storefront/store-two"]);
    const notice = view => nodes(view).find(n => n.props?.accessibilityLiveRegion === "polite")?.props.children;
    assert.equal(notice(render("actor-b", "store-two")), "تم نسخ رابط المتجر المنشور.");

    tree = render("actor-b", "draft-store", false);
    assert.equal(action(tree), undefined, "draft Store has no share action");
    assert.equal(requests.length, 2);

    tree = render("actor-b", "store-three");
    action(tree).props.onPress();
    requests[2].reject(new Error("DSH no longer publishes Store"));
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(copied.length, 1, "denied public Store must not be shared");

    clipboardSucceeds = false;
    tree = render("actor-b", "store-three");
    action(tree).props.onPress();
    requests[3].resolve({ id: "store-three" });
    await Promise.resolve(); await Promise.resolve();
    assert.equal(copied.length, 1);
    assert.equal(notice(render("actor-b", "store-three")), "تعذّر نسخ الرابط إلى الحافظة. أعد المحاولة.");

    clipboardRejects = true;
    tree = render("actor-b", "store-three");
    action(tree).props.onPress();
    requests[4].resolve({ id: "store-three" });
    await Promise.resolve(); await Promise.resolve();
    assert.equal(copied.length, 1);
    assert.equal(notice(render("actor-b", "store-three")), "تعذّر نسخ الرابط إلى الحافظة. أعد المحاولة.");

    clipboardRejects = false;
    clipboardSucceeds = true;
    tree = render("actor-b", "store-three");
    action(tree).props.onPress();
    requests[5].resolve({ id: "store-three" });
    await Promise.resolve(); await Promise.resolve();
    assert.equal(copied.at(-1), "https://customer.example/storefront/store-three");
    assert.equal(notice(render("actor-b", "store-three")), "تم نسخ رابط المتجر المنشور.");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
    if (previousOrigin === undefined) delete process.env.EXPO_PUBLIC_BTHWANI_CUSTOMER_WEB_ORIGIN;
    else process.env.EXPO_PUBLIC_BTHWANI_CUSTOMER_WEB_ORIGIN = previousOrigin;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});
