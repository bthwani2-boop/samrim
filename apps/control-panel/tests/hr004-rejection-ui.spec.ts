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
  await expect(page.getByRole("button", { name: "رفض الطلب" })).toBeVisible();
  await page.getByRole("button", { name: "رفض الطلب" }).click();
  await expect(page.getByRole("textbox", { name: "سبب الرفض" })).toBeVisible();
  await page.getByRole("textbox", { name: "سبب الرفض" }).fill("يلزم تصحيح رقم التواصل قبل منح الوصول");
  await page.getByRole("button", { name: "تأكيد الرفض" }).click();
  await expect(page.getByText("رُفض طلب الوصول وسُجل السبب.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "رفض الطلب" })).toHaveCount(0);
  expect(mutationCalls).toBe(1);
});
