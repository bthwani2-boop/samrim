import { expect, test } from "@playwright/test";

const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jKXcAAAAASUVORK5CYII=";
const updatedAt = "2026-10-11T12:00:00.000Z";
const coffee = { id: "coffee", verticalId: "grocery", canonicalName: "قهوة عربية", brand: "محمصة صنعاء", categoryIds: [], variantCount: 1, storeCount: 3, active: true, updatedAt, primaryImageUri: image };
const tea = { id: "tea", verticalId: "grocery", canonicalName: "شاي عدني", brand: "", categoryIds: [], variantCount: 1, storeCount: 1, active: true, updatedAt, primaryImageUri: null };

test("catalog rejects malformed product rows without crashing and retries the registry independently", async ({ page }) => {
  await page.route("**/api/auth/session**", (route) => route.fulfill({ status: 200, json: { identity: {
    subject: "catalog-row-proof", sessionId: "catalog-row-proof", role: "operator", permissions: ["catalog"], surface: "control-panel", expiresAt: "2099-01-01T00:00:00Z",
  } } }));
  await page.route("**/api/catalog/verticals**", (route) => route.fulfill({ status: 200, json: { verticals: [] } }));
  const malformed: unknown[][] = [
    [null],
    [{ ...coffee, canonicalName: null }],
    [{ ...coffee, categoryIds: null }],
    [{ ...coffee, categoryNamesAr: "not-an-array" }],
    [{ ...coffee, updatedAt: "not-a-date" }],
  ];
  let reads = 0;
  await page.route("**/api/catalog/product-registry**", (route) => {
    const products = reads < malformed.length ? malformed[reads] : [coffee];
    reads += 1;
    return route.fulfill({ status: 200, json: { products, nextCursor: "" } });
  });
  await page.goto("/catalog/products");
  for (let index = 0; index < malformed.length; index += 1) {
    const error = page.locator(".central-catalog-list").getByRole("alert");
    await expect(error).toContainText("استجابة سجل المنتجات غير صالحة");
    await expect(page.getByRole("button", { name: "إدارة المنتج" })).toHaveCount(0);
    await error.getByRole("button", { name: "إعادة قراءة سجل المنتجات" }).click();
  }
  await expect(page.getByRole("button", { name: "إدارة المنتج" })).toBeVisible();
  await expect(page.locator(".central-catalog-list").getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: "معرض الصور", exact: true }).click();
  await expect(page.getByRole("button", { name: "تفاصيل وصور قهوة عربية" })).toBeVisible();
  expect(reads).toBe(malformed.length + 1);
});

