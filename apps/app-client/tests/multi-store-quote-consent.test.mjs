import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript-ast";

const source = fs.readFileSync(path.resolve(import.meta.dirname, "../src/features/multi-store-checkout/multi-store-checkout.tsx"), "utf8");
const ast = ts.createSourceFile("multi-store-checkout.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = [
  "isCheckoutFulfillmentMode",
  "parseDeliveryRecipient",
  "parseCheckoutChild",
  "parseCheckoutRequest",
  "parsePendingMultiStoreAttempt",
  "serializePendingMultiStoreAttempt",
];
const found = new Map();
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text)) found.set(node.name.text, node);
  ts.forEachChild(node, visit);
}
visit(ast);
for (const name of names) assert.ok(found.has(name), `missing production guard: ${name}`);
const compiled = ts.transpileModule(names.map((name) => found.get(name).getText(ast)).join("\n"), {
  compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
}).outputText;
const api = vm.runInNewContext(`${compiled}\n({parseCheckoutChild,parsePendingMultiStoreAttempt,serializePendingMultiStoreAttempt})`);

const child = (amount = 2100) => ({
  cartId: "cart-1", storeId: "store-1", addressId: "",
  cartVersion: 2, fulfillmentMode: "CUSTOMER_PICKUP", expectedTotalAmountMinor: amount,
  recipient: { mode: "SELF" },
});
const valid = { version: 3, kind: "CREATE", actorID: "client-one", idempotencyKey: "multi-key-123", correlationID: "multi-corr-123", request: { id: "multi-1", children: [child(2100), { ...child(3500), cartId: "cart-2", storeId: "store-2" }] } };

test("v3 pending attempt retains both accepted child amounts and original idempotency facts", () => {
  const raw = api.serializePendingMultiStoreAttempt(valid);
  const parsed = api.parsePendingMultiStoreAttempt(raw, valid.actorID);
  assert.equal(parsed.kind, "CREATE");
  assert.equal(parsed.version, 3);
  assert.deepEqual(Array.from(parsed.request.children, (item) => item.expectedTotalAmountMinor), [2100, 3500]);
  assert.equal(parsed.idempotencyKey, valid.idempotencyKey);
  assert.equal(parsed.correlationID, valid.correlationID);
});

test("v1/v2 historical pending attempts remain readback-only, not chargeable", () => {
  const legacy = { version: 2, kind: "CREATE", actorID: "client-one", idempotencyKey: "multi-key-123", correlationID: "multi-corr-123", request: ["multi-1", [["cart-1", "store-1", "", 2, "CUSTOMER_PICKUP", { mode: "SELF" }]]] };
  const parsed = api.parsePendingMultiStoreAttempt(JSON.stringify(legacy), valid.actorID);
  assert.equal(parsed.kind, "LEGACY_CREATE");
  assert.equal(parsed.checkoutID, "multi-1");
  assert.equal("request" in parsed, false, "legacy consent must not be synthesized");
  assert.equal(api.parsePendingMultiStoreAttempt(JSON.stringify({ ...legacy, version: 1, request: { id: "multi-1", children: [] } }), valid.actorID).kind, "LEGACY_CREATE");
  assert.equal(api.parsePendingMultiStoreAttempt(JSON.stringify(legacy), "different-client"), null);
});

test("missing, malformed and nonpositive accepted totals are rejected before retry", () => {
  for (const amount of [undefined, null, 0, -1, 2.5, "2100", Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(api.parseCheckoutChild({ ...child(), expectedTotalAmountMinor: amount }, false), null, String(amount));
  }
  assert.equal(api.parseCheckoutChild(child(2100), false).expectedTotalAmountMinor, 2100);
  assert.equal(api.parseCheckoutChild(["cart-1", "store-1", "", 2, "CUSTOMER_PICKUP", { mode: "SELF" }], true), null, "legacy compact facts lack accepted amount");
});

test("UI does not create a parent before customer sees the complete per-store quoted total", () => {
  const start = source.indexOf("async function submit()");
  const end = source.indexOf('if (state.kind === "loading")', start);
  const submit = source.slice(start, end);
  const preview = submit.indexOf("setQuotePreview({ fingerprint, children: quotes, totalAmountMinor })");
  const persist = submit.indexOf("SecureStore.setItemAsync(");
  const create = submit.indexOf("createMultiStoreCheckout(");
  assert.ok(preview >= 0 && persist > preview && create > persist);
  assert.match(submit, /quoteMultiStoreChildCheckout\(/);
  assert.match(submit, /if \(!quotePreview \|\| quotePreview\.fingerprint !== fingerprint\)/);
  assert.match(submit, /STALE_MULTI_STORE_ACCEPTED_QUOTE/);
  assert.match(submit, /if \(submitInFlight\.current \|\| busy/);
  assert.ok(submit.indexOf("submitInFlight.current = true") < submit.indexOf("SecureStore.setItemAsync("), "single-flight lock precedes durable mutation");
  assert.match(submit, /finally \{\s*submitInFlight\.current = false;/);
  assert.match(source, /label=\{quotePreview \? "[^"]+" : "[^"]+"\}/, "confirming a displayed quote has a distinct action label");
});

test("parent checkout cancellation remains restricted and a historical pending cancel is readback-only", () => {
  assert.doesNotMatch(source, /cancelMultiStoreCheckout\s*\(/);
  assert.doesNotMatch(source, /async function cancel\s*\(/);
  assert.doesNotMatch(source, /label="إلغاء الطلبات التابعة"/);
  assert.match(source, /يُقيّم إلغاء كل طلب تابع بشكل مستقل/);
  assert.match(source, /افتح تفاصيله للإلغاء قبل قبول المتجر/);
  const legacy = {
    version: 3, kind: "CANCEL", actorID: "client-1",
    checkoutID: "parent-1", expectedVersion: 2,
    idempotencyKey: "legacy-cancel-12345",
    correlationID: "legacy-cancel-correlation",
  };
  const restored = api.parsePendingMultiStoreAttempt(JSON.stringify(legacy), "client-1");
  assert.equal(restored?.kind, "LEGACY_CREATE", "old cancel receipt may be read but must not retry mutation");
  assert.equal(restored.checkoutID, legacy.checkoutID);
});
