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
    await expect(page.getByText("لا توجد طلبات في هذا المسار", { exact: true })).toHaveCount(0);
    valid = true;
    await page.getByRole("button", { name: "إعادة المحاولة", exact: true }).click();
    await expect(page.locator(".operations-workspace").getByRole("alert")).toHaveCount(0);
    await expect(page.getByText("لا توجد طلبات في هذا المسار", { exact: true })).toBeVisible();
  });
}

test("operations restores bounded pages and retains the first-page recovery when the next read fails", async ({ page }) => {
  await session(page);
  const requests: URL[] = [];
  let failNext = false;
  await page.route("**/api/operations?**", (route) => {
    const url = new URL(route.request().url());
    requests.push(url);
    const next = url.searchParams.has("cursor");
    if (next && failNext) return route.fulfill({ status: 503, json: { error: { message: "تعذرت قراءة الصفحة التالية" } } });
    return route.fulfill({ status: 200, json: { operations: [{
      orderId: next ? "second-order" : "first-order", storeName: next ? "متجر الصفحة الثانية" : "متجر الصفحة الأولى",
      state: "READY_FOR_DISPATCH", updatedAt: "2026-10-12T00:00:00Z", assignment: null,
    }], nextCursor: next ? "" : "second-page" } });
  });
  await page.goto("/operations?lane=attention&q=متجر&sort=updated_asc");
  await expect(page.getByRole("cell", { name: "متجر الصفحة الأولى", exact: true })).toBeVisible();
  const pagination = page.getByRole("navigation", { name: "صفحات الطلبات" });
  await pagination.getByRole("button", { name: "التالي", exact: true }).click();
  await expect(page.getByRole("cell", { name: "متجر الصفحة الثانية", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/cursor=second-page/);
  await page.reload();
  await expect(page.getByRole("cell", { name: "متجر الصفحة الثانية", exact: true })).toBeVisible();
  await pagination.getByRole("button", { name: "السابق", exact: true }).click();
  await expect(page.getByRole("cell", { name: "متجر الصفحة الأولى", exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("cell", { name: "متجر الصفحة الثانية", exact: true })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole("cell", { name: "متجر الصفحة الأولى", exact: true })).toBeVisible();
  failNext = true;
  await pagination.getByRole("button", { name: "التالي", exact: true }).click();
  await expect(page.locator(".operations-workspace").getByRole("alert")).toContainText("تعذر الاتصال بخدمة العمليات");
  await pagination.getByRole("button", { name: "السابق", exact: true }).click();
  await expect(page.getByRole("cell", { name: "متجر الصفحة الأولى", exact: true })).toBeVisible();
  expect(requests.every((url) => url.searchParams.get("limit") === "50" && url.searchParams.get("q") === "متجر" && url.searchParams.get("actionableOnly") === "true" && url.searchParams.get("sort") === "updated_asc")).toBe(true);
});

test("operation detail links retain the current page and resubmitting the same search resets it", async ({ page }) => {
  await session(page);
  await page.route("**/api/operations?**", (route) => {
    const next = new URL(route.request().url()).searchParams.has("cursor");
    return route.fulfill({ json: { operations: [{ orderId: next ? "second-order" : "first-order", storeName: next ? "متجر الصفحة الثانية" : "متجر الصفحة الأولى", state: "READY_FOR_DISPATCH", updatedAt: "2026-10-12T00:00:00Z", assignment: null }], nextCursor: next ? "" : "second-page" } });
  });
  await page.goto("/operations?lane=attention&q=متجر&sort=updated_asc");
  await page.getByRole("navigation", { name: "صفحات الطلبات" }).getByRole("button", { name: "التالي", exact: true }).click();
  await expect(page.getByRole("cell", { name: "متجر الصفحة الثانية", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "فتح الطلب", exact: true })).toHaveAttribute("href", /cursor=second-page/);
  await page.getByRole("button", { name: "بحث", exact: true }).click();
  await expect(page.getByRole("cell", { name: "متجر الصفحة الأولى", exact: true })).toBeVisible();
  const query = new URL(page.url()).searchParams;
  expect(query.has("cursor")).toBe(false);
  expect(query.get("q")).toBe("متجر");
  expect(query.get("lane")).toBe("attention");
  expect(query.get("sort")).toBe("updated_asc");
});
