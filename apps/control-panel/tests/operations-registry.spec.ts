import { expect, test } from "@playwright/test";

async function session(page: import("@playwright/test").Page) {
  await page.route("**/api/auth/session**", (route) => route.fulfill({ status: 200, json: { identity: {
    subject: "operations-registry", sessionId: "operations-registry", role: "operator",
    permissions: ["operations"], surface: "control-panel", expiresAt: "2099-01-01T00:00:00Z",
  } } }));
  await page.route("**/api/notifications**", (route) => route.fulfill({ status: 200, json: { notifications: [], unreadCount: 0 } }));
}

for (const body of [{}, { operations: null }, { operations: [], nextCursor: 7 }]) {
  test(`operations rejects an invalid registry response ${JSON.stringify(body)} and retries`, async ({ page }) => {
    await session(page);
    let valid = false;
    await page.route("**/api/operations?**", (route) => route.fulfill({ status: 200, json: valid ? { operations: [], nextCursor: "" } : body }));
    await page.goto("/operations");
    await expect(page.locator(".operations-workspace").getByRole("alert")).toContainText("تعذر قراءة الطلبات");
    await expect(page.getByText("لا توجد طلبات في هذا العرض", { exact: true })).toHaveCount(0);
    valid = true;
    await page.getByRole("button", { name: "إعادة المحاولة", exact: true }).click();
    await expect(page.locator(".operations-workspace").getByRole("alert")).toHaveCount(0);
    await expect(page.getByText("لا توجد طلبات في هذا العرض", { exact: true })).toBeVisible();
  });
}

test("operations describes a timed-out read in Arabic without exposing browser errors", async ({ page }) => {
  await session(page);
  await page.addInitScript(() => {
    const original = AbortSignal.timeout.bind(AbortSignal);
    AbortSignal.timeout = (ms: number) => original(ms === 12_000 ? 30 : ms);
  });
  await page.route("**/api/operations?**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 160));
    await route.fulfill({ json: { operations: [], nextCursor: "" } }).catch(() => {});
  });
  await page.goto("/operations");
  await expect(page.locator(".operations-workspace").getByRole("alert")).toContainText("استغرقت القراءة وقتًا طويلًا. أعد المحاولة.");
});