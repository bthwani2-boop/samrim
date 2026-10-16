import { expect, test } from "./coverage-fixtures";

const identity = {
  subject: "partner-workbench-operator", sessionId: "workbench-session",
  role: "operator", permissions: ["partners"], surface: "control-panel",
  expiresAt: "2099-01-01T00:00:00.000Z",
};

const store = {
  id: "store-workbench", partnerActorId: "actor-workbench", name: "مطعم سبأ",
  partnerName: "أحمد علي", serviceCityName: "صنعاء", primaryVerticalName: "مطاعم",
  serviceCityId: "city-sanaa", primaryVerticalId: "restaurants", commercialStoreTypeId: "restaurant",
  deliveryOrigin: null, fulfillmentModes: ["BTHWANI_CAPTAIN"], version: 3,
  publicationState: "unpublished", publicationReadiness: { ready: false, blockedReason: "CATALOG_NOT_READY" },
  storeProfileImage: null, createdAt: "2026-10-10T10:00:00Z", updatedAt: "2026-10-15T10:00:00Z",
};

test.beforeEach(async ({ page }) => {
  await page.route("**/api/auth/session**", (route) => route.fulfill({ json: { identity } }));
  await page.route("**/api/notifications**", (route) => route.fulfill({ json: { notifications: [], unreadCount: 0 } }));
  await page.route("**/api/service-cities**", (route) => route.fulfill({ json: { cities: [{ id: "city-sanaa", displayNameAr: "صنعاء" }] } }));
  await page.route("**/api/partners/workbench?**", (route) => {
    const kind = new URL(route.request().url()).searchParams.get("kind") || "all";
    const allRows = [
      { kind: "joining", case: { id: "case-workbench", firstStoreName: "سوبر ماركت الخير", businessName: "سوبر ماركت الخير", contactPhoneE164: "+967777000002", origin: "field", state: "submitted", createdAt: "2026-10-10T10:00:00Z", updatedAt: "2026-10-15T12:00:00Z" } },
      { kind: "access", grant: { id: "grant-workbench", storeId: "store-other", storeName: "متجر النور", delegatePhoneMasked: "***001", state: "pending_role_admission", permissions: ["orders"], expiresAt: "2026-10-30T14:00:00Z", updatedAt: "2026-10-14T10:00:00Z" } },
      { kind: "store", store, partnerRole: { actorId: "actor-workbench", enabled: true, securityEnabled: true, activatedAt: "2026-10-12T10:00:00Z", phoneE164: "+967777000001", roleVersion: 1 } },
    ];
    const rows = allRows.filter((row) => kind === "all" || (kind === "requests" && (row.kind === "joining" || row.kind === "access")) || row.kind === kind);
    return route.fulfill({ json: { rows, nextCursor: "" } });
  });
  await page.route("**/api/partners/joining-cases?**", (route) => route.fulfill({
    json: { cases: [{ id: "case-workbench", firstStoreName: "سوبر ماركت الخير", businessName: "سوبر ماركت الخير", contactPhoneE164: "+967777000002", origin: "field", state: "submitted", updatedAt: "2026-10-15T12:00:00Z" }], nextCursor: "" },
  }));
  await page.route("**/api/partners/store-access-admissions?**", (route) => route.fulfill({
    json: { items: [{ id: "grant-workbench", storeId: "store-other", storeName: "متجر النور", delegatePhoneMasked: "***001", state: "pending_role_admission", updatedAt: "2026-10-14T10:00:00Z" }], nextCursor: "" },
  }));
  await page.route("**/api/stores/store-workbench/publication", (route) => route.fulfill({ json: { store, idempotentReplay: false } }));
  await page.route("**/api/partners/roster/actor-workbench", (route) => route.fulfill({
    json: { partner: { actorId: "actor-workbench", phoneE164: "+967777000001", enabled: true, securityEnabled: true, activatedAt: "2026-10-12T10:00:00Z", actorVersion: 1, roleVersion: 1 }, joiningCase: null },
  }));
});

