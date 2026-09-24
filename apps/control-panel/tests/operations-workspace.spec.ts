import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";

const operatorIdentity = {
  subject: "actor-operations-proof",
  sessionId: "session-operations-proof",
  role: "operator",
  permissions: ["operations", "partners", "catalog", "finance", "platform_policies", "access"],
  surface: "control-panel",
  expiresAt: "2099-01-01T00:00:00.000Z",
};

test("operations lanes, order detail routes, and operator recovery follow URL state", async ({ page }) => {
  const listRequests: URL[] = [];
  const actions: Array<Record<string, unknown>> = [];
  const evidenceDirectory = await mkdtemp(path.join(tmpdir(), "bthwani-operations-"));
  let orderState = "DELIVERY_FAILED";
  let assignmentState = "delivery_failed";
  let actionMode: "conflict" | "success" = "conflict";

  await page.setViewportSize({ width: 1440, height: 960 });
  await page.route("**/api/auth/session**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ identity: operatorIdentity }) });
  });
  await page.route("**/api/notifications**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ notifications: [], unreadCount: 0 }) });
  });
  await page.route("**/api/auth/profile**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ phoneE164: "+967700000000" }) });
  });
  await page.route("**/api/operations**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "GET" && url.pathname === "/api/operations") {
      listRequests.push(url);
      const state = url.searchParams.get("state") ?? (url.searchParams.get("actionableOnly") === "true" ? "READY_FOR_DISPATCH" : "CREATED");
      const assignment = state === "CAPTAIN_ASSIGNED"
        ? { id: "assignment-100", orderId: "order_ops_100", captainActorId: "captain-internal", state: "assigned", version: 3, handoffState: "pending" }
        : state === "IN_CUSTODY"
          ? { id: "assignment-100", orderId: "order_ops_100", captainActorId: "captain-internal", state: "in_custody", version: 4, handoffState: "completed" }
          : state === "DELIVERY_FAILED"
            ? { id: "assignment-100", orderId: "order_ops_100", captainActorId: "captain-internal", state: "delivery_failed", version: 4, handoffState: "completed" }
            : null;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          operations: [{
            orderId: "order_ops_100",
            storeName: "متجر صنعاء",
            state,
            updatedAt: "2026-09-22T10:00:00.000Z",
            assignment,
          }],
        }),
      });
      return;
    }
    if (request.method() === "GET" && url.pathname === "/api/operations/order_ops_100") {
      const assignment = orderState === "DELIVERY_FAILED"
        ? { id: "assignment-100", orderId: "order_ops_100", captainActorId: "captain-internal", state: assignmentState, version: 4, handoffState: "completed" }
        : { id: "assignment-100", orderId: "order_ops_100", captainActorId: "captain-internal", state: assignmentState, version: 5, handoffState: "completed" };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          operation: {
            storeName: "متجر صنعاء",
            assignment,
            order: {
              id: "order_ops_100",
              storeId: "store_ops_100",
              state: orderState,
              fulfillmentMode: "BTHWANI_CAPTAIN",
              addressText: "شارع تعز، صنعاء",
              createdAt: "2026-09-22T09:00:00.000Z",
              updatedAt: "2026-09-22T10:00:00.000Z",
              totalAmountMinor: 2500,
              subtotalAmountMinor: 2500,
              discountMinor: 0,
              currency: "YER",
              paymentMethod: "CASH_ON_DELIVERY",
              paymentState: "REQUIRES_COLLECTION",
              lines: [{
                id: "line-100",
                productName: "قهوة مختارة",
                variantTitle: "250 غرام",
                finalQuantityBaseUnits: 1,
                baseUnit: "COUNT",
                lineAmountMinor: 2500,
                currency: "YER",
              }],
            },
          },
        }),
      });
      return;
    }
    await route.continue();
  });
  await page.route("**/api/captains", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    actions.push(route.request().postDataJSON() as Record<string, unknown>);
    if (actionMode === "conflict") {
      await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: { code: "CONFLICT", message: "current assignment changed" } }) });
      return;
    }
    orderState = "IN_CUSTODY";
    assignmentState = "in_custody";
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ state: orderState }) });
  });

  await page.goto("/operations");
  await expect(page.getByRole("heading", { name: "العمليات", exact: true })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  const lanes = page.getByRole("navigation", { name: "مسارات مركز العمليات" });
  await expect(lanes.getByRole("link", { name: "الطلبات" })).toHaveAttribute("aria-current", "page");
  await expect(lanes.getByRole("link", { name: "تحتاج قرارًا" })).toBeVisible();
  await expect(lanes.getByRole("link", { name: "الاستثناءات والاستعادة" })).toBeVisible();

  await page.getByRole("link", { name: "التوزيع", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/lane=dispatch/);
  await expect.poll(() => listRequests.some((url) => url.searchParams.get("state") === "READY_FOR_DISPATCH")).toBe(true);

  await lanes.getByRole("link", { name: "التنفيذ الجاري" }).click();
  await expect(page).toHaveURL(/lane=execution&sub=assigned/);
  const executionSubLanes = page.getByRole("navigation", { name: "مسارات التنفيذ الجاري" });
  await expect(executionSubLanes.getByRole("link", { name: "إسناد الكابتن" })).toHaveAttribute("aria-current", "page");
  await expect(executionSubLanes.getByRole("link", { name: "في عهدة الكابتن" })).toBeVisible();
  await executionSubLanes.getByRole("link", { name: "في عهدة الكابتن" }).click();
  await expect(page).toHaveURL(/lane=execution&sub=custody/);
  await expect.poll(() => listRequests.some((url) => url.searchParams.get("state") === "IN_CUSTODY")).toBe(true);
  await page.locator(".account-menu > summary").click();
  await page.getByRole("radio", { name: "فاتح" }).check();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.locator(".account-menu > summary").click();
  await page.screenshot({ path: path.join(evidenceDirectory, "operations-desktop-light.png") });
  await page.locator(".account-menu > summary").click();
  await page.getByRole("radio", { name: "داكن" }).check();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.locator(".account-menu > summary").click();
  await page.screenshot({ path: path.join(evidenceDirectory, "operations-desktop-dark.png") });
  await page.locator(".account-menu > summary").click();
  await page.getByRole("radio", { name: "فاتح" }).check();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.locator(".account-menu > summary").click();
  const desktopWidth = await page.locator("html").evaluate((element) => element.scrollWidth);
  expect(desktopWidth).toBeLessThanOrEqual(1440);

  await page.reload();
  await expect(page).toHaveURL(/lane=execution&sub=custody/);
  await expect(executionSubLanes.getByRole("link", { name: "في عهدة الكابتن" })).toHaveAttribute("aria-current", "page");
  await page.goBack();
  await expect(page).toHaveURL(/lane=execution&sub=assigned/);
  await page.goForward();
  await expect(page).toHaveURL(/lane=execution&sub=custody/);

  await page.getByRole("link", { name: "order_ops_100" }).click();
  await expect(page).toHaveURL(/\/operations\/order_ops_100\?.*tab=overview/);
  await expect(page.getByRole("navigation", { name: "مساحات تفاصيل الطلب" })).toBeVisible();
  await page.getByRole("navigation", { name: "مساحات تفاصيل الطلب" }).getByRole("link", { name: "العناصر" }).click();
  await expect(page).toHaveURL(/tab=items/);
  await expect(page.getByRole("heading", { name: "عناصر الطلب" })).toBeVisible();
  await expect(page.getByText("قهوة مختارة")).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(/tab=items/);
  await expect(page.getByRole("heading", { name: "عناصر الطلب" })).toBeVisible();

  await page.goto("/operations?lane=exceptions");
  await expect(page.getByRole("heading", { name: "الاستثناءات والاستعادة" })).toBeVisible();
  await expect(page.getByRole("button", { name: "استعادة التسليم" })).toHaveCount(0);
  await page.getByRole("link", { name: "order_ops_100" }).click();
  const detailNavigation = page.getByRole("navigation", { name: "مساحات تفاصيل الطلب" });
  await expect(detailNavigation.getByRole("link", { name: "الاستعادة" })).toBeVisible();
  await page.getByRole("button", { name: "استعادة التسليم" }).click();
  await expect(page.locator(".managed-status[role=alert]")).toContainText("تغيرت حالة الطلب");
  expect(actions).toHaveLength(1);
  expect(actions[0]).toMatchObject({ action: "recover", orderId: "order_ops_100", assignmentId: "assignment-100", expectedVersion: 4 });

  actionMode = "success";
  await page.getByRole("button", { name: "استعادة التسليم" }).click();
  await expect(page.getByRole("status")).toContainText("تم تحديث حالة الطلب بعد إعادة قراءتها من المصدر التشغيلي.");
  await expect(detailNavigation.getByRole("link", { name: "الاستعادة" })).toHaveCount(0);
  await expect(page.getByText("مع الكابتن", { exact: true })).toBeVisible();
  expect(actions).toHaveLength(2);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/operations?lane=exceptions");
  await expect(page.getByRole("heading", { name: "الاستثناءات والاستعادة" })).toBeVisible();
  const laneNavigationBounds = await page.getByRole("navigation", { name: "مسارات مركز العمليات" }).boundingBox();
  const activeLaneBounds = await page.getByRole("navigation", { name: "مسارات مركز العمليات" }).getByRole("link", { name: "الاستثناءات والاستعادة" }).boundingBox();
  if (!laneNavigationBounds || !activeLaneBounds) throw new Error("Expected the active narrow operations lane to render.");
  expect(activeLaneBounds.x).toBeGreaterThanOrEqual(laneNavigationBounds.x);
  expect(activeLaneBounds.x + activeLaneBounds.width).toBeLessThanOrEqual(laneNavigationBounds.x + laneNavigationBounds.width);
  const narrowWidth = await page.locator("html").evaluate((element) => element.scrollWidth);
  expect(narrowWidth).toBeLessThanOrEqual(390);
  const brandBounds = await page.locator(".workspace-header > .brand-link").boundingBox();
  const toolsBounds = await page.locator(".workspace-header > .workspace-header-tools").boundingBox();
  const contextBounds = await page.locator(".workspace-header > .workspace-actor-context").boundingBox();
  await page.screenshot({ path: path.join(evidenceDirectory, "operations-narrow.png") });
  if (!brandBounds || !toolsBounds || !contextBounds) throw new Error("Expected the narrow workspace header regions to render.");
  expect(
    brandBounds.x + brandBounds.width <= toolsBounds.x ||
      toolsBounds.x + toolsBounds.width <= brandBounds.x ||
      brandBounds.y + brandBounds.height <= toolsBounds.y ||
      toolsBounds.y + toolsBounds.height <= brandBounds.y,
  ).toBe(true);
  expect(contextBounds.y).toBeGreaterThanOrEqual(Math.max(brandBounds.y + brandBounds.height, toolsBounds.y + toolsBounds.height));
  console.log(`OPERATIONS_SCREENSHOTS=${evidenceDirectory}`);
});

