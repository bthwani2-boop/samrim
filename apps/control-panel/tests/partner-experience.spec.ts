import { expect, test } from "./coverage-fixtures";

const session = {
  subject: "partner-experience-operator",
  sessionId: "partner-experience-session",
  role: "operator",
  permissions: ["partners"],
  surface: "control-panel",
  expiresAt: "2099-01-01T00:00:00.000Z",
};

const picture = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44"><rect width="44" height="44" fill="#567"/></svg>');

const store = {
  id: "store-experience", partnerActorId: "actor-experience", name: "سوبر ماركت الخير",
  partnerName: "عبدالله أحمد", serviceCityName: "صنعاء", primaryVerticalName: "البقالة",
  serviceCityId: "city-1", primaryVerticalId: "vertical-1", commercialStoreTypeId: "type-1",
  deliveryOrigin: null, fulfillmentModes: ["BTHWANI_CAPTAIN"], version: 3, publicationState: "unpublished",
  publicationReadiness: { ready: false, blockedReason: "CATALOG_NOT_READY" },
  storeProfileImage: { uri: picture, role: "primary" }, createdAt: "2026-10-10T10:00:00Z",
  updatedAt: "2026-10-12T10:00:00Z",
};

const joiningCase = {
  id: "case-experience", contactPhoneE164: "+967777765432", ownerFullName: "عبدالله أحمد",
  businessName: "سوبر ماركت الخير", firstStoreName: "سوبر ماركت الخير",
  firstStoreAddress: "شارع الزبيري", serviceCityId: "city-1",
  firstStoreVerticalId: "vertical-1", firstStoreCommercialTypeId: "type-1",
  firstStoreLatitude: 15.35, firstStoreLongitude: 44.20,
  firstStoreFulfillmentModes: ["BTHWANI_CAPTAIN"], firstStoreWorkingHours: { intervals: [] },
  firstStoreProofType: "COMMERCIAL_REGISTRATION", firstStoreProofNumberPresent: true,
  firstStoreProofImageUploaded: false, reviewPhotoUploaded: false,
  origin: "field", partnerActorId: "actor-experience", state: "approved",
  store, storeProfileImage: store.storeProfileImage,
  financialProfileState: "ACTIVE", termsPolicyVersion: "current-policy",
  settlementPeriod: "MONTHLY", version: 5, createdAt: "2026-10-10T10:00:00Z",
  updatedAt: "2026-10-12T10:00:00Z",
};

test.beforeEach(async ({ page }) => {
  await page.route("**/api/auth/session**", (route) => route.fulfill({ json: { identity: session } }));
  await page.route("**/api/notifications**", (route) => route.fulfill({ json: { notifications: [], unreadCount: 0 } }));
  await page.route("**/api/service-cities**", (route) => route.fulfill({ json: { cities: [{ id: "city-1", displayNameAr: "صنعاء" }] } }));
  await page.route("**/api/catalog/verticals**", (route) => route.fulfill({ json: { verticals: [{ id: "vertical-1", nameAr: "البقالة" }] } }));
  await page.route("**/api/catalog/commercial-store-types**", (route) => route.fulfill({ json: { storeTypes: [{ id: "type-1", nameAr: "سوبر ماركت", active: true }] } }));
});