test("catalog summary uses the complete owner count, while a missing summary stays unknown", async ({ page }) => {
  await page.route("**/api/auth/session**", (route) => route.fulfill({ status: 200, json: { identity: {
    subject: "catalog-summary", sessionId: "catalog-summary", role: "operator", permissions: ["catalog"], surface: "control-panel", expiresAt: "2099-01-01T00:00:00Z",
  } } }));
  await page.route("**/api/catalog/verticals**", (route) => route.fulfill({ status: 200, json: { verticals: [] } }));
  await page.route("**/api/catalog/product-registry**", (route) => {
    const query = new URL(route.request().url()).searchParams.get("q");
    return route.fulfill({ status: 200, json: query === "unknown" ? { products: [coffee], nextCursor: "" }
      : query === "empty" ? { products: [], totalCount: 0, measuredAt: updatedAt }
      : { products: [coffee], nextCursor: "more", totalCount: 321, measuredAt: updatedAt } });
  });
  await page.goto("/catalog/products");
  await expect(page.getByText("إجمالي المنتجات المطابقة للفلاتر: ٣٢١", { exact: true })).toBeVisible();
  await expect(page.getByText("سجلات هذه الصفحة: ١", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "معرض الصور", exact: true }).click();
  await expect(page.getByText("إجمالي المنتجات المطابقة للفلاتر: ٣٢١", { exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "البحث في المنتجات" }).fill("unknown");
  await page.getByRole("button", { name: "بحث", exact: true }).click();
  await expect(page.getByText("إجمالي المنتجات المطابقة للفلاتر: غير متاح", { exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "البحث في المنتجات" }).fill("empty");
  await page.getByRole("button", { name: "بحث", exact: true }).click();
  await expect(page.getByText("إجمالي المنتجات المطابقة للفلاتر: ٠", { exact: true })).toBeVisible();
});

test("product image review navigates canonical images in an isolated keyboard dialog and recovers a failed image", async ({ page }) => {
  await page.route("**/api/auth/session**", (route) => route.fulfill({ status: 200, json: { identity: {
    subject: "catalog-image-review", sessionId: "catalog-image-review", role: "operator", permissions: ["catalog"], surface: "control-panel", expiresAt: "2099-01-01T00:00:00Z",
  } } }));
  await page.route("**/api/catalog/verticals**", (route) => route.fulfill({ status: 200, json: { verticals: [] } }));
  await page.route("**/api/catalog/product-registry**", (route) => route.fulfill({ status: 200, json: { products: [coffee], nextCursor: "" } }));
  await page.route("**/api/catalog/products/coffee", (route) => route.fulfill({ status: 200, json: {
    ...coffee, scope: "SHARED", version: 1, description: "", attributes: [], variants: [],
    media: [{ role: "primary", ordinal: 0, uri: image }, { role: "gallery", ordinal: 1, uri: "/catalog-review-image.png" }],
  } }));
  let imageAvailable = false;
  await page.route("**/catalog-review-image.png", (route) => imageAvailable
    ? route.fulfill({ status: 200, contentType: "image/png", body: Buffer.from(image.split(",")[1]!, "base64") })
    : route.fulfill({ status: 503 }));
  await page.goto("/catalog/products?view=gallery");
  await page.getByRole("button", { name: "تفاصيل وصور قهوة عربية" }).click();
  const trigger = page.getByRole("button", { name: "تكبير الصورة الأساسية لمنتج قهوة عربية" });
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
  const next = dialog.getByRole("button", { name: "الصورة التالية", exact: true });
  await next.click();
  await expect(dialog.getByRole("alert")).toContainText("تعذر عرض الصورة");
  imageAvailable = true;
  await dialog.getByRole("button", { name: "إعادة تحميل الصورة", exact: true }).click();
  await expect(dialog.getByRole("img")).toBeVisible();
  await expect(dialog.getByRole("img")).toHaveJSProperty("naturalWidth", 1);
  await expect(next).toBeDisabled();
  await dialog.getByRole("button", { name: "الصورة السابقة", exact: true }).click();
  await expect(dialog.getByRole("img")).toHaveAttribute("src", image);
  await expect(dialog.getByRole("button", { name: "الصورة السابقة", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "منتج جديد", exact: true }).click({ timeout: 500 })).rejects.toThrow();
  await dialog.getByRole("button", { name: "إغلاق الصورة", exact: true }).focus();
  await page.keyboard.press("Shift+Tab");
  await expect(next).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "إغلاق الصورة", exact: true })).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  const bounds = await dialog.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(page.getByRole("textbox", { name: "الاسم القياسي" })).toHaveValue("قهوة عربية");
  await page.getByRole("textbox", { name: "الاسم القياسي" }).fill("قهوة في المسودة");
  await page.getByRole("button", { name: "جدول المنتجات", exact: true }).click();
  await page.goBack();
  await expect(page.getByRole("textbox", { name: "الاسم القياسي" })).toHaveValue("قهوة في المسودة");
});

