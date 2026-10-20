import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { summarizeStoreAvailability } from "./store-availability-summary.ts";

const mode = (fulfillmentMode, state, reason) => ({ fulfillmentMode, state, reason });
const delivery = "BTHWANI_CAPTAIN";
const partner = "PARTNER_CAPTAIN";
const pickup = "CUSTOMER_PICKUP";

test("all closed store modes show closure, not endless checking", () => {
  const summary = summarizeStoreAvailability([mode(delivery, "CLOSED_BY_SCHEDULE"), mode(partner, "CLOSED_BY_SCHEDULE"), mode(pickup, "CLOSED_BY_SCHEDULE")], null);
  assert.deepEqual(summary, { label: "مغلق", reason: "خارج ساعات العمل الآن." });
});

test("paused store preserves owner-provided Arabic reason", () => {
  const summary = summarizeStoreAvailability([mode(delivery, "PAUSED", "إيقاف الطلبات بطلب الشريك")], null);
  assert.deepEqual(summary, { label: "متوقف", reason: "إيقاف الطلبات بطلب الشريك" });
});

test("open store requires a fulfillment mode without claiming an order is ready", () => {
  assert.equal(summarizeStoreAvailability([mode(delivery, "OPEN_FOR_ORDERS"), mode(partner, "CLOSED_BY_SCHEDULE")], null).label, "اختر طريقة الطلب");
  assert.equal(summarizeStoreAvailability([mode(delivery, "OPEN_FOR_ORDERS")], delivery).label, "مفتوح");
});

test("selected closed fulfillment stays closed even if another mode is open", () => {
  assert.equal(summarizeStoreAvailability([mode(delivery, "OPEN_FOR_ORDERS"), mode(pickup, "CLOSED_BY_SCHEDULE")], pickup).label, "مغلق");
});

test("invalid, empty and mixed modes fail closed with a reason", () => {
  assert.equal(summarizeStoreAvailability([], null).label, "غير متاح");
  assert.equal(summarizeStoreAvailability([mode(delivery, "OPEN_FOR_ORDERS")], partner).label, "غير متاح");
  assert.equal(summarizeStoreAvailability([mode(delivery, "CLOSED_BY_SCHEDULE"), mode(pickup, "PAUSED")], null).label, "غير متاح");
});

test("both storefront quick-add controls require an orderable selected mode", () => {
  const source = readFileSync(new URL("./store-detail.tsx", import.meta.url), "utf8");
  assert.equal(source.match(/disabled=\{mutationBusy \|\| !canOrderSelected\}/g)?.length, 2);
});
