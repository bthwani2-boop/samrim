import { expect, test, type Page } from "@playwright/test";

const identity = {
  subject: "operations-notification-actor", sessionId: "operations-notification-session",
  role: "operator", permissions: ["operations"],
  surface: "control-panel", expiresAt: "2099-01-01T00:00:00Z",
};

async function authenticate(page: Page) {
  await page.route("**/api/auth/session**", (route) => route.fulfill({ json: { identity } }));
  await page.route("**/api/auth/profile**", (route) => route.fulfill({ json: { phoneE164: "+967700000000" } }));
}

const notification = {
  id: "notify_1", kind: "ORDER_CREATED", title: "طلب بحاجة لمراجعة",
  body: "طلب جديد من متجر تجريبي", orderId: "order-123",
  createdAt: "2026-10-14T01:00:00Z", readAt: null as string | null,
};

test("operator opens the referenced order without marking a notification read", async ({ page }) => {
  await authenticate(page);
  let readMutations = 0;
  await page.route("**/api/notifications**", (route) => {
    if (route.request().method() === "POST") {
      readMutations += 1;
      return route.fulfill({ status: 500 });
    }
    return route.fulfill({ json: { notifications: [notification], unreadCount: 1, nextCursor: "" } });
  });
  await page.route("**/api/operations/order-123", (route) => route.fulfill({ json: {
    operation: {
      storeName: "متجر تجريبي", assignment: null,
      order: {
        id: "order-123", storeId: "store-123", state: "CREATED",
        fulfillmentMode: "CUSTOMER_PICKUP", createdAt: "2026-10-14T01:00:00Z",
        updatedAt: "2026-10-14T01:00:00Z", paymentMethod: "CASH_ON_DELIVERY",
        paymentState: "REQUIRES_COLLECTION", cashAmountMinor: 0,
        subtotalAmountMinor: 100, discountMinor: 0, totalAmountMinor: 100,
        currency: "YER", lines: [], adjustments: [],
      },
    },
  } }));

  await page.goto("/notifications");
  const open = page.getByRole("link", { name: "فتح الطلب المرتبط بإشعار طلب بحاجة لمراجعة" });
  await expect(open).toHaveAttribute("href", "/operations/order-123?tab=overview");
  await open.click();
  await expect(page).toHaveURL(/\/operations\/order-123\?tab=overview/);
  await expect(page.getByRole("heading", { name: "طلب من متجر تجريبي" })).toBeVisible();
  expect(readMutations).toBe(0);
});

test("marking an operator notification read is independent from opening its order", async ({ page }) => {
  await authenticate(page);
  let mutations = 0;
  let readAt: string | null = null;
  await page.route("**/api/notifications**", (route) => {
    if (route.request().method() === "POST") {
      mutations += 1;
      readAt = "2026-10-14T01:30:00Z";
      return route.fulfill({ json: { notificationId: notification.id, readAt } });
    }
    return route.fulfill({ json: {
      notifications: [{ ...notification, readAt }], unreadCount: readAt ? 0 : 1,
      nextCursor: "",
    } });
  });

  await page.goto("/notifications");
  const button = page.getByRole("button", { name: "تمييز طلب بحاجة لمراجعة كمقروء" });
  await expect(button).toBeVisible();
  await button.evaluate((element: HTMLButtonElement) => { element.click(); element.click(); });
  await expect(page.getByText("0 إشعارات غير مقروءة")).toBeVisible();
  expect(mutations).toBe(1);
  await expect(button).toHaveCount(0);
  await expect(page.getByRole("link", { name: "فتح الطلب المرتبط بإشعار طلب بحاجة لمراجعة" })).toBeVisible();
});

test("notification without a canonical order reference does not expose an unsafe link", async ({ page }) => {
  await authenticate(page);
  await page.route("**/api/notifications**", (route) => route.fulfill({ json: {
    notifications: [
      { ...notification, id: "notify_no_order", orderId: "", title: "تنبيه عام" },
      { ...notification, id: "notify_invalid", orderId: "../access", title: "مرجع غير صالح" },
    ],
    unreadCount: 2, nextCursor: "",
  } }));
  await page.goto("/notifications");
  await expect(page.getByText("تنبيه عام")).toBeVisible();
  await expect(page.getByText("مرجع غير صالح")).toBeVisible();
  await expect(page.getByRole("link", { name: /فتح الطلب المرتبط/ })).toHaveCount(0);
});
