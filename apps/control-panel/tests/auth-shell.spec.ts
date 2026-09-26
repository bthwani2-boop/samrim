import { expect, type Page, test } from "@playwright/test";

async function stubSession(page: Page, status: number) {
  await page.route("**/api/auth/session**", async (route) => {
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(status === 401 ? { error: { code: "UNAUTHENTICATED" } } : { error: { code: "IDENTITY_UNAVAILABLE" } }),
    });
  });
}

const authenticatedOperator = {
  subject: "actor-operator",
  sessionId: "session-operator",
  role: "operator",
  permissions: ["operations", "partners", "catalog", "marketing", "finance", "platform_policies"],
  surface: "control-panel",
  expiresAt: "2099-01-01T00:00:00.000Z",
};

async function stubAuthenticatedSession(page: Page, permissions = authenticatedOperator.permissions, canManageOperatorPermissions = false) {
  await page.route("**/api/auth/session**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ identity: { ...authenticatedOperator, permissions, ...(canManageOperatorPermissions ? { canManageOperatorPermissions: true } : {}) } }) });
  });
}

test("signed-out access to a protected workspace route returns to the identity surface", async ({ page }) => {
  await stubSession(page, 401);
  await page.goto("/workspace");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "الدخول بمفتاح المرور" })).toBeVisible();
});

test("authenticated operator discovers the platform centers through workspace navigation", async ({ page }) => {
  await stubAuthenticatedSession(page, [...authenticatedOperator.permissions, "operations", "partners", "catalog"], true);
  let homeRequestsActionableOrders = false;
  let homeRequestsCatalogQueue = false;
  await page.route("**/api/operations**", async (route) => {
    homeRequestsActionableOrders = new URL(route.request().url()).searchParams.get("actionableOnly") === "true";
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ operations: [] }) });
  });
  await page.route("**/api/partners/joining-cases**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ cases: [] }) });
  });
  await page.route("**/api/catalog/proposals**", async (route) => {
    homeRequestsCatalogQueue = new URL(route.request().url()).searchParams.get("state") === "submitted";
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ proposals: [{ id: "proposal-home", partnerActorId: "partner-home", verticalId: "grocery", categoryId: "coffee", proposedName: "قهوة للمراجعة", proposedVariantTitle: "الافتراضي", proposedMeasurementKind: "DISCRETE", proposedBaseUnit: "COUNT", state: "submitted", version: 1, createdAt: "2026-09-18T00:00:00.000Z", updatedAt: "2026-09-18T00:00:00.000Z" }] }) });
  });
  await page.route("**/api/notifications**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ notifications: [], unreadCount: 0 }) });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await expect(page).toHaveURL(/\/workspace$/);
  await expect(page.getByRole("heading", { name: "الرئيسية" })).toBeVisible();
  await expect.poll(() => homeRequestsActionableOrders).toBe(true);
  await expect.poll(() => homeRequestsCatalogQueue).toBe(true);
  await expect(page.getByRole("heading", { name: "مقترحات منتجات للمراجعة" })).toBeVisible();
  await expect(page.getByRole("link", { name: /قهوة للمراجعة/ })).toHaveAttribute("href", "/catalog/proposals?proposalId=proposal-home");
  await expect(page.getByRole("heading", { name: "إشعارات غير مقروءة" })).toBeVisible();
  const navigationToggle = page.getByRole("button", { name: "فتح مسارات العمل" });
  await navigationToggle.click();
  await expect(page.getByRole("navigation", { name: "تنقل مساحة المشغل" })).toHaveAttribute("data-open", "true");
  const accessLink = page.getByRole("link", { name: "الوصول والصلاحيات" });
  await expect(accessLink).toBeVisible();
  await accessLink.click();
  await expect(page).toHaveURL(/\/access$/);
  await expect(page.locator('#workspace-navigation a[href="/access"][aria-current="page"]')).toHaveAttribute("href", "/access");
  await expect(page.getByRole("heading", { name: "مشغّلو لوحة التحكم والصلاحيات" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "إدارة حسابات مشغّلي لوحة التحكم" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("#workspace-main")).toBeFocused();

  await page.reload();
  await expect(page.getByRole("heading", { name: "مشغّلو لوحة التحكم والصلاحيات" })).toBeVisible();
});

test("operator home reads only work queues covered by the current session permissions", async ({ page }) => {
  await stubAuthenticatedSession(page, ["finance"]);
  const deniedQueueRequests = new Set<string>();
  for (const endpoint of ["operations", "partners/joining-cases", "catalog/proposals"]) {
    await page.route(`**/api/${endpoint}**`, async (route) => {
      deniedQueueRequests.add(endpoint);
      await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: { code: "FORBIDDEN", message: "forbidden" } }) });
    });
  }
  await page.route("**/api/notifications**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ notifications: [], unreadCount: 0 }) });
  });

  await page.goto("/workspace");
  await expect(page.getByRole("heading", { name: "الرئيسية" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "إشعارات غير مقروءة" })).toBeVisible();
  expect([...deniedQueueRequests]).toEqual([]);
  await expect(page.getByRole("heading", { name: "طلبات تحتاج إجراءً" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "طلبات الانضمام المقدمة" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "مقترحات منتجات للمراجعة" })).toHaveCount(0);
});

test("authenticated operator can open the notification center from the workspace header", async ({ page }) => {
  await stubAuthenticatedSession(page);
  await page.route("**/api/notifications**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ notifications: [], unreadCount: 0 }) });
  });
  await page.goto("/workspace");

  const notificationLink = page.getByRole("link", { name: "الإشعارات", exact: true }).first();
  await expect(notificationLink).toBeVisible();
  await notificationLink.click();
  await expect(page).toHaveURL(/\/notifications$/);
  await expect(page.getByRole("heading", { name: "الإشعارات", exact: true })).toBeVisible();
  await expect(page.getByText("لا توجد إشعارات حالياً", { exact: true })).toBeVisible();
  await expect(notificationLink).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("navigation", { name: "تنقل مساحة المشغل" }).getByRole("link", { name: "الإشعارات", exact: true })).toHaveCount(0);
});

test("operator notification cards write back read state and update the unread summary", async ({ page }) => {
  await stubAuthenticatedSession(page);
  let read = false;
  await page.route("**/api/notifications**", async (route) => {
    if (route.request().method() === "POST") {
      read = true;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ notificationId: "order:1", readAt: "2026-09-22T11:00:00.000Z" }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ notifications: [{ id: "order:1", kind: "ORDER_CREATED", title: "وصل طلب جديد", body: "وصل طلب جديد إلى متجرك.", orderId: "order_1", createdAt: "2026-09-22T10:00:00.000Z", readAt: read ? "2026-09-22T11:00:00.000Z" : null }], unreadCount: read ? 0 : 1 }) });
  });
  await page.goto("/notifications");

  await expect(page.getByRole("button", { name: "وصل طلب جديد، جديد" })).toBeVisible();
  await page.getByRole("button", { name: "وصل طلب جديد، جديد" }).click();
  await expect(page.getByRole("button", { name: "وصل طلب جديد، مقروء" })).toBeVisible();
  await expect(page.getByText("0 إشعارات غير مقروءة", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "المقروءة", exact: true })).toBeVisible();
});

