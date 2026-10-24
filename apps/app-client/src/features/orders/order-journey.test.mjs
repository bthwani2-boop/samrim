import assert from "node:assert/strict";
import test from "node:test";
import { orderJourneyPresentation } from "./order-journey.ts";

test("store delivery stays distinct from Bthwani while in custody", () => {
  const store = orderJourneyPresentation({ fulfillmentMode: "PARTNER_CAPTAIN", state: "IN_CUSTODY" });
  const bthwani = orderJourneyPresentation({ fulfillmentMode: "BTHWANI_CAPTAIN", state: "IN_CUSTODY" });
  assert.equal(store.title, "المتجر يوصّل طلبك");
  assert.equal(store.fulfillmentLabel, "توصيل المتجر");
  assert.equal(bthwani.title, "طلبك في الطريق إليك");
  assert.equal(bthwani.fulfillmentLabel, "توصيل بثواني");
  assert.equal(store.currentStep, 2);
});

test("pickup readiness never means picked up", () => {
  const ready = orderJourneyPresentation({ fulfillmentMode: "CUSTOMER_PICKUP", state: "READY_FOR_PICKUP" });
  const delivered = orderJourneyPresentation({ fulfillmentMode: "CUSTOMER_PICKUP", state: "PICKED_UP" });
  assert.equal(ready.title, "طلبك جاهز للاستلام");
  assert.equal(ready.currentStep, 2);
  assert.equal(delivered.currentStep, 3);
  assert.equal(delivered.title, "تم استلام طلبك");
});

test("a failed or cancelled order never advances the timeline", () => {
  for (const state of ["CANCELLED", "REJECTED", "DELIVERY_FAILED"]) {
    const value = orderJourneyPresentation({ fulfillmentMode: "BTHWANI_CAPTAIN", state });
    assert.equal(value.currentStep, -1);
    assert.equal(value.exception, true);
  }
});

test("delivery readiness does not imply a captain has the order", () => {
  const value = orderJourneyPresentation({ fulfillmentMode: "PARTNER_CAPTAIN", state: "READY_FOR_PICKUP" });
  assert.equal(value.currentStep, 1);
  assert.equal(value.title, "الطلب جاهز لاستلام الكابتن");
});
