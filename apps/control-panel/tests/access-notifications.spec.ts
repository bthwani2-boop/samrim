import { expect, type Page, test } from "@playwright/test";

const operatorSession = {
  subject: "actor-operator", sessionId: "session-operator", role: "operator",
  permissions: ["catalog"], canManageOperatorPermissions: true,
  surface: "control-panel", expiresAt: "2099-01-01T00:00:00.000Z",
};

async function stubAuthenticatedSession(page: Page) {
  await page.route("**/api/auth/session**", (route) => route.fulfill({ json: { identity: operatorSession } }));
}

test("unified access search controls remain usable on empty results and partial source errors", async ({ page }) => {
  await stubAuthenticatedSession(page);
  await page.route("**/api/access/hr-requests?**", (route) => route.fulfill({ json: { items: [], nextCursor: "" } }));
  await page.route("**/api/access/operator-profiles**", (route) => route.fulfill({ json: { items: [], nextCursor: "" } }));
  await page.route("**/api/access/operators?**", async (route) => {
    const q = new URL(route.request().url()).searchParams.get("q");
    if (q === "تعطل") return route.fulfill({ status: 503, json: { error: { message: "الخدمة غير متاحة" } } });
    return route.fulfill({ json: { items: q ? [] : [{
      actorId: "actor-operator-2", role: "operator", phoneE164: "+967770000002",
      enabled: true, securityEnabled: true, activatedAt: "2026-10-01T00:00:00Z",
      createdAt: "2026-10-01T00:00:00Z", fullNameAr: "مشغّل تجريبي",
      jobTitle: "المراجعة", department: "التشغيل", operatorEnabledPermissionCount: 1,
    }], nextCursor: "" } });
  });
  await page.goto("/access?view=permissions");
  const search = page.getByRole("textbox", { name: "بحث عن موظف أو مشغّل" });
  await expect(search).toBeVisible();
  await search.fill("لا يوجد");
  await search.press("Enter");
  await expect(page.locator(".access-center-table").getByText("لا توجد سجلات مطابقة في النتائج المحمّلة")).toBeVisible();
  await expect(search).toBeVisible();
  await expect(search).toBeFocused();
  await expect(page.getByLabel("تصفية حسب نطاق الصلاحيات")).toBeVisible();

  await search.fill("تعطل");
  await search.press("Enter");
  await expect(page.locator(".managed-status-warning[role='alert']")).toContainText("بعض المصادر لم تُحمَّل");
  await expect(search).toBeVisible();
  await expect(search).toBeFocused();
});

test("operator profile search is server-backed and keeps the same unified filter", async ({ page }) => {
  await stubAuthenticatedSession(page);
  await page.route("**/api/access/hr-requests?**", (route) => route.fulfill({ json: { items: [], nextCursor: "" } }));
  await page.route("**/api/access/operators?**", (route) => route.fulfill({ json: { items: [], nextCursor: "" } }));
  await page.route("**/api/access/operator-profiles**", (route) => {
    const q = new URL(route.request().url()).searchParams.get("q");
    return route.fulfill({ json: { items: q ? [] : [{
      id: "profile-1", version: 1, state: "pending_review", fullNameAr: "مشغّل تجريبي",
      phoneE164: "+967770000003", jobTitle: "المراجعة", department: "التشغيل",
      roleEnabled: false, securityEnabled: true, createdAt: "2026-10-01T00:00:00Z",
    }], nextCursor: "" } });
  });
  await page.goto("/access?view=operators");
  const input = page.getByRole("textbox", { name: "بحث عن موظف أو مشغّل" });
  await input.fill("لا يوجد");
  await input.press("Enter");
  await expect(page.locator(".access-center-table").getByText("لا توجد سجلات مطابقة في النتائج المحمّلة")).toBeVisible();
  await expect(input).toBeFocused();
  await expect(page.getByRole("combobox", { name: "عرض" })).toHaveValue("profiles");
});

test("failed operator approval remains in context and offers a non-destructive retry", async ({ page }) => {
  await stubAuthenticatedSession(page);
  await page.route("**/api/access/hr-requests?**", (route) => route.fulfill({ json: { items: [], nextCursor: "" } }));
  await page.route("**/api/access/operators?**", (route) => route.fulfill({ json: { items: [], nextCursor: "" } }));
  await page.route("**/api/access/operator-profiles**", (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { items: [{
      id: "profile-1", version: 1, state: "pending_review", fullNameAr: "مشغّل تجريبي",
      phoneE164: "+967770000003", jobTitle: "المراجعة", department: "التشغيل",
      roleEnabled: false, securityEnabled: true, createdAt: "2026-10-01T00:00:00Z",
    }], nextCursor: "" } });
    return route.fulfill({ status: 503, json: { error: { code: "UNAVAILABLE" } } });
  });
  await page.goto("/access?view=operators");
  await page.locator(".access-center-table").getByRole("button", { name: "اعتماد الملف" }).click();
  const drawer = page.locator(".adaptive-record-detail");
  await drawer.getByRole("button", { name: "اعتماد الملف" }).click();
  await expect(drawer).toContainText("تعذر إكمال الإجراء (503)");
  await expect(drawer.getByRole("button", { name: "اعتماد الملف" })).toBeEnabled();
  await page.getByRole("button", { name: "إغلاق التفاصيل" }).click();
  await expect(page.locator(".access-center-table").getByRole("button", { name: "اعتماد الملف" })).toBeVisible();
});

test("notification refresh errors preserve the page being read", async ({ page }) => {
  await page.clock.install();
  await stubAuthenticatedSession(page);
  let requestCount = 0;
  await page.route("**/api/notifications**", async (route) => {
    requestCount += 1;
    if (requestCount > 1) {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { message: "الخدمة غير متاحة" } }) });
      return;
    }
    await route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ unreadCount: 1, nextCursor: "notifications:next-page", notifications: [{ id: "notification-1", kind: "ORDER_CREATED", title: "طلب جديد 123", body: "تم تسجيل طلب جديد", orderId: "order-123", createdAt: "2026-10-01T00:00:00.000Z", readAt: null }] }),
    });
  });
  await page.goto("/notifications");
  await expect(page.getByText("طلب جديد 123")).toBeVisible();
  await page.clock.fastForward(31_000);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator(".managed-status-warning[role='alert']")).toContainText("الخدمة غير متاحة");
  await expect(page.getByText("طلب جديد 123")).toBeVisible();
  await expect(page.getByRole("button", { name: "الأقدم" })).toBeEnabled();
});