test("workspace routes keep one main landmark and an actor-specific page hierarchy", async ({ page }) => {
  test.setTimeout(120_000);
  await stubAuthenticatedSession(page, [...authenticatedOperator.permissions, "operations", "partners", "catalog"], true);
  const routes = [
    ["/workspace", "الرئيسية"],
    ["/notifications", "الإشعارات"],
    ["/access", "مشغّلو لوحة التحكم والصلاحيات"],
    ["/partners", "الشركاء"],
    ["/operations", "العمليات"],
    ["/finance", "المالية"],
    ["/captains", "قبول الكباتن"],
    ["/fields", "قبول الميدان"],
    ["/catalog", "المنتجات"],
    ["/policies", "مركز السياسات"],
  ] as const;

  for (const [path, heading] of routes) {
    await page.goto(path, { waitUntil: "commit" });
    await expect(page.locator("#workspace-main")).toHaveCount(1, { timeout: 30_000 });
    await expect(page.locator("#workspace-main > main")).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: heading, exact: true, level: 1 })).toBeVisible({ timeout: 30_000 });
    if (path !== "/notifications") {
      const navigation = page.getByRole("navigation", { name: "تنقل مساحة المشغل" });
      if (path === "/captains" || path === "/fields") {
        const owner = path === "/captains" ? "العمليات" : "الشركاء";
        const tab = path === "/captains" ? "الكباتن" : "الميدان";
        await expect(navigation.getByRole("link", { name: owner, exact: true })).toHaveAttribute("aria-current", "location", { timeout: 30_000 });
        await expect(page.getByRole("navigation", { name: `مسارات ${owner}` }).getByRole("link", { name: tab, exact: true })).toHaveAttribute("aria-current", "page", { timeout: 30_000 });
      } else {
        const navigationLabel = heading === "الرئيسية" ? "الرئيسية" : path === "/access" ? "الوصول والصلاحيات" : path === "/partners" ? "الشركاء" : path === "/operations" ? "العمليات" : path === "/finance" ? "المالية" : path === "/policies" ? "السياسات" : "الكتالوج";
        const currentState = path === "/catalog" ? "location" : "page";
        await expect(navigation.getByRole("link", { name: navigationLabel, exact: true })).toHaveAttribute("aria-current", currentState, { timeout: 30_000 });
      }
    }
  }
});

test("workspace navigation keeps captain operations and field partners in their owning centers", async ({ page }) => {
  await stubAuthenticatedSession(page, [...authenticatedOperator.permissions, "operations", "partners"]);
  const navigation = page.getByRole("navigation", { name: "تنقل مساحة المشغل" });

  await page.goto("/operations");
  const operationsTabs = page.getByRole("navigation", { name: "مسارات العمليات" });
  await expect(navigation.getByRole("link", { name: "العمليات", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(operationsTabs.getByRole("link", { name: "العمليات", exact: true })).toHaveCount(0);
  await expect(navigation.getByRole("link", { name: "الكباتن", exact: true })).toHaveCount(0);
  await expect(operationsTabs.getByRole("link", { name: "الكباتن", exact: true })).toHaveAttribute("href", "/captains");

  await page.goto("/captains");
  await expect(navigation.getByRole("link", { name: "العمليات", exact: true })).toHaveAttribute("aria-current", "location");
  await expect(navigation.getByRole("link", { name: "الكباتن", exact: true })).toHaveCount(0);
  await expect(operationsTabs.getByRole("link", { name: "الكباتن", exact: true })).toHaveAttribute("aria-current", "page");

  await page.goto("/fields");
  await expect(navigation.getByRole("link", { name: "الشركاء", exact: true })).toHaveAttribute("aria-current", "location");
  const partnerTabs = page.getByRole("navigation", { name: "مسارات الشركاء" });
  await expect(partnerTabs.getByRole("link", { name: "الميدان", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(navigation.getByRole("link", { name: "الميدان", exact: true })).toHaveCount(0);
  await expect(navigation.getByRole("link", { name: "الشركاء", exact: true })).toHaveCount(1);
});

test("partner registry, joining queue, and stores are separate workspace destinations", async ({ page }) => {
  await stubAuthenticatedSession(page, [...authenticatedOperator.permissions, "partners"]);
  const navigation = page.getByRole("navigation", { name: "تنقل مساحة المشغل" });

  await page.goto("/partners");
  await expect(page.getByRole("heading", { name: "الشركاء", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "سجل الشركاء التشغيلي" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "طابور حالات انضمام الشركاء" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "إضافة شريك", exact: true })).toHaveAttribute("href", "/partners/new");
  const partnerTabs = page.getByRole("navigation", { name: "مسارات الشركاء" });
  await expect(partnerTabs.getByRole("link", { name: "طلبات الانضمام", exact: true })).toHaveAttribute("href", "/partners/joining");
  await expect(partnerTabs.getByRole("link", { name: "المتاجر", exact: true })).toHaveAttribute("href", "/partners/stores");
  await expect(navigation.getByRole("link", { name: "طلبات الانضمام", exact: true })).toHaveCount(0);
  await expect(navigation.getByRole("link", { name: "المتاجر", exact: true })).toHaveCount(0);
  await expect(navigation.getByRole("link", { name: "إضافة شريك", exact: true })).toHaveCount(0);

  await page.goto("/partners/joining");
  await expect(page.getByRole("heading", { name: "طلبات انضمام الشركاء", exact: true })).toBeVisible();
  await expect(partnerTabs.getByRole("link", { name: "طلبات الانضمام", exact: true })).toHaveAttribute("aria-current", "page");

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "قبول إحالات الميدانيين", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "فتح الشركاء" }).first()).toHaveAttribute("href", "/partners/joining?state=admission_requested");
  await expect(page.getByRole("link", { name: "فتح الشركاء" }).nth(1)).toHaveAttribute("href", "/partners/joining?state=submitted");
});

test("finance and marketing centers expose only real independent resource routes", async ({ page }) => {
  await stubAuthenticatedSession(page, [...authenticatedOperator.permissions, "marketing"]);
  const navigation = page.getByRole("navigation", { name: "تنقل مساحة المشغل" });

  await page.goto("/finance");
  await expect(page.getByRole("heading", { name: "المالية", exact: true })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "حفظ النقد", exact: true })).toHaveAttribute("href", "/finance/cash-custody");
  await expect(navigation.getByRole("link", { name: "عمولات المتاجر", exact: true })).toHaveAttribute("href", "/finance/partner-store-commissions");

  await page.goto("/finance/cash-custody");
  await expect(page.getByRole("heading", { name: "حفظ النقد", exact: true })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "المالية", exact: true })).toHaveAttribute("aria-current", "location");
  await expect(navigation.getByRole("link", { name: "حفظ النقد", exact: true })).toHaveAttribute("aria-current", "page");

  await page.goto("/marketing/promotions");
  await expect(page.getByRole("heading", { name: "العروض", exact: true })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "التسويق والمحتوى", exact: true })).toHaveAttribute("aria-current", "location");
  await expect(navigation.getByRole("link", { name: "محتوى الاكتشاف", exact: true })).toHaveAttribute("href", "/marketing/content");
});

test("marketing resource pages keep promotions and discovery content separate", async ({ page }) => {
  await stubAuthenticatedSession(page, [...authenticatedOperator.permissions, "marketing"]);
  await page.route("**/api/marketing/promotions**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ promotions: [{ id: "promotion-1", code: "WELCOME10", nameAr: "خصم البداية", kind: "PERCENTAGE", valueMinor: 10, state: "DRAFT", version: 1 }] }) });
  });
  await page.route("**/api/marketing/content**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [{ id: "content-1", kind: "BANNER", titleAr: "مختارات الأسبوع", bodyAr: "اكتشف الجديد", state: "DRAFT", version: 1 }] }) });
  });
  await page.route("**/api/marketing/analytics**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [] }) });
  });
  await page.route("**/api/service-cities**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ cities: [{ id: "city-sanaa", displayNameAr: "صنعاء", active: true, version: 1 }] }) });
  });

  await page.goto("/marketing/promotions");
  await expect(page.getByTestId("marketing-promotions-workspace")).toBeVisible();
  await expect(page.getByText("خصم البداية")).toBeVisible();
  await expect(page.getByTestId("marketing-content-workspace")).toHaveCount(0);

  await page.goto("/marketing/content");
  await expect(page.getByTestId("marketing-content-workspace")).toBeVisible();
  await expect(page.getByText("مختارات الأسبوع")).toBeVisible();
  await expect(page.getByLabel("ملف صورة المحتوى")).toHaveAttribute("required", "");
  await expect(page.getByLabel("نوع وجهة المحتوى")).toHaveValue("INFO");
  await expect(page.getByLabel("مدينة خدمة المحتوى")).toContainText("صنعاء");
  await expect(page.getByTestId("marketing-promotions-workspace")).toHaveCount(0);
});

test("workspace shell exposes nested breadcrumbs and the current resource", async ({ page }) => {
  await stubAuthenticatedSession(page);
  await page.goto("/catalog/products");
  const breadcrumbs = page.getByRole("navigation", { name: "مسار الصفحة" });
  await expect(breadcrumbs.getByRole("link", { name: "الكتالوج", exact: true })).toHaveAttribute("href", "/catalog");
  await expect(breadcrumbs.locator('[aria-current="page"]')).toContainText("المنتجات");

  await page.goto("/policies/service-cities");
  await expect(page.getByRole("navigation", { name: "مسار الصفحة" }).locator('[aria-current="page"]')).toContainText("مدن الخدمة");
});

