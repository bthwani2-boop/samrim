import assert from "node:assert/strict";
import { test } from "node:test";
import { describeStoreOrderability } from "./orderability.ts";

const samples = [
  ["PAUSED", "المتجر متوقف مؤقتًا"],
  ["CLOSED_BY_SCHEDULE", "المتجر مغلق بحسب الدوام"],
  ["OPERATIONALLY_UNAVAILABLE", "الطلب غير متاح تشغيليًا"],
  ["OPEN_FOR_ORDERS", "المتجر ضمن ساعات العمل"],
];

for (const [orderabilityStatus, expected] of samples) {
  test(`Store orderability copy renders DSH status ${orderabilityStatus} without promising checkout`, () => {
    const result = describeStoreOrderability({ orderabilityStatus, orderingAvailable: false });
    assert.equal(result.headline, expected);
    assert.ok(result.detail.length > 0);
    assert.match(result.detail, /لا يمكن (إتمام|إنشاء) طلب/);
    assert.doesNotMatch(`${result.headline} ${result.detail}`, /يمكنك إتمام طلب|يستقبل الطلبات الآن/);
  });
}

test("Unrecognized source status fails closed", () => {
  const result = describeStoreOrderability({ orderabilityStatus: "UNKNOWN_FROM_OWNER", orderingAvailable: false });
  assert.equal(result.headline, "الطلب غير متاح تشغيليًا");
  assert.match(result.detail, /لا يمكن إتمام طلب/);
});
