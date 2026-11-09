import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript-ast";

const source = readFileSync(new URL("./public-independent-storefront.ts", import.meta.url), "utf8")
  .split("\n").filter(line => !line.startsWith("import { dshOperationPaths }")).join("\n")
  .replace(/^export /gm, "");
const operationsSource = readFileSync(new URL("./generated/dsh-operations.ts", import.meta.url), "utf8");
const paths = Object.fromEntries(["readPublishedIndependentWebStore", "listPublishedIndependentWebCatalog"].map(name => {
  const path = operationsSource.match(new RegExp(name + ': \\{ method: "GET", path: "([^"]+)" \\}'));
  assert.ok(path, "generated DSH contract " + name);
  return [name, { path: path[1] }];
}));
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
let fetchHandler = () => { throw new Error("FETCH_NOT_STUBBED"); };
const { IndependentStoreUnavailable, listPublishedIndependentWebCatalog, readPublishedIndependentWebStore } =
  vm.runInNewContext(js + ";({ IndependentStoreUnavailable, listPublishedIndependentWebCatalog, readPublishedIndependentWebStore })",
    { dshOperationPaths: paths, fetch: (...args) => fetchHandler(...args), URL, URLSearchParams, Response });

const store = {
  storeId: "store_1", serviceCityId: "sanaa", name: "متجر الأماني",
  hostingTermsVersion: "terms-v1", merchantPolicyVersion: "policy-v1",
  profileImageUri: "https://images.example.com/logo.png",
  coverImageUri: "https://images.example.com/cover.png",
  checkoutEnabled: false,
};
const catalog = {
  storeId: "store_1",
  offers: [{ offerId: "offer_1", productId: "product_1", productName: "منتج",
    variantId: "variant_1", variantTitle: "واحد", priceMinor: 1500,
    currency: "YER", media: [{ uri: "https://images.example.com/offer.png", role: "primary" }] }],
  nextCursor: "",
};

async function withFetch(handler, callback) {
  const previous = fetchHandler;
  fetchHandler = handler;
  try { return await callback(); } finally { fetchHandler = previous; }
}

test("public independent Store uses the generated DSH GET contract, never a Partner/private session", async () => {
  const requests = [];
  await withFetch(async (url, options) => {
    requests.push({ url: String(url), options });
    return new Response(JSON.stringify(store), { status: 200 });
  }, async () => {
    assert.equal((await readPublishedIndependentWebStore("https://api.example.com/", "store_1", "sanaa")).storeId, "store_1");
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://api.example.com/dsh/public/independent-stores/store_1?serviceCityId=sanaa");
  assert.equal(requests[0].options.method, "GET");
  assert.equal(requests[0].options.credentials, "omit");
  assert.equal(requests[0].options.cache, "no-store");
  assert.equal(requests[0].options.headers.Authorization, undefined);
});

test("independent public catalog scope, filtering and media stay in the same Store", async () => {
  let url = "";
  await withFetch(async (request) => {
    url = String(request);
    return new Response(JSON.stringify(catalog), { status: 200 });
  }, async () => {
    const page = await listPublishedIndependentWebCatalog("https://api.example.com", "store_1", "sanaa", {
      productID: "product_1", query: "منتج",
    });
    assert.equal(page.offers[0].priceMinor, 1500);
  });
  assert.equal(new URL(url).searchParams.get("productId"), "product_1");
  assert.equal(new URL(url).searchParams.get("serviceCityId"), "sanaa");
  assert.equal(new URL(url).searchParams.get("q"), "منتج");
  assert.equal(new URL(url).pathname, "/dsh/public/independent-stores/store_1/catalog");
});

test("unpublished and cross-Store public facts fail closed", async () => {
  await withFetch(async () => new Response("{}", { status: 404 }), async () => {
    await assert.rejects(readPublishedIndependentWebStore("https://api.example.com", "store_1", "sanaa"), IndependentStoreUnavailable);
  });
  for (const override of [
    { serviceCityId: "aden" }, { storeId: "store_2" }, { checkoutEnabled: true },
    { coverImageUri: "http://localhost:18080/private" }, { hostingTermsVersion: "" },
  ]) {
    await withFetch(async () => new Response(JSON.stringify({ ...store, ...override }), { status: 200 }), async () => {
      await assert.rejects(readPublishedIndependentWebStore("https://api.example.com", "store_1", "sanaa"), IndependentStoreUnavailable);
    });
  }
  for (const override of [
    { storeId: "other_store" },
    { offers: [{ ...catalog.offers[0], media: [{ uri: "file:///secret", role: "primary" }] }] },
  ]) {
    await withFetch(async () => new Response(JSON.stringify({ ...catalog, ...override }), { status: 200 }), async () => {
      await assert.rejects(listPublishedIndependentWebCatalog("https://api.example.com", "store_1", "sanaa"), IndependentStoreUnavailable);
    });
  }
});
