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
  await expect(page.getByRole("heading", { name: "أهلاً بك في مساحة العمل" })).toBeVisible();
  await expect(page.getByText("المشغل", { exact: true }).first()).toBeVisible();
  const accessLink = page.getByRole("link", { name: "الحسابات والأدوار" });
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
    ["/workspace", "أهلاً بك في مساحة العمل"],
    ["/access", "الحسابات والأدوار"],
    ["/partners", "انضمام الشركاء"],
    ["/captains", "عمليات الكابتن"],
    ["/fields", "قبول الميدان"],
    ["/catalog", "كتالوج التجارة"],
  ] as const;

  for (const [path, heading] of routes) {
    await page.goto(path, { waitUntil: "commit" });
    await expect(page.locator("#workspace-main")).toHaveCount(1, { timeout: 30_000 });
    await expect(page.locator("#workspace-main > main")).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: heading })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("link", { name: heading === "أهلاً بك في مساحة العمل" ? "نظرة الهوية" : path === "/access" ? "الحسابات والأدوار" : path === "/partners" ? "تهيئة الشركاء" : path === "/captains" ? "عمليات الكابتن" : path === "/fields" ? "قبول الميدان" : "المنتجات المركزية" })).toHaveAttribute("aria-current", "page", { timeout: 30_000 });
  }
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
  await expect(page.getByText("حالة القبول: مؤهل للتشغيل · التوفر: غير متاح حاليًا")).toBeVisible();
  await expect(page.getByText("act_captain_test")).toHaveCount(0);
  await expect(page.getByText(/الإصدار/)).toHaveCount(0);
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
  await page.route("**/api/partners/joining-cases", async (route) => {
    requestBody = route.request().postDataJSON();
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        case: { id: "join_test", contactPhoneE164: "+96777000100", businessName: "نشاط الاختبار", firstStoreName: "متجر الاختبار", serviceCityId: "sanaa", state: "draft", version: 1, createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z" },
        idempotentReplay: false,
      }),
    });
  });

  await page.goto("/partners");
  await expect(page.getByRole("heading", { name: "انضمام الشركاء" })).toBeVisible();
  await expect(page.getByLabel("معرّف Actor الشريك")).toHaveCount(0);
  await expect(page.getByLabel("رقم هاتف الشريك")).toBeVisible();

  await page.getByLabel("رقم هاتف الشريك").fill("+967 77000100");
  await page.getByLabel("الاسم القانوني للنشاط").fill("نشاط الاختبار");
  await page.getByLabel("اسم المتجر الأول").fill("متجر الاختبار");
  await page.getByLabel("مدينة المتجر الأول").selectOption("sanaa");
  await page.getByLabel("المجال التجاري").selectOption("grocery");
  await page.getByRole("button", { name: "إنشاء حالة انضمام" }).click();

  await expect(page.getByRole("status")).toContainText("الحالة: مسودة");
  expect(requestBody).toEqual({ contactPhoneE164: "+96777000100", businessName: "نشاط الاختبار", firstStoreName: "متجر الاختبار", serviceCityId: "sanaa", firstStoreVerticalId: "grocery" });
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
  await page.goto("/partners");
  await expect(page.getByText("لا يمكن إنشاء طلب شريك بعد", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "فتح الكتالوج لإضافة مجال" })).toHaveAttribute("href", "/catalog");
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

  await page.goto("/partners");
  await page.getByLabel("الاسم العربي").fill("صنعاء");
  await page.getByRole("button", { name: "إضافة مدينة" }).click();

  await expect(page.getByText("المعرف التلقائي: city_0123456789abcdef0123456789abcdef")).toBeVisible();
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
  await page.goto("/partners");
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
  await page.goto("/catalog");
  await expect(page.getByLabel("المعرف البرمجي", { exact: true })).toHaveCount(0);
  await page.getByLabel("الاسم العربي", { exact: true }).fill("مطاعم");
  await page.getByLabel("الاسم الإنجليزي", { exact: true }).fill("Restaurants");
  await page.getByRole("button", { name: "إضافة مجال تجاري" }).click();
  await expect(page.getByRole("status")).toContainText("المعرف التلقائي: vertical_0123456789abcdef0123456789abcdef");
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
  await page.goto("/catalog");
  await expect(page.getByLabel("المعرف البرمجي للتصنيف", { exact: true })).toHaveCount(0);
  await page.getByLabel("المجال التجاري").first().selectOption("vertical_0123456789abcdef0123456789abcdef");
  await page.getByLabel("الاسم العربي للتصنيف").fill("قهوة");
  await page.getByLabel("الاسم الإنجليزي للتصنيف").fill("Coffee");
  await page.getByRole("button", { name: "إضافة تصنيف" }).click();
  await expect(page.getByRole("status")).toContainText("المعرف التلقائي: category_0123456789abcdef0123456789abcdef");
  expect(requestBody).toEqual({ verticalId: "vertical_0123456789abcdef0123456789abcdef", parentCategoryId: null, nameAr: "قهوة", nameEn: "Coffee", active: true });
});

