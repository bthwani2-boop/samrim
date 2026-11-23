import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { DshCartError } from "@bthwani/dsh";
import { formatExactYer } from "../src/components/format-exact-yer.ts";
import { summarizeCartPreview } from "../src/features/cart/cart-preview.ts";
import { pendingCartChange, withPendingCartChange } from "../src/features/cart/cart-session.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const source = path.join(root, "apps/customer/src/features");
const temp = mkdtempSync(path.join(tmpdir(), "bthwani-store-cart-"));
const files = ["cart/use-store-cart", "catalog/store-products", "catalog/product-detail"];
let compiled;
try {
  const result = spawnSync(process.execPath, [path.join(root, "node_modules/typescript/bin/tsc"),
    path.join(source, "cart/use-store-cart.ts"), ...files.slice(1).map(file => path.join(source, `${file}.tsx`)),
    "--ignoreConfig", "--noResolve", "--noCheck", "--target", "es2022", "--module", "commonjs", "--jsx", "react-jsx",
    "--rootDir", source, "--outDir", temp], { cwd: root, encoding: "utf8", timeout: 20000, windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  compiled = files.map(file => readFileSync(path.join(temp, `${file}.js`), "utf8"));
} finally { rmSync(temp, { recursive: true, force: true }); }

const jsx = (type, props) => ({ type, props });
const modules = {
  "@bthwani/tamagui-config/appearance": { useMobileAppearance: () => ({ theme: {} }) },
  "@bthwani/dsh": { DshCartError },
  "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
  "react-native": { Pressable: "Pressable", Text: "Text", View: "View" },
  "./cart-session": { pendingCartChange },
  "./product-detail": { default: "ProductDetail" },
  "./product-variants": { default: "ProductVariantPrice" },
  "../../components/format-exact-yer": { formatExactYer },
  "../cart/cart-preview": { summarizeCartPreview },
};
function load(sourceCode, overrides = {}) {
  const mod = { exports: {} };
  new Function("require", "module", "exports", sourceCode)(key => {
    const module = overrides[key] ?? modules[key];
    assert.ok(module, `unexpected import ${key}`);
    return module;
  }, mod, mod.exports);
  return mod.exports;
}

const store = { id: "store-a", orderabilityStatus: "OPERATIONALLY_UNAVAILABLE" };
const offer = { id: "water", storeId: store.id, variantId: "water-v", name: "ماء", available: true, priceYer: 150 };
const ownerLine = { offerId: offer.id, variantId: offer.variantId, quantity: 1, previewUnitYer: "175", previewAvailable: true };
const emptyCart = { actorId: "customer-a", storeId: store.id, version: 4, lines: [] };
const settle = () => new Promise(setImmediate);

test("first tap sends quantity one, shows only the owner-confirmed result, and minus removes the last item", async () => {
  const hooks = [];
  const writes = [];
  let index = 0;
  let generated = 0;
  let start;
  const react = {
    useState(initial) {
      const at = index++;
      if (!(at in hooks)) hooks[at] = initial;
      return [hooks[at], value => { hooks[at] = typeof value === "function" ? value(hooks[at]) : value; }];
    },
    useRef(initial) {
      const at = index++;
      hooks[at] ??= { current: initial };
      return hooks[at];
    },
    useCallback(callback) { return callback; },
  };
  const { useStoreCart } = load(compiled[0], {
    react,
    "expo-crypto": { randomUUID: () => `test-operation-${++generated}` },
    "expo-router": { useFocusEffect(callback) { start = callback; } },
    "./cart-transport": {
      readVerifiedCart: async () => ({ kind: "ready", cart: emptyCart }),
      replaceVerifiedCart: (storeId, change, actorId) => withPendingCartChange(actorId, storeId, change,
        original => new Promise((resolve, reject) => writes.push({ original, resolve, reject }))),
    },
  });
  function render() {
    index = 0;
    // biome-ignore lint/correctness/useHookAtTopLevel: This fixture runs the hook under an ordered mock React renderer.
    return useStoreCart(store.id);
  }
  render();
  const cleanup = start();
  try {
    await settle();
    render().adjust(offer, 1);
    render().adjust(offer, 1);
    assert.equal(writes.length, 1);
    assert.deepEqual(writes[0].original.lines, [{ offerId: offer.id, quantity: 1 }]);
    assert.equal(writes[0].original.expectedVersion, 4);
    assert.deepEqual(render().cart.lines, []);

    writes[0].reject(new DshCartError(0, "OPERATION_RESULT_UNKNOWN"));
    await settle();
    assert.equal(render().pending, true);
    assert.deepEqual(render().cart.lines, []);
    render().confirm();
    assert.equal(writes[1].original, writes[0].original);
    writes[1].resolve({ cart: { ...emptyCart, version: 5, lines: [ownerLine] }, replay: true });
    await settle();
    assert.deepEqual(render().cart.lines, [ownerLine]);

    render().adjust(offer, 1);
    assert.equal(writes[2].original.expectedVersion, 5);
    assert.deepEqual(writes[2].original.lines, [{ offerId: offer.id, quantity: 2 }]);
    assert.notEqual(writes[2].original.operationId, writes[0].original.operationId);
    writes[2].resolve({ cart: { ...emptyCart, version: 6, lines: [{ ...ownerLine, quantity: 2 }] }, replay: false });
    await settle();

    render().adjust(offer, -1);
    assert.deepEqual(writes[3].original.lines, [{ offerId: offer.id, quantity: 1 }]);
    writes[3].resolve({ cart: { ...emptyCart, version: 7, lines: [ownerLine] }, replay: false });
    await settle();

    render().adjust(offer, -1);
    assert.equal(writes[4].original.expectedVersion, 7);
    assert.deepEqual(writes[4].original.lines, []);
    writes[4].resolve({ cart: { ...emptyCart, version: 8 }, replay: false });
    await settle();
    assert.deepEqual(render().cart.lines, []);
  } finally { cleanup(); }
});

test("only a verified draft shows card actions, plus and minus replace add, and the bar uses the owner price", () => {
  const { default: StoreProducts, StoreCartBar } = load(compiled[1], { "expo-router": { Link: "Link" } });
  const { default: ProductDetail } = load(compiled[2]);
  const calls = [];
  const session = { cart: null, busy: false, pending: false, message: "", adjust: (...args) => calls.push(args) };
  const card = (storeStatus = store.orderabilityStatus) => StoreProducts({
    offers: [offer], store: { ...store, orderabilityStatus: storeStatus }, session,
  }).props.children[0].props;

  assert.equal(card().onAdjust, undefined);
  session.cart = emptyCart;
  assert.equal(card("PAUSED").onAdjust, undefined);
  assert.equal(card("CLOSED_BY_SCHEDULE").onAdjust, undefined);
  ProductDetail(card()).props.children[1].props.onPress();
  assert.deepEqual(calls, [[offer, 1]]);

  session.cart = { ...emptyCart, lines: [ownerLine] };
  const updated = ProductDetail(card());
  assert.equal(card().quantity, 1);
  assert.equal(card().offer.priceYer, "175");
  const stepper = updated.props.children[1].props.children;
  assert.equal(stepper.length, 3);
  stepper[0].props.onPress();
  stepper[2].props.onPress();
  assert.deepEqual(calls.slice(1), [[offer, -1], [offer, 1]]);

  const bar = StoreCartBar({ storeId: store.id, session });
  const subtotal = bar.props.children[2].props.children.props.children[1].props.children;
  assert.equal(subtotal, `${formatExactYer(175n)} ريال يمني`);
  assert.equal(StoreCartBar({ storeId: store.id, session: { ...session, cart: emptyCart } }), null);
});
