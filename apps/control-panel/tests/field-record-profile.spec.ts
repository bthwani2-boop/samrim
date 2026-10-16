import { expect, test } from "./coverage-fixtures";

test("Field operator profile keeps admissions, acquisition and finance in one editable record", async ({ page }) => {
  test.setTimeout(60_000);
  await page.route("**/api/auth/session**", (route) => route.fulfill({ status: 200, json: { identity: { subject: "operator-1", sessionId: "operator-session", role: "operator", permissions: ["partners", "finance"], surface: "control-panel", expiresAt: "2099-01-01T00:00:00.000Z" } } }));
  await page.route("**/api/service-cities**", (route) => route.fulfill({ status: 200, json: { cities: [{ id: "city-1", displayNameAr: "صنعاء", active: true, version: 1 }] } }));
  await page.route("**/api/wallet-providers**", (route) => route.fulfill({ status: 200, json: { walletProviders: [{ key: "wallet-1", displayNameAr: "محفظة رسمية", active: true, version: 1 }] } }));
  let admission = { id: "field-admission-1", actorId: "field-1", fullNameAr: "ميداني تجريبي", contactPhoneE164: "+967770030001", walletProviderKey: "wallet-1", allServiceCities: true, serviceCityIds: [], state: "eligible", requiresProfileReview: false, version: 1 };
  let enabled = true;
  const account = () => ({ kind: "account", account: { actorId: "field-1", actorVersion: 1, roleVersion: 1, role: "field", phoneE164: "+967770030001", enabled, securityEnabled: true, activatedAt: "2026-10-01T10:00:00Z", lastAppOpenedAt: "2026-10-14T10:00:00Z", admission, joiningCaseCount: 2, latestStore: { storeId: "store-1", storeName: "متجر نموذجي", joiningCaseId: "case-1", createdAt: "2026-10-13T10:00:00Z" }, latestJoiningCase: { id: "case-1", displayName: "شريك نموذجي", state: "approved", createdAt: "2026-10-13T10:00:00Z" } } });
  const posted: Array<Record<string, unknown>> = [];
  await page.route("**/api/fields?**", (route) => route.fulfill({ status: 200, json: { items: [account()] } }));
  await page.route("**/api/fields", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const body = route.request().postDataJSON() as Record<string, unknown>;
    posted.push(body);
    if (body.action === "update-profile") admission = { ...admission, fullNameAr: String(body.fullNameAr), version: admission.version + 1 };
    if (body.action === "disable") enabled = false;
    await route.fulfill({ status: 200, json: { admission } });
  });
  await page.route("**/api/fields/field-1/acquisition-cases?**", (route) => route.fulfill({ status: 200, json: { cases: [{ id: "case-1", businessName: "شريك نموذجي", firstStoreName: "متجر نموذجي", state: "approved", createdAt: "2026-10-13T10:00:00Z" }] } }));
  await page.route("**/api/finance/beneficiaries/field/field-1/financial-statement**", (route) => route.fulfill({ status: 200, json: { statement: { actorType: "field", actorId: "field-1", currency: "YER", periodStart: "2026-10-01", periodEnd: "2026-10-16", openingBalanceMinor: 0, creditsMinor: 25000, debitsMinor: 0, closingBalanceMinor: 25000, currentBalanceMinor: 25000, entries: [{ transactionId: "txn-1", transactionType: "FIELD_ACQUISITION_ENTITLEMENT_POSTED", direction: "CREDIT", amountMinor: 25000, balanceAfterMinor: 25000, createdAt: "2026-10-13T10:00:00Z" }] } } }));
  await page.route("**/api/finance/actor-payout-state?**", (route) => route.fulfill({ status: 200, json: { state: { actorType: "field", actorId: "field-1", currency: "YER", eligibleAvailableMinor: 25000, heldMinor: 0, acquiredStoreCount: 1, earnedMinor: 25000, destination: null, latestPayout: null } } }));
  await page.route("**/api/finance/actor-destination**", (route) => route.fulfill({ status: 200, json: { destination: null } }));

  await page.goto("/fields");
  await page.getByRole("button", { name: "فتح الملف", exact: true }).click();
  await expect(page.getByRole("region", { name: "ميداني تجريبي" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "نظرة عامة" })).toHaveAttribute("aria-selected","true");
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await expect(page.locator(".field-profile-hero")).toHaveCSS("background-color", "rgb(30, 41, 59)");
  await page.screenshot({ path: "D:/samrim-progressing/field-control-dark.png" });
  await page.getByRole("button", { name: "توسيع ملف السجل" }).click();
  await expect(page.locator(".adaptive-record-workspace")).toHaveAttribute("data-full", "true");
  await page.screenshot({ path: "D:/samrim-progressing/field-control-expanded.png" });
  await page.getByRole("tab", { name: "المتاجر والضم" }).click();
  await expect(page.getByRole("heading", { name: "المتاجر وملفات ضم الشركاء" })).toBeVisible();
  await expect(page.getByText("الملفات المحمّلة الآن: 1")).toBeVisible();
  await page.getByRole("tab", { name: "الأداء" }).click();
  await expect(page.getByRole("heading", { name: "الأداء الموثق" })).toBeVisible();
  await page.getByRole("tab", { name: "المالية" }).click();
  await page.getByRole("button", { name: "عرض الكشف المالي" }).click();
  await expect(page.getByText("المكافآت المكتسبة", { exact: true })).toBeVisible();
  await expect(page.getByText("مكافأة ضم متجر", { exact: true })).toBeVisible();
  await expect(page.getByText("غير مهيأة", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("region", { name: "ميداني تجريبي" })).toBeVisible();
  await page.screenshot({ path: "D:/samrim-progressing/field-control-mobile.png" });
  await page.setViewportSize({ width: 1280, height: 900 });

  await page.getByRole("tab", { name: "الحساب والتحكم" }).click();
  await page.getByText("تعديل الملف والتغطية", { exact: true }).click();
  await page.getByRole("textbox", { name: "اسم العرض" }).fill("ميداني مُحدَّث");
  await page.getByRole("button", { name: "حفظ الملف والمدن" }).click();
  await expect.poll(() => posted.length).toBe(1);
  expect(posted[0]?.action).toBe("update-profile");
  await expect(page.getByRole("region", { name: "ميداني مُحدَّث" })).toBeVisible();
  await page.getByText("إدارة الوصول", { exact: true }).click();
  await page.getByRole("textbox", { name: "سبب الإجراء" }).fill("تعليق مؤقت بطلب الإدارة");
  await page.getByRole("button", { name: "إيقاف الوصول" }).click();
  await expect.poll(() => posted.length).toBe(2);
  expect(posted[1]?.action).toBe("disable");
  await expect(page.getByRole("region", { name: "ميداني مُحدَّث" }).getByRole("img", { name: "الدور موقوف بعد التفعيل" })).toBeVisible();
  await page.getByRole("button", { name: "إغلاق التفاصيل" }).click();
  await expect(page.getByRole("region", { name: "ميداني مُحدَّث" })).toHaveCount(0);
});

