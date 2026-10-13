import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/auth/session**", (route) => route.fulfill({ json: { identity: {
    subject: "operator-access-review", sessionId: "session", role: "operator", permissions: ["partners"],
    surface: "control-panel", expiresAt: "2099-01-01T00:00:00.000Z",
  } } }));
  await page.route("**/api/notifications**", (route) => route.fulfill({ json: { notifications: [], unreadCount: 0 } }));
});

test("partner store access approval queue has a direct store link and no routine reread control", async ({ page }) => {
  await page.route("**/api/partners/store-access-admissions?**", (route) => route.fulfill({ json: {
    items: [{ id: "grant-1", storeId: "store-1", storeName: "متجر الصفا", version: 2,
      delegatePhoneMasked: "+96777****123", permissions: ["orders"], state: "pending_role_admission",
      expiresAt: "2026-12-01T00:00:00.000Z" }],
  } }));
  await page.goto("/partners/store-access");
  const queue = page.getByRole("region", { name: "اعتمادات دور الشريك لدعوات الوصول" });
  await expect(queue.getByRole("link", { name: "متجر الصفا" })).toHaveAttribute("href", "/partners/stores/store-1");
  await expect(queue.getByRole("button", { name: "إعادة القراءة" })).toHaveCount(0);
  await expect(queue.getByRole("button", { name: "اعتماد الدور" })).toBeVisible();
});

test("store access read failure shows an exception-only retry and no false empty state", async ({ page }) => {
  let available = false;
  await page.route("**/api/partners/store-access-admissions?**", (route) => available
    ? route.fulfill({ json: { items: [] } })
    : route.fulfill({ status: 503, json: { error: { message: "الخدمة غير متاحة" } } }));
  await page.goto("/partners/store-access");
  const queue = page.getByRole("region", { name: "اعتمادات دور الشريك لدعوات الوصول" });
  await expect(queue.getByRole("alert")).toBeVisible();
  await expect(queue.getByText("لا توجد دعوات مقبولة بانتظار اعتماد الدور")).toHaveCount(0);
  available = true;
  await queue.getByRole("button", { name: "إعادة المحاولة" }).click();
  await expect(queue.getByText("لا توجد دعوات مقبولة بانتظار اعتماد الدور")).toBeVisible();
  await expect(queue.getByRole("alert")).toHaveCount(0);
});

test("access admissions use bounded server pages and preserve exact previous-page navigation", async ({ page }) => {
  const requests: URL[] = [];
  const grants = Array.from({ length: 57 }, (_, i) => ({
    id: `grant-${i}`, storeId: `store-${i}`, storeName: `متجر ${i}`,
    version: 1, delegatePhoneMasked: "+96777****123", permissions: ["orders"],
    state: "pending_role_admission", expiresAt: "2026-12-01T00:00:00.000Z",
  }));
  await page.route("**/api/partners/store-access-admissions?**", (route) => {
    const url = new URL(route.request().url());
    requests.push(url);
    const limit = Number(url.searchParams.get("limit"));
    const start = Number(url.searchParams.get("cursor") ?? "0");
    if (limit !== 25 || !Number.isInteger(start)) return route.fulfill({ status: 400 });
    return route.fulfill({ json: {
      items: grants.slice(start, start + limit),
      nextCursor: start + limit < grants.length ? String(start + limit) : "",
    } });
  });
  await page.goto("/partners/store-access");
  const queue = page.getByRole("region", { name: "اعتمادات دور الشريك لدعوات الوصول" });
  const rows = queue.locator("tbody tr");
  await expect(rows).toHaveCount(25);
  await expect(rows.first()).toContainText("متجر 0");
  await queue.getByRole("button", { name: "التالي" }).click();
  await expect(rows).toHaveCount(25);
  await expect(rows.first()).toContainText("متجر 25");
  await page.reload();
  await expect(rows).toHaveCount(25);
  await expect(rows.first()).toContainText("متجر 25");
  await queue.getByRole("button", { name: "التالي" }).click();
  await expect(rows).toHaveCount(7);
  await expect(rows.first()).toContainText("متجر 50");
  await expect(queue.getByRole("button", { name: "التالي" })).toBeDisabled();
  await queue.getByRole("button", { name: "السابق" }).click();
  await expect(rows.first()).toContainText("متجر 25");
  expect(requests.every((url) => url.searchParams.get("limit") === "25")).toBe(true);
  expect(requests.length).toBeLessThan(9);
});

test("expired admission cursor returns to the first page instead of showing a false empty queue", async ({ page }) => {
  await page.route("**/api/partners/store-access-admissions?**", (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    if (cursor) return route.fulfill({ status: 400, json: { error: { message: "invalid cursor" } } });
    return route.fulfill({ json: {
      items: [{ id: "grant-1", storeId: "store-1", storeName: "متجر الصفا", version: 2,
        delegatePhoneMasked: "+96777****123", permissions: ["orders"], state: "pending_role_admission",
        expiresAt: "2026-12-01T00:00:00.000Z" }],
      nextCursor: "expired-cursor",
    } });
  });
  await page.goto("/partners/store-access");
  const queue = page.getByRole("region", { name: "اعتمادات دور الشريك لدعوات الوصول" });
  await expect(queue.getByRole("link", { name: "متجر الصفا" })).toBeVisible();
  await queue.getByRole("button", { name: "التالي" }).click();
  await expect(queue.getByText("الصفحة 1", { exact: true }).first()).toBeVisible();
  await expect(queue.getByRole("link", { name: "متجر الصفا" })).toBeVisible();
  await expect(queue.getByRole("alert")).toHaveCount(0);
});
