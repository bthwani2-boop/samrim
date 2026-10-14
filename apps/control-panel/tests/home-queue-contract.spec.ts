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
  await expect(page.locator("section[aria-labelledby=home-queue-operations-title]").getByRole("link", { name: "فتح القائمة" })).toHaveAttribute("href", "/operations?lane=attention");
  await expect(page.locator(".home-queue-error")).toHaveCount(4);
  await expect(page.getByText("لا عناصر في هذه المعاينة.")).toHaveCount(0);
  await expect(page.getByText("أنت على اطلاع؛ لا إشعارات غير مقروءة.")).toBeVisible();

  valid = true;
  await page.getByRole("button", { name: "إعادة المحاولة", exact: true }).click();
  await expect(page.locator(".home-queue-error")).toHaveCount(0);
  await expect(page.getByText("لا عناصر في معاينات العمل الحالية.")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "فتح قوائم العمل" }).getByRole("link")).toHaveCount(4);
  await expect(page.getByText("لا عناصر في هذه المعاينة.")).toHaveCount(0);
});

test("home renders invalid JSON as a localized recoverable queue error", async ({ page }) => {
  let valid = false;
  await page.route("**/api/auth/session**", (route) => route.fulfill({ json: { identity: {
    subject: "operator-json-proof", sessionId: "session", role: "operator", permissions: ["operations"],
    surface: "control-panel", expiresAt: "2099-01-01T00:00:00.000Z",
  } } }));
  await page.route("**/api/operations?**", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: valid ? JSON.stringify({ operations: [] }) : "{invalid-json",
  }));
  await page.route("**/api/notifications?**", (route) => route.fulfill({ json: { notifications: [], unreadCount: 0 } }));
  await page.goto("/workspace");
  const queue = page.locator("section[aria-labelledby=home-queue-operations-title]");
  await expect(queue.getByRole("alert")).toContainText("استجابة قائمة العمل غير صالحة.");
  await expect(queue.getByText("لا عناصر في هذه المعاينة.")).toHaveCount(0);
  valid = true;
  await page.getByRole("button", { name: "إعادة المحاولة", exact: true }).click();
  await expect(queue.getByRole("alert")).toHaveCount(0);
  await expect(page.getByText("لا عناصر في معاينات العمل الحالية.")).toBeVisible();
});

test("home queue records expose their real state, update time, and canonical detail link", async ({ page }) => {
  await page.route("**/api/auth/session**", (route) => route.fulfill({ json: { identity: {
    subject: "operator-home-record", sessionId: "session", role: "operator", permissions: ["operations"],
    surface: "control-panel", expiresAt: "2099-01-01T00:00:00.000Z",
  } } }));
  await page.route("**/api/operations?**", (route) => route.fulfill({ json: { operations: [{
    orderId: "order-home-7", storeName: "مطعم الساحة", state: "PREPARING", updatedAt: "2026-10-13T13:45:00.000Z", assignment: null,
  }] } }));
  await page.route("**/api/notifications?**", (route) => route.fulfill({ json: { notifications: [], unreadCount: 0 } }));

  await page.goto("/workspace");
  const queue = page.getByRole("region", { name: "طلبات تحتاج إجراءً" });
  const record = queue.getByRole("link", { name: /مطعم الساحة/ });
  await expect(record).toHaveAttribute("href", "/operations/order-home-7");
  await expect(record).toContainText("مطعم الساحة");
  await expect(record).toContainText("آخر تحديث");
  await expect(record.locator("time")).toHaveAttribute("datetime", "2026-10-13T13:45:00.000Z");
});

test("home explains a timed-out queue in Arabic and keeps retry available", async ({ page }) => {
  await page.route("**/api/auth/session**", (route) => route.fulfill({ json: { identity: {
    subject: "operator-home-timeout", sessionId: "session", role: "operator", permissions: ["operations"],
    surface: "control-panel", expiresAt: "2099-01-01T00:00:00.000Z",
  } } }));
  await page.route("**/api/operations?**", (route) => route.abort("timedout"));
  await page.route("**/api/notifications?**", (route) => route.fulfill({ json: { notifications: [], unreadCount: 0 } }));

  await page.goto("/workspace");
  const queue = page.getByRole("region", { name: "طلبات تحتاج إجراءً" });
  await expect(queue.getByRole("alert")).toContainText("انتهت مهلة الاتصال بالقائمة");
  await expect(queue.getByRole("alert")).not.toContainText(/fetch|timed out|signal/i);
  await expect(page.getByRole("button", { name: "إعادة المحاولة", exact: true })).toBeVisible();
});

test("home keeps its work and notification areas readable without mobile overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/auth/session**", (route) => route.fulfill({ json: { identity: {
    subject: "operator-home-mobile", sessionId: "session", role: "operator", permissions: ["operations", "partners", "catalog"],
    surface: "control-panel", expiresAt: "2099-01-01T00:00:00.000Z",
  } } }));
  await page.route("**/api/operations?**", (route) => route.fulfill({ json: { operations: [] } }));
  await page.route("**/api/partners/joining-cases?**", (route) => route.fulfill({ json: { cases: [] } }));
  await page.route("**/api/catalog/proposals?**", (route) => route.fulfill({ json: { proposals: [] } }));
  await page.route("**/api/notifications?**", (route) => route.fulfill({ json: { notifications: [], unreadCount: 22 } }));

  await page.goto("/workspace");
  await expect(page.locator(".home-dashboard")).toBeVisible();
  const geometry = await page.evaluate(() => {
    const work = document.querySelector(".home-priority-work")?.getBoundingClientRect();
    const notifications = document.querySelector(".home-notifications")?.getBoundingClientRect();
    return { clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth, workTop: work?.top, notificationsTop: notifications?.top };
  });
  if (geometry.workTop === undefined || geometry.notificationsTop === undefined) throw new Error("Home areas are missing from the mobile layout.");
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
  expect(geometry.notificationsTop).toBeGreaterThan(geometry.workTop);
  await expect(page.getByRole("navigation", { name: "فتح قوائم العمل" }).getByRole("link")).toHaveCount(4);
  await expect(page.locator(".home-unread-total")).toContainText("إجمالي غير المقروءة: ٢٢");
});