test("Field profile financial disclosure respects server finance permission", async ({ page }) => {
  test.setTimeout(35_000);
  await page.route("**/api/auth/session**", (route) => route.fulfill({ status: 200, json: { identity: { subject: "operator-1", sessionId: "operator-session", role: "operator", permissions: ["partners"], surface: "control-panel", expiresAt: "2099-01-01T00:00:00.000Z" } } }));
  await page.route("**/api/service-cities**", (route) => route.fulfill({ status: 200, json: { cities: [] } }));
  await page.route("**/api/wallet-providers**", (route) => route.fulfill({ status: 200, json: { walletProviders: [] } }));
  await page.route("**/api/fields?**", (route) => route.fulfill({ status: 200, json: { items: [{ kind: "account", account: { actorId: "field-1", role: "field", phoneE164: "+967770030001", enabled: true, securityEnabled: true, admission: { id: "field-admission-1", fullNameAr: "ميداني تجريبي", walletProviderKey: "wallet-1", allServiceCities: true, state: "eligible", version: 1 } } }] } }));
  await page.route("**/api/finance/beneficiaries/field/field-1/financial-statement**", (route) => route.fulfill({ status: 403, json: { error: { code: "FORBIDDEN" } } }));
  await page.route("**/api/finance/actor-payout-state?**", (route) => route.fulfill({ status: 403, json: { error: { code: "FORBIDDEN" } } }));
  await page.goto("/fields");
  await page.getByRole("button", { name: "فتح الملف", exact: true }).click();
  await page.getByRole("tab", { name: "المالية" }).click();
  await page.getByRole("button", { name: "عرض الكشف المالي" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "تتطلب صلاحية المالية" })).toBeVisible();
  await page.getByRole("tab", { name: "الحساب والتحكم" }).click();
  await expect(page.getByRole("heading", { name: "الملف والأهلية والتغطية" })).toBeVisible();
});


test("Field candidate remains in its operational profile through approval and role provisioning", async ({ page }) => {
  test.setTimeout(40_000);
  await page.route("**/api/auth/session**", (route) => route.fulfill({ status: 200, json: { identity: { subject: "operator-1", sessionId: "operator-session", role: "operator", permissions: ["partners"], surface: "control-panel", expiresAt: "2099-01-01T00:00:00.000Z" } } }));
  await page.route("**/api/service-cities**", (route) => route.fulfill({ status: 200, json: { cities: [{ id: "city-1", displayNameAr: "صنعاء", active: true, version: 1 }] } }));
  await page.route("**/api/wallet-providers**", (route) => route.fulfill({ status: 200, json: { walletProviders: [{ key: "wallet-1", displayNameAr: "محفظة رسمية", active: true }] } }));
  let admission = { id: "admission-1", fullNameAr: "مرشح ميداني", contactPhoneE164: "+967770030002", walletProviderKey: "wallet-1", allServiceCities: true, serviceCityIds: [], state: "pending_review", requiresProfileReview: false, version: 1, actorId: null as string | null };
  await page.route("**/api/fields?**", (route) => route.fulfill({ status: 200, json: { items: admission.state === "eligible" ? [{ kind: "account", account: { actorId: "field-new", role: "field", phoneE164: admission.contactPhoneE164, enabled: true, securityEnabled: true, admission } }] : [{ kind: "candidate", admission }] } }));
  await page.route("**/api/fields", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const body = route.request().postDataJSON() as { action: string };
    if (body.action === "approve") admission = { ...admission, state: "pending_identity", version: admission.version + 1 };
    else if (body.action === "provision") admission = { ...admission, state: "eligible", actorId: "field-new", version: admission.version + 1 };
    await route.fulfill({ status: 200, json: { admission } });
  });
  await page.goto("/fields");
  await page.getByRole("button", { name: "فتح الملف", exact: true }).click();
  await page.getByRole("tab", { name: "الحساب والتحكم" }).click();
  await page.getByRole("button", { name: "اعتماد الملف", exact: true }).click();
  await expect(page.getByRole("button", { name: "منح دور الميداني" })).toBeVisible();
  await page.getByRole("button", { name: "منح دور الميداني" }).click();
  await expect(page.getByRole("region", { name: "مرشح ميداني" })).toBeVisible();
  await page.getByRole("tab", { name: "المالية" }).click();
  await expect(page.getByRole("heading", { name: "المستحقات ووجهة الصرف" })).toBeVisible();
});