test("mobile workspace navigation restores focus and account menu owns appearance controls", async ({ page }) => {
  await stubAuthenticatedSession(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/workspace");

  const navigationToggle = page.getByRole("button", { name: "فتح مسارات العمل" });
  await navigationToggle.click();
  await page.keyboard.press("Escape");
  await expect(navigationToggle).toHaveAttribute("aria-expanded", "false");
  await expect(navigationToggle).toBeFocused();

  const accountMenu = page.locator("details.account-menu");
  await expect(accountMenu).not.toHaveAttribute("open", "");
  await accountMenu.locator("summary").click();
  await expect(accountMenu).toHaveAttribute("open", "");
  const operatorProfile = accountMenu.getByRole("region", { name: "ملف المشغّل" });
  await expect(operatorProfile).toBeVisible();
  await expect(operatorProfile).toContainText("مشغّل المنصة");
  await expect(operatorProfile).toContainText("جلسة نشطة");
  await expect(operatorProfile).toContainText("المالية");
  await expect(operatorProfile).toContainText("انتهاء الجلسة");
  await page.getByLabel("داكن").check();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("operator direct navigation to access exposes the canonical access capability", async ({ page }) => {
  await stubAuthenticatedSession(page, authenticatedOperator.permissions, true);
  await page.goto("/access");
  await expect(page.getByRole("heading", { name: "مشغّلو لوحة التحكم والصلاحيات" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "قائمة المشغّلين وصلاحياتهم" })).toBeVisible();
});

test("operator access keeps phone discovery separate from actorId mutation", async ({ page }) => {
  await stubAuthenticatedSession(page, authenticatedOperator.permissions, true);
  let mutationBody: Record<string, unknown> | undefined;
  await page.route("**/api/access/operators**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [{ actorId: "act_operator_canonical", phoneE164: "+96777000102", role: "operator", enabled: true, activatedAt: "2026-09-20T08:00:00.000Z", securityEnabled: true, actorVersion: 7, roleVersion: 3, permissions: [] }] }),
    });
  });
  await page.route("**/api/access/managed-user/status**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        actorId: "act_operator_canonical",
        phoneE164: "+96777000102",
        role: "operator",
        exists: true,
        enabled: true,
        activated: true,
        securityEnabled: true,
        state: "active",
        actorVersion: 7,
        roleVersion: 3,
        operatorPermissions: Object.fromEntries(authenticatedOperator.permissions.map((permission) => [permission, { actorId: "act_operator_canonical", permission, enabled: true, version: 1, reason: "" }])),
      }),
    });
  });
  await page.route("**/api/access/account-control", async (route) => {
    mutationBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ status: 204 });
  });
  await page.goto("/access");
  await page.getByRole("button", { name: "إدارة الحساب" }).click();
  await expect(page.getByLabel("رقم هاتف المشغّل")).toHaveValue("+96777000102");
  await expect(page.getByText("act_operator_canonical")).toHaveCount(0);
  await page.getByLabel("سبب تغيير حالة الحساب").fill("مراجعة صلاحية الحساب");
  await page.getByRole("button", { name: "إيقاف المشغّل" }).click();
  expect(mutationBody).toMatchObject({ actorId: "act_operator_canonical", role: "operator", action: "disable-role", expectedVersion: 3 });
});

test("Field center reads DSH eligibility and routes operational controls to the role owner", async ({ page }) => {
  await stubAuthenticatedSession(page, authenticatedOperator.permissions, true);
  let mutationBody: Record<string, unknown> | undefined;
  let enabled = true;
  await page.route("**/api/fields**", async (route) => {
    if (route.request().method() === "POST") {
      mutationBody = route.request().postDataJSON() as Record<string, unknown>;
      enabled = false;
      await route.fulfill({ status: 204 });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [{ actorId: "act_field_admitted", phoneE164: "+96777000103", role: "field", enabled, activatedAt: "2026-09-20T08:00:00.000Z", securityEnabled: true, actorVersion: 4, roleVersion: 2, admission: { id: "fld_adm_field_admitted", actorId: "act_field_admitted", state: "eligible", version: 4, createdAt: "2026-09-20T08:00:00.000Z", updatedAt: "2026-09-20T08:00:00.000Z" } }] }) });
  });
  await page.goto("/fields");
  await expect(page.getByRole("heading", { name: "قائمة الميدانيين وأهليتهم" })).toBeVisible();
  await expect(page.getByText("مؤهل لإنشاء الملفات")).toBeVisible();
  await page.getByLabel("سبب الإجراء").fill("تجميد أهلية الميدان");
  await page.getByRole("button", { name: "إيقاف التشغيل" }).click();
  expect(mutationBody).toMatchObject({ actorId: "act_field_admitted", action: "disable", expectedVersion: 2, reason: "تجميد أهلية الميدان" });
});

test("Field reenrollment uses DSH eligibility and carries fresh actor, role, and admission versions", async ({ page }) => {
  await stubAuthenticatedSession(page, authenticatedOperator.permissions, true);
  let reenrollmentBody: Record<string, unknown> | undefined;
  await page.route("**/api/fields**", async (route) => {
    if (route.request().method() === "POST") {
      reenrollmentBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({ status: 204 });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [{ actorId: "act_field_reenroll", phoneE164: "+96777000105", role: "field", enabled: true, securityEnabled: true, actorVersion: 4, roleVersion: 2, admission: { id: "fld_adm_reenroll", actorId: "act_field_reenroll", state: "eligible", version: 8, createdAt: "2026-09-20T08:00:00.000Z", updatedAt: "2026-09-20T08:00:00.000Z" } }] }) });
  });
  await page.goto("/fields");
  await page.getByLabel("سبب الإجراء").fill("استرداد جهاز الميدان");
  await page.getByRole("button", { name: "إجازة إعادة التسجيل" }).click();
  await expect(page.getByRole("status")).toContainText("تمت إجازة إعادة تسجيل الميداني بعد تحقق DSH");
  expect(reenrollmentBody).toMatchObject({
    actorId: "act_field_reenroll",
    action: "reenroll",
    expectedActorVersion: 4,
    expectedRoleVersion: 2,
    expectedAdmissionVersion: 8,
    reason: "استرداد جهاز الميدان",
  });
});

test("Field reenrollment conflicts reload the canonical DSH-owned roster before retry", async ({ page }) => {
  await stubAuthenticatedSession(page, authenticatedOperator.permissions, true);
  let conflictStateApplied = false;
  await page.route("**/api/fields**", async (route) => {
    if (route.request().method() === "POST") {
      conflictStateApplied = true;
      await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: { code: "CONFLICT", message: "the access versions changed" } }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [{ actorId: "act_field_conflict", phoneE164: "+96777000106", role: "field", enabled: true, securityEnabled: true, actorVersion: 4, roleVersion: conflictStateApplied ? 3 : 2, admission: { id: "fld_adm_conflict", actorId: "act_field_conflict", state: "eligible", version: 8, createdAt: "2026-09-20T08:00:00.000Z", updatedAt: "2026-09-20T08:00:00.000Z" } }] }) });
  });
  await page.goto("/fields");
  await page.getByLabel("سبب الإجراء").fill("استرداد جهاز الميدان");
  await page.getByRole("button", { name: "إجازة إعادة التسجيل" }).click();
  await expect(page.locator("p.identity-error")).toContainText("أُعيد تحميل الحالة الكانونية");
  await expect(page.getByRole("button", { name: "إجازة إعادة التسجيل" })).toBeVisible();
});

test("Field reenrollment remains unavailable until DSH restores eligibility", async ({ page }) => {
  await stubAuthenticatedSession(page, authenticatedOperator.permissions, true);
  await page.route("**/api/fields**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [{ actorId: "act_field_suspended", phoneE164: "+96777000107", role: "field", enabled: true, activatedAt: "2026-09-20T08:00:00.000Z", securityEnabled: true, actorVersion: 4, roleVersion: 2, admission: { id: "fld_adm_suspended", actorId: "act_field_suspended", state: "suspended", version: 9, createdAt: "2026-09-20T08:00:00.000Z", updatedAt: "2026-09-20T08:00:00.000Z" } }] }) });
  });
  await page.goto("/fields");
  await expect(page.getByRole("cell", { name: "موقوف" })).toBeVisible();
  await expect(page.getByRole("button", { name: "إجازة إعادة التسجيل" })).toHaveCount(0);
});

