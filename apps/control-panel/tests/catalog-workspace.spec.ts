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

test("catalog center keeps its product registry and contextual work on one surface", async ({ page }) => {
  await stubAuthenticatedSession(page);
  await page.goto("/catalog");
  await expect(page).toHaveURL(/\/catalog$/);
  await expect(page.getByRole("heading", { name: "الكتالوج", exact: true, level: 1 })).toBeVisible();
  await expect(page.getByTestId("catalog-center")).toBeVisible();
  await expect(page.getByRole("button", { name: "جدول المنتجات", exact: true })).toHaveAttribute("aria-pressed", "true");
  const catalogModes = page.getByRole("group", { name: "إدارة الكتالوج" });
  await expect(catalogModes.getByRole("button", { name: "المنتجات" })).toHaveAttribute("aria-pressed", "true");
  await expect(catalogModes.getByRole("button", { name: "الفئات" })).toBeVisible();
  await expect(catalogModes.getByRole("button", { name: "مقترحات الشركاء" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "تنقل مساحة المشغل" }).getByRole("link", { name: "الكتالوج", exact: true })).toHaveAttribute("aria-current", "page");
  const sideNavigation = page.getByRole("navigation", { name: "تنقل مساحة المشغل" });
  await expect(sideNavigation.getByRole("list", { name: "مسارات الكتالوج" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "استيراد", exact: true })).toHaveAttribute("href", "/catalog/import");
  await expect(page.getByRole("link", { name: "سلة المحذوفات", exact: true })).toHaveAttribute("href", "/catalog/trash");
  await expect(page.getByRole("heading", { name: "اختر مورد الكتالوج" })).toHaveCount(0);
  await expect(page.locator("#catalog-import-rows")).toHaveCount(0);
});


test("catalog rows display real category names without misleading selection controls", async ({ page }) => {
  await stubAuthenticatedSession(page);
  await page.route("**/api/catalog/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = path === "/api/catalog/verticals" ? { verticals: [{ id: "grocery", nameAr: "البقالة", nameEn: "Grocery", active: true, version: 1 }] }
      : path === "/api/catalog/product-registry" ? { products: [{
          id: "rice-1", verticalId: "grocery", canonicalName: "أرز أبيض", brand: "الخير",
          active: true, version: 1, variantCount: 1, storeCount: 2, categoryIds: ["rice-cat"],
          categoryNamesAr: ["الأرز"], primaryImageUri: "",
          createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-07T00:00:00Z",
        }], totalCount: 1, measuredAt: "2026-10-16T00:00:00Z", nextCursor: "" }
      : { categories: [], nextCursor: "" };
    await route.fulfill({ status: 200, json: body });
  });
  await page.goto("/catalog");
  const row = page.getByRole("row", { name: /أرز أبيض/ });
  await expect(row).toContainText("الأرز");
  await expect(row).toContainText("البقالة");
  await expect(row.getByRole("button", { name: "إدارة المنتج" })).toBeVisible();
  await expect(row.getByRole("checkbox")).toHaveCount(0);
  const toolbarHeight = await page.locator(".catalog-compact-toolbar").evaluate((node) => node.getBoundingClientRect().height);
  expect(toolbarHeight).toBeLessThan(90);
  await page.locator(".catalog-compact-toolbar summary").click();
  await expect(page.getByRole("combobox", { name: "الفئة", exact: true })).toBeVisible();
});

