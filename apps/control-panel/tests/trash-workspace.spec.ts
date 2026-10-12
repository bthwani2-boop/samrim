import { expect, type Page, test } from "@playwright/test";

const baseSession = {
  subject: "actor-operator",
  sessionId: "session-operator",
  role: "operator",
  surface: "control-panel",
  expiresAt: "2099-01-01T00:00:00.000Z",
};

async function session(page: Page, permissions: string[]) {
  await page.route("**/api/auth/session**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ identity: { ...baseSession, permissions } }),
    });
  });
}

test("operator sees one lazy-loading trash screen and safely restores categories and stores", async ({ page }) => {
  await session(page, ["catalog", "partners"]);
  let productReads = 0;
  let categoryReads = 0;
  let storeReads = 0;
  const mutations: Array<{ path: string; version: string | null; body: Record<string, unknown> }> = [];

  await page.route("**/api/catalog/trash**", async (route) => {
    if (route.request().method() === "GET") {
      productReads++;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ products: [{ id: "product-yemeni-coffee", canonicalName: "قهوة يمنية", version: 2, deletedAt: "2026-10-11T10:00:00Z", deletionReason: "منتج مكرر" }], nextCursor: "" }) });
      return;
    }
    await route.fulfill({ status: 404, body: "unexpected product mutation" });
  });
  await page.route("**/api/catalog/category-trash**", async (route) => {
    if (route.request().method() === "GET") {
      categoryReads++;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ categories: [{ id: "category-coffee", nameAr: "القهوة", verticalId: "grocery", version: 2, deletedAt: "2026-10-11T11:00:00Z", deletionReason: "إعادة تصنيف" }], nextCursor: "" }) });
      return;
    }
    mutations.push({ path: new URL(route.request().url()).pathname, version: route.request().headers()["x-expected-version"] ?? null, body: route.request().postDataJSON() as Record<string, unknown> });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ category: { id: "category-coffee", version: 3 }, idempotentReplay: false }) });
  });
  await page.route("**/api/stores/trash**", async (route) => {
    if (route.request().method() === "GET") {
      storeReads++;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ stores: [{ id: "store-sanaa-1", name: "بقالة صنعاء", partnerActorId: "partner-1", version: 2, deletedAt: "2026-10-11T12:00:00Z", deletionReason: "نقل الموقع" }], nextCursor: "" }) });
      return;
    }
    mutations.push({ path: new URL(route.request().url()).pathname, version: route.request().headers()["x-expected-version"] ?? null, body: route.request().postDataJSON() as Record<string, unknown> });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ store: { id: "store-sanaa-1", version: 3 }, idempotentReplay: false }) });
  });

  await page.goto("/catalog/trash");
  const trashLink = page.getByRole("link", { name: "فتح سلة المحذوفات" });
  await expect(trashLink).toBeVisible();
  await expect(trashLink).toHaveAttribute("href", "/catalog/trash");
  await expect(trashLink).toContainText("المحذوفات");
  await expect(page.getByRole("heading", { name: "سلة المحذوفات", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "المنتجات المحذوفة" })).toBeVisible();
  await expect(page.getByText("قهوة يمنية")).toBeVisible();
  expect(productReads).toBeGreaterThan(0);
  expect(categoryReads).toBe(0);
  expect(storeReads).toBe(0);

  await page.getByRole("button", { name: "الفئات", exact: true }).click();
  await expect(page.getByRole("heading", { name: "الفئات المحذوفة" })).toBeVisible();
  await expect(page.getByRole("rowheader", { name: /القهوة/ })).toBeVisible();
  await page.getByRole("button", { name: "استعادة", exact: true }).click();
  await page.getByRole("button", { name: "تأكيد", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("بحالة غير نشطة");

  await page.getByRole("button", { name: "المتاجر", exact: true }).click();
  await expect(page.getByRole("heading", { name: "المتاجر المحذوفة" })).toBeVisible();
  await expect(page.getByRole("rowheader", { name: /بقالة صنعاء/ })).toBeVisible();
  await page.getByRole("button", { name: "استعادة", exact: true }).click();
  await page.getByRole("button", { name: "تأكيد", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("بحالة مخفي");
  expect(categoryReads).toBeGreaterThan(0);
  expect(storeReads).toBeGreaterThan(0);
  expect(mutations).toEqual([
    { path: "/api/catalog/category-trash/category-coffee", version: "2", body: { action: "restore", reason: "" } },
    { path: "/api/stores/trash/store-sanaa-1", version: "2", body: { action: "restore", reason: "" } },
  ]);
});

test("partners-only operator sees store recovery without access to catalog trash", async ({ page }) => {
  await session(page, ["partners"]);
  let unauthorizedCatalogCalls = 0;
  await page.route("**/api/catalog/trash**", async (route) => { unauthorizedCatalogCalls++; await route.abort(); });
  await page.route("**/api/catalog/category-trash**", async (route) => { unauthorizedCatalogCalls++; await route.abort(); });
  await page.route("**/api/stores/trash**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ stores: [], nextCursor: "" }) });
  });
  await page.goto("/catalog/trash");
  await expect(page.getByRole("heading", { name: "المتاجر المحذوفة" })).toBeVisible();
  await expect(page.getByRole("button", { name: "المنتجات", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "الفئات", exact: true })).toHaveCount(0);
  expect(unauthorizedCatalogCalls).toBe(0);
});
