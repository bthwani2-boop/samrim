import { expect, test } from "@playwright/test";

test("operator exception lanes and time since last change show server-backed facts", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-10-14T12:00:00Z") });
  const identity = {
    subject: "actor-ops-staleness", sessionId: "ops-staleness-session",
    role: "operator", permissions: ["operations"], surface: "control-panel",
    expiresAt: "2099-01-01T00:00:00Z",
  };
  await page.route("**/api/auth/session**", (route) => route.fulfill({ json: { identity } }));
  await page.route("**/api/auth/profile**", (route) => route.fulfill({ json: { phoneE164: "+967700000000" } }));
  await page.route("**/api/notifications**", (route) => route.fulfill({ json: { notifications: [], unreadCount: 0 } }));
  const states: string[] = [];
  await page.route("**/api/operations?**", (route) => {
    const state = new URL(route.request().url()).searchParams.get("state") ?? "CREATED";
    states.push(state);
    return route.fulfill({ json: {
      operations: [{ orderId: "order-ops-age", storeName: "متجر تجريبي",
        state, updatedAt: "2026-10-14T10:58:00Z", assignment: null }],
      nextCursor: "",
    } });
  });
  await page.goto("/operations?lane=exceptions&sub=delivery-failed");
  await expect(page.getByRole("link", { name: "تعثر التسليم" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("تعثر التوصيل", { exact: true })).toBeVisible();
  await expect(page.getByText(/في هذه الصفحة: 1 طلبات تحتاج مراجعة/)).toBeVisible();
  await page.getByRole("link", { name: "الطلبات المرفوضة" }).click();
  await expect(page.getByText("مغلق", { exact: true })).toBeVisible();
  expect(states).toContain("DELIVERY_FAILED");
  expect(states).toContain("REJECTED");
});
