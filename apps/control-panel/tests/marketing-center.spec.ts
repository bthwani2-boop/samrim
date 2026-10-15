import { expect, test } from "./coverage-fixtures";

test("marketing center is one canonical workspace without nested marketing navigation", async ({ page }) => {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
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
  await expect(page.getByRole("heading", { name: "العروض والحملات", level: 2 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "البنرات ومحتوى الاكتشاف", level: 2 })).toBeVisible();
  await expect(page.getByTestId("marketing-promotions-workspace")).toBeVisible();
  await expect(page.getByTestId("marketing-content-workspace")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "تنقل مساحة المشغل" }).getByRole("link", { name: "العروض", exact: true })).toHaveCount(0);
});
