import { expect, test } from "./coverage-fixtures";

const cases = Array.from({ length: 37 }, (_, index) => {
  const state = index % 5 === 0 ? "submitted" : index % 5 === 1 ? "admission_requested" : index % 5 === 2 ? "needs_correction" : index % 5 === 3 ? "draft" : "approved";
  return {
    id: `case-${index + 1}`,
    businessName: `شريك تجريبي ${index + 1}`,
    firstStoreName: `متجر ${index + 1}`,
    contactPhoneE164: `+96777${String(index + 1).padStart(7, "0")}`,
    origin: index % 2 === 0 ? "field" : "control_panel",
    state,
    version: 1,
    createdAt: new Date(Date.UTC(2026, 9, 1 + Math.floor(index / 5))).toISOString(),
    updatedAt: new Date(Date.UTC(2026, 9, 2 + Math.floor(index / 5))).toISOString(),
  };
});

test.beforeEach(async ({ page }) => {
  test.setTimeout(90_000);
  await page.route("**/api/auth/session**", (route) => route.fulfill({ json: { identity: {
    subject: "operator", sessionId: "session", role: "operator", permissions: ["partners"], surface: "control-panel", expiresAt: "2099-01-01T00:00:00.000Z",
  } } }));
  await page.route("**/api/partners/joining-cases?**", (route) => {
    const url = new URL(route.request().url());
    const state = url.searchParams.get("state") ?? "";
    const q = url.searchParams.get("q") ?? "";
    const sort = url.searchParams.get("sort") ?? "created_asc";
    const offset = Number(url.searchParams.get("cursor") ?? "0");
    const limit = Number(url.searchParams.get("limit") ?? "0");
    if (limit !== 25) return route.fulfill({ status: 400, json: { error: "wrong page size" } });
    const filtered = cases.filter((item) => (!state || state === item.state) && (!q || item.businessName.includes(q) || item.firstStoreName.includes(q) || item.contactPhoneE164.includes(q)));
    if (sort === "created_desc") filtered.reverse();
    const slice = filtered.slice(offset, offset + limit);
    return route.fulfill({ json: { cases: slice, nextCursor: offset + limit < filtered.length ? String(offset + limit) : "" } });
  });
});

test("joining queue browses 37 records with server cursor, search, review stage and back navigation", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto("/partners/joining");
  const table = page.locator(".joining-case-table");
  await expect(table.locator("tbody tr")).toHaveCount(25);
  await expect.poll(() => page.locator(".joining-case-table-wrap").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(page.getByText("المعروض في هذه الصفحة: 25 طلبًا", { exact: false })).toBeVisible();
  await expect(table.getByText("عبر الميداني").first()).toBeVisible();
  await expect(table.getByText("بانتظار قرار المراجعة").first()).toBeVisible();
  await expect(table.getByRole("link", { name: /مراجعة الطلب/ }).first()).toHaveAttribute("href", "/partners/case-1");
  await page.getByRole("button", { name: "التالي" }).click();
  await expect(table.locator("tbody tr")).toHaveCount(12);
  await expect(page.getByText("الصفحة 2")).toBeVisible();
  await page.getByRole("button", { name: "السابق" }).click();
  await expect(table.locator("tbody tr")).toHaveCount(25);

  await page.getByRole("button", { name: "للمراجعة", exact: true }).click();
  await expect(page).toHaveURL(/state=submitted/);
  await expect(table.locator("tbody tr")).toHaveCount(8);
  await expect(table.getByRole("link", { name: /مراجعة الطلب/ })).toHaveCount(8);

  await page.getByRole("searchbox", { name: "ابحث عن طلب" }).fill("شريك تجريبي 11");
  await page.getByRole("button", { name: "بحث", exact: true }).click();
  await expect(page).toHaveURL(/q=/);
  await expect(table.locator("tbody tr")).toHaveCount(1);
  await expect(table.getByText("شريك تجريبي 11")).toBeVisible();
  await page.getByRole("button", { name: "مسح المرشحات" }).click();
  await expect(table.locator("tbody tr")).toHaveCount(25);
  await expect(page).not.toHaveURL(/state=|q=/);
  await page.getByLabel("الترتيب").selectOption("created_desc");
  await expect(table.locator("tbody tr").first()).toContainText("شريك تجريبي 37");
  await page.goBack();
  await expect(table.locator("tbody tr").first()).toContainText("شريك تجريبي 1");
});

