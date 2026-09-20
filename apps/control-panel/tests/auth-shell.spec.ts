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
  surface: "control-panel",
  expiresAt: "2099-01-01T00:00:00.000Z",
};

async function stubAuthenticatedSession(page: Page) {
  await page.route("**/api/auth/session**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ identity: authenticatedOperator }) });
  });
}

test("signed-out access to a protected workspace route returns to the identity surface", async ({ page }) => {
  await stubSession(page, 401);
  await page.goto("/workspace");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "الدخول بمفتاح المرور" })).toBeVisible();
});

test("authenticated operator discovers access and partner responsibilities through workspace navigation", async ({ page }) => {
  await stubAuthenticatedSession(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await expect(page).toHaveURL(/\/workspace$/);
  await expect(page.getByRole("heading", { name: "الرئيسية" })).toBeVisible();
  const navigationToggle = page.getByRole("button", { name: "فتح مسارات العمل" });
  await navigationToggle.click();
  await expect(page.getByRole("navigation", { name: "تنقل مساحة المشغل" })).toHaveAttribute("data-open", "true");
  const accessLink = page.getByRole("link", { name: "الوصول والأمان" });
  await expect(accessLink).toBeVisible();
  await accessLink.click();
  await expect(page).toHaveURL(/\/access$/);
  await expect(accessLink).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "الحسابات والأدوار" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "تهيئة أو إيقاف الحساب" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("#workspace-main")).toBeFocused();

  await page.reload();
  await expect(page.getByRole("heading", { name: "الحسابات والأدوار" })).toBeVisible();
});

test("workspace routes keep one main landmark and an actor-specific page hierarchy", async ({ page }) => {
  test.setTimeout(120_000);
  await stubAuthenticatedSession(page);
  const routes = [
    ["/workspace", "الرئيسية"],
    ["/access", "الحسابات والأدوار"],
    ["/partners", "انضمام الشركاء"],
    ["/operations", "العمليات"],
    ["/captains", "قبول الكباتن"],
    ["/fields", "قبول الميدان"],
    ["/catalog", "الكتالوج"],
  ] as const;

  for (const [path, heading] of routes) {
    await page.goto(path, { waitUntil: "commit" });
    await expect(page.locator("#workspace-main")).toHaveCount(1, { timeout: 30_000 });
    await expect(page.locator("#workspace-main > main")).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible({ timeout: 30_000 });
    const navigationLabel = heading === "الرئيسية" ? "الرئيسية" : path === "/access" ? "الوصول والأمان" : path === "/partners" ? "الشركاء والمتاجر" : path === "/operations" ? "العمليات" : path === "/captains" ? "الكباتن" : path === "/fields" ? "الميدان" : "الكتالوج";
    await expect(page.getByRole("navigation", { name: "تنقل مساحة المشغل" }).getByRole("link", { name: navigationLabel, exact: true })).toHaveAttribute("aria-current", "page", { timeout: 30_000 });
  }
});

test("workspace shell exposes nested breadcrumbs and the current resource", async ({ page }) => {
  await stubAuthenticatedSession(page);
  await page.goto("/catalog/products");
  const breadcrumbs = page.getByRole("navigation", { name: "مسار الصفحة" });
  await expect(breadcrumbs.getByRole("link", { name: "الكتالوج", exact: true })).toHaveAttribute("href", "/catalog");
  await expect(breadcrumbs.locator('[aria-current="page"]')).toContainText("المنتجات");

  await page.goto("/partners/service-cities");
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
  await page.getByLabel("داكن").check();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("operator direct navigation to access exposes the canonical access capability", async ({ page }) => {
  await stubAuthenticatedSession(page);
  await page.goto("/access");
  await expect(page.getByRole("heading", { name: "الحسابات والأدوار" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "تهيئة أو إيقاف الحساب" })).toBeVisible();
});

test("operator access keeps phone discovery separate from actorId mutation", async ({ page }) => {
  await stubAuthenticatedSession(page);
  let mutationBody: Record<string, unknown> | undefined;
  await page.route("**/api/access/managed-user/status**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        actorId: "act_partner_canonical",
        phoneE164: "+96777000102",
        role: "partner",
        exists: true,
        enabled: true,
        activated: true,
        securityEnabled: true,
        state: "active",
        actorVersion: 7,
        roleVersion: 3,
        admittedRoles: [{ actorId: "act_partner_canonical", role: "partner", state: "active", enabled: true, activated: true, securityEnabled: true }],
      }),
    });
  });
  await page.route("**/api/access/account-control", async (route) => {
    mutationBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ status: 204 });
  });
  await page.goto("/access");
  await page.getByLabel("رقم الهاتف للبحث").fill("+96777000102");
  await expect(page.getByText("الحالة: نشط")).toBeVisible();
  await expect(page.getByText("الشريك · نشط")).toBeVisible();
  await expect(page.getByText("act_partner_canonical")).toHaveCount(0);
  await page.getByLabel("سبب التغيير").fill("مراجعة صلاحية الحساب");
  await page.getByRole("button", { name: "إيقاف الدور" }).click();
  expect(mutationBody).toMatchObject({ actorId: "act_partner_canonical", role: "partner", action: "disable-role", expectedVersion: 3 });
});

