import { expect, test } from "@playwright/test";

const rootSession = {
  subject: "act_hr_ui_root", sessionId: "session_hr_ui", role: "operator",
  permissions: ["hr"], canManageOperatorPermissions: true,
  surface: "control-panel", expiresAt: "2099-01-01T00:00:00.000Z",
};
const request = {
  id: "hreq_0123456789abcdef0123456789abcdef",
  employeeId: "emp_0123456789abcdef0123456789abcdef",
  employeeName: "محمود علي الصنعاني", phoneE164: "+967777000466",
  department: "العمليات", jobTitle: "منسق العمليات",
  reason: "طلب صلاحية العمليات لموظف الشركة",
  requestedPermissions: ["operations"], state: "pending_review",
  requestedByActorId: "act_hr_ui", createdAt: "2026-10-12T01:00:00Z", version: 1,
};

test("Root rejects a pending HR request with an attributed reason and updated readback", async ({ page }) => {
  await page.route("**/api/auth/session**", (route) => route.fulfill({
    json: { identity: rootSession },
  }));
  await page.route("**/api/access/operator-profiles?**", (route) => route.fulfill({
    json: { items: [], nextCursor: "" },
  }));
  let current = request;
  await page.route("**/api/access/hr-requests?**", (route) => route.fulfill({
    json: { items: [current], nextCursor: "" },
  }));
  let mutationCalls = 0;
  await page.route("**/api/access/hr-requests/*/reject", (route) => {
    const payload = route.request().postDataJSON() as { expectedVersion: number; reason: string };
    expect(payload.expectedVersion).toBe(1);
    expect(payload.reason).toBe("يلزم تصحيح رقم التواصل قبل منح الوصول");
    expect(route.request().headers()["idempotency-key"]).toBeTruthy();
    mutationCalls += 1;
    current = { ...request, state: "rejected", version: 2 } as typeof request;
    return route.fulfill({ json: { request: { ...current, rejectionReason: payload.reason } } });
  });
  await page.goto("/access?view=requests");
  await expect(page.getByRole("button", { name: "مراجعة التفاصيل" })).toHaveCount(1);
  await page.getByRole("button", { name: "مراجعة التفاصيل" }).click();
  await expect(page.getByRole("region", { name: "تفاصيل طلب الوصول" })).toContainText("الصلاحيات التي اقترحتها HR");
  await expect(page.getByRole("button", { name: "رفض الطلب" })).toBeVisible();
  await page.getByRole("button", { name: "رفض الطلب" }).click();
  await expect(page.getByRole("textbox", { name: "سبب الرفض" })).toBeVisible();
  await page.getByRole("textbox", { name: "سبب الرفض" }).fill("يلزم تصحيح رقم التواصل قبل منح الوصول");
  await page.getByRole("button", { name: "تأكيد الرفض" }).click();
  await expect(page.getByText("رُفض طلب الوصول وسُجل السبب.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "رفض الطلب" })).toHaveCount(0);
  expect(mutationCalls).toBe(1);
});

test("Root can inspect a full page of 50 access requests and paginate without mass action buttons", async ({ page }) => {
  await page.route("**/api/auth/session**", (route) => route.fulfill({ json: { identity: rootSession } }));
  await page.route("**/api/access/operator-profiles?**", (route) => route.fulfill({ json: { items: [], nextCursor: "" } }));
  const records = Array.from({ length: 62 }, (_, index) => ({
    ...request,
    id: "hreq_" + (index + 1).toString(16).padStart(32, "0"),
    employeeId: "emp_" + (index + 1).toString(16).padStart(32, "0"),
    employeeName: "موظف اختبار " + (index + 1),
    state: index % 3 === 0 ? "rejected" : index % 3 === 1 ? "pending_review" : "identity_profile_created",
    rejectionReason: index % 3 === 0 ? "تحتاج البيانات إلى مراجعة" : undefined,
  }));
  await page.route("**/api/access/hr-requests?**", (route) => {
    const second = new URL(route.request().url()).searchParams.get("cursor") === "page-two";
    return route.fulfill({ json: { items: second ? records.slice(50) : records.slice(0, 50), nextCursor: second ? "" : "page-two" } });
  });
  await page.goto("/access?view=requests");
  const section = page.locator(".access-workspace-section").filter({ has: page.getByRole("heading", { name: "طلبات الوصول من الموارد البشرية" }) });
  await expect(section.locator("table tbody tr")).toHaveCount(50);
  await expect(section.getByRole("button", { name: "رفض الطلب" })).toHaveCount(0);
  await section.getByRole("button", { name: "مراجعة التفاصيل" }).nth(1).click();
  await expect(section.getByRole("region", { name: "تفاصيل طلب الوصول" })).toContainText("موظف اختبار 2");
  await section.getByRole("button", { name: "التالي", exact: true }).click();
  await expect(section.locator("table tbody tr")).toHaveCount(12);
  await expect(section.getByRole("region", { name: "تفاصيل طلب الوصول" })).toHaveCount(0);
  await section.getByRole("button", { name: "مراجعة التفاصيل" }).first().click();
  await expect(section.getByRole("region", { name: "تفاصيل طلب الوصول" })).toContainText("موظف اختبار 51");
});