test("captain center owns DSH eligibility and operational availability", async ({ page }) => {
  await stubAuthenticatedSession(page, authenticatedOperator.permissions, true);
  let mutationBody: Record<string, unknown> | undefined;
  await page.route("**/api/captains**", async (route) => {
    if (route.request().method() === "POST") {
      mutationBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({ status: 204 });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [{ actorId: "act_captain_admitted", phoneE164: "+96777000104", role: "captain", enabled: true, activatedAt: "2026-09-20T08:00:00.000Z", securityEnabled: true, actorVersion: 5, roleVersion: 6, admission: { id: "cap_adm_test", actorId: "act_captain_admitted", state: "eligible", availabilityState: "available", version: 7, createdAt: "2026-09-20T08:00:00.000Z", updatedAt: "2026-09-20T08:00:00.000Z" } }] }) });
  });
  await page.goto("/captains");
  await expect(page.getByRole("heading", { name: "قائمة الكباتن وأهليتهم وتوفرهم" })).toBeVisible();
  await page.getByLabel("سبب الإجراء").fill("تحديث توافر الكابتن");
  await page.getByRole("button", { name: "جعله غير متاح" }).click();
  expect(mutationBody).toMatchObject({ actorId: "act_captain_admitted", action: "availability", available: false, expectedVersion: 7, reason: "تحديث توافر الكابتن" });
});

test("operator captain operations present Arabic state without backend identifiers", async ({ page }) => {
  await stubAuthenticatedSession(page);
  await page.route("**/api/captains", async (route) => {
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        operation: "admit",
        idempotentReplay: false,
        admission: { id: "cap_adm_test", actorId: "act_captain_test", state: "eligible", availabilityState: "unavailable", version: 4 },
      }),
    });
  });
  await page.goto("/captains");
  await page.getByLabel("هاتف الكابتن المراد قبوله").fill("+96777000105");
  await page.getByRole("button", { name: "قبول الكابتن" }).click();
  await expect(page.getByText("الحالة: مؤهل للتشغيل · التوفر: غير متاح حاليًا")).toBeVisible();
  await expect(page.getByText("act_captain_test")).toHaveCount(0);
});

test("operator operations uses the DSH read model and resource actions", async ({ page }) => {
  await stubAuthenticatedSession(page, [...authenticatedOperator.permissions, "operations"]);
  let requestedCursor = "";
  let requestedSearch = "";
  let requestedSort = "";
  const operation = {
    orderId: "order_ready",
    state: "READY_FOR_DISPATCH",
    updatedAt: "2026-09-18T06:00:00.000Z",
    storeName: "متجر الاختبار",
    assignment: null,
  };
  const detail = {
    order: { id: "order_ready", clientActorId: "act_client", storeId: "store_test", storeName: "متجر الاختبار", pickupLocation: null, cartId: "cart_test", fulfillmentMode: "BTHWANI_DELIVERY", addressId: "address_test", addressVersion: 1, addressText: "شارع الاختبار", addressLatitude: 15.369445, addressLongitude: 44.191006, serviceCityId: "sanaa", serviceabilityPolicyVersion: "CITY_SCOPE_V1", serviceabilityStatus: "SERVICEABLE", serviceabilityStoreVersion: 1, serviceabilityAddressVersion: 1, state: "READY_FOR_DISPATCH", subtotalAmountMinor: 1800, discountMinor: 0, totalAmountMinor: 1800, currency: "YER", paymentMethod: "CASH_ON_DELIVERY", paymentState: "REQUIRES_COLLECTION", paymentIntentId: "payment_ready", version: 3, lines: [], createdAt: "2026-09-18T05:00:00.000Z", updatedAt: "2026-09-18T06:00:00.000Z" },
    storeName: "متجر الاختبار",
    assignment: null,
  };
  await page.route("**/api/operations*", async (route) => {
    const requestUrl = new URL(route.request().url());
    if (route.request().method() !== "GET" || requestUrl.pathname !== "/api/operations") {
      await route.fallback();
      return;
    }
    requestedCursor = requestUrl.searchParams.get("cursor") ?? "";
    requestedSearch = requestUrl.searchParams.get("q") ?? "";
    requestedSort = requestUrl.searchParams.get("sort") ?? "updated_desc";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        operations: requestedCursor ? [] : [operation],
        nextCursor: requestedCursor ? undefined : "cursor-page-2",
      }),
    });
  });
  await page.route("**/api/operations/order_ready", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ operation: { ...detail, order: { ...detail.order, lines: [{ id: "line-1", productName: "قهوة", variantTitle: "الافتراضي", finalQuantityBaseUnits: 1, baseUnit: "COUNT", lineAmountMinor: 1800, currency: "YER" }] } } }),
    });
  });
  await page.goto("/operations");
  await expect(page.getByRole("heading", { name: "العمليات" })).toBeVisible();
  await expect(page.getByText("order_ready")).toBeVisible();
  const searchBox = page.getByRole("searchbox");
  await searchBox.fill("متجر الاختبار");
  await searchBox.press("Enter");
  await expect.poll(() => requestedSearch).toBe("متجر الاختبار");
  await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe("متجر الاختبار");
  await page.getByLabel("ترتيب التحديث").selectOption("updated_asc");
  await expect.poll(() => requestedSort).toBe("updated_asc");
  await expect.poll(() => new URL(page.url()).searchParams.get("sort")).toBe("updated_asc");
  await page.getByRole("link", { name: "order_ready" }).click();
  await expect(page.getByRole("heading", { name: "order_ready" })).toBeVisible();
  const detailTabs = page.getByRole("navigation", { name: "مساحات تفاصيل الطلب" });
  await detailTabs.getByRole("link", { name: "التنفيذ" }).click();
  await expect(page.getByText("شارع الاختبار")).toBeVisible();
  await detailTabs.getByRole("link", { name: "الدفع" }).click();
  await expect(page.getByText("الدفع نقدًا عند الاستلام", { exact: true })).toBeVisible();
  await expect(page.getByText("بانتظار التحصيل عند التسليم", { exact: true })).toBeVisible();
  await detailTabs.getByRole("link", { name: "العناصر" }).click();
  await expect(page.getByRole("heading", { name: "عناصر الطلب" })).toBeVisible();
  await expect(page.getByText("قهوة", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "العودة إلى مسار الطلبات" }).click();
  await expect(page.getByRole("heading", { name: "العمليات" })).toBeVisible();
  const restoredSearchBox = page.getByRole("searchbox");
  await restoredSearchBox.fill("");
  await restoredSearchBox.press("Enter");
  await expect.poll(() => requestedSearch).toBe("");
  await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBeNull();
  await page.getByRole("button", { name: "الصفحة التالية" }).click();
  await expect(page.getByText("لا توجد طلبات في هذا المسار")).toBeVisible();
  await expect(page.getByRole("button", { name: "الصفحة التالية" })).toHaveCount(0);
  expect(requestedCursor).toBe("cursor-page-2");
  await expect(page.getByRole("searchbox")).toHaveCount(1);
});

test("operator finance reads only the bounded COD cash-custody projection", async ({ page }) => {
  await stubAuthenticatedSession(page);
  await page.route("**/api/finance/cash-custody**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [{ paymentIntentId: "payment-1", externalReference: "dsh-order-1", captainActorId: "act-captain-1", amountMinor: 12500, currency: "YER", paymentVersion: 3, collectedAt: "2026-09-20T08:00:00.000Z" }], totalItems: 1, totalAmountMinor: 12500, nextCursor: "" }),
    });
  });
  await page.goto("/finance/cash-custody");
  await expect(page.getByRole("heading", { name: "حفظ النقد" })).toBeVisible();
  await expect(page.getByText("12,500 ريال يمني").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "النقد المحصل عند التسليم" })).toBeVisible();
  await expect(page.getByText("البيانات من WLT، وتعرض فقط نقد COD الذي حصّله الكابتن ولم تسجل له حوالة.")).toBeVisible();
  await expect(page.getByText("dsh-order-1")).toBeVisible();
});

