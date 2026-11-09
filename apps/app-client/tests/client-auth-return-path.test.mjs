import assert from "node:assert/strict";
import { test } from "node:test";

import * as authReturn from "../src/features/access/client-auth-return-path.ts";
const { clientAuthReturnPathPattern, clientWalletCashInAuthReturnPath } = authReturn;

test("wallet top-up authentication preserves the checkout funding intent", () => {
  assert.equal(clientWalletCashInAuthReturnPath("2500", "1"), "/wallet-cash-in?amountMinor=2500&fromCheckout=1");
  assert.equal(clientWalletCashInAuthReturnPath("2500", undefined), "/wallet-cash-in?amountMinor=2500");
  assert.equal(clientWalletCashInAuthReturnPath(undefined, "1"), "/wallet-cash-in?fromCheckout=1");
  assert.equal(clientWalletCashInAuthReturnPath(undefined, undefined), "/wallet-cash-in");
  assert.equal(clientWalletCashInAuthReturnPath(["2500", "9000"], ["1", "0"]), "/wallet-cash-in?amountMinor=2500&fromCheckout=1");
});

test("untrusted wallet funding parameters cannot inject auth destinations", () => {
  for (const amount of ["0", "-1", "2.5", "1e3", "2500&returnTo=//evil", "9007199254740992", "%2F%2Fevil"]) {
    assert.equal(clientWalletCashInAuthReturnPath(amount, "0"), "/wallet-cash-in", amount);
  }
  assert.equal(clientWalletCashInAuthReturnPath("2500", "1&returnTo=//evil"), "/wallet-cash-in?amountMinor=2500");
});

test("sign-in destinations admit only explicit internal client routes and wallet intent", () => {
  for (const path of ["/home", "/account", "/orders/order-42", "/store/store-5?productId=product-7", "/cart/store-5", "/wallet-cash-in", "/wallet-cash-in?amountMinor=2500&fromCheckout=1", "/wallet-cash-in?fromCheckout=1"]) {
    assert.match(path, clientAuthReturnPathPattern, path);
  }
  for (const path of ["//evil.example", "https://evil.example", "/wallet-cash-in?amountMinor=2500&returnTo=//evil", "/wallet-cash-in?amountMinor=0", "/wallet-cash-in?amountMinor=9007199254740992", "/wallet-cash-in?fromCheckout=1&amountMinor=2500", "/finance"]) {
    assert.doesNotMatch(path, clientAuthReturnPathPattern, path);
  }
});

test("sign-in can resume the exact marketplace product and active city", () => {
  assert.match("/store/store-5?serviceCityId=city-9&productId=product%267", clientAuthReturnPathPattern);
  assert.match("/store/store-5?serviceCityId=city-9", clientAuthReturnPathPattern);
  assert.doesNotMatch("/store/store-5?serviceCityId=city-9&returnTo=//evil", clientAuthReturnPathPattern);
  assert.doesNotMatch("/store/store-5?serviceCityId=city-9&serviceCityId=city-8", clientAuthReturnPathPattern);
});

test("Store website login returns only to an exact public Store and City", () => {
  for (const site of [
    "/storefront/store-5?serviceCityId=city-9",
    "/storefront/store-5?serviceCityId=city-9&productId=product%267",
  ]) assert.match(site, clientAuthReturnPathPattern);
  for (const attempt of [
    "/storefront/../other?serviceCityId=city-9",
    "/storefront/store-5?serviceCityId=city-9&relationModel=INDEPENDENT_STORE",
    "/storefront/store-5?serviceCityId=city-9&serviceCityId=other",
    "/storefront/store-5?serviceCityId=city-9&productId=one&productId=two",
  ]) assert.doesNotMatch(attempt, clientAuthReturnPathPattern);
});

test("a storefront cart resumes the exact Store, city and public product after sign-in", () => {
  const path = authReturn.clientStorefrontCartPath("store-5", "city-9", "product&7");
  assert.equal(path, "/cart/store-5?source=storefront&serviceCityId=city-9&productId=product%267");
  assert.match(path, clientAuthReturnPathPattern);
  assert.deepEqual(authReturn.clientStorefrontCartScope("store-5", "storefront", "city-9", "product&7"), {
    cityID: "city-9", productID: "product&7", returnPath: path,
  });
});

test("storefront cart context accepts only a scoped intent with no arbitrary return destination", () => {
  for (const [store, source, city] of [
    ["..", "storefront", "city-9"], ["store-5", "https://evil.example", "city-9"],
    ["store-5", ["storefront", "storefront"], "city-9"], ["store-5", "storefront", "city-9&returnTo=//evil"],
  ]) {
    assert.equal(authReturn.clientStorefrontCartScope(store, source, city, undefined), null);
  }
  for (const path of [
    "/cart/store-5?source=storefront&serviceCityId=city-9&redirect=https://evil.example",
    "/cart/../other?source=storefront&serviceCityId=city-9",
    "/cart/store-5?source=storefront&serviceCityId=city-9&productId=one&productId=two",
  ]) assert.doesNotMatch(path, clientAuthReturnPathPattern, path);
});
