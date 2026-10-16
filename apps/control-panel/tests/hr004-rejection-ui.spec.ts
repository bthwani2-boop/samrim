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

test("Root rejects an HR request with reason and canonical list readback in the unified drawer", async ({ page }) => {
  await page.route("**/api/auth/session**", (route) => route.fulfill({ json: { identity: rootSession } }));
  await page.route("**/api/access/operator-profiles?**", (route) => route.fulfill({ json: { items: [], nextCursor: "" } }));
  await page.route("**/api/access/operators?**", (route) => route.fulfill({ json: { items: [], nextCursor: "" } }));
  let current = request;
  await page.route("**/api/access/hr-requests?**", (route) => route.fulfill({ json: { items: [current], nextCursor: "" } }));
  let mutationCalls = 0;
  await page.route("**/api/access/hr-requests/*/reject", (route) => {
    const payload = route.request().postDataJSON() as { expectedVersion: number; reason: string };
    expect(payload.expectedVersion).toBe(1);
    expect(payload.reason).toBe("يلزم تصحيح رقم التواصل قبل منح الوصول");
    expect(route.request().headers()["idempotency-key"]).toBeTruthy();
    mutationCalls += 1;
    current = { ...request, state: "rejected", version: 2 };
    return route.fulfill({ json: { request: { ...current, rejectionReason: payload.reason } } });
  });
  await page.goto("/access?view=requests");
  await page.getByRole("button", { name: "مراجعة الطلب" }).click();
  await expect(page.locator(".adaptive-record-detail")).toContainText("طلب صلاحية العمليات");
  const reason = page.getByRole("textbox", { name: "سبب رفض الطلب" });
  await expect(reason).toHaveAttribute("class", /ds-textarea.*resize-none/);
  expect(await reason.evaluate((element) => getComputedStyle(element).resize)).toBe("none");
  await reason.fill("يلزم تصحيح رقم التواصل قبل منح الوصول");
  await page.getByRole("button", { name: "رفض الطلب مع السبب" }).click();
  await expect(page.locator(".access-center-table tbody tr")).toContainText("طلب مرفوض");
  await expect(page.getByText("رُفض الطلب مع تسجيل السبب.")).toBeVisible();
  expect(mutationCalls).toBe(1);
});

test("bounded HR pages remain manageable without bulk decisions or false totals", async ({ page }) => {
  await page.route("**/api/auth/session**", (route) => route.fulfill({ json: { identity: rootSession } }));
  await page.route("**/api/access/operator-profiles?**", (route) => route.fulfill({ json: { items: [], nextCursor: "" } }));
  await page.route("**/api/access/operators?**", (route) => route.fulfill({ json: { items: [], nextCursor: "" } }));
  const records = Array.from({ length: 62 }, (_, index) => ({
    ...request, id: "hreq_" + (index + 1).toString(16).padStart(32, "0"),
    employeeId: "emp_" + (index + 1).toString(16).padStart(32, "0"),
    employeeName: "موظف اختبار " + (index + 1),
    state: index % 3 === 0 ? "rejected" : index % 3 === 1 ? "pending_review" : "identity_profile_created",
  }));
  await page.route("**/api/access/hr-requests?**", (route) => {
    const second = new URL(route.request().url()).searchParams.get("cursor") === "page-two";
    return route.fulfill({ json: { items: second ? records.slice(50) : records.slice(0, 50), nextCursor: second ? "" : "page-two" } });
  });
  await page.goto("/access?view=requests");
  await expect(page.locator(".access-center-table tbody tr")).toHaveCount(50);
  await expect(page.getByRole("button", { name: "رفض الطلب مع السبب" })).toHaveCount(0);
  await page.locator(".access-center-table tbody tr").filter({ hasText: /موظف اختبار 2(?!\d)/ }).getByRole("button").click();
  await expect(page.locator(".adaptive-record-detail")).toContainText("موظف اختبار 2");
  await page.getByRole("button", { name: "إغلاق التفاصيل" }).click();
  await page.getByRole("button", { name: "تحميل المزيد" }).click();
  await expect(page.locator(".access-center-table tbody tr")).toHaveCount(62);
  await expect(page.locator(".access-center-footer")).toContainText("62 سجلًا");
});
