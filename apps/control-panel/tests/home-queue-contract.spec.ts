import { expect, test } from "@playwright/test";

test("home does not mistake malformed owner queue responses for no work, and recovers", async ({ page }) => {
  let valid = false;
  await page.route("**/api/auth/session**", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ identity: {
      subject: "operator-home-probe", sessionId: "home-probe", role: "operator",
      permissions: ["operations", "partners", "catalog"], surface: "control-panel",
      expiresAt: "2099-01-01T00:00:00.000Z",
    } }),
  }));
  await page.route("**/api/operations?**", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify(valid ? { operations: [] } : {}),
  }));
  await page.route("**/api/partners/joining-cases?**", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify(valid ? { cases: [] } : { cases: null }),
  }));
  await page.route("**/api/catalog/proposals?**", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify(valid ? { proposals: [] } : { proposals: "not-an-array" }),
  }));
  await page.route("**/api/notifications?**", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ notifications: [], unreadCount: 0 }),
  }));

  await page.goto("/workspace");
  await expect(page.locator("section[aria-labelledby=home-operations-title]").getByRole("link", { name: "عرض الكل" })).toHaveAttribute("href", "/operations?lane=attention");
  await expect(page.locator(".home-queue-error")).toHaveCount(4);
  await expect(page.getByText("لا توجد طلبات في هذه القائمة.")).toHaveCount(0);
  await expect(page.getByText("لا توجد إحالات في هذه القائمة.")).toHaveCount(0);
  await expect(page.getByText("لا توجد مقترحات في هذه القائمة.")).toHaveCount(0);
  await expect(page.getByText("لا توجد إشعارات غير مقروءة.")).toBeVisible();

  valid = true;
  await page.getByRole("button", { name: "تحديث", exact: true }).click();
  await expect(page.locator(".home-queue-error")).toHaveCount(0);
  await expect(page.getByText("لا توجد طلبات في هذه القائمة.")).toHaveCount(2);
  await expect(page.getByText("لا توجد إحالات في هذه القائمة.")).toBeVisible();
  await expect(page.getByText("لا توجد مقترحات في هذه القائمة.")).toBeVisible();
});
