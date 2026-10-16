import { expect, test } from "@playwright/test";

async function session(page: import("@playwright/test").Page) {
  await page.route("**/api/auth/session**", (route) => route.fulfill({ json: { identity: {
    subject: "operations-summary", sessionId: "operations-summary", role: "operator", permissions: ["operations"], surface: "control-panel", expiresAt: "2099-01-01T00:00:00Z",
  } } }));
  await page.route("**/api/notifications**", (route) => route.fulfill({ json: { notifications: [], unreadCount: 0 } }));
}

const row = { orderId: "summary-order", storeName: "متجر المؤشرات", state: "READY_FOR_DISPATCH", updatedAt: "2026-10-15T00:00:00Z", assignment: null };
const summary = { totalCount: 125, actionableCount: 76, awaitingDispatchCount: 72, activeCount: 12, deliveredCount: 31, measuredAt: "2026-10-15T12:00:00Z" };

test("operations uses owner totals across bounded pages, and clears protected rows and counts on forbidden refresh", async ({ page }) => {
  await session(page);
  let forbidden = false;
  await page.route("**/api/operations?**", (route) => {
    const next = new URL(route.request().url()).searchParams.has("cursor");
    return route.fulfill(forbidden ? { status: 403, json: { error: { code: "FORBIDDEN" } } } : { json: {
      operations: [{ ...row, orderId: next ? "second-summary-order" : row.orderId, storeName: next ? "متجر الصفحة الثانية" : row.storeName }], summary, nextCursor: next ? "" : "next-summary-page",
    } });
  });
  await page.goto("/operations");
  await expect(page.locator(".ops-list-name")).toContainText("125 إجمالي النتائج");
  await expect(page.locator(".ops-summary-review strong")).toHaveText("76");
  await expect(page.locator(".ops-summary-dispatch strong")).toHaveText("72");
  await page.getByRole("navigation", { name: "صفحات الطلبات" }).getByRole("button", { name: "التالي", exact: true }).click();
  await expect(page.getByRole("rowheader", { name: "متجر الصفحة الثانية", exact: true })).toBeVisible();
  await expect(page.locator(".ops-list-name")).toContainText("125 إجمالي النتائج");
  forbidden = true;
  await page.getByRole("button", { name: "تحديث قائمة الطلبات" }).click();
  await expect(page.locator(".operations-workspace").getByRole("alert")).toContainText("لا تملك صلاحية");
  await expect(page.locator(".ops-summary-review strong")).toHaveText("—");
  await expect(page.locator(".operations-table")).toHaveCount(0);
});

test("operations keeps missing totals unknown and rejects a malformed owner summary", async ({ page }) => {
  await session(page);
  let malformed = false;
  await page.route("**/api/operations?**", (route) => route.fulfill({ json: { operations: [row], ...(malformed ? { summary: { ...summary, totalCount: -1 } } : {}) } }));
  await page.goto("/operations");
  await expect(page.getByRole("rowheader", { name: row.storeName, exact: true })).toBeVisible();
  await expect(page.locator(".ops-summary-review strong")).toHaveText("—");
  await expect(page.locator(".ops-summary-caption")).toContainText("لم تتوفر");
  malformed = true;
  await page.getByRole("button", { name: "تحديث قائمة الطلبات" }).click();
  await expect(page.locator(".operations-workspace").getByRole("alert")).toContainText("استجابة قائمة الطلبات غير صالحة");
});
