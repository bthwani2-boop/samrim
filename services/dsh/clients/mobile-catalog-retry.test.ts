import assert from "node:assert/strict";
import { register } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

register(pathToFileURL(path.resolve(import.meta.dirname, "../../../packages/design-system/tools/ts-resolver.mjs")).href, import.meta.url);
const { createDshMobileClient } = await import("./mobile.ts");

test("Field barcode-free product creation reuses the same request key after an uncertain network failure", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ path: string; headers: Headers; body: Record<string, unknown> }> = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ path: new URL(String(input)).pathname, headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    if (calls.length === 1) throw new TypeError("network disconnected after send");
    return new Response(JSON.stringify({ product: { id: "stored-product", variants: [{ id: "stored-variant" }] }, idempotentReplay: true }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const client = createDshMobileClient("https://dsh.example.test", { cryptoRandomUUID: () => "fresh-unexpected-key" });
    const product = { canonicalName: "وجبة دجاج", variantTitle: "الافتراضي", description: "", measurementKind: "DISCRETE" as const, baseUnit: "COUNT" as const };
    await assert.rejects(client.createFieldCatalogProduct("field-token", "joining-case-1", product, "field-stable-key", "field-correlation-1"), (err: unknown) => (err as { kind?: string }).kind === "network");
    const retried = await client.createFieldCatalogProduct("field-token", "joining-case-1", product, "field-stable-key", "field-correlation-1");
    assert.equal(retried.product.id, "stored-product");
    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.path, "/dsh/field/joining-cases/joining-case-1/catalog/products");
    assert.equal(calls[1]?.path, calls[0]?.path);
    for (const call of calls) {
      assert.equal(call.headers.get("Idempotency-Key"), "field-stable-key");
      assert.equal(call.headers.get("X-Correlation-ID"), "field-correlation-1");
      assert.equal(call.body.identifierType, undefined);
      assert.equal(call.body.identifierValue, undefined);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Partner product creation preserves the caller retry key and isolates the intended Store", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ path: string; headers: Headers; body: Record<string, unknown> }> = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ path: new URL(String(input)).pathname, headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    return new Response(JSON.stringify({ product: { id: "store-product", variants: [{ id: "v1" }] }, idempotentReplay: calls.length > 1 }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const client = createDshMobileClient("https://dsh.example.test", { cryptoRandomUUID: () => "unwanted-auto-key" });
    const product = { canonicalName: "ساندويتش", variantTitle: "الافتراضي", verticalId: "restaurant", scope: "STORE_SCOPED" as const, storeId: "store-01", measurementKind: "DISCRETE" as const, baseUnit: "COUNT" as const, categoryIds: [] };
    const first = await client.createStoreScopedProduct("partner-token", "store-01", product, "partner-stable-key", "partner-correlation");
    const retry = await client.createStoreScopedProduct("partner-token", "store-01", product, "partner-stable-key", "partner-correlation");
    assert.equal(first.idempotentReplay, false);
    assert.equal(retry.idempotentReplay, true);
    assert.equal(calls.length, 2);
    for (const call of calls) {
      assert.equal(call.path, "/dsh/stores/store-01/products");
      assert.equal(call.body.storeId, "store-01");
      assert.equal(call.body.scope, "STORE_SCOPED");
      assert.equal(call.headers.get("Idempotency-Key"), "partner-stable-key");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Partner StoreOffer creation replays the same key and quantities without duplicating client mutations", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ path: string; headers: Headers; body: Record<string, unknown> }> = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ path: new URL(String(input)).pathname, headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    return new Response(JSON.stringify({ offer: { offerId: "offer-01", version: 1 }, idempotentReplay: calls.length > 1 }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const client = createDshMobileClient("https://dsh.example.test", { cryptoRandomUUID: () => "fresh-other-key" });
    const create = () => client.createStoreOffer("token", "store-01", "variant-01", 2500, "DISCRETE", "PER_UNIT", 1, 20, 1, 1, "AVAILABILITY_ONLY", 0, "offer-stable-key", "offer-correlation");
    const first = await create();
    const retry = await create();
    assert.equal(first.offer.offerId, "offer-01");
    assert.equal(retry.offer.offerId, first.offer.offerId);
    assert.equal(calls.length, 2);
    for (const call of calls) {
      assert.equal(call.path, "/dsh/stores/store-01/offers");
      assert.equal(call.headers.get("Idempotency-Key"), "offer-stable-key");
      assert.equal(call.headers.get("X-Correlation-ID"), "offer-correlation");
      assert.equal(call.body.variantId, "variant-01");
      assert.equal(call.body.priceMinor, 2500);
      assert.equal(call.body.inventoryOnHandBaseUnits, 0);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
