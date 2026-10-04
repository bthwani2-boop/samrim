import { expect, type Page, test } from "./coverage-fixtures";

async function stubSession(page: Page, status: number) {
  await page.route("**/api/auth/session**", async (route) => {
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(status === 401 ? { error: { code: "UNAUTHENTICATED" } } : { error: { code: "IDENTITY_UNAVAILABLE" } }),
    });
  });
}

const authenticatedOperator = {
  subject: "actor-operator",
  sessionId: "session-operator",
  role: "operator",
  permissions: ["operations", "partners", "catalog", "marketing", "finance", "platform_policies"],
  surface: "control-panel",
  expiresAt: "2099-01-01T00:00:00.000Z",
};

async function stubAuthenticatedSession(page: Page, permissions = authenticatedOperator.permissions, canManageOperatorPermissions = false) {
  await page.route("**/api/auth/session**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ identity: { ...authenticatedOperator, permissions, ...(canManageOperatorPermissions ? { canManageOperatorPermissions: true } : {}) } }) });
  });
}

async function stubCommercialStoreTypes(page: Page) {
  await page.route("**/api/catalog/commercial-store-types**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ storeTypes: [{ id: "grocery-market", verticalId: "grocery", nameAr: "بقالة عامة", nameEn: "Grocery Store", active: true, version: 1, createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z" }] }),
    });
  });
}

const operatorJoiningCaseDraft = {
  ownerFullName: "سامي ناصر محمد العريقي",
  contactPhoneE164: "+96777000100",
  businessName: "نشاط الاختبار",
  firstStoreName: "متجر الاختبار",
  firstStoreAddress: "شارع الزبيري، صنعاء",
  serviceCityId: "sanaa",
  firstStoreVerticalId: "grocery",
  firstStoreCommercialTypeId: "grocery-market",
  firstStoreLatitude: 15.369445,
  firstStoreLongitude: 44.191006,
  firstStoreWorkingHours: { intervals: [{ dayOfWeek: 1, opensAt: "09:00", closesAt: "17:00", closesNextDay: false }] },
  firstStoreProofType: "COMMERCIAL_REGISTRATION",
  firstStoreProofNumber: "CR-100",
} as const;

async function fillOperatorJoiningCaseForm(page: Page) {
  await page.getByLabel("اسم المالك الكامل").fill(operatorJoiningCaseDraft.ownerFullName);
  await page.getByLabel("رقم جوال المالك (E.164)").fill("+967 77000100");
  await page.getByLabel("الاسم القانوني للنشاط").fill(operatorJoiningCaseDraft.businessName);
  await page.getByLabel("اسم المتجر الأول").fill(operatorJoiningCaseDraft.firstStoreName);
  await page.getByLabel("عنوان المتجر").fill(operatorJoiningCaseDraft.firstStoreAddress);
  await page.getByLabel("مدينة المتجر الأول").selectOption(operatorJoiningCaseDraft.serviceCityId);
  await page.locator("#joining-vertical").selectOption(operatorJoiningCaseDraft.firstStoreVerticalId);
  await page.locator("#joining-commercial-type").selectOption(operatorJoiningCaseDraft.firstStoreCommercialTypeId);
  await page.getByRole("group", { name: "ساعات العمل الأسبوعية · توقيت المدينة" }).getByRole("checkbox").first().check();
  await page.getByLabel("رقم الإثبات").fill(operatorJoiningCaseDraft.firstStoreProofNumber);
  await page.getByLabel("خط عرض موقع المتجر").fill(String(operatorJoiningCaseDraft.firstStoreLatitude));
  await page.getByLabel("خط طول موقع المتجر").fill(String(operatorJoiningCaseDraft.firstStoreLongitude));
}

async function exerciseReviewedDshCandidateFlow(page: Page, role: "captain" | "field", initialName: string, reviewedName: string, phone: string) {
  const surface = role === "captain" ? "captains" : "fields";
  const actorID = `act_${role}_reviewed_candidate`;
  const admissionID = `${role === "captain" ? "cap" : "fld"}_adm_reviewed_candidate`;
  const candidateNameSelector = role === "field" ? `#candidate-name-${admissionID}` : `#${role}-candidate-name-${admissionID}`;
  let profile: { id: string; actorId?: string; fullNameAr: string; contactPhoneE164: string; serviceCityId?: string; state: string; requiresProfileReview?: boolean; version: number } | null = null;
  const mutations: Record<string, unknown>[] = [];

  if (role === "field") {
    await page.route("**/api/service-cities**", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ cities: [{ id: "sanaa", displayNameAr: "صنعاء", active: true, version: 1, createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z" }] }) });
    });
  }

  await page.route(`**/api/${surface}**`, async (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      const params = new URL(request.url()).searchParams;
      if (role === "captain" && params.get("scope") !== "candidates") {
        const items = profile?.actorId ? [{ actorId: profile.actorId, phoneE164: profile.contactPhoneE164, role: "captain", enabled: true, admission: profile }] : [];
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items, limit: 25, nextCursor: "" }) });
        return;
      }
      if (role === "captain") {
        const requestedState = params.get("state") ?? "review_required";
        const visible = profile && (requestedState === "all" || requestedState === profile.state || (requestedState === "review_required" && profile.requiresProfileReview)) ? [profile] : [];
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: visible, limit: 25, nextCursor: "" }) });
        return;
      }
      if (role === "field" && params.get("scope") === "workbench") {
        const items = profile?.actorId
          ? [{ kind: "account", account: { actorId: profile.actorId, phoneE164: profile.contactPhoneE164, role: "field", enabled: true, activatedAt: undefined, securityEnabled: true, actorVersion: 1, roleVersion: 1, admission: profile } }]
          : profile && (profile.state === "pending_review" || profile.state === "pending_identity") ? [{ kind: "candidate", admission: profile }] : [];
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items, limit: 25 }) });
        return;
      }
      if (params.get("scope") !== "candidates") {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [], limit: 25, nextCursor: "" }) });
        return;
      }
      const requestedState = params.get("state") ?? "pending_review";
      const visible = profile && (requestedState === "all" || requestedState === profile.state) ? [profile] : [];
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: visible, limit: 25, nextCursor: "" }) });
      return;
    }

    const body = request.postDataJSON() as Record<string, unknown>;
    mutations.push(body);
    const action = body.action;
    if (action === "admit") {
      profile = { id: admissionID, fullNameAr: String(body.fullNameAr), contactPhoneE164: String(body.contactPhoneE164), ...(role === "field" ? { serviceCityId: String(body.serviceCityId) } : {}), state: "pending_review", version: 1 };
    } else if (action === "update-profile" && profile) {
      profile = { ...profile, fullNameAr: String(body.fullNameAr), state: "pending_review", version: profile.version + 1 };
    } else if (action === "approve" && profile) {
      profile = { ...profile, state: "pending_identity", version: profile.version + 1 };
    } else if (action === "provision" && profile) {
      profile = { ...profile, actorId: actorID, state: "eligible", version: profile.version + 1 };
    } else {
      await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: { code: "INVALID_INPUT" } }) });
      return;
    }
    await route.fulfill({ status: action === "admit" ? 201 : 200, contentType: "application/json", body: JSON.stringify({ admission: profile, idempotentReplay: false }) });
  });

  await page.goto(`/${surface}`);
  await expect(page.getByRole("heading", { name: role === "captain" ? "ملف كابتن جديد" : "إدارة الميدانيين" })).toBeVisible();
  if (role === "field") await page.getByText("إنشاء ملف ميداني").click();
  await page.locator(`#${role}-candidate-name`).fill(initialName);
  await page.locator(`#${role}-candidate-phone`).fill(phone);
  if (role === "field") await page.locator("#field-candidate-city").selectOption("sanaa");
  await page.getByRole("button", { name: role === "captain" ? "حفظ الملف للمراجعة" : "حفظ للمراجعة" }).click();
  await expect(page.getByText(role === "captain" ? "أُنشئ ملف الكابتن بانتظار المراجعة. لم يُمنح دور التطبيق بعد." : "أُنشئ الملف وظهر في سجل الميدانيين بانتظار المراجعة.")).toBeVisible();
  if (role === "field" && !(await page.locator(candidateNameSelector).isVisible())) await page.getByText("الخطوة التالية", { exact: true }).click();
  await expect(page.locator(candidateNameSelector)).toHaveValue(initialName);

  if (role === "field" && !(await page.getByRole("button", { name: "اعتماد الملف", exact: true }).isVisible())) await page.getByText("الخطوة التالية", { exact: true }).click();
  await page.locator(candidateNameSelector).fill(reviewedName);
  await page.getByRole("button", { name: role === "field" ? "حفظ الاسم" : "حفظ الملف", exact: true }).click();
  if (role === "field" && !(await page.locator(candidateNameSelector).isVisible())) await page.getByText("الخطوة التالية", { exact: true }).click();
  await expect(page.locator(candidateNameSelector)).toHaveValue(reviewedName);
  await page.getByRole("button", { name: "اعتماد الملف", exact: true }).click();
  if (role === "field") {
    await expect(page.getByText("اعتُمد الملف وأُعيدت قراءته؛ أصبح منح الدور خطوته التالية.")).toBeVisible();
    if (!(await page.getByRole("button", { name: "منح دور الميداني" }).isVisible())) await page.getByText("الخطوة التالية", { exact: true }).click();
  } else {
    await page.locator(`#${role}-candidate-state`).selectOption("pending_identity");
    await expect(page.locator(`#${role}-candidate-name-${admissionID}`)).toHaveValue(reviewedName);
  }
  await page.getByRole("button", { name: `منح دور ${role === "captain" ? "الكابتن" : "الميداني"}` }).click();
  if (role === "captain") await page.locator(`#${role}-candidate-state`).selectOption("eligible");
  await expect(page.getByText(role === "captain" ? "اكتمل منح الدور؛ ينتظر تفعيل الحساب من الكابتن." : "مُنح دور الدخول وربط بأهلية DSH. الخطوة التالية للميداني: يفتح التطبيق، ويدخل رقم الهاتف المسجل، ثم يختار تفعيل الجهاز لإثبات الهاتف وإنشاء كلمة المرور.")).toBeVisible();
  await expect(page.getByText(actorID)).toHaveCount(0);
  expect(mutations).toEqual([
    role === "field" ? { action: "admit", fullNameAr: initialName, contactPhoneE164: phone, serviceCityId: "sanaa" } : { action: "admit", fullNameAr: initialName, contactPhoneE164: phone },
    { action: "update-profile", admissionId: admissionID, fullNameAr: reviewedName, expectedVersion: 1 },
    { action: "approve", admissionId: admissionID, expectedVersion: 2 },
    { action: "provision", admissionId: admissionID },
  ]);
}

async function exerciseLegacyDshProfileReview(page: Page, role: "captain" | "field") {
  const surface = role === "captain" ? "captains" : "fields";
  const admissionID = `${role === "captain" ? "cap" : "fld"}_adm_legacy_review`;
  const profile: { id: string; actorId: string; fullNameAr: string | null; contactPhoneE164: string | null; state: string; requiresProfileReview: boolean; version: number; availabilityState?: string } = {
    id: admissionID,
    actorId: `act_${role}_legacy_review`,
    fullNameAr: null,
    contactPhoneE164: null,
    state: "suspended",
    requiresProfileReview: true,
    version: 9,
    ...(role === "captain" ? { availabilityState: "unavailable" } : {}),
  };
  const mutations: Record<string, unknown>[] = [];
  await page.route(`**/api/${surface}**`, async (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      const params = new URL(request.url()).searchParams;
      if (role === "field" && params.get("scope") === "workbench") {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [{ kind: "account", account: { actorId: profile.actorId, phoneE164: "+96777000998", role: "field", enabled: false, activatedAt: "2026-09-20T08:00:00.000Z", securityEnabled: true, actorVersion: 4, roleVersion: 2, admission: profile } }] }) });
        return;
      }
      if (params.get("scope") !== "candidates") {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [], limit: 25, nextCursor: "" }) });
        return;
      }
      const state = params.get("state") ?? "review_required";
      const visible = state === "all" || state === profile.state || (state === "review_required" && profile.requiresProfileReview) ? [profile] : [];
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: visible, limit: 25, nextCursor: "" }) });
      return;
    }

    const body = request.postDataJSON() as Record<string, unknown>;
    mutations.push(body);
    if (body.action === "update-profile") {
      profile.fullNameAr = String(body.fullNameAr);
      profile.version += 1;
    } else if (body.action === "review-profile") {
      profile.requiresProfileReview = false;
      profile.version += 1;
    } else {
      await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: { code: "INVALID_INPUT" } }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ admission: profile, idempotentReplay: false }) });
  });

  await page.goto(`/${surface}`);
  await expect(page.getByRole("heading", { name: role === "captain" ? "ملفات الكباتن قبل منح الدور" : "إدارة الميدانيين" })).toBeVisible();
  await expect(page.getByText(role === "captain" ? "موقوف حتى استكمال الملف ومراجعته" : "الملف يحتاج استكمالًا ومراجعة")).toBeVisible();
  const name = "سامي ناصر محمد العريقي";
  if (role === "field") {
    if (!(await page.getByRole("button", { name: "اعتماد مراجعة الملف" }).isVisible())) await page.getByText("الخطوة التالية", { exact: true }).click();
    await page.locator(`#field-profile-name-act_field_legacy_review`).fill(name);
    await page.getByRole("button", { name: "حفظ الاسم" }).click();
    if (!(await page.getByRole("button", { name: "اعتماد مراجعة الملف" }).isVisible())) await page.getByText("الخطوة التالية", { exact: true }).click();
    await expect(page.locator("#field-profile-name-act_field_legacy_review")).toHaveValue(name);
    await page.getByRole("button", { name: "اعتماد مراجعة الملف" }).click();
    await expect(page.getByRole("status")).toContainText("اعتُمدت مراجعة الملف وأُعيدت قراءة حالته.");
  } else {
    await page.locator(`#${role}-candidate-name-${admissionID}`).fill(name);
    await page.getByRole("button", { name: "حفظ الملف", exact: true }).click();
    await expect(page.locator(`#${role}-candidate-name-${admissionID}`)).toHaveValue(name);
    await page.getByRole("button", { name: "اعتماد الملف بعد المراجعة" }).click();
    await expect(page.getByRole("status")).toContainText("يبقى الدور موقوفًا حتى إعادة التفعيل");
    await page.locator(`#${role}-candidate-state`).selectOption("suspended");
    await expect(page.locator(`#${role}-candidate-name-${admissionID}`)).toHaveValue(name);
    await expect(page.getByText("موقوف حتى استكمال الملف ومراجعته")).toHaveCount(0);
  }
  expect(mutations).toEqual(role === "field" ? [
    { action: "update-profile", actorId: profile.actorId, admissionId: admissionID, reason: "", fullNameAr: name, expectedVersion: 9 },
    { action: "review-profile", actorId: profile.actorId, admissionId: admissionID, reason: "", fullNameAr: name, expectedVersion: 10 },
  ] : [
    { action: "update-profile", admissionId: admissionID, fullNameAr: name, expectedVersion: 9 },
    { action: "review-profile", admissionId: admissionID, expectedVersion: 10 },
  ]);
}

test("signed-out access to a protected workspace route returns to the identity surface", async ({ page }) => {
  await stubSession(page, 401);
  await page.goto("/workspace");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "الدخول بمفتاح المرور" })).toBeVisible();
});