test("field access exposes DSH-owned eligibility and role controls", async ({ page }) => {
  await stubAuthenticatedSession(page);
  let mutationBody: Record<string, unknown> | undefined;
  await page.route("**/api/access/managed-user/status**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        actorId: "act_field_admitted",
        phoneE164: "+96777000103",
        role: "field",
        exists: true,
        enabled: true,
        activated: true,
        securityEnabled: true,
        state: "active",
        actorVersion: 4,
        roleVersion: 2,
        operationalAdmissionState: "eligible",
        admittedRoles: [{ actorId: "act_field_admitted", role: "field", state: "active", enabled: true, activated: true, securityEnabled: true }],
      }),
    });
  });
  await page.route("**/api/access/account-control", async (route) => {
    mutationBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ status: 204 });
  });
  await page.goto("/access");
  await page.getByLabel("الدور الإداري").selectOption("field");
  await page.getByLabel("رقم الهاتف للبحث").fill("+96777000103");
  await expect(page.getByText("الأهلية التشغيلية: مؤهل للتشغيل")).toBeVisible();
  await expect(page.getByRole("button", { name: "إصدار دعوة إعادة تسجيل الدور" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "إيقاف الدور" })).toBeVisible();
  await expect(page.getByRole("button", { name: "إيقاف الهوية بالكامل" })).toBeVisible();
  await page.getByLabel("سبب التغيير").fill("تجميد أهلية الميدان");
  await page.getByRole("button", { name: "إيقاف الدور" }).click();
  expect(mutationBody).toMatchObject({ actorId: "act_field_admitted", role: "field", action: "disable-role", expectedVersion: 2 });
});

test("captain access exposes DSH-owned eligibility and routes role control canonically", async ({ page }) => {
  await stubAuthenticatedSession(page);
  let mutationBody: Record<string, unknown> | undefined;
  await page.route("**/api/access/managed-user/status**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        actorId: "act_captain_admitted",
        phoneE164: "+96777000104",
        role: "captain",
        exists: true,
        enabled: true,
        activated: true,
        securityEnabled: true,
        state: "active_unavailable",
        actorVersion: 5,
        roleVersion: 6,
        operationalAdmissionState: "eligible",
        operationalAvailabilityState: "unavailable",
        admittedRoles: [{ actorId: "act_captain_admitted", role: "captain", state: "active", enabled: true, activated: true, securityEnabled: true }],
      }),
    });
  });
  await page.route("**/api/access/account-control", async (route) => {
    mutationBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ status: 204 });
  });
  await page.goto("/access");
  await page.getByLabel("الدور الإداري").selectOption("captain");
  await page.getByLabel("رقم الهاتف للبحث").fill("+96777000104");
  await expect(page.getByText("الأهلية التشغيلية: مؤهل للتشغيل · التوافر: غير متاح حاليًا")).toBeVisible();
  await expect(page.getByText("act_captain_admitted")).toHaveCount(0);
  await page.getByLabel("سبب التغيير").fill("تعليق أهلية الكابتن للمراجعة");
  await page.getByRole("button", { name: "إيقاف الدور" }).click();
  expect(mutationBody).toMatchObject({ actorId: "act_captain_admitted", role: "captain", action: "disable-role", expectedVersion: 6 });
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
  await expect(page.getByText(/الإصدار/)).toHaveCount(0);
});

