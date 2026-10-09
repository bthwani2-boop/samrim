import { expect, type Page, test } from "@playwright/test";

const operatorSession = {
  subject: "actor-operator",
  sessionId: "session-operator",
  role: "operator",
  permissions: ["catalog"],
  canManageOperatorPermissions: true,
  surface: "control-panel",
  expiresAt: "2099-01-01T00:00:00.000Z",
};

async function stubAuthenticatedSession(page: Page) {
  await page.route("**/api/auth/session**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ identity: operatorSession }) });
  });
}

test("operator access filters stay mounted through no results, loading, and errors", async ({ page }) => {
  await stubAuthenticatedSession(page);
  await page.route("**/api/access/operators**", async (route) => {
    const query = new URL(route.request().url()).searchParams.get("q");
    if (query === "تعطل") {
      await new Promise((resolve) => setTimeout(resolve, 300));
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { message: "الخدمة غير متاحة" } }) });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: query ? [] : [{ actorId: "actor-operator-2", role: "operator", phoneE164: "+967770000002", enabled: true, securityEnabled: true, activatedAt: "2026-10-01T00:00:00.000Z", fullNameAr: "مشغّل تجريبي", jobTitle: "المراجعة", department: "التشغيل", operatorEnabledPermissionCount: 1 }] }),
    });
  });

  await page.goto("/access?view=permissions");
  const search = page.getByLabel("بحث بالاسم أو الهاتف أو المسمى أو القسم");
  await expect(search).toBeVisible();
  await search.fill("لا يوجد");
  await search.press("Enter");
  await expect(page.getByText("لا توجد حسابات مطابقة")).toBeVisible();
  await expect(search).toBeVisible();
  await expect(search).toBeFocused();
  await expect(page.getByLabel("تصفية حسب حالة الدور")).toBeVisible();
  await expect(page.getByLabel("تصفية حسب نطاق الصلاحيات")).toBeVisible();

  await search.fill("تعطل");
  await search.press("Enter");
  await expect(page.getByText("جارٍ قراءة المشغّلين…")).toBeVisible();
  await expect(search).toBeVisible();
  await expect(search).toBeFocused();
  await expect(page.getByLabel("تصفية حسب حالة الدور")).toBeVisible();
  await expect(page.locator(".managed-status-warning[role='alert']")).toContainText("تعذر تحديث القائمة");
  await expect(search).toBeVisible();
  await expect(search).toBeFocused();
  await expect(page.getByLabel("تصفية حسب نطاق الصلاحيات")).toBeVisible();
});

test("operator profile filters stay mounted when search has no matches", async ({ page }) => {
  await stubAuthenticatedSession(page);
  await page.route("**/api/access/operator-profiles**", async (route) => {
    const query = new URL(route.request().url()).searchParams.get("q");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: query ? [] : [{ id: "profile-1", version: 1, state: "pending_review", fullNameAr: "مشغّل تجريبي", phoneE164: "+967770000003", jobTitle: "المراجعة", department: "التشغيل", roleEnabled: false, securityEnabled: true, activatedAt: null, createdAt: "2026-10-01T00:00:00.000Z" }] }),
    });
  });

  await page.goto("/access");
  const search = page.getByLabel("بحث بالاسم أو الهاتف");
  await expect(search).toBeVisible();
  await search.fill("لا يوجد");
  await search.press("Enter");
  await expect(page.getByText("لا توجد ملفات مطابقة")).toBeVisible();
  await expect(search).toBeVisible();
  await expect(search).toBeFocused();
  await expect(page.getByLabel("تصفية حسب المرحلة")).toBeVisible();
});

test("notification refresh errors preserve the page being read", async ({ page }) => {
  await stubAuthenticatedSession(page);
  let requestCount = 0;
  await page.route("**/api/notifications**", async (route) => {
    requestCount += 1;
    if (requestCount > 1) {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { message: "الخدمة غير متاحة" } }) });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ unreadCount: 1, nextCursor: "notifications:next-page", notifications: [{ id: "notification-1", kind: "ORDER_CREATED", title: "طلب جديد 123", body: "تم تسجيل طلب جديد", orderId: "order-123", createdAt: "2026-10-01T00:00:00.000Z", readAt: null }] }),
    });
  });

  await page.goto("/notifications");
  await expect(page.getByText("طلب جديد 123")).toBeVisible();
  await page.getByRole("button", { name: "تحديث الإشعارات" }).click();
  await expect(page.locator(".managed-status-warning[role='alert']")).toContainText("الخدمة غير متاحة");
  await expect(page.getByText("طلب جديد 123")).toBeVisible();
  await expect(page.getByRole("button", { name: "الأقدم" })).toBeEnabled();
});