test("product files stay beside the catalog on desktop and open as a full-width file on mobile", async ({ page }) => {
  await stubAuthenticatedSession(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  const product = {
    id: "rice-1", verticalId: "grocery", scope: "SHARED", version: 1, canonicalName: "أرز أبيض",
    description: "منتج غذائي للاستخدام اليومي.", brand: "الخير", categoryIds: ["rice-cat"],
    active: true, attributes: [], media: [], variantCount: 1, storeCount: 2, updatedAt: "2026-10-07T00:00:00Z",
    variants: [{ id: "rice-variant", title: "عبوة 1 كجم", measurementKind: "DISCRETE", baseUnit: "COUNT", identifiers: [], attributes: [] }],
  };
  const category = { id: "rice-cat", verticalId: "grocery", nameAr: "الأرز", pathAr: "الأرز والحبوب / الأرز", active: true, parentCategoryId: null, version: 1 };
  await page.route("**/api/catalog/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = path === "/api/catalog/verticals" ? { verticals: [{ id: "grocery", nameAr: "البقالة", nameEn: "Grocery", active: true, version: 1 }] }
      : path === "/api/catalog/product-registry" ? { products: [{ ...product, categoryNamesAr: ["الأرز"], primaryImageUri: "" }], totalCount: 1, measuredAt: "2026-10-16T00:00:00Z", nextCursor: "" }
      : path === "/api/catalog/products/rice-1" ? product
      : path.endsWith("/attribute-rules") ? { rules: [] }
      : path.endsWith("/rice-cat") ? { category }
      : { categories: [category], nextCursor: "" };
    await route.fulfill({ status: 200, json: body });
  });

  await page.goto("/catalog?q=أرز");
  const trigger = page.getByRole("row", { name: /أرز أبيض/ }).getByRole("button", { name: "إدارة المنتج" });
  await trigger.click();
  const workspace = page.locator(".adaptive-record-workspace");
  await expect(page).toHaveURL(/mode=edit/);
  await expect(workspace).toHaveAttribute("data-open", "true");
  await expect(workspace).toHaveAttribute("data-split", "true");
  const file = page.locator(".adaptive-record-detail");
  await expect(file.locator(".workspace-side-drawer-heading")).toContainText("ملف المنتج");
  await expect(file.locator(".workspace-side-drawer-heading")).toContainText("أرز أبيض");
  await expect(file.locator(".workspace-side-drawer-actions").getByRole("button", { name: "حفظ التعديل", exact: true })).toBeVisible();
  const widths = await page.evaluate(() => ({
    list: document.querySelector(".adaptive-record-registry")?.getBoundingClientRect().width ?? 0,
    table: document.querySelector(".catalog-registry-table")?.getBoundingClientRect().width ?? 0,
  }));
  expect(widths.list).toBeGreaterThanOrEqual(510);
  expect(widths.table).toBeLessThanOrEqual(widths.list + 1);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(workspace).toHaveAttribute("data-split", "false");
  await expect(file).toHaveCSS("position", "fixed");
  await page.getByRole("button", { name: "إغلاق التفاصيل", exact: true }).click();
  await expect(workspace).toHaveAttribute("data-open", "false");
  expect(new URL(page.url()).searchParams.get("q")).toBe("أرز");
  await expect(trigger).toBeFocused();
});