test("operator operations uses the DSH read model and resource actions", async ({ page }) => {
  await stubAuthenticatedSession(page);
  let mutationBody: Record<string, unknown> | undefined;
  let requestedCursor = "";
  const operation = {
    order: { id: "order_ready", state: "READY_FOR_DISPATCH", totalAmountMinor: 1800, currency: "YER", paymentMethod: "CASH_ON_DELIVERY", paymentState: "REQUIRES_COLLECTION", paymentIntentId: "payment_ready", version: 3, updatedAt: "2026-09-18T06:00:00.000Z", addressText: "شارع الاختبار", serviceCityId: "sanaa", serviceabilityStatus: "SERVICEABLE", lines: [] },
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
      body: JSON.stringify({ operation: { ...operation, order: { ...operation.order, lines: [{ id: "line-1", productName: "قهوة", variantTitle: "الافتراضي", finalQuantityBaseUnits: 1, lineAmountMinor: 1800, currency: "YER" }] } } }),
    });
  });
  await page.route("**/api/captains", async (route) => {
    mutationBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ operation: "dispatch", idempotentReplay: false }) });
  });
  await page.goto("/operations");
  await expect(page.getByRole("heading", { name: "العمليات" })).toBeVisible();
  await expect(page.getByText("order_ready")).toBeVisible();
  await expect(page.getByRole("button", { name: "إرسال للتوزيع" })).toBeVisible();
  await page.getByText("order_ready").click();
  await expect(page.getByText("شارع الاختبار")).toBeVisible();
  await expect(page.getByText("الدفع: الدفع نقدًا عند الاستلام · بانتظار التحصيل عند التسليم")).toBeVisible();
  await expect(page.getByText("قهوة · الافتراضي · 1")).toBeVisible();
  await page.getByRole("button", { name: "إرسال للتوزيع" }).click();
  expect(mutationBody).toMatchObject({ action: "dispatch", orderId: "order_ready" });
  await page.getByRole("button", { name: "قراءة الصفحة التالية" }).click();
  await expect(page.getByText("order_ready")).toBeVisible();
  await expect(page.getByRole("button", { name: "قراءة الصفحة التالية" })).toHaveCount(0);
  expect(requestedCursor).toBe("cursor-page-2");
  await expect(page.getByRole("textbox")).toHaveCount(0);
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
  await expect(page.getByText(/تمت قراءة حالة القبول: مؤهل لإنشاء الملفات/)).toBeVisible();
  expect(requestBody).toEqual({ contactPhoneE164: "+96777000104" });
});

test("operator creates a DSH-owned joining case from prospective partner facts", async ({ page }) => {
  await stubAuthenticatedSession(page);
  let requestBody: unknown;
  await page.route("**/api/service-cities**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ cities: [{ id: "sanaa", displayNameAr: "صنعاء", active: true, version: 1, createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z" }] }) });
  });
  await page.route("**/api/catalog/verticals", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ verticals: [{ id: "grocery", nameAr: "بقالة", nameEn: "Grocery", active: true, version: 1, createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z" }] }) });
  });
  await page.route("**/api/partners/joining-cases/join_test", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        case: { id: "join_test", contactPhoneE164: "+96777000100", businessName: "نشاط الاختبار", firstStoreName: "متجر الاختبار", serviceCityId: "sanaa", firstStoreVerticalId: "grocery", firstStoreLatitude: 15.369445, firstStoreLongitude: 44.191006, state: "draft", version: 1, createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z" },
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
        case: { id: "join_test", contactPhoneE164: "+96777000100", businessName: "نشاط الاختبار", firstStoreName: "متجر الاختبار", serviceCityId: "sanaa", firstStoreVerticalId: "grocery", firstStoreLatitude: 15.369445, firstStoreLongitude: 44.191006, state: "draft", version: 1, createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z" },
        idempotentReplay: false,
      }),
    });
  });

  await page.goto("/partners/new");
  await expect(page.getByRole("heading", { name: "إنشاء حالة انضمام", exact: true })).toBeVisible();
  await expect(page.getByLabel("معرّف Actor الشريك")).toHaveCount(0);
  await expect(page.getByLabel("رقم هاتف الشريك")).toBeVisible();

  await page.getByLabel("رقم هاتف الشريك").fill("+967 77000100");
  await page.getByLabel("الاسم القانوني للنشاط").fill("نشاط الاختبار");
  await page.getByLabel("اسم المتجر الأول").fill("متجر الاختبار");
  await page.getByLabel("مدينة المتجر الأول").selectOption("sanaa");
  await page.getByLabel("المجال التجاري").selectOption("grocery");
  await page.getByLabel("خط عرض موقع المتجر").fill("15.369445");
  await page.getByLabel("خط طول موقع المتجر").fill("44.191006");
  await page.getByRole("button", { name: "إنشاء حالة انضمام" }).click();

  await expect(page.getByRole("status")).toContainText("الحالة: مسودة");
  expect(requestBody).toEqual({ contactPhoneE164: "+96777000100", businessName: "نشاط الاختبار", firstStoreName: "متجر الاختبار", serviceCityId: "sanaa", firstStoreVerticalId: "grocery", firstStoreLatitude: 15.369445, firstStoreLongitude: 44.191006 });
});

