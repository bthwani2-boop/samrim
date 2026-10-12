import { expect, type Page, test } from "@playwright/test";

const product = {
  id: "recovery-product", verticalId: "grocery", scope: "SHARED", version: 1, canonicalName: "قهوة محفوظة",
  description: "", brand: "", categoryIds: ["coffee-category"], active: true, attributes: [], media: [],
  variantCount: 1, storeCount: 0, updatedAt: "2026-10-12T00:00:00Z",
  variants: [{ id: "coffee-variant", title: "250 غرام", measurementKind: "DISCRETE", baseUnit: "COUNT", identifiers: [], attributes: [] }],
};
const category = { id: "coffee-category", verticalId: "grocery", nameAr: "القهوة", pathAr: "القهوة", active: true, parentCategoryId: null, version: 1 };

async function setup(page: Page) {
  await page.route("**/api/auth/session**", (route) => route.fulfill({ status: 200, json: { identity: {
    subject: "catalog-recovery", sessionId: "catalog-recovery", role: "operator", permissions: ["catalog"], surface: "control-panel", expiresAt: "2099-01-01T00:00:00Z",
  } } }));
  await page.route("**/api/notifications**", (route) => route.fulfill({ status: 200, json: { notifications: [], unreadCount: 0 } }));
  await page.route("**/api/catalog/verticals**", (route) => route.fulfill({ status: 200, json: { verticals: [{ id: "grocery", nameAr: "البقالة", active: true }] } }));
  await page.route("**/api/catalog/categories**", (route) => route.fulfill({ status: 200, json: new URL(route.request().url()).pathname.endsWith("attribute-rules") ? { rules: [] } : new URL(route.request().url()).pathname.endsWith("coffee-category") ? { category } : { categories: [category], nextCursor: "" } }));
  await page.route("**/api/catalog/product-registry**", (route) => route.fulfill({ status: 200, json: { products: [product], nextCursor: "" } }));
}

test("a failed product detail remains an edit read failure and retries without offering creation", async ({ page }) => {
  await setup(page);
  let readable = false;
  await page.route("**/api/catalog/products/recovery-product", (route) => route.fulfill(readable
    ? { status: 200, json: product }
    : { status: 503, json: { error: { message: "تعذرت قراءة المنتج" } } }));
  await page.goto("/catalog/products?mode=edit&productId=recovery-product");
  await expect(page.locator(".central-catalog-editor").getByRole("alert")).toBeVisible();
  await expect(page.getByRole("heading", { name: "إنشاء منتج", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "إنشاء المنتج", exact: true })).toHaveCount(0);
  await expect(page.locator(".central-catalog-editor").getByRole("alert")).toBeVisible();
  readable = true;
  await page.getByRole("button", { name: "إعادة قراءة المنتج", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "الاسم القياسي" })).toHaveValue(product.canonicalName);
});

test("catalog version conflicts preserve the draft until the operator explicitly loads the saved version", async ({ page }) => {
  await setup(page);
  let reads = 0;
  let conflicting = false;
  await page.route("**/api/catalog/products/recovery-product", (route) => {
    if (route.request().method() === "POST") { conflicting = true; return route.fulfill({ status: 409, json: { error: { code: "VERSION_CONFLICT" } } }); }
    reads += 1;
    return route.fulfill({ status: 200, json: !conflicting ? product : { ...product, canonicalName: "قهوة عدلها زميل", version: 2 } });
  });
  await page.goto("/catalog/products?mode=edit&productId=recovery-product");
  const name = page.getByRole("textbox", { name: "الاسم القياسي" });
  await expect(name).toHaveValue(product.canonicalName);
  await name.fill("تعديلاتي المحفوظة في النموذج");
  const initialReads = reads;
  const save = page.getByRole("button", { name: "حفظ التعديل", exact: true });
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.locator(".central-catalog-editor").getByRole("alert")).toContainText("احتفظنا بتعديلاتك");
  await expect(name).toHaveValue("تعديلاتي المحفوظة في النموذج");
  expect(reads).toBe(initialReads);
  await expect(save).toBeDisabled();
  await page.getByRole("button", { name: "تحميل النسخة الحالية وإلغاء تعديلاتي", exact: true }).click();
  await expect(name).toHaveValue("قهوة عدلها زميل");
  expect(reads).toBe(initialReads + 1);
});

