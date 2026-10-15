import { expect, test } from "./coverage-fixtures";

test("customer wallet compensation uses a cancellable in-app financial confirmation", async ({ page }) => {
  let financeAllowed = true;
  await page.route("**/api/auth/session**", (route) => route.fulfill({ json: { identity: {
    subject: "finance-operator", sessionId: "finance-operator", role: "operator",
    permissions: financeAllowed ? ["operations", "finance"] : ["operations"],
    surface: "control-panel", expiresAt: "2099-01-01T00:00:00Z",
  } } }));
  await page.route("**/api/notifications**", (route) => route.fulfill({ json: { notifications: [], unreadCount: 0 } }));
  await page.route("**/api/operations?**", (route) => route.fulfill({ json: { operations: [
    { orderId: "compensation-order", storeName: "متجر التعويض", state: "DELIVERED", updatedAt: "2026-10-15T12:30:00Z", assignment: null },
  ], nextCursor: "" } }));
  const order = {
    id: "compensation-order",
    storeId: "store-compensation",
    state: "DELIVERED",
    fulfillmentMode: "BTHWANI_CAPTAIN",
    addressText: "صنعاء",
    createdAt: "2026-10-15T12:00:00Z",
    updatedAt: "2026-10-15T12:30:00Z",
    totalAmountMinor: 3000,
    subtotalAmountMinor: 3000,
    discountMinor: 0,
    currency: "YER",
    paymentMethod: "CASH_ON_DELIVERY",
    paymentState: "REQUIRES_COLLECTION",
    cashAmountMinor: 0,
    adjustments: [{
      id: "adjustment-1", orderLineId: "line-1",
      kind: "REMOVE_ITEM", state: "FINANCIAL_RECONCILIATION_REQUIRED",
    }],
    lines: [{
      id: "line-1", productName: "صنف ناقص", variantTitle: "",
      finalQuantityBaseUnits: 1, baseUnit: "COUNT", lineAmountMinor: 1000, currency: "YER",
    }],
  };
  await page.route("**/api/operations/compensation-order", (route) => route.fulfill({ json: { operation: { storeName: "متجر التعويض", order, assignment: null } } }));
  let mutations = 0;
  await page.route("**/api/finance/order-wallet-compensation", async (route) => {
    mutations++;
    await route.fulfill({ json: { walletCompensation: {
      orderId: "compensation-order", amountMinor: 1000, ledgerTransactionId: "ledger-confirmed",
    } } });
  });

  await page.goto("/operations?state=DELIVERED");
  await page.getByRole("button", { name: "فتح الطلب compensation-order" }).click();
  const drawer = page.getByRole("dialog", { name: "تفاصيل الطلب compensation-order" });
  const trigger = drawer.getByRole("button", { name: /تعويض المحفظة/ });
  await expect(trigger).toBeVisible();
  await trigger.click();
  let confirmation = page.getByRole("dialog", { name: "تأكيد تعويض محفظة العميل" });
  await expect(confirmation).toBeVisible();
  await expect(confirmation).toContainText("على نفقة المنصة");
  await page.keyboard.press("Escape");
  await expect(confirmation).toHaveCount(0);
  await expect(drawer).toBeVisible();
  expect(mutations).toBe(0);

  await trigger.click();
  confirmation = page.getByRole("dialog", { name: "تأكيد تعويض محفظة العميل" });
  await confirmation.getByRole("button", { name: "إلغاء" }).click();
  expect(mutations).toBe(0);

  await trigger.click();
  confirmation = page.getByRole("dialog", { name: "تأكيد تعويض محفظة العميل" });
  await confirmation.getByRole("button", { name: "تأكيد إضافة التعويض" }).click();
  await expect(drawer.locator(".success-inline[role=status]")).toContainText("تم تسجيل");
  await expect(drawer).toContainText("أُضيف التعويض إلى محفظة العميل");
  expect(mutations).toBe(1);
  await expect(drawer.getByRole("button", { name: /تعويض المحفظة/ })).toHaveCount(0);

  financeAllowed = false;
  await page.reload();
  await page.getByRole("button", { name: "فتح الطلب compensation-order" }).click();
  await expect(page.getByRole("dialog", { name: "تفاصيل الطلب compensation-order" })
    .getByRole("button", { name: /تعويض المحفظة/ })).toHaveCount(0);
  expect(mutations).toBe(1);
});