test("operator gets an actionable empty state when no active commerce vertical exists", async ({ page }) => {
  await stubAuthenticatedSession(page);
  await page.route("**/api/service-cities**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ cities: [] }) });
  });
  await page.route("**/api/catalog/verticals", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ verticals: [] }) });
  });
  await page.route("**/api/partners/joining-cases?limit=50", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ cases: [] }) });
  });
  await page.goto("/partners/new");
  await expect(page.getByText("لا يمكن إنشاء الحالة بعد", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "فتح مدن الخدمة" })).toHaveAttribute("href", "/partners/service-cities");
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

  await page.goto("/partners/service-cities");
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
  await page.goto("/partners/service-cities");
  await page.getByLabel("الاسم العربي").fill("Sana'a");
  await page.getByRole("button", { name: "إضافة مدينة" }).click();
  await expect(page.locator("p.identity-error")).toContainText("باللغة العربية فقط");
  expect(mutationAttempted).toBe(false);
});

test("operator creates a canonical commerce vertical before onboarding partners", async ({ page }) => {
  await stubAuthenticatedSession(page);
  let requestBody: unknown;
  await page.route("**/api/catalog/verticals", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ verticals: [] }) });
      return;
    }
    requestBody = route.request().postDataJSON();
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ vertical: { id: "vertical_0123456789abcdef0123456789abcdef", nameAr: "مطاعم", nameEn: "Restaurants", active: true, version: 1, createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z" }, idempotentReplay: false }),
    });
  });
  await page.route("**/api/catalog/products**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ products: [] }) });
  });
  await page.goto("/catalog/verticals");
  await expect(page.getByLabel("المعرف البرمجي", { exact: true })).toHaveCount(0);
  await page.getByLabel("الاسم العربي", { exact: true }).fill("مطاعم");
  await page.getByLabel("الاسم الإنجليزي", { exact: true }).fill("Restaurants");
  await page.getByRole("button", { name: "إضافة مجال تجاري" }).click();
  await expect(page.getByRole("status")).toContainText("تم حفظ المجال التجاري: مطاعم.");
  await expect(page.getByRole("status")).not.toContainText("vertical_0123456789abcdef0123456789abcdef");
  expect(requestBody).toEqual({ nameAr: "مطاعم", nameEn: "Restaurants", active: true });
});

test("operator creates a product category under its commerce vertical", async ({ page }) => {
  await stubAuthenticatedSession(page);
  let requestBody: unknown;
  await page.route("**/api/catalog/verticals", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ verticals: [{ id: "vertical_0123456789abcdef0123456789abcdef", nameAr: "مطاعم", nameEn: "Restaurants", active: true, version: 1, createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z" }] }) });
  });
  await page.route("**/api/catalog/categories**", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ categories: [] }) });
      return;
    }
    requestBody = route.request().postDataJSON();
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ category: { id: "category_0123456789abcdef0123456789abcdef", verticalId: "vertical_0123456789abcdef0123456789abcdef", parentCategoryId: null, nameAr: "قهوة", nameEn: "Coffee", active: true, version: 1, createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z" } }) });
  });
  await page.route("**/api/catalog/products**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ products: [] }) });
  });
  await page.goto("/catalog/categories");
  await expect(page.getByLabel("المعرف البرمجي للتصنيف", { exact: true })).toHaveCount(0);
  await page.getByLabel("المجال التجاري").first().selectOption("vertical_0123456789abcdef0123456789abcdef");
  await page.getByLabel("الاسم العربي للتصنيف").fill("قهوة");
  await page.getByLabel("الاسم الإنجليزي للتصنيف").fill("Coffee");
  await page.getByRole("button", { name: "إضافة تصنيف" }).click();
  await expect(page.getByRole("status")).toContainText("تم حفظ التصنيف: قهوة.");
  await expect(page.getByRole("status")).not.toContainText("category_0123456789abcdef0123456789abcdef");
  expect(requestBody).toEqual({ verticalId: "vertical_0123456789abcdef0123456789abcdef", parentCategoryId: null, nameAr: "قهوة", nameEn: "Coffee", active: true });
});

