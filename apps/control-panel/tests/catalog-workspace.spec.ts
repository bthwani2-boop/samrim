import { expect, type Page, test } from "@playwright/test";
import * as XLSX from "xlsx";

const operatorSession = {
  subject: "actor-operator",
  sessionId: "session-operator",
  role: "operator",
  permissions: ["finance", "platform_policies", "catalog"],
  surface: "control-panel",
  expiresAt: "2099-01-01T00:00:00.000Z",
};

async function stubAuthenticatedSession(page: Page) {
  await page.route("**/api/auth/session**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ identity: operatorSession }) });
  });
}

test("catalog center opens its product registry and exposes resource tabs", async ({ page }) => {
  await stubAuthenticatedSession(page);
  await page.goto("/catalog");
  await expect(page).toHaveURL(/\/catalog\/products$/);
  await expect(page.getByRole("heading", { name: "المنتجات", exact: true, level: 1 })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "تنقل مساحة المشغل" }).getByRole("link", { name: "الكتالوج", exact: true })).toHaveAttribute("aria-current", "location");
  const sideNavigation = page.getByRole("navigation", { name: "تنقل مساحة المشغل" });
  const catalogTabs = page.getByRole("navigation", { name: "مسارات الكتالوج" });
  for (const [label, href] of [["المنتجات", "/catalog/products"], ["الفئات", "/catalog/categories"], ["المقترحات", "/catalog/proposals"], ["الاستيراد", "/catalog/import"]] as const) {
    await expect(catalogTabs.getByRole("link", { name: label, exact: true })).toHaveAttribute("href", href);
    await expect(sideNavigation.getByRole("link", { name: label, exact: true })).toHaveCount(0);
  }
  await expect(catalogTabs.getByRole("link", { name: "المنتجات", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "اختر مورد الكتالوج" })).toHaveCount(0);
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
  await page.getByTestId("catalog-import-workspace").getByRole("button", { name: "معاينة الملف" }).click();
  await expect(page.getByText("حالة التشغيل: معاينة جاهزة")).toBeVisible();
  expect(previewBody?.rows).toEqual([expect.objectContaining({ rowNumber: 2, verticalId: "grocery", scope: "SHARED", canonicalName: "قهوة", categoryIds: ["coffee"] })]);
  await page.getByRole("button", { name: "الالتزام بالصفوف الجاهزة" }).click();
  await expect(page.getByText("حالة التشغيل: تم الالتزام")).toBeVisible();
  expect(readbackCount).toBeGreaterThan(0);
});

test("catalog XLSX import commits ready rows while preserving conflicts", async ({ page }) => {
  await stubAuthenticatedSession(page);
  const ready = { rowNumber: 2, stableKey: "identifier:EAN:6281000000001", classification: "READY", committed: false };
  const conflict = { rowNumber: 3, stableKey: "identifier:EAN:6281000000002", classification: "CONFLICT_EXISTING", errorMessage: "identifier belongs to another product", committed: false };
  let commitCount = 0;
  await page.route("**/api/catalog/imports/preview", async (route) => {
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ run: { id: "run-xlsx", sourceSha256: "b".repeat(64), mode: "preview", state: "previewed", acceptedCount: 1, conflictCount: 1, createdAt: "2026-10-04T00:00:00.000Z" }, items: [ready, conflict], idempotentReplay: false }) });
  });
  await page.route("**/api/catalog/imports/run-xlsx", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ run: { id: "run-xlsx", sourceSha256: "b".repeat(64), mode: "commit", state: "committed", acceptedCount: 1, conflictCount: 1, createdAt: "2026-10-04T00:00:00.000Z" }, items: [{ ...ready, classification: "IMPORTED", committed: true }, conflict] }) });
      return;
    }
    commitCount += 1;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ run: { id: "run-xlsx", sourceSha256: "b".repeat(64), mode: "commit", state: "committed", acceptedCount: 1, conflictCount: 1, createdAt: "2026-10-04T00:00:00.000Z" }, items: [{ ...ready, classification: "IMPORTED", committed: true }, conflict], idempotentReplay: false }) });
  });

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["verticalId", "scope", "canonicalName", "variantTitle", "measurementKind", "baseUnit", "categoryIds", "identifierType", "identifierValue"],
    ["grocery", "SHARED", "قهوة", "عبوة", "DISCRETE", "COUNT", "coffee", "EAN", "6281000000001"],
    ["grocery", "SHARED", "شاي", "عبوة", "DISCRETE", "COUNT", "tea", "EAN", "6281000000002"],
  ]), "Products");
  const fileBuffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;

  await page.goto("/catalog/import");
  await page.locator("#catalog-import-file").setInputFiles({ name: "products.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: fileBuffer });
  await expect(page.getByText("الصفوف الصالحة: 2 · الصفوف المرفوضة محليًا: 0")).toBeVisible();
  await page.getByTestId("catalog-import-workspace").getByRole("button", { name: "معاينة الملف" }).click();
  await expect(page.getByText("المقبول: 1 · التعارضات: 1 · العناصر المصنفة: 2")).toBeVisible();
  const commitButton = page.getByRole("button", { name: "الالتزام بالصفوف الجاهزة" });
  await expect(commitButton).toBeEnabled();
  await commitButton.click();
  await expect(page.getByText("حالة التشغيل: تم الالتزام")).toBeVisible();
  await expect(page.getByText("identifier belongs to another product")).toBeVisible();
  expect(commitCount).toBe(1);
});

