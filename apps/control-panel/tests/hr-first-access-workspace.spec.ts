import { expect, test } from "@playwright/test";

const root = {
  subject: "act_root_hr_first_test", sessionId: "session_hr_first",
  role: "operator", permissions: ["hr"], canManageOperatorPermissions: true,
  surface: "control-panel", expiresAt: "2099-01-01T00:00:00.000Z",
};

test("access is one operational registry: linked request and profile do not duplicate the operator", async ({ page }) => {
  await page.route("**/api/auth/session**", (route) => route.fulfill({ json: { identity: root } }));
  await page.route("**/api/access/hr-requests?**", (route) => route.fulfill({ json: {
    items: [{
      id: "request-linked", employeeId: "employee-linked", employeeName: "محمود",
      phoneE164: "+967777000111", jobTitle: "مشرف", department: "العمليات", reason: "العمل",
      requestedPermissions: ["operations"], requestedByActorId: "hr",
      state: "identity_profile_created", operatorProfileId: "profile-linked",
      operatorActorId: "actor-linked", createdAt: "2026-10-10T10:00:00Z", version: 2,
    }, {
      id: "request-pending", employeeId: "employee-pending", employeeName: "أحمد التجريبي",
      phoneE164: "+967777000222", jobTitle: "موظف", department: "المالية",
      reason: "العمل المالي", requestedPermissions: ["finance"], requestedByActorId: "hr",
      state: "pending_review", createdAt: "2026-10-11T10:00:00Z", version: 1,
    }], nextCursor: "",
  } }));
  await page.route("**/api/access/operator-profiles?**", (route) => route.fulfill({ json: { items: [{
    id: "profile-linked", fullNameAr: "محمود", phoneE164: "+967777000111",
    jobTitle: "مشرف", department: "العمليات", state: "admitted", actorId: "actor-linked",
    roleEnabled: true, securityEnabled: true, activatedAt: "2026-10-12T00:00:00Z",
    version: 2, createdAt: "2026-10-11T00:00:00Z", updatedAt: "2026-10-12T00:00:00Z",
  }], nextCursor: "" } }));
  await page.route("**/api/access/operators?**", (route) => route.fulfill({ json: { items: [{
    actorId: "actor-linked", phoneE164: "+967777000111", fullNameAr: "محمود",
    jobTitle: "مشرف", department: "العمليات", enabled: true, activatedAt: "2026-10-12T00:00:00Z",
    securityEnabled: true, createdAt: "2026-10-11T00:00:00Z", role: "operator",
    actorVersion: 1, roleVersion: 1, operatorEnabledPermissionCount: 1,
  }], nextCursor: "" } }));
  await page.goto("/access");
  await expect(page.getByRole("region", { name: "السجل الموحد للوصول والصلاحيات" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "أقسام الوصول والصلاحيات" })).toHaveCount(0);
  await expect(page.locator(".access-center-table tbody tr")).toHaveCount(2);
  await expect(page.locator(".access-center-table tbody tr").filter({ hasText: "محمود" })).toHaveCount(1);
  await page.locator(".access-center-table tbody tr").filter({ hasText: "محمود" }).getByRole("button", { name: "مراجعة الصلاحيات" }).click();
  await expect(page.getByRole("region", { name: "طلب الوصول المرتبط" })).toContainText("العمل");
  await expect(page.getByRole("region", { name: "طلب الوصول المرتبط" }).getByRole("button", { name: "مراجعة الصلاحيات" })).toBeVisible();
  await page.getByRole("button", { name: "إغلاق التفاصيل" }).click();
  await page.locator(".access-center-table tbody tr").filter({ hasText: "أحمد التجريبي" }).getByRole("button", { name: "مراجعة الطلب" }).click();
  await expect(page.locator(".adaptive-record-detail")).toContainText("العمل المالي");
  await expect(page.locator(".adaptive-record-detail")).toContainText("مقترحة");
  await page.getByRole("button", { name: "إغلاق التفاصيل" }).click();
  await page.getByRole("button", { name: "تحتاج متابعة" }).click();
  await expect(page.locator(".access-center-table tbody tr")).toHaveCount(1);
});

test("unauthenticated direct operator profile creation stays blocked", async ({ page }) => {
  await page.goto("/access");
  const result = await page.evaluate(async () => {
    const response = await fetch("/api/access/operator-profiles", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fullNameAr: "لا يجوز الإنشاء", phoneE164: "+967755111111", jobTitle: "مشرف", department: "العمليات" }),
    });
    return response.status;
  });
  expect([403, 405]).toContain(result);
});

