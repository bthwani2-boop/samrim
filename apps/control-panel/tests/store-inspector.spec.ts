import { expect, type Page, test } from "@playwright/test";

const first = { id: "inspector-store", partnerActorId: "partner", name: "متجر الاختبار", partnerName: "شريك الاختبار", serviceCityName: "صنعاء", primaryVerticalName: "البقالة", serviceCityId: null, primaryVerticalId: null, commercialStoreTypeId: null, deliveryOrigin: null, publicationState: "published", fulfillmentModes: ["BTHWANI_CAPTAIN"], version: 1, createdAt: "2026-10-12T00:00:00Z", updatedAt: "2026-10-12T00:00:00Z" };
const second = { ...first, id: "second-store", name: "المتجر الثاني" };

async function setup(page: Page) {
  await page.route("**/api/auth/session**", (route) => route.fulfill({ json: { identity: { subject: "inspector-operator", sessionId: "inspector-session", role: "operator", permissions: ["partners"], surface: "control-panel", expiresAt: "2099-01-01T00:00:00Z" } } }));
  await page.route("**/api/notifications**", (route) => route.fulfill({ json: { notifications: [], unreadCount: 0 } }));
  await page.route("**/api/partners/stores**", (route) => route.fulfill({ json: { stores: [first, second] } }));
}

test("store inspection reads canonical readiness on demand and preserves registry context and focus", async ({ page }) => {
  await setup(page);
  let reads = 0;
  await page.route("**/api/stores/inspector-store/publication", (route) => {
    reads += 1;
    expect(route.request().method()).toBe("GET");
    return route.fulfill({ json: { store: { ...first, publicationState: "hidden", publicationReadiness: { ready: false, blockedReason: "CATALOG_NOT_READY" } }, idempotentReplay: false } });
  });
  await page.goto("/partners/stores?q=اختبار&state=published&sort=updated_asc");
  const trigger = page.getByRole("button", { name: "معاينة متجر متجر الاختبار", exact: true });
  await expect(trigger).toBeVisible();
  expect(reads).toBe(0);
  await trigger.click();
  const inspector = page.getByRole("region", { name: "معاينة المتجر", exact: true });
  await expect(inspector.getByText("مخفي", { exact: true })).toBeVisible();
  await expect(inspector).toContainText("لا يوجد كتالوج أو عرض منشور صالح يجعل المتجر جاهزًا");
  await expect(inspector.getByRole("button", { name: /نشر|إخفاء المتجر/ })).toHaveCount(0);
  await expect(inspector.getByRole("link", { name: "فتح ملف المتجر الكامل", exact: true })).toHaveAttribute("href", /\/partners\/stores\/inspector-store\?.*q=/);
  expect(new URL(page.url()).searchParams.get("inspect")).toBe(first.id);
  await page.reload();
  await expect(inspector.getByText("مخفي", { exact: true })).toBeVisible();
  await inspector.getByRole("button", { name: "إغلاق المعاينة", exact: true }).press("Escape");
  await expect(inspector).toHaveCount(0);
  await expect(trigger).toBeFocused();
  const url = new URL(page.url());
  expect(url.searchParams.get("q")).toBe("اختبار");
  expect(url.searchParams.get("state")).toBe("published");
  expect(url.searchParams.get("sort")).toBe("updated_asc");
  expect(url.searchParams.has("inspect")).toBe(false);
});

test("store inspection separates forbidden and malformed reads from readiness and retries", async ({ page }) => {
  await setup(page);
  let state = "forbidden";
  await page.route("**/api/stores/inspector-store/publication", (route) => route.fulfill(state === "forbidden"
    ? { status: 403, json: { error: { code: "FORBIDDEN" } } }
    : state === "malformed" ? { json: { store: { ...first, id: second.id, publicationReadiness: { ready: true } } } }
    : { json: { store: { ...first, publicationReadiness: { ready: true } } } }));
  await page.goto("/partners/stores?inspect=inspector-store");
  const inspector = page.getByRole("region", { name: "معاينة المتجر", exact: true });
  await expect(inspector.getByRole("alert")).toContainText("صلاحية");
  await expect(inspector.getByText("المتجر مستوفٍ لشروط النشر الحالية.", { exact: true })).toHaveCount(0);
  state = "malformed";
  await inspector.getByRole("button", { name: "إعادة قراءة المعاينة", exact: true }).click();
  await expect(inspector.getByRole("alert")).toContainText("غير صالحة");
  state = "ready";
  await inspector.getByRole("button", { name: "إعادة قراءة المعاينة", exact: true }).click();
  await expect(inspector.getByText("المتجر مستوفٍ لشروط النشر الحالية.", { exact: true })).toBeVisible();
});

test("a malformed store registry is recoverable and never claimed empty", async ({ page }) => {
  await setup(page);
  let valid = false;
  await page.route("**/api/partners/stores**", (route) => route.fulfill({ json: valid ? { stores: [] } : { stores: null } }));
  await page.goto("/partners/stores");
  const registry = page.locator(".store-registry");
  await expect(registry.getByRole("alert")).toContainText("غير صالحة");
  await expect(registry.getByText("لا توجد متاجر حاليًا", { exact: true })).toHaveCount(0);
  valid = true;
  await registry.getByRole("button", { name: "إعادة المحاولة", exact: true }).click();
  await expect(registry.getByText("لا توجد متاجر حاليًا", { exact: true })).toBeVisible();
});