test("partner workbench prioritizes actionable requests with rich store rows and a unified drawer", async ({ page }, info) => {
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.goto("/partners");
  await expect(page.getByRole("heading", { name: "الشركاء والمتاجر" })).toBeVisible();
  const registry = page.locator(".partner-registry-table");
  await expect(registry.locator('tr[data-kind="joining"]')).toHaveCount(0);
  await expect(registry.locator('tr[data-kind="access"]')).toHaveCount(0);
  await expect(registry.locator('tr[data-kind="store"]')).toHaveCount(1);
  await expect(registry).toContainText("مطعم سبأ");
  await expect(registry).toContainText("فحص جاهزية النشر");
  await registry.getByRole("button", { name: /فحص جاهزية النشر/ }).click();
  const drawer = page.getByRole("region", { name: "تفاصيل المتجر" });
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText("مطعم سبأ");
  await expect(drawer).toContainText("معلومات المتجر والشريك");
  await expect(drawer.getByText("الملف المالي", { exact: true })).toHaveCount(0);
  await expect(drawer.getByRole("link", { name: /فتح المركز المالي/ })).toHaveCount(0);
  await expect(drawer.getByText("حالة حساب الشريك")).toBeVisible();
  await expect(drawer.getByRole("button", { name: "إدارة المتجر" })).toBeVisible();
  await expect(drawer.getByRole("link", { name: /الملف الكامل/ })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("partner-workbench-desktop.png") });
  await drawer.getByRole("button", { name: "إغلاق التفاصيل" }).click();
  await expect(drawer).toHaveCount(0);
  await page.getByRole("tab", { name: "طلبات الانضمام والاعتمادات" }).click();
  await expect(registry.locator('tr[data-kind="store"]')).toHaveCount(0);
  await expect(registry.locator('tr[data-kind="joining"]')).toHaveCount(1);
  await expect(registry.locator('tr[data-kind="access"]')).toHaveCount(1);
  await expect(registry.getByRole("button", { name: /مراجعة الطلب/ })).toBeVisible();
  await expect(registry.getByRole("button", { name: /مراجعة الاعتماد/ })).toBeVisible();
});

test("same drawer remains usable at 390px and Escape closes it", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/partners");
  await expect(page.getByRole("link", { name: /طلب انضمام جديد/ })).toBeVisible();
  await page.locator(".partner-unified-cards").getByRole("button", { name: /إدارة المتجر/ }).click();
  const drawer = page.getByRole("region", { name: "تفاصيل المتجر" });
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText("مطعم سبأ");
  await expect(drawer.getByRole("button", { name: "توسيع ملف السجل" })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("partner-workbench-mobile.png") });
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);
});

test("adaptive store file keeps the list usable, resizes by keyboard, and expands in place", async ({ page }, info) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.goto("/partners");
  await page.locator(".partner-registry-table").getByRole("button", { name: /فحص جاهزية النشر/ }).click();
  const view = page.locator(".adaptive-record-workspace");
  const detail = page.getByRole("region", { name: "تفاصيل المتجر" });
  await expect(view).toHaveAttribute("data-split", "true");
  await expect(detail).toBeVisible();
  await expect(detail.locator(".store-sheet-hero")).toBeVisible();
  await expect(page.locator(".partner-registry-table")).toBeVisible();
  const unifiedTable = page.locator(".partner-unified-table");
  const columnHeaders = unifiedTable.locator("thead th");
  await expect(columnHeaders).toHaveCount(6);
  for (let index = 0; index < 6; index += 1) await expect(columnHeaders.nth(index)).toBeVisible();
  await expect(unifiedTable.locator('tbody tr[data-kind="store"] .record-indicator-symbol[role="img"][aria-label="النشر: غير منشور"]')).toBeVisible();
  const storeIdentityWidth = await unifiedTable.locator('tbody tr[data-kind="store"] th').evaluate((cell) => cell.getBoundingClientRect().width);
  expect(storeIdentityWidth).toBeGreaterThanOrEqual(160);
  expect(await view.getAttribute("style")).toBeNull();
  await expect(page.locator(".adaptive-record-display-controls")).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("adaptive-store-split-desktop.png"), fullPage: false });
  const handle = page.getByRole("separator", { name: "تغيير عرض ملف السجل" });
  const before = Number(await handle.getAttribute("aria-valuenow"));
  await handle.focus();
  await handle.press("ArrowRight");
  await expect.poll(async () => Number(await handle.getAttribute("aria-valuenow"))).toBeGreaterThan(before);
  await handle.press("Home");
  const effectiveMinimum = await handle.getAttribute("aria-valuemin");
  if (effectiveMinimum === null) throw new Error("The resizer must expose its effective minimum.");
  await expect(handle).toHaveAttribute("aria-valuenow", effectiveMinimum);
  await handle.press("End");
  const effectiveMaximum = await handle.getAttribute("aria-valuemax");
  if (effectiveMaximum === null) throw new Error("The resizer must expose its effective maximum.");
  await expect(handle).toHaveAttribute("aria-valuenow", effectiveMaximum);
  await detail.getByRole("button", { name: "توسيع ملف السجل" }).click();
  await expect(view).toHaveAttribute("data-full", "true");
  await expect(detail).toBeVisible();
  await expect(detail.locator(".store-profile-content .store-profile-card")).toHaveCount(5);
  const fullDashboard = await detail.locator(".store-sheet-dashboard").boundingBox();
  expect(fullDashboard?.width).toBeGreaterThan(900);
  await page.screenshot({ path: info.outputPath("adaptive-store-full-desktop.png"), fullPage: false });
  await detail.getByRole("button", { name: "استعادة عرض القائمة والملف" }).click();
  await expect(view).toHaveAttribute("data-full", "false");
  await expect(page.locator(".partner-registry-table")).toBeVisible();
  await detail.getByRole("button", { name: "إغلاق التفاصيل" }).click();
  await expect(detail).toHaveCount(0);
});
