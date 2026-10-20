import assert from "node:assert/strict";
import test from "node:test";
import { operationHistoryLabel } from "./operation-history.ts";

test("operator audit event labels distinguish actual events without fabricating reasons", () => {
  const at = "2026-10-20T06:00:00Z";
  assert.equal(operationHistoryLabel({ source: "order", eventType: "order_rejected", state: "REJECTED", at }), "رفض الطلب");
  assert.equal(operationHistoryLabel({ source: "captain", eventType: "delivery_failed", state: "delivery_failed", at }), "تعثر التسليم");
  assert.equal(operationHistoryLabel({ source: "captain", eventType: "new_event", state: "unknown", at }), "حدث تشغيلي محفوظ");
});