test("operator replaces a product primary image and gallery through the canonical media mutation", async ({ page }) => {
  await stubAuthenticatedSession(page);
  const product = {
    id: "product_media_test",
    verticalId: "grocery",
    scope: "SHARED",
    canonicalName: "قهوة الصور",
    brand: null,
    storeId: null,
    active: true,
    version: 1,
    createdAt: "2026-09-12T00:00:00.000Z",
    updatedAt: "2026-09-12T00:00:00.000Z",
    variants: [{ id: "variant_media_test", productId: "product_media_test", title: "الافتراضي", measurementKind: "DISCRETE", baseUnit: "COUNT", active: true, version: 1, identifiers: [{ type: "SKU", value: "MEDIA-TEST" }], attributes: [], createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z" }],
    categoryIds: ["coffee"],
    attributes: [],
    media: [{ uri: "https://example.com/coffee.jpg", role: "primary", ordinal: 0 }],
  } as const;
  let mediaRequest: unknown;
  await page.route("**/api/catalog/verticals**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ verticals: [{ id: "grocery", nameAr: "بقالة", nameEn: "Grocery", active: true, version: 1, createdAt: product.createdAt, updatedAt: product.updatedAt }] }) });
  });
  await page.route("**/api/catalog/categories**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ categories: [{ id: "coffee", verticalId: "grocery", parentCategoryId: null, nameAr: "قهوة", nameEn: "Coffee", active: true, version: 1, createdAt: product.createdAt, updatedAt: product.updatedAt }] }) });
  });
  await page.route("**/api/catalog/products**", async (route) => {
    if (route.request().method() === "PUT") {
      mediaRequest = route.request().postDataJSON();
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ product: { ...product, version: 2, media: mediaRequest && typeof mediaRequest === "object" && "media" in mediaRequest ? (mediaRequest as { media: unknown }).media : product.media }, idempotentReplay: false }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ products: [product], nextCursor: "" }) });
  });

  await page.goto("/catalog/products");
  await page.getByRole("button", { name: /قهوة الصور/ }).click();
  await expect(page.getByLabel("رابط الصورة الأساسية")).toHaveValue("https://example.com/coffee.jpg");
  await page.getByLabel("رابط الصورة الأساسية").fill("https://example.com/coffee-updated.jpg");
  await page.getByLabel("صور المعرض").fill("https://example.com/coffee-gallery-1.jpg\nhttps://example.com/coffee-gallery-2.jpg");
  await page.getByRole("button", { name: "حفظ الصور" }).click();

  await expect(page.getByRole("status")).toContainText("تم حفظ صور المنتج.");
  expect(mediaRequest).toEqual({ media: [
    { uri: "https://example.com/coffee-updated.jpg", role: "primary", ordinal: 0 },
    { uri: "https://example.com/coffee-gallery-1.jpg", role: "gallery", ordinal: 1 },
    { uri: "https://example.com/coffee-gallery-2.jpg", role: "gallery", ordinal: 2 },
  ] });
});

