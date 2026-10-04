import { expect, test } from "@playwright/test";

const operatorSession = {
  subject: "actor-finance-coverage",
  sessionId: "session-finance-coverage",
  role: "operator",
  permissions: ["finance", "catalog", "platform_policies", "access"],
  surface: "control-panel",
  expiresAt: "2099-01-01T00:00:00.000Z",
};

const vertical = {
  id: "food",
  nameAr: "الأغذية",
  nameEn: "Food",
  catalogModel: "SHARED_CATALOG",
  active: true,
  version: 1,
  createdAt: "2026-10-02T00:00:00.000Z",
  updatedAt: "2026-10-02T00:00:00.000Z",
};

const storeType = {
  id: "restaurant",
  verticalId: vertical.id,
  nameAr: "مطعم",
  nameEn: "Restaurant",
  active: true,
  version: 2,
  createdAt: "2026-10-02T00:00:00.000Z",
  updatedAt: "2026-10-02T00:00:00.000Z",
};

test("store type commission defaults remain suggestions, read back, and reject stale changes", async ({ page }) => {
  let defaultRate: Record<string, unknown> | undefined;
  const writes: Array<Record<string, unknown>> = [];

  await page.route("**/api/auth/session**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ identity: operatorSession }) });
  });
  await page.route("**/api/auth/profile**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ phoneE164: "+967700000000" }) });
  });
  await page.route("**/api/notifications**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ notifications: [], unreadCount: 0 }) });
  });
  await page.route("**/api/finance/store-commercial-agreements?**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ agreements: [], nextCursor: "" }) });
  });
  await page.route("**/api/catalog/verticals", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ verticals: [vertical] }) });
  });
  await page.route("**/api/catalog/commercial-store-types?**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ storeTypes: [storeType] }) });
  });
  await page.route("**/api/finance/commercial-store-type-commission-defaults**", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ commercialStoreTypeId: storeType.id, defaults: defaultRate ? [defaultRate] : [] }),
      });
      return;
    }
    writes.push(route.request().postDataJSON() as Record<string, unknown>);
    if (writes.length === 1) {
      defaultRate = {
        commercialStoreTypeId: storeType.id,
        fulfillmentMode: "BTHWANI_CAPTAIN",
        suggestedCommissionRateBps: 850,
        defaultVersion: 1,
        updatedAt: "2026-10-02T00:00:00.000Z",
        changedByActorId: operatorSession.subject,
        changeReason: "اقتراح افتتاح المطعم",
      };
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ default: defaultRate, idempotentReplay: false }) });
      return;
    }
    await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: { message: "تغير إصدار الاقتراح" } }) });
  });

  await page.goto("/finance/partner-store-commissions");
  await expect(page.getByRole("heading", { name: "نسب مقترحة حسب نوع المتجر" })).toBeVisible();
  await expect(page.getByText("هذه النسب تساعد على بدء التفاوض فقط.", { exact: false })).toBeVisible();
  const storeTypeSelect = page.getByLabel("نوع المتجر التجاري");
  await expect(storeTypeSelect).toBeEnabled();
  await storeTypeSelect.selectOption(storeType.id);
  await page.getByRole("button", { name: "قراءة النسب المقترحة" }).click();
  await expect(page.getByText("تمت قراءة النسب المقترحة من WLT.", { exact: false })).toBeVisible();
  await expect(page.getByText("لا يوجد اقتراح محفوظ بعد").first()).toBeVisible();

  await page.locator("#commission-default-rate-BTHWANI_CAPTAIN").fill("8.50");
  await page.getByLabel("سبب التغيير (إلزامي، 8 إلى 500 حرف)").fill("اقتراح افتتاح المطعم");
  await page.getByRole("button", { name: "حفظ اقتراح توصيل بثواني" }).click();
  await expect(page.getByText("تم حفظ النسبة المقترحة مع سجل التدقيق.", { exact: false })).toBeVisible();
  expect(writes[0]).toMatchObject({ commercialStoreTypeId: storeType.id, fulfillmentMode: "BTHWANI_CAPTAIN", suggestedCommissionRateBps: 850, expectedDefaultVersion: 0, reason: "اقتراح افتتاح المطعم" });
  await expect(page.getByText("الإصدار 1")).toBeVisible();
  await expect(page.getByText("8.50%", { exact: true })).toBeVisible();

  await page.getByLabel("سبب التغيير (إلزامي، 8 إلى 500 حرف)").fill("محاولة مكررة");
  await page.getByRole("button", { name: "حفظ النسبة المقترحة · توصيل بثواني" }).click();
  await expect(page.locator(".validation-error[role=alert]")).toContainText("مطابقة للاقتراح الحالي");
  expect(writes).toHaveLength(1);

  await page.locator("#commission-default-rate-BTHWANI_CAPTAIN").fill("8.75");
  await page.getByRole("button", { name: "حفظ النسبة المقترحة · توصيل بثواني" }).click();
  await expect(page.getByText("تغير إصدار الاقتراح", { exact: false })).toBeVisible();
  expect(writes).toHaveLength(2);
});

