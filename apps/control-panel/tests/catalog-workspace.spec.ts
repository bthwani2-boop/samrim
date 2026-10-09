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
  for (const [label, href] of [["المنتجات", "/catalog/products"], ["الفئات", "/catalog/categories"], ["المراجعة", "/catalog/proposals"], ["الاستيراد", "/catalog/import"]] as const) {
    await expect(catalogTabs.getByRole("link", { name: label, exact: true })).toHaveAttribute("href", href);
    await expect(sideNavigation.getByRole("link", { name: label, exact: true })).toHaveCount(0);
  }
  await expect(catalogTabs.getByRole("link", { name: "المنتجات", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "اختر مورد الكتالوج" })).toHaveCount(0);
  await expect(page.locator("#catalog-import-rows")).toHaveCount(0);
});

test("store catalog import searches server pages and keeps the selected store visible", async ({ page }) => {
  await stubAuthenticatedSession(page);
  const storeRequests: Array<{ limit: string | null; query: string | null; cursor: string | null }> = [];
  await page.route("**/api/catalog/stores**", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    const query = params.get("q");
    const cursor = params.get("cursor");
    storeRequests.push({ limit: params.get("limit"), query, cursor });
    const stores = query === "متجر 200"
      ? [{ id: "store-200", name: "متجر 200" }]
      : query
        ? []
        : Array.from({ length: 50 }, (_, index) => {
            const first = cursor === "store-cursor-2" ? 51 : 1;
            const number = first + index;
            return { id: `store-${number}`, name: `متجر ${number}` };
          });
    const nextCursor = query ? undefined : cursor === "store-cursor-2" ? "store-cursor-3" : "store-cursor-2";
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ stores, nextCursor, limit: 50 }) });
  });

  await page.goto("/catalog/import");
  await expect(page).toHaveTitle("استيراد الكتالوج | بثواني");
  await expect(page.getByText(/تعرض هذه الصفحة حتى 50 متجرًا/)).toBeVisible();
  expect(storeRequests[0]).toEqual({ limit: "50", query: null, cursor: null });
  const storeSelect = page.getByLabel("المتجر المستهدف");
  await expect(storeSelect).toHaveValue("");
  await page.getByRole("navigation", { name: "صفحات نتائج المتاجر" }).getByRole("button", { name: "التالي" }).click();
  await expect(page).toHaveURL(/storeCursor=store-cursor-2/);
  await expect(storeSelect.locator("option")).toHaveCount(51);
  await expect(storeSelect.locator("option").nth(1)).toHaveText("متجر 51");

  await page.getByLabel("ابحث عن متجر بالاسم").fill("متجر 200");
  await page.getByRole("button", { name: "بحث", exact: true }).click();
  await expect(page).toHaveURL(/storeQ=%D9%85%D8%AA%D8%AC%D8%B1\+200|storeQ=%D9%85%D8%AA%D8%AC%D8%B1%20200/);
  await expect(storeSelect.locator("option")).toHaveCount(2);
  await storeSelect.selectOption("store-200");
  await page.getByLabel("ابحث عن متجر بالاسم").fill("متجر غير موجود");
  await page.getByRole("button", { name: "بحث", exact: true }).click();
  await expect(page.getByText("لا توجد متاجر مطابقة. جرّب اسمًا أقصر أو امسح البحث.")).toBeVisible();
  await expect(storeSelect).toHaveValue("store-200");
  await expect(storeSelect.locator("option").nth(1)).toContainText("متجر 200 · المحدد حاليًا");
  expect(storeRequests.every((request) => request.limit === "50")).toBe(true);
  expect(storeRequests.some((request) => request.query === "متجر 200")).toBe(true);
  expect(storeRequests.some((request) => request.query === "متجر غير موجود")).toBe(true);
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
  await expect(page.getByText("حالة الاستيراد: معاينة جاهزة")).toBeVisible();
  expect(previewBody?.rows).toEqual([expect.objectContaining({ rowNumber: 2, verticalId: "grocery", scope: "SHARED", canonicalName: "قهوة", categoryIds: ["coffee"] })]);
  await page.getByRole("button", { name: "اعتماد الصفوف الجاهزة" }).click();
  await expect(page.getByText("حالة الاستيراد: تم الحفظ")).toBeVisible();
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
  const commitButton = page.getByRole("button", { name: "اعتماد الصفوف الجاهزة" });
  await expect(commitButton).toBeEnabled();
  await commitButton.click();
  await expect(page.getByText("حالة الاستيراد: تم الحفظ")).toBeVisible();
  await expect(page.getByText("identifier belongs to another product")).toBeVisible();
  expect(commitCount).toBe(1);
});

