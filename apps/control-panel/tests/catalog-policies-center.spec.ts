import { expect, test } from "./coverage-fixtures";

test("catalog has one usable registry and opens secondary work in context", async ({ page }) => {
  let proposalReads = 0;
  await page.route("**/api/**", (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/api/catalog/proposals") proposalReads++;
    const mocks: Record<string, unknown> = {
      "/api/auth/session": { identity: { subject: "catalog-operator", sessionId: "catalog-session",
        role: "operator", permissions: ["catalog"], surface: "control-panel", expiresAt: "2099-01-01T00:00:00.000Z" } },
      "/api/notifications": { notifications: [], unreadCount: 0 },
      "/api/catalog/verticals": { verticals: [] },
      "/api/catalog/products": { products: [], nextCursor: "" },
      "/api/catalog/proposals": { proposals: [], nextCursor: "" },
      "/api/catalog/categories": { categories: [], nextCursor: "" },
    };
    return route.fulfill(pathname in mocks ?
      { status: 200, json: mocks[pathname] } :
      { status: 404, json: { error: { message: "غير متاح في بيانات الاختبار" } } });
  });
  await page.goto("/catalog");
  await expect(page).toHaveURL(/\/catalog$/);
  await expect(page.getByRole("heading", { name: "الكتالوج", level: 1 })).toBeVisible();
  await expect(page.getByTestId("catalog-center")).toBeVisible();
  await expect(page.getByRole("button", { name: "جدول المنتجات" })).toBeVisible();
  await expect(page.getByRole("button", { name: "معرض الصور" })).toBeVisible();
  expect(proposalReads).toBe(0);
  await page.getByRole("button", { name: "معرض الصور" }).click();
  await expect(page.getByRole("button", { name: "معرض الصور" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "جدول المنتجات" }).click();
  await expect(page.getByRole("button", { name: "جدول المنتجات" })).toHaveAttribute("aria-pressed", "true");
  await page.locator("summary").filter({ hasText: "مقترحات الشركاء" }).click();
  await expect.poll(() => proposalReads).toBeGreaterThan(0);
  await page.locator("summary").filter({ hasText: "المجالات والفئات" }).click();
  await expect(page.locator(".catalog-center-disclosure").first()).toHaveAttribute("open", "");
  await expect(page.getByRole("navigation", { name: "تنقل مساحة المشغل" }).getByRole("link", { name: "الاستيراد" })).toHaveAttribute("href", "/catalog/import");
});

test("policy editors share one center and load sensitive work only when opened", async ({ page }) => {
  let walletReads = 0;
  await page.route("**/api/**", (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.includes("wallet-provider")) walletReads++;
    const mocks: Record<string, unknown> = {
      "/api/auth/session": { identity: { subject: "policy-operator", sessionId: "policy-session",
        role: "operator", permissions: ["platform_policies"], surface: "control-panel", expiresAt: "2099-01-01T00:00:00.000Z" } },
      "/api/notifications": { notifications: [], unreadCount: 0 },
      "/api/service-cities": { cities: [] },
    };
    return route.fulfill(pathname in mocks ?
      { status: 200, json: mocks[pathname] } :
      { status: 404, json: { error: { message: "غير متاح في بيانات الاختبار" } } });
  });
  await page.goto("/policies");
  await expect(page).toHaveURL(/\/policies$/);
  await expect(page.getByRole("heading", { name: "سياسات المنصة", level: 1 })).toBeVisible();
  await expect(page.locator(".policy-center-disclosure")).toHaveCount(5);
  await expect(page.locator(".policy-center-disclosure").first()).toHaveAttribute("open", "");
  expect(walletReads).toBe(0);
  const wallet = page.locator(".policy-center-disclosure").filter({ has: page.locator("summary").filter({ hasText: "مزودو المحافظ" }) });
  await wallet.locator(":scope > summary").click();
  await expect(wallet).toHaveAttribute("open", "");
  await wallet.locator(":scope > summary").click();
  await expect(wallet).not.toHaveAttribute("open", "");
  await wallet.locator(":scope > summary").click();
  await expect(wallet).toHaveAttribute("open", "");
  const finance = page.locator(".policy-center-disclosure").filter({ has: page.locator("summary").filter({ hasText: "شروط الشركاء المالية" }) });
  await finance.locator(":scope > summary").click();
  await expect(finance).toContainText("تتطلب هذه السياسة صلاحية سياسات المنصة وصلاحية المالية");
  await expect(page.getByRole("navigation", { name: "تنقل مساحة المشغل" }).getByRole("link", { name: "مدن الخدمة" })).toHaveCount(0);
});
