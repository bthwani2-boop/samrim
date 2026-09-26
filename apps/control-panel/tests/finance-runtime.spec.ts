import { expect, test } from "@playwright/test";
import { cleanupPreparedOperator, enrollAndAuthenticateIsolatedOperator, type PreparedOperator } from "./live-identity-proof-helpers";

let preparedOperatorForCleanup: PreparedOperator | undefined;

test.beforeEach(async ({ page }) => {
  preparedOperatorForCleanup = undefined;
  await enrollAndAuthenticateIsolatedOperator(page, ["finance"], (operator) => {
    preparedOperatorForCleanup = operator;
  });
});

test.afterEach(() => {
  const operator = preparedOperatorForCleanup;
  preparedOperatorForCleanup = undefined;
  if (operator?.createdByTest) cleanupPreparedOperator(operator);
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

test("@live operator sees the WLT-managed Field commission policy workspace", async ({ page }) => {
  test.setTimeout(30_000);
  await page.goto("/policies/field-rewards");
  await expect(page.getByRole("heading", { name: "مكافأة الميدان" })).toBeVisible();
  await expect(page.getByText("تُستحق المكافأة مرة واحدة عند نشر المتجر.")).toBeVisible();
  await expect(page.getByLabel("نطاق السياسة")).toBeVisible();
  await expect(page.getByLabel("المكافأة (ريال)")).toBeVisible();
  await expect(page.getByText("وحدة التقريب: 50 ريال — لا يمكن تغييرها من الواجهة.")).toBeVisible();
});