test("catalog taxonomy creates and revises a commercial store type under its vertical", async ({ page }) => {
  await page.route("**/api/auth/session**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ identity: operatorSession }) });
  });
  await page.route("**/api/auth/profile**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ phoneE164: "+967700000000" }) });
  });
  await page.route("**/api/notifications**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ notifications: [], unreadCount: 0 }) });
  });
  await page.route("**/api/catalog/verticals**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ verticals: [vertical] }) });
  });
  await page.route("**/api/catalog/categories**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ categories: [], nextCursor: "" }) });
  });

  let currentType: Record<string, unknown> | undefined;
  let createBody: Record<string, unknown> | undefined;
  let updateBody: Record<string, unknown> | undefined;
  await page.route("**/api/catalog/commercial-store-types**", async (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ storeTypes: currentType ? [currentType] : [] }) });
      return;
    }
    if (request.method() === "POST") {
      createBody = request.postDataJSON() as Record<string, unknown>;
      currentType = { ...storeType, nameAr: createBody.nameAr, nameEn: createBody.nameEn, version: 1, active: createBody.active };
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ storeType: currentType, idempotentReplay: false }) });
      return;
    }
    updateBody = request.postDataJSON() as Record<string, unknown>;
    currentType = { ...currentType, ...updateBody, version: 2 };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ storeType: currentType, idempotentReplay: false }) });
  });

  await page.goto("/catalog/categories?verticalId=food");
  await page.locator(".catalog-vertical-settings > summary").click();
  const registry = page.getByRole("region", { name: "أنواع المتاجر التجارية" });
  await expect(registry.getByRole("heading", { name: "أنواع المتاجر التجارية" })).toBeVisible();
  await expect(registry.getByText("لا توجد أنواع متجر مسجلة لهذا المجال بعد.")).toBeVisible();
  await registry.getByRole("button", { name: "نوع متجر جديد" }).click();
  await page.locator("#commercial-type-name-ar").fill("ملحمة");
  await page.locator("#commercial-type-name-en").fill("Butcher");
  await page.locator("#commercial-type-reason").fill("إضافة نوع متجر متخصص");
  await registry.getByRole("button", { name: "إنشاء نوع المتجر" }).click();
  await expect(registry.getByText("تم إنشاء نوع المتجر «ملحمة».")).toBeVisible();
  await expect(registry.getByRole("cell", { name: "Butcher" })).toBeVisible();
  expect(createBody).toMatchObject({ verticalId: "food", nameAr: "ملحمة", nameEn: "Butcher", active: true, reason: "إضافة نوع متجر متخصص" });

  await registry.getByRole("button", { name: "تعديل" }).click();
  await page.locator("#commercial-type-name-ar").fill("ملحمة محلية");
  await page.getByLabel("نشط للاستخدام في ملفات الانضمام والسياسات").uncheck();
  await page.locator("#commercial-type-reason").fill("إيقاف نوع غير مستخدم");
  await registry.getByRole("button", { name: "حفظ نوع المتجر" }).click();
  await expect(registry.getByText("تم تحديث نوع المتجر «ملحمة محلية». ", { exact: false })).toBeVisible();
  await expect(registry.getByRole("cell", { name: "متوقف" })).toBeVisible();
  expect(updateBody).toMatchObject({ nameAr: "ملحمة محلية", nameEn: "Butcher", active: false, expectedVersion: 1, reason: "إيقاف نوع غير مستخدم" });
});
