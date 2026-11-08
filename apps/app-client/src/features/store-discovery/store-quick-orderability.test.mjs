import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript-ast";

const source = readFileSync(new URL("./store-detail.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("store-detail.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let openOfferDeclaration;
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "openOfferDetails") openOfferDeclaration = node;
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(openOfferDeclaration, "test the real Store quick-detail handler");
const compiled = ts.transpileModule(
  `${openOfferDeclaration.getText(ast)}; openOfferDetails;`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
).outputText;

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function scenario() {
  const offer = { offerId: "offer-1", productId: "product-1" };
  const orderability = deferred();
  const updatedModes = [];
  const orderabilityRequestID = { current: 4 };
  const detailRequestID = { current: 9 };
  let requests = 0;
  const env = {
    state: { kind: "ready", catalog: { offers: [offer] } },
    selectedCityID: "city-1", storeId: "store-1",
    detailRequestID, orderabilityRequestID,
    setAddedOfferId: () => {}, setError: () => {}, setSheetMode: () => {},
    setQuickAnchorY: () => {}, setDetailOffer: () => {}, setDetailLoading: () => {},
    setOrderabilityByMode: (value) => updatedModes.push(value),
    readPublicStoreOrderability: () => { requests++; return orderability.promise; },
    readPublicStoreCatalog: async () => ({ offers: [offer] }),
  };
  return {
    open: vm.runInNewContext(compiled, env), orderability,
    updatedModes, orderabilityRequestID, detailRequestID,
    get requests() { return requests; },
  };
}

const open = [{ fulfillmentMode: "CUSTOMER_PICKUP", state: "OPEN_FOR_ORDERS" }];
const closed = [{ fulfillmentMode: "CUSTOMER_PICKUP", state: "CLOSED_BY_SCHEDULE" }];
const response = (modes, storeId = "store-1", serviceCityId = "city-1") => ({
  storeId, serviceCityId, orderabilityByMode: modes,
});

test("quick add blocks ordering immediately until a fresh DSH response for the same Store/city", async () => {
  const testCase = scenario();
  await testCase.open("offer-1", "quick");
  assert.equal(testCase.requests, 1);
  assert.equal(testCase.updatedModes[0]?.length, 0);
  testCase.orderability.resolve(response(closed));
  await Promise.resolve();
  assert.equal(testCase.updatedModes.at(-1)[0]?.state, "CLOSED_BY_SCHEDULE");
});

test("late quick-add success never overrides a newer orderability poll", async () => {
  const testCase = scenario();
  await testCase.open("offer-1", "quick");
  testCase.orderabilityRequestID.current += 1; // the next focus poll begins
  testCase.orderability.resolve(response(open));
  await Promise.resolve();
  assert.equal(testCase.updatedModes.length, 1);
  assert.equal(testCase.updatedModes[0]?.length, 0);
});

test("quick-add error and wrong Store/city result fail closed", async () => {
  const rejected = scenario();
  await rejected.open("offer-1", "quick");
  rejected.orderability.reject(new Error("DSH offline"));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(rejected.updatedModes.length, 2);
  assert.equal(rejected.updatedModes.at(-1)?.length, 0);

  const wrongStore = scenario();
  await wrongStore.open("offer-1", "quick");
  wrongStore.orderability.resolve(response(open, "other-store"));
  await Promise.resolve();
  assert.equal(wrongStore.updatedModes.at(-1)?.length, 0);

  const wrongCity = scenario();
  await wrongCity.open("offer-1", "quick");
  wrongCity.orderability.resolve(response(open, "store-1", "other-city"));
  await Promise.resolve();
  assert.equal(wrongCity.updatedModes.at(-1)?.length, 0);
});

test("closed quick details ignore an in-flight successful revalidation", async () => {
  const testCase = scenario();
  await testCase.open("offer-1", "quick");
  testCase.detailRequestID.current += 1;
  testCase.orderability.resolve(response(open));
  await Promise.resolve();
  assert.equal(testCase.updatedModes.length, 1);
});

test("gallery-only product detail does not reset Store orderability", async () => {
  const testCase = scenario();
  await testCase.open("offer-1", "gallery");
  assert.equal(testCase.requests, 0);
  assert.equal(testCase.updatedModes.length, 0);
});
