import { expect, test } from "./coverage-fixtures";

const identity = {
  subject: "layout-operator",
  sessionId: "layout-session",
  role: "operator",
  permissions: ["operations", "partners", "catalog", "marketing", "finance", "hr", "platform_policies", "access", "captains", "field"],
  surface: "control-panel",
  expiresAt: "2099-01-01T00:00:00.000Z",
};

test("all operator centers use the complete desktop workspace without clipping narrow data tables", async ({ page }) => {
  await page.setViewportSize({ width: 2560, height: 960 });
  await page.route("**/api/**", (route) => route.fulfill({
    status: 503, json: { error: { message: "Unavailable in isolated layout proof" } },
  }));
  await page.route("**/api/auth/session**", (route) => route.fulfill({ json: { identity } }));
  await page.route("**/api/notifications**", (route) => route.fulfill({
    json: { notifications: [], unreadCount: 0, nextCursor: "" },
  }));

  for (const route of ["/workspace", "/operations", "/partners", "/catalog", "/marketing", "/finance", "/hr", "/policies", "/access"]) {
    await page.goto(route);
    const layout = page.locator(".workspace-layout");
    await expect(layout, `Shell should exist at ${route}`).toBeVisible();
    const geometry = await layout.evaluate((element) => {
      const main = element.querySelector(".workspace-main");
      if (!main) throw new Error("Workspace main is absent");
      const probe = document.createElement("table");
      probe.innerHTML = "<tbody><tr><td>قيمة</td><td>حالة</td></tr></tbody>";
      probe.className = "layout-proof-table";
      main.appendChild(probe);
      const genericCellMin = getComputedStyle(probe.querySelector("td")!).minInlineSize;
      probe.remove();
      return {
        width: element.getBoundingClientRect().width,
        viewport: document.documentElement.clientWidth,
        genericCellMin,
      };
    });
    expect(geometry.width, `Use all screen width: ${route}`).toBeGreaterThanOrEqual(geometry.viewport - 2);
    expect(geometry.genericCellMin, `Small table cells should not inherit registry minimum: ${route}`).toBe("0px");
  }
});

test("narrow screens keep every operator center within the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/**", (route) => route.fulfill({
    status: 503, json: { error: { message: "Unavailable in isolated layout proof" } },
  }));
  await page.route("**/api/auth/session**", (route) => route.fulfill({ json: { identity } }));
  await page.route("**/api/notifications**", (route) => route.fulfill({
    json: { notifications: [], unreadCount: 0, nextCursor: "" },
  }));

  for (const route of ["/workspace", "/operations", "/partners", "/catalog", "/marketing", "/finance", "/hr", "/policies", "/access"]) {
    await page.goto(route);
    await expect(page.locator(".workspace-layout")).toBeVisible();
    const geometry = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
    }));
    expect(geometry.document, `Document overflow at ${route}`).toBeLessThanOrEqual(geometry.viewport + 1);
    expect(geometry.body, `Body overflow at ${route}`).toBeLessThanOrEqual(geometry.viewport + 1);
  }
});
