import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { storeReadFailureKind } from "./store-read-state.ts";

test("unauthorized, forbidden, absent and withdrawn marketplace Stores share one non-disclosing unavailable state", () => {
  for (const status of [401, 403, 404, 410]) {
    assert.equal(storeReadFailureKind({ kind: "http", status }), "unavailable");
  }
});

test("transient and unknown failures still expose the retry path", () => {
  for (const error of [
    { kind: "http", status: 500 },
    { kind: "http", status: 429 },
    { kind: "network" },
    null,
    new Error("offline"),
  ]) assert.equal(storeReadFailureKind(error), "error");
});

test("marketplace Store page renders unavailable without checkout or discovery leaks", () => {
  const source = readFileSync(new URL("./store-detail.tsx", import.meta.url), "utf8");
  assert.match(source, /setState\(\{ kind: storeReadFailureKind\(error\) \}\)/);
  const unavailable = source.split('if (state.kind === "unavailable") {')[1]?.split('if (state.kind === "error") {')[0];
  assert.ok(unavailable, "separate unavailable state must be rendered before Store detail");
  assert.match(unavailable, /هذا المتجر غير متاح/);
  assert.doesNotMatch(unavailable, /\/cart\/|addCatalogOfferToCart|StorePublicContactCard|إعادة المحاولة/);
  const retry = source.split('if (state.kind === "error") {')[1]?.split('const heroImageURI')[0];
  assert.match(retry ?? "", /label="إعادة المحاولة"/);
});

test("Store revalidation withdraws stale public detail and cart on DSH 404 without leaking it", () => {
  const source = readFileSync(new URL("./store-detail.tsx", import.meta.url), "utf8");
  const pollFailure = source.split("}).catch((cause) => {")[1]?.split("// Revalidate Partner visibility", 1)[0];
  assert.ok(pollFailure, "live public orderability errors must be handled");
  assert.match(pollFailure, /storeReadFailureKind\(cause\) === "unavailable"/);
  assert.match(pollFailure, /setState\(\{ kind: "unavailable" \}\)/);
  assert.match(pollFailure, /setOpenCart\(null\)/);
  assert.match(pollFailure, /setDetailOffer\(null\)/);
  assert.match(pollFailure, /\+\+storeRequestID\.current/);
  assert.match(pollFailure, /\+\+catalogRequestID\.current/);
});

test("orderability revalidation fails closed and rejects older or mis-scoped success", () => {
  const source = readFileSync(new URL("./store-detail.tsx", import.meta.url), "utf8");
  assert.match(source, /const orderabilityRequest = \+\+orderabilityRequestID\.current/g);
  assert.match(source, /orderabilityRequest !== orderabilityRequestID\.current/);
  assert.match(source, /orderabilityRequest === orderabilityRequestID\.current/);
  assert.match(source, /response\.storeId === storeId && response\.serviceCityId === selectedCityID \? response\.orderabilityByMode : \[\]/);
  assert.match(source, /setOrderabilityByMode\(\[\]\);/);
  assert.match(source, /\.catch\(\(\) => \[\]\)/);
  assert.doesNotMatch(source, /Preserve the last confirmed state until DSH is reachable/);
});