test("operator sees shared product categories as a hierarchy under their commerce vertical", async ({ page }) => {
  await stubAuthenticatedSession(page);
  const vertical = { id: "grocery", nameAr: "المقاضي", nameEn: "Groceries", active: true, version: 1, createdAt: "2026-09-18T00:00:00.000Z", updatedAt: "2026-09-18T00:00:00.000Z" };
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
  await expect(page.getByLabel("النشاط الرئيسي")).toHaveValue("grocery");
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

test("vertical registry does not present a category image as a vertical image", async ({ page }) => {
  await stubAuthenticatedSession(page);
  const vertical = { id: "grocery", nameAr: "المقاضي", nameEn: "Groceries", active: true, version: 1, createdAt: "2026-09-18T00:00:00.000Z", updatedAt: "2026-09-18T00:00:00.000Z" };
  const root = { id: "grocery-drinks", verticalId: "grocery", parentCategoryId: null, nameAr: "مشروبات", nameEn: "Beverages", pathAr: "المقاضي / مشروبات", pathEn: "Groceries / Beverages", active: true, imageUri: "https://media.example/root-category.png", version: 1, createdAt: vertical.createdAt, updatedAt: vertical.updatedAt };
  await page.route("**/api/catalog/verticals**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ verticals: [vertical] }) });
  });
  await page.route("**/api/catalog/categories**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith(`/${root.id}`)) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ category: root }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ categories: [root], nextCursor: "" }) });
  });
  await page.route("**/api/catalog/attributes**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ definitions: [] }) });
  });

  await page.goto("/catalog/categories?verticalId=grocery");
  await page.locator("details.catalog-vertical-settings > summary").click();
  await expect(page.getByRole("heading", { name: "المجالات التجارية" })).toBeVisible();
  await expect(page.getByRole("img", { name: "صورة المجال المقاضي" })).toHaveCount(0);
  await expect(page.getByText("لا توجد صورة جذر")).toHaveCount(0);
});

