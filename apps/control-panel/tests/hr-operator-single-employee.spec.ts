import { expect, test } from "@playwright/test";

const employee = {
  id: "emp_f71b55bff9c1c25099d43a792b4d058c",
  fullNameAr: "محمود علي عبدالله الصنعاني",
  phoneE164: "+967777104052",
  department: "العمليات",
  jobTitle: "مشرف العمليات",
  managerEmployeeId: null,
  startDate: "2026-10-12",
  workLocation: "صنعاء",
  status: "active",
  operatorActorId: "act_operator_access_proof",
  version: 3,
  createdAt: "2026-10-12T00:00:00Z",
};
const root = { subject: "act_root_access_proof", role: "operator", sessionId: "session_root_proof",
  surface: "control-panel", permissions: ["hr"], canManageOperatorPermissions: true, expiresAt: "2099-01-01T00:00:00Z" };

test("the same employee retains HR status when Root disables operator access", async ({ page }) => {
  await page.route("**/api/auth/session**", (route) => route.fulfill({ json: { identity: root } }));
  await page.route("**/api/hr/employees?**", (route) => route.fulfill({ json: { items: [employee], nextCursor: "" } }));
  await page.route("**/api/hr/access-requests?**", (route) => route.fulfill({ json: { items: [], nextCursor: "" } }));
  let enabled = true;
  let version = 2;
  let changed = 0;
  await page.route("**/api/hr/employees/*/operator-access", async (route) => {
    if (route.request().method() === "POST") {
      const payload = route.request().postDataJSON() as { action: string; reason: string; expectedVersion: number };
      expect(payload.action).toBe("disable");
      expect(payload.reason.length).toBeGreaterThanOrEqual(8);
      expect(payload.expectedVersion).toBe(2);
      enabled = false;
      version++;
      changed++;
    }
    await route.fulfill({ json: { employee, role: { actorId: employee.operatorActorId, role: "operator", enabled, roleVersion: version } } });
  });
  await page.route("**/api/hr/employees/" + employee.id, route => route.fulfill({json:{employee}}));
  await page.goto("/hr/employees");
  await page.getByRole("button",{name:"فتح ملف " + employee.fullNameAr}).first().click();
  await expect(page.getByText(employee.fullNameAr).first()).toBeVisible();
  await page.getByRole("tab",{name:"الوصول والصلاحيات"}).click();
  await page.getByRole("button", { name: "إدارة صلاحية تشغيل الموظف" }).click();
  await expect(page.getByText("وصول التشغيل مفعّل")).toBeVisible();
  await page.getByLabel("سبب قرار صلاحية التشغيل").fill("إيقاف صلاحية تشغيل الموظف مؤقتًا للتحقق");
  await page.getByRole("button", { name: "إيقاف وصول التشغيل وإبطال الجلسات" }).click();
  await expect(page.getByText("وصول التشغيل موقوف")).toBeVisible();
  await expect(page.getByText("أوقف وصول التشغيل وأبطلت جلساته النشطة.", { exact: false })).toBeVisible();
  expect(changed).toBe(1);
});

test("HR-only staff cannot see the Root operator management action", async ({ page }) => {
  await page.route("**/api/auth/session**", (route) => route.fulfill({ json: { identity: { ...root, canManageOperatorPermissions: false } } }));
  await page.route("**/api/hr/employees?**", (route) => route.fulfill({ json: { items: [employee], nextCursor: "" } }));
  await page.route("**/api/hr/access-requests?**", (route) => route.fulfill({ json: { items: [], nextCursor: "" } }));
  await page.route("**/api/hr/employees/" + employee.id, route => route.fulfill({json:{employee}}));
  await page.goto("/hr/employees");
  await page.getByRole("button",{name:"فتح ملف " + employee.fullNameAr}).first().click();
  await page.getByRole("tab",{name:"الوصول والصلاحيات"}).click();
  await expect(page.getByRole("button", { name: "إدارة صلاحية تشغيل الموظف" })).toHaveCount(0);
});
