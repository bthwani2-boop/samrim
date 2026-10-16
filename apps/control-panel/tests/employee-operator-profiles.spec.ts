import { expect, type Page, test } from "@playwright/test";
import { operatorWorkspacePermissions } from "../src/session/operator-permissions";

const employeeId = "emp_" + "a".repeat(32);
const operatorPhone = "+967777000100";
const employee = {
  id: employeeId, fullNameAr: "موظف تجريبي", phoneE164: operatorPhone,
  department: "العمليات", jobTitle: "مشغّل عمليات", managerEmployeeId: "",
  startDate: "2026-10-01", workLocation: "صنعاء",
  status: "active", version: 2, operatorActorId: "actor-test-1",
  createdAt: "2026-10-01T09:00:00Z",
};

async function session(page: Page, permissions: string[] = ["hr", "operations"], root = true) {
  await page.route("**/api/auth/session**", (route) => route.fulfill({
    json: { identity: {
      subject: "root-test", sessionId: "session-test", role: "operator",
      permissions, canManageOperatorPermissions: root, surface: "control-panel", expiresAt: "2099-01-01T00:00:00Z",
    } },
  }));
  await page.route("**/api/notifications**", (route) => route.fulfill({ json: { notifications: [], unreadCount: 0 } }));
}

test("employee has a full dedicated file linked from the HR directory", async ({ page }, testInfo) => {
  await session(page);
  await page.route("**/api/hr/employees?**", (route) => route.fulfill({ json: { items: [employee], nextCursor: "" } }));
  await page.route("**/api/hr/employees/" + employeeId, (route) => route.fulfill({ json: { employee } }));
  await page.route("**/api/hr/access-requests?**", (route) => route.fulfill({ json: { items: [] } }));
  await page.route("**/api/hr/employees/" + employeeId + "/attendance?**", (route) => route.fulfill({ json: { items: [] } }));
  await page.goto("/hr/employees");
  const openEmployee = page.getByRole("button", { name: "فتح ملف موظف تجريبي" }).first();
  await openEmployee.click();
  await expect(page).toHaveURL(new RegExp("/hr/employees\\?employee=" + employeeId));
  await expect(page.getByRole("heading", { name: "موظف تجريبي", exact: true })).toBeVisible();
  await expect(page.getByText("مشغّل عمليات").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "فتح ملف المشغّل" })).toHaveAttribute("href", "/access/operators/%2B967777000100");
  await expect(page.getByRole("tab", { name: "نظرة عامة" })).toHaveAttribute("aria-selected", "true");
  await page.screenshot({ path: testInfo.outputPath("employee-overview.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { name: "موظف تجريبي", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("employee-inline-mobile.png"), fullPage: false });
  await page.getByRole("tab", { name: "الأداء" }).click();
  await expect(page.getByText("مؤشرات الالتزام المسجلة")).toBeVisible();
  await page.getByRole("tab", { name: "الحضور", exact: true }).click();
  await expect(page.getByRole("heading", { name: "الحضور اليومي" })).toBeVisible();
  await page.getByRole("button", { name: "إغلاق التفاصيل" }).click();
  await expect(page).toHaveURL("/hr/employees");
  await expect(openEmployee).toBeFocused();
  await expect(page.getByRole("heading", { name: "الموارد البشرية" })).toBeVisible();
});

test("employee profile editor keeps required-field validation in the application", async ({ page }) => {
  await session(page);
  await page.route("**/api/hr/employees/" + employeeId, (route) => route.fulfill({ json: { employee } }));
  await page.goto("/hr/employees/" + employeeId);
  await page.getByRole("tab", { name: "البيانات الوظيفية" }).click();
  await page.getByRole("button", { name: "تعديل البيانات" }).click();
  const form = page.locator("form.access-create-form");
  await expect(form).toHaveAttribute("novalidate", "");
  await page.getByRole("textbox", { name: "الاسم الكامل" }).fill(" ");
  await page.getByRole("button", { name: "حفظ التغييرات" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "أكمل الاسم والقسم والمسمى وموقع العمل وتاريخ البداية" })).toBeVisible();
  await expect(form).toBeVisible();
});

test("employee attendance reports invalid reasons through the application", async ({ page }) => {
  await session(page);
  await page.route("**/api/hr/employees/" + employeeId, (route) => route.fulfill({ json: { employee } }));
  await page.route("**/api/hr/employees/" + employeeId + "/attendance?**", (route) => route.fulfill({ json: { items: [] } }));
  await page.goto("/hr/employees/" + employeeId);
  await page.getByRole("tab", { name: "الحضور", exact: true }).click();
  const form = page.getByRole("region", { name: "الحضور اليدوي" }).locator("form");
  await expect(form).toHaveAttribute("novalidate", "");
  await form.evaluate((element) => (element as HTMLFormElement).requestSubmit());
  await expect(page.getByRole("alert").filter({ hasText: "اكتب سببًا واضحًا من 8 إلى 500 حرف" })).toBeVisible();
});

