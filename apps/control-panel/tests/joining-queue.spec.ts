import { expect, test } from "./coverage-fixtures";

const items = Array.from({ length: 37 }, (_, index) => ({
  id: "joining-" + index,
  businessName: "شريك تجريبي " + index,
  firstStoreName: "متجر " + index,
  contactPhoneE164: "+967777" + String(index).padStart(6, "0"),
  origin: index % 2 ? "control_panel" : "field",
  state: index % 5 === 0 ? "submitted" : index % 5 === 1 ? "admission_requested" : index % 5 === 2 ? "needs_correction" : index % 5 === 3 ? "draft" : "approved",
  createdAt: new Date(Date.UTC(2026, 9, 2 + Math.floor(index / 5))).toISOString(),
  updatedAt: new Date(Date.UTC(2026, 9, 3 + Math.floor(index / 5))).toISOString(),
  version: 1,
}));
test.beforeEach(async ({ page }) => {
  await page.route("**/api/auth/session**", (route) => route.fulfill({ json: { identity: {
    subject: "joining-unified-operator", sessionId: "s", role: "operator", permissions: ["partners"], surface: "control-panel", expiresAt: "2099-01-01T00:00:00.000Z",
  } } }));
  await page.route("**/api/notifications**", (route) => route.fulfill({ json: { notifications: [], unreadCount: 0 } }));
  await page.route("**/api/service-cities**", (route) => route.fulfill({ json: { cities: [] } }));
  await page.route("**/api/partners/workbench?**", (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const kind = url.searchParams.get("kind") || "all";
    const status = url.searchParams.get("status") || "";
    const q = req.method() === "POST" ? (req.postDataJSON() as { q: string }).q : url.searchParams.get("q") || "";
    const filtered = items.filter((c) => (!status || c.state === status) && (!q || [c.businessName,c.firstStoreName,c.contactPhoneE164].some((v) => v.includes(q))));
    if (kind === "access" || kind === "partner" || kind === "store") return route.fulfill({ json: { rows: [], nextCursor: "" } });
    const offset = Number(url.searchParams.get("cursor") || "0");
    const slice = filtered.slice(offset,offset+20);
    return route.fulfill({ json: { rows: slice.map((item) => ({ kind: "joining", case: item })),
      nextCursor: offset+20 < filtered.length ? String(offset+20) : "" } });
  });
});

test("one partner registry pages all 37 joining cases without sampling the first ten", async ({ page }) => {
  await page.goto("/partners/joining");
  await expect(page).toHaveURL(/view=joining/);
  await expect(page.getByRole("navigation", { name: "عرض سجلات الشركاء" })).toHaveCount(0);
  await expect(page.locator('tr[data-kind="joining"]')).toHaveCount(20);
  await page.getByRole("button", { name: "التالي" }).click();
  await expect(page.locator('tr[data-kind="joining"]')).toHaveCount(17);
  await page.getByRole("button", { name: "السابق" }).click();
  await expect(page.locator('tr[data-kind="joining"]')).toHaveCount(20);
});

test("one search and status filter apply to joining cases", async ({ page }) => {
  await page.goto("/partners?kind=joining");
  await page.getByLabel("الحالة").selectOption("submitted");
  await expect(page.locator('tr[data-kind="joining"]')).toHaveCount(8);
  await page.getByLabel("بحث في جميع السجلات").fill("شريك تجريبي 10");
  await page.getByRole("button", { name: "بحث", exact: true }).click();
  await expect(page.locator('tr[data-kind="joining"]')).toHaveCount(1);
  await expect(page.locator('tr[data-kind="joining"]')).toContainText("شريك تجريبي 10");
  await page.getByRole("button", { name: "مسح المرشحات" }).click();
  await expect(page.locator('tr[data-kind="joining"]')).toHaveCount(20);
});

test("select and export joining cases without granting bulk approval", async ({ page }) => {
  await page.goto("/partners?kind=joining");
  await expect(page.getByRole("button", { name: "تصدير المحدد" })).toHaveCount(0);
  await page.getByRole("checkbox", { name: "تحديد طلب شريك تجريبي 0" }).check();
  await expect(page.getByText("1 سجل محدد")).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "تصدير المحدد" }).click();
  expect((await download).suggestedFilename()).toContain("selected-partners.csv");
  await expect(page.getByRole("button", { name: /اعتماد الكل|اعتماد المحدد/ })).toHaveCount(0);
});

test("an unavailable source is shown as an error, not as an empty list", async ({ page }) => {
  await page.route("**/api/partners/workbench?**", (route) => route.fulfill({ status: 503, json: { error: { message: "تعذرت قراءة المصدر" } } }));
  await page.goto("/partners?kind=joining");
  await expect(page.locator(".managed-status[role=alert]")).toContainText("تعذرت قراءة السجلات");
  await expect(page.getByText("لا توجد سجلات مطابقة")).toHaveCount(0);
});