test("authenticated operator discovers the platform centers through workspace navigation", async ({ page }) => {
  await stubAuthenticatedSession(page, [...authenticatedOperator.permissions, "operations", "partners", "catalog"], true);
  await page.route("**/api/access/operator-profiles**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [], limit: 25, nextCursor: "" }) });
  });
  await page.route("**/api/access/operators**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [], limit: 10, nextCursor: "" }) });
  });
  let homeRequestsActionableOrders = false;
  let homeRequestsCatalogQueue = false;
  await page.route("**/api/operations**", async (route) => {
    homeRequestsActionableOrders = new URL(route.request().url()).searchParams.get("actionableOnly") === "true";
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ operations: [] }) });
  });
  await page.route("**/api/partners/joining-cases**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ cases: [] }) });
  });
  await page.route("**/api/catalog/proposals**", async (route) => {
    homeRequestsCatalogQueue = new URL(route.request().url()).searchParams.get("state") === "submitted";
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ proposals: [{ id: "proposal-home", partnerActorId: "partner-home", verticalId: "grocery", categoryId: "coffee", proposedName: "قهوة للمراجعة", proposedVariantTitle: "الافتراضي", proposedMeasurementKind: "DISCRETE", proposedBaseUnit: "COUNT", state: "submitted", version: 1, createdAt: "2026-09-18T00:00:00.000Z", updatedAt: "2026-09-18T00:00:00.000Z" }] }) });
  });
  await page.route("**/api/notifications**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ notifications: [], unreadCount: 0 }) });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await expect(page).toHaveURL(/\/workspace$/);
  await expect(page.getByRole("heading", { name: "الرئيسية" })).toBeVisible();
  await expect.poll(() => homeRequestsActionableOrders).toBe(true);
  await expect.poll(() => homeRequestsCatalogQueue).toBe(true);
  await expect(page.getByRole("heading", { name: "مقترحات منتجات للمراجعة" })).toBeVisible();
  await expect(page.getByRole("link", { name: /قهوة للمراجعة/ })).toHaveAttribute("href", "/catalog/proposals?proposalId=proposal-home");
  await expect(page.getByRole("heading", { name: "إشعارات غير مقروءة" })).toBeVisible();
  const navigationToggle = page.getByRole("button", { name: "فتح مسارات العمل" });
  await navigationToggle.click();
  await expect(page.getByRole("navigation", { name: "تنقل مساحة المشغل" })).toHaveAttribute("data-open", "true");
  const accessLink = page.getByRole("link", { name: "الوصول والصلاحيات" });
  await expect(accessLink).toBeVisible();
  await accessLink.click();
  await expect(page).toHaveURL(/\/access$/);
  await expect(page.locator('#workspace-navigation a[href="/access"][aria-current="page"]')).toHaveAttribute("href", "/access");
  await expect(page.getByRole("heading", { name: "ملفات المشغّلين والوصول والصلاحيات" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "إنشاء ملف مشغّل" })).toBeVisible();
  await expect(page.getByLabel("اسم العرض الكامل بالعربية")).toBeVisible();
  await expect(page.locator("#workspace-main")).toBeFocused();
  await page.getByRole("button", { name: "الوصول والصلاحيات", exact: true }).click();
  await expect(page.getByRole("heading", { name: "قائمة المشغّلين وصلاحياتهم" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "إدارة حسابات مشغّلي لوحة التحكم" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("button", { name: "الوصول والصلاحيات", exact: true })).toBeFocused();

  await page.reload();
  await expect(page.getByRole("heading", { name: "ملفات المشغّلين والوصول والصلاحيات" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "إنشاء ملف مشغّل" })).toBeVisible();
});

test("operator without operator-administration authority cannot open access or profile controls", async ({ page }) => {
  await stubAuthenticatedSession(page);
  await page.goto("/access");

  await expect(page.getByRole("status")).toContainText("الوصول إلى هذه المساحة غير مفعّل");
  await expect(page.getByRole("heading", { name: "ملفات المشغّلين والوصول والصلاحيات" })).toHaveCount(0);
  await expect(page.getByLabel("اسم العرض الكامل بالعربية")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "قائمة المشغّلين وصلاحياتهم" })).toHaveCount(0);
});

test("operator home reads only work queues covered by the current session permissions", async ({ page }) => {
  await stubAuthenticatedSession(page, ["finance"]);
  const deniedQueueRequests = new Set<string>();
  for (const endpoint of ["operations", "partners/joining-cases", "catalog/proposals"]) {
    await page.route(`**/api/${endpoint}**`, async (route) => {
      deniedQueueRequests.add(endpoint);
      await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: { code: "FORBIDDEN", message: "forbidden" } }) });
    });
  }
  await page.route("**/api/notifications**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ notifications: [], unreadCount: 0 }) });
  });

  await page.goto("/workspace");
  await expect(page.getByRole("heading", { name: "الرئيسية" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "إشعارات غير مقروءة" })).toBeVisible();
  expect([...deniedQueueRequests]).toEqual([]);
  await expect(page.getByRole("heading", { name: "طلبات تحتاج إجراءً" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "طلبات الانضمام المقدمة" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "مقترحات منتجات للمراجعة" })).toHaveCount(0);
});

test("authenticated operator can open the notification center from the workspace header", async ({ page }) => {
  await stubAuthenticatedSession(page);
  await page.route("**/api/notifications**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ notifications: [], unreadCount: 0 }) });
  });
  await page.goto("/workspace");

  const notificationLink = page.getByRole("link", { name: "الإشعارات", exact: true }).first();
  await expect(notificationLink).toBeVisible();
  await notificationLink.click();
  await expect(page).toHaveURL(/\/notifications$/);
  await expect(page.getByRole("heading", { name: "الإشعارات", exact: true })).toBeVisible();
  await expect(page.getByText("لا توجد إشعارات حالياً", { exact: true })).toBeVisible();
  await expect(notificationLink).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("navigation", { name: "تنقل مساحة المشغل" }).getByRole("link", { name: "الإشعارات", exact: true })).toHaveCount(0);
});

test("operator notification cards write back read state and update the unread summary", async ({ page }) => {
  await stubAuthenticatedSession(page);
  let read = false;
  await page.route("**/api/notifications**", async (route) => {
    if (route.request().method() === "POST") {
      read = true;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ notificationId: "order:1", readAt: "2026-09-22T11:00:00.000Z" }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ notifications: [{ id: "order:1", kind: "ORDER_CREATED", title: "وصل طلب جديد", body: "وصل طلب جديد إلى متجرك.", orderId: "order_1", createdAt: "2026-09-22T10:00:00.000Z", readAt: read ? "2026-09-22T11:00:00.000Z" : null }], unreadCount: read ? 0 : 1 }) });
  });
  await page.goto("/notifications");

  await expect(page.getByRole("button", { name: "وصل طلب جديد، جديد" })).toBeVisible();
  await page.getByRole("button", { name: "وصل طلب جديد، جديد" }).click();
  await expect(page.getByRole("button", { name: "وصل طلب جديد، مقروء" })).toBeVisible();
  await expect(page.getByText("0 إشعارات غير مقروءة", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "المقروءة", exact: true })).toBeVisible();
});

test("workspace routes keep one main landmark and an actor-specific page hierarchy", async ({ page }) => {
  test.setTimeout(120_000);
  await stubAuthenticatedSession(page, [...authenticatedOperator.permissions, "operations", "partners", "catalog"], true);
  const routes = [
    ["/workspace", "الرئيسية"],
    ["/notifications", "الإشعارات"],
    ["/access", "ملفات المشغّلين والوصول والصلاحيات"],
    ["/partners", "الشركاء"],
    ["/operations", "العمليات"],
    ["/finance", "المالية"],
    ["/captains", "قبول الكباتن"],
    ["/fields", "قبول الميدان"],
    ["/catalog", "المنتجات"],
    ["/policies", "مركز السياسات"],
  ] as const;

  for (const [path, heading] of routes) {
    await page.goto(path, { waitUntil: "commit" });
    await expect(page.locator("#workspace-main")).toHaveCount(1, { timeout: 30_000 });
    await expect(page.locator("#workspace-main > main")).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: heading, exact: true, level: 1 })).toBeVisible({ timeout: 30_000 });
    if (path !== "/notifications") {
      const navigation = page.getByRole("navigation", { name: "تنقل مساحة المشغل" });
      if (path === "/captains" || path === "/fields") {
        const owner = path === "/captains" ? "العمليات" : "الشركاء";
        const tab = path === "/captains" ? "الكباتن" : "الميدان";
        await expect(navigation.getByRole("link", { name: owner, exact: true })).toHaveAttribute("aria-current", "location", { timeout: 30_000 });
        await expect(page.getByRole("navigation", { name: `مسارات ${owner}` }).getByRole("link", { name: tab, exact: true })).toHaveAttribute("aria-current", "page", { timeout: 30_000 });
      } else {
        const navigationLabel = heading === "الرئيسية" ? "الرئيسية" : path === "/access" ? "الوصول والصلاحيات" : path === "/partners" ? "الشركاء" : path === "/operations" ? "العمليات" : path === "/finance" ? "المالية" : path === "/policies" ? "السياسات" : "الكتالوج";
        const currentState = path === "/catalog" ? "location" : "page";
        await expect(navigation.getByRole("link", { name: navigationLabel, exact: true })).toHaveAttribute("aria-current", currentState, { timeout: 30_000 });
      }
    }
  }
});

test("workspace navigation keeps captain operations and field partners in their owning centers", async ({ page }) => {
  await stubAuthenticatedSession(page, [...authenticatedOperator.permissions, "operations", "partners"]);
  const navigation = page.getByRole("navigation", { name: "تنقل مساحة المشغل" });

  await page.goto("/operations");
  const operationsTabs = page.getByRole("navigation", { name: "مسارات العمليات" });
  await expect(navigation.getByRole("link", { name: "العمليات", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(operationsTabs.getByRole("link", { name: "العمليات", exact: true })).toHaveCount(0);
  await expect(navigation.getByRole("link", { name: "الكباتن", exact: true })).toHaveCount(0);
  await expect(operationsTabs.getByRole("link", { name: "الكباتن", exact: true })).toHaveAttribute("href", "/captains");

  await page.goto("/captains");
  await expect(navigation.getByRole("link", { name: "العمليات", exact: true })).toHaveAttribute("aria-current", "location");
  await expect(navigation.getByRole("link", { name: "الكباتن", exact: true })).toHaveCount(0);
  await expect(operationsTabs.getByRole("link", { name: "الكباتن", exact: true })).toHaveAttribute("aria-current", "page");

  await page.goto("/fields");
  await expect(navigation.getByRole("link", { name: "الشركاء", exact: true })).toHaveAttribute("aria-current", "location");
  const partnerTabs = page.getByRole("navigation", { name: "مسارات الشركاء" });
  await expect(partnerTabs.getByRole("link", { name: "الميدان", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(navigation.getByRole("link", { name: "الميدان", exact: true })).toHaveCount(0);
  await expect(navigation.getByRole("link", { name: "الشركاء", exact: true })).toHaveCount(1);
});

test("partner registry, joining queue, and stores are separate workspace destinations", async ({ page }) => {
  await stubAuthenticatedSession(page, [...authenticatedOperator.permissions, "partners"]);
  const navigation = page.getByRole("navigation", { name: "تنقل مساحة المشغل" });

  await page.goto("/partners");
  await expect(page.getByRole("heading", { name: "الشركاء", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "سجل الشركاء التشغيلي" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "طابور حالات انضمام الشركاء" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "إضافة شريك", exact: true })).toHaveAttribute("href", "/partners/new");
  const partnerTabs = page.getByRole("navigation", { name: "مسارات الشركاء" });
  await expect(partnerTabs.getByRole("link", { name: "طلبات الانضمام", exact: true })).toHaveAttribute("href", "/partners/joining");
  await expect(partnerTabs.getByRole("link", { name: "المتاجر", exact: true })).toHaveAttribute("href", "/partners/stores");
  await expect(navigation.getByRole("link", { name: "طلبات الانضمام", exact: true })).toHaveCount(0);
  await expect(navigation.getByRole("link", { name: "المتاجر", exact: true })).toHaveCount(0);
  await expect(navigation.getByRole("link", { name: "إضافة شريك", exact: true })).toHaveCount(0);

  await page.goto("/partners/joining");
  await expect(page.getByRole("heading", { name: "طلبات انضمام الشركاء", exact: true })).toBeVisible();
  await expect(partnerTabs.getByRole("link", { name: "طلبات الانضمام", exact: true })).toHaveAttribute("aria-current", "page");

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "قبول إحالات الميدانيين", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "فتح الشركاء" }).first()).toHaveAttribute("href", "/partners/joining?state=admission_requested");
  await expect(page.getByRole("link", { name: "فتح الشركاء" }).nth(1)).toHaveAttribute("href", "/partners/joining?state=submitted");
});

test("finance and marketing centers expose only real independent resource routes", async ({ page }) => {
  await stubAuthenticatedSession(page, [...authenticatedOperator.permissions, "marketing"]);
  const navigation = page.getByRole("navigation", { name: "تنقل مساحة المشغل" });

  await page.goto("/finance");
  await expect(page.getByRole("heading", { name: "المالية", exact: true })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "حفظ النقد", exact: true })).toHaveAttribute("href", "/finance/cash-custody");
  await expect(navigation.getByRole("link", { name: "عمولات المتاجر", exact: true })).toHaveAttribute("href", "/finance/partner-store-commissions");

  await page.goto("/finance/cash-custody");
  await expect(page.getByRole("heading", { name: "حفظ النقد", exact: true })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "المالية", exact: true })).toHaveAttribute("aria-current", "location");
  await expect(navigation.getByRole("link", { name: "حفظ النقد", exact: true })).toHaveAttribute("aria-current", "page");

  await page.goto("/marketing/promotions");
  await expect(page.getByRole("heading", { name: "العروض", exact: true })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "التسويق والمحتوى", exact: true })).toHaveAttribute("aria-current", "location");
  await expect(navigation.getByRole("link", { name: "محتوى الاكتشاف", exact: true })).toHaveAttribute("href", "/marketing/content");
});

test("marketing resource pages keep promotions and discovery content separate", async ({ page }) => {
  const contentUploadKeys: string[] = [];
  const contentUploadCorrelations: string[] = [];
  const contentUploadBodies: string[] = [];
  let createdContent: (Record<string, unknown> & { id: string }) | null = null;
  await stubAuthenticatedSession(page, [...authenticatedOperator.permissions, "marketing"]);
  await page.route("**/api/marketing/promotions**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ promotions: [{ id: "promotion-1", code: "WELCOME10", nameAr: "خصم البداية", kind: "PERCENTAGE", valueMinor: 10, state: "DRAFT", version: 1 }] }) });
  });
  await page.route("**/api/marketing/content**", async (route) => {
    if (route.request().method() === "POST") {
      contentUploadKeys.push(route.request().headers()["idempotency-key"] ?? "");
      contentUploadCorrelations.push(route.request().headers()["x-correlation-id"] ?? "");
      contentUploadBodies.push(route.request().postDataBuffer()?.toString("latin1") ?? "");
      if (contentUploadKeys.length === 1) {
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { message: "تعذر تأكيد الحفظ؛ أعد المحاولة." } }) });
        return;
      }
      const raw = route.request().postDataBuffer()?.toString("latin1") ?? "";
      const id = raw.match(/name="id"\r\n\r\n([^\r\n]+)/)?.[1] ?? "";
      createdContent = { id, kind: "BANNER", titleAr: "مختارات الاختبار", bodyAr: "", mediaUri: "http://localhost/content.png", targetType: "INFO", state: "DRAFT", startsAt: "2099-01-01T00:00:00Z", ordinal: 0, version: 1, createdByActorId: "actor-operator", createdAt: "2098-01-01T00:00:00Z", updatedAt: "2098-01-01T00:00:00Z" };
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ content: createdContent, idempotentReplay: false }) });
      return;
    }
    const search = new URL(route.request().url()).searchParams.get("search");
    const items = search && createdContent?.id === search ? [createdContent] : [{ id: "content-1", kind: "BANNER", titleAr: "مختارات الأسبوع", bodyAr: "اكتشف الجديد", state: "DRAFT", version: 1 }];
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items }) });
  });
  await page.route("**/api/marketing/analytics**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [] }) });
  });
  await page.route("**/api/service-cities**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ cities: [{ id: "city-sanaa", displayNameAr: "صنعاء", active: true, version: 1 }] }) });
  });

  await page.goto("/marketing/promotions");
  await expect(page.getByTestId("marketing-promotions-workspace")).toBeVisible();
  await expect(page.getByText("خصم البداية")).toBeVisible();
  await expect(page.getByTestId("marketing-content-workspace")).toHaveCount(0);

  await page.goto("/marketing/content");
  await expect(page.getByTestId("marketing-content-workspace")).toBeVisible();
  await expect(page.getByText("مختارات الأسبوع")).toBeVisible();
  await page.getByText("إنشاء محتوى اكتشاف", { exact: true }).click();
  await expect(page.getByLabel("ملف صورة المحتوى")).toHaveAttribute("required", "");
  await expect(page.getByLabel("اسم المنشئ أو المصوّر")).toBeVisible();
  await expect(page.getByLabel("بيان الإذن أو الترخيص")).toBeVisible();
  await expect(page.getByLabel("أقرّ بوجود إذن يسمح بعرض هذه الصورة")).toBeVisible();
  await expect(page.getByLabel("نوع وجهة المحتوى")).toHaveValue("INFO");
  await expect(page.getByLabel("مدينة خدمة المحتوى")).toContainText("صنعاء");
  await expect(page.getByTestId("marketing-promotions-workspace")).toHaveCount(0);
  await page.getByLabel("عنوان المحتوى").fill("مختارات الاختبار");
  await page.getByLabel("ملف صورة المحتوى").setInputFiles({ name: "content.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64") });
  await page.getByLabel("اسم المنشئ أو المصوّر").fill("Photo Studio");
  await page.getByLabel("مصدر الصورة").fill("Photo Studio original artwork");
  await page.getByLabel("بيان الإذن أو الترخيص").fill("Permission granted for platform display");
  await page.getByLabel("أقرّ بوجود إذن يسمح بعرض هذه الصورة").check();
  await page.getByRole("button", { name: "إنشاء مسودة المحتوى" }).click();
  await expect(page.getByText("تعذر تأكيد الحفظ؛ أعد المحاولة.")).toBeVisible();
  await page.getByRole("button", { name: "التحقق / إعادة محاولة الإنشاء" }).click();
  await expect(page.getByText("تم إنشاء المحتوى وقراءته كمسودة من سجل DSH. انشره من السجل عندما يصبح جاهزًا.")).toBeVisible();
  expect(contentUploadKeys).toHaveLength(2);
  expect(contentUploadKeys[1]).toBe(contentUploadKeys[0]);
  expect(contentUploadCorrelations[1]).toBe(contentUploadCorrelations[0]);
  const contentID = (contentUploadBodies[0] ?? "").match(/name="id"\r\n\r\n([^\r\n]+)/)?.[1] ?? "";
  expect(contentUploadBodies[1]).toContain(contentID);
  expect(contentUploadBodies[1]).toContain('name="id"');
  expect(contentUploadBodies[1]).toContain("Photo Studio");
  expect(contentUploadBodies[1]).toContain('name="rightsAttested"');
  expect(contentUploadBodies[1]).toContain("true");
});

