import { expect, test, type Page } from "@playwright/test";

async function stubSession(page: Page, status: number) {
  await page.route("**/api/auth/session**", async (route) => {
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(status === 401 ? { error: { code: "UNAUTHENTICATED" } } : { error: { code: "IDENTITY_UNAVAILABLE" } }),
    });
  });
}

test("phone-first operator sign-in exposes named controls and the second step", async ({ page }) => {
  await stubSession(page, 401);
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "ابدأ برقم الهاتف" })).toBeVisible();
  await expect(page.getByLabel("الدور")).toHaveValue("operator");
  await page.getByLabel("رقم الهاتف").fill("96777000100");
  await page.getByRole("button", { name: "متابعة" }).click();

  await expect(page.getByRole("heading", { name: "تسجيل دخول لوحة التحكم" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: /^كلمة المرور/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "إظهار كلمة المرور" })).toBeVisible();
});

test("identity service failure is exposed as an alert with a recovery action", async ({ page }) => {
  await stubSession(page, 503);
  await page.goto("/");

  await expect(page.locator("section[role=alert]")).toContainText("تعذر الوصول إلى الهوية");
  await expect(page.getByRole("button", { name: "إعادة المحاولة" })).toBeVisible();
});