test("operator admits a Field actor through the DSH-owned Field surface", async ({ page }) => {
  await stubAuthenticatedSession(page);
  let requestBody: Record<string, unknown> | undefined;
  await page.route("**/api/fields", async (route) => {
    requestBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ admission: { id: "fld_adm_test", actorId: "act_field_test", state: "eligible", version: 2 }, idempotentReplay: false }),
    });
  });
  await page.goto("/fields");
  await expect(page.getByRole("heading", { name: "قبول ممثل ميداني" })).toBeVisible();
  await page.getByLabel("هاتف الممثل الميداني").fill("+96777000104");
  await page.getByRole("button", { name: "قبول الميدان" }).click();
  await expect(page.getByText(/أعيدت قراءة حالة القبول: مؤهل لإنشاء الملفات/)).toBeVisible();
  expect(requestBody).toEqual({ action: "admit", contactPhoneE164: "+96777000104" });
});

test("operator creates a DSH-owned joining case from prospective partner facts", async ({ page }) => {
  await stubAuthenticatedSession(page);
  let requestBody: unknown;
  await page.route("**/api/service-cities**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ cities: [{ id: "sanaa", displayNameAr: "صنعاء", active: true, version: 1, createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z" }] }) });
  });
  await page.route("**/api/catalog/verticals**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ verticals: [{ id: "grocery", nameAr: "بقالة", nameEn: "Grocery", catalogModel: "SHARED_CATALOG", active: true, version: 1, createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z" }] }) });
  });
  await page.route("**/api/partners/joining-cases/join_test", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        case: { id: "join_test", contactPhoneE164: "+96777000100", businessName: "نشاط الاختبار", firstStoreName: "متجر الاختبار", serviceCityId: "sanaa", firstStoreVerticalId: "grocery", firstStoreFulfillmentModes: ["BTHWANI_CAPTAIN", "CUSTOMER_PICKUP"], firstStoreLatitude: 15.369445, firstStoreLongitude: 44.191006, state: "draft", version: 1, createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z" },
        idempotentReplay: false,
      }),
    });
  });
  await page.route("**/api/partners/joining-cases", async (route) => {
    requestBody = route.request().postDataJSON();
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        case: { id: "join_test", contactPhoneE164: "+96777000100", businessName: "نشاط الاختبار", firstStoreName: "متجر الاختبار", serviceCityId: "sanaa", firstStoreVerticalId: "grocery", firstStoreFulfillmentModes: ["BTHWANI_CAPTAIN", "CUSTOMER_PICKUP"], firstStoreLatitude: 15.369445, firstStoreLongitude: 44.191006, state: "draft", version: 1, createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z" },
        idempotentReplay: false,
      }),
    });
  });

  await page.goto("/partners/new");
  await expect(page.getByRole("heading", { name: "إنشاء حالة انضمام جديدة", exact: true })).toBeVisible();
  await expect(page.getByLabel("معرّف Actor الشريك")).toHaveCount(0);
  await expect(page.getByLabel("رقم هاتف الشريك")).toBeVisible();

  await page.getByLabel("رقم هاتف الشريك").fill("+967 77000100");
  await page.getByLabel("الاسم القانوني للنشاط").fill("نشاط الاختبار");
  await page.getByLabel("اسم المتجر الأول").fill("متجر الاختبار");
  await page.getByLabel("مدينة المتجر الأول").selectOption("sanaa");
  await page.getByLabel("الفئة الرئيسية").selectOption("grocery");
  await page.getByLabel("خط عرض موقع المتجر").fill("15.369445");
  await page.getByLabel("خط طول موقع المتجر").fill("44.191006");
  const fulfillmentModes = page.getByRole("group", { name: "أوضاع الطلب التي اختارها الشريك عند الانضمام" });
  await expect(fulfillmentModes.getByRole("checkbox")).toHaveCount(3);
  await fulfillmentModes.getByRole("checkbox", { name: "استلم بنفسك من المتجر" }).check();
  await page.getByRole("button", { name: "إنشاء حالة انضمام" }).click();

  await expect(page.getByRole("status")).toContainText("الحالة: مسودة");
  expect(requestBody).toEqual({ contactPhoneE164: "+96777000100", businessName: "نشاط الاختبار", firstStoreName: "متجر الاختبار", serviceCityId: "sanaa", firstStoreVerticalId: "grocery", firstStoreLatitude: 15.369445, firstStoreLongitude: 44.191006, firstStoreFulfillmentModes: ["CUSTOMER_PICKUP"] });
});

test("operator gets an actionable empty state when no active commerce vertical exists", async ({ page }) => {
  await stubAuthenticatedSession(page);
  await page.route("**/api/service-cities**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ cities: [] }) });
  });
  await page.route("**/api/catalog/verticals", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ verticals: [] }) });
  });
  await page.route("**/api/partners/joining-cases**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ cases: [] }) });
  });
  await page.goto("/partners/new");
  await expect(page.getByText("لا يمكن إنشاء الحالة بعد", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "فتح مدن الخدمة" })).toHaveAttribute("href", "/policies/service-cities");
  await expect(page.getByRole("button", { name: "إنشاء حالة انضمام" })).toBeDisabled();
});

test("operator city creation delegates the stable id to DSH", async ({ page }) => {
  await stubAuthenticatedSession(page);
  let requestBody: unknown;
  await page.route("**/api/service-cities**", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ cities: [] }) });
      return;
    }
    requestBody = route.request().postDataJSON();
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ city: { id: "city_0123456789abcdef0123456789abcdef", displayNameAr: "صنعاء", active: true, version: 1, createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z" } }),
    });
  });

  await page.goto("/policies/service-cities");
  await page.getByLabel("الاسم العربي").fill("صنعاء");
  await page.getByRole("button", { name: "إضافة مدينة" }).click();

  const cityNotice = page.getByRole("status").filter({ hasText: "تم حفظ المدينة الكانونية" });
  await expect(cityNotice).toContainText("تم حفظ المدينة الكانونية.");
  await expect(cityNotice).not.toContainText("city_0123456789abcdef0123456789abcdef");
  expect(requestBody).toEqual({ displayNameAr: "صنعاء", active: true });
});

test("operator city creation rejects non-Arabic names before mutation", async ({ page }) => {
  await stubAuthenticatedSession(page);
  let mutationAttempted = false;
  await page.route("**/api/service-cities**", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ cities: [] }) });
      return;
    }
    mutationAttempted = true;
    await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "UNEXPECTED_MUTATION" } }) });
  });
  await page.goto("/policies/service-cities");
  await page.getByLabel("الاسم العربي").fill("Sana'a");
  await page.getByRole("button", { name: "إضافة مدينة" }).click();
  await expect(page.locator("p.identity-error")).toContainText("باللغة العربية فقط");
  expect(mutationAttempted).toBe(false);
});

test("operator creates a canonical commerce vertical before onboarding partners", async ({ page }) => {
  await stubAuthenticatedSession(page, [...authenticatedOperator.permissions, "catalog"]);
  let requestBody: unknown;
  await page.route("**/api/catalog/verticals**", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ verticals: [] }) });
      return;
    }
    requestBody = route.request().postDataJSON();
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ vertical: { id: "vertical_0123456789abcdef0123456789abcdef", nameAr: "مطاعم", nameEn: "Restaurants", catalogModel: "STORE_LOCAL_CATALOG", active: true, version: 1, createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z" }, idempotentReplay: false }),
    });
  });
  await page.route("**/api/catalog/products**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ products: [] }) });
  });
  await page.goto("/catalog/categories");
  await expect(page.getByLabel("المعرف البرمجي", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "إعداد المجال التجاري" }).click();
  await page.getByRole("button", { name: "إضافة مجال تجاري" }).click();
  await page.locator("#catalog-vertical-name-ar").fill("مطاعم");
  await page.locator("#catalog-vertical-name-en").fill("Restaurants");
  await page.locator("#catalog-vertical-model").selectOption("STORE_LOCAL_CATALOG");
  await page.locator("#catalog-vertical-reason").fill("إنشاء فئة جديدة للاختبار");
  await page.getByRole("button", { name: "إضافة مجال تجاري" }).click();
  await expect(page.getByRole("status")).toContainText("تم حفظ المجال التجاري: مطاعم.");
  await expect(page.getByRole("status")).not.toContainText("vertical_0123456789abcdef0123456789abcdef");
  expect(requestBody).toEqual({ nameAr: "مطاعم", nameEn: "Restaurants", catalogModel: "STORE_LOCAL_CATALOG", active: true, reason: "إنشاء فئة جديدة للاختبار" });
});

