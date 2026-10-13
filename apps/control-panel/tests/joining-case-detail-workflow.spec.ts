import { expect, test } from "@playwright/test";

const joiningCase = {
  id: "case-review", contactPhoneE164: "+967777765432", ownerFullName: "",
  businessName: "مؤسسة التجارة", firstStoreName: "متجر الاختبار",
  firstStoreAddress: "شارع الزبيري، صنعاء", serviceCityId: "city-1",
  firstStoreVerticalId: "vertical-1", firstStoreCommercialTypeId: "type-1",
  firstStoreLatitude: 15.35, firstStoreLongitude: 44.2,
  firstStoreFulfillmentModes: ["BTHWANI_CAPTAIN"], firstStoreWorkingHours: { intervals: [] },
  firstStoreProofType: "COMMERCIAL_REGISTRATION", firstStoreProofNumberPresent: true,
  firstStoreProofImageUploaded: false, reviewPhotoUploaded: false,
  origin: "field", partnerActorId: "actor-review", state: "approved",
  store: { id: "store-review" }, financialProfileState: "ACTIVE",
  settlementPeriod: "MONTHLY", termsPolicyVersion: "policy-1",
  version: 5, createdAt: "2026-10-10T10:00:00Z", updatedAt: "2026-10-12T10:00:00Z",
};

test("joining case reads private proof on demand, preserves owner identity and opens a real map action", async ({ page }) => {
  let proofReads = 0;
  let policyReads = 0;
  await page.route("**/api/auth/session**", (route) => route.fulfill({ json: { identity: {
    subject: "operator-review", sessionId: "session", role: "operator", permissions: ["partners"],
    surface: "control-panel", expiresAt: "2099-01-01T00:00:00.000Z",
  } } }));
  await page.route("**/api/notifications**", (route) => route.fulfill({ json: { notifications: [], unreadCount: 0 } }));
  await page.route("**/api/service-cities**", (route) => route.fulfill({ json: { cities: [{ id: "city-1", displayNameAr: "صنعاء" }] } }));
  await page.route("**/api/catalog/verticals**", (route) => route.fulfill({ json: { verticals: [{ id: "vertical-1", nameAr: "البقالة" }] } }));
  await page.route("**/api/catalog/commercial-store-types**", (route) => route.fulfill({ json: { storeTypes: [{ id: "type-1", nameAr: "سوبر ماركت" }] } }));
  await page.route("**/api/finance/partner-financial-terms-policy**", (route) => { policyReads++; return route.fulfill({ json: { policy: null } }); });
  await page.route("**/api/partners/joining-cases/case-review/proof-details", (route) => {
    proofReads++;
    return route.fulfill({ json: { proofNumber: "REG-12345" } });
  });
  await page.route("**/api/partners/joining-cases/case-review", (route) => route.fulfill({ json: { case: joiningCase } }));
  await page.goto("/partners/case-review");
  const summary = page.getByRole("region", { name: "ملخص طلب الانضمام" });
  await expect(summary).toContainText("اسم المالك غير مسجل");
  await expect(summary).toContainText("متجر الاختبار");
  await expect(summary.getByRole("link", { name: "+967777765432" })).toHaveAttribute("href", "tel:+967777765432");
  expect(proofReads).toBe(0);
  expect(policyReads).toBe(0);
  await expect(page.getByRole("button", { name: "إعادة قراءة الحالة" })).toHaveCount(0);

  const details = page.locator(".partner-case-details");
  await details.locator(":scope > summary").click();
  await expect(details.getByRole("link", { name: "فتح موقع المتجر على الخريطة" })).toHaveAttribute("href", "https://www.google.com/maps?q=15.35,44.2");
  expect(proofReads).toBe(0);
  await details.locator("dl.facts-grid button.button-secondary").click();
  await expect(details).toContainText("REG-12345");
  expect(proofReads).toBe(1);
  expect(policyReads).toBe(0);

  await details.locator(":scope > summary").click();
  await details.locator(":scope > summary").click();
  expect(proofReads).toBe(1);
});

test("partner file distinguishes legal owner from business and keeps routine rereads automatic", async ({ page }) => {
  await page.route("**/api/auth/session**", (route) => route.fulfill({ json: { identity: {
    subject: "operator-review", sessionId: "session", role: "operator", permissions: ["partners"],
    surface: "control-panel", expiresAt: "2099-01-01T00:00:00.000Z",
  } } }));
  await page.route("**/api/notifications**", (route) => route.fulfill({ json: { notifications: [], unreadCount: 0 } }));
  await page.route("**/api/partners/roster/actor-review", (route) => route.fulfill({ json: {
    partner: { actorId: "actor-review", phoneE164: "+967777765432", enabled: true,
      securityEnabled: true, activatedAt: "2026-10-12T10:00:00Z", actorVersion: 2, roleVersion: 3 },
    joiningCase,
  } }));
  await page.route("**/api/partners/roster/actor-review/stores**", (route) => route.fulfill({ json: { stores: [], nextCursor: "" } }));
  await page.goto("/partners/actors/actor-review");
  const summary = page.getByRole("region", { name: "ملخص حساب الشريك ومتجره" });
  await expect(summary).toContainText("اسم المالك غير مسجل");
  await expect(summary).not.toContainText("مؤسسة التجارة");
  await expect(summary.getByRole("link", { name: "+967777765432" })).toHaveAttribute("href", "tel:+967777765432");
  await expect(page.getByRole("button", { name: "إعادة القراءة", exact: true })).toHaveCount(0);
  await summary.getByRole("button", { name: "عرض جميع المتاجر" }).click();
  await expect(page.getByRole("heading", { name: "متاجر الشريك" })).toBeVisible();
  await expect(page.getByRole("button", { name: "إعادة القراءة", exact: true })).toHaveCount(0);
});

test("case review returns to the precise originating queue filters without leaking them into the detail URL", async ({ page }) => {
  await page.route("**/api/auth/session**", (route) => route.fulfill({ json: { identity: {
    subject: "operator-review", sessionId: "session", role: "operator", permissions: ["partners"],
    surface: "control-panel", expiresAt: "2099-01-01T00:00:00.000Z",
  } } }));
  await page.route("**/api/notifications**", (route) => route.fulfill({ json: { notifications: [], unreadCount: 0 } }));
  await page.route("**/api/partners/joining-cases?**", (route) => route.fulfill({ json: { cases: [joiningCase], nextCursor: "" } }));
  await page.route("**/api/partners/joining-cases/case-review", (route) => route.fulfill({ json: { case: joiningCase } }));
  await page.goto("/partners/joining?state=approved&sort=created_desc&q=%D9%85%D8%AA%D8%AC%D8%B1");
  const original = new URL(page.url()).search;
  const row = page.locator(".joining-case-table tbody tr").first();
  await expect(row).toContainText("متجر الاختبار");
  await row.getByRole("link", { name: /متابعة الطلب/ }).click();
  await expect(page).toHaveURL(/\/partners\/case-review$/);
  const back = page.getByRole("link", { name: "العودة إلى طلبات الانضمام" });
  await expect(back).toHaveAttribute("href", "/partners/joining" + original);
  await back.click();
  await expect(page).toHaveURL(/\/partners\/joining\?/);
  expect(new URL(page.url()).search).toBe(original);
});
