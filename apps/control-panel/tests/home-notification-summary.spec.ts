import { expect, type Page, test } from "@playwright/test";

const session = {
  subject: "actor-operator", sessionId: "test-session", role: "operator",
  permissions: [], surface: "control-panel", expiresAt: "2099-01-01T00:00:00.000Z",
};
const readNotification = {
  id: "notification-read", kind: "ORDER_CREATED", title: "تحديث طلب سابق",
  body: "تم تحديث الحالة", createdAt: "2026-10-11T10:00:00.000Z",
  readAt: "2026-10-11T11:00:00.000Z",
};

async function auth(page: Page) {
  await page.route("**/api/auth/session**", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ identity: session }),
  }));
}

test("home distinguishes authoritative unread total from the visible latest page", async ({ page }) => {
  await auth(page);
  let seenLimit = "";
  await page.route("**/api/notifications?**", (route) => {
    seenLimit = new URL(route.request().url()).searchParams.get("limit") ?? "";
    return route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ notifications: [readNotification], unreadCount: 17, nextCursor: "older" }),
    });
  });
  await page.goto("/workspace");
  await expect(page.getByRole("heading", { name: "أحدث الإشعارات غير المقروءة" })).toBeVisible();
  await expect(page.getByText("إجمالي غير المقروءة: 17")).toBeVisible();
  await expect(page.getByText(/توجد إشعارات غير مقروءة في صفحات أقدم/)).toBeVisible();
  await expect(page.getByText("لا توجد إشعارات غير مقروءة.", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "عرض الكل" })).toHaveAttribute("href", "/notifications");
  expect(seenLimit).toBe("50");
});

test("home does not turn unknown counts or failed reads into zero", async ({ page }) => {
  await page.clock.install();
  await auth(page);
  let mode: "missing" | "failed" | "recovered" = "missing";
  await page.route("**/api/notifications?**", (route) => {
    if (mode === "failed") return route.fulfill({
      status: 503, contentType: "application/json",
      body: JSON.stringify({ error: { message: "الخدمة غير متاحة" } }),
    });
    return route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ notifications: [], ...(mode === "recovered" ? { unreadCount: 0 } : {}) }),
    });
  });
  await page.goto("/workspace");
  await expect(page.getByText("العدد الإجمالي غير متاح")).toBeVisible();
  await expect(page.getByText(/عدد الإشعارات غير معروف/)).toBeVisible();
  mode = "failed";
  await page.clock.fastForward(31_000);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator(".home-queue-error")).toContainText("تعذرت القراءة");
  await expect(page.getByText("لا توجد إشعارات غير مقروءة.", { exact: true })).toHaveCount(0);
  mode = "recovered";
  await page.getByRole("button", { name: "إعادة المحاولة", exact: true }).click();
  await expect(page.getByText("إجمالي غير المقروءة: 0")).toBeVisible();
  await expect(page.getByText("لا توجد إشعارات غير مقروءة.", { exact: true })).toBeVisible();
});

test("notification inbox keeps an unknown global unread total unlabeled as zero", async ({ page }) => {
  await auth(page);
  await page.route("**/api/notifications?**", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ notifications: [readNotification], nextCursor: "" }),
  }));
  await page.goto("/notifications");
  await expect(page.getByText("تحديث طلب سابق")).toBeVisible();
  await expect(page.getByText("0 إشعارات غير مقروءة")).toHaveCount(0);
  await expect(page.getByText("1 إشعارًا في الصفحة")).toBeVisible();
});
