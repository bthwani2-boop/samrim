import assert from "node:assert/strict";
import { test } from "node:test";

import { clientAuthReturnPathPattern, clientWalletCashInAuthReturnPath } from "../src/features/access/client-auth-return-path.ts";

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
