import { expect, test } from "./coverage-fixtures";

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

test("partner store commission policy creates, reads back, and rejects stale no-op changes", async ({ page }) => {
  let policy: Record<string, unknown> | undefined;
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
  await page.route("**/api/catalog/verticals", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ verticals: [vertical] }) });
  });
  await page.route("**/api/catalog/commercial-store-types?**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ storeTypes: [storeType] }) });
  });
  await page.route("**/api/finance/commercial-store-type-commission-policies**", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ commercialStoreTypeId: storeType.id, policies: policy ? [policy] : [] }),
      });
      return;
    }
    writes.push(route.request().postDataJSON() as Record<string, unknown>);
    if (writes.length === 1) {
      policy = {
        commercialStoreTypeId: storeType.id,
        fulfillmentMode: "BTHWANI_CAPTAIN",
        commissionRateBps: 850,
        policyVersion: 1,
        updatedAt: "2026-10-02T00:00:00.000Z",
        changedByActorId: operatorSession.subject,
        changeReason: "إنشاء سياسة المطعم",
      };
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ policy, idempotentReplay: false }) });
      return;
    }
    await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: { message: "تغير إصدار السياسة" } }) });
  });

  await page.goto("/finance/partner-store-commissions");
  await expect(page.getByRole("heading", { name: "عمولة المنصة حسب نوع المتجر" })).toBeVisible();
  const storeTypeSelect = page.getByLabel("نوع المتجر التجاري");
  await expect(storeTypeSelect).toBeEnabled();
  await storeTypeSelect.selectOption(storeType.id);
  await page.getByRole("button", { name: "قراءة السياسة" }).click();
  await expect(page.getByText("تمت قراءة السياسات المركزية لهذا النوع من WLT.")).toBeVisible();
  await expect(page.getByText("لا توجد سياسة بعد").first()).toBeVisible();

  await page.locator("#commission-rate-BTHWANI_CAPTAIN").fill("8.50");
  await page.getByLabel("سبب التغيير (إلزامي، 8 إلى 500 حرف)").fill("سياسة افتتاح المطعم");
  await page.getByRole("button", { name: "إنشاء سياسة توصيل بثواني" }).click();
  await expect(page.getByText("تم حفظ السياسة مع سجل التدقيق.", { exact: false })).toBeVisible();
  expect(writes[0]).toMatchObject({ commercialStoreTypeId: storeType.id, fulfillmentMode: "BTHWANI_CAPTAIN", commissionRateBps: 850, expectedVersion: 0, reason: "سياسة افتتاح المطعم" });
  await expect(page.getByText("الإصدار 1")).toBeVisible();
  await expect(page.getByText("8.50%", { exact: true })).toBeVisible();

  await page.getByLabel("سبب التغيير (إلزامي، 8 إلى 500 حرف)").fill("محاولة مكررة");
  await page.getByRole("button", { name: "حفظ نسبة توصيل بثواني" }).click();
  await expect(page.locator(".validation-error[role=alert]")).toContainText("مطابقة للنسبة الحالية");
  expect(writes).toHaveLength(1);

  await page.locator("#commission-rate-BTHWANI_CAPTAIN").fill("8.75");
  await page.getByRole("button", { name: "حفظ نسبة توصيل بثواني" }).click();
  await expect(page.locator(".validation-error[role=alert]")).toContainText("تغير إصدار السياسة");
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
