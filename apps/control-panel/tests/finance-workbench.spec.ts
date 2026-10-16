import { expect, test } from "./coverage-fixtures";

const session = {
  subject: "finance-workbench-test",
  sessionId: "finance-workbench-local",
  role: "operator",
  permissions: ["finance"],
  surface: "control-panel",
  expiresAt: "2099-01-01T00:00:00.000Z",
};

function queues() {
  return {
    custody: {
      items: [{
        paymentIntentId: "cash-1",
        externalReference: "COD-12345",
        captainName: "كابتن تجريبي",
        amountMinor: 26000,
        currency: "YER",
        remittanceState: "SUBMITTED",
        remittanceId: "remit-1",
        collectedAt: "2026-10-15T10:30:00Z",
      }], totalAmountMinor: 26000, totalItems: 1, nextCursor: "",
    },
    commissions: { items: [{
      partnerActorId: "partner-1", businessName: "سوبر ماركت تجريبي",
      outstandingCommissionReceivableMinor: 8000, currency: "YER",
    }], nextCursor: "" },
    batches: { batches: [{
      id: "batch-1", rowCount: 3, totalAmountMinor: 50000,
      currency: "YER", status: "PREPARED",
    }], nextCursor: "" },
    withdrawals: { intakes: [{
      id: "withdrawal-1", beneficiaryName: "عميل تجريبي", status: "REQUESTED",
    }], nextCursor: "" },
  };
}

test.beforeEach(async ({ page }) => {
  await page.route("**/api/auth/session**", (route) => route.fulfill({ json: { identity: session } }));
  await page.route("**/api/notifications**", (route) => route.fulfill({ json: { notifications: [], unreadCount: 0 } }));
});

test("financial workbench shows one prioritized operational registry and in-page action", async ({ page }, testInfo) => {
  const data = queues();
  await page.route("**/api/finance/cash-custody?**", (route) => route.fulfill({ json: data.custody }));
  await page.route("**/api/finance/partner-commission-receivables?**", (route) => route.fulfill({ json: data.commissions }));
  await page.route("**/api/finance/settlement-batches?**", (route) => route.fulfill({ json: data.batches }));
  await page.route("**/api/finance/customer-withdrawal-intakes?**", (route) => route.fulfill({ json: data.withdrawals }));
  await page.goto("/finance");
  const registry = page.locator(".finance-center-records");
  await expect(registry.getByRole("row")).toHaveCount(5);
  await expect(registry).toContainText("كابتن تجريبي");
  await expect(registry).toContainText("سوبر ماركت تجريبي");
  await expect(registry).toContainText("عميل تجريبي");
  await expect(registry).toContainText("دفعة من ٣ تحويل");

  await registry.getByRole("button", { name: "كابتن تجريبي" }).click();
  const inspector = page.getByRole("region", { name: "معاينة المعاملة المالية" });
  await expect(page.locator(".adaptive-record-workspace")).toHaveAttribute("data-split", "true");
  await expect(registry).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("finance-record-split-desktop.png") });
  await expect(inspector).toContainText("COD-12345");
  await expect(inspector).toContainText("مراجعة الإيصال ومطابقة التوريد");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".finance-center-table")).toBeHidden();
  await expect(page.locator(".finance-center-mobile > li")).toHaveCount(4);
  await expect(page.locator(".adaptive-record-workspace")).toHaveAttribute("data-split", "false");
  await expect(inspector).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("finance-record-mobile.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator(".adaptive-record-workspace")).toHaveAttribute("data-split", "true");
  await inspector.getByRole("button", { name: "فتح المعالجة داخل الصفحة" }).click();
  await expect(page).toHaveURL(/\/finance$/);
  await expect(page.getByRole("heading", { name: "النقد المحصل عند التسليم" })).toBeVisible();
  await page.getByRole("button", { name: "العودة إلى المركز المالي" }).click();
  await expect(registry).toContainText("كابتن تجريبي");

  await page.getByLabel("نوع السجل").selectOption("commissions");
  await expect(registry.getByRole("row")).toHaveCount(2);
  await expect(registry).toContainText("سوبر ماركت تجريبي");
  await expect(registry).not.toContainText("كابتن تجريبي");
});

test("financial workbench distinguishes one empty state from four empty preview cards", async ({ page }) => {
  await page.route("**/api/finance/cash-custody?**", (route) => route.fulfill({ json: { items: [], nextCursor: "" } }));
  await page.route("**/api/finance/partner-commission-receivables?**", (route) => route.fulfill({ json: { items: [], nextCursor: "" } }));
  await page.route("**/api/finance/settlement-batches?**", (route) => route.fulfill({ json: { batches: [], nextCursor: "" } }));
  await page.route("**/api/finance/customer-withdrawal-intakes?**", (route) => route.fulfill({ json: { intakes: [], nextCursor: "" } }));
  await page.goto("/finance");
  await expect(page.getByText("لا توجد سجلات مطابقة", { exact: true })).toHaveCount(1);
  await expect(page.getByText("لا سجلات في هذه المعاينة.")).toHaveCount(0);
});

test("financial workbench never treats a failing owner read as empty data", async ({ page }) => {
  const data = queues();
  await page.route("**/api/finance/cash-custody?**", (route) => route.fulfill({ json: data.custody }));
  await page.route("**/api/finance/partner-commission-receivables?**", (route) => route.fulfill({ status: 503, json: { error: "owner unavailable" } }));
  await page.route("**/api/finance/settlement-batches?**", (route) => route.fulfill({ json: data.batches }));
  await page.route("**/api/finance/customer-withdrawal-intakes?**", (route) => route.fulfill({ json: data.withdrawals }));
  await page.goto("/finance");
  const warning = page.locator(".managed-status-warning[role=alert]");
  await expect(warning).toContainText("بعض المصادر المالية لم تُحمّل");
  await expect(warning).toContainText("ذمم عمولة المنصة");
  await expect(page.locator(".finance-center-records")).toContainText("كابتن تجريبي");
});


test("direct finance workflows open inside the single center while legacy routes remain available", async ({ page }) => {
  await page.route("**/api/finance/cash-custody?**", (route) => route.fulfill({ json: { items: [], nextCursor: "" } }));
  await page.route("**/api/finance/partner-commission-receivables?**", (route) => route.fulfill({ json: { items: [], nextCursor: "" } }));
  await page.route("**/api/finance/settlement-batches?**", (route) => route.fulfill({ json: { batches: [], nextCursor: "" } }));
  await page.route("**/api/finance/customer-withdrawal-intakes?**", (route) => route.fulfill({ json: { intakes: [], nextCursor: "" } }));
  await page.goto("/finance?workflow=settlement-captain");
  await expect(page.getByRole("heading", { name: "مستحقات الكباتن", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/finance\?workflow=settlement-captain$/);
  await expect(page.getByRole("button", { name: "العودة إلى المركز المالي" })).toBeVisible();
  await page.getByRole("button", { name: "العودة إلى المركز المالي" }).click();
  await expect(page).toHaveURL(/\/finance$/);
  await expect(page.getByRole("heading", { name: "سجل المتابعة المالية" })).toBeVisible();
});
