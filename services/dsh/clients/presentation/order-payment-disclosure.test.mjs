import assert from "node:assert/strict";
import { test } from "node:test";

import { cashCollectionPartyLabel, checkoutWalletAllocation, orderPaymentDisclosure, paymentMethodLabel } from "./order-presentation.ts";

const cashDelivery = {
  state: "CREATED",
  paymentState: "REQUIRES_COLLECTION",
  paymentMethod: "CASH_ON_DELIVERY",
  fulfillmentMode: "BTHWANI_CAPTAIN",
  cashAmountMinor: 14864,
  currency: "YER",
};

test("cancelled payment readback does not request cash or delivery collection", () => {
  const disclosure = orderPaymentDisclosure({ ...cashDelivery, state: "CANCELLED", paymentState: "CANCELLED" });
  assert.match(disclosure.status, /أُلغي التحصيل/);
  assert.doesNotMatch(disclosure.amount + disclosure.status, /النقد المتبقي|بانتظار التحصيل|الدفع نقدًا|عند التسليم/);
});

test("cancelled order with lagging collection readback fails closed instead of requesting cash", () => {
  const disclosure = orderPaymentDisclosure({ ...cashDelivery, state: "CANCELLED" });
  assert.match(disclosure.status, /غير مؤكدة|غير متطابقة|مراجعة/);
  assert.doesNotMatch(disclosure.amount + disclosure.status, /النقد المتبقي|بانتظار التحصيل|الدفع نقدًا|عند التسليم/);
});

test("rejected order with lagging collection readback does not request cash", () => {
  const disclosure = orderPaymentDisclosure({ ...cashDelivery, state: "REJECTED" });
  assert.match(disclosure.status, /غير مؤكدة|غير متطابقة|مراجعة/);
  assert.doesNotMatch(disclosure.amount + disclosure.status, /النقد المتبقي|بانتظار التحصيل|الدفع نقدًا|عند التسليم/);
});

test("collected rejected order does not silently promise an automatic refund", () => {
  const disclosure = orderPaymentDisclosure({ ...cashDelivery, state: "REJECTED", paymentState: "COLLECTED" });
  assert.match(disclosure.status, /استرداد|مراجعة/);
  assert.doesNotMatch(disclosure.amount + disclosure.status, /النقد المتبقي|بانتظار التحصيل|الدفع نقدًا/);
});

test("collected active order does not ask for collection a second time", () => {
  const disclosure = orderPaymentDisclosure({ ...cashDelivery, state: "DELIVERED", paymentState: "COLLECTED" });
  assert.match(disclosure.amount + disclosure.status, /تم سداد المبلغ/);
  assert.doesNotMatch(disclosure.amount + disclosure.status, /النقد المتبقي|بانتظار التحصيل|الدفع نقدًا|عند الاستلام|عند التسليم/);
});

test("active order retains the canonical cash payment terms", () => {
  const disclosure = orderPaymentDisclosure(cashDelivery);
  assert.match(disclosure.amount, /النقد المتبقي عند الاستلام/);
  assert.match(disclosure.status, /بانتظار التحصيل/);
});

test("wallet allocation is bounded by payable total and available balance", () => {
  assert.equal(checkoutWalletAllocation(5000, null, false), 0);
  assert.equal(checkoutWalletAllocation(5000, 0, true), 0);
  assert.equal(checkoutWalletAllocation(5000, 2000, true), 2000);
  assert.equal(checkoutWalletAllocation(5000, 7000, true), 5000);
  assert.equal(checkoutWalletAllocation(5000, null, true), null);
  assert.equal(checkoutWalletAllocation(5000, -1, true), null);
  assert.equal(checkoutWalletAllocation(5000, NaN, true), null);
  assert.equal(checkoutWalletAllocation(0, 2000, true), 0);
  assert.equal(checkoutWalletAllocation(-1, 2000, false), null);
});

test("cash recipient follows fulfillment ownership, not cash payment method name", () => {
  assert.equal(cashCollectionPartyLabel("BTHWANI_CAPTAIN"), "كابتن بثواني");
  assert.equal(cashCollectionPartyLabel("PARTNER_CAPTAIN"), "المتجر أو مندوبه");
  assert.equal(cashCollectionPartyLabel("CUSTOMER_PICKUP"), "المتجر");
  assert.match(paymentMethodLabel("CASH_AT_STORE", "PARTNER_CAPTAIN", 500), /للمتجر أو مندوبه/);
  assert.match(paymentMethodLabel("CASH_AT_STORE", "CUSTOMER_PICKUP", 500), /للمتجر/);
  assert.equal(paymentMethodLabel("CASH_AT_STORE", "PARTNER_CAPTAIN", 0), "الدفع من رصيد المحفظة");
});
