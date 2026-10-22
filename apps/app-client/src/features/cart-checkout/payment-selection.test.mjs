import assert from "node:assert/strict";
import test from "node:test";
import { paymentSplit } from "./payment-selection.ts";

test("cash payment never consumes wallet balance", () => {
  assert.deepEqual(paymentSplit(9000, null, "CASH"), { walletMinor: 0, cashMinor: 9000 });
});
test("wallet payment requires enough canonical available balance", () => {
  assert.equal(paymentSplit(9000, 3000, "WALLET"), null);
  assert.deepEqual(paymentSplit(9000, 9000, "WALLET"), { walletMinor: 9000, cashMinor: 0 });
});
test("mixed payment divides payable amount without over-allocating", () => {
  assert.deepEqual(paymentSplit(9000, 3000, "MIXED"), { walletMinor: 3000, cashMinor: 6000 });
  assert.deepEqual(paymentSplit(9000, 10000, "MIXED"), { walletMinor: 4500, cashMinor: 4500 });
  assert.equal(paymentSplit(9000, 0, "MIXED"), null);
  assert.equal(paymentSplit(1, 1, "MIXED"), null);
});
test("invalid amounts and unread balances cannot create noncash allocations", () => {
  assert.equal(paymentSplit(-1, 10, "CASH"), null);
  assert.equal(paymentSplit(Number.MAX_SAFE_INTEGER + 1, 10, "MIXED"), null);
  assert.equal(paymentSplit(9000, null, "MIXED"), null);
  assert.equal(paymentSplit(9000, -3, "WALLET"), null);
});