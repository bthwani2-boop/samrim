import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

test("finance route presentation remains explicitly unavailable without owner contracts", () => {
  for (const filename of ["earnings-summary.tsx","payout-recipients.tsx"]) {
    const source = readFileSync(resolve(import.meta.dirname, filename), "utf8");
    assert.match(source, /MerchantCapabilityScreen/);
    assert.doesNotMatch(source, /\bfetch\s*\(|\bsetItem\s*\(|\bmutate\s*\(/);
  }
});

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

function compileFinance(t) {
  const temp = mkdtempSync(resolve(tmpdir(), "merchant-finance-"));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const root = resolve(import.meta.dirname, "../../../../..");
  const result = spawnSync(process.execPath, [
    resolve(root, "node_modules/typescript/bin/tsc"),
    resolve(import.meta.dirname, "wallet-screen.tsx"),
    resolve(import.meta.dirname, "commercial-agreement.tsx"),
    "--ignoreConfig", "--noResolve", "--noCheck", "--target", "es2022",
    "--module", "commonjs", "--jsx", "react-jsx", "--outDir", temp,
  ], { cwd: root, encoding: "utf8", timeout: 20000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return temp;
}
function harness(temp) {
  const state = [], effects = [], requests = [];
  let index = 0;
  const jsx = (type, props, key) => ({ type, props, key });
  const mocks = {
    "react/jsx-runtime": { jsx, jsxs: jsx },
    react: {
      useState(initial) {
        const at = index++;
        if (!(at in state)) state[at] = initial;
        return [state[at], next => { state[at] = typeof next === "function" ? next(state[at]) : next; }];
      },
      useEffect(effect) { effects.push(effect); },
    },
    "react-native": { Text: "Text", View: "View", Pressable: "Pressable" },
    "@bthwani/tamagui-config/appearance": { useMobileAppearance: () => ({ theme: {} }) },
    "../../components/merchant-capability-screen": { __esModule: true, default: "Unavailable" },
    "./commercial-agreement": { __esModule: true, default: "Agreement" },
    "./commercial-agreement-transport": { readMerchantCommercialAgreement(actorId, storeId, signal) {
      return new Promise((resolve, reject) => requests.push({ actorId, storeId, signal, resolve, reject }));
    } },
  };
  const load = filename => {
    const mod = { exports: {} };
    new Function("require", "module", "exports", readFileSync(resolve(temp, filename), "utf8"))(
      name => { assert.ok(Object.hasOwn(mocks, name), name); return mocks[name]; }, mod, mod.exports);
    return mod.exports.default;
  };
  return { load, requests, effects, render(Component, props) { index = 0; effects.length = 0; return Component(props); } };
}
function nodes(tree) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
test("finance selection only exposes current actor and owned store; revocation hides it", t => {
  const h = harness(compileFinance(t));
  const Wallet = h.load("wallet-screen.js");
  const stores = [{ id: "store-a", name: "A" }, { id: "store-b", name: "B" }];
  const props = { actorId: "merchant-a", stores };
  const render = (next = props) => nodes(h.render(Wallet, next));
  assert.ok(!render().some(n => n.type === "Agreement"));
  render().find(n => n.props?.accessibilityLabel === "مالية متجر A").props.onPress();
  assert.deepEqual(render().find(n => n.type === "Agreement").props, { actorId: "merchant-a", storeId: "store-a" });
  assert.ok(!render({ ...props, stores: stores.slice(1) }).some(n => n.type === "Agreement"));
  assert.ok(!render({ ...props, actorId: "merchant-b" }).some(n => n.type === "Agreement"));
  assert.equal(h.render(Wallet, {}).type, "Unavailable");
});
test("proposal details preserve exact money, explicit pending activation and cancel stale read", async t => {
  const h = harness(compileFinance(t));
  const Agreement = h.load("commercial-agreement.js");
  assert.equal(h.render(Agreement, {}).type, "Unavailable");
  const props = { actorId: "merchant-a", storeId: "store-a" };
  const details = h.render(Agreement, props);
  const render = () => nodes(h.render(details.type, details.props));
  render();
  const cleanup = h.effects[0]();
  t.after(cleanup);
  assert.equal(h.requests[0].storeId, "store-a");
  assert.equal(h.requests[0].actorId, "merchant-a");
  h.requests[0].resolve({ storeId: "store-a", proposal: {
    version: 2, feeModel: "SUBSCRIPTION", subscriptionAmountYer: "9007199254740993", subscriptionPeriodDays: 30,
    storeRelation: "DIRECT", collector: "STORE_MANAGED", fulfillmentModes: ["CUSTOMER_PICKUP"],
    proposedEffectiveAt: "2027-01-01T00:00:00Z", reviewState: "REVIEW_APPROVED_PENDING_ACTIVATION",
  } });
  await new Promise(resolve => setImmediate(resolve));
  const texts = render().filter(n => n.type === "Text").map(n => n.props.children);
  assert.ok(texts.includes("الاشتراك: 9007199254740993 ريال يمني / 30 يوم"));
  assert.ok(texts.includes("الحالة: مراجَع، بانتظار التفعيل"));
  assert.ok(texts.includes("المقترح لا يعني اتفاقية نافذة أو رصيدًا مستحقًا."));
  cleanup();
  assert.equal(h.requests[0].signal.aborted, true);
});