test("operator resumes a canonical joining case from the DSH queue", async ({ page }) => {
  await stubAuthenticatedSession(page);
  await page.route("**/api/partners/joining-cases?limit=50", async (route) => {
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
         case: { id: "join_resume", contactPhoneE164: "+96777000101", businessName: "نشاط مستعاد", firstStoreName: "متجر مستعاد", serviceCityId: "sanaa", firstStoreVerticalId: "grocery", firstStoreLatitude: 15.369445, firstStoreLongitude: 44.191006, state: "submitted", version: 2, createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z" },
        idempotentReplay: false,
      }),
    });
  });
  await page.goto("/partners");
  await page.getByRole("link", { name: /قيد المراجعة · نشاط مستعاد/ }).click();
  await expect(page.getByRole("status")).toContainText("الحالة: قيد المراجعة");
  await expect(page.getByRole("status")).toContainText("نشاط مستعاد");
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
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ verticals: [{ id: "grocery", nameAr: "بقالة", nameEn: "Grocery", active: true, version: 1, createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z" }] }) });
  });
  await page.route("**/api/partners/joining-cases/join_test", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
         case: { id: "join_test", contactPhoneE164: "+96777000100", businessName: "نشاط الاختبار", firstStoreName: "متجر الاختبار", serviceCityId: "sanaa", firstStoreVerticalId: "grocery", firstStoreLatitude: 15.369445, firstStoreLongitude: 44.191006, partnerActorId: "act_generated", state: "approved", version: 5, store: { id: "store_test", partnerActorId: "act_generated", name: "متجر الاختبار", serviceCityId: "sanaa", primaryVerticalId: "grocery", deliveryOrigin: { latitude: 15.369445, longitude: 44.191006 }, version: 1, publicationState: "unpublished", publicationReadiness: { ready: false, blockedReason: "PARTNER_IDENTITY_NOT_ELIGIBLE" }, offers: [], createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z" }, createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z" },
        idempotentReplay: false,
      }),
    });
  });
  await page.route("**/api/partners/joining-cases", async (route) => {
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
         case: { id: "join_test", contactPhoneE164: "+96777000100", businessName: "نشاط الاختبار", firstStoreName: "متجر الاختبار", serviceCityId: "sanaa", firstStoreVerticalId: "grocery", firstStoreLatitude: 15.369445, firstStoreLongitude: 44.191006, partnerActorId: "act_generated", state: "approved", version: 5, store: { id: "store_test", partnerActorId: "act_generated", name: "متجر الاختبار", serviceCityId: "sanaa", primaryVerticalId: "grocery", deliveryOrigin: { latitude: 15.369445, longitude: 44.191006 }, version: 1, publicationState: "unpublished", publicationReadiness: { ready: false, blockedReason: "PARTNER_IDENTITY_NOT_ELIGIBLE" }, offers: [], createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z" }, createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z" },
        idempotentReplay: false,
      }),
    });
  });
  await page.route("**/api/stores/store_test/publication", async (route) => {
     await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ store: { id: "store_test", partnerActorId: "act_generated", name: "متجر الاختبار", serviceCityId: "sanaa", primaryVerticalId: "grocery", version: 1, publicationState: "unpublished", publicationReadiness: { ready: false, blockedReason }, offers: [], createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z" }, idempotentReplay: false }) });
  });
  await page.goto("/partners/new");
  await page.getByLabel("رقم هاتف الشريك").fill("+96777000100");
  await page.getByLabel("الاسم القانوني للنشاط").fill("نشاط الاختبار");
  await page.getByLabel("اسم المتجر الأول").fill("متجر الاختبار");
  await page.getByLabel("مدينة المتجر الأول").selectOption("sanaa");
  await page.getByLabel("المجال التجاري").selectOption("grocery");
  await page.getByLabel("خط عرض موقع المتجر").fill("15.369445");
  await page.getByLabel("خط طول موقع المتجر").fill("44.191006");
  await page.getByRole("button", { name: "إنشاء حالة انضمام" }).click();
  await page.getByRole("button", { name: "إعادة قراءة النشر" }).click();
  for (const reason of publicationReasons) {
    blockedReason = reason.code;
    await page.getByRole("button", { name: "إعادة القراءة" }).click();
    await expect(page.getByText(`الجاهزية: ${reason.label}`, { exact: true })).toBeVisible();
  }
  await expect(page.getByRole("button", { name: "نشر المتجر" })).toBeDisabled();
});

test("authenticated workspace keeps navigation meaning across light and dark themes", async ({ page }) => {
  await stubAuthenticatedSession(page);
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.goto("/workspace");

  const lightBackground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await expect(page.getByRole("link", { name: "الوصول والأمان" })).toBeVisible();
  await expect(page.getByRole("main")).toHaveAttribute("id", "workspace-main");

  await page.emulateMedia({ colorScheme: "dark" });
  await page.reload();
  const darkBackground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(darkBackground).not.toBe(lightBackground);
  await expect(page.getByRole("link", { name: "الوصول والأمان" })).toBeVisible();
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

test("production security headers and cross-origin mutation guard are active", async ({ page }) => {
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
  expect(csp).not.toContain("'unsafe-eval'");
  expect(csp).not.toContain("'unsafe-inline'");
  expect(headers["strict-transport-security"]).toContain("max-age=63072000");
  expect(headers["x-frame-options"]).toBe("DENY");

  const nonce = csp.match(/'nonce-([^']+)'/)?.[1];
  expect(nonce).toBeTruthy();
  const renderedNonces = await page.locator("script[nonce]").evaluateAll((scripts) => scripts.map((script) => (script as HTMLScriptElement).nonce));
  expect(renderedNonces.length).toBeGreaterThan(0);
  expect(new Set(renderedNonces)).toEqual(new Set([nonce]));

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