test("operator resumes a canonical joining case from the DSH queue", async ({ page }) => {
  await stubAuthenticatedSession(page);
  await page.route("**/api/partners/joining-cases?limit=50", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ cases: [{ id: "join_resume", contactPhoneE164: "+96777000101", businessName: "نشاط مستعاد", firstStoreName: "متجر مستعاد", state: "submitted", version: 2, createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z" }] }),
    });
  });
  await page.route("**/api/partners/joining-cases/join_resume", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        case: { id: "join_resume", contactPhoneE164: "+96777000101", businessName: "نشاط مستعاد", firstStoreName: "متجر مستعاد", state: "submitted", version: 2, createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z" },
        idempotentReplay: false,
      }),
    });
  });
  await page.goto("/partners");
  await page.getByRole("button", { name: /قيد المراجعة · نشاط مستعاد/ }).click();
  await expect(page.getByRole("status")).toContainText("الحالة: قيد المراجعة");
  await expect(page.getByRole("status")).toContainText("نشاط مستعاد");
});

test("partner Store publication exposes the canonical readiness block", async ({ page }) => {
  await stubAuthenticatedSession(page);
  await page.route("**/api/service-cities**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ cities: [{ id: "sanaa", displayNameAr: "صنعاء", active: true, version: 1, createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z" }] }) });
  });
  await page.route("**/api/catalog/verticals", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ verticals: [{ id: "grocery", nameAr: "بقالة", nameEn: "Grocery", active: true, version: 1, createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z" }] }) });
  });
  await page.route("**/api/partners/joining-cases", async (route) => {
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        case: { id: "join_test", contactPhoneE164: "+96777000100", businessName: "نشاط الاختبار", firstStoreName: "متجر الاختبار", serviceCityId: "sanaa", firstStoreVerticalId: "grocery", partnerActorId: "act_generated", state: "approved", version: 5, store: { id: "store_test", partnerActorId: "act_generated", name: "متجر الاختبار", serviceCityId: "sanaa", primaryVerticalId: "grocery", version: 1, publicationState: "unpublished", publicationReadiness: { ready: false, blockedReason: "PARTNER_IDENTITY_NOT_ELIGIBLE" }, offers: [], createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z" }, createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z" },
        idempotentReplay: false,
      }),
    });
  });
  await page.route("**/api/stores/store_test/publication", async (route) => {
     await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ store: { id: "store_test", partnerActorId: "act_generated", name: "متجر الاختبار", serviceCityId: "sanaa", primaryVerticalId: "grocery", version: 1, publicationState: "unpublished", publicationReadiness: { ready: false, blockedReason: "PARTNER_IDENTITY_NOT_ELIGIBLE" }, offers: [], createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z" }, idempotentReplay: false }) });
  });
  await page.goto("/partners");
  await page.getByLabel("رقم هاتف الشريك").fill("+96777000100");
  await page.getByLabel("الاسم القانوني للنشاط").fill("نشاط الاختبار");
  await page.getByLabel("اسم المتجر الأول").fill("متجر الاختبار");
  await page.getByLabel("مدينة المتجر الأول").selectOption("sanaa");
  await page.getByLabel("المجال التجاري").selectOption("grocery");
  await page.getByRole("button", { name: "إنشاء حالة انضمام" }).click();
  await page.getByRole("button", { name: "إعادة قراءة النشر" }).click();
  await expect(page.getByRole("status")).toContainText("الجاهزية: محجوب");
  await expect(page.getByRole("button", { name: "نشر المتجر" })).toBeDisabled();
});

test("authenticated workspace keeps navigation meaning across light and dark themes", async ({ page }) => {
  await stubAuthenticatedSession(page);
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.goto("/workspace");

  const lightBackground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await expect(page.getByRole("link", { name: "الحسابات والأدوار" })).toBeVisible();
  await expect(page.getByRole("main")).toHaveAttribute("id", "workspace-main");

  await page.emulateMedia({ colorScheme: "dark" });
  await page.reload();
  const darkBackground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(darkBackground).not.toBe(lightBackground);
  await expect(page.getByRole("link", { name: "الحسابات والأدوار" })).toBeVisible();
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

  await expect(page.getByRole("heading", { name: "أهلاً بك في مساحة العمل" })).toBeVisible();
  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await expect(page.getByRole("heading", { name: "الدخول بمفتاح المرور" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("تعذر تأكيد إبطال الجلسة");
  await expect(page.locator("p.identity-error")).toHaveCount(0);
});

test("production security headers and cross-origin mutation guard are active", async ({ page }) => {
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