test("store pages and the full-file return preserve the selected registry query", async ({ page }) => {
  await setup(page);
  const reads: URL[] = [];
  await page.route("**/api/partners/stores**", (route) => {
    const url = new URL(route.request().url()); reads.push(url);
    return route.fulfill({ json: url.searchParams.has("cursor") ? { stores: [second] } : { stores: [first], nextCursor: "store-page-two" } });
  });
  await page.route("**/api/stores/second-store/publication", (route) => route.fulfill({ json: { store: { ...second, publicationReadiness: { ready: true } } } }));
  await page.goto("/partners/stores?q=اختبار&state=published&sort=updated_asc");
  await page.getByRole("navigation", { name: "صفحات سجل المتاجر" }).getByRole("button", { name: "التالي", exact: true }).click();
  const trigger = page.getByRole("button", { name: "معاينة متجر المتجر الثاني", exact: true });
  await expect(trigger).toBeVisible();
  await trigger.click();
  const inspector = page.getByRole("region", { name: "معاينة المتجر", exact: true });
  await expect(inspector.getByText("المتجر مستوفٍ لشروط النشر الحالية.", { exact: true })).toBeVisible();
  await inspector.getByRole("link", { name: "فتح ملف المتجر الكامل", exact: true }).click();
  await expect(page.getByRole("heading", { name: second.name, level: 1, exact: true })).toBeVisible();
  await page.getByRole("link", { name: "سجل المتاجر", exact: true }).click();
  await expect(inspector.getByText("المتجر مستوفٍ لشروط النشر الحالية.", { exact: true })).toBeVisible();
  const restored = new URL(page.url()).searchParams;
  expect(restored.get("cursor")).toBe("store-page-two");
  expect(restored.get("q")).toBe("اختبار");
  expect(restored.get("state")).toBe("published");
  expect(restored.get("sort")).toBe("updated_asc");
  expect(restored.get("inspect")).toBe(second.id);
  await inspector.getByRole("button", { name: "إغلاق المعاينة", exact: true }).click();
  await expect(trigger).toBeFocused();
  await page.getByRole("navigation", { name: "صفحات سجل المتاجر" }).getByRole("button", { name: "الأولى", exact: true }).click();
  await expect(page.getByRole("button", { name: "معاينة متجر متجر الاختبار", exact: true })).toBeVisible();
  expect(reads.every((url) => url.searchParams.get("q") === "اختبار" && url.searchParams.get("state") === "published" && url.searchParams.get("sort") === "updated_asc" && url.searchParams.get("limit") === "10")).toBe(true);
});

test("a failed next store page remains recoverable through the first page", async ({ page }) => {
  await setup(page);
  await page.route("**/api/partners/stores**", (route) => route.fulfill(new URL(route.request().url()).searchParams.has("cursor")
    ? { status: 503, json: { error: { code: "DSH_STORAGE_UNAVAILABLE" } } }
    : { json: { stores: [first], nextCursor: "store-page-two" } }));
  await page.goto("/partners/stores?q=اختبار");
  const pagination = page.getByRole("navigation", { name: "صفحات سجل المتاجر" });
  await pagination.getByRole("button", { name: "التالي", exact: true }).click();
  await expect(page.locator(".store-registry").getByRole("alert")).toBeVisible();
  await pagination.getByRole("button", { name: "السابق", exact: true }).click();
  await expect(page.getByRole("button", { name: "معاينة متجر متجر الاختبار", exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("q")).toBe("اختبار");
});

test("changing a store registry filter preserves the prior cursor page on Back", async ({ page }) => {
  await setup(page);
  const requestedCursors: string[] = [];
  await page.route("**/api/partners/stores**", (route) => {
    const url = new URL(route.request().url());
    requestedCursors.push(url.searchParams.get("cursor") ?? "");
    return route.fulfill({ json: url.searchParams.has("cursor") ? { stores: [second] } : { stores: [first], nextCursor: "store-page-two" } });
  });
  await page.goto("/partners/stores?q=اختبار&state=published&sort=updated_asc");
  await page.getByRole("navigation", { name: "صفحات سجل المتاجر" }).getByRole("button", { name: "التالي", exact: true }).click();
  await expect(page.getByRole("button", { name: "معاينة متجر المتجر الثاني", exact: true })).toBeVisible();
  await page.locator("#partner-store-publication-filter").selectOption("unpublished");
  await expect(page).toHaveURL(/state=unpublished/);
  await expect(page).not.toHaveURL(/cursor=/);
  await page.goBack();
  await expect(page).toHaveURL(/cursor=store-page-two/);
  await expect(page.locator("#partner-store-publication-filter")).toHaveValue("published");
  await expect(page.getByRole("button", { name: "معاينة متجر المتجر الثاني", exact: true })).toBeVisible();
  expect(requestedCursors.at(-1)).toBe("store-page-two");
});
