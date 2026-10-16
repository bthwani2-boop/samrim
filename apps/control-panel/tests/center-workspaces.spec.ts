import { expect, type Page, test } from "@playwright/test";

const session = { subject: "operator-centers", sessionId: "centers-test", role: "operator", permissions: ["finance", "hr"], surface: "control-panel", expiresAt: "2099-01-01T00:00:00Z" };
async function authenticate(page: Page, permissions = session.permissions) {
  await page.route("**/api/auth/session**", (route) => route.fulfill({ json: { identity: { ...session, permissions } } }));
}
async function financeFixtures(page: Page, failed = false) {
  const requests: URL[] = [];
  await page.route("**/api/finance/**", (route) => {
    const url = new URL(route.request().url());
    requests.push(url);
    if (failed && url.pathname.endsWith("cash-custody")) return route.fulfill({ status: 503, json: {} });
    if (url.pathname.endsWith("cash-custody")) return route.fulfill({ json: { items: [{ paymentIntentId: "cash-1", externalReference: "طلب 102", captainName: "كابتن الاختبار", amountMinor: 15000, currency: "YER", remittanceState: "SUBMITTED" }] } });
    if (url.pathname.endsWith("partner-commission-receivables")) return route.fulfill({ json: { items: [{ partnerActorId: "partner-1", businessName: "متجر الاختبار", outstandingCommissionReceivableMinor: 6000, currency: "YER" }] } });
    if (url.pathname.endsWith("settlement-batches")) return route.fulfill({ json: { batches: [{ id: "batch-1", rowCount: 2, totalAmountMinor: 9000, currency: "YER", status: "PREPARED" }] } });
    if (url.pathname.endsWith("customer-withdrawal-intakes")) return route.fulfill({ json: { intakes: [{ id: "intake-1", beneficiaryName: "عميل الاختبار", status: "REQUESTED" }] } });
    return route.fulfill({ status: 404, json: {} });
  });
  return requests;
}

test("finance root does not fetch financial data without permission", async ({ page }) => {
  await authenticate(page, []);
  const requests = await financeFixtures(page);
  await page.goto("/finance");
  await expect(page.getByText("الوصول إلى هذه المساحة غير مفعّل")).toBeVisible();
  expect(requests).toHaveLength(0);
});

test("HR root opens employee owner directly and preserves disclosed form input", async ({ page }) => {
  await authenticate(page);
  await page.route("**/api/hr/employees?**", (route) => route.fulfill({ json: { items: [], nextCursor: "" } }));
  await page.goto("/hr");
  await expect(page).toHaveURL(/\/hr$/);
  await expect(page.locator(".hr-directory .page-header h1")).toHaveText("الموارد البشرية");
  await page.getByRole("button", { name: "إضافة موظف" }).click();
  await page.getByLabel("الاسم الكامل", { exact: true }).fill("مسودة الموظف");
  await page.getByRole("button", { name: "إضافة موظف" }).click();
  await page.getByRole("button", { name: "إضافة موظف" }).click();
  await expect(page.getByLabel("الاسم الكامل", { exact: true })).toHaveValue("مسودة الموظف");
});

test("HR malformed successful response exposes retry rather than crashing or implying empty", async ({ page }) => {
  await authenticate(page);
  let broken = true;
  await page.route("**/api/hr/employees?**", (route) => route.fulfill({ json: broken ? { items: null } : { items: [], nextCursor: "" } }));
  await page.goto("/hr");
  await expect(page.locator(".hr-directory [role='alert']")).toContainText("الاستجابة غير صالحة");
  await expect(page.getByText("لا يوجد موظفون مطابقون للبحث.")).toHaveCount(0);
  broken = false;
  await page.getByRole("button", { name: "إعادة تحميل السجل" }).click();
  await expect(page.locator(".hr-directory [role='alert']")).toHaveCount(0);
  await expect(page.locator(".hr-directory table")).toContainText("لا يوجد موظفون مطابقون للبحث.");
});
