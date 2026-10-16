import { expect, test } from "@playwright/test";

const identity = {
  subject: "operations-mobile-operator", sessionId: "operations-mobile-session",
  role: "operator", permissions: ["operations"], surface: "control-panel",
  expiresAt: "2099-01-01T00:00:00.000Z",
};
const orders = [
  { orderId: "order-mobile-1", storeName: "مطعم سبأ", state: "READY_FOR_DISPATCH", updatedAt: "2026-10-16T12:00:00Z", assignment: null },
  { orderId: "order-mobile-2", storeName: "سوبر ماركت الخير", state: "DELIVERED", updatedAt: "2026-10-16T11:55:00Z", assignment: { state: "DELIVERED" } },
];

test("operator orders use actionable readable cards on narrow screens and preserve desktop table", async ({ page }) => {
  await page.route("**/api/auth/session**", (route) => route.fulfill({ json: { identity } }));
  await page.route("**/api/operations?**", (route) => route.fulfill({ json: {
    operations: orders,
    nextCursor: "",
    summary: { totalCount: 2, actionableCount: 1, awaitingDispatchCount: 1, activeCount: 1, deliveredCount: 1, measuredAt: "2026-10-16T12:00:00Z" },
  }}));
  await page.route("**/api/notifications**", (route) => route.fulfill({ json: { notifications: [], unreadCount: 0, nextCursor: "" } }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/operations");
  await expect(page.locator(".ops-mobile-order")).toHaveCount(2);
  await expect(page.locator(".ops-list-table")).toBeHidden();
  await expect(page.locator(".ops-mobile-order").first()).toContainText("مطعم سبأ");
  await expect(page.locator(".ops-mobile-order").first()).toContainText("غير مسند");
  await expect(page.locator(".ops-mobile-order").first().getByRole("button", { name: "فتح طلب من مطعم سبأ" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  await page.locator(".ops-mobile-order").first().getByRole("button", { name: "فتح طلب من مطعم سبأ" }).click();
  await expect(page.getByRole("region", { name: "ملف الطلب" })).toBeVisible();
  await expect(page.locator(".adaptive-record-workspace")).toHaveAttribute("data-split", "false");

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator(".ops-list-table")).toBeVisible();
  await expect(page.locator(".ops-mobile-orders")).toBeHidden();
});
