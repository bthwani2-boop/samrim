import { expect, test } from "@playwright/test";

const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jKXcAAAAASUVORK5CYII=";
const updatedAt = "2026-10-11T12:00:00.000Z";
const coffee = { id: "coffee", verticalId: "grocery", canonicalName: "قهوة عربية", brand: "محمصة صنعاء", categoryIds: [], variantCount: 1, storeCount: 3, active: true, updatedAt, primaryImageUri: image };
const tea = { id: "tea", verticalId: "grocery", canonicalName: "شاي عدني", brand: "", categoryIds: [], variantCount: 1, storeCount: 1, active: true, updatedAt, primaryImageUri: null };

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
  await expect(page.locator(".central-catalog-list .identity-error")).toContainText("خدمة الكتالوج غير متاحة");
  await expect(page.getByText("لا توجد منتجات مطابقة للفلاتر.")).toHaveCount(0);

  unavailable = false;
  await page.getByRole("textbox", { name: "البحث في المنتجات" }).fill("قهوة");
  await page.getByRole("button", { name: "بحث", exact: true }).click();
  const gallery = page.getByRole("list", { name: "المنتجات في الصفحة الحالية" });
  await expect(gallery.getByRole("listitem")).toHaveCount(1);
  await expect(page.locator(".central-catalog-list .identity-error")).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("button", { name: "معرض الصور" })).toHaveAttribute("aria-pressed", "true");
  await expect(gallery.getByRole("listitem")).toHaveCount(1);
});
