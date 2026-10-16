import { expect, test } from "./coverage-fixtures";

test("partner-only store profile hides finance and does not request protected finance or order data", async ({ page }) => {
  const privilegedReads: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (/^\/api\/(finance|operations|wallet)(\/|$)/.test(path)) privilegedReads.push(path);
  });
  const store = {
    id: "access-boundary-store", partnerActorId: "access-boundary-partner", name: "متجر حد الصلاحية",
    partnerName: "الشريك التجريبي", serviceCityName: "صنعاء", primaryVerticalName: "مطاعم",
    serviceCityId: "sanaa", primaryVerticalId: "restaurants", commercialStoreTypeId: "restaurant",
    fulfillmentModes: ["BTHWANI_CAPTAIN"], publicationState: "published",
    publicationReadiness: { ready: true, blockedReason: null }, version: 1,
    createdAt: "2026-10-10T10:00:00Z", updatedAt: "2026-10-15T10:00:00Z",
  };
  await page.route("**/api/auth/session**", (route) => route.fulfill({ json: { identity: {
    subject: "partner-only-operator", sessionId: "partner-only-session", role: "operator",
    permissions: ["partners"], surface: "control-panel", expiresAt: "2099-01-01T00:00:00Z",
  } } }));
  await page.route("**/api/notifications**", (route) => route.fulfill({ json: { notifications: [], unreadCount: 0 } }));
  await page.route("**/api/service-cities**", (route) => route.fulfill({ json: { cities: [] } }));
  await page.route("**/api/partners/workbench?**", (route) => route.fulfill({ json: {
    rows: [{ kind: "store", store, partnerRole: null }], nextCursor: "",
  } }));
  await page.route("**/api/stores/access-boundary-store/publication", (route) => route.fulfill({ json: { store } }));
  await page.route("**/api/partners/roster/access-boundary-partner", (route) => route.fulfill({ json: {
    partner: { actorId: store.partnerActorId, phoneE164: "+967777000111", enabled: true, securityEnabled: true, activatedAt: store.createdAt },
    joiningCase: null,
  } }));
  await page.route("**/api/stores/access-boundary-store/offers", (route) => route.fulfill({ json: { offers: [] } }));

  await page.goto("/partners?inspect=access-boundary-store");
  const profile = page.getByRole("region", { name: "تفاصيل المتجر" });
  await expect(profile).toBeVisible();
  await expect(profile.getByRole("tab", { name: "المالية" })).toHaveCount(0);
  await profile.getByRole("tab", { name: "الطلبات" }).click();
  await expect(profile.getByText("قراءة الطلبات تتطلب صلاحية العمليات لدى المشغّل.")).toBeVisible();
  expect(privilegedReads).toEqual([]);
});
