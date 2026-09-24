import { expect, test } from "@playwright/test";
import { enrollAndAuthenticateExistingOperator } from "./live-identity-proof-helpers";

test.beforeEach(async ({ page }) => {
  await enrollAndAuthenticateExistingOperator(page);
});

test("@live operator reads the real bounded COD cash-custody journey", async ({ page }) => {
  test.setTimeout(30_000);
  await page.goto("/finance/cash-custody");
  await expect(page.getByRole("heading", { name: "حفظ النقد" })).toBeVisible();
  await expect(page.getByText("التزامات نقدية محصلة ضمن الإسقاط الحالي")).toBeVisible();
  await expect(page.getByText("طلبات التسوية والوجهات الرسمية تظهر في مساحة التسوية الموحدة أدناه.")).toBeVisible();

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
  await expect(page.getByRole("heading", { name: "سياسة رسوم التوصيل" })).toBeVisible();
  await expect(page.getByText("تُحسب الرسوم خادميًا من المسافة، ومدينة الخدمة كمنطقة، ووحدات السلة.")).toBeVisible();
  await expect(page.getByLabel("المنطقة / مدينة الخدمة")).toBeVisible();
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
  await page.goto("/finance/beneficiary-settlement");
  const workspace = page.getByRole("region", { name: "وجهة وتسوية المستفيد" });
  await expect(workspace.getByRole("heading", { name: "وجهة وتسوية المستفيد" })).toBeVisible();
  await expect(page.getByText("إدارة الوجهة الرسمية تتم من المالية فقط")).toBeVisible();
  await workspace.getByLabel("نوع المستفيد").selectOption("partner");
  await workspace.getByLabel("معرّف الشريك").fill(`partner-live-read-${Date.now()}`);
  await workspace.getByRole("button", { name: "قراءة الحالة" }).click();
  await expect(workspace.getByText(/المتاح:.*ريال يمني/)).toBeVisible();
});

test("@live operator sees the WLT-managed Field commission policy workspace", async ({ page }) => {
  test.setTimeout(30_000);
  await page.goto("/policies/field-rewards");
  await expect(page.getByRole("heading", { name: "سياسة مكافأة الميدان" })).toBeVisible();
  await expect(page.getByText("تُستحق المكافأة مرة واحدة عند ظهور المتجر في تطبيق العميل.")).toBeVisible();
  await expect(page.getByLabel("نطاق السياسة")).toBeVisible();
  await expect(page.getByLabel("المكافأة (ريال)")).toBeEnabled();
  await expect(page.getByText("وحدة التقريب: 50 ريال — لا يمكن تغييرها من الواجهة.")).toBeVisible();
});