test("retrying an unchanged catalog save keeps its idempotency key and confirms canonical readback", async ({ page }) => {
  await setup(page);
  const keys: Array<string | undefined> = [];
  let saved = false;
  await page.route("**/api/catalog/products/recovery-product", (route) => {
    if (route.request().method() === "POST") {
      keys.push(route.request().headers()["idempotency-key"]);
      if (keys.length === 1) return route.fulfill({ status: 503, json: { error: { message: "نتيجة الحفظ غير متاحة" } } });
      saved = true;
      return route.fulfill({ status: 200, json: { product: { ...product, version: 2, canonicalName: "قهوة بعد الحفظ" } } });
    }
    return route.fulfill({ status: 200, json: saved ? { ...product, version: 2, canonicalName: "قهوة بعد الحفظ" } : product });
  });
  await page.goto("/catalog/products?mode=edit&productId=recovery-product");
  const name = page.getByRole("textbox", { name: "الاسم القياسي" });
  await expect(name).toHaveValue(product.canonicalName);
  await name.fill("قهوة بعد الحفظ");
  const save = page.getByRole("button", { name: "حفظ التعديل", exact: true });
  await save.click();
  await expect(page.locator(".central-catalog-editor").getByRole("alert")).toContainText("نتيجة الحفظ غير متاحة");
  await expect(name).toHaveValue("قهوة بعد الحفظ");
  await save.click();
  await expect(page.getByText("تم تحديث المنتج.", { exact: true })).toBeVisible();
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBeTruthy();
  expect(keys[1]).toBe(keys[0]);
  await expect(name).toHaveValue("قهوة بعد الحفظ");
});

test("media retries keep the same intent and preserve unsaved product fields", async ({ page }) => {
  await setup(page);
  await page.route("**/api/catalog/products/recovery-product", (route) => route.fulfill({ status: 200, json: product }));
  const keys: Array<string | undefined> = [];
  await page.route("**/api/catalog/products/recovery-product/media", (route) => {
    keys.push(route.request().headers()["idempotency-key"]);
    return route.fulfill(keys.length === 1
      ? { status: 503, json: { error: { message: "تعذر تأكيد رفع الصورة" } } }
      : { status: 200, json: { product: { ...product, version: 2, media: [{ uri: "/coffee.png", role: "primary", ordinal: 0 }] } } });
  });
  await page.goto("/catalog/products?mode=edit&productId=recovery-product");
  const name = page.getByRole("textbox", { name: "الاسم القياسي" });
  await expect(name).toHaveValue(product.canonicalName);
  await name.fill("مسودة تبقى بعد رفع الصورة");
  await page.getByLabel("ملف الصورة", { exact: true }).setInputFiles({ name: "coffee.png", mimeType: "image/png", buffer: Buffer.from("image fixture") });
  await page.getByLabel("اسم المنشئ أو المصوّر", { exact: true }).fill("مصوّر الاختبار");
  await page.getByLabel("مصدر الصورة", { exact: true }).fill("تصوير معزول للاختبار");
  await page.getByLabel("بيان الإذن أو الترخيص", { exact: true }).fill("إذن عرض داخل اختبار معزول");
  await page.getByRole("checkbox", { name: "أقرّ بوجود إذن يسمح بعرض هذه الصورة" }).check();
  const upload = page.getByRole("button", { name: "رفع الصورة وربطها", exact: true });
  await upload.click();
  await expect(page.locator(".central-catalog-editor").getByRole("alert")).toContainText("تعذر تأكيد رفع الصورة");
  await expect(name).toHaveValue("مسودة تبقى بعد رفع الصورة");
  await upload.click();
  await expect(page.getByText("تم رفع الصورة الأساسية وربطها بالمنتج.", { exact: true })).toBeVisible();
  await expect(name).toHaveValue("مسودة تبقى بعد رفع الصورة");
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBeTruthy();
  expect(keys[1]).toBe(keys[0]);
});

test("a trash conflict preserves the product draft and requires an explicit version refresh", async ({ page }) => {
  await setup(page);
  await page.route("**/api/catalog/products/recovery-product", (route) => route.fulfill({ status: 200, json: product }));
  await page.route("**/api/catalog/trash/recovery-product", (route) => route.fulfill({ status: 409, json: { error: { code: "VERSION_CONFLICT" } } }));
  await page.goto("/catalog/products?mode=edit&productId=recovery-product");
  const name = page.getByRole("textbox", { name: "الاسم القياسي" });
  await expect(name).toHaveValue(product.canonicalName);
  await name.fill("مسودة لا يمحوها تعارض النقل");
  await page.getByRole("button", { name: "نقل إلى سلة المحذوفات", exact: true }).click();
  await page.getByLabel("سبب الحذف", { exact: true }).fill("اختبار تعارض النسخة");
  await page.getByRole("button", { name: "تأكيد النقل إلى السلة", exact: true }).click();
  await expect(page.locator(".central-catalog-editor").getByRole("alert")).toContainText("احتفظنا بتعديلاتك");
  await expect(name).toHaveValue("مسودة لا يمحوها تعارض النقل");
  await expect(page.getByRole("button", { name: "نقل إلى سلة المحذوفات", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "تحميل النسخة الحالية وإلغاء تعديلاتي", exact: true })).toBeVisible();
});
