import { expect, test } from "@playwright/test";

test("operator double activation issues one dispatch request and confirms owner readback", async ({ page }) => {
  const identity = {
    subject: "actor-ops-race", sessionId: "ops-race", role: "operator",
    permissions: ["operations"], surface: "control-panel", expiresAt: "2099-01-01T00:00:00Z",
  };
  await page.route("**/api/auth/session**", (route) => route.fulfill({ json: { identity } }));
  await page.route("**/api/notifications**", (route) => route.fulfill({ json: { notifications: [], unreadCount: 0 } }));
  let state = "READY_FOR_DISPATCH";
  let calls = 0;
  let release: (() => void) | undefined;
  const delayedResponse = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/operations/ops-race-order", (route) => route.fulfill({ json: {
    operation: {
      storeName: "متجر اختبار العمليات",
      assignment: state === "READY_FOR_DISPATCH" ? null : {
        id: "assignment-race", orderId: "ops-race-order", state: "assigned", version: 1,
        handoffState: "pending", captainActorId: "captain-race",
      },
      order: {
        id: "ops-race-order", storeId: "store-race", state, fulfillmentMode: "BTHWANI_CAPTAIN",
        createdAt: "2026-10-14T01:00:00Z", updatedAt: "2026-10-14T01:01:00Z",
        addressText: "صنعاء", addressLatitude: 15.35, addressLongitude: 44.2,
        lines: [], adjustments: [], subtotalAmountMinor: 1000, discountMinor: 0,
        totalAmountMinor: 1000, cashAmountMinor: 1000, currency: "YER",
        paymentMethod: "CASH_ON_DELIVERY", paymentState: "REQUIRES_COLLECTION",
      },
    },
  } }));
  await page.route("**/api/captains", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    calls += 1;
    await delayedResponse;
    state = "CAPTAIN_ASSIGNED";
    await route.fulfill({ status: 200, json: { state } });
  });

  await page.goto("/operations/ops-race-order");
  const dispatch = page.getByRole("button", { name: "إرسال للتوزيع" });
  await expect(dispatch).toBeVisible();
  await dispatch.evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
  await expect.poll(() => calls).toBe(1);
  await page.waitForTimeout(150);
  expect(calls, "two synchronous clicks must not create two dispatch attempts").toBe(1);
  release?.();
  await expect(page.getByRole("status")).toContainText("تم تحديث حالة الطلب بعد إعادة قراءتها من المصدر التشغيلي.");
  await expect(dispatch).toHaveCount(0);
  expect(calls).toBe(1);
});