test("catalog keeps the table default and uses the same bounded registry for an optional gallery", async ({ page }) => {
  const requests: Array<{ cursor: string | null; limit: string | null; query: string | null }> = [];
  await page.route("**/api/auth/session**", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ identity: { subject: "operator", sessionId: "session", role: "operator", permissions: ["catalog"], surface: "control-panel", expiresAt: "2099-01-01T00:00:00.000Z" } }),
  }));
  await page.route("**/api/catalog/verticals**", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ verticals: [{ id: "grocery", nameAr: "المقاضي", active: true }] }),
  }));
  await page.route("**/api/catalog/product-registry**", (route) => {
    const params = new URL(route.request().url()).searchParams;
    const cursor = params.get("cursor");
    const query = params.get("q");
    requests.push({ cursor, query, limit: params.get("limit") });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      products: query ? [] : cursor ? [tea] : [coffee],
      nextCursor: !query && !cursor ? "next-page" : "",
    }) });
  });
  await page.route("**/api/catalog/products/coffee", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ ...coffee, scope: "SHARED", version: 1, description: "", media: [{ role: "primary", ordinal: 0, uri: image }], attributes: [], variants: [{ id: "coffee-default", title: "الافتراضي", measurementKind: "DISCRETE", baseUnit: "COUNT", identifiers: [], attributes: [] }] }),
  }));

  await page.goto("/catalog/products");
  await expect(page.getByRole("table")).toBeVisible();
  await expect(page.getByRole("button", { name: "جدول المنتجات" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "معرض الصور" }).click();
  await expect(page).toHaveURL(/view=gallery/);
  await expect(page.getByRole("table")).toHaveCount(0);
  const gallery = page.getByRole("list", { name: "المنتجات في الصفحة الحالية" });
  await expect(gallery.getByRole("listitem")).toHaveCount(1);
  await expect(gallery.getByRole("img", { name: "الصورة الأساسية لمنتج قهوة عربية" })).toBeVisible();

  await gallery.getByRole("button", { name: "تفاصيل وصور قهوة عربية" }).click();
  const zoom = page.getByRole("button", { name: "تكبير الصورة الأساسية لمنتج قهوة عربية" });
  await expect(zoom).toBeVisible();
  await zoom.click();
  const dialog = page.getByRole("dialog", { name: "الصورة الأساسية لمنتج قهوة عربية" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("img", { name: "الصورة الأساسية لمنتج قهوة عربية" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(zoom).toBeFocused();

  await page.goBack();
  await expect(gallery).toBeVisible();
  await page.getByRole("navigation", { name: "صفحات المنتجات" }).getByRole("button", { name: "التالي" }).click();
  await expect(page).toHaveURL(/view=gallery/);
  await expect(gallery.getByRole("listitem")).toHaveCount(1);
  await expect(gallery.getByRole("img", { name: "لا توجد صورة متاحة لمنتج شاي عدني" })).toBeVisible();
  expect(requests.some((request) => request.cursor === "next-page")).toBe(true);
  expect(requests.every((request) => request.limit === "50")).toBe(true);

  await page.getByRole("button", { name: "جدول المنتجات" }).click();
  await expect(page.getByRole("table")).toBeVisible();
  await expect(page).not.toHaveURL(/view=gallery/);
  await page.goBack();
  await expect(gallery).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(gallery.getByRole("listitem")).toBeVisible();
  const bounds = await gallery.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(392);
});

test("gallery preserves server errors rather than presenting them as empty results and recovers through search", async ({ page }) => {
  let unavailable = true;
  await page.route("**/api/auth/session**", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ identity: { subject: "operator", sessionId: "session", role: "operator", permissions: ["catalog"], surface: "control-panel", expiresAt: "2099-01-01T00:00:00.000Z" } }),
  }));
  await page.route("**/api/catalog/verticals**", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ verticals: [] }),
  }));
  await page.route("**/api/catalog/product-registry**", (route) => route.fulfill(unavailable
    ? { status: 503, contentType: "application/json", body: JSON.stringify({ error: { message: "خدمة الكتالوج غير متاحة" } }) }
    : { status: 200, contentType: "application/json", body: JSON.stringify({ products: [coffee], nextCursor: "" }) }));
  await page.goto("/catalog/products?view=gallery");
  await expect(page.getByRole("button", { name: "معرض الصور" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".central-catalog-list").getByRole("alert")).toContainText("خدمة الكتالوج غير متاحة");
  await expect(page.getByText("لا توجد منتجات مطابقة للفلاتر.")).toHaveCount(0);

  unavailable = false;
  await page.getByRole("textbox", { name: "البحث في المنتجات" }).fill("قهوة");
  await page.getByRole("button", { name: "بحث", exact: true }).click();
  const gallery = page.getByRole("list", { name: "المنتجات في الصفحة الحالية" });
  await expect(gallery.getByRole("listitem")).toHaveCount(1);
  await expect(page.locator(".central-catalog-list").getByRole("alert")).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("button", { name: "معرض الصور" })).toHaveAttribute("aria-pressed", "true");
  await expect(gallery.getByRole("listitem")).toHaveCount(1);
});