test("operator creates a product category under its commerce vertical", async ({ page }) => {
  await stubAuthenticatedSession(page, [...authenticatedOperator.permissions, "catalog"]);
  await page.setViewportSize({ width: 1440, height: 1000 });
  let requestBody: unknown;
  await page.route("**/api/catalog/verticals**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ verticals: [{ id: "vertical_0123456789abcdef0123456789abcdef", nameAr: "بقالات", nameEn: "Groceries", catalogModel: "SHARED_CATALOG", active: true, version: 1, createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z" }] }) });
  });
  await page.route("**/api/catalog/categories**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/attribute-rules")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ rules: [] }) });
      return;
    }
    if (route.request().method() === "GET") {
      const detail = url.pathname.endsWith("/category_0123456789abcdef0123456789abcdef");
      const category = { id: "category_0123456789abcdef0123456789abcdef", verticalId: "vertical_0123456789abcdef0123456789abcdef", parentCategoryId: null, nameAr: "قهوة", nameEn: "Coffee", pathAr: "قهوة", pathEn: "Coffee", active: true, version: 1, createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z" };
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(detail ? { category } : { categories: [], nextCursor: "" }) });
      return;
    }
    requestBody = route.request().postDataJSON();
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ category: { id: "category_0123456789abcdef0123456789abcdef", verticalId: "vertical_0123456789abcdef0123456789abcdef", parentCategoryId: null, nameAr: "قهوة", nameEn: "Coffee", active: true, version: 1, createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z" } }) });
  });
  await page.route("**/api/catalog/products**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ products: [] }) });
  });
  await page.goto("/catalog/categories?verticalId=vertical_0123456789abcdef0123456789abcdef");
  await expect(page.getByRole("region", { name: "إدارة الفئات" })).toBeVisible();
  await expect(page.getByRole("region", { name: "إدارة الفئات" }).getByRole("heading", { name: "الفئات", exact: true })).toBeVisible();
  await expect(page.locator(".catalog-taxonomy-workspace")).toHaveCount(1);
  await expect(page.locator(".catalog-taxonomy-workspace > .catalog-taxonomy-workbench")).toHaveCount(1);
  await expect(page.locator(".catalog-taxonomy-section")).toHaveCount(1);
  await page.screenshot({ path: "test-results/catalog-taxonomy-workspace.png", fullPage: true });
  await expect(page.getByLabel("المعرف البرمجي للتصنيف", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "فئة رئيسية جديدة", exact: true }).click();
  await page.getByLabel("الاسم بالعربية").fill("قهوة");
  await page.getByLabel("الاسم بالإنجليزية").fill("Coffee");
  await page.locator("#catalog-category-reason").fill("إنشاء فئة جديدة للاختبار");
  await page.locator(".catalog-category-editor").getByRole("button", { name: "إضافة الفئة", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("تمت إضافة «قهوة».");
  await expect(page.getByRole("heading", { name: "قهوة", exact: true })).toBeVisible();
  await expect(page.getByText("خصائص المنتجات وقواعد هذه الفئة", { exact: true })).toBeVisible();
  await expect(page.getByRole("status")).not.toContainText("category_0123456789abcdef0123456789abcdef");
  expect(requestBody).toEqual({ verticalId: "vertical_0123456789abcdef0123456789abcdef", parentCategoryId: null, nameAr: "قهوة", nameEn: "Coffee", active: true, reason: "إنشاء فئة جديدة للاختبار" });
});

test("operator replaces the primary product image and adds a gallery image through canonical media upload", async ({ page }) => {
  await stubAuthenticatedSession(page);
  const product = {
    id: "product_media_upload_test",
    verticalId: "grocery",
    scope: "SHARED",
    canonicalName: "قهوة رفع الصور",
    brand: null,
    storeId: null,
    active: true,
    version: 1,
    createdAt: "2026-09-12T00:00:00.000Z",
    updatedAt: "2026-09-12T00:00:00.000Z",
    variants: [{ id: "variant_media_upload_test", productId: "product_media_upload_test", title: "الافتراضي", measurementKind: "DISCRETE", baseUnit: "COUNT", active: true, version: 1, identifiers: [{ type: "SKU", value: "MEDIA-UPLOAD-TEST" }], attributes: [], createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z" }],
    categoryIds: ["coffee"],
    attributes: [],
    media: [] as Array<{ uri: string; role: "primary" | "gallery"; ordinal: number }>,
  };
  let currentProduct = product;
  const uploadCalls: Array<{ role: string; filename: string; expectedVersion: string; idempotencyKey: string }> = [];
  await page.route("**/api/catalog/verticals**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ verticals: [{ id: "grocery", nameAr: "بقالة", nameEn: "Grocery", catalogModel: "SHARED_CATALOG", active: true, version: 1, createdAt: product.createdAt, updatedAt: product.updatedAt }] }) });
  });
  await page.route("**/api/catalog/categories**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/attribute-rules")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ rules: [] }) });
      return;
    }
    const category = { id: "coffee", verticalId: "grocery", parentCategoryId: null, nameAr: "قهوة", nameEn: "Coffee", pathAr: "قهوة", pathEn: "Coffee", active: true, version: 1, createdAt: product.createdAt, updatedAt: product.updatedAt };
    if (url.pathname.endsWith("/coffee")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ category }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ categories: [category], nextCursor: "" }) });
  });
  await page.route("**/api/catalog/product-registry**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ products: [{ id: currentProduct.id, verticalId: currentProduct.verticalId, canonicalName: currentProduct.canonicalName, brand: currentProduct.brand, active: currentProduct.active, version: currentProduct.version, variantCount: currentProduct.variants.length, categoryIds: currentProduct.categoryIds, primaryImageUri: currentProduct.media.find((media) => media.role === "primary")?.uri ?? null, createdAt: currentProduct.createdAt, updatedAt: currentProduct.updatedAt }], nextCursor: "" }) });
  });
  await page.route("**/api/catalog/products/product_media_upload_test", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(currentProduct) });
  });
  await page.route("**/api/catalog/products/product_media_upload_test/media", async (route) => {
    const headers = route.request().headers();
    const body = route.request().postDataBuffer()?.toString("latin1") ?? "";
    const role = body.match(/name="role"\r\n\r\n([^\r\n]+)/)?.[1] ?? "";
    const filename = body.match(/name="file"; filename="([^"]+)"/)?.[1] ?? "";
    uploadCalls.push({ role, filename, expectedVersion: headers["x-expected-version"] ?? "", idempotencyKey: headers["idempotency-key"] ?? "" });
    const uri = `http://localhost:18080/dsh/catalog/media/catalog/products/${currentProduct.id}/uploads/${role}.png`;
    const nextMedia = role === "primary"
      ? [...currentProduct.media.filter((item) => item.role !== "primary"), { uri, role: "primary" as const, ordinal: 0 }]
      : [...currentProduct.media, { uri, role: "gallery" as const, ordinal: currentProduct.media.filter((item) => item.role === "gallery").length + 1 }];
    currentProduct = { ...currentProduct, version: currentProduct.version + 1, media: nextMedia };
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ product: currentProduct, idempotentReplay: false }) });
  });

  await page.goto("/catalog/products");
  await page.getByRole("row", { name: /قهوة رفع الصور/ }).getByRole("button", { name: "تفاصيل وتعديل" }).click();
  await expect(page.getByLabel("رابط الصورة الأساسية")).toHaveCount(0);
  const onePixelPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  await page.getByLabel("ملف الصورة").setInputFiles({ name: "coffee-primary.png", mimeType: "image/png", buffer: onePixelPng });
  await page.getByRole("button", { name: "رفع الصورة وربطها" }).click();
  await expect(page.getByRole("status")).toContainText("تم رفع الصورة الأساسية وربطها بالمنتج.");
  await expect(page.locator(".catalog-media-preview")).toHaveCount(1);
  await expect(page.locator(".catalog-media-preview")).toHaveAttribute("src", currentProduct.media[0]!.uri);
  await page.getByLabel("موضع الصورة").selectOption("gallery");
  await page.getByLabel("ملف الصورة").setInputFiles({ name: "coffee-gallery.png", mimeType: "image/png", buffer: onePixelPng });
  await page.getByRole("button", { name: "رفع الصورة وربطها" }).click();
  await expect(page.getByRole("status")).toContainText("تم رفع الصورة وإضافتها إلى المعرض.");
  await expect(page.locator(".catalog-media-preview")).toHaveCount(2);
  expect(uploadCalls).toEqual([
    { role: "primary", filename: "coffee-primary.png", expectedVersion: "1", idempotencyKey: expect.any(String) },
    { role: "gallery", filename: "coffee-gallery.png", expectedVersion: "2", idempotencyKey: expect.any(String) },
  ]);
  expect(uploadCalls.every((call) => call.idempotencyKey.length >= 20)).toBe(true);
  expect(currentProduct.media).toEqual([
    { uri: "http://localhost:18080/dsh/catalog/media/catalog/products/product_media_upload_test/uploads/primary.png", role: "primary", ordinal: 0 },
    { uri: "http://localhost:18080/dsh/catalog/media/catalog/products/product_media_upload_test/uploads/gallery.png", role: "gallery", ordinal: 1 },
  ]);

  await page.reload();
  await page.getByRole("row", { name: /قهوة رفع الصور/ }).getByRole("button", { name: "تفاصيل وتعديل" }).click();
  await expect(page.locator(".catalog-media-preview")).toHaveCount(2);
  await expect(page.locator(".catalog-media-preview").nth(0)).toHaveAttribute("src", currentProduct.media[0]!.uri);
  await expect(page.locator(".catalog-media-preview").nth(1)).toHaveAttribute("src", currentProduct.media[1]!.uri);
});