test("marketing create recovery reconciles promotions and resumes content with the same image after reload", async ({ page }) => {
  let promotionPostCount = 0;
  let promotionId = "";
  const promotionIdempotencyKeys: string[] = [];
  let contentPostCount = 0;
  let contentId = "";
  let createdContent: (Record<string, unknown> & { id: string }) | null = null;
  const contentIdempotencyKeys: string[] = [];
  const contentCorrelations: string[] = [];
  const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  await stubAuthenticatedSession(page, [...authenticatedOperator.permissions, "marketing"]);
  await page.route("**/api/marketing/promotions**", async (route) => {
    if (route.request().method() === "POST") {
      promotionPostCount += 1;
      const body = route.request().postDataJSON() as { id: string; startsAt: string };
      promotionId = body.id;
      promotionIdempotencyKeys.push(route.request().headers()["idempotency-key"] ?? "");
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { message: "تعذر تأكيد الحفظ؛ أعد المحاولة." } }) });
      return;
    }
    const search = new URL(route.request().url()).searchParams.get("search");
    const promotions = search === promotionId && promotionId
      ? [{ id: promotionId, code: "RESTORE10", nameAr: "عرض الاستعادة", descriptionAr: "", kind: "PERCENTAGE", valueMinor: 10, fundingSource: "MERCHANT", state: "DRAFT", startsAt: "2099-01-01T00:00:00Z", redeemedCount: 0, version: 1, createdByActorId: "actor-operator", createdAt: "2098-01-01T00:00:00Z", updatedAt: "2098-01-01T00:00:00Z" }]
      : [];
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ promotions }) });
  });
  await page.route("**/api/marketing/content**", async (route) => {
    if (route.request().method() === "POST") {
      contentPostCount += 1;
      contentIdempotencyKeys.push(route.request().headers()["idempotency-key"] ?? "");
      contentCorrelations.push(route.request().headers()["x-correlation-id"] ?? "");
      const raw = route.request().postDataBuffer()?.toString("latin1") ?? "";
      contentId = raw.match(/name="id"\r\n\r\n([^\r\n]+)/)?.[1] ?? "";
      if (contentPostCount === 1) {
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { message: "تعذر تأكيد الحفظ؛ أعد المحاولة." } }) });
        return;
      }
      createdContent = { id: contentId, kind: "BANNER", titleAr: "محتوى الاستعادة", bodyAr: "", mediaUri: "http://localhost/content.png", targetType: "INFO", state: "DRAFT", startsAt: "2099-01-01T00:00:00Z", ordinal: 0, version: 1, createdByActorId: "actor-operator", createdAt: "2098-01-01T00:00:00Z", updatedAt: "2098-01-01T00:00:00Z" };
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ content: createdContent, idempotentReplay: false }) });
      return;
    }
    const search = new URL(route.request().url()).searchParams.get("search");
    const items = search && createdContent?.id === search ? [createdContent] : [];
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items }) });
  });
  await page.route("**/api/service-cities**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ cities: [{ id: "city-sanaa", displayNameAr: "صنعاء", active: true, version: 1 }] }) });
  });

  await page.goto("/marketing/promotions");
  await page.getByText("إنشاء عرض جديد", { exact: true }).click();
  await page.getByLabel("رمز العرض", { exact: true }).fill("RESTORE10");
  await page.getByLabel("اسم العرض").fill("عرض الاستعادة");
  await page.getByRole("button", { name: "إنشاء مسودة العرض" }).click();
  await expect(page.getByText("تعذر تأكيد الحفظ؛ أعد المحاولة.")).toBeVisible();
  expect(promotionPostCount).toBe(1);
  await page.reload();
  await expect(page.getByText("تمت قراءة العرض المنشأ من سجل DSH؛ استعيدت نتيجته دون إنشاء نسخة أخرى.")).toBeVisible();
  expect(promotionPostCount).toBe(1);
  expect(await page.evaluate(() => window.sessionStorage.getItem("bthwani.control.marketing.promotion-create.v1.actor-operator"))).toBeNull();
  expect(promotionIdempotencyKeys).toHaveLength(1);

  await page.goto("/marketing/content");
  await page.getByText("إنشاء محتوى اكتشاف", { exact: true }).click();
  await page.getByLabel("عنوان المحتوى").fill("محتوى الاستعادة");
  await page.getByLabel("ملف صورة المحتوى").setInputFiles({ name: "content.png", mimeType: "image/png", buffer: image });
  await page.getByLabel("اسم المنشئ أو المصوّر").fill("Photo Studio");
  await page.getByLabel("مصدر الصورة").fill("Photo Studio original artwork");
  await page.getByLabel("بيان الإذن أو الترخيص").fill("Permission granted for platform display");
  await page.getByLabel("أقرّ بوجود إذن يسمح بعرض هذه الصورة").check();
  await page.getByRole("button", { name: "إنشاء مسودة المحتوى" }).click();
  await expect(page.getByText("تعذر تأكيد الحفظ؛ أعد المحاولة.")).toBeVisible();
  expect(contentPostCount).toBe(1);
  await page.reload();
  await expect(page.getByText(/لم يظهر المحتوى في السجل بعد/)).toBeVisible();
  await expect(page.getByLabel("عنوان المحتوى")).toHaveValue("محتوى الاستعادة");
  await page.getByLabel("ملف صورة المحتوى").setInputFiles({ name: "content.png", mimeType: "image/png", buffer: image });
  await page.getByRole("button", { name: "التحقق / إعادة محاولة الإنشاء" }).click();
  await expect(page.getByText("تم إنشاء المحتوى وقراءته كمسودة من سجل DSH. انشره من السجل عندما يصبح جاهزًا.")).toBeVisible();
  expect(contentPostCount).toBe(2);
  expect(contentIdempotencyKeys).toHaveLength(2);
  expect(contentIdempotencyKeys[1]).toBe(contentIdempotencyKeys[0]);
  expect(contentCorrelations[1]).toBe(contentCorrelations[0]);
  expect(await page.evaluate(() => window.sessionStorage.getItem("bthwani.control.marketing.content-create.v1.actor-operator"))).toBeNull();
});

test("workspace shell exposes nested breadcrumbs and the current resource", async ({ page }) => {
  await stubAuthenticatedSession(page);
  await page.goto("/catalog/products");
  const breadcrumbs = page.getByRole("navigation", { name: "مسار الصفحة" });
  await expect(breadcrumbs.getByRole("link", { name: "الكتالوج", exact: true })).toHaveAttribute("href", "/catalog");
  await expect(breadcrumbs.locator('[aria-current="page"]')).toContainText("المنتجات");

  await page.goto("/policies/service-cities");
  await expect(page.getByRole("navigation", { name: "مسار الصفحة" }).locator('[aria-current="page"]')).toContainText("مدن الخدمة");
});

test("mobile workspace navigation restores focus and account menu owns appearance controls", async ({ page }) => {
  await stubAuthenticatedSession(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/workspace");

  const navigationToggle = page.getByRole("button", { name: "فتح مسارات العمل" });
  await navigationToggle.click();
  await page.keyboard.press("Escape");
  await expect(navigationToggle).toHaveAttribute("aria-expanded", "false");
  await expect(navigationToggle).toBeFocused();

  const accountMenu = page.locator("details.account-menu");
  await expect(accountMenu).not.toHaveAttribute("open", "");
  await accountMenu.locator("summary").click();
  await expect(accountMenu).toHaveAttribute("open", "");
  const operatorProfile = accountMenu.getByRole("region", { name: "ملف المشغّل" });
  await expect(operatorProfile).toBeVisible();
  await expect(operatorProfile).toContainText("مشغّل المنصة");
  await expect(operatorProfile).toContainText("جلسة نشطة");
  await expect(operatorProfile).toContainText("المالية");
  await expect(operatorProfile).toContainText("انتهاء الجلسة");
  await page.getByLabel("داكن").check();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("operator direct navigation to access exposes the canonical access capability", async ({ page }) => {
  await stubAuthenticatedSession(page, authenticatedOperator.permissions, true);
  await page.route("**/api/access/operator-profiles**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [], limit: 25, nextCursor: "" }) });
  });
  await page.route("**/api/access/operators**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [], limit: 10, nextCursor: "" }) });
  });
  await page.goto("/access");
  await expect(page.getByRole("heading", { name: "ملفات المشغّلين والوصول والصلاحيات" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "إنشاء ملف مشغّل" })).toBeVisible();
  await page.getByRole("button", { name: "الوصول والصلاحيات", exact: true }).click();
  await expect(page.getByRole("heading", { name: "قائمة المشغّلين وصلاحياتهم" })).toBeVisible();
});

test("operator profile is created, reviewed, admitted, and invited in separate steps", async ({ page }) => {
  await stubAuthenticatedSession(page, authenticatedOperator.permissions, true);
  const profileId = "oprof_browser_review";
  const actorId = "act_operator_browser_review";
  const phoneE164 = "+96777000123";
  const initialName = "محمود أحمد";
  const reviewedName = "محمود أحمد علي الدوبحي";
  const writes: Record<string, unknown>[] = [];
  let profile: { id: string; actorId?: string; fullNameAr: string; phoneE164: string; roleEnabled?: boolean; securityEnabled?: boolean; activatedAt?: string; state: string; version: number } | null = null;

  await page.route("**/api/access/operator-profiles**", async (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: profile ? [profile] : [], limit: 25, nextCursor: "" }) });
      return;
    }
    const body = request.postDataJSON() as Record<string, unknown>;
    writes.push(body);
    if (new URL(request.url()).pathname === "/api/access/operator-profiles") {
      profile = { id: profileId, fullNameAr: String(body.fullNameAr), phoneE164: String(body.phoneE164), state: "pending_review", version: 1 };
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ profile, idempotentReplay: false }) });
      return;
    }
    if (body.action === "update-profile" && profile) profile = { ...profile, fullNameAr: String(body.fullNameAr), state: "pending_review", version: profile.version + 1 };
    else if (body.action === "approve" && profile) profile = { ...profile, state: "approved", version: profile.version + 1 };
    else if (body.action === "grant" && profile) profile = { ...profile, actorId, roleEnabled: true, securityEnabled: true, state: "admitted", version: profile.version + 1 };
    else if (body.action === "invitation" && profile) {
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ profile, enrollmentToken: { code: "operator-enrollment-proof-code-123456", maskedPhone: "+967••••0123", role: "operator", expiresAt: "2099-01-01T00:00:00.000Z" } }) });
      return;
    } else {
      await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: { code: "INVALID_INPUT" } }) });
      return;
    }
    await route.fulfill({ status: body.action === "grant" ? 201 : 200, contentType: "application/json", body: JSON.stringify({ profile, role: { actorId, role: "operator", actorCreated: true, roleCreated: true }, idempotentReplay: false }) });
  });

  await page.goto("/access");
  await page.locator("#operator-profile-name").fill(initialName);
  await page.locator("#operator-profile-phone").fill(phoneE164);
  await page.getByRole("button", { name: "حفظ الملف للمراجعة" }).click();
  await expect(page.locator(`#operator-profile-name-${profileId}`)).toHaveValue(initialName);
  await expect(page.getByText("بانتظار مراجعة الملف")).toBeVisible();
  await page.locator(`#operator-profile-name-${profileId}`).fill(reviewedName);
  await page.getByRole("button", { name: "حفظ الملف", exact: true }).click();
  await page.getByRole("button", { name: "اعتماد الملف", exact: true }).click();
  await expect(page.getByText("اعتُمد الملف. لم يُمنح دور المشغّل بعد.")).toBeVisible();
  await page.getByRole("button", { name: "منح دور المشغّل", exact: true }).click();
  await expect(page.getByText("مُنح دور المشغّل بعد الاعتماد. إصدار الدعوة هو الخطوة التالية.")).toBeVisible();
  await page.getByRole("button", { name: "إصدار دعوة التفعيل", exact: true }).click();
  await expect(page.getByText("operator-enrollment-proof-code-123456", { exact: true })).toBeVisible();
  await expect(page.getByText("+967••••0123", { exact: true })).toBeVisible();
  expect(writes).toEqual([
    { fullNameAr: initialName, phoneE164 },
    { action: "update-profile", fullNameAr: reviewedName, phoneE164, expectedVersion: 1 },
    { action: "approve", expectedVersion: 2 },
    { action: "grant", expectedVersion: 3 },
    { action: "invitation" },
  ]);
});

test("operator access keeps phone discovery separate from actorId mutation", async ({ page }) => {
  await stubAuthenticatedSession(page, authenticatedOperator.permissions, true);
  let mutationBody: Record<string, unknown> | undefined;
  await page.route("**/api/access/operators**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [{ actorId: "act_operator_canonical", phoneE164: "+96777000102", role: "operator", enabled: true, activatedAt: "2026-09-20T08:00:00.000Z", securityEnabled: true, actorVersion: 7, roleVersion: 3, permissions: [] }] }),
    });
  });
  await page.route("**/api/access/managed-user/status**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        actorId: "act_operator_canonical",
        phoneE164: "+96777000102",
        role: "operator",
        exists: true,
        enabled: true,
        activated: true,
        securityEnabled: true,
        state: "active",
        actorVersion: 7,
        roleVersion: 3,
        operatorPermissions: Object.fromEntries(authenticatedOperator.permissions.map((permission) => [permission, { actorId: "act_operator_canonical", permission, enabled: true, version: 1, reason: "" }])),
      }),
    });
  });
  await page.route("**/api/access/account-control", async (route) => {
    mutationBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ status: 204 });
  });
  await page.goto("/access");
  await page.getByRole("button", { name: "الوصول والصلاحيات", exact: true }).click();
  await page.getByRole("button", { name: "إدارة الحساب" }).click();
  await expect(page.getByLabel("رقم هاتف المشغّل")).toHaveValue("+96777000102");
  await expect(page.getByText("act_operator_canonical")).toHaveCount(0);
  await page.getByLabel("سبب تغيير حالة الحساب").fill("مراجعة صلاحية الحساب");
  await page.getByRole("button", { name: "إيقاف المشغّل" }).click();
  expect(mutationBody).toMatchObject({ actorId: "act_operator_canonical", role: "operator", action: "disable-role", expectedVersion: 3 });
});

