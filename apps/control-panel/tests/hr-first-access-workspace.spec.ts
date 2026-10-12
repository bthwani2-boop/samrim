import { expect, test } from "@playwright/test";

const root = {
  subject: "act_root_hr_first_test", sessionId: "session_hr_first",
  role: "operator", permissions: ["hr"], canManageOperatorPermissions: true,
  surface: "control-panel", expiresAt: "2099-01-01T00:00:00.000Z",
};

test("access workspace begins at HR requests and never offers manual operator creation", async ({ page }) => {
  await page.route("**/api/auth/session**", (route) => route.fulfill({ json: { identity: root } }));
  await page.route("**/api/access/hr-requests?**", (route) => route.fulfill({ json: { items: [], nextCursor: "" } }));
  await page.route("**/api/access/operator-profiles?**", (route) => route.fulfill({ json: {
    items: [{ id: "oprof_existing", fullNameAr: "مشغّل معتمد سابق", phoneE164: "+967755000006", jobTitle: "", department: "", state: "admitted", actorId: "act_existing", roleEnabled: true, securityEnabled: true, activatedAt: "2026-10-07T00:00:00Z", version: 3, createdAt: "2026-10-07T00:00:00Z" }],
    nextCursor: "",
  } }));
  await page.goto("/access");
  await expect(page.getByRole("navigation", { name: "أقسام الوصول والصلاحيات" }).getByRole("link", { name: "طلبات الوصول" })).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".access-summary-grid article")).toHaveCount(4);
  await expect(page.getByText("مشغّل جديد")).toHaveCount(0);
  await page.getByRole("link", { name: "حسابات المشغّلين" }).click();
  await expect(page.getByText("مشغّل معتمد سابق")).toBeVisible();
  await expect(page.getByText("مشغّل جديد")).toHaveCount(0);
  await expect(page.locator("#operator-profile-name")).toHaveCount(0);
  await expect(page.getByText("تعديل الملف", { exact: true })).toHaveCount(0);
});

test("legacy direct operator profile creation endpoint is absent", async ({ page }) => {
  await page.goto("/access");
  const result = await page.evaluate(async () => {
    const res = await fetch("/api/access/operator-profiles", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fullNameAr: "لا يجوز الإنشاء", phoneE164: "+967755111111", jobTitle: "مشرف", department: "العمليات" }),
    });
    return res.status;
  });
  expect(result).toBe(405);
});

test("Root reviews requested against actual Identity permissions, then applies an explicit subset", async ({ page }) => {
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
  let changed = 0;
  await page.route("**/api/access/hr-requests/*/permissions", (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({ json: { requestId: id, actorId: "act_proof", requestVersion: 4,
        requestedPermissions: request.requestedPermissions, grantedPermissions: [],
        permissions: [{ permission: "operations", enabled: false, version: 1 }, { permission: "partners", enabled: false, version: 1 }] } });
    }
    const body = route.request().postDataJSON() as { approvedPermissions: string[]; reason: string; expectedVersion: number };
    expect(body.approvedPermissions).toEqual(["operations"]);
    expect(body.expectedVersion).toBe(4);
    expect(body.reason.length).toBeGreaterThanOrEqual(8);
    changed += 1;
    return route.fulfill({ json: { requestId: id, actorId: "act_proof", requestVersion: 4,
      requestedPermissions: request.requestedPermissions, grantedPermissions: ["operations"],
      permissions: [{ permission: "operations", enabled: true, version: 2 }, { permission: "partners", enabled: false, version: 1 }] } });
  });
  await page.goto("/access?view=requests");
  await page.getByRole("button", { name: "مراجعة التفاصيل" }).click();
  await page.getByRole("button", { name: "مراجعة الصلاحيات" }).click();
  await expect(page.getByText("الممنوحة فعليًا:", { exact: false })).toBeVisible();
  const checkbox = page.getByRole("checkbox", { name: "العمليات" });
  await expect(checkbox).not.toBeChecked();
  await checkbox.check();
  await page.getByRole("button", { name: "تطبيق الصلاحيات المحددة" }).click();
  await expect(page.getByText("تم تطبيق القرار في Identity وتأكيد الصلاحيات الممنوحة.")).toBeVisible();
  expect(changed).toBe(1);
});