test("operator resumes a canonical joining case from the DSH queue", async ({ page }) => {
  await stubAuthenticatedSession(page, [...authenticatedOperator.permissions, "partners"]);
  await page.route("**/api/partners/joining-cases**", async (route) => {
    if (new URL(route.request().url()).pathname !== "/api/partners/joining-cases") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
       body: JSON.stringify({ cases: [{ id: "join_resume", contactPhoneE164: "+96777000101", businessName: "نشاط مستعاد", firstStoreName: "متجر مستعاد", serviceCityId: "sanaa", firstStoreVerticalId: "grocery", firstStoreLatitude: 15.369445, firstStoreLongitude: 44.191006, state: "submitted", version: 2, createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z" }] }),
    });
  });
  await page.route("**/api/partners/joining-cases/join_resume", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
         case: { id: "join_resume", contactPhoneE164: "+96777000101", businessName: "نشاط مستعاد", firstStoreName: "متجر مستعاد", serviceCityId: "sanaa", firstStoreVerticalId: "grocery", firstStoreFulfillmentModes: ["BTHWANI_CAPTAIN"], firstStoreLatitude: 15.369445, firstStoreLongitude: 44.191006, state: "submitted", version: 2, createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z" },
        idempotentReplay: false,
      }),
    });
  });
  await page.goto("/partners/joining");
  await page.getByRole("link", { name: "فتح الحالة" }).click();
  await expect(page.getByRole("status").first()).toContainText("الحالة: قيد المراجعة");
  await expect(page.getByRole("status").first()).toContainText("نشاط مستعاد");
});

test("operator approves joining terms with commission and settlement cadence", async ({ page }) => {
  await stubAuthenticatedSession(page);
  let reviewBody: unknown;
  await page.route("**/api/service-cities**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ cities: [{ id: "sanaa", displayNameAr: "صنعاء", active: true, version: 1, createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z" }] }) });
  });
  await page.route("**/api/catalog/verticals**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ verticals: [{ id: "grocery", nameAr: "بقالة", nameEn: "Grocery", catalogModel: "SHARED_CATALOG", active: true, version: 1, createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z" }] }) });
  });
  await page.route("**/api/partners/joining-cases/join_financial", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ case: { id: "join_financial", contactPhoneE164: "+96777000109", businessName: "نشاط مالي", firstStoreName: "متجر مالي", serviceCityId: "sanaa", firstStoreVerticalId: "grocery", firstStoreFulfillmentModes: ["BTHWANI_CAPTAIN"], firstStoreLatitude: 15.369445, firstStoreLongitude: 44.191006, partnerActorId: "act_financial", origin: "field", state: "submitted", financialProfileState: "PENDING_BINDING", version: 2, createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z" }, idempotentReplay: false }) });
  });
  await page.route("**/api/finance/partner-financial-terms-policy", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ policy: { id: "partner_terms_test", policyVersion: "partner-terms-v3", state: "ACTIVE", commissionRateBps: 1250, settlementPeriod: "WEEKLY", version: 3, createdBy: "actor-operator", createdAt: "2026-09-12T00:00:00.000Z", retiredAt: null } }) });
  });
  await page.route("**/api/partners/joining-cases/join_financial/review", async (route) => {
    reviewBody = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ case: { id: "join_financial", contactPhoneE164: "+96777000109", businessName: "نشاط مالي", firstStoreName: "متجر مالي", serviceCityId: "sanaa", firstStoreVerticalId: "grocery", firstStoreFulfillmentModes: ["BTHWANI_CAPTAIN"], firstStoreLatitude: 15.369445, firstStoreLongitude: 44.191006, partnerActorId: "act_financial", origin: "field", state: "approved", commissionRateBps: 1250, settlementPeriod: "WEEKLY", financialProfileId: "financial_profile_test", financialProfileState: "ACTIVE", version: 3, createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z" }, idempotentReplay: false }) });
  });

  await page.goto("/partners/join_financial");
  await expect(page.getByRole("heading", { name: "تفاصيل حالة انضمام الشريك" })).toBeVisible();
  await expect(page.getByText(/سيُعتمد إصدار السياسة partner-terms-v3/)).toBeVisible();
  await page.getByRole("button", { name: "اعتماد الحالة وإنشاء المتجر بالشروط النشطة" }).click();

  await expect(page.getByRole("status").first()).toContainText("الحالة: تمت الموافقة");
  expect(reviewBody).toMatchObject({ decision: "approved", expectedVersion: 2, expectedTermsPolicyVersion: "partner-terms-v3" });
});

test("partner Store publication exposes the canonical readiness block", async ({ page }) => {
  await stubAuthenticatedSession(page);
  const publicationReasons = [
    { code: "PARTNER_IDENTITY_NOT_ELIGIBLE", label: "هوية الشريك أو صلاحية دوره غير جاهزة للنشر" },
    { code: "SERVICE_CITY_NOT_ELIGIBLE", label: "مدينة خدمة المتجر غير مؤهلة للنشر" },
    { code: "CATALOG_NOT_READY", label: "لا يوجد كتالوج أو عرض منشور صالح يجعل المتجر جاهزًا" },
  ] as const;
  let blockedReason: (typeof publicationReasons)[number]["code"] = publicationReasons[0].code;
  await page.route("**/api/service-cities**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ cities: [{ id: "sanaa", displayNameAr: "صنعاء", active: true, version: 1, createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z" }] }) });
  });
  await page.route("**/api/catalog/verticals", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ verticals: [{ id: "grocery", nameAr: "بقالة", nameEn: "Grocery", catalogModel: "SHARED_CATALOG", active: true, version: 1, createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z" }] }) });
  });
  await page.route("**/api/partners/joining-cases/join_test", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
         case: { id: "join_test", contactPhoneE164: "+96777000100", businessName: "نشاط الاختبار", firstStoreName: "متجر الاختبار", serviceCityId: "sanaa", firstStoreVerticalId: "grocery", firstStoreFulfillmentModes: ["BTHWANI_CAPTAIN"], firstStoreLatitude: 15.369445, firstStoreLongitude: 44.191006, partnerActorId: "act_generated", state: "approved", version: 5, store: { id: "store_test", partnerActorId: "act_generated", name: "متجر الاختبار", serviceCityId: "sanaa", primaryVerticalId: "grocery", fulfillmentModes: ["BTHWANI_CAPTAIN"], deliveryOrigin: { latitude: 15.369445, longitude: 44.191006 }, version: 1, publicationState: "unpublished", publicationReadiness: { ready: false, blockedReason: "PARTNER_IDENTITY_NOT_ELIGIBLE" }, offers: [], createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z" }, createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z" },
        idempotentReplay: false,
      }),
    });
  });
  await page.route("**/api/partners/joining-cases", async (route) => {
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
         case: { id: "join_test", contactPhoneE164: "+96777000100", businessName: "نشاط الاختبار", firstStoreName: "متجر الاختبار", serviceCityId: "sanaa", firstStoreVerticalId: "grocery", firstStoreFulfillmentModes: ["BTHWANI_CAPTAIN"], firstStoreLatitude: 15.369445, firstStoreLongitude: 44.191006, partnerActorId: "act_generated", state: "approved", version: 5, store: { id: "store_test", partnerActorId: "act_generated", name: "متجر الاختبار", serviceCityId: "sanaa", primaryVerticalId: "grocery", fulfillmentModes: ["BTHWANI_CAPTAIN"], deliveryOrigin: { latitude: 15.369445, longitude: 44.191006 }, version: 1, publicationState: "unpublished", publicationReadiness: { ready: false, blockedReason: "PARTNER_IDENTITY_NOT_ELIGIBLE" }, offers: [], createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z" }, createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z" },
        idempotentReplay: false,
      }),
    });
  });
  await page.route("**/api/stores/store_test/publication", async (route) => {
     await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ store: { id: "store_test", partnerActorId: "act_generated", name: "متجر الاختبار", serviceCityId: "sanaa", primaryVerticalId: "grocery", fulfillmentModes: ["BTHWANI_CAPTAIN"], version: 1, publicationState: "unpublished", publicationReadiness: { ready: false, blockedReason }, offers: [], createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z" }, idempotentReplay: false }) });
  });
  await page.goto("/partners/new");
  await page.getByLabel("رقم هاتف الشريك").fill("+96777000100");
  await page.getByLabel("الاسم القانوني للنشاط").fill("نشاط الاختبار");
  await page.getByLabel("اسم المتجر الأول").fill("متجر الاختبار");
  await page.getByLabel("مدينة المتجر الأول").selectOption("sanaa");
  await page.getByLabel("الفئة الرئيسية").selectOption("grocery");
  await page.getByLabel("خط عرض موقع المتجر").fill("15.369445");
  await page.getByLabel("خط طول موقع المتجر").fill("44.191006");
  await page.getByRole("checkbox", { name: "توصيل بثواني · مسؤولية المنصة" }).check();
  await page.getByRole("button", { name: "إنشاء حالة انضمام" }).click();
  await page.getByRole("link", { name: "فتح ملف المتجر" }).click();
  await page.getByRole("button", { name: "إعادة قراءة النشر" }).click();
  for (const reason of publicationReasons) {
    blockedReason = reason.code;
    await page.getByRole("button", { name: "إعادة القراءة" }).click();
    await expect(page.getByText(`الجاهزية: ${reason.label}`, { exact: true })).toBeVisible();
  }
  await expect(page.getByRole("button", { name: "نشر المتجر" })).toBeDisabled();
});