test("Field center reads DSH eligibility and routes operational controls to the role owner", async ({ page }) => {
  await stubAuthenticatedSession(page, authenticatedOperator.permissions, true);
  let mutationBody: Record<string, unknown> | undefined;
  let enabled = true;
  await page.route("**/api/fields**", async (route) => {
    if (route.request().method() === "POST") {
      mutationBody = route.request().postDataJSON() as Record<string, unknown>;
      enabled = false;
      await route.fulfill({ status: 204 });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [{ kind: "account", account: { actorId: "act_field_admitted", phoneE164: "+96777000103", role: "field", enabled, activatedAt: "2026-09-20T08:00:00.000Z", securityEnabled: true, actorVersion: 4, roleVersion: 2, admission: { id: "fld_adm_field_admitted", actorId: "act_field_admitted", state: "eligible", version: 4, createdAt: "2026-09-20T08:00:00.000Z", updatedAt: "2026-09-20T08:00:00.000Z" } } }] }) });
  });
  await page.goto("/fields");
  await expect(page.getByRole("heading", { name: "إدارة الميدانيين" })).toBeVisible();
  await page.getByText("الخطوة التالية", { exact: true }).click();
  await page.getByLabel("سبب الإجراء").fill("تجميد أهلية الميدان");
  await page.getByRole("button", { name: "إيقاف الوصول" }).click();
  expect(mutationBody).toMatchObject({ actorId: "act_field_admitted", action: "disable", expectedVersion: 2, reason: "تجميد أهلية الميدان" });
});

test("legacy Field role with a missing profile is suspended before Identity access is already disabled", async ({ page }) => {
  await stubAuthenticatedSession(page, authenticatedOperator.permissions, true);
  let admissionState = "eligible";
  let mutationBody: Record<string, unknown> | undefined;
  await page.route("**/api/fields**", async (route) => {
    if (route.request().method() === "POST") {
      mutationBody = route.request().postDataJSON() as Record<string, unknown>;
      admissionState = "suspended";
      await route.fulfill({ status: 204 });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [{ kind: "account", account: { actorId: "act_field_legacy", phoneE164: "+96777000108", role: "field", enabled: false, activatedAt: "2026-09-20T08:00:00.000Z", securityEnabled: true, actorVersion: 4, roleVersion: 2, admission: { id: "fld_adm_legacy", actorId: "act_field_legacy", fullNameAr: null, requiresProfileReview: true, state: admissionState, version: 10, createdAt: "2026-09-20T08:00:00.000Z", updatedAt: "2026-09-20T08:00:00.000Z" } } }] }) });
  });
  await page.goto("/fields");
  await expect(page.getByText("الملف يحتاج استكمالًا ومراجعة")).toBeVisible();
  await page.getByText("الخطوة التالية", { exact: true }).click();
  await page.getByLabel("سبب الإجراء").fill("إيقاف حتى مراجعة الملف");
  await page.getByRole("button", { name: "إيقاف الوصول" }).click();
  expect(mutationBody).toMatchObject({ actorId: "act_field_legacy", action: "disable", expectedVersion: 2, reason: "إيقاف حتى مراجعة الملف" });
  await expect(page.getByRole("status")).toContainText("أُوقف دور الدخول وأُعيدت قراءة حالة الحساب وأهلية DSH.");
});

test("legacy Captain profile review never offers role activation before review", async ({ page }) => {
  await stubAuthenticatedSession(page, authenticatedOperator.permissions, true);
  let admissionState = "eligible";
  let enabled = false;
  let mutationBody: Record<string, unknown> | undefined;
  await page.route("**/api/captains**", async (route) => {
    if (route.request().method() === "POST") {
      mutationBody = route.request().postDataJSON() as Record<string, unknown>;
      admissionState = "suspended";
      await route.fulfill({ status: 204 });
      return;
    }
    if (new URL(route.request().url()).searchParams.get("scope") === "candidates") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [], limit: 25, nextCursor: "" }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [{ actorId: "act_captain_legacy", phoneE164: "+96777000109", role: "captain", enabled, activatedAt: "2026-09-20T08:00:00.000Z", securityEnabled: true, actorVersion: 4, roleVersion: 2, admission: { id: "cap_adm_legacy", actorId: "act_captain_legacy", fullNameAr: null, requiresProfileReview: true, state: admissionState, availabilityState: "unavailable", version: 10, createdAt: "2026-09-20T08:00:00.000Z", updatedAt: "2026-09-20T08:00:00.000Z" } }] }) });
  });
  await page.goto("/captains");
  await expect(page.getByText("الملف يحتاج استكمالًا ومراجعة")).toBeVisible();
  await page.getByLabel("سبب الإجراء").fill("إيقاف حتى مراجعة الملف");
  await page.getByRole("button", { name: "إيقاف التشغيل" }).click();
  expect(mutationBody).toMatchObject({ actorId: "act_captain_legacy", action: "disable", expectedVersion: 2, reason: "إيقاف حتى مراجعة الملف" });
  enabled = false;
  await page.getByLabel("سبب الإجراء").fill("استكمال الملف قبل الإعادة");
  await expect(page.getByText("استكمل الملف واعتمده قبل إعادة التفعيل.")).toBeVisible();
  await expect(page.getByRole("button", { name: "إعادة التفعيل" })).toHaveCount(0);
});

test("Field reenrollment uses DSH eligibility and carries fresh actor, role, and admission versions", async ({ page }) => {
  await stubAuthenticatedSession(page, authenticatedOperator.permissions, true);
  let reenrolled = false;
  let reenrollmentBody: Record<string, unknown> | undefined;
  await page.route("**/api/fields**", async (route) => {
    if (route.request().method() === "POST") {
      reenrollmentBody = route.request().postDataJSON() as Record<string, unknown>;
      reenrolled = true;
      await route.fulfill({ status: 204 });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [{ kind: "account", account: { actorId: "act_field_reenroll", phoneE164: "+96777000105", role: "field", enabled: true, securityEnabled: true, activatedAt: reenrolled ? undefined : "2026-09-20T08:00:00.000Z", actorVersion: 4, roleVersion: reenrolled ? 3 : 2, admission: { id: "fld_adm_reenroll", actorId: "act_field_reenroll", state: "eligible", version: 8, createdAt: "2026-09-20T08:00:00.000Z", updatedAt: "2026-09-20T08:00:00.000Z" } } }] }) });
  });
  await page.goto("/fields");
  await page.getByText("الخطوة التالية", { exact: true }).click();
  await page.getByLabel("سبب الإجراء").fill("استرداد جهاز الميدان");
  await page.getByRole("button", { name: "إجازة إعادة التسجيل" }).click();
  await expect(page.locator("output.success-inline")).toContainText("أُجيزت إعادة تسجيل دور سبق تفعيله");
  await expect(page.getByText("الدور جاهز. الخطوة التالية للميداني: يفتح تطبيق الميدان", { exact: false })).toContainText("يختار «تفعيل الجهاز» لإثبات الهاتف وإنشاء كلمة المرور");
  expect(reenrollmentBody).toMatchObject({
    actorId: "act_field_reenroll",
    action: "reenroll",
    expectedActorVersion: 4,
    expectedRoleVersion: 2,
    expectedAdmissionVersion: 8,
    reason: "استرداد جهاز الميدان",
  });
  await expect(page.getByRole("button", { name: "إجازة إعادة التسجيل" })).toHaveCount(0);
});

test("Captain reenrollment goes through DSH eligibility and verifies the Identity readback", async ({ page }) => {
  await stubAuthenticatedSession(page, authenticatedOperator.permissions, true);
  let reauthorized = false;
  let reenrollmentBody: Record<string, unknown> | undefined;
  await page.route("**/api/captains**", async (route) => {
    if (route.request().method() === "POST") {
      reenrollmentBody = route.request().postDataJSON() as Record<string, unknown>;
      reauthorized = true;
      await route.fulfill({ status: 204 });
      return;
    }
    if (new URL(route.request().url()).searchParams.get("scope") === "candidates") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [], limit: 25, nextCursor: "" }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [{ actorId: "act_captain_reenroll", phoneE164: "+96777000111", role: "captain", enabled: true, securityEnabled: true, activatedAt: reauthorized ? null : "2026-09-20T08:00:00.000Z", actorVersion: 4, roleVersion: reauthorized ? 3 : 2, admission: { id: "cap_adm_reenroll", actorId: "act_captain_reenroll", state: "eligible", availabilityState: "unavailable", version: 8, createdAt: "2026-09-20T08:00:00.000Z", updatedAt: "2026-09-20T08:00:00.000Z" } }] }) });
  });
  await page.goto("/captains");
  await page.getByLabel("سبب الإجراء").fill("استعادة وصول الكابتن");
  await page.getByRole("button", { name: "إجازة إعادة التسجيل" }).click();
  await expect(page.getByRole("status")).toContainText("تمت إجازة إعادة تسجيل الكابتن بعد تحقق DSH");
  expect(reenrollmentBody).toMatchObject({
    actorId: "act_captain_reenroll",
    action: "reenroll",
    expectedActorVersion: 4,
    expectedRoleVersion: 2,
    expectedAdmissionVersion: 8,
    reason: "استعادة وصول الكابتن",
  });
  await expect(page.getByText("بانتظار التفعيل")).toBeVisible();
  await expect(page.getByRole("button", { name: "إجازة إعادة التسجيل" })).toHaveCount(0);
});

test("Captain reenrollment reconciles a server error against the current Identity and DSH state", async ({ page }) => {
  await stubAuthenticatedSession(page, authenticatedOperator.permissions, true);
  let reenrollmentReachedCanonicalWriter = false;
  await page.route("**/api/captains**", async (route) => {
    if (route.request().method() === "POST") {
      reenrollmentReachedCanonicalWriter = true;
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "DEPENDENCY_UNAVAILABLE" } }) });
      return;
    }
    if (new URL(route.request().url()).searchParams.get("scope") === "candidates") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [], limit: 25, nextCursor: "" }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [{ actorId: "act_captain_unknown_result", phoneE164: "+96777000113", role: "captain", enabled: true, securityEnabled: true, activatedAt: reenrollmentReachedCanonicalWriter ? null : "2026-09-20T08:00:00.000Z", actorVersion: 4, roleVersion: reenrollmentReachedCanonicalWriter ? 3 : 2, admission: { id: "cap_adm_unknown_result", actorId: "act_captain_unknown_result", state: "eligible", availabilityState: "unavailable", version: 8, createdAt: "2026-09-20T08:00:00.000Z", updatedAt: "2026-09-20T08:00:00.000Z" } }] }) });
  });
  await page.goto("/captains");
  await page.getByLabel("سبب الإجراء").fill("تسوية نتيجة إعادة التسجيل");
  await page.getByRole("button", { name: "إجازة إعادة التسجيل" }).click();
  await expect(page.locator("p.identity-error")).toContainText("أُعيد تحميل الحالة الكانونية قبل أي محاولة أخرى");
  await expect(page.getByText("بانتظار التفعيل")).toBeVisible();
  await expect(page.getByRole("button", { name: "إجازة إعادة التسجيل" })).toHaveCount(0);
});

test("Field reenrollment conflicts reload the canonical DSH-owned roster before retry", async ({ page }) => {
  await stubAuthenticatedSession(page, authenticatedOperator.permissions, true);
  let conflictStateApplied = false;
  await page.route("**/api/fields**", async (route) => {
    if (route.request().method() === "POST") {
      conflictStateApplied = true;
      await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: { code: "CONFLICT", message: "the access versions changed" } }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [{ kind: "account", account: { actorId: "act_field_conflict", phoneE164: "+96777000106", role: "field", enabled: true, activatedAt: "2026-09-20T08:00:00.000Z", securityEnabled: true, actorVersion: 4, roleVersion: conflictStateApplied ? 3 : 2, admission: { id: "fld_adm_conflict", actorId: "act_field_conflict", state: "eligible", version: 8, createdAt: "2026-09-20T08:00:00.000Z", updatedAt: "2026-09-20T08:00:00.000Z" } } }] }) });
  });
  await page.goto("/fields");
  await page.getByText("الخطوة التالية", { exact: true }).click();
  await page.getByLabel("سبب الإجراء").fill("استرداد جهاز الميدان");
  await page.getByRole("button", { name: "إجازة إعادة التسجيل" }).click();
  await expect(page.getByText(/^تغيرت حالة الحساب بالتزامن\. أُعيد تحميل الحالة الحالية/)).toBeVisible();
  await expect(page.getByRole("button", { name: "إجازة إعادة التسجيل" })).toBeVisible();
});

test("Field first activation is distinct from reenrollment and explains the next app step", async ({ page }) => {
  await stubAuthenticatedSession(page, authenticatedOperator.permissions, true);
  await page.route("**/api/fields**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [{ kind: "account", account: { actorId: "act_field_first_activation", phoneE164: "+96777000118", role: "field", enabled: true, securityEnabled: true, actorVersion: 1, roleVersion: 1, admission: { id: "fld_adm_first_activation", actorId: "act_field_first_activation", fullNameAr: "سالم علي", state: "eligible", version: 1, createdAt: "2026-09-20T08:00:00.000Z", updatedAt: "2026-09-20T08:00:00.000Z" } } }] }) });
  });
  await page.goto("/fields");
  await expect(page.getByText("الدور جاهز؛ بانتظار تفعيل الجهاز")).toBeVisible();
  await page.getByText("الخطوة التالية", { exact: true }).click();
  await expect(page.getByRole("status")).toContainText("يدخل رقم الهاتف المسجل");
  await expect(page.getByRole("status")).toContainText("تفعيل الجهاز");
  await expect(page.getByRole("button", { name: "إجازة إعادة التسجيل" })).toHaveCount(0);
});

test("Field admission form explains and enforces the international phone before save", async ({ page }) => {
  await stubAuthenticatedSession(page, authenticatedOperator.permissions, true);
  await page.route("**/api/service-cities**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ cities: [{ id: "sanaa", displayNameAr: "صنعاء", active: true, version: 1, createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z" }] }) });
  });
  await page.route("**/api/fields**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [] }) });
  });
  await page.goto("/fields");
  await page.getByText("إنشاء ملف ميداني", { exact: true }).click();
  await page.getByLabel("الاسم الكامل بالعربية").fill("سالم علي");
  await page.getByLabel("رقم الهاتف الدولي").fill("777765432");
  await page.getByLabel("مدينة الخدمة").selectOption("sanaa");
  await expect(page.getByText("الرقم المحلي وحده لا يُقبل")).toBeVisible();
  await expect(page.getByRole("button", { name: "حفظ للمراجعة" })).toBeDisabled();
  await page.getByLabel("رقم الهاتف الدولي").fill("+967 777 765 432");
  await expect(page.getByRole("button", { name: "حفظ للمراجعة" })).toBeEnabled();
});

test("Field reenrollment remains unavailable until DSH restores eligibility", async ({ page }) => {
  await stubAuthenticatedSession(page, authenticatedOperator.permissions, true);
  await page.route("**/api/fields**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [{ kind: "account", account: { actorId: "act_field_suspended", phoneE164: "+96777000107", role: "field", enabled: true, activatedAt: "2026-09-20T08:00:00.000Z", securityEnabled: true, actorVersion: 4, roleVersion: 2, admission: { id: "fld_adm_suspended", actorId: "act_field_suspended", state: "suspended", version: 9, createdAt: "2026-09-20T08:00:00.000Z", updatedAt: "2026-09-20T08:00:00.000Z" } } }] }) });
  });
  await page.goto("/fields");
  await expect(page.getByText("موقوف").first()).toBeVisible();
  await page.getByText("الخطوة التالية", { exact: true }).click();
  await expect(page.getByRole("button", { name: "إجازة إعادة التسجيل" })).toHaveCount(0);
});

