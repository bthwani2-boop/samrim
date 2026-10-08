import { expect, type Page, test } from "./coverage-fixtures";

const store = {
  id: "store_opaque_internal", partnerActorId: "act_opaque_internal", name: "سوبر ماركت الخير",
  partnerName: "عبدالله محمد أحمد الخير", serviceCityId: "city_opaque_internal", serviceCityName: "صنعاء",
  primaryVerticalId: "vertical_opaque_internal", primaryVerticalName: "البقالة", commercialStoreTypeId: "type_opaque_internal",
  version: 71, publicationState: "published", fulfillmentModes: ["BTHWANI_CAPTAIN"], publicationReadiness: { ready: true },
  createdAt: "2026-10-07T10:00:00.000Z", updatedAt: "2026-10-07T11:00:00.000Z",
};

async function session(page: Page) {
  await page.route("**/api/auth/session**", (route) => route.fulfill({ json: { identity: {
    subject: "operator", sessionId: "session", role: "operator", permissions: ["partners", "catalog"], surface: "control-panel", expiresAt: "2099-01-01T00:00:00.000Z",
  } } }));
}

test("store registry shows business names and exports them without internal keys", async ({ page }) => {
  await session(page);
  await page.route("**/api/partners/stores**", (route) => route.fulfill({ json: { stores: [store] } }));
  await page.goto("/partners/stores");
  const table = page.getByRole("table");
  await expect(table.getByRole("link", { name: store.partnerName })).toBeVisible();
  await expect(table.getByText("صنعاء", { exact: true })).toBeVisible();
  await expect(table.getByText("البقالة", { exact: true })).toBeVisible();
  await expect(table).not.toContainText("opaque_internal");
  await expect(page.getByRole("main")).not.toContainText(/DSH|WLT|نسخة المتجر/);
  await table.getByRole("checkbox", { name: "تحديد متجر سوبر ماركت الخير" }).check();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "تصدير المحدد" }).click();
  const result = await download;
  const stream = await result.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  const csv = Buffer.concat(chunks).toString("utf8");
  expect(csv).toContain(store.partnerName);
  expect(csv).toContain("صنعاء");
  expect(csv).not.toContain("opaque_internal");
});

test("store profile keeps useful facts and actions without database IDs or versions", async ({ page }) => {
  await session(page);
  await page.route("**/api/stores/store_opaque_internal/publication", (route) => route.fulfill({ json: { store, idempotentReplay: false } }));
  await page.route("**/api/catalog/commercial-store-types**", (route) => route.fulfill({ json: { storeTypes: [{ id: store.commercialStoreTypeId, nameAr: "سوبر ماركت", active: true }] } }));
  await page.goto("/partners/stores/store_opaque_internal");
  const main = page.getByRole("main");
  await expect(main.getByRole("link", { name: store.partnerName })).toBeVisible();
  await expect(main.getByText("صنعاء", { exact: true })).toBeVisible();
  await expect(main).not.toContainText(/opaque_internal|v71|نسخة المتجر|DSH|WLT/);
  await expect(main.getByRole("button", { name: "إخفاء المتجر" })).toBeEnabled();
});

test("missing display names never fall back to opaque keys", async ({ page }) => {
  await session(page);
  await page.route("**/api/partners/stores**", (route) => route.fulfill({ json: { stores: [{ ...store, partnerName: undefined, serviceCityName: undefined, primaryVerticalName: undefined }] } }));
  await page.goto("/partners/stores");
  await expect(page.getByRole("table")).not.toContainText("opaque_internal");
  await expect(page.getByRole("link", { name: "ملف الشريك", exact: true })).toBeVisible();
});