test("root can review HR proposals and apply an explicit subset in Identity without an extra page", async ({ page }) => {
  const id = "hreq_11111111111111111111111111111111";
  const request = {
    id, employeeId: "emp_11111111111111111111111111111111",
    employeeName: "محمود علي", phoneE164: "+967777104052",
    department: "العمليات", jobTitle: "مشرف العمليات",
    requestedPermissions: ["operations", "partners"],
    reason: "إدارة العمليات اليومية", state: "identity_profile_created",
    operatorProfileId: "oprof_proof", operatorActorId: "act_proof",
    version: 4, requestedByActorId: "act_hr", createdAt: "2026-10-12T00:00:00Z",
  };
  await page.route("**/api/auth/session**", (route) => route.fulfill({ json: { identity: root } }));
  await page.route("**/api/access/hr-requests?**", (route) => route.fulfill({ json: { items: [request], nextCursor: "" } }));
  await page.route("**/api/access/operator-profiles?**", (route) => route.fulfill({ json: { items: [], nextCursor: "" } }));
  await page.route("**/api/access/operators?**", (route) => route.fulfill({ json: { items: [], nextCursor: "" } }));
  let changed = 0;
  await page.route("**/api/access/hr-requests/*/permissions", (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({ json: { requestId: id, actorId: "act_proof", requestVersion: 4,
        requestedPermissions: request.requestedPermissions, grantedPermissions: [] } });
    }
    const body = route.request().postDataJSON() as { approvedPermissions: string[]; reason: string; expectedVersion: number };
    expect(body.approvedPermissions).toEqual(["operations"]);
    expect(body.expectedVersion).toBe(4);
    changed += 1;
    return route.fulfill({ json: { requestId: id, actorId: "act_proof", requestVersion: 4,
      requestedPermissions: request.requestedPermissions, grantedPermissions: ["operations"] } });
  });
  await page.goto("/access");
  await page.getByRole("button", { name: "عرض حالة الطلب" }).click();
  await page.getByRole("button", { name: "مراجعة الصلاحيات" }).click();
  await expect(page.getByText("الممنوحة فعليًا:", { exact: false })).toBeVisible();
  await page.getByRole("checkbox", { name: "العمليات" }).check();
  await page.getByRole("button", { name: "تطبيق الصلاحيات المحددة" }).click();
  await expect(page.getByText("تم تطبيق القرار في Identity وتأكيد الصلاحيات الممنوحة.")).toBeVisible();
  expect(changed).toBe(1);
});

test("non-administrator sees no operator records or bulk management actions", async ({ page }) => {
  await page.route("**/api/auth/session**", (route) => route.fulfill({ json: { identity: { ...root, canManageOperatorPermissions: false } } }));
  let calls = 0;
  await page.route("**/api/access/*", (route) => { calls += 1; return route.fulfill({ status: 403 }); });
  await page.goto("/access");
  await expect(page.getByText("الوصول إلى هذه المساحة غير مفعّل")).toBeVisible();
  expect(calls).toBe(0);
});


test("unified account paging is bounded and operator search/cursors never leak into the URL", async ({ page }) => {
  await page.route("**/api/auth/session**", (route) => route.fulfill({ json: { identity: root } }));
  await page.route("**/api/access/hr-requests?**", (route) => route.fulfill({ json: { items: [], nextCursor: "" } }));
  await page.route("**/api/access/operator-profiles?**", (route) => route.fulfill({ json: { items: [], nextCursor: "" } }));
  const calls: URL[] = [];
  await page.route("**/api/access/operators?**", (route) => {
    const url = new URL(route.request().url());
    calls.push(url);
    expect(url.searchParams.get("limit")).toBe("25");
    const start = url.searchParams.get("cursor") ? 25 : 0;
    const items = Array.from({ length: 25 }, (_, i) => {
      const index = start + i;
      return {
        actorId: "actor-" + index, phoneE164: "+96777" + String(index).padStart(7, "0"),
        fullNameAr: "مشغّل " + index, role: "operator", enabled: true, securityEnabled: true,
        activatedAt: "2026-10-01T00:00:00Z", createdAt: "2026-09-30T00:00:00Z",
        actorVersion: 1, roleVersion: 1, operatorEnabledPermissionCount: 2,
      };
    });
    return route.fulfill({ json: { items, nextCursor: start ? "" : "private-operator-cursor" } });
  });
  await page.goto("/access?view=permissions");
  await expect(page.locator(".access-center-table tbody tr")).toHaveCount(25);
  await page.getByRole("button", { name: "تحميل المزيد" }).click();
  await expect(page.locator(".access-center-table tbody tr")).toHaveCount(50);
  expect(calls.some((url) => url.searchParams.get("cursor") === "private-operator-cursor")).toBe(true);
  expect(page.url()).not.toContain("private-operator-cursor");
  const input = page.getByRole("textbox", { name: "بحث عن موظف أو مشغّل" });
  await input.fill("+967770000001");
  await input.press("Enter");
  await expect.poll(() => calls.some((url) => url.searchParams.get("q") === "+967770000001" && !url.searchParams.has("cursor"))).toBe(true);
  expect(page.url()).not.toContain("+967770000001");
  await page.getByLabel("تصفية حسب نطاق الصلاحيات").selectOption("some");
  await expect.poll(() => calls.some((url) => url.searchParams.get("permissionCoverage") === "some" && !url.searchParams.has("cursor"))).toBe(true);
  await expect(page.locator(".access-center-table tbody tr")).toHaveCount(25);
});