test("operator sees shared product categories as a hierarchy under their commerce vertical", async ({ page }) => {
  await stubAuthenticatedSession(page);
  const vertical = { id: "grocery", nameAr: "المقاضي", nameEn: "Groceries", catalogModel: "SHARED_CATALOG", active: true, version: 1, createdAt: "2026-09-18T00:00:00.000Z", updatedAt: "2026-09-18T00:00:00.000Z" };
  const root = { id: "grocery-drinks", verticalId: "grocery", parentCategoryId: null, nameAr: "مشروبات", nameEn: "Beverages", pathAr: "المقاضي / مشروبات", pathEn: "Groceries / Beverages", active: true, version: 1, createdAt: vertical.createdAt, updatedAt: vertical.updatedAt };
  const child = { id: "grocery-coffee", verticalId: "grocery", parentCategoryId: root.id, nameAr: "قهوة", nameEn: "Coffee", pathAr: "المقاضي / مشروبات / قهوة", pathEn: "Groceries / Beverages / Coffee", active: true, version: 1, createdAt: vertical.createdAt, updatedAt: vertical.updatedAt };
  await page.route("**/api/catalog/verticals**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ verticals: [vertical] }) });
  });
  await page.route("**/api/catalog/categories**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/attribute-rules")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ rules: [] }) });
      return;
    }
    if (route.request().method() === "GET" && url.pathname.endsWith(`/${root.id}`)) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ category: root }) });
      return;
    }
    if (route.request().method() === "GET" && url.pathname.endsWith(`/${child.id}`)) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ category: child }) });
      return;
    }
    const categories = url.searchParams.get("query")?.toLowerCase().includes("coffee") ? [child] : [root, child];
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ categories, nextCursor: "" }) });
  });
  await page.route("**/api/catalog/attributes**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ definitions: [] }) });
  });

  await page.goto("/catalog/categories?verticalId=grocery");
  const tree = page.getByRole("list", { name: "شجرة فئات المقاضي" });
  const rootItem = tree.getByRole("listitem").first();
  const childList = rootItem.getByRole("list");
  const childItem = childList.getByRole("listitem").first();
  await expect(page.getByLabel("المجال الرئيسي")).toHaveValue("grocery");
  await expect(childItem.getByRole("button", { name: /قهوة Coffee/ })).toBeVisible();
  await expect(rootItem).toContainText("جذر المجال");
  await expect(childItem.locator(".catalog-taxonomy-child-count")).toContainText("ضمن مشروبات");
  await rootItem.getByRole("button", { name: "طي فروع مشروبات" }).click();
  await expect(childList).toHaveCount(0);
  await rootItem.getByRole("button", { name: /مشروبات Beverages/ }).click();
  await expect(page.getByRole("link", { name: "عرض المنتجات في هذه الفئة وفروعها" })).toHaveAttribute("href", /categoryId=grocery-drinks/);

  const filters = page.locator("form.catalog-category-filters");
  await filters.getByLabel("بحث").fill("Coffee");
  await filters.getByRole("button", { name: "بحث", exact: true }).click();
  const detachedTree = page.getByRole("list", { name: "فروع أبوها خارج النتائج الحالية" });
  await expect(detachedTree.getByRole("listitem").first()).toContainText("المقاضي / مشروبات / قهوة");
  await expect(page.getByRole("list", { name: "شجرة فئات المقاضي" })).toHaveCount(0);
});

test("catalog proposal review shows detail and re-reads after approval", async ({ page }) => {
  await stubAuthenticatedSession(page);
  let queueRead = 0;
  const proposal = { id: "proposal-1", partnerActorId: "actor-partner", verticalId: "grocery", categoryId: "coffee", proposedName: "قهوة", proposedBrand: "علامة", proposedVariantTitle: "الافتراضي", proposedMeasurementKind: "DISCRETE", proposedBaseUnit: "COUNT", proposedIdentifierType: null, proposedIdentifierValue: null, state: "submitted", correctionReason: null, reviewedBy: null, version: 3, createdAt: "2026-09-18T00:00:00.000Z", updatedAt: "2026-09-18T00:00:00.000Z" };
  await page.route("**/api/catalog/proposals*", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    queueRead += 1;
     await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ proposals: queueRead < 3 ? [proposal] : [] }) });
  });
  await page.route("**/api/catalog/verticals", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ verticals: [{ id: "grocery", nameAr: "بقالة", nameEn: "Grocery", catalogModel: "SHARED_CATALOG", active: true, version: 1, createdAt: "2026-09-18T00:00:00.000Z", updatedAt: "2026-09-18T00:00:00.000Z" }] }) });
  });
  await page.route("**/api/catalog/categories/coffee", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ category: { id: "coffee", verticalId: "grocery", parentCategoryId: null, nameAr: "قهوة", nameEn: "Coffee", pathAr: "قهوة", pathEn: "Coffee", active: true, version: 1, createdAt: "2026-09-18T00:00:00.000Z", updatedAt: "2026-09-18T00:00:00.000Z" } }) });
  });
  await page.route("**/api/catalog/proposals/proposal-1/review", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ proposal: { ...proposal, state: "approved", version: 4 }, idempotentReplay: false }) });
  });

  await page.goto("/catalog/proposals");
  await expect(page.getByRole("button", { name: /قهوة/ }).first()).toBeVisible();
  await page.getByRole("button", { name: /قهوة/ }).first().click();
  await expect.poll(() => new URL(page.url()).searchParams.get("proposalId")).toBe("proposal-1");
  await expect(page.getByRole("heading", { name: "قهوة", exact: true })).toBeVisible();
  await expect(page.getByText("النسخة الحالية: 3")).toBeVisible();
  await expect(page.getByText("الفئة").locator("..") .getByText("قهوة")).toBeVisible();
  await page.getByRole("button", { name: "اعتماد" }).click();
  await expect(page.getByRole("status")).toContainText("تم تسجيل القرار");
  expect(queueRead).toBeGreaterThan(1);
});
