import { expect, test } from "@playwright/test";

test("customer registry and profile use actor-scoped orders and verified role changes", async ({ page }, testInfo) => {
  const client = {
    actorId: "customer-ref", phoneE164: "+967777555111", role: "client",
    enabled: true, securityEnabled: true, roleVersion: 3, actorVersion: 2,
    createdAt: "2026-10-10T08:00:00Z", lastAppOpenedAt: "2026-10-16T07:00:00Z",
    lastAuthenticatedAt: "2026-10-16T06:00:00Z",
  };
  let enabled = true;
  let version = client.roleVersion;
  let ordersFetched = 0;
  await page.route("**/api/auth/session**", (route) => route.fulfill({ json: {
    identity: { subject: "operator", sessionId: "session", role: "operator", permissions: ["marketing", "operations", "finance"],
      surface: "control-panel", expiresAt: "2099-01-01T00:00:00Z" },
  } }));
  await page.route("**/api/notifications**", (route) => route.fulfill({ json: { notifications: [], unreadCount: 0 } }));
  await page.route("**/api/customers?**", (route) => route.fulfill({ json: { items: [{ ...client, enabled, roleVersion: version }], limit: 20, nextCursor: "" } }));
  await page.route("**/api/customers/customer-ref", (route) => {
    if (route.request().method() === "POST") {
      const input = route.request().postDataJSON() as { enabled: boolean; expectedVersion: number; reason: string };
      expect(input.expectedVersion).toBe(version);
      expect(input.reason.length).toBeGreaterThanOrEqual(5);
      enabled = input.enabled; version += 1;
    }
    return route.fulfill({ json: { customer: { ...client, enabled, roleVersion: version } } });
  });
  await page.route("**/api/customers/customer-ref/orders?**", (route) => {
    ordersFetched++;
    return route.fulfill({ json: { orders: [{
      id: "order-123", storeName: "سوبر ماركت الخير", state: "DELIVERED", totalAmountMinor: 1500,
      currency: "YER", paymentMethod: "CASH", paymentState: "CAPTURED", createdAt: "2026-10-16T07:00:00Z",
    }], nextCursor: "", summary: {
      totalOrders: 24, deliveredOrders: 18, cancelledOrders: 2,
      rejectedOrders: 1, failedOrders: 1, openOrders: 2,
      last30Days: 8, previous30Days: 4, distinctStores: 6,
      firstOrderAt: "2026-06-01T08:00:00Z", lastOrderAt: "2026-10-16T07:00:00Z",
      measuredAt: "2026-10-16T07:20:00Z",
      dailyActivity: [
        { day: "2026-10-10", orders: 0 }, { day: "2026-10-11", orders: 1 },
        { day: "2026-10-12", orders: 1 }, { day: "2026-10-13", orders: 0 },
        { day: "2026-10-14", orders: 2 }, { day: "2026-10-15", orders: 0 },
        { day: "2026-10-16", orders: 1 },
      ],
    } } });
  });
  await page.goto("/customers");
  await expect(page).toHaveURL(/\/marketing\/customers/);
  await expect(page.getByRole("heading", { name: "سجل العملاء" })).toBeVisible();
  await expect(page.getByText("+967777555111")).toBeVisible();
  const openCustomer = page.getByRole("button", { name: "فتح ملف +967777555111" });
  await openCustomer.click();
  await expect(page).toHaveURL(/\/marketing\/customers\?customer=customer-ref/);
  await expect(page.getByRole("heading", { name: "طلبات العميل" })).toBeVisible();
  await expect(page.getByRole("tabpanel", { name: "نظرة عامة" }).getByText("سوبر ماركت الخير")).toBeVisible();
  await expect(page.getByRole("link", { name: /فتح الطلب/ })).toHaveAttribute("href", "/operations/order-123");
  expect(ordersFetched).toBeGreaterThan(0);
  await expect(page.getByRole("tab", { name: "نظرة عامة" })).toHaveAttribute("aria-selected", "true");
  expect(await page.getByRole("tab").evaluateAll((elements) => elements.every((element) => {
    const panelId = element.getAttribute("aria-controls");
    return Boolean(panelId && document.getElementById(panelId));
  }))).toBe(true);
  await page.getByRole("tab", { name: "نظرة عامة" }).focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("tab", { name: "الطلبات", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "نظرة عامة" })).toHaveAttribute("aria-selected", "true");
  await page.screenshot({ path: testInfo.outputPath("customer-overview-desktop.png"), fullPage: false });
  await page.getByRole("tab", { name: "الأداء والنشاط" }).click();
  await expect(page.getByRole("tab", { name: "الأداء والنشاط" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel", { name: "الأداء والنشاط" }).getByText("نشاط آخر سبعة أيام")).toBeVisible();
  await expect(page.locator(".customer-chart-bar")).toHaveCount(4);
  await page.getByRole("tab", { name: "التسويق", exact: true }).click();
  await expect(page.getByRole("tabpanel", { name: "التسويق" }).getByText("نشط شرائيًا", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("tabpanel", { name: "التسويق" }).getByRole("link", { name: /إدارة العروض/ })).toHaveAttribute("href", "/marketing/promotions");
  await page.getByRole("tab", { name: "الطلبات", exact: true }).click();
  await expect(page.getByRole("tabpanel", { name: "الطلبات", exact: true }).getByText("سوبر ماركت الخير")).toBeVisible();
  await page.getByRole("button", { name: "إدارة الحساب" }).click();
  await expect(page.getByRole("tab", { name: "الحساب والوصول" })).toHaveAttribute("aria-selected", "true");
  await page.getByLabel("سبب الإيقاف").fill("طلب إيقاف تجريبي موثق");
  await page.getByRole("button", { name: "إيقاف حساب العميل" }).click();
  await expect(page.getByText("تم إيقاف حساب العميل وتأكيد حالته.")).toBeVisible();
  await expect(page.locator(".customer-account-control").getByText("الدور موقوف")).toBeVisible();
  await expect(page.getByLabel("سبب إعادة التفعيل")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { name: "إدارة حساب العميل" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("customer-account-mobile.png"), fullPage: false });
  const width = await page.locator(".customer-profile").evaluate((element) => element.getBoundingClientRect().width);
  expect(width).toBeLessThanOrEqual(390);
  await page.getByRole("button", { name: "إغلاق التفاصيل" }).click();
  await expect(page).toHaveURL(/\/marketing\/customers$/);
  await expect(page.getByRole("heading", { name: "سجل العملاء" })).toBeVisible();
  await expect(openCustomer).toBeFocused();
});

test("marketing-only operator can analyze a customer without account, finance, or order management controls", async ({ page }) => {
  const actorId = "marketing-person";
  const customer = {
    actorId, phoneE164: "+967711555999", role: "client", enabled: true,
    securityEnabled: true, roleVersion: 1, actorVersion: 1,
    createdAt: "2026-10-01T11:00:00Z",
    lastAppOpenedAt: "2026-10-16T08:00:00Z",
    lastAuthenticatedAt: "2026-10-16T07:00:00Z",
  };
  let mutationRequested = false;
  await page.route("**/api/auth/session**", (route) => route.fulfill({ json: {
    identity: { subject: "operator-marketing", sessionId: "marketing-session", role: "operator",
      permissions: ["marketing"], surface: "control-panel", expiresAt: "2099-01-01T00:00:00Z" },
  } }));
  await page.route("**/api/notifications**", (route) => route.fulfill({ json: { notifications: [], unreadCount: 0 } }));
  await page.route("**/api/customers?**", (route) => route.fulfill({ json: {
    items: [customer], nextCursor: "",
  } }));
  await page.route(`**/api/customers/${actorId}`, (route) => {
    if (route.request().method() !== "GET") mutationRequested = true;
    return route.fulfill({ json: { customer } });
  });
  await page.route(`**/api/customers/${actorId}/orders?**`, (route) => route.fulfill({ json: {
    orders: [{
      id: "marketing-order", storeName: "متجر تجريبي", state: "DELIVERED",
      totalAmountMinor: 1000, currency: "YER", paymentMethod: "CASH",
      paymentState: "CAPTURED", createdAt: "2026-10-16T08:00:00Z",
    }],
    nextCursor: "",
    summary: {
      totalOrders: 1, deliveredOrders: 1, cancelledOrders: 0, rejectedOrders: 0,
      failedOrders: 0, openOrders: 0, last30Days: 1, previous30Days: 0,
      distinctStores: 1, firstOrderAt: "2026-10-16T08:00:00Z",
      lastOrderAt: "2026-10-16T08:00:00Z", measuredAt: "2026-10-16T09:00:00Z",
      dailyActivity: [
        { day: "2026-10-10", orders: 0 }, { day: "2026-10-11", orders: 0 },
        { day: "2026-10-12", orders: 0 }, { day: "2026-10-13", orders: 0 },
        { day: "2026-10-14", orders: 0 }, { day: "2026-10-15", orders: 0 },
        { day: "2026-10-16", orders: 1 },
      ],
    },
  } }));
  await page.goto("/marketing/customers");
  await expect(page.getByRole("heading", { name: "سجل العملاء" })).toBeVisible();
  await page.getByRole("button", { name: "فتح ملف +967711555999" }).click();
  await expect(page).toHaveURL(/\/marketing\/customers\?customer=marketing-person/);
  await expect(page.getByRole("tab", { name: "التسويق", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "المالية" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /فتح الطلب/ })).toHaveCount(0);
  await page.getByRole("tab", { name: "الحساب والوصول" }).click();
  await expect(page.getByRole("heading", { name: "إدارة حساب العميل" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "إيقاف حساب العميل" })).toHaveCount(0);
  await page.getByRole("tab", { name: "التسويق", exact: true }).click();
  await expect(page.getByText("هذا تصنيف قراءة فقط", { exact: false })).toBeVisible();
  expect(mutationRequested).toBe(false);
});