test("category media upload records rights and displays the canonical replacement", async ({ page }) => {
  await stubAuthenticatedSession(page);
  const vertical = { id: "grocery", nameAr: "المقاضي", nameEn: "Groceries", active: true, version: 1, createdAt: "2026-09-18T00:00:00.000Z", updatedAt: "2026-09-18T00:00:00.000Z" };
  let category = { id: "grocery-drinks", verticalId: vertical.id, parentCategoryId: null, nameAr: "مشروبات", nameEn: "Beverages", pathAr: "المقاضي / مشروبات", pathEn: "Groceries / Beverages", active: true, imageUri: undefined as string | undefined, version: 1, createdAt: vertical.createdAt, updatedAt: vertical.updatedAt };
  let mediaRequest: { url: string; expectedVersion: string | null; idempotencyKey: string | null; contentType: string | null; body: string | null } | undefined;
  await page.route("**/api/catalog/verticals**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ verticals: [vertical] }) });
  });
  await page.route("**/api/catalog/categories**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/attribute-rules")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ rules: [] }) });
      return;
    }
    if (url.pathname.endsWith(`/${category.id}`)) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ category }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ categories: [category], nextCursor: "" }) });
  });
  await page.route("**/api/catalog/attributes**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ definitions: [] }) });
  });
  await page.route("**/api/catalog/categories/grocery-drinks/media", async (route) => {
    const headers = route.request().headers();
    mediaRequest = {
      url: new URL(route.request().url()).pathname,
      expectedVersion: headers["x-expected-version"] ?? null,
      idempotencyKey: headers["idempotency-key"] ?? null,
      contentType: headers["content-type"] ?? null,
      body: route.request().postData(),
    };
    category = { ...category, imageUri: "https://media.example/category-v2.png", version: 2 };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ category, idempotentReplay: false }) });
  });

  await page.goto("/catalog/categories?verticalId=grocery&categoryId=grocery-drinks");
  const uploadButton = page.getByRole("button", { name: "إرفاق الصورة" });
  await expect(uploadButton).toBeDisabled();
  await page.locator("#catalog-category-image").setInputFiles({
    name: "beverages.png",
    mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jKXcAAAAASUVORK5CYII=", "base64"),
  });
  await page.getByLabel("اسم المنشئ أو المصوّر").fill("فريق الكتالوج");
  await page.getByLabel("مصدر الصورة").fill("تصوير داخلي");
  await page.getByLabel("بيان الإذن أو الترخيص").fill("إذن موثق لعرض الصورة");
  await page.getByLabel("سبب الإرفاق").fill("استبدال الصورة المعتمدة");
  await expect(uploadButton).toBeDisabled();
  await page.getByLabel("أقرّ بوجود إذن يسمح بعرض هذه الصورة").check();
  await expect(uploadButton).toBeEnabled();
  await uploadButton.click();

  await expect(page.getByRole("status")).toContainText("تم إرفاق صورة «مشروبات».");
  await expect(page.getByRole("img", { name: "معاينة صورة مشروبات" })).toHaveAttribute("src", "https://media.example/category-v2.png");
  await expect(page.getByRole("button", { name: "استبدال الصورة" })).toBeDisabled();
  expect(mediaRequest).toMatchObject({ url: "/api/catalog/categories/grocery-drinks/media", expectedVersion: "1", contentType: expect.stringContaining("multipart/form-data") });
  expect(mediaRequest?.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/i);
  expect(mediaRequest?.body).toContain("فريق الكتالوج");
  expect(mediaRequest?.body).toContain("تصوير داخلي");
  expect(mediaRequest?.body).toContain("إذن موثق لعرض الصورة");
  expect(mediaRequest?.body).toContain("rightsAttested");
  expect(mediaRequest?.body).toContain("true");
});