test("operations server errors and empty search results have distinct recovery states", async ({ page }) => {
  let responseMode: "empty" | "forbidden" = "empty";
  await page.route("**/api/auth/session**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ identity: operatorIdentity }) });
  });
  await page.route("**/api/notifications**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ notifications: [], unreadCount: 0 }) });
  });
  await page.route("**/api/operations**", async (route) => {
    if (responseMode === "forbidden") {
      await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: { code: "FORBIDDEN", message: "forbidden" } }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ operations: [] }) });
  });

  await page.goto("/operations");
  await expect(page.getByText("لا توجد طلبات في هذا المسار", { exact: true })).toBeVisible();
  await page.getByRole("searchbox", { name: "رقم الطلب أو اسم المتجر" }).fill("لا توجد نتيجة");
  await page.getByRole("button", { name: "بحث", exact: true }).click();
  await expect(page).toHaveURL(/q=/);
  await expect(page.getByText("لا توجد نتائج تطابق البحث", { exact: true })).toBeVisible();

  responseMode = "forbidden";
  await page.goto("/operations?lane=dispatch");
  await expect(page.locator(".managed-status[role=alert]")).toContainText("لا تملك صلاحية قراءة هذا المسار");
  await expect(page.getByRole("button", { name: "إعادة المحاولة" })).toBeVisible();
});