test("employee file keeps its tabs in one accessible row on a narrow screen", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await session(page);
  await page.route("**/api/hr/employees/" + employeeId, (route) => route.fulfill({ json: { employee } }));
  await page.goto("/hr/employees/" + employeeId);
  await expect(page.getByRole("heading", { name: employee.fullNameAr })).toBeVisible();
  const tablist = page.getByRole("tablist", { name: "أقسام الملف" });
  const offsets = await tablist.getByRole("tab").evaluateAll((elements) => elements.map((item) => Math.round(item.getBoundingClientRect().top)));
  expect(new Set(offsets).size).toBe(1);
  await page.getByRole("tab", { name: "سجل التغييرات" }).click();
  await expect(page.getByRole("tabpanel", { name: "سجل التغييرات" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("employee-mobile.png"), fullPage: true });
});

test("employee overview follows the dark design tokens without light cards", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("bthwani.control-panel.appearance", "dark");
    document.documentElement.dataset.theme = "dark";
  });
  await session(page);
  await page.route("**/api/hr/employees/" + employeeId, (route) => route.fulfill({ json: { employee } }));
  await page.goto("/hr/employees/" + employeeId);
  await expect(page.getByRole("heading", { name: employee.fullNameAr })).toBeVisible();
  const tile = page.getByRole("region", { name: "ملخص الموظف" }).locator("div").first();
  const palette = await tile.evaluate((element) => ({
    background: getComputedStyle(element).backgroundColor,
    color: getComputedStyle(element.querySelector("strong")!).color,
  }));
  expect(palette.background).not.toBe("rgb(255, 255, 255)");
  expect(palette.color).not.toEqual(palette.background);
  await page.screenshot({ path: testInfo.outputPath("employee-dark.png"), fullPage: true });
});

test("operator management file exposes canonical identity and linked HR record", async ({ page }, testInfo) => {
  await session(page);
  await page.route("**/api/access/managed-user/status?**", (route) => route.fulfill({
    json: {
      role: "operator", actorId: "actor-test-1", exists: true, fullNameAr: employee.fullNameAr,
      phoneE164: operatorPhone, enabled: true, activated: true, securityEnabled: true, state: "active",
      roleVersion: 2, actorVersion: 2, jobTitle: employee.jobTitle, department: employee.department,
      lastAuthenticatedAt: "2026-10-15T08:00:00Z", operatorPermissions: Object.fromEntries(operatorWorkspacePermissions.map(({ key }) => [key, { enabled: true, version: 2, reason: "مراجعة موثقة" }])),
    },
  }));
  await page.route("**/api/hr/operator-employees/actor-test-1", (route) => route.fulfill({ json: { employee } }));
  await page.goto("/access/operators/%2B967777000100");
  await expect(page.getByRole("heading", { name: employee.fullNameAr })).toBeVisible();
  await expect(page.getByText("آخر دخول موثّق")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("operator-overview.png"), fullPage: true });
  await page.getByRole("button", { name: /إدارة الصلاحيات والحساب/ }).click();
  await expect(page.getByRole("tab", { name: "الصلاحيات والتحكم" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "الملف الوظيفي" }).click();
  await expect(page.getByRole("link", { name: "فتح ملف الموظف" })).toHaveAttribute("href", "/hr/employees/" + employeeId);
  await page.getByRole("tab", { name: "الأداء" }).click();
  await expect(page.getByRole("heading", { name: "الأداء التشغيلي" })).toBeVisible();
  await page.getByRole("tab", { name: "الصلاحيات والتحكم" }).click();
  await expect(page.getByText("نطاقات الوصول")).toBeVisible();
  await expect(page.getByText("تغيير حالة الحساب")).toBeVisible();
});

test("operator file is not visible to a non-administrator", async ({ page }) => {
  await session(page, ["hr"], false);
  let called = false;
  await page.route("**/api/access/managed-user/status?**", (route) => {
    called = true;
    return route.abort();
  });
  await page.goto("/access/operators/%2B967777000100");
  await expect(page.getByRole("status").filter({ hasText: "الوصول إلى هذه المساحة غير مفعّل" })).toBeVisible();
  expect(called).toBe(false);
});

test("employee file reports an HR permission refusal without displaying employee data", async ({ page }) => {
  await session(page, ["hr"], false);
  await page.route("**/api/hr/employees/" + employeeId, (route) => route.fulfill({ status: 403, json: { error: { code: "FORBIDDEN" } } }));
  await page.goto("/hr/employees/" + employeeId);
  await expect(page.getByRole("alert").filter({ hasText: "ليست لديك صلاحية" })).toBeVisible();
  await expect(page.getByRole("heading", { name: employee.fullNameAr })).toHaveCount(0);
});