test("captain center owns DSH eligibility and operational availability", async ({ page }) => {
  await stubAuthenticatedSession(page, authenticatedOperator.permissions, true);
  let mutationBody: Record<string, unknown> | undefined;
  await page.route("**/api/captains**", async (route) => {
    if (route.request().method() === "POST") {
      mutationBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({ status: 204 });
      return;
    }
    if (new URL(route.request().url()).searchParams.get("scope") === "candidates") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [], limit: 25, nextCursor: "" }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [{ actorId: "act_captain_admitted", phoneE164: "+96777000104", role: "captain", enabled: true, activatedAt: "2026-09-20T08:00:00.000Z", securityEnabled: true, actorVersion: 5, roleVersion: 6, admission: { id: "cap_adm_test", actorId: "act_captain_admitted", state: "eligible", availabilityState: "available", version: 7, createdAt: "2026-09-20T08:00:00.000Z", updatedAt: "2026-09-20T08:00:00.000Z" } }] }) });
  });
  await page.goto("/captains");
  await expect(page.getByRole("heading", { name: "قائمة الكباتن وأهليتهم وتوفرهم" })).toBeVisible();
  await page.getByLabel("سبب الإجراء").fill("تحديث توافر الكابتن");
  await page.getByRole("button", { name: "جعله غير متاح" }).click();
  expect(mutationBody).toMatchObject({ actorId: "act_captain_admitted", action: "availability", available: false, expectedVersion: 7, reason: "تحديث توافر الكابتن" });
});

test("Captain candidate profile is reviewed before Identity grants the app role", async ({ page }) => {
  await stubAuthenticatedSession(page);
  await exerciseReviewedDshCandidateFlow(page, "captain", "علي سالم", "علي سالم أحمد الصنعاني", "+96777000105");
});

test("legacy Captain profile completion and review leave access suspended", async ({ page }) => {
  await stubAuthenticatedSession(page, authenticatedOperator.permissions, true);
  await exerciseLegacyDshProfileReview(page, "captain");
});

test("operator operations uses the DSH read model and resource actions", async ({ page }) => {
  await stubAuthenticatedSession(page, [...authenticatedOperator.permissions, "operations"]);
  let requestedCursor = "";
  let requestedSearch = "";
  let requestedSort = "";
  const operation = {
    orderId: "order_ready",
    state: "READY_FOR_DISPATCH",
    updatedAt: "2026-09-18T06:00:00.000Z",
    storeName: "متجر الاختبار",
    assignment: null,
  };
  const detail = {
    order: { id: "order_ready", clientActorId: "act_client", storeId: "store_test", storeName: "متجر الاختبار", pickupLocation: null, cartId: "cart_test", fulfillmentMode: "BTHWANI_DELIVERY", addressId: "address_test", addressVersion: 1, addressText: "شارع الاختبار", addressLatitude: 15.369445, addressLongitude: 44.191006, serviceCityId: "sanaa", serviceabilityPolicyVersion: "CITY_SCOPE_V1", serviceabilityStatus: "SERVICEABLE", serviceabilityStoreVersion: 1, serviceabilityAddressVersion: 1, state: "READY_FOR_DISPATCH", subtotalAmountMinor: 1800, discountMinor: 0, totalAmountMinor: 1800, currency: "YER", paymentMethod: "CASH_ON_DELIVERY", paymentState: "REQUIRES_COLLECTION", paymentIntentId: "payment_ready", version: 3, lines: [], adjustments: [], createdAt: "2026-09-18T05:00:00.000Z", updatedAt: "2026-09-18T06:00:00.000Z" },
    storeName: "متجر الاختبار",
    assignment: null,
  };
  await page.route("**/api/operations*", async (route) => {
    const requestUrl = new URL(route.request().url());
    if (route.request().method() !== "GET" || requestUrl.pathname !== "/api/operations") {
      await route.fallback();
      return;
    }
    requestedCursor = requestUrl.searchParams.get("cursor") ?? "";
    requestedSearch = requestUrl.searchParams.get("q") ?? "";
    requestedSort = requestUrl.searchParams.get("sort") ?? "updated_desc";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        operations: requestedCursor ? [] : [operation],
        nextCursor: requestedCursor ? undefined : "cursor-page-2",
      }),
    });
  });
  await page.route("**/api/operations/order_ready", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ operation: { ...detail, order: { ...detail.order, lines: [{ id: "line-1", productName: "قهوة", variantTitle: "الافتراضي", finalQuantityBaseUnits: 1, baseUnit: "COUNT", lineAmountMinor: 1800, currency: "YER" }] } } }),
    });
  });
  await page.goto("/operations");
  await expect(page.getByRole("heading", { name: "العمليات" })).toBeVisible();
  await expect(page.getByText("order_ready")).toBeVisible();
  const searchBox = page.getByRole("searchbox");
  await searchBox.fill("متجر الاختبار");
  await searchBox.press("Enter");
  await expect.poll(() => requestedSearch).toBe("متجر الاختبار");
  await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe("متجر الاختبار");
  await page.getByLabel("ترتيب التحديث").selectOption("updated_asc");
  await expect.poll(() => requestedSort).toBe("updated_asc");
  await expect.poll(() => new URL(page.url()).searchParams.get("sort")).toBe("updated_asc");
  await page.getByRole("link", { name: "order_ready" }).click();
  await expect(page.getByRole("heading", { name: "order_ready" })).toBeVisible();
  const detailTabs = page.getByRole("navigation", { name: "مساحات تفاصيل الطلب" });
  await detailTabs.getByRole("link", { name: "التنفيذ" }).click();
  await expect(page.getByText("شارع الاختبار")).toBeVisible();
  await detailTabs.getByRole("link", { name: "الدفع" }).click();
  await expect(page.getByText("الدفع نقدًا عند الاستلام", { exact: true })).toBeVisible();
  await expect(page.getByText("بانتظار التحصيل عند التسليم", { exact: true })).toBeVisible();
  await detailTabs.getByRole("link", { name: "العناصر" }).click();
  await expect(page.getByRole("heading", { name: "عناصر الطلب" })).toBeVisible();
  await expect(page.getByText("قهوة", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "العودة إلى مسار الطلبات" }).click();
  await expect(page.getByRole("heading", { name: "العمليات" })).toBeVisible();
  const restoredSearchBox = page.getByRole("searchbox");
  await restoredSearchBox.fill("");
  await restoredSearchBox.press("Enter");
  await expect.poll(() => requestedSearch).toBe("");
  await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBeNull();
  await page.getByRole("button", { name: "الصفحة التالية" }).click();
  await expect(page.getByText("لا توجد طلبات في هذا المسار")).toBeVisible();
  await expect(page.getByRole("button", { name: "الصفحة التالية" })).toHaveCount(0);
  expect(requestedCursor).toBe("cursor-page-2");
  await expect(page.getByRole("searchbox")).toHaveCount(1);
});

test("operator finance reads only the bounded COD cash-custody projection", async ({ page }) => {
  await stubAuthenticatedSession(page);
  let registryReads = 0;
  let reconciled = false;
  let evidenceUploadCount = 0;
  let reconciliationCount = 0;
  let evidenceHeaders: Record<string, string> | undefined;
  const reconciliationHeaders: Array<Record<string, string>> = [];
  let reconciliationBody: Record<string, unknown> | undefined;
  await page.route("**/api/finance/cash-custody**", async (route) => {
    registryReads += 1;
    const items = reconciled ? [] : [{ paymentIntentId: "payment-1", externalReference: "dsh-order-1", captainActorId: "act-captain-1", amountMinor: 12500, currency: "YER", paymentVersion: 3, collectedAt: "2026-09-20T08:00:00.000Z", remittanceState: "SUBMITTED", remittanceReference: "captain-slip-1", remittanceId: "remit-1" }];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items, totalItems: items.length, totalAmountMinor: items.reduce((total, item) => total + item.amountMinor, 0), nextCursor: "" }),
    });
  });
  await page.route("**/api/finance/evidence", async (route) => {
    evidenceUploadCount += 1;
    evidenceHeaders = route.request().headers();
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ document: { id: "receipt-1" } }) });
  });
  await page.route("**/api/finance/cash-remittances/remit-1/reconcile", async (route) => {
    reconciliationCount += 1;
    reconciliationHeaders.push(route.request().headers());
    reconciliationBody = route.request().postDataJSON() as Record<string, unknown>;
    if (reconciliationCount === 1) {
      await route.abort("connectionreset");
      return;
    }
    reconciled = true;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ remittance: { id: "remit-1", state: "REMITTED" } }) });
  });
  await page.goto("/finance/cash-custody");
  await expect(page.getByRole("heading", { name: "حفظ النقد" })).toBeVisible();
  const cashRow = page.getByRole("row", { name: /dsh-order-1/ });
  await expect(cashRow).toBeVisible();
  await expect(cashRow.getByRole("cell").nth(1)).toContainText("12,500");
  await expect(page.getByRole("heading", { name: "النقد المحصل عند التسليم" })).toBeVisible();
  await expect(page.getByText("تظل العهدة مفتوحة بعد إرسال الكابتن للمرجع. يرفق موظف المالية إيصال التوريد المحفوظ والمشفّر ويطابقه هنا؛ عندها فقط يقيد WLT الاستلام ويحرر الحجز.")).toBeVisible();
  await expect(page.getByText("dsh-order-1")).toBeVisible();
  await expect(page.getByText("بانتظار مطابقة المالية")).toBeVisible();
  await expect(page.getByText("captain-slip-1")).toBeVisible();

  await page.getByLabel("إيصال التحويل أو الإيداع").setInputFiles({
    name: "bank-receipt.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("test transfer receipt"),
  });
  await page.getByRole("button", { name: "رفع الإيصال ومطابقة التوريد" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "تعذر قراءة سجل حفظ النقد" })).toBeVisible();
  await expect(cashRow.getByText("الإيصال محفوظ لهذه المحاولة")).toBeVisible();
  expect(evidenceUploadCount).toBe(1);
  expect(reconciliationCount).toBe(1);

  await page.reload();
  await expect(page.getByRole("row", { name: /dsh-order-1/ })).toBeVisible();
  await expect(page.getByText("الإيصال محفوظ لهذه المحاولة")).toBeVisible();
  await page.getByRole("button", { name: "مطابقة الإيصال المحفوظ" }).click();
  await expect(page.getByRole("status")).toContainText("طابق WLT إيصال التوريد وأغلق العهدة في القيد المالي.");
  await expect(page.getByText("dsh-order-1")).toHaveCount(0);
  expect(evidenceHeaders?.["idempotency-key"]).toBeTruthy();
  expect(evidenceHeaders?.["x-correlation-id"]).toBeTruthy();
  expect(reconciliationHeaders).toHaveLength(2);
  const firstReconciliationHeaders = reconciliationHeaders[0];
  const retryReconciliationHeaders = reconciliationHeaders[1];
  if (!firstReconciliationHeaders || !retryReconciliationHeaders) {
    throw new Error("expected the original and resumed reconciliation requests");
  }
  expect(firstReconciliationHeaders["idempotency-key"]).toBeTruthy();
  expect(firstReconciliationHeaders["x-correlation-id"]).toBeTruthy();
  expect(retryReconciliationHeaders["idempotency-key"]).toBe(firstReconciliationHeaders["idempotency-key"]);
  expect(retryReconciliationHeaders["x-correlation-id"]).toBe(firstReconciliationHeaders["x-correlation-id"]);
  expect(reconciliationBody).toEqual({ evidenceDocumentId: "receipt-1" });
  expect(evidenceUploadCount).toBe(1);
  expect(reconciliationCount).toBe(2);
  expect(registryReads).toBeGreaterThan(1);
});

test("partner commission remittance resumes with its stored receipt after an uncertain result", async ({ page }) => {
  await stubAuthenticatedSession(page);
  let evidenceUploadCount = 0;
  let uncertainFullBalanceRemittance = false;
  const remittanceRequests: Array<{ headers: Record<string, string>; body: Record<string, unknown> }> = [];
  await page.route("**/api/finance/partner-commission-receivables**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [{ partnerActorId: "act_partner_receipt", profileState: "ACTIVE", outstandingCommissionReceivableMinor: 5000, currency: "YER" }], nextCursor: "", limit: 50 }),
    });
  });
  await page.route("**/api/finance/partner-earnings**", async (route) => {
    if (route.request().method() === "GET") {
      const outstandingCommissionReceivableMinor = uncertainFullBalanceRemittance ? 0 : 5000;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ summary: { partnerActorId: "act_partner_receipt", currency: "YER", earnedMinor: 20000, commissionMinor: 5000, outstandingCommissionReceivableMinor, orderCount: 4, settlementPeriod: "WEEKLY", profileState: "ACTIVE", profileVersion: 1, lastEarningAt: null } }),
      });
      return;
    }
    const request = { headers: route.request().headers(), body: route.request().postDataJSON() as Record<string, unknown> };
    remittanceRequests.push(request);
    if (remittanceRequests.length === 1) {
      uncertainFullBalanceRemittance = true;
      await route.abort("connectionreset");
      return;
    }
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ remittance: { id: "commission-remit-1", partnerActorId: "act_partner_receipt", amountMinor: 5000, currency: "YER", remittanceReference: "bank-transfer-1", evidenceDocumentId: "finance-receipt-1", verifiedBy: "act_operator", verifiedAt: "2026-10-03T00:00:00.000Z", ledgerTransactionId: "ledger-1", createdAt: "2026-10-03T00:00:00.000Z" }, idempotentReplay: false }),
    });
  });
  await page.route("**/api/finance/evidence", async (route) => {
    evidenceUploadCount += 1;
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ document: { id: "finance-receipt-1" } }) });
  });

  await page.goto("/finance/partner-commission-receivables?partnerActorId=act_partner_receipt");
  await expect(page.getByRole("heading", { name: "مستحقات الشريك act_partner_receipt" })).toBeVisible();
  await page.getByLabel("المبلغ بالريال اليمني").fill("5000");
  await page.getByLabel("مرجع الحوالة").fill("bank-transfer-1");
  await page.getByLabel("إيصال الحوالة (PDF أو صورة أو CSV أو Excel، بحد أقصى 10 ميغابايت)").setInputFiles({ name: "bank-transfer.pdf", mimeType: "application/pdf", buffer: Buffer.from("verified partner transfer receipt") });
  await page.getByRole("button", { name: "تسجيل الحوالة بعد التحقق" }).click();
  await expect.poll(() => remittanceRequests.length).toBe(1);
  await expect(page.locator("p.state-error[role=alert]")).toContainText("انقطع الاتصال أثناء حفظ إيصال الحوالة أو تسجيلها");
  await expect(page.getByText("الإيصال المحفوظ:")).toBeVisible();
  expect(evidenceUploadCount).toBe(1);

  await page.reload();
  await expect(page.getByText(/بقيت محاولة غير محسومة/)).toBeVisible();
  await expect(page.getByText("الإيصال المحفوظ:")).toBeVisible();
  await expect(page.getByText("لا يوجد رصيد مفتوح حالياً، لكن توجد محاولة سابقة غير محسومة.")).toBeVisible();
  await page.getByRole("button", { name: "إعادة المحاولة بنفس العملية" }).click();
  await expect(page.getByRole("status")).toContainText("سُجلت الحوالة bank-transfer-1");
  await expect(page.getByRole("link", { name: "فتح إيصال الحوالة" })).toHaveAttribute("href", "/api/finance/evidence/finance-receipt-1");
  expect(remittanceRequests).toHaveLength(2);
  const original = remittanceRequests[0];
  const resumed = remittanceRequests[1];
  if (!original || !resumed) throw new Error("expected both original and resumed partner remittance requests");
  expect(original.body).toEqual({ partnerActorId: "act_partner_receipt", amountMinor: 5000, remittanceReference: "bank-transfer-1", evidenceDocumentId: "finance-receipt-1" });
  expect(resumed.body).toEqual(original.body);
  expect(resumed.headers["idempotency-key"]).toBe(original.headers["idempotency-key"]);
  expect(resumed.headers["x-correlation-id"]).toBe(original.headers["x-correlation-id"]);
  expect(evidenceUploadCount).toBe(1);
});

