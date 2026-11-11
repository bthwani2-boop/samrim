import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript-ast";

const source = readFileSync(new URL("./mobile.ts", import.meta.url), "utf8");
const operationsSource = readFileSync(new URL("./generated/dsh-operations.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("mobile.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const names = ["readPublishedStore", "readPublicStoreOrderability", "readPublicStoreCatalog", "readPublishedStorePublicContact"];
const methods = new Map();
function visit(node) {
  if (ts.isMethodDeclaration(node) && names.includes(node.name.getText(ast))) {
    methods.set(node.name.getText(ast), node.getText(ast));
  }
  ts.forEachChild(node, visit);
}
visit(ast);
for (const name of names) assert.ok(methods.has(name), "actual public DSH client method: " + name);
const paths = Object.fromEntries(names.map(name => {
  const entry = operationsSource.match(new RegExp(name + ': \\{ method: "(GET)", path: "([^"]+)" \\}'));
  assert.ok(entry, "actual generated GET route: " + name);
  return [name, { method: entry[1], path: entry[2] }];
}));
const js = ts.transpileModule("const client = { " + [...methods.values()].join(", ") + " }; client;", {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

function harness(response) {
  const calls = [];
  const client = vm.runInNewContext(js, {
    dshOperationPaths: paths,
    publicRequest: async path => { calls.push(path); return structuredClone(response); },
    encodeURIComponent,
    URLSearchParams,
  });
  return { client, calls };
}
const store = () => ({
  id: "store-a", serviceCity: { id: "city-a" }, publishedAt: "2026-11-09T00:00:00Z",
  orderabilityByMode: [{ storeId: "store-a", fulfillmentMode: "CUSTOMER_PICKUP" }],
});
const catalog = () => ({
  storeId: "store-a", verticalId: "vertical-a", categories: [],
  sections: [{ id: "section-a", storeId: "store-a" }],
  offers: [{ offerId: "offer-a", storeId: "store-a" }], nextCursor: null,
});
const orderability = () => ({
  storeId: "store-a", serviceCityId: "city-a",
  orderabilityByMode: [{ storeId: "store-a", fulfillmentMode: "CUSTOMER_PICKUP" }],
});

test("published Store client accepts same Store and city and encodes path", async () => {
  const { client, calls } = harness(store());
  const result = await client.readPublishedStore(" store-a ", " city-a ");
  assert.equal(result.id, "store-a");
  assert.match(calls[0], /\/dsh\/public\/stores\/store-a\?serviceCityId=city-a$/);
});
for (const [name, changed] of [
  ["different Store", { id: "store-b" }],
  ["different city", { serviceCity: { id: "city-b" } }],
  ["other Store orderability", { orderabilityByMode: [{ storeId: "store-b" }] }],
]) {
  test("published Store client rejects " + name, async () => {
    const { client } = harness({ ...store(), ...changed });
    await assert.rejects(client.readPublishedStore("store-a", "city-a"), /DSH_PUBLIC_STORE_SCOPE_MISMATCH/);
  });
}
test("public catalog accepts same Store and nested sections/offers", async () => {
  const { client, calls } = harness(catalog());
  const result = await client.readPublicStoreCatalog("store-a", "city-a", "", "", 20);
  assert.equal(result.storeId, "store-a");
  assert.match(calls[0], /serviceCityId=city-a/);
});
for (const [name, changed] of [
  ["other Store top-level", { storeId: "store-b" }],
  ["another Store offer", { offers: [{ storeId: "store-b" }] }],
  ["another Store section", { sections: [{ storeId: "store-b" }] }],
]) {
  test("public catalog client rejects " + name, async () => {
    const { client } = harness({ ...catalog(), ...changed });
    await assert.rejects(client.readPublicStoreCatalog("store-a", "city-a"), /DSH_PUBLIC_CATALOG_SCOPE_MISMATCH/);
  });
}
test("public orderability accepts same Store and city", async () => {
  const { client } = harness(orderability());
  assert.equal((await client.readPublicStoreOrderability("store-a", "city-a")).storeId, "store-a");
});
for (const [name, changed] of [
  ["another Store", { storeId: "store-b" }],
  ["another service city", { serviceCityId: "city-b" }],
  ["another Store nested mode", { orderabilityByMode: [{ storeId: "store-b" }] }],
]) {
  test("public orderability client rejects " + name, async () => {
    const { client } = harness({ ...orderability(), ...changed });
    await assert.rejects(client.readPublicStoreOrderability("store-a", "city-a"), /DSH_PUBLIC_ORDERABILITY_SCOPE_MISMATCH/);
  });
}
test("public Store contact accepts correct owner and rejects another Store", async () => {
  const good = harness({ contact: { storeId: "store-a" } });
  assert.equal((await good.client.readPublishedStorePublicContact("store-a")).contact.storeId, "store-a");
  const bad = harness({ contact: { storeId: "store-b" } });
  await assert.rejects(bad.client.readPublishedStorePublicContact("store-a"), /DSH_PUBLIC_CONTACT_SCOPE_MISMATCH/);
});
