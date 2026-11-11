import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { summarizeStoreAvailability, summarizeStoreDirectoryAvailability } from "./store-availability-summary.ts";

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

test("directory badge displays DSH operational availability and never infers opening from publication", () => {
  assert.deepEqual(summarizeStoreDirectoryAvailability([]), { label: "غير متاح", tone: "unavailable" });
  assert.deepEqual(summarizeStoreDirectoryAvailability([mode(delivery, "OPEN_FOR_ORDERS")]), { label: "مفتوح", tone: "open" });
  assert.deepEqual(summarizeStoreDirectoryAvailability([mode(delivery, "CLOSED_BY_SCHEDULE")]), { label: "مغلق", tone: "unavailable" });
  assert.deepEqual(summarizeStoreDirectoryAvailability([mode(delivery, "PAUSED")]), { label: "متوقف مؤقتًا", tone: "paused" });
  assert.deepEqual(summarizeStoreDirectoryAvailability([mode(delivery, "OPERATIONALLY_UNAVAILABLE")]), { label: "غير متاح", tone: "unavailable" });
});

test("mixed blocked modes cannot falsely claim that a published Store is open or simply paused", () => {
  const statuses = [mode(delivery, "CLOSED_BY_SCHEDULE"), mode(pickup, "PAUSED")];
  assert.deepEqual(summarizeStoreDirectoryAvailability(statuses), { label: "غير متاح", tone: "unavailable" });
  assert.deepEqual(summarizeStoreDirectoryAvailability([mode(delivery, "OPEN_FOR_ORDERS"), ...statuses]), { label: "مفتوح", tone: "open" });
  assert.equal(summarizeStoreAvailability([mode(delivery, "OPEN_FOR_ORDERS"), mode(pickup, "PAUSED")], pickup).label, "متوقف");
});

test("Store directory delegates DSH status projection to existing single summary owner", () => {
  const source = readFileSync(new URL("./store-directory-card.tsx", import.meta.url), "utf8");
  assert.match(source, /availableCustomerFulfillmentModes\(store.fulfillmentModes\)/);
  assert.match(source, /statuses = \(store.orderabilityByMode \?\? \[\]\).filter/);
  assert.match(source, /summarizeStoreDirectoryAvailability\(statuses\)/);
  assert.doesNotMatch(source, /statuses.some\(\(item\) => item.state/);
  assert.doesNotMatch(source, /!statuses.length \? ""/);
  assert.match(source, /accessibilityLabel=\{\[`فتح متجر \$\{store.name\}`, statusLabel/);
  assert.match(source, /<View style=\{\[styles.statusBadge,/);
});