test("partner commission remittance keeps its recovery key when WLT returns an unreadable success", async ({ page }) => {
  await stubAuthenticatedSession(page);
  let evidenceUploadCount = 0;
  const remittanceRequests: Array<{ headers: Record<string, string>; body: Record<string, unknown> }> = [];
  await page.route("**/api/finance/partner-commission-receivables**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [{ partnerActorId: "act_partner_malformed", profileState: "ACTIVE", outstandingCommissionReceivableMinor: 5000, currency: "YER" }], nextCursor: "", limit: 50 }),
    });
  });
  await page.route("**/api/finance/partner-earnings**", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ summary: { partnerActorId: "act_partner_malformed", currency: "YER", earnedMinor: 20000, commissionMinor: 5000, outstandingCommissionReceivableMinor: 5000, orderCount: 4, settlementPeriod: "WEEKLY", profileState: "ACTIVE", profileVersion: 1, lastEarningAt: null } }),
      });
      return;
    }
    remittanceRequests.push({ headers: route.request().headers(), body: route.request().postDataJSON() as Record<string, unknown> });
    if (remittanceRequests.length === 1) {
      await route.fulfill({ status: 200, contentType: "application/json", body: "{" });
      return;
    }
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ remittance: { id: "commission-remit-2", partnerActorId: "act_partner_malformed", amountMinor: 5000, currency: "YER", remittanceReference: "bank-transfer-2", evidenceDocumentId: "finance-receipt-2", verifiedBy: "act_operator", verifiedAt: "2026-10-03T00:00:00.000Z", ledgerTransactionId: "ledger-2", createdAt: "2026-10-03T00:00:00.000Z" }, idempotentReplay: true }),
    });
  });
  await page.route("**/api/finance/evidence", async (route) => {
    evidenceUploadCount += 1;
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ document: { id: "finance-receipt-2" } }) });
  });

  await page.goto("/finance/partner-commission-receivables?partnerActorId=act_partner_malformed");
  await expect(page.getByRole("heading", { name: "مستحقات الشريك act_partner_malformed" })).toBeVisible();
  await page.getByLabel("المبلغ بالريال اليمني").fill("5000");
  await page.getByLabel("مرجع الحوالة").fill("bank-transfer-2");
  await page.getByLabel("إيصال الحوالة (PDF أو صورة أو CSV أو Excel، بحد أقصى 10 ميغابايت)").setInputFiles({ name: "bank-transfer-2.pdf", mimeType: "application/pdf", buffer: Buffer.from("verified partner transfer receipt") });
  await page.getByRole("button", { name: "تسجيل الحوالة بعد التحقق" }).click();
  await expect(page.locator("p.state-error[role=alert]")).toContainText("استجابة غير مكتملة للحوالة");
  await expect(page.getByRole("button", { name: "إعادة المحاولة بنفس العملية" })).toBeVisible();
  expect(evidenceUploadCount).toBe(1);

  await page.reload();
  await expect(page.getByText(/بقيت محاولة غير محسومة/)).toBeVisible();
  await page.getByRole("button", { name: "إعادة المحاولة بنفس العملية" }).click();
  await expect(page.getByRole("status")).toContainText("سُجلت الحوالة bank-transfer-2");
  expect(remittanceRequests).toHaveLength(2);
  const original = remittanceRequests[0];
  const replay = remittanceRequests[1];
  if (!original || !replay) throw new Error("expected the original and replayed partner remittance requests");
  expect(replay.body).toEqual(original.body);
  expect(replay.headers["idempotency-key"]).toBe(original.headers["idempotency-key"]);
  expect(replay.headers["x-correlation-id"]).toBe(original.headers["x-correlation-id"]);
  expect(evidenceUploadCount).toBe(1);
});

test("Field candidate profile is reviewed before Identity grants the app role", async ({ page }) => {
  await stubAuthenticatedSession(page);
  await exerciseReviewedDshCandidateFlow(page, "field", "سامي ناصر", "سامي ناصر محمد العريقي", "+96777000104");
});

test("legacy Field profile completion and review leave access suspended", async ({ page }) => {
  await stubAuthenticatedSession(page, authenticatedOperator.permissions, true);
  await exerciseLegacyDshProfileReview(page, "field");
});

test("operator creates a DSH-owned joining case from prospective partner facts", async ({ page }) => {
  await stubAuthenticatedSession(page);
  await stubCommercialStoreTypes(page);
  let requestBody: unknown;
  await page.route("**/api/service-cities**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ cities: [{ id: "sanaa", displayNameAr: "صنعاء", active: true, version: 1, createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z" }] }) });
  });
  await page.route("**/api/catalog/verticals**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ verticals: [{ id: "grocery", nameAr: "بقالة", nameEn: "Grocery", catalogModel: "SHARED_CATALOG", active: true, version: 1, createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z" }] }) });
  });
  await page.route("**/api/partners/joining-cases/join_test", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        case: { id: "join_test", contactPhoneE164: "+96777000100", businessName: "نشاط الاختبار", firstStoreName: "متجر الاختبار", serviceCityId: "sanaa", firstStoreVerticalId: "grocery", firstStoreFulfillmentModes: ["BTHWANI_CAPTAIN", "CUSTOMER_PICKUP"], firstStoreLatitude: 15.369445, firstStoreLongitude: 44.191006, state: "draft", version: 1, createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z" },
        idempotentReplay: false,
      }),
    });
  });
  await page.route("**/api/partners/joining-cases", async (route) => {
    requestBody = route.request().postDataJSON();
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        case: { id: "join_test", contactPhoneE164: "+96777000100", businessName: "نشاط الاختبار", firstStoreName: "متجر الاختبار", serviceCityId: "sanaa", firstStoreVerticalId: "grocery", firstStoreFulfillmentModes: ["BTHWANI_CAPTAIN", "CUSTOMER_PICKUP"], firstStoreLatitude: 15.369445, firstStoreLongitude: 44.191006, state: "draft", version: 1, createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z" },
        idempotentReplay: false,
      }),
    });
  });

  await page.goto("/partners/new");
  await expect(page.getByRole("heading", { name: "إنشاء حالة انضمام جديدة", exact: true })).toBeVisible();
  await expect(page.getByLabel("معرّف Actor الشريك")).toHaveCount(0);
  await expect(page.getByLabel("رقم جوال المالك (E.164)")).toBeVisible();
  await fillOperatorJoiningCaseForm(page);
  const fulfillmentModes = page.getByRole("group", { name: "أوضاع الطلب التي اختارها الشريك عند الانضمام" });
  await expect(fulfillmentModes.getByRole("checkbox")).toHaveCount(3);
  await fulfillmentModes.getByRole("checkbox", { name: "استلم بنفسك من المتجر" }).check();
  await page.getByRole("button", { name: "إنشاء حالة انضمام" }).click();

  await expect(page.getByRole("status")).toContainText("الحالة: مسودة");
  expect(requestBody).toEqual({ ...operatorJoiningCaseDraft, firstStoreFulfillmentModes: ["CUSTOMER_PICKUP"] });
});

test("operator resumes an uncertain joining-case create with the same idempotency key after reload", async ({ page }) => {
  await stubAuthenticatedSession(page);
  await stubCommercialStoreTypes(page);
  const attempts: Array<{ idempotencyKey: string; correlationId: string; body: unknown }> = [];
  const expectedBody = { ...operatorJoiningCaseDraft, firstStoreFulfillmentModes: ["CUSTOMER_PICKUP"] };
  const createdCase = { id: "join_retry", contactPhoneE164: expectedBody.contactPhoneE164, businessName: expectedBody.businessName, firstStoreName: expectedBody.firstStoreName, serviceCityId: expectedBody.serviceCityId, firstStoreVerticalId: expectedBody.firstStoreVerticalId, firstStoreCommercialTypeId: expectedBody.firstStoreCommercialTypeId, firstStoreFulfillmentModes: expectedBody.firstStoreFulfillmentModes, firstStoreLatitude: expectedBody.firstStoreLatitude, firstStoreLongitude: expectedBody.firstStoreLongitude, state: "draft", version: 1, createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z" };
  await page.route("**/api/service-cities**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ cities: [{ id: "sanaa", displayNameAr: "صنعاء", active: true, version: 1, createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z" }] }) });
  });
  await page.route("**/api/catalog/verticals**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ verticals: [{ id: "grocery", nameAr: "بقالة", nameEn: "Grocery", catalogModel: "SHARED_CATALOG", active: true, version: 1, createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z" }] }) });
  });
  await page.route("**/api/partners/joining-cases", async (route) => {
    const request = route.request();
    const body = request.postDataJSON() as Record<string, unknown>;
    attempts.push({ idempotencyKey: request.headers()["idempotency-key"] ?? "", correlationId: request.headers()["x-correlation-id"] ?? "", body });
    if (attempts.length === 1) {
      await route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: { code: "DSH_UNAVAILABLE" } }) });
      return;
    }
    if (body.firstStoreProofNumber !== expectedBody.firstStoreProofNumber) {
      await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: { code: "IDEMPOTENCY_CONFLICT" } }) });
      return;
    }
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ case: createdCase, idempotentReplay: true }) });
  });
  await page.route("**/api/partners/joining-cases/join_retry", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ case: createdCase, idempotentReplay: true }) });
  });

  await page.goto("/partners/new");
  await fillOperatorJoiningCaseForm(page);
  await page.getByRole("checkbox", { name: "استلم بنفسك من المتجر" }).check();
  await page.getByRole("button", { name: "إنشاء حالة انضمام" }).click();
  await expect(page.getByText(/أعد المحاولة بالبيانات نفسها للتحقق بالمفتاح المحفوظ/)).toBeVisible();
  await expect(page.getByLabel("رقم جوال المالك (E.164)")).toBeDisabled();
  const storedMetadataRaw = await page.evaluate(() => window.sessionStorage.getItem("bthwani.control.partner.joining-case-create.v1.actor-operator"));
  expect(storedMetadataRaw).not.toBeNull();
  const storedMetadata = JSON.parse(storedMetadataRaw ?? "null") as Record<string, unknown>;
  expect(Object.keys(storedMetadata).sort()).toEqual(["correlationId", "idempotencyKey"]);
  expect(storedMetadataRaw).not.toContain("CR-100");

  await page.reload();
  await expect(page.getByRole("status")).toContainText("يحفظ المتصفح مفتاح المتابعة فقط");
  await expect(page.getByLabel("رقم جوال المالك (E.164)")).toHaveValue("");
  await fillOperatorJoiningCaseForm(page);
  await page.getByRole("checkbox", { name: "استلم بنفسك من المتجر" }).check();
  await page.getByLabel("رقم الإثبات").fill("CR-WRONG");
  await expect(page.getByRole("button", { name: "إعادة محاولة إنشاء الحالة" })).toBeEnabled();
  await page.getByRole("button", { name: "إعادة محاولة إنشاء الحالة" }).click();
  await expect(page.getByText(/لم تطابق البيانات مفتاح المحاولة المحفوظ/)).toBeVisible();
  await expect(page.getByLabel("رقم جوال المالك (E.164)")).toBeEnabled();
  await page.getByLabel("رقم الإثبات").fill(operatorJoiningCaseDraft.firstStoreProofNumber);
  await page.getByRole("button", { name: "إعادة محاولة إنشاء الحالة" }).click();
  await expect(page).toHaveURL(/\/partners\/join_retry$/);

  expect(attempts).toHaveLength(3);
  const idempotencyKey = attempts[0]?.idempotencyKey ?? "";
  const correlationId = attempts[0]?.correlationId ?? "";
  expect(idempotencyKey).toMatch(/^partner_joining_case_create_/);
  expect(attempts.every((attempt) => attempt.idempotencyKey === idempotencyKey)).toBe(true);
  expect(attempts.every((attempt) => attempt.correlationId === correlationId)).toBe(true);
  expect(attempts.map((attempt) => attempt.body)).toEqual([expectedBody, { ...expectedBody, firstStoreProofNumber: "CR-WRONG" }, expectedBody]);
});

test("operator gets an actionable empty state when no active commerce vertical exists", async ({ page }) => {
  await stubAuthenticatedSession(page);
  await page.route("**/api/service-cities**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ cities: [] }) });
  });
  await page.route("**/api/catalog/verticals", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ verticals: [] }) });
  });
  await page.route("**/api/partners/joining-cases**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ cases: [] }) });
  });
  await page.goto("/partners/new");
  await expect(page.getByText("لا يمكن إنشاء الحالة بعد", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "فتح مدن الخدمة" })).toHaveAttribute("href", "/policies/service-cities");
  await expect(page.getByRole("button", { name: "إنشاء حالة انضمام" })).toBeDisabled();
});

test("operator city creation delegates the stable id to DSH", async ({ page }) => {
  await stubAuthenticatedSession(page);
  let requestBody: unknown;
  await page.route("**/api/service-cities**", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ cities: [] }) });
      return;
    }
    requestBody = route.request().postDataJSON();
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ city: { id: "city_0123456789abcdef0123456789abcdef", displayNameAr: "صنعاء", active: true, version: 1, createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z" } }),
    });
  });

  await page.goto("/policies/service-cities");
  await page.getByLabel("الاسم العربي").fill("صنعاء");
  await page.getByRole("button", { name: "إضافة مدينة" }).click();

  const cityNotice = page.getByRole("status").filter({ hasText: "تم حفظ المدينة الكانونية" });
  await expect(cityNotice).toContainText("تم حفظ المدينة الكانونية.");
  await expect(cityNotice).not.toContainText("city_0123456789abcdef0123456789abcdef");
  expect(requestBody).toEqual({ displayNameAr: "صنعاء", active: true });
});

test("operator city creation rejects non-Arabic names before mutation", async ({ page }) => {
  await stubAuthenticatedSession(page);
  let mutationAttempted = false;
  await page.route("**/api/service-cities**", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ cities: [] }) });
      return;
    }
    mutationAttempted = true;
    await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "UNEXPECTED_MUTATION" } }) });
  });
  await page.goto("/policies/service-cities");
  await page.getByLabel("الاسم العربي").fill("Sana'a");
  await page.getByRole("button", { name: "إضافة مدينة" }).click();
  await expect(page.locator("p.identity-error")).toContainText("باللغة العربية فقط");
  expect(mutationAttempted).toBe(false);
});

test("operator creates a canonical commerce vertical before onboarding partners", async ({ page }) => {
  await stubAuthenticatedSession(page, [...authenticatedOperator.permissions, "catalog"]);
  let requestBody: unknown;
  await page.route("**/api/catalog/verticals**", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ verticals: [] }) });
      return;
    }
    requestBody = route.request().postDataJSON();
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ vertical: { id: "vertical_0123456789abcdef0123456789abcdef", nameAr: "مطاعم", nameEn: "Restaurants", catalogModel: "STORE_LOCAL_CATALOG", active: true, version: 1, createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z" }, idempotentReplay: false }),
    });
  });
  await page.route("**/api/catalog/products**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ products: [] }) });
  });
  await page.goto("/catalog/categories");
  await expect(page.getByLabel("المعرف البرمجي", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "إعداد المجال التجاري" }).click();
  await page.getByRole("button", { name: "إضافة مجال تجاري" }).click();
  await page.locator("#catalog-vertical-name-ar").fill("مطاعم");
  await page.locator("#catalog-vertical-name-en").fill("Restaurants");
  await page.locator("#catalog-vertical-model").selectOption("STORE_LOCAL_CATALOG");
  await page.locator("#catalog-vertical-reason").fill("إنشاء فئة جديدة للاختبار");
  await page.getByRole("button", { name: "إضافة مجال تجاري" }).click();
  await expect(page.getByRole("status")).toContainText("تم حفظ المجال التجاري: مطاعم.");
  await expect(page.getByRole("status")).not.toContainText("vertical_0123456789abcdef0123456789abcdef");
  expect(requestBody).toEqual({ nameAr: "مطاعم", nameEn: "Restaurants", catalogModel: "STORE_LOCAL_CATALOG", active: true, reason: "إنشاء فئة جديدة للاختبار" });
});