test("approved joining case puts identity, logo, status and direct files above expandable evidence", async ({ page }, testInfo) => {
  await page.route("**/api/partners/joining-cases/case-experience", (route) => route.fulfill({ json: { case: joiningCase, idempotentReplay: false } }));
  await page.goto("/partners/case-experience");
  const summary = page.getByRole("region", { name: "ملخص طلب الانضمام" });
  await expect(summary.getByRole("img", { name: "شعار متجر سوبر ماركت الخير" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("joining-case-review.png"), fullPage: true });
  await expect(summary).toContainText("الحالة: تمت الموافقة");
  await expect(summary.getByRole("link", { name: "فتح ملف المتجر" })).toHaveAttribute("href", "/partners/stores/store-experience");
  await expect(summary.getByRole("link", { name: "فتح ملف الشريك" })).toHaveAttribute("href", "/partners/actors/actor-experience");
  const details = page.locator(".partner-case-details");
  await expect(details).not.toHaveAttribute("open", "");
  await expect(details.getByText("رقم الإثبات", { exact: true })).toBeHidden();
  await details.locator(":scope > summary").click();
  await expect(details.getByText("رقم الإثبات", { exact: true })).toBeVisible();
  await summary.getByRole("link", { name: "متابعة الإجراء" }).click();
  await expect(page).toHaveURL(/#joining-case-actions$/);
  await expect(page.getByRole("heading", { name: "الخطوة التالية والإجراءات" })).toBeVisible();
  await expect(page.getByRole("link", { name: "فتح ملف المتجر", exact: true })).toHaveCount(1);
});

test("partner profile exposes linked first store before switching to the complete store list", async ({ page }) => {
  await page.route("**/api/partners/roster/actor-experience", (route) => route.fulfill({
    json: { partner: {
      actorId: "actor-experience", phoneE164: "+967777765432", enabled: true,
      securityEnabled: true, activatedAt: "2026-10-12T10:00:00Z",
      actorVersion: 2, roleVersion: 3,
    }, joiningCase },
  }));
  await page.route("**/api/partners/roster/actor-experience/stores**", (route) => route.fulfill({
    json: { stores: [store], nextCursor: "" },
  }));
  await page.goto("/partners/actors/actor-experience");
  const summary = page.getByRole("region", { name: "ملخص حساب الشريك ومتجره" });
  await expect(summary).toContainText("عبدالله أحمد");
  await expect(summary.getByRole("link", { name: "فتح المتجر" })).toHaveAttribute("href", "/partners/stores/store-experience");
  await summary.getByRole("button", { name: "عرض جميع المتاجر" }).click();
  await expect(page.getByRole("heading", { name: "متاجر الشريك" })).toBeVisible();
  await expect(page.locator(".partner-detail-stores-table").getByRole("link", { name: "سوبر ماركت الخير" })).toBeVisible();
});

test("mobile store file keeps publication primary and secondary operations collapsed", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/stores/store-experience/publication", (route) => route.fulfill({ json: { store, idempotentReplay: false } }));
  await page.goto("/partners/stores/store-experience");
  await expect(page.getByRole("heading", { name: "سوبر ماركت الخير", level: 1 })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("store-file-mobile-review.png"), fullPage: true });
  await expect(page.getByRole("region", { name: "ملخص حالة المتجر" })).toContainText("لا يوجد كتالوج");
  await expect(page.getByRole("link", { name: "ملف الشريك" })).toHaveAttribute("href", "/partners/actors/actor-experience");
  const advanced = page.locator(".store-advanced-settings");
  await expect(advanced).not.toHaveAttribute("open", "");
  await expect(advanced.getByRole("heading", { name: "سلة المحذوفات" })).toBeHidden();
  await advanced.locator("summary").click();
  await expect(advanced.getByRole("heading", { name: "سلة المحذوفات" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);
});

test("joining proof number stays private until explicitly requested, and failed reads recover", async ({ page }) => {
  await page.route("**/api/partners/joining-cases/case-experience", (route) =>
    route.fulfill({ json: { case: joiningCase, idempotentReplay: false } }));
  let proofReads = 0;
  await page.route("**/api/partners/joining-cases/case-experience/proof-details", (route) => {
    proofReads += 1;
    return route.fulfill(proofReads === 1
      ? { status: 503, json: { error: "temporary" } }
      : { json: { proofNumber: "TEST-PRIVATE-123" } });
  });
  await page.goto("/partners/case-experience");
  await expect(page.getByRole("region", { name: "ملخص طلب الانضمام" })).toBeVisible();
  expect(proofReads).toBe(0);
  const details = page.locator(".partner-case-details");
  await details.locator(":scope > summary").click();
  await expect(details.getByRole("button", { name: "عرض رقم الإثبات عند الحاجة" })).toBeVisible();
  expect(proofReads).toBe(0);
  await details.getByRole("button", { name: "عرض رقم الإثبات عند الحاجة" }).click();
  await expect(details.getByRole("alert")).toContainText("تعذر قراءة بيانات الإثبات");
  expect(proofReads).toBe(1);
  await details.getByRole("button", { name: "إعادة قراءة رقم الإثبات" }).click();
  await expect(details.getByText("TEST-PRIVATE-123")).toBeVisible();
  expect(proofReads).toBe(2);
});
