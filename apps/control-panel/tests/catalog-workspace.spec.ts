import { expect, type Page, test } from "@playwright/test";

const operatorSession = {
  subject: "actor-operator",
  sessionId: "session-operator",
  role: "operator",
  permissions: ["finance", "platform_policies"],
  surface: "control-panel",
  expiresAt: "2099-01-01T00:00:00.000Z",
};

async function stubAuthenticatedSession(page: Page) {
  await page.route("**/api/auth/session**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ identity: operatorSession }) });
  });
}

test("catalog landing exposes separate resource workspaces", async ({ page }) => {
  await stubAuthenticatedSession(page);
  await page.goto("/catalog");
  await expect(page.getByRole("heading", { name: "الكتالوج", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "تنقل مساحة المشغل" }).getByRole("link", { name: "الكتالوج", exact: true })).toHaveAttribute("aria-current", "page");
  for (const label of ["المنتجات", "المقترحات", "الاستيراد"]) {
    await expect(page.getByRole("navigation", { name: "تنقل مساحة المشغل" }).getByRole("link", { name: label, exact: true })).toHaveAttribute("href", /\/catalog\//);
  }
  await expect(page.getByRole("navigation", { name: "تنقل مساحة المشغل" }).getByRole("link", { name: "التصنيفات", exact: true })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "تنقل مساحة المشغل" }).getByRole("link", { name: "المجالات", exact: true })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "موارد الكتالوج" })).toHaveCount(0);
  await expect(page.locator("#catalog-import-rows")).toHaveCount(0);
});

test("catalog import uses the existing CSV file adapter and closes the loop", async ({ page }) => {
  await stubAuthenticatedSession(page);
  let previewBody: Record<string, unknown> | undefined;
  let readbackCount = 0;
  await page.route("**/api/catalog/imports/preview", async (route) => {
    previewBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        run: { id: "run-catalog", sourceSha256: "a".repeat(64), mode: "preview", state: "previewed", acceptedCount: 1, conflictCount: 0, createdAt: "2026-09-18T00:00:00.000Z" },
        items: [{ rowNumber: 2, stableKey: "facts:grocery:SHARED:قهوة:الافتراضي:DISCRETE:COUNT", classification: "READY", committed: false }],
        idempotentReplay: false,
      }),
    });
  });
  await page.route("**/api/catalog/imports/run-catalog", async (route) => {
    if (route.request().method() === "GET") {
      readbackCount += 1;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ run: { id: "run-catalog", sourceSha256: "a".repeat(64), mode: "commit", state: "committed", acceptedCount: 1, conflictCount: 0, createdAt: "2026-09-18T00:00:00.000Z" }, items: [{ rowNumber: 2, stableKey: "facts:grocery:SHARED:قهوة:الافتراضي:DISCRETE:COUNT", classification: "IMPORTED", committed: true }] }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ run: { id: "run-catalog", sourceSha256: "a".repeat(64), mode: "commit", state: "committed", acceptedCount: 1, conflictCount: 0, createdAt: "2026-09-18T00:00:00.000Z" }, items: [{ rowNumber: 2, stableKey: "facts:grocery:SHARED:قهوة:الافتراضي:DISCRETE:COUNT", classification: "IMPORTED", committed: true }], idempotentReplay: false }) });
  });

  await page.goto("/catalog/import");
  await expect(page.locator("#catalog-import-rows")).toHaveCount(0);
  await page.locator("#catalog-import-file").setInputFiles({
    name: "products.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("verticalId,scope,canonicalName,variantTitle,measurementKind,baseUnit,categoryIds\ngrocery,SHARED,قهوة,الافتراضي,DISCRETE,COUNT,coffee\n"),
  });
  await expect(page.getByText("الصفوف الصالحة: 1")).toBeVisible();
  await page.getByRole("button", { name: "معاينة الملف" }).click();
  await expect(page.getByText("حالة التشغيل: معاينة جاهزة")).toBeVisible();
  expect(previewBody?.rows).toEqual([expect.objectContaining({ rowNumber: 2, verticalId: "grocery", scope: "SHARED", canonicalName: "قهوة", categoryIds: ["coffee"] })]);
  await page.getByRole("button", { name: "الالتزام بعد المراجعة" }).click();
  await expect(page.getByText("حالة التشغيل: تم الالتزام")).toBeVisible();
  expect(readbackCount).toBeGreaterThan(0);
});

test("catalog proposal review shows detail and re-reads after approval", async ({ page }) => {
  await stubAuthenticatedSession(page);
  let queueRead = 0;
  const proposal = { id: "proposal-1", partnerActorId: "actor-partner", verticalId: "grocery", categoryId: "coffee", proposedName: "قهوة", proposedBrand: "علامة", proposedVariantTitle: "الافتراضي", proposedMeasurementKind: "DISCRETE", proposedBaseUnit: "COUNT", proposedIdentifierType: null, proposedIdentifierValue: null, proposedImageUri: null, state: "submitted", correctionReason: null, reviewedBy: null, version: 3, createdAt: "2026-09-18T00:00:00.000Z", updatedAt: "2026-09-18T00:00:00.000Z" };
  await page.route("**/api/catalog/proposals*", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    queueRead += 1;
     await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ proposals: queueRead < 3 ? [proposal] : [] }) });
  });
  await page.route("**/api/catalog/verticals", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ verticals: [{ id: "grocery", nameAr: "بقالة", nameEn: "Grocery", active: true, version: 1, createdAt: "2026-09-18T00:00:00.000Z", updatedAt: "2026-09-18T00:00:00.000Z" }] }) });
  });
  await page.route("**/api/catalog/categories?verticalId=grocery", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ categories: [{ id: "coffee", verticalId: "grocery", parentCategoryId: null, nameAr: "قهوة", nameEn: "Coffee", active: true, version: 1, createdAt: "2026-09-18T00:00:00.000Z", updatedAt: "2026-09-18T00:00:00.000Z" }] }) });
  });
  await page.route("**/api/catalog/proposals/proposal-1/review", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ proposal: { ...proposal, state: "approved", version: 4 }, idempotentReplay: false }) });
  });

  await page.goto("/catalog/proposals");
  await expect(page.getByRole("button", { name: /قهوة/ }).first()).toBeVisible();
  await page.getByRole("button", { name: /قهوة/ }).first().click();
  await expect(page.getByRole("heading", { name: "قهوة", exact: true })).toBeVisible();
  await expect(page.getByText("النسخة الحالية: 3")).toBeVisible();
  await expect(page.getByText("التصنيف").locator("..") .getByText("قهوة")).toBeVisible();
  await page.getByRole("button", { name: "اعتماد" }).click();
  await expect(page.getByRole("status")).toContainText("تم تسجيل القرار");
  expect(queueRead).toBeGreaterThan(1);
});