test("operator creates and reads back the reward policy for the selected commercial store type", async ({ page }) => {
  await stubAuthenticatedSession(page);
  let savedPolicy: { scopeType: string; scopeId: string; rewardMinor: number; roundingUnitMinor: number; expectedVersion: number; reason: string; version: number } | null = null;
  let mutation: Record<string, unknown> | undefined;
  await page.route("**/api/catalog/verticals**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ verticals: [{ id: "restaurants", nameAr: "مطاعم", nameEn: "Restaurants", catalogModel: "STORE_LOCAL_CATALOG", active: true, version: 1, createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z" }] }) });
  });
  await page.route("**/api/catalog/commercial-store-types**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ storeTypes: [{ id: "grocery-market", verticalId: "restaurants", nameAr: "مطعم محلي", nameEn: "Local restaurant", active: true, version: 1, createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z" }] }) });
  });
  await page.route("**/api/finance/field-acquisition-policy**", async (route) => {
    if (route.request().method() === "GET") {
      if (!savedPolicy) {
        await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "NOT_FOUND", message: "no policy" } }) });
        return;
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ policy: savedPolicy }) });
      return;
    }
    mutation = route.request().postDataJSON() as Record<string, unknown>;
    savedPolicy = { ...(mutation as Omit<NonNullable<typeof savedPolicy>, "version">), version: 1 };
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ policy: savedPolicy }) });
  });

  await page.goto("/policies/field-acquisition");
  await expect(page.locator("#field-acquisition-policy-title")).toBeVisible();
  await page.getByLabel("المجال التجاري").selectOption("restaurants");
  await page.getByLabel("نوع المتجر التجاري").selectOption("grocery-market");
  await expect(page.getByText(/لا توجد سياسة مفعّلة/)).toBeVisible();
  await page.getByLabel("مبلغ الاستحقاق لهذا النوع (ريال يمني)").fill("250");
  await page.getByLabel("سبب إنشاء السياسة أو تغيير المبلغ").fill("سياسة اختبار نوع المطعم");
  await page.getByRole("button", { name: "إنشاء سياسة لهذا النوع" }).click();
  await expect(page.locator("output.success")).toContainText("تم حفظ السياسة ومطابقة مبلغها وإصدارها مع WLT.");
  expect(mutation).toMatchObject({ scopeType: "STORE_TYPE", scopeId: "grocery-market", rewardMinor: 250, roundingUnitMinor: 50, expectedVersion: 0, reason: "سياسة اختبار نوع المطعم" });
  await expect(page.getByText(/المبلغ الفعّال لنوع/)).toBeVisible();
});

test("operator creates a product category under its commerce vertical", async ({ page }) => {
  await stubAuthenticatedSession(page, [...authenticatedOperator.permissions, "catalog"]);
  await page.setViewportSize({ width: 1440, height: 1000 });
  let requestBody: unknown;
  await page.route("**/api/catalog/verticals**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ verticals: [{ id: "vertical_0123456789abcdef0123456789abcdef", nameAr: "بقالات", nameEn: "Groceries", catalogModel: "SHARED_CATALOG", active: true, version: 1, createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z" }] }) });
  });
  await page.route("**/api/catalog/categories**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/attribute-rules")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ rules: [] }) });
      return;
    }
    if (route.request().method() === "GET") {
      const detail = url.pathname.endsWith("/category_0123456789abcdef0123456789abcdef");
      const category = { id: "category_0123456789abcdef0123456789abcdef", verticalId: "vertical_0123456789abcdef0123456789abcdef", parentCategoryId: null, nameAr: "قهوة", nameEn: "Coffee", pathAr: "قهوة", pathEn: "Coffee", active: true, version: 1, createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z" };
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(detail ? { category } : { categories: [], nextCursor: "" }) });
      return;
    }
    requestBody = route.request().postDataJSON();
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ category: { id: "category_0123456789abcdef0123456789abcdef", verticalId: "vertical_0123456789abcdef0123456789abcdef", parentCategoryId: null, nameAr: "قهوة", nameEn: "Coffee", active: true, version: 1, createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z" } }) });
  });
  await page.route("**/api/catalog/products**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ products: [] }) });
  });
  await page.goto("/catalog/categories?verticalId=vertical_0123456789abcdef0123456789abcdef");
  await expect(page.getByRole("region", { name: "إدارة الفئات" })).toBeVisible();
  await expect(page.getByRole("region", { name: "إدارة الفئات" }).getByRole("heading", { name: "الفئات", exact: true })).toBeVisible();
  await expect(page.locator(".catalog-taxonomy-workspace")).toHaveCount(1);
  await expect(page.locator(".catalog-taxonomy-workspace > .catalog-taxonomy-workbench")).toHaveCount(1);
  await expect(page.locator(".catalog-taxonomy-section")).toHaveCount(2);
  await page.screenshot({ path: "test-results/catalog-taxonomy-workspace.png", fullPage: true });
  await expect(page.getByLabel("المعرف البرمجي للتصنيف", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "فئة رئيسية جديدة", exact: true }).click();
  await page.getByLabel("الاسم بالعربية").fill("قهوة");
  await page.getByLabel("الاسم بالإنجليزية").fill("Coffee");
  await page.locator("#catalog-category-reason").fill("إنشاء فئة جديدة للاختبار");
  await page.locator(".catalog-category-editor").getByRole("button", { name: "إضافة الفئة", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("تمت إضافة «قهوة».");
  await expect(page.getByRole("heading", { name: "قهوة", exact: true })).toBeVisible();
  await expect(page.getByText("خصائص المنتجات وقواعد هذه الفئة", { exact: true })).toBeVisible();
  await expect(page.getByRole("status")).not.toContainText("category_0123456789abcdef0123456789abcdef");
  expect(requestBody).toEqual({ verticalId: "vertical_0123456789abcdef0123456789abcdef", parentCategoryId: null, nameAr: "قهوة", nameEn: "Coffee", active: true, reason: "إنشاء فئة جديدة للاختبار" });
});

test("operator replaces the primary product image and adds a gallery image through canonical media upload", async ({ page }) => {
  await stubAuthenticatedSession(page);
  const product = {
    id: "product_media_upload_test",
    verticalId: "grocery",
    scope: "SHARED",
    canonicalName: "قهوة رفع الصور",
    brand: null,
    storeId: null,
    active: true,
    version: 1,
    createdAt: "2026-09-12T00:00:00.000Z",
    updatedAt: "2026-09-12T00:00:00.000Z",
    variants: [{ id: "variant_media_upload_test", productId: "product_media_upload_test", title: "الافتراضي", measurementKind: "DISCRETE", baseUnit: "COUNT", active: true, version: 1, identifiers: [{ type: "SKU", value: "MEDIA-UPLOAD-TEST" }], attributes: [], createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z" }],
    categoryIds: ["coffee"],
    attributes: [],
    media: [] as Array<{ uri: string; role: "primary" | "gallery"; ordinal: number }>,
  };
  let currentProduct = product;
  const uploadCalls: Array<{ role: string; filename: string; expectedVersion: string; idempotencyKey: string; creator: string; attested: string }> = [];
  async function enterImageRights() {
    await page.getByLabel("اسم المنشئ أو المصوّر").fill("فريق الاختبار");
    await page.getByLabel("مصدر الصورة", { exact: true }).fill("صورة تجريبية مملوكة لفريق الاختبار");
    await page.getByLabel("بيان الإذن أو الترخيص").fill("إذن خطي يسمح بعرض الصورة في الكتالوج");
    await page.getByLabel("أقرّ بوجود إذن يسمح بعرض هذه الصورة").check();
  }
  await page.route("**/api/catalog/verticals**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ verticals: [{ id: "grocery", nameAr: "بقالة", nameEn: "Grocery", catalogModel: "SHARED_CATALOG", active: true, version: 1, createdAt: product.createdAt, updatedAt: product.updatedAt }] }) });
  });
  await page.route("**/api/catalog/categories**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/attribute-rules")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ rules: [] }) });
      return;
    }
    const category = { id: "coffee", verticalId: "grocery", parentCategoryId: null, nameAr: "قهوة", nameEn: "Coffee", pathAr: "قهوة", pathEn: "Coffee", active: true, version: 1, createdAt: product.createdAt, updatedAt: product.updatedAt };
    if (url.pathname.endsWith("/coffee")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ category }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ categories: [category], nextCursor: "" }) });
  });
  await page.route("**/api/catalog/product-registry**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ products: [{ id: currentProduct.id, verticalId: currentProduct.verticalId, canonicalName: currentProduct.canonicalName, brand: currentProduct.brand, active: currentProduct.active, version: currentProduct.version, variantCount: currentProduct.variants.length, categoryIds: currentProduct.categoryIds, primaryImageUri: currentProduct.media.find((media) => media.role === "primary")?.uri ?? null, createdAt: currentProduct.createdAt, updatedAt: currentProduct.updatedAt }], nextCursor: "" }) });
  });
  await page.route("**/api/catalog/products/product_media_upload_test", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(currentProduct) });
  });
  await page.route("**/api/catalog/products/product_media_upload_test/media", async (route) => {
    const headers = route.request().headers();
    const body = route.request().postDataBuffer()?.toString("latin1") ?? "";
    const role = body.match(/name="role"\r\n\r\n([^\r\n]+)/)?.[1] ?? "";
    const filename = body.match(/name="file"; filename="([^"]+)"/)?.[1] ?? "";
    const creatorBytes = body.match(/name="creator"\r\n\r\n([^\r\n]+)/)?.[1] ?? "";
    const creator = Buffer.from(creatorBytes, "latin1").toString("utf8");
    const attested = body.match(/name="rightsAttested"\r\n\r\n([^\r\n]+)/)?.[1] ?? "";
    uploadCalls.push({ role, filename, expectedVersion: headers["x-expected-version"] ?? "", idempotencyKey: headers["idempotency-key"] ?? "", creator, attested });
    const uri = `http://localhost:18080/dsh/catalog/media/catalog/products/${currentProduct.id}/uploads/${role}.png`;
    const nextMedia = role === "primary"
      ? [...currentProduct.media.filter((item) => item.role !== "primary"), { uri, role: "primary" as const, ordinal: 0 }]
      : [...currentProduct.media, { uri, role: "gallery" as const, ordinal: currentProduct.media.filter((item) => item.role === "gallery").length + 1 }];
    currentProduct = { ...currentProduct, version: currentProduct.version + 1, media: nextMedia };
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ product: currentProduct, idempotentReplay: false }) });
  });

  await page.goto("/catalog/products");
  await page.getByRole("row", { name: /قهوة رفع الصور/ }).getByRole("button", { name: "تفاصيل وتعديل" }).click();
  await expect(page.getByLabel("رابط الصورة الأساسية")).toHaveCount(0);
  const onePixelPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  await page.getByLabel("ملف الصورة").setInputFiles({ name: "coffee-primary.png", mimeType: "image/png", buffer: onePixelPng });
  await enterImageRights();
  await page.getByRole("button", { name: "رفع الصورة وربطها" }).click();
  await expect(page.getByRole("status")).toContainText("تم رفع الصورة الأساسية وربطها بالمنتج.");
  await expect(page.locator(".catalog-media-preview")).toHaveCount(1);
  await expect(page.locator(".catalog-media-preview")).toHaveAttribute("src", currentProduct.media[0]!.uri);
  await page.getByLabel("موضع الصورة").selectOption("gallery");
  await page.getByLabel("ملف الصورة").setInputFiles({ name: "coffee-gallery.png", mimeType: "image/png", buffer: onePixelPng });
  await enterImageRights();
  await page.getByRole("button", { name: "رفع الصورة وربطها" }).click();
  await expect(page.getByRole("status")).toContainText("تم رفع الصورة وإضافتها إلى المعرض.");
  await expect(page.locator(".catalog-media-preview")).toHaveCount(2);
  expect(uploadCalls).toEqual([
    { role: "primary", filename: "coffee-primary.png", expectedVersion: "1", idempotencyKey: expect.any(String), creator: "فريق الاختبار", attested: "true" },
    { role: "gallery", filename: "coffee-gallery.png", expectedVersion: "2", idempotencyKey: expect.any(String), creator: "فريق الاختبار", attested: "true" },
  ]);
  expect(uploadCalls.every((call) => call.idempotencyKey.length >= 20)).toBe(true);
  expect(currentProduct.media).toEqual([
    { uri: "http://localhost:18080/dsh/catalog/media/catalog/products/product_media_upload_test/uploads/primary.png", role: "primary", ordinal: 0 },
    { uri: "http://localhost:18080/dsh/catalog/media/catalog/products/product_media_upload_test/uploads/gallery.png", role: "gallery", ordinal: 1 },
  ]);

  await page.reload();
  await page.getByRole("row", { name: /قهوة رفع الصور/ }).getByRole("button", { name: "تفاصيل وتعديل" }).click();
  await expect(page.locator(".catalog-media-preview")).toHaveCount(2);
  await expect(page.locator(".catalog-media-preview").nth(0)).toHaveAttribute("src", currentProduct.media[0]!.uri);
  await expect(page.locator(".catalog-media-preview").nth(1)).toHaveAttribute("src", currentProduct.media[1]!.uri);
});

test("operator resumes a canonical joining case from the DSH queue", async ({ page }) => {
  await stubAuthenticatedSession(page, [...authenticatedOperator.permissions, "partners"]);
  await page.route("**/api/partners/joining-cases**", async (route) => {
    if (new URL(route.request().url()).pathname !== "/api/partners/joining-cases") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
       body: JSON.stringify({ cases: [{ id: "join_resume", contactPhoneE164: "+96777000101", businessName: "نشاط مستعاد", firstStoreName: "متجر مستعاد", serviceCityId: "sanaa", firstStoreVerticalId: "grocery", firstStoreLatitude: 15.369445, firstStoreLongitude: 44.191006, state: "submitted", version: 2, createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z" }] }),
    });
  });
  await page.route("**/api/partners/joining-cases/join_resume", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
         case: { id: "join_resume", contactPhoneE164: "+96777000101", businessName: "نشاط مستعاد", firstStoreName: "متجر مستعاد", serviceCityId: "sanaa", firstStoreVerticalId: "grocery", firstStoreFulfillmentModes: ["BTHWANI_CAPTAIN"], firstStoreLatitude: 15.369445, firstStoreLongitude: 44.191006, state: "submitted", version: 2, createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z" },
        idempotentReplay: false,
      }),
    });
  });
  await page.goto("/partners/joining");
  await page.getByRole("link", { name: "فتح الحالة" }).click();
  await expect(page.getByRole("status").first()).toContainText("الحالة: قيد المراجعة");
  await expect(page.getByRole("status").first()).toContainText("نشاط مستعاد");
});

test("Partner reenrollment verifies DSH joining eligibility and the Identity readback", async ({ page }) => {
  await stubAuthenticatedSession(page, [...authenticatedOperator.permissions, "partners"], true);
  let reauthorized = false;
  let reenrollmentBody: Record<string, unknown> | undefined;
  await page.route("**/api/partners/roster/act_partner_reenroll", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        partner: { actorId: "act_partner_reenroll", phoneE164: "+96777000112", role: "partner", enabled: true, securityEnabled: true, activatedAt: reauthorized ? null : "2026-09-20T08:00:00.000Z", actorVersion: 6, roleVersion: reauthorized ? 4 : 3 },
        joiningCase: { id: "join_partner_reenroll", partnerActorId: "act_partner_reenroll", state: "approved", version: 9, businessName: "نشاط مستعاد", firstStoreName: "متجر مستعاد", serviceCityId: "sanaa", firstStoreVerticalId: "grocery", firstStoreFulfillmentModes: ["BTHWANI_CAPTAIN"], createdAt: "2026-09-20T08:00:00.000Z", updatedAt: "2026-09-20T08:00:00.000Z" },
      }),
    });
  });
  await page.route("**/api/partners/roster", async (route) => {
    reenrollmentBody = route.request().postDataJSON() as Record<string, unknown>;
    reauthorized = true;
    await route.fulfill({ status: 204 });
  });
  await page.goto("/partners/actors/act_partner_reenroll");
  await page.getByLabel("سبب الإجراء").fill("استعادة وصول الشريك");
  await page.getByRole("button", { name: "إجازة إعادة التسجيل" }).click();
  await expect(page.getByRole("status")).toContainText("تمت إجازة إعادة تسجيل الشريك بعد تحقق DSH");
  expect(reenrollmentBody).toMatchObject({
    actorId: "act_partner_reenroll",
    action: "reenroll",
    expectedActorVersion: 6,
    expectedRoleVersion: 3,
    expectedJoiningCaseVersion: 9,
    reason: "استعادة وصول الشريك",
  });
});

