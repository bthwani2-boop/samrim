import { expect, test } from "./coverage-fixtures";
import { enrollAndAuthenticateIsolatedOperator } from "./live-identity-proof-helpers";

test.beforeEach(async ({ page }, testInfo) => {
  const permissions = testInfo.title.includes("Field acquisition reward store-type policy")
    ? ["platform_policies", "catalog"]
    : testInfo.title.includes("delivery-fee policy")
      ? ["platform_policies"]
      : ["finance"];
  await enrollAndAuthenticateIsolatedOperator(page, permissions);
});

test("@live operator reads the real bounded COD cash-custody journey", async ({ page }) => {
  test.setTimeout(30_000);
  await page.goto("/finance/cash-custody");
  await expect(page.getByRole("heading", { name: "حفظ النقد" })).toBeVisible();
  await expect(page.getByText("التزامات نقدية مفتوحة ضمن المرشحات الحالية")).toBeVisible();
  await expect(page.getByText("البيانات من WLT، وتعرض فقط نقد COD الذي حصّله الكابتن ولم تسجل له حوالة.")).toBeVisible();

  const cashCustodyRead = await page.evaluate(async () => {
    const response = await fetch("/api/finance/cash-custody", { cache: "no-store" });
    return { status: response.status, body: await response.json() as { items?: unknown; totalAmountMinor?: unknown } };
  });
  expect(cashCustodyRead.status).toBe(200);
  expect(Array.isArray(cashCustodyRead.body.items)).toBe(true);
  expect(typeof cashCustodyRead.body.totalAmountMinor).toBe("number");
  await expect(page.locator(".finance-table tbody tr")).toHaveCount((cashCustodyRead.body.items as unknown[]).length);
});

test("@live operator reads the WLT-owned delivery-fee policy workspace", async ({ page }) => {
  test.setTimeout(30_000);
  await page.goto("/policies/delivery-fees");
  await expect(page.getByRole("heading", { name: "رسوم التوصيل", level: 2 })).toBeVisible();
  await expect(page.getByText("تُحسب الرسوم خادميًا من المسافة، ومدينة الخدمة كمنطقة، ووحدات السلة.")).toBeVisible();
  await expect(page.getByLabel("النطاق / مدينة الخدمة")).toBeVisible();
  await expect(page.getByLabel("الرسوم الأساسية (ريال)")).toBeEnabled();
  await expect(page.getByText(/التقريب ثابت عند 50 ريال/)).toBeVisible();

  const policyRead = await page.evaluate(async () => {
    const response = await fetch("/api/finance/delivery-fee-policy", { cache: "no-store" });
    return { status: response.status, body: await response.json() as { policy?: { state?: string; roundingUnitMinor?: number } } };
  });
  expect(policyRead.status).toBe(200);
  expect(policyRead.body.policy?.state).toBe("ACTIVE");
  expect(policyRead.body.policy?.roundingUnitMinor).toBe(50);
});

test("@live operator reads the WLT-managed unified beneficiary settlement workspace", async ({ page }) => {
  test.setTimeout(30_000);
  await page.goto("/finance/beneficiary-settlement/partners");
  const workspace = page.locator(".beneficiary-settlement-workspace");
  await expect(page.getByRole("heading", { name: "مستحقات وتسويات الشركاء والكباتن والميدان", level: 2 })).toBeVisible();
  await expect(page.getByText("المبالغ والوجهات تأتي من WLT. التحويل الخارجي يدوي، وكل تحويل يحتاج إيصالاً مستقلاً.")).toBeVisible();
  await expect(workspace.getByRole("navigation", { name: "سجلات مستحقات المستفيدين" }).getByRole("link", { name: "الشركاء" })).toHaveAttribute("aria-current", "page");
  await expect(workspace.getByText(/سجلات الصفحة الحالية:/)).toBeVisible();

  const registryRead = await page.evaluate(async () => {
    const response = await fetch("/api/finance/beneficiaries?actorType=partner&limit=50&sort=actor_asc", { cache: "no-store" });
    return { status: response.status, body: await response.json() as { beneficiaries?: unknown[]; nextCursor?: string } };
  });
  expect(registryRead.status, JSON.stringify(registryRead.body)).toBe(200);
  expect(Array.isArray(registryRead.body.beneficiaries)).toBe(true);
});

test("@live operator sees the WLT-managed Field acquisition reward store-type policy workspace", async ({ page }) => {
  test.setTimeout(30_000);
  await page.goto("/policies/field-acquisition");
  await expect(page.getByRole("heading", { name: "استحقاق ضم الشريك للميداني", level: 2 })).toBeVisible();
  await expect(page.getByText(/لكل نوع متجر تجاري سياسة مبلغ مستقلة/)).toBeVisible();

  const fixture = await page.evaluate(async () => {
    const suffix = crypto.randomUUID();
    const verticalResponse = await fetch("/api/catalog/verticals", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": `live-field-vertical-${suffix}` },
      body: JSON.stringify({
        nameAr: "مطاعم الاختبار الحي",
        nameEn: `Live restaurants ${suffix.slice(0, 8)}`,
        catalogModel: "STORE_LOCAL_CATALOG",
        active: true,
        reason: "إعداد بيانات سياسة استحقاق الميدان للاختبار الحي",
      }),
    });
    const verticalBody = await verticalResponse.json() as { vertical?: { id?: string }; error?: unknown };
    if (!verticalResponse.ok || !verticalBody.vertical?.id) {
      return { status: verticalResponse.status, verticalBody };
    }
    const verticalId = verticalBody.vertical.id;
    const storeTypeResponse = await fetch("/api/catalog/commercial-store-types", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": `live-field-store-type-${suffix}` },
      body: JSON.stringify({
        verticalId,
        nameAr: "مطعم الاختبار الحي",
        nameEn: `Live restaurant ${suffix.slice(0, 8)}`,
        active: true,
        reason: "إعداد نوع متجر لسياسة استحقاق الميدان للاختبار الحي",
      }),
    });
    const storeTypeBody = await storeTypeResponse.json() as { storeType?: { id?: string }; commercialStoreType?: { id?: string }; error?: unknown };
    return {
      status: storeTypeResponse.status,
      verticalId,
      storeTypeId: storeTypeBody.storeType?.id ?? storeTypeBody.commercialStoreType?.id,
      storeTypeBody,
    };
  });
  expect(fixture.status, JSON.stringify(fixture)).toBeGreaterThanOrEqual(200);
  expect(fixture.status, JSON.stringify(fixture)).toBeLessThan(300);
  expect(fixture.verticalId, JSON.stringify(fixture)).toBeTruthy();
  expect(fixture.storeTypeId, JSON.stringify(fixture)).toBeTruthy();

  await page.reload();
  const vertical = page.getByLabel("المجال التجاري");
  await expect(vertical).toBeVisible();
  await vertical.selectOption(fixture.verticalId as string);

  const storeType = page.getByLabel("نوع المتجر التجاري");
  await expect(storeType).toBeVisible();
  await storeType.selectOption(fixture.storeTypeId as string);

  await expect(page.getByLabel("مبلغ الاستحقاق لهذا النوع (ريال يمني)")).toBeEnabled();
  await expect(page.getByText(/وحدة التقريب ثابتة عند ٥٠ ريالًا/)).toBeVisible();
});
