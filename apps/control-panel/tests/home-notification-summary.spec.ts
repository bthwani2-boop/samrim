import { expect, type Page, test } from "@playwright/test";

const session = {
  subject: "actor-operator", sessionId: "test-session", role: "operator",
  permissions: [], surface: "control-panel", expiresAt: "2099-01-01T00:00:00.000Z",
};
const readNotification = {
  id: "notification-read", kind: "ORDER_CREATED", title: "تحديث طلب سابق",
  body: "تم تحديث الحالة", createdAt: "2026-10-11T10:00:00.000Z",
  readAt: "2026-10-11T11:00:00.000Z",
};

async function auth(page: Page) {
  await page.route("**/api/auth/session**", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ identity: session }),
  }));
}

test("home distinguishes authoritative unread total from the visible latest page", async ({ page }) => {
  await auth(page);
  let seenLimit = "";
  await page.route("**/api/notifications?**", (route) => {
    seenLimit = new URL(route.request().url()).searchParams.get("limit") ?? "";
    return route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ notifications: [readNotification], unreadCount: 17, nextCursor: "older" }),
    });
  });
  await page.goto("/workspace");
  await expect(page.getByRole("heading", { name: "آخر التنبيهات" })).toBeVisible();
  await expect(page.locator(".home-unread-total")).toContainText("إجمالي غير المقروءة: ١٧");
  await expect(page.getByText(/لا إشعارات غير مقروءة في هذه المعاينة/)).toBeVisible();
  await expect(page.getByText("أنت على اطلاع؛ لا إشعارات غير مقروءة.", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "صندوق الإشعارات" })).toHaveAttribute("href", "/notifications");
  expect(seenLimit).toBe("50");
});

test("home does not turn unknown counts or failed reads into zero", async ({ page }) => {
  await page.clock.install();
  await auth(page);
  let mode: "missing" | "failed" | "recovered" = "missing";
  await page.route("**/api/notifications?**", (route) => {
    if (mode === "failed") return route.fulfill({
      status: 503, contentType: "application/json",
      body: JSON.stringify({ error: { message: "الخدمة غير متاحة" } }),
    });
    return route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ notifications: [], ...(mode === "recovered" ? { unreadCount: 0 } : {}) }),
    });
  });
  await page.goto("/workspace");
  await expect(page.getByText("إجمالي غير المقروءة غير متاح")).toBeVisible();
  await expect(page.getByText(/تعذر تحديد العدد/)).toBeVisible();
  mode = "failed";
  await page.clock.fastForward(31_000);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator(".home-queue-error")).toContainText("تعذرت القراءة");
  await expect(page.getByText("لا توجد إشعارات غير مقروءة.", { exact: true })).toHaveCount(0);
  mode = "recovered";
  await page.getByRole("button", { name: "إعادة المحاولة", exact: true }).click();
  await expect(page.locator(".home-unread-total")).toContainText("إجمالي غير المقروءة: ٠");
  await expect(page.getByText("أنت على اطلاع؛ لا إشعارات غير مقروءة.", { exact: true })).toBeVisible();
});

test("home notification preview opens its related canonical record", async ({ page }) => {
  await auth(page);
  await page.route("**/api/notifications?**", (route) => route.fulfill({ json: {
    notifications: [{ ...readNotification, id: "notification-unread", readAt: null, orderId: "order-notification-4" }], unreadCount: 1,
  } }));
  await page.goto("/workspace");
  await expect(page.getByRole("link", { name: /تحديث طلب سابق/ })).toHaveAttribute("href", "/operations/order-notification-4");
});

test("operator notification summaries keep internal order keys out of visible text", async ({ page }, testInfo) => {
  await auth(page);
  const orderId = "order-private-internal-key";
  await page.route("**/api/notifications?**", (route) => route.fulfill({ json: {
    notifications: [{
      ...readNotification,
      id: "notification-with-internal-order-key",
      title: `تم استلام الطلب رقم ${orderId}.`,
      body: `استلم الكابتن الطلب رقم ${orderId} وبدأ التوصيل.`,
      readAt: null,
      orderId,
    }],
    unreadCount: 1,
  } }));

  for (const view of [
    { name: "desktop-light", width: 1440, height: 900, colorScheme: "light" as const },
    { name: "desktop-dark", width: 1440, height: 900, colorScheme: "dark" as const },
    { name: "mobile-light", width: 390, height: 844, colorScheme: "light" as const },
    { name: "mobile-dark", width: 390, height: 844, colorScheme: "dark" as const },
  ]) {
    await page.setViewportSize({ width: view.width, height: view.height });
    await page.emulateMedia({ colorScheme: view.colorScheme, reducedMotion: "reduce" });
    await page.goto("/workspace");
    const preview = page.locator(".home-notification-list");
    await expect(preview).toContainText("تم استلام الطلب.");
    await expect(preview).toContainText("استلم الكابتن الطلب وبدأ التوصيل.");
    await expect(preview).not.toContainText(orderId);
    await preview.scrollIntoViewIfNeeded();
    const dimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, page: document.documentElement.scrollWidth }));
    expect(dimensions.page).toBeLessThanOrEqual(dimensions.viewport + 1);
    const screenshotPath = testInfo.outputPath(`home-notifications-${view.name}.png`);
    await page.screenshot({ path: screenshotPath, animations: "disabled" });
    await testInfo.attach(`home-notifications-${view.name}.png`, {
      path: screenshotPath,
      contentType: "image/png",
    });
  }

  await page.goto("/notifications");
  await expect(page.locator(".operator-notification-list")).toContainText("استلم الكابتن الطلب وبدأ التوصيل.");
  await expect(page.locator(".operator-notification-list")).not.toContainText(orderId);
});

test("notification inbox rejects missing global unread count without inventing zero", async ({ page }) => {
  await auth(page);
  await page.route("**/api/notifications?**", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ notifications: [{ ...readNotification, orderId: "order-one" }], nextCursor: "" }),
  }));
  await page.goto("/notifications");
  await expect(page.locator(".operator-notifications [role='alert']")).toBeVisible();
  await expect(page.getByText("تحديث طلب سابق")).toHaveCount(0);
  await expect(page.getByText("0 إشعارات غير مقروءة")).toHaveCount(0);
  await expect(page.getByText("1 إشعارًا في الصفحة")).toHaveCount(0);
});

test("notification inbox displays canonical read notifications and authoritative zero unread", async ({ page }) => {
  await auth(page);
  await page.route("**/api/notifications?**", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ notifications: [{ ...readNotification, orderId: "order-one" }], unreadCount: 0, nextCursor: "" }),
  }));
  await page.goto("/notifications");
  await expect(page.getByText("تحديث طلب سابق")).toBeVisible();
  await expect(page.getByText("0 إشعارات غير مقروءة")).toBeVisible();
  await expect(page.getByText("1 إشعارًا في الصفحة")).toBeVisible();
});