test("joining queue supports page-scoped selection and CSV export without bulk approvals", async ({ page }) => {
  await page.goto("/partners/joining");
  await expect(page.locator(".joining-case-table tbody tr")).toHaveCount(25);
  await expect(page.getByRole("button", { name: "تصدير المحدد" })).toHaveCount(0);
  await page.getByRole("checkbox", { name: "تحديد طلب شريك تجريبي 1", exact: true }).check();
  await expect(page.getByText("1 محدد")).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "تصدير المحدد" }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  const csv = Buffer.concat(chunks).toString("utf8");
  expect(csv).toContain("شريك تجريبي 1");
  expect(csv).not.toContain("شريك تجريبي 2");
  await page.getByRole("button", { name: "التالي" }).click();
  await expect(page.getByRole("button", { name: "تصدير المحدد" })).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: "تحديد كل الطلبات في الصفحة" })).not.toBeChecked();
});

test("joining queue keeps identity and action accessible when the table overflows", async ({ page }) => {
  await page.setViewportSize({ width: 740, height: 820 });
  await page.goto("/partners/joining");
  const table = page.locator(".joining-case-table");
  await expect(table.locator("tbody tr")).toHaveCount(25);
  const wrapper = page.locator(".joining-case-table-wrap");
  await expect.poll(() => wrapper.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
  await expect(table.locator("tbody tr").first().locator("th")).toHaveCSS("position", "sticky");
  await expect(table.locator("tbody tr").first().locator("td").last()).toHaveCSS("position", "sticky");
  await expect(table.getByRole("link", { name: /مراجعة الطلب/ }).first()).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("searchbox", { name: "ابحث عن طلب" })).toBeVisible();
  await expect(page.getByRole("button", { name: "للمراجعة", exact: true })).toBeVisible();
  await expect(table.locator("tbody tr")).toHaveCount(25);
});

test("joining queue shows recoverable API errors without false empty success", async ({ page }) => {
  let fail = true;
  await page.route("**/api/partners/joining-cases?**", (route) => fail
    ? route.fulfill({ status: 503, json: { error: { message: "الخدمة غير متاحة مؤقتًا" } } })
    : route.fulfill({ json: { cases: cases.slice(0, 25), nextCursor: "25" } }));
  await page.goto("/partners/joining");
  await expect(page.locator(".joining-case-queue .managed-status-warning[role=alert]")).toContainText("تعذر قراءة طلبات الانضمام");
  await expect(page.getByText("لا توجد طلبات حتى الآن")).toHaveCount(0);
  fail = false;
  await page.getByRole("button", { name: "إعادة المحاولة" }).click();
  await expect(page.locator(".joining-case-table tbody tr")).toHaveCount(25);
  await expect(page.locator(".joining-case-queue .managed-status-warning[role=alert]")).toHaveCount(0);
});

test("joining queue recovers an expired server cursor without discarding the selected stage", async ({ page }) => {
  await page.route("**/api/partners/joining-cases?**", (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.has("cursor")) return route.fulfill({ status: 400, json: { error: { message: "cursor expired" } } });
    return route.fulfill({ json: { cases: cases.filter((item) => item.state === "submitted"), nextCursor: "" } });
  });
  await page.goto("/partners/joining?state=submitted&cursor=expired");
  await expect(page).toHaveURL(/state=submitted/);
  await expect(page).not.toHaveURL(/cursor=/);
  await expect(page.getByRole("status").filter({ hasText: "انتهت صلاحية الصفحة السابقة" })).toBeVisible();
  await expect(page.locator(".joining-case-table tbody tr")).toHaveCount(8);
});
