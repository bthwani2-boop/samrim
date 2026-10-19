import { expect, test } from "./coverage-fixtures";

test("operations overlay recent orders and coarse available Captains without layer buttons", async ({ page }) => {
  await page.route("**/api/auth/session**", (route) => route.fulfill({ json: { identity: {
    subject: "ops-heat-proof", sessionId: "ops-heat-proof", role: "operator",
    permissions: ["operations"], surface: "control-panel", expiresAt: "2099-01-01T00:00:00Z",
  } } }));
  await page.route("**/api/notifications**", (route) => route.fulfill({ json: { notifications: [], unreadCount: 0 } }));
  await page.route("**/api/operations?**", (route) => route.fulfill({ json: { operations: [], nextCursor: "" } }));
  await page.route("**/api/operations/opportunities", (route) => route.fulfill({ json: {
    cells: [
      { latitude: 15.375, longitude: 44.175, intensity: "HIGH", kind: "ORDERS" },
      { latitude: 15.375, longitude: 44.175, intensity: "LOW", kind: "CAPTAINS" },
    ],
    measuredAt: new Date().toISOString(), windowStart: new Date(Date.now() - 1_800_000).toISOString(),
    windowEnd: new Date().toISOString(), signalType: "RECENT_ACTIVITY",
    sampleStatus: "AVAILABLE", policyVersion: "RECENT_COARSE_V2",
  } }));
  // Keep the explicit theme deterministic and intercept the SDK request so this
  // proof does not depend on Google Maps credentials, network timing, or tiles.
  await page.addInitScript({ content: `document.documentElement.dataset.theme="light";` });
  await page.route("https://maps.googleapis.com/maps/api/js**", (route) => route.fulfill({
    contentType: "application/javascript",
    body: `window.google={maps:{
      Map:class {
        constructor(node){this.root=node}
        fitBounds(){} setCenter(){}
      },
      Circle:class {
        constructor(options){
          this.node=document.createElement("span");
          this.node.setAttribute("data-testid","map-heat-circle");
          this.node.setAttribute("data-fill",options.fillColor);
          this.node.setAttribute("data-stroke",options.strokeColor);
          options.map.root.appendChild(this.node);
        }
        setMap(map){if(!map)this.node.remove()}
      },
      LatLngBounds:class {extend(){}}
    }};`,
  }));
  await page.goto("/operations");
  const map = page.getByRole("region", { name: "دوائر الطلبات والكباتن على خريطة واحدة" });
  await expect(map.getByTestId("map-heat-circle")).toHaveCount(2);
  const readSeriesColors = () => page.evaluate(() => {
    const toHex = (value: string) => `#${(value.match(/\d+/g) ?? []).map((part) => Number(part).toString(16).padStart(2, "0")).join("")}`;
    const orderLegend = document.querySelector(".ops-activity-legend-orders");
    const captainLegend = document.querySelector(".ops-activity-legend-captains");
    const circles = Array.from(document.querySelectorAll<HTMLElement>("[data-testid=map-heat-circle]"));
    const rootStyle = getComputedStyle(document.documentElement);
    return {
      orderToken: rootStyle.getPropertyValue("--warning-text").trim().toLowerCase(),
      orderLegend: orderLegend ? toHex(getComputedStyle(orderLegend).color) : "",
      orderFill: circles[0]?.dataset.fill?.toLowerCase() ?? "",
      orderStroke: circles[0]?.dataset.stroke?.toLowerCase() ?? "",
      captainToken: rootStyle.getPropertyValue("--success-text").trim().toLowerCase(),
      captainLegend: captainLegend ? toHex(getComputedStyle(captainLegend).color) : "",
      captainFill: circles[1]?.dataset.fill?.toLowerCase() ?? "",
      captainStroke: circles[1]?.dataset.stroke?.toLowerCase() ?? "",
    };
  });
  const expectSeriesColorsToMatch = async () => {
    const colors = await readSeriesColors();
    expect(colors.orderLegend).toBe(colors.orderToken);
    expect(colors.orderFill).toBe(colors.orderToken);
    expect(colors.orderStroke).toBe(colors.orderToken);
    expect(colors.captainLegend).toBe(colors.captainToken);
    expect(colors.captainFill).toBe(colors.captainToken);
    expect(colors.captainStroke).toBe(colors.captainToken);
  };
  await expectSeriesColorsToMatch();
  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  await expect.poll(async () => {
    const colors = await readSeriesColors();
    return colors.orderFill === colors.orderToken && colors.orderStroke === colors.orderToken
      && colors.captainFill === colors.captainToken && colors.captainStroke === colors.captainToken;
  }).toBe(true);
  await expectSeriesColorsToMatch();
  await page.evaluate(() => document.documentElement.removeAttribute("data-theme"));
  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(async () => {
    const colors = await readSeriesColors();
    return colors.orderFill === colors.orderToken && colors.orderStroke === colors.orderToken
      && colors.captainFill === colors.captainToken && colors.captainStroke === colors.captainToken;
  }).toBe(true);
  await expectSeriesColorsToMatch();
  await expect(page.getByRole("button", { name: "دوائر الكباتن" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "دوائر الطلبات" })).toHaveCount(0);
  await expect(page.getByText(/آخر 30 دقيقة/)).toBeVisible();
  await expect(page.getByText(/دون عرض مواقع الأفراد أو مساراتهم/)).toBeVisible();

  // The map stays visible even with no safe cells, instead of turning into
  // a button or an absent map when this 30-minute window is sparse.
  await page.route("**/api/operations/opportunities", (route) => route.fulfill({ json: {
    cells: [], measuredAt: new Date().toISOString(), windowStart: new Date(Date.now() - 1_800_000).toISOString(),
    windowEnd: new Date().toISOString(), signalType: "RECENT_ACTIVITY",
    sampleStatus: "INSUFFICIENT_DATA", policyVersion: "RECENT_COARSE_V2",
  } }));
  await page.reload();
  const emptyMap = page.getByRole("region", { name: "دوائر الطلبات والكباتن على خريطة واحدة" });
  await expect(emptyMap).toBeVisible();
  await expect(emptyMap.getByTestId("map-heat-circle")).toHaveCount(0);
  await expect(page.getByText(/لا توجد عينة كافية/)).toBeVisible();
});