test("granting a role keeps its single actionable profile visible through invitation", async ({ page }) => {
  await page.route("**/api/auth/session**", (route) => route.fulfill({ json: { identity: root } }));
  await page.route("**/api/access/hr-requests?**", (route) => route.fulfill({ json: { items: [], nextCursor: "" } }));
  const actorId = "actor-invite-proof";
  let profile = {
    id: "profile-invite", fullNameAr: "موظف الدعوة", phoneE164: "+967777000321",
    jobTitle: "مشرف عمليات", department: "العمليات", state: "pending_review",
    version: 1, roleEnabled: false, securityEnabled: true, activatedAt: null as string | null,
    actorId: undefined as string | undefined,
    createdAt: "2026-10-12T00:00:00Z", updatedAt: "2026-10-12T00:00:00Z",
  };
  let grants = 0;
  let invitations = 0;
  await page.route("**/api/access/operator-profiles**", (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { items: [profile], nextCursor: "" } });
    const { action, expectedVersion } = route.request().postDataJSON() as { action: string; expectedVersion?: number };
    if (action === "approve" && expectedVersion === 1) {
      profile = { ...profile, state: "approved", version: 2 };
      return route.fulfill({ json: { profile } });
    }
    if (action === "grant" && expectedVersion === 2) {
      grants += 1;
      profile = { ...profile, state: "admitted", version: 3, roleEnabled: true, actorId };
      return route.fulfill({ status: 201, json: { profile, role: { actorId } } });
    }
    if (action === "invitation" && profile.state === "admitted") {
      invitations += 1;
      return route.fulfill({ status: 201, json: { profile, enrollmentToken: { code: "one-time-invitation-proof" } } });
    }
    return route.fulfill({ status: 409 });
  });
  await page.route("**/api/access/operators?**", (route) => route.fulfill({ json: { items: grants ? [{
    actorId, phoneE164: profile.phoneE164, fullNameAr: profile.fullNameAr,
    jobTitle: profile.jobTitle, department: profile.department,
    role: "operator", enabled: true, securityEnabled: true, activatedAt: undefined,
    createdAt: profile.createdAt, actorVersion: 1, roleVersion: 1,
    operatorEnabledPermissionCount: 0,
  }] : [], nextCursor: "" } }));
  await page.goto("/access");
  await page.locator(".access-center-table").getByRole("button", { name: "اعتماد الملف" }).click();
  const dialog = page.locator(".adaptive-record-detail");
  await dialog.getByRole("button", { name: "اعتماد الملف" }).click();
  await expect(dialog.getByRole("button", { name: "منح الدور" })).toBeVisible();
  await dialog.getByRole("button", { name: "منح الدور" }).click();
  await expect(page.locator(".access-center-table tbody tr")).toHaveCount(1);
  await expect(dialog.getByRole("button", { name: "إصدار دعوة" })).toBeVisible();
  await dialog.getByRole("button", { name: "إصدار دعوة" }).click();
  await expect(dialog).toContainText("one-time-invitation-proof");
  expect(grants).toBe(1);
  expect(invitations).toBe(1);
});


test("access registry stays usable on a narrow Arabic screen without page-level overflow", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/auth/session**", (route) => route.fulfill({ json: { identity: root } }));
  await page.route("**/api/access/hr-requests?**", (route) => route.fulfill({ json: { items: [], nextCursor: "" } }));
  await page.route("**/api/access/operator-profiles?**", (route) => route.fulfill({ json: { items: [{
    id: "profile-mobile", fullNameAr: "موظف ميداني تجريبي", phoneE164: "+967777000989",
    jobTitle: "مراجع", department: "الموارد البشرية", state: "pending_review",
    version: 1, securityEnabled: true, roleEnabled: false,
    createdAt: "2026-10-12T00:00:00Z", updatedAt: "2026-10-12T00:00:00Z",
  }], nextCursor: "" } }));
  await page.route("**/api/access/operators?**", (route) => route.fulfill({ json: { items: [], nextCursor: "" } }));
  await page.goto("/access");
  await expect(page.locator(".access-center-table tbody tr")).toHaveCount(1);
  await expect(page.locator(".access-center-table")).toBeHidden();
  await expect(page.locator(".access-center-mobile > li")).toHaveCount(1);
  const geometry = await page.evaluate(() => ({
    page: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));
  expect(geometry.page).toBeLessThanOrEqual(geometry.viewport + 1);
  await page.locator(".access-center-mobile").getByRole("button", { name: "اعتماد الملف" }).click();
  await expect(page.locator(".adaptive-record-workspace")).toHaveAttribute("data-split", "false");
  await expect(page.locator(".adaptive-record-detail")).toBeVisible();
  await expect(page.locator(".adaptive-record-detail").getByRole("button", { name: "إغلاق التفاصيل" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("access-center-mobile.png"), fullPage: true });
});
