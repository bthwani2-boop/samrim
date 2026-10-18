import { expect, type Page, test } from "./coverage-fixtures";

const identity = {
  subject: "marketing-review-operator",
  sessionId: "marketing-review-session",
  role: "operator",
  permissions: ["marketing"],
  surface: "control-panel",
  expiresAt: "2099-01-01T00:00:00.000Z",
};

async function provideMarketingReads(page: Page) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== "GET") {
      await route.fulfill({ status: 405, json: { error: { message: "اختبار قراءة فقط" } } });
      return;
    }
    const responses: Record<string, unknown> = {
      "/api/auth/session": { identity },
      "/api/notifications": { notifications: [], unreadCount: 0, nextCursor: "" },
      "/api/service-cities": { cities: [] },
      "/api/marketing/promotions": {
        promotions: [{
          id: "promotion-smoke",
          nameAr: "عرض تجريبي",
          code: "SMOKE",
          kind: "PERCENTAGE",
          valueMinor: 10,
          fundingSource: "BTHWANI",
          targets: [],
          state: "PUBLISHED",
          startsAt: "2026-10-10T10:00:00Z",
        }],
        nextCursor: "",
      },
      "/api/marketing/content": {
        items: [{
          id: "content-smoke",
          titleAr: "بنر تجريبي",
          mediaUri: null,
          kind: "BANNER",
          targetType: "INFO",
          state: "PUBLISHED",
          ordinal: 1,
          startsAt: "2026-10-10T10:00:00Z",
        }],
        nextCursor: "",
      },
      "/api/marketing/analytics": {
        items: [
          { eventType: "IMPRESSION", count: 150 },
          { eventType: "CLICK", count: 25 },
          { eventType: "CONVERSION", count: 3 },
        ],
      },
    };
    await route.fulfill(url.pathname in responses
      ? { status: 200, json: responses[url.pathname] }
      : { status: 404, json: { error: { message: "مورد اختبار غير مُعدّ" } } });
  });
}

test("marketing promotions retain their canonical screen and records after splitting components", async ({ page }) => {
  await provideMarketingReads(page);
  await page.goto("/marketing/promotions");
  await expect(page.getByRole("heading", { name: "العروض", level: 1 })).toBeVisible();
  const table = page.getByRole("table", { name: "سجل العروض" });
  await expect(table).toContainText("عرض تجريبي");
  await expect(table).toContainText("SMOKE");
  await expect(table).toContainText("بثواني");
  await expect(table.locator(".record-indicator")).toContainText(["منشور"]);
  await expect(page.getByText("إنشاء محتوى اكتشاف", { exact: true })).toHaveCount(0);
});

test("marketing content retains its screen and honest event-count visualization", async ({ page }) => {
  await provideMarketingReads(page);
  await page.goto("/marketing/content");
  await expect(page.getByRole("heading", { name: "محتوى الاكتشاف", level: 1 })).toBeVisible();
  const table = page.getByRole("table", { name: "سجل محتوى الاكتشاف" });
  await expect(table).toContainText("بنر تجريبي");
  await expect(table.locator(".record-indicator")).toContainText(["منشور"]);
  await table.getByRole("button", { name: "قراءة التحليلات" }).click();
  const panel = page.getByRole("complementary").filter({ hasText: "تحليلات المحتوى" });
  await expect(panel).toContainText("طلبات منشأة منسوبة");
  await expect(panel.locator("progress")).toHaveCount(3);
  await expect(panel.locator("progress").first()).toHaveAttribute("max", "150");
  await expect(panel.locator("progress").last()).toHaveAttribute("value", "3");
  await expect(panel).toContainText("لا تعبر عن معدل تحويل أو أرباح");
});

test("marketing content previews the selected banner locally without publishing", async ({ page }) => {
  await provideMarketingReads(page);
  await page.goto("/marketing/content");
  await page.getByText("إنشاء محتوى اكتشاف", { exact: true }).click();
  await page.getByRole("textbox", { name: "عنوان المحتوى" }).fill("عرض الخضروات");
  await page.getByLabel("ملف صورة المحتوى").setInputFiles({
    name: "banner.png",
    mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/bT8AAAAASUVORK5CYII=", "base64"),
  });
  const preview = page.getByTestId("marketing-content-preview");
  await expect(preview).toBeVisible();
  await expect(preview.getByText("عرض الخضروات")).toBeVisible();
  await expect(preview.locator("img")).toHaveAttribute("src", /^blob:/);
  await expect(preview).toContainText("معاينة تقريبية");
});

test("marketing analytics failure remains an explicit error and never becomes a false zero", async ({ page }) => {
  await provideMarketingReads(page);
  await page.route("**/api/marketing/analytics?**", (route) => route.fulfill({ status: 503, json: { error: { message: "مصدر التحليلات غير متاح" } } }));
  await page.goto("/marketing/content");
  await page.getByRole("table", { name: "سجل محتوى الاكتشاف" }).getByRole("button", { name: "قراءة التحليلات" }).click();
  const panel = page.getByRole("complementary").filter({ hasText: "تحليلات المحتوى" });
  await expect(panel.getByRole("alert")).toHaveText("مصدر التحليلات غير متاح");
  await expect(panel.locator("progress")).toHaveCount(0);
});
