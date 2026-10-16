import { expect, test } from "./coverage-fixtures";

test("marketing center is one canonical workspace without nested marketing navigation", async ({ page }) => {
  let contentReads = 0;
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/marketing/content") contentReads++;
    const records: Record<string, unknown> = {
      "/api/auth/session": { identity: {
        subject: "marketing-operator", sessionId: "marketing-test", role: "operator",
        permissions: ["marketing"], surface: "control-panel", expiresAt: "2099-01-01T00:00:00.000Z",
      } },
      "/api/notifications": { notifications: [], unreadCount: 0 },
      "/api/service-cities": { cities: [] },
      "/api/marketing/promotions": { promotions: [], nextCursor: "" },
      "/api/marketing/content": { items: [], nextCursor: "" },
    };
    await route.fulfill(path in records ? { status: 200, json: records[path] } :
      { status: 404, json: { error: { message: "غير متاح في بيانات الاختبار" } } });
  });
  await page.goto("/marketing");
  await expect(page).toHaveURL(/\/marketing$/);
  await expect(page.getByRole("heading", { name: "التسويق والمحتوى", level: 1 })).toBeVisible();
  const promotions = page.locator(".workspace-disclosure").filter({ has: page.locator("summary").filter({ hasText: "العروض والحملات" }) });
  const content = page.locator(".workspace-disclosure").filter({ has: page.locator("summary").filter({ hasText: "البنرات ومحتوى الاكتشاف" }) });
  await expect(page.getByTestId("marketing-promotions-workspace")).toBeVisible();
  expect(contentReads).toBe(0);
  await expect(page.getByTestId("marketing-content-workspace")).toHaveCount(0);
  await promotions.getByLabel("اسم العرض", { exact: true }).fill("حملة عربية محفوظة");
  await promotions.locator(":scope > summary").click();
  await content.locator(":scope > summary").click();
  await expect(page.getByTestId("marketing-content-workspace")).toBeVisible();
  await expect.poll(() => contentReads).toBe(1);
  await content.locator(":scope > summary").click();
  await promotions.locator(":scope > summary").click();
  await expect(promotions.getByLabel("اسم العرض", { exact: true })).toHaveValue("حملة عربية محفوظة");
  await expect(page.getByRole("navigation", { name: "تنقل مساحة المشغل" }).getByRole("link", { name: "العروض", exact: true })).toHaveCount(0);
});
