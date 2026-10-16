import { expect, test } from "./coverage-fixtures";

test("operations preserve canonical server order while making later exceptions visible", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-10-15T14:00:00Z") });
  await page.route("**/api/auth/session**", (route) => route.fulfill({ json: { identity: {
    subject: "ops-review", sessionId: "ops-review", role: "operator", permissions: ["operations"],
    surface: "control-panel", expiresAt: "2099-01-01T00:00:00Z",
  } } }));
  await page.route("**/api/notifications**", (route) => route.fulfill({ json: { notifications: [], unreadCount: 0 } }));
  const serverRows = [
    { orderId: "recent-order", storeName: "المتجر الأحدث", state: "DELIVERED", updatedAt: "2026-10-15T13:59:00Z", assignment: { state: "delivered", captainActorId: "captain-identified-2026-sanaa" } },
    { orderId: "older-order", storeName: "المتجر المتعثر", state: "READY_FOR_DISPATCH", updatedAt: "2026-10-15T12:40:00Z", assignment: null },
  ];
  await page.route("**/api/operations?**", (route) => route.fulfill({ json: { operations: serverRows, nextCursor: "" } }));
  await page.goto("/operations");
  const rows = page.locator(".ops-list-table tbody tr");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("المتجر الأحدث");
  await expect(rows.nth(0).locator(".ops-captain-cell")).toContainText("تم التسليم");
  await expect(rows.nth(0).locator(".ops-captain-cell")).not.toContainText("captain-identified-2026-sanaa");
  await expect(rows.nth(1)).toContainText("المتجر المتعثر");
  await expect(rows.nth(1)).toContainText("أكثر من ساعة دون تحديث");
  await expect(rows.nth(1).locator(".ops-row-followup .record-indicator")).toContainText("إرسال للتوزيع");
  await expect(rows.nth(1)).toHaveClass(/ops-row-review/);
});