test("catalog modes preserve product filters and use one workbench", async ({ page }) => {
  await stubAuthenticatedSession(page);
  await page.route("**/api/catalog/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = path.endsWith("/verticals") ? { verticals: [] }
      : path.endsWith("/product-registry") ? { products: [], totalCount: 0, measuredAt: new Date().toISOString(), nextCursor: "" }
      : path.endsWith("/categories") ? { categories: [], nextCursor: "" }
      : path.endsWith("/proposals") ? { proposals: [], nextCursor: "" }
      : { products: [], nextCursor: "" };
    await route.fulfill({ status: 200, json: body });
  });
  await page.goto("/catalog");
  const modes = page.getByRole("group", { name: "إدارة الكتالوج" });
  const search = page.getByRole("textbox", { name: "البحث في المنتجات" });
  await search.fill("أرز");
  await modes.getByRole("button", { name: "الفئات" }).click();
  await expect(page.getByRole("region", { name: "التصنيفات الموحدة" })).toBeVisible();
  await modes.getByRole("button", { name: "مقترحات الشركاء" }).click();
  await expect(page).toHaveURL(/catalogView=proposals/);
  await expect(page.getByRole("heading", { name: "المقترحات المقدمة" })).toBeVisible();
  await modes.getByRole("button", { name: "المنتجات" }).click();
  await expect(search).toHaveValue("أرز");
  await expect(page).toHaveURL(/\/catalog$/);
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

test("taxonomy shows all four record types together and edits in one contextual drawer", async ({ page }) => {
  await stubAuthenticatedSession(page);
  const vertical = { id: "grocery", nameAr: "مقاضي", nameEn: "Grocery", active: true, version: 1 };
  const root = { id: "drinks", verticalId: vertical.id, parentCategoryId: null, nameAr: "مشروبات", nameEn: "Drinks", pathAr: "مقاضي / مشروبات", active: true, version: 1 };
  let child = { id: "coffee", verticalId: vertical.id, parentCategoryId: "drinks", nameAr: "قهوة", nameEn: "Coffee", pathAr: "مقاضي / مشروبات / قهوة", active: true, version: 1 };
  await page.route("**/api/catalog/verticals**", (route) => route.fulfill({ status: 200, json: { verticals: [vertical] } }));
  await page.route("**/api/catalog/commercial-store-types**", (route) => route.fulfill({ status: 200, json: { storeTypes: [{ id: "market", verticalId: vertical.id, nameAr: "سوبر ماركت", nameEn: "Market", active: true, version: 1 }] } }));
  await page.route("**/api/catalog/shopping-shortcuts**", (route) => route.fulfill({ status: 200, json: { shortcuts: [{ id: "deals", verticalId: vertical.id, titleAr: "العروض اليومية", active: true, ordinal: 0, version: 1, storeTypeIds: ["market"], categoryIds: [] }] } }));
  await page.route("**/api/catalog/categories**", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === "PATCH" && url.pathname.endsWith("/coffee")) {
      const changes = route.request().postDataJSON() as { nameAr: string; nameEn: string };
      child = { ...child, nameAr: changes.nameAr, nameEn: changes.nameEn, version: 2 };
      await route.fulfill({ status: 200, json: { category: child } });
      return;
    }
    if (url.pathname.endsWith("/drinks")) { await route.fulfill({ status: 200, json: { category: root } }); return; }
    if (url.pathname.endsWith("/coffee")) { await route.fulfill({ status: 200, json: { category: child } }); return; }
    const text = url.searchParams.get("query") ?? "";
    await route.fulfill({ status: 200, json: { categories: text ? [child].filter((item) => item.nameEn.toLowerCase().includes(text.toLowerCase())) : [root, child], nextCursor: "" } });
  });
  await page.goto("/catalog/categories?verticalId=grocery");
  const surface = page.getByRole("region", { name: "التصنيفات الموحدة" });
  await expect(surface).toBeVisible();
  await expect(page.getByRole("navigation", { name: "مساحات إدارة الكتالوج" })).toHaveCount(0);
  const table = surface.locator(".unified-taxonomy-table");
  await expect(table.getByRole("row")).toHaveCount(6);
  for (const label of ["مجال", "نوع متجر", "فئة منتجات", "اختصار تسوق"]) {
    await expect(table.locator(".unified-taxonomy-kind").filter({ hasText: label }).first()).toBeVisible();
  }
  await surface.getByRole("button", { name: "تعديل فئة منتجات قهوة" }).click();
  const drawer = page.getByRole("dialog", { name: "تعديل فئة منتجات" });
  await expect(drawer).toBeVisible();
  await drawer.getByLabel("الاسم بالعربية").fill("قهوة محمصة");
  await drawer.getByLabel("سبب تعديل الفئة").fill("توحيد اسم الفئة التجارية");
  await drawer.getByRole("button", { name: "حفظ التعديل" }).click();
  await expect(drawer).toHaveCount(0);
  await expect(table.getByRole("row", { name: /قهوة محمصة/ })).toBeVisible();
  await surface.getByLabel("بحث شامل").fill("Coffee");
  await expect(table.getByRole("row", { name: /قهوة محمصة/ })).toBeVisible();
  await surface.getByLabel("بحث شامل").fill("");
  await surface.getByRole("button", { name: /إضافة عنصر/ }).click();
  await surface.getByRole("button", { name: "إضافة نوع متجر" }).click();
  await expect(page.getByRole("dialog", { name: "إضافة نوع متجر" })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "إلغاء" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await surface.getByRole("button", { name: "تعديل مجال مقاضي" }).click();
  const verticalDrawer = page.getByRole("dialog", { name: "تعديل مجال" });
  await verticalDrawer.getByRole("button", { name: /صورة المجال/ }).click();
  await expect(verticalDrawer.getByLabel("الاسم بالعربية")).toHaveCount(0);
  await expect(verticalDrawer.getByLabel("اختيار صورة")).toBeAttached();
  await expect(verticalDrawer.getByLabel("المنشئ أو المصوّر")).toHaveCount(0);
  const footer = verticalDrawer.locator(".unified-taxonomy-save-actions");
  const placement = await footer.evaluate((element) => ({
    left: element.getBoundingClientRect().left,
    bottom: element.getBoundingClientRect().bottom,
    viewportHeight: window.innerHeight,
  }));
  expect(placement.left).toBeLessThan(2);
  expect(Math.abs(placement.bottom - placement.viewportHeight)).toBeLessThan(2);
  await verticalDrawer.getByRole("button", { name: "إغلاق لوحة التحرير" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("vertical image change remains compact and uploads audited media", async ({ page }) => {
  await stubAuthenticatedSession(page);
  let vertical = { id: "grocery", nameAr: "مقاضي", nameEn: "Grocery", active: true, version: 1, imageUri: "" };
  let upload: { headers: Record<string, string>; body: string | null } | undefined;
  await page.route("**/api/catalog/verticals**", async (route) => {
    if (route.request().method() === "POST" && route.request().url().includes("/media")) {
      upload = { headers: route.request().headers(), body: route.request().postData() };
      vertical = { ...vertical, version: 2, imageUri: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/fV0AAAAASUVORK5CYII=" };
      await route.fulfill({ status: 200, json: { vertical } });
      return;
    }
    await route.fulfill({ status: 200, json: { verticals: [vertical] } });
  });
  await page.route("**/api/catalog/commercial-store-types**", (route) => route.fulfill({ status: 200, json: { storeTypes: [] } }));
  await page.route("**/api/catalog/shopping-shortcuts**", (route) => route.fulfill({ status: 200, json: { shortcuts: [] } }));
  await page.route("**/api/catalog/categories**", (route) => route.fulfill({ status: 200, json: { categories: [], nextCursor: "" } }));
  await page.goto("/catalog/categories?verticalId=grocery");
  await page.getByRole("button", { name: "تعديل مجال مقاضي" }).click();
  const dialog = page.getByRole("dialog", { name: "تعديل مجال" });
  await dialog.getByRole("button", { name: /صورة المجال/ }).click();
  await expect(dialog.getByLabel("الاسم بالعربية")).toHaveCount(0);
  await expect(dialog.getByLabel("المنشئ أو المصوّر")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "حفظ الصورة" })).toBeDisabled();
  const chooserPromise = page.waitForEvent("filechooser");
  await dialog.getByText("اختيار صورة", { exact: true }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: "new-image.png", mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/fV0AAAAASUVORK5CYII=", "base64"),
  });
  await expect(dialog.getByRole("img", { name: "معاينة الصورة المختارة" })).toBeVisible();
  await expect(dialog.getByText("new-image.png")).toBeVisible();
  await expect(dialog.getByLabel("المنشئ أو المصوّر")).toBeVisible();
  await expect(dialog.getByLabel("رابط المصدر")).toBeHidden();
  await dialog.getByLabel("المنشئ أو المصوّر").fill("مصور المتجر");
  await dialog.getByLabel("مصدر الصورة", { exact: true }).fill("صورة أصلية للمجال");
  await dialog.getByLabel("الإذن أو الترخيص").fill("أملك حق استخدام الصورة في الكتالوج");
  await dialog.getByLabel("أقرّ بوجود إذن يسمح بعرض هذه الصورة").check();
  await expect(dialog.getByRole("button", { name: "حفظ الصورة" })).toBeEnabled();
  await page.screenshot({ path: "test-results/catalog-image-compact-dark.png", fullPage: true });
  const scroll = await dialog.locator(".unified-taxonomy-drawer-body").evaluate((element) => ({ content: element.scrollHeight, viewport: element.clientHeight }));
  expect(scroll.content - scroll.viewport).toBeLessThan(180);
  await dialog.getByRole("button", { name: "حفظ الصورة" }).click();
  await expect(dialog.getByRole("button", { name: /صورة المجال/ })).toBeVisible();
  await expect(dialog.getByRole("img", { name: "معاينة الصورة المختارة" })).toHaveCount(0);
  expect(upload?.headers["x-expected-version"]).toBe("1");
  expect(upload?.headers["idempotency-key"]).toBeTruthy();
  expect(upload?.body).toContain("new-image.png");
  expect(upload?.body).toContain("مصور المتجر");
  expect(upload?.body).toContain("أملك حق استخدام الصورة");
  expect(upload?.body).toContain("true");
  await expect(page.getByRole("button", { name: "تعديل مجال مقاضي" })).toBeVisible();
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
  await page.getByRole("button", { name: "تعديل مجال المقاضي" }).click();
  await expect(page.getByRole("dialog", { name: "تعديل مجال" })).toBeVisible();
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
  await page.getByRole("button", { name: "تعديل فئة منتجات مشروبات" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "الصورة والخصائص" }).click();
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
  await page.getByRole("button", { name: "تعديل فئة منتجات مشروبات" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "الصورة والخصائص" }).click();
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

test("store import retries only failed rows with the original commit identity", async ({ page }) => {
  await stubAuthenticatedSession(page);
  await page.route("**/api/catalog/stores**", (route) => route.fulfill({
    status: 200, json: { stores: [{ id: "store-retry", name: "متجر الاسترداد" }], nextCursor: "" },
  }));
  const run = { id: "store-import-retry", sourceSha256: "a".repeat(64), acceptedCount: 2, conflictCount: 0, createdAt: "2026-10-13T00:00:00Z", purpose: "STORE_OFFERS", actorRole: "OPERATOR", storeId: "store-retry" };
  const ready = [
    { rowNumber: 2, stableKey: "store-offer-row-2", classification: "READY", committed: false },
    { rowNumber: 3, stableKey: "store-offer-row-3", classification: "READY", committed: false },
  ];
  let current = { run: { ...run, mode: "preview", state: "previewed" }, items: ready };
  let previews = 0;
  const commitKeys: string[] = [];
  await page.route("**/api/catalog/store-imports/preview", (route) => {
    previews += 1;
    return route.fulfill({ status: 201, json: current });
  });
  await page.route("**/api/catalog/store-imports/store-import-retry", (route) => {
    if (route.request().method() === "POST") {
      commitKeys.push(route.request().headers()["idempotency-key"] ?? "");
      current = commitKeys.length === 1
        ? { run: { ...run, mode: "commit", state: "rejected" }, items: [{ ...ready[0]!, classification: "IMPORTED", committed: true }, { ...ready[1]!, classification: "FAILED" }] }
        : { run: { ...run, mode: "commit", state: "committed" }, items: [{ ...ready[0]!, classification: "IMPORTED", committed: true }, { ...ready[1]!, classification: "REPLAYED", committed: true }] };
    }
    return route.fulfill({ status: 200, json: current });
  });
  await page.goto("/catalog/import");
  const workspace = page.getByTestId("store-catalog-import-workspace");
  await workspace.getByLabel("المتجر المستهدف").selectOption("store-retry");
  await workspace.getByLabel("ملف الباركود والأسعار").setInputFiles({
    name: "retry.csv", mimeType: "text/csv", buffer: Buffer.from("barcode,price\n6291000000012,100\n6291000000013,200\n"),
  });
  await workspace.getByRole("button", { name: "معاينة الملف" }).click();
  await expect(workspace.getByRole("button", { name: "اعتماد الصفوف الصالحة" })).toBeEnabled();
  await workspace.getByRole("button", { name: "اعتماد الصفوف الصالحة" }).click();
  const retry = workspace.getByRole("button", { name: "إعادة اعتماد الصفوف الفاشلة" });
  await expect(retry).toBeVisible();
  await expect(workspace.getByText(/اكتملت الصفوف الناجحة/)).toBeVisible();
  await retry.click();
  await expect(workspace.getByText(/الحالة: تم الاعتماد/)).toBeVisible();
  await expect(retry).toHaveCount(0);
  expect(previews).toBe(1);
  expect(commitKeys).toHaveLength(2);
  expect(commitKeys[0]).toBeTruthy();
  expect(commitKeys[1]).toBe(commitKeys[0]);
});

test("operator manages an optional customer shortcut without changing internal Store Type", async ({ page }) => {
  await stubAuthenticatedSession(page);
  const vertical = { id: "grocery", nameAr: "المقاضي", nameEn: "Grocery", active: true, version: 1 };
  const storeType = { id: "butcher", verticalId: "grocery", nameAr: "ملحمة", nameEn: "Butcher", active: true, version: 1 };
  const category = { id: "meat", verticalId: "grocery", nameAr: "لحوم", nameEn: "Meat", parentCategoryId: null, active: true, version: 1, pathAr: "لحوم" };
  let saved: Record<string, unknown> | null = null;
  await page.route("**/api/catalog/verticals**", (route) => route.fulfill({ status: 200, json: { verticals: [vertical] } }));
  await page.route("**/api/catalog/categories**", (route) => route.fulfill({ status: 200, json: { categories: [category], nextCursor: "" } }));
  await page.route("**/api/catalog/commercial-store-types**", (route) => route.fulfill({ status: 200, json: { storeTypes: [storeType] } }));
  await page.route("**/api/catalog/shopping-shortcuts**", async (route) => {
    if (route.request().method() === "POST") {
      saved = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({ status: 201, json: {
        shortcut: { id: "meat-shortcut", ...saved, version: 1, createdAt: "2026-10-17T00:00:00Z", updatedAt: "2026-10-17T00:00:00Z" },
        idempotentReplay: false,
      } });
      return;
    }
    await route.fulfill({ status: 200, json: { shortcuts: saved ? [{ id: "meat-shortcut", ...saved, version: 1, createdAt: "2026-10-17T00:00:00Z", updatedAt: "2026-10-17T00:00:00Z" }] : [] } });
  });
  await page.route("**/api/catalog/attributes**", (route) => route.fulfill({ status: 200, json: { definitions: [] } }));
  await page.goto("/catalog/categories?verticalId=grocery");
  await page.getByText("اختصارات التسوق", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "اختصارات التسوق للعملاء" })).toBeVisible();
  await page.getByRole("button", { name: "إضافة اختصار" }).click();
  const editor = page.getByLabel("محرر اختصار التسوق");
  await editor.getByRole("textbox", { name: "اسم الاختصار الظاهر للعميل" }).fill("لحوم ودجاج");
  await editor.getByRole("checkbox", { name: "ملحمة" }).check();
  await editor.locator("details").nth(1).locator("summary").click();
  await editor.getByRole("checkbox", { name: "لحوم" }).check();
  await editor.getByRole("textbox", { name: "سبب الإضافة أو التعديل" }).fill("تبسيط تصفح المقاضي");
  await editor.getByRole("button", { name: "حفظ الاختصار" }).click();
  await expect(page.getByText("تم حفظ الاختصار «لحوم ودجاج».")).toBeVisible();
  expect(saved).toMatchObject({ verticalId: "grocery", titleAr: "لحوم ودجاج", expectedVersion: 0,
    storeTypeIds: ["butcher"], categoryIds: ["meat"], active: true });
  await expect(page.getByRole("row", { name: /لحوم ودجاج/ })).toContainText("1 نوع متجر، 1 فئة");
});
