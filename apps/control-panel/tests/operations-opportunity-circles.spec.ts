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
  // Supply a deterministic browser-side Maps API before React initializes.
  // No external SDK timing or third-party network request should affect the proof.
  await page.addInitScript({ content: `
    window.google={maps:{
      Map:class {
        constructor(node){this.root=node}
        fitBounds(){} setCenter(){}
      },
      Circle:class {
        constructor(options){
          this.node=document.createElement("span");
          this.node.setAttribute("data-testid","map-heat-circle");
          this.node.setAttribute("data-fill",options.fillColor);
          options.map.root.appendChild(this.node);
        }
        setMap(map){if(!map)this.node.remove()}
      },
      LatLngBounds:class {extend(){}}
    }};
  ` });
  await page.goto("/operations");
  const map = page.getByRole("region", { name: "دوائر الطلبات والكباتن على خريطة واحدة" });
  await expect(map.getByTestId("map-heat-circle")).toHaveCount(2);
  await expect(map.getByTestId("map-heat-circle").nth(0)).toHaveAttribute("data-fill", "#EA6F24");
  await expect(map.getByTestId("map-heat-circle").nth(1)).toHaveAttribute("data-fill", "#0C9B97");
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