test("authenticated workspace keeps navigation meaning across light and dark themes", async ({ page }) => {
  await stubAuthenticatedSession(page, authenticatedOperator.permissions, true);
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.goto("/workspace");

  const lightBackground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await expect(page.getByRole("link", { name: "الوصول والصلاحيات" })).toBeVisible();
  await expect(page.getByRole("main")).toHaveAttribute("id", "workspace-main");

  await page.emulateMedia({ colorScheme: "dark" });
  await page.reload();
  const darkBackground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(darkBackground).not.toBe(lightBackground);
  await expect(page.getByRole("link", { name: "الوصول والصلاحيات" })).toBeVisible();
});

test("operator access exposes passkey-first sign-in and no human-role selector", async ({ page }) => {
  await stubSession(page, 401);
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "الدخول بمفتاح المرور" })).toBeVisible();
  await expect(page.getByLabel("الدور")).toHaveCount(0);
  await expect(page.getByText("مالك المنصة", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "الدخول بمفتاح المرور" })).toBeVisible();
  await expect(page.getByRole("button", { name: "تفعيل حساب موظف" })).toBeVisible();
  await expect(page.getByRole("button", { name: "استرداد الوصول" })).toBeVisible();
});

test("identity service failure is exposed as an alert with a recovery action", async ({ page }) => {
  await stubSession(page, 503);
  await page.goto("/");
  await expect(page.locator("section[role=alert]")).toContainText("تعذر الوصول إلى الهوية");
  await expect(page.getByRole("button", { name: "إعادة المحاولة" })).toBeVisible();
});

test("development operator readiness conflict returns to passkey access", async ({ page }) => {
  await page.route("**/api/auth/session**", async (route) => {
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "CONFLICT" } }),
    });
  });
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "الدخول بمفتاح المرور" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("حساب المشغل غير جاهز لإنشاء جلسة آمنة");
  await expect(page.getByRole("button", { name: "الدخول بمفتاح المرور" })).toBeVisible();
});

test("operator recovery distinguishes recovery credential from phone proof", async ({ page }) => {
  await stubSession(page, 401);
  await page.route("**/api/auth/operator/recovery/request", async (route) => {
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ challenge: { id: "challenge" } }) });
  });
  await page.goto("/");

  await page.getByRole("button", { name: "استرداد الوصول" }).click();
  await expect(page.getByRole("heading", { name: "اطلب إعادة التسجيل" })).toBeVisible();
  await page.getByLabel("رقم الهاتف").fill("96777000100");
  await page.getByLabel("اعتماد الاسترداد").fill("A".repeat(24));
  await page.getByRole("button", { name: "إرسال رمز إثبات الهاتف" }).click();
  await expect(page.getByLabel("رمز إثبات الهاتف")).toBeVisible();
  await expect(page.getByRole("status")).toContainText("اعتماد الاسترداد");
  await expect(page.locator("p.identity-error")).toHaveCount(0);
});

test("remote logout failure keeps local sign-out and remains observable", async ({ page }) => {
  await page.route("**/api/auth/session**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ identity: authenticatedOperator }) });
  });
  await page.route("**/api/auth/logout", async (route) => {
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "IDENTITY_UNAVAILABLE" } }) });
  });
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "الرئيسية" })).toBeVisible();
  await page.getByText("حساب المشغل", { exact: true }).click();
  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await expect(page.getByRole("heading", { name: "الدخول بمفتاح المرور" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("تعذر تأكيد إبطال الجلسة");
  await expect(page.locator("p.identity-error")).toHaveCount(0);
});

test("security headers and cross-origin mutation guard are active", async ({ page }) => {
  await stubSession(page, 401);
  const cspMessages: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && /content security policy|csp/i.test(message.text())) cspMessages.push(message.text());
  });
  page.on("pageerror", (error) => {
    if (/content security policy|csp/i.test(error.message)) cspMessages.push(error.message);
  });

  const response = await page.goto("/");
  expect(response).not.toBeNull();
  const headers = response?.headers() ?? {};
  const csp = headers["content-security-policy"] ?? "";

  expect(csp).toContain("object-src 'none'");
  expect(csp).toContain("base-uri 'self'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(headers["strict-transport-security"]).toContain("max-age=63072000");
  expect(headers["x-frame-options"]).toBe("DENY");

  const developmentPolicy = csp.includes("'unsafe-inline'");
  if (developmentPolicy) {
    expect(csp).toContain("'unsafe-eval'");
  } else {
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).not.toContain("'unsafe-inline'");
    const nonce = csp.match(/'nonce-([^']+)'/)?.[1];
    expect(nonce).toBeTruthy();
    const renderedNonces = await page.locator("script[nonce]").evaluateAll((scripts) => scripts.map((script) => (script as HTMLScriptElement).nonce));
    expect(renderedNonces.length).toBeGreaterThan(0);
    expect(new Set(renderedNonces)).toEqual(new Set([nonce]));
  }

  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { name: /الدخول بمفتاح المرور|تعذر الوصول إلى الهوية/ })).toBeVisible();
  expect(cspMessages).toEqual([]);

  const crossOriginResponse = await page.request.post("/api/auth/logout", {
    headers: { Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site" },
  });
  expect(crossOriginResponse.status()).toBe(403);

  const sameOriginBrowserResponse = await page.request.post("/api/auth/logout", { headers: { Referer: page.url() } });
  expect(sameOriginBrowserResponse.status()).not.toBe(403);
});

test("rendered light and dark themes preserve RTL and keyboard focus", async ({ page }) => {
  await stubSession(page, 401);
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.goto("/");
  const lightBackground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  const passkeyButton = page.getByRole("button", { name: "الدخول بمفتاح المرور" });
  await passkeyButton.focus();
  await expect(passkeyButton).toBeFocused();

  await page.emulateMedia({ colorScheme: "dark" });
  await page.reload();
  const darkBackground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(darkBackground).not.toBe(lightBackground);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
});