test("catalog attribute and enum option status changes use optimistic versions and re-read", async ({ page }) => {
  await stubAuthenticatedSession(page);
  const vertical = { id: "grocery", nameAr: "المقاضي", nameEn: "Groceries", active: true, version: 1, createdAt: "2026-09-18T00:00:00.000Z", updatedAt: "2026-09-18T00:00:00.000Z" };
  const root = { id: "grocery-drinks", verticalId: "grocery", parentCategoryId: null, nameAr: "مشروبات", nameEn: "Beverages", pathAr: "المقاضي / مشروبات", pathEn: "Groceries / Beverages", active: true, version: 1, createdAt: vertical.createdAt, updatedAt: vertical.updatedAt };
  let definition = { id: "attr-color", verticalId: "grocery", code: "color", nameAr: "اللون", valueKind: "ENUM" as const, active: true, filterable: false, version: 1 };
  let option = { attributeId: definition.id, optionValue: "أحمر", active: true, ordinal: 1, version: 1 };
  let rule = { categoryId: root.id, attributeId: definition.id, code: "color", nameAr: definition.nameAr, valueKind: "ENUM" as const, required: false, filterable: false, variantAxis: false, version: 1 };
  const mutationRequests: Array<{ path: string; body: Record<string, unknown> }> = [];
  const ruleRequests: Array<Record<string, unknown>> = [];
  await page.route("**/api/catalog/verticals**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ verticals: [vertical] }) });
  });
  await page.route("**/api/catalog/categories**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/attribute-rules") || url.pathname.includes("/attribute-rules/")) {
      if (route.request().method() === "PUT") {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        ruleRequests.push(body);
        rule = { ...rule, required: Boolean(body.required), filterable: Boolean(body.filterable), variantAxis: Boolean(body.variantAxis), version: Number(body.expectedVersion) + 1 };
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ rules: [rule] }) });
      return;
    }
    if (url.pathname.endsWith(`/${root.id}`)) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ category: root }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ categories: [root], nextCursor: "" }) });
  });
  await page.route("**/api/catalog/attributes**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes("/enum-options/")) {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      mutationRequests.push({ path: url.pathname, body });
      option = { ...option, active: Boolean(body.active), ordinal: Number(body.ordinal), version: Number(body.expectedVersion) + 1 };
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ option, idempotentReplay: false }) });
      return;
    }
    if (url.pathname.endsWith("/enum-options")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ options: [option] }) });
      return;
    }
    if (route.request().method() === "PATCH") {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      mutationRequests.push({ path: url.pathname, body });
      definition = { ...definition, nameAr: String(body.nameAr), active: Boolean(body.active), version: Number(body.expectedVersion) + 1 };
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ definition, idempotentReplay: false }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ definitions: [definition] }) });
  });

  await page.goto("/catalog/categories?verticalId=grocery&categoryId=grocery-drinks");
  await expect(page.getByRole("heading", { name: "مشروبات", exact: true, level: 4 })).toBeVisible();
  await page.locator("details.catalog-category-properties > summary").click();
  await page.getByLabel("سبب التغيير").fill("إيقاف خاصية اللون مؤقتًا");
  await page.getByRole("button", { name: "إيقاف الخاصية اللون" }).click();
  await expect(page.locator(".catalog-attribute-definition-list li").filter({ hasText: "اللون" })).toContainText("متوقفة");
  await page.getByLabel("خاصية التعداد").selectOption(definition.id);
  await expect(page.getByText("أحمر · نشط")).toBeVisible();
  const ordinalInput = page.getByLabel("ترتيب الخيار أحمر");
  const saveOrdinalButton = page.getByRole("button", { name: "حفظ ترتيب الخيار أحمر" });
  for (const invalidOrdinal of ["", "1.5", "-1", "101"]) {
    await ordinalInput.fill(invalidOrdinal);
    await expect(saveOrdinalButton).toBeDisabled();
  }
  await ordinalInput.fill("0");
  await expect(saveOrdinalButton).toBeEnabled();
  await saveOrdinalButton.click();
  await expect(page.getByRole("status")).toContainText("تم تحديث خيار الخاصية: أحمر.");
  await page.getByRole("button", { name: "إيقاف الخيار أحمر" }).click();
  await expect(page.getByText("أحمر · متوقف")).toBeVisible();
  await page.getByLabel("قابل للتصفية").check();
  await page.getByRole("button", { name: "حفظ القاعدة" }).click();
  await expect(page.getByRole("status")).toContainText("تم تحديث قواعد خصائص الفئة");
  expect(mutationRequests).toHaveLength(3);
  expect(mutationRequests[0]?.body).toMatchObject({ active: false, expectedVersion: 1, reason: "إيقاف خاصية اللون مؤقتًا" });
  expect(mutationRequests[1]?.body).toMatchObject({ active: true, ordinal: 0, expectedVersion: 1, reason: "إيقاف خاصية اللون مؤقتًا" });
  expect(mutationRequests[2]?.body).toMatchObject({ active: false, ordinal: 0, expectedVersion: 2, reason: "إيقاف خاصية اللون مؤقتًا" });
  expect(ruleRequests).toHaveLength(1);
  expect(ruleRequests[0]).toMatchObject({ required: false, filterable: true, variantAxis: false, expectedVersion: 1, reason: "إيقاف خاصية اللون مؤقتًا" });
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
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ verticals: [{ id: "grocery", nameAr: "بقالة", nameEn: "Grocery", active: true, version: 1, createdAt: "2026-09-18T00:00:00.000Z", updatedAt: "2026-09-18T00:00:00.000Z" }] }) });
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
  await expect(page.getByRole("article", { name: "قهوة" }).getByText("قيد المراجعة")).toBeVisible();
  await expect(page.getByText("الفئة").locator("..") .getByText("قهوة")).toBeVisible();
  await page.getByRole("button", { name: "اعتماد" }).click();
  await expect(page.getByRole("status")).toContainText("تم تسجيل القرار");
  expect(queueRead).toBeGreaterThan(1);
});
