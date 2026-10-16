import { expect, test } from "@playwright/test";
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
  await expect(page.getByRole("heading", { name: "النقد المحصل عند التسليم", level: 2 })).toBeVisible();
  await expect(page.getByLabel("مرجع التحصيل", { exact: true })).toBeVisible();

  const cashCustodyRead = await page.evaluate(async () => {
    const response = await fetch("/api/finance/cash-custody", { cache: "no-store" });
    return { status: response.status, body: await response.json() as { items?: unknown; totalAmountMinor?: unknown } };
  });
  expect(cashCustodyRead.status).toBe(200);
  expect(Array.isArray(cashCustodyRead.body.items)).toBe(true);
  expect(typeof cashCustodyRead.body.totalAmountMinor).toBe("number");
  await expect(page.locator(".finance-table tbody tr")).toHaveCount((cashCustodyRead.body.items as unknown[]).length);
});

test("@live operator reads the DSH-owned distance-band delivery-fee policy workspace", async ({ page }) => {
  test.setTimeout(30_000);
  await page.goto("/policies?policy=delivery-fees&action=manage");
  await expect(page.getByRole("heading", { name: "رسوم التوصيل", level: 2 })).toBeVisible();
  const workspace = page.getByRole("region", { name: "إعداد رسوم التوصيل", exact: true });
  await expect(workspace).toBeVisible();
  await expect(page.getByLabel("التسعير حسب")).toHaveValue("");
  await expect(page.getByRole("list", { name: "شرائح رسوم التوصيل" })).toBeVisible();
  await expect(page.getByText("لا رسوم حجم أو منطقة.", { exact: false })).toBeVisible();

  const policyRead = await page.evaluate(async () => {
    const response = await fetch("/api/finance/distance-band-fee-policy?serviceCityId=", { cache: "no-store" });
    return { status: response.status, body: await response.json() as {
      policy?: { id?: string; version?: number; serviceCityId?: string; distanceBands?: { upToMeters: number | null; ratePerKmMinor: number }[] };
      error?: { code?: string };
    } };
  });
  expect([200, 404], JSON.stringify(policyRead)).toContain(policyRead.status);
  if (policyRead.status === 200) {
    const policy = policyRead.body.policy;
    expect(policy?.id).toBeTruthy();
    expect(policy?.serviceCityId ?? "").toBe("");
    expect(policy?.version).toBeGreaterThan(0);
    expect(Array.isArray(policy?.distanceBands)).toBe(true);
    const bands = policy!.distanceBands!;
    let previous = 0;
    for (const [index, band] of bands.entries()) {
      expect(band.ratePerKmMinor).toBeGreaterThan(0);
      if (index === bands.length - 1) expect(band.upToMeters).toBeNull();
      else {
        expect(band.upToMeters).toBeGreaterThan(previous);
        previous = band.upToMeters!;
      }
    }
    await expect(workspace.locator(".delivery-tariff-tier")).toHaveCount(Math.max(1, bands.length));
    for (const [index, band] of bands.entries()) {
      await expect(workspace.getByRole("spinbutton", { name: `سعر الشريحة ${index + 1} لكل كيلومتر بالريال` }))
        .toHaveValue(String(band.ratePerKmMinor));
    }
  } else {
    await expect(workspace.getByText("لا توجد شرائح معتمدة لهذا النطاق")).toBeVisible();
    await expect(workspace.locator(".delivery-tariff-tier")).toHaveCount(1);
  }
});

test("@live operator reads the WLT-managed unified beneficiary settlement workspace", async ({ page }) => {
  test.setTimeout(30_000);
  await page.goto("/finance/beneficiary-settlement/partners");
  const workspace = page.locator(".beneficiary-settlement-workspace");
  await expect(page.getByRole("heading", { name: "مستحقات وتسويات الشركاء والكباتن والميدان", level: 2 })).toBeVisible();
  await expect(workspace.getByRole("navigation", { name: "مسارات مكتب التسويات" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "تنقل مساحة المشغل" }).getByRole("link", { name: "المالية", exact: true })).toHaveAttribute("aria-current", "location");
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
  await page.goto("/policies?policy=field-acquisition&action=manage");
  await expect(page.getByRole("region", { name: "إعداد مبلغ الاستحقاق", exact: true })).toBeVisible();
  await expect(page.locator('label[for="field-reward-vertical"]')).toContainText("اختر المجال");
  await expect(page.locator("#field-reward-vertical")).toBeVisible();

  const fixture = await page.evaluate(async () => {
    const suffix = crypto.randomUUID();
    const verticalResponse = await fetch("/api/catalog/verticals", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": `live-field-vertical-${suffix}` },
      body: JSON.stringify({
        nameAr: "مطاعم الاختبار الحي",
        nameEn: `Live restaurants ${suffix.slice(0, 8)}`,
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
  const vertical = page.locator("#field-reward-vertical");
  await expect(vertical).toBeVisible();
  await vertical.selectOption(fixture.verticalId as string);

  const storeType = page.locator("#field-reward-commercial-type");
  await expect(page.locator('label[for="field-reward-commercial-type"]')).toContainText("نوع المتجر الذي تُطبّق عليه المكافأة");
  await expect(storeType).toBeVisible();
  await storeType.selectOption(fixture.storeTypeId as string);

  await expect(page.getByLabel(/^مبلغ الاستحقاق \(ريال\)/)).toBeEnabled();
  await expect(page.locator("#field-acquisition-rounding")).toContainText("مضاعفات ٥٠؛ مرة واحدة عند ظهور أول متجر مؤهل.");
});