test("Partner reenrollment reconciles a server error against the current Identity and DSH state", async ({ page }) => {
  await stubAuthenticatedSession(page, [...authenticatedOperator.permissions, "partners"], true);
  let reenrollmentReachedCanonicalWriter = false;
  await page.route("**/api/partners/roster/act_partner_unknown_result", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        partner: { actorId: "act_partner_unknown_result", phoneE164: "+96777000114", role: "partner", enabled: true, securityEnabled: true, activatedAt: reenrollmentReachedCanonicalWriter ? null : "2026-09-20T08:00:00.000Z", actorVersion: 6, roleVersion: reenrollmentReachedCanonicalWriter ? 4 : 3 },
        joiningCase: { id: "join_partner_unknown_result", partnerActorId: "act_partner_unknown_result", state: "approved", version: 9, businessName: "نشاط مستعاد", firstStoreName: "متجر مستعاد", serviceCityId: "sanaa", firstStoreVerticalId: "grocery", firstStoreFulfillmentModes: ["BTHWANI_CAPTAIN"], createdAt: "2026-09-20T08:00:00.000Z", updatedAt: "2026-09-20T08:00:00.000Z" },
      }),
    });
  });
  await page.route("**/api/partners/roster", async (route) => {
    reenrollmentReachedCanonicalWriter = true;
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "DEPENDENCY_UNAVAILABLE" } }) });
  });
  await page.goto("/partners/actors/act_partner_unknown_result");
  await page.getByLabel("سبب الإجراء").fill("تسوية نتيجة إعادة التسجيل");
  await page.getByRole("button", { name: "إجازة إعادة التسجيل" }).click();
  await expect(page.locator("p.identity-error")).toContainText("أُعيد تحميل الحالة الكانونية قبل أي محاولة أخرى");
  await expect(page.getByText("بانتظار التفعيل")).toBeVisible();
  await expect(page.getByRole("button", { name: "إجازة إعادة التسجيل" })).toHaveCount(0);
});

test("operator approves joining terms with the active settlement policy", async ({ page }) => {
  await stubAuthenticatedSession(page);
  let reviewBody: unknown;
  await page.route("**/api/service-cities**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ cities: [{ id: "sanaa", displayNameAr: "صنعاء", active: true, version: 1, createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z" }] }) });
  });
  await page.route("**/api/catalog/verticals**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ verticals: [{ id: "grocery", nameAr: "بقالة", nameEn: "Grocery", catalogModel: "SHARED_CATALOG", active: true, version: 1, createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z" }] }) });
  });
  await page.route("**/api/partners/joining-cases/join_financial", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ case: { id: "join_financial", contactPhoneE164: "+96777000109", businessName: "نشاط مالي", firstStoreName: "متجر مالي", serviceCityId: "sanaa", firstStoreVerticalId: "grocery", firstStoreFulfillmentModes: ["BTHWANI_CAPTAIN"], firstStoreLatitude: 15.369445, firstStoreLongitude: 44.191006, partnerActorId: "act_financial", origin: "field", state: "submitted", financialProfileState: "PENDING_BINDING", version: 2, createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z" }, idempotentReplay: false }) });
  });
  await page.route("**/api/finance/partner-financial-terms-policy", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ policy: { id: "partner_terms_test", policyVersion: "partner-terms-v3", state: "ACTIVE", settlementPeriod: "WEEKLY", version: 3, createdBy: "actor-operator", createdAt: "2026-09-12T00:00:00.000Z", retiredAt: null } }) });
  });
  await page.route("**/api/partners/joining-cases/join_financial/review", async (route) => {
    reviewBody = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ case: { id: "join_financial", contactPhoneE164: "+96777000109", businessName: "نشاط مالي", firstStoreName: "متجر مالي", serviceCityId: "sanaa", firstStoreVerticalId: "grocery", firstStoreFulfillmentModes: ["BTHWANI_CAPTAIN"], firstStoreLatitude: 15.369445, firstStoreLongitude: 44.191006, partnerActorId: "act_financial", origin: "field", state: "approved", settlementPeriod: "WEEKLY", financialProfileId: "financial_profile_test", financialProfileState: "ACTIVE", version: 3, createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z" }, idempotentReplay: false }) });
  });

  await page.goto("/partners/join_financial");
  await expect(page.getByRole("heading", { name: "تفاصيل حالة انضمام الشريك" })).toBeVisible();
  await expect(page.getByText(/سيُعتمد إصدار شروط التسوية partner-terms-v3/)).toBeVisible();
  await page.getByRole("button", { name: "اعتماد الحالة وإنشاء المتجر بالشروط النشطة" }).click();

  await expect(page.getByRole("status").first()).toContainText("الحالة: تمت الموافقة");
  expect(reviewBody).toMatchObject({ decision: "approved", expectedVersion: 2, expectedTermsPolicyVersion: "partner-terms-v3" });
});

test("partner Store publication exposes the canonical readiness block", async ({ page }) => {
  await stubAuthenticatedSession(page);
  await stubCommercialStoreTypes(page);
  const publicationReasons = [
    { code: "PARTNER_IDENTITY_NOT_ELIGIBLE", label: "هوية الشريك أو صلاحية دوره غير جاهزة للنشر" },
    { code: "SERVICE_CITY_NOT_ELIGIBLE", label: "مدينة خدمة المتجر غير مؤهلة للنشر" },
    { code: "CATALOG_NOT_READY", label: "لا يوجد كتالوج أو عرض منشور صالح يجعل المتجر جاهزًا" },
  ] as const;
  let blockedReason: (typeof publicationReasons)[number]["code"] = publicationReasons[0].code;
  await page.route("**/api/service-cities**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ cities: [{ id: "sanaa", displayNameAr: "صنعاء", active: true, version: 1, createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z" }] }) });
  });
  await page.route("**/api/catalog/verticals", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ verticals: [{ id: "grocery", nameAr: "بقالة", nameEn: "Grocery", catalogModel: "SHARED_CATALOG", active: true, version: 1, createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z" }] }) });
  });
  await page.route("**/api/partners/joining-cases/join_test", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
         case: { id: "join_test", contactPhoneE164: "+96777000100", businessName: "نشاط الاختبار", firstStoreName: "متجر الاختبار", serviceCityId: "sanaa", firstStoreVerticalId: "grocery", firstStoreFulfillmentModes: ["BTHWANI_CAPTAIN"], firstStoreLatitude: 15.369445, firstStoreLongitude: 44.191006, partnerActorId: "act_generated", state: "approved", version: 5, store: { id: "store_test", partnerActorId: "act_generated", name: "متجر الاختبار", serviceCityId: "sanaa", primaryVerticalId: "grocery", fulfillmentModes: ["BTHWANI_CAPTAIN"], deliveryOrigin: { latitude: 15.369445, longitude: 44.191006 }, version: 1, publicationState: "unpublished", publicationReadiness: { ready: false, blockedReason: "PARTNER_IDENTITY_NOT_ELIGIBLE" }, offers: [], createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z" }, createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z" },
        idempotentReplay: false,
      }),
    });
  });
  await page.route("**/api/partners/joining-cases", async (route) => {
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
         case: { id: "join_test", contactPhoneE164: "+96777000100", businessName: "نشاط الاختبار", firstStoreName: "متجر الاختبار", serviceCityId: "sanaa", firstStoreVerticalId: "grocery", firstStoreFulfillmentModes: ["BTHWANI_CAPTAIN"], firstStoreLatitude: 15.369445, firstStoreLongitude: 44.191006, partnerActorId: "act_generated", state: "approved", version: 5, store: { id: "store_test", partnerActorId: "act_generated", name: "متجر الاختبار", serviceCityId: "sanaa", primaryVerticalId: "grocery", fulfillmentModes: ["BTHWANI_CAPTAIN"], deliveryOrigin: { latitude: 15.369445, longitude: 44.191006 }, version: 1, publicationState: "unpublished", publicationReadiness: { ready: false, blockedReason: "PARTNER_IDENTITY_NOT_ELIGIBLE" }, offers: [], createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z" }, createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z" },
        idempotentReplay: false,
      }),
    });
  });
  await page.route("**/api/stores/store_test/publication", async (route) => {
     await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ store: { id: "store_test", partnerActorId: "act_generated", name: "متجر الاختبار", serviceCityId: "sanaa", primaryVerticalId: "grocery", fulfillmentModes: ["BTHWANI_CAPTAIN"], version: 1, publicationState: "unpublished", publicationReadiness: { ready: false, blockedReason }, offers: [], createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z" }, idempotentReplay: false }) });
  });
  await page.goto("/partners/new");
  await fillOperatorJoiningCaseForm(page);
  await page.getByRole("checkbox", { name: "توصيل بثواني · مسؤولية المنصة" }).check();
  await page.getByRole("button", { name: "إنشاء حالة انضمام" }).click();
  await page.getByRole("link", { name: "فتح ملف المتجر" }).click();
  await page.getByRole("button", { name: "إعادة قراءة النشر" }).click();
  for (const reason of publicationReasons) {
    blockedReason = reason.code;
    await page.getByRole("button", { name: "إعادة القراءة" }).click();
    await expect(page.getByText(`الجاهزية: ${reason.label}`, { exact: true })).toBeVisible();
  }
  await expect(page.getByRole("button", { name: "نشر المتجر" })).toBeDisabled();
});

test("authenticated workspace keeps navigation meaning across light and dark themes", async ({ page }) => {
  await stubAuthenticatedSession(page, authenticatedOperator.permissions, true);
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.goto("/workspace");

  const lightBackground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await expect(page.getByRole("link", { name: "الوصول والصلاحيات" })).toBeVisible();
  await expect(page.getByRole("main")).toHaveAttribute("id", "workspace-main");

  await page.emulateMedia({ colorScheme: "dark" });
  await page.reload();
  const darkBackground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(darkBackground).not.toBe(lightBackground);
  await expect(page.getByRole("link", { name: "الوصول والصلاحيات" })).toBeVisible();
});

test("operator access exposes passkey-first sign-in and no human-role selector", async ({ page }) => {
  await stubSession(page, 401);
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "الدخول بمفتاح المرور" })).toBeVisible();
  await expect(page.getByLabel("الدور")).toHaveCount(0);
  await expect(page.getByText("مالك المنصة", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "الدخول بمفتاح المرور" })).toBeVisible();
  await expect(page.getByRole("button", { name: "تفعيل حساب موظف" })).toBeVisible();
  await expect(page.getByRole("button", { name: "استرداد الوصول" })).toBeVisible();
});

test("identity service failure is exposed as an alert with a recovery action", async ({ page }) => {
  await stubSession(page, 503);
  await page.goto("/");
  await expect(page.locator("section[role=alert]")).toContainText("تعذر الوصول إلى الهوية");
  await expect(page.getByRole("button", { name: "إعادة المحاولة" })).toBeVisible();
});

test("development operator readiness conflict returns to passkey access", async ({ page }) => {
  await page.route("**/api/auth/session**", async (route) => {
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "CONFLICT" } }),
    });
  });
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "الدخول بمفتاح المرور" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("حساب المشغل غير جاهز لإنشاء جلسة آمنة");
  await expect(page.getByRole("button", { name: "الدخول بمفتاح المرور" })).toBeVisible();
});

test("operator recovery distinguishes recovery credential from phone proof", async ({ page }) => {
  await stubSession(page, 401);
  await page.route("**/api/auth/operator/recovery/request", async (route) => {
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ challenge: { id: "challenge" } }) });
  });
  await page.goto("/");

  await page.getByRole("button", { name: "استرداد الوصول" }).click();
  await expect(page.getByRole("heading", { name: "اطلب إعادة التسجيل" })).toBeVisible();
  await page.getByLabel("رقم الهاتف").fill("96777000100");
  await page.getByLabel("اعتماد الاسترداد").fill("A".repeat(24));
  await page.getByRole("button", { name: "إرسال رمز إثبات الهاتف" }).click();
  await expect(page.getByLabel("رمز إثبات الهاتف")).toBeVisible();
  await expect(page.getByRole("status")).toContainText("اعتماد الاسترداد");
  await expect(page.locator("p.identity-error")).toHaveCount(0);
});

test("remote logout failure keeps local sign-out and remains observable", async ({ page }) => {
  await page.route("**/api/auth/session**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ identity: authenticatedOperator }) });
  });
  await page.route("**/api/auth/logout", async (route) => {
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "IDENTITY_UNAVAILABLE" } }) });
  });
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "الرئيسية" })).toBeVisible();
  await page.getByText("حساب المشغل", { exact: true }).click();
  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await expect(page.getByRole("heading", { name: "الدخول بمفتاح المرور" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("تعذر تأكيد إبطال الجلسة");
  await expect(page.locator("p.identity-error")).toHaveCount(0);
});

test("security headers and cross-origin mutation guard are active", async ({ page }) => {
  await stubSession(page, 401);
  const cspMessages: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && /content security policy|csp/i.test(message.text())) cspMessages.push(message.text());
  });
  page.on("pageerror", (error) => {
    if (/content security policy|csp/i.test(error.message)) cspMessages.push(error.message);
  });

  const response = await page.goto("/");
  expect(response).not.toBeNull();
  const headers = response?.headers() ?? {};
  const csp = headers["content-security-policy"] ?? "";

  expect(csp).toContain("object-src 'none'");
  expect(csp).toContain("base-uri 'self'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(headers["strict-transport-security"]).toContain("max-age=63072000");
  expect(headers["x-frame-options"]).toBe("DENY");

  const developmentPolicy = csp.includes("'unsafe-inline'");
  if (developmentPolicy) {
    expect(csp).toContain("'unsafe-eval'");
  } else {
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).not.toContain("'unsafe-inline'");
    const nonce = csp.match(/'nonce-([^']+)'/)?.[1];
    expect(nonce).toBeTruthy();
    const renderedNonces = await page.locator("script[nonce]").evaluateAll((scripts) => scripts.map((script) => (script as HTMLScriptElement).nonce));
    expect(renderedNonces.length).toBeGreaterThan(0);
    expect(new Set(renderedNonces)).toEqual(new Set([nonce]));
  }

  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { name: /الدخول بمفتاح المرور|تعذر الوصول إلى الهوية/ })).toBeVisible();
  expect(cspMessages).toEqual([]);

  const crossOriginResponse = await page.request.post("/api/catalog/verticals", {
    headers: { Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site" },
  });
  expect(crossOriginResponse.status()).toBe(403);

  const sameOriginHandlerOutcome = await page.evaluate(async () => {
    const response = await fetch("/api/catalog/verticals", { method: "POST" });
    const body = await response.json() as { error?: { code?: string } };
    return { status: response.status, code: body.error?.code };
  });
  expect(
    (sameOriginHandlerOutcome.status === 400 && sameOriginHandlerOutcome.code === "INVALID_INPUT")
      || (sameOriginHandlerOutcome.status === 401 && sameOriginHandlerOutcome.code === "UNAUTHENTICATED"),
  ).toBe(true);
});

test("rendered light and dark themes preserve RTL and keyboard focus", async ({ page }) => {
  await stubSession(page, 401);
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.goto("/");
  const lightBackground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  const passkeyButton = page.getByRole("button", { name: "الدخول بمفتاح المرور" });
  await passkeyButton.focus();
  await expect(passkeyButton).toBeFocused();

  await page.emulateMedia({ colorScheme: "dark" });
  await page.reload();
  const darkBackground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(darkBackground).not.toBe(lightBackground);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
});
