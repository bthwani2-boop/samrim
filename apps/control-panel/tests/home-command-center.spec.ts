import { expect, test } from "@playwright/test";

const identity = {
  subject: "home-command-center-proof",
  sessionId: "command-center",
  role: "operator",
  permissions: ["operations", "partners", "catalog", "platform_policies"],
  surface: "control-panel",
  expiresAt: "2099-01-01T00:00:00.000Z",
};

const operations = [
  { orderId: "order-1001", storeName: "مطعم الحديقة", state: "READY_FOR_DISPATCH", updatedAt: "2026-10-16T06:21:00.000Z", assignment: null },
  { orderId: "order-1002", storeName: "سوبرماركت الخير", state: "PREPARING", updatedAt: "2026-10-16T06:19:00.000Z", assignment: null },
];

const analyticsDays = [
  { day: "2026-10-10", orders: 2, delivered: 1, inProgress: 1, awaitingDispatch: 0, failed: 0, cancelled: 0 },
  { day: "2026-10-11", orders: 3, delivered: 2, inProgress: 0, awaitingDispatch: 0, failed: 0, cancelled: 1 },
  { day: "2026-10-12", orders: 1, delivered: 0, inProgress: 0, awaitingDispatch: 1, failed: 0, cancelled: 0 },
  { day: "2026-10-13", orders: 4, delivered: 2, inProgress: 2, awaitingDispatch: 0, failed: 0, cancelled: 0 },
  { day: "2026-10-14", orders: 5, delivered: 3, inProgress: 1, awaitingDispatch: 0, failed: 1, cancelled: 0 },
  { day: "2026-10-15", orders: 2, delivered: 2, inProgress: 0, awaitingDispatch: 0, failed: 0, cancelled: 0 },
  { day: "2026-10-16", orders: 3, delivered: 0, inProgress: 2, awaitingDispatch: 1, failed: 0, cancelled: 0 },
];

test("command center shows canonical totals, live records and authorized direct actions", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route("**/api/auth/session**", (route) => route.fulfill({ json: { identity } }));
  await page.route("**/api/operations?**", (route) => {
    const actionable = new URL(route.request().url()).searchParams.get("actionableOnly") === "true";
    return route.fulfill({ json: {
      operations: actionable ? operations.slice(0, 1) : operations,
      summary: {
        totalCount: 42, actionableCount: 3, awaitingDispatchCount: 2,
        activeCount: 9, deliveredCount: 21, measuredAt: "2026-10-16T06:22:00.000Z",
      },
    } });
  });
  await page.route("**/api/operations/home-analytics", (route) => route.fulfill({ json: { days: analyticsDays, timeZone: "Asia/Aden", measuredAt: "2026-10-16T06:22:00Z" } }));
  await page.route("**/api/partners/joining-cases?**", (route) => route.fulfill({ json: { cases: [] } }));
  await page.route("**/api/catalog/proposals?**", (route) => route.fulfill({ json: { proposals: [] } }));
  await page.route("**/api/notifications?**", (route) => route.fulfill({ json: { notifications: [], unreadCount: 0 } }));

  await page.goto("/workspace");
  await expect(page.getByRole("heading", { name: "مركز قيادة بثواني" })).toBeVisible();
  await expect(page.getByRole("link", { name: /جميع الطلبات المسجلة/ })).toContainText("٤٢");
  await expect(page.getByRole("link", { name: /تحتاج إجراءً/ }).first()).toContainText("٣");
  await expect(page.getByRole("link", { name: /بانتظار الإسناد/ }).first()).toContainText("٢");
  await expect(page.getByRole("link", { name: /تم تسليمها/ })).toContainText("٢١");
  await expect(page.getByRole("table").getByRole("row")).toHaveCount(3);
  await expect(page.getByRole("table").getByRole("link", { name: "فتح الطلب ←" }).first()).toHaveAttribute("href", "/operations/order-1001");
  await expect(page.getByRole("region", { name: "طلبات تحتاج إجراءً" }).getByRole("link", { name: /مطعم الحديقة/ })).toHaveAttribute("href", "/operations/order-1001");
  await expect(page.getByRole("navigation", { name: "إجراءات المشغّل" }).getByRole("link", { name: /إدارة السياسات/ })).toHaveAttribute("href", "/policies");
  await expect(page.getByText("إحصاءات السجل الحالي، وليست إحصاءات اليوم")).toBeVisible();
  await expect(page.getByRole("heading", { name: "حركة الطلبات خلال آخر 7 أيام" })).toBeVisible();
  await expect(page.locator("svg[aria-label^='رسم لاتجاه الطلبات'] circle")).toHaveCount(7);
  await expect(page.getByRole("link", { name: /بانتظار الإسناد ٢/ }).last()).toHaveAttribute("href", "/operations?view=dispatch");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("command-center-desktop.png"), fullPage: true });
  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  await page.screenshot({ path: testInfo.outputPath("command-center-desktop-dark.png"), fullPage: true });
  await page.evaluate(() => { document.documentElement.dataset.theme = "light"; });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { name: "مركز قيادة بثواني" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("command-center-mobile.png"), fullPage: true });
});

test("command center never invents numbers when backend summary is missing", async ({ page }) => {
  await page.route("**/api/auth/session**", (route) => route.fulfill({ json: { identity: { ...identity, permissions: ["operations"] } } }));
  await page.route("**/api/operations?**", (route) => route.fulfill({ json: { operations: [] } }));
  await page.route("**/api/notifications?**", (route) => route.fulfill({ json: { notifications: [], unreadCount: 0 } }));
  await page.route("**/api/operations/home-analytics", (route) => route.fulfill({ json: { days: analyticsDays.map((day, index) => index === 0 ? { ...day, orders: 99 } : day), measuredAt: "2026-10-16T06:22:00Z", timeZone: "Asia/Aden" } }));
  await page.goto("/workspace");
  await expect(page.getByText("استجابة التحليلات غير صالحة.")).toBeVisible();
  await expect(page.getByText("مؤشرات الإجمالي غير متاحة من الاستجابة الحالية؛ لن تُعرض أرقام تقديرية.")).toBeVisible();
  await expect(page.getByRole("link", { name: /جميع الطلبات المسجلة/ })).toContainText("—");
  await expect(page.getByRole("navigation", { name: "إجراءات المشغّل" }).getByRole("link")).toHaveCount(1);
});
