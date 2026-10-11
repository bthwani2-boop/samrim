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
