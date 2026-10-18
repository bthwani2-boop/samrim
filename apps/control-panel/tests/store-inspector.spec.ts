import { expect, type Page, test } from "@playwright/test";

const first = { id: "inspector-store", partnerActorId: "partner", name: "متجر الاختبار", partnerName: "شريك الاختبار", serviceCityName: "صنعاء", primaryVerticalName: "البقالة", serviceCityId: null, primaryVerticalId: null, commercialStoreTypeId: null, deliveryOrigin: null, publicationState: "published", fulfillmentModes: ["BTHWANI_CAPTAIN"], version: 1, createdAt: "2026-10-12T00:00:00Z", updatedAt: "2026-10-12T00:00:00Z" };
const second = { ...first, id: "second-store", name: "المتجر الثاني" };

const registryRows = (stores: ReadonlyArray<typeof first & { storeProfileImage?: { uri: string; role: string } }>) => stores.map((store) => ({ kind: "store", store, partnerRole: null }));

async function setup(page: Page) {
  await page.route("**/api/**", (route) => route.fulfill({ status: 503, json: { error: { message: "Unmocked API request blocked by the store workbench fixture." } } }));
  await page.route("**/api/auth/session**", (route) => route.fulfill({ json: { identity: { subject: "inspector-operator", sessionId: "inspector-session", role: "operator", permissions: ["partners"], surface: "control-panel", expiresAt: "2099-01-01T00:00:00Z" } } }));
  await page.route("**/api/notifications**", (route) => route.fulfill({ json: { notifications: [], unreadCount: 0 } }));
  await page.route("**/api/service-cities**", (route) => route.fulfill({ json: { cities: [{ id: "sanaa", displayNameAr: "صنعاء" }] } }));
  await page.route("**/api/stores/**/internal-photos**", (route) => route.fulfill({ json: { photos: [] } }));
  await page.route("**/api/partners/workbench**", (route) => route.fulfill({ json: { rows: registryRows([first, second]), nextCursor: "" } }));
}

test("store inspection reads canonical readiness on demand and preserves registry context and focus", async ({ page }) => {
  await setup(page);
  let reads = 0;
  await page.route("**/api/stores/inspector-store/publication", (route) => {
    reads += 1;
    expect(route.request().method()).toBe("GET");
    return route.fulfill({ json: { store: { ...first, publicationState: "hidden", publicationReadiness: { ready: false, blockedReason: "CATALOG_NOT_READY" } }, idempotentReplay: false } });
  });
  await page.goto("/partners?kind=store&q=اختبار&status=published&sort=oldest");
  const trigger = page.locator('.partner-unified-table tr[data-kind="store"]').first().getByRole("button", { name: "إدارة المتجر" });
  await expect(trigger).toBeVisible();
  expect(reads).toBe(0);
  await trigger.click();
  const inspector = page.getByRole("region", { name: "تفاصيل المتجر", exact: true });
  await expect(inspector.getByRole("img", { name: "النشر: مخفي", exact: true })).toBeVisible();
  await expect(inspector).toContainText("لا يوجد كتالوج أو عرض منشور صالح يجعل المتجر جاهزًا");
  await expect(inspector.locator(".workspace-side-drawer-actions").getByRole("button", { name: /نشر|إخفاء المتجر/ })).toHaveCount(0);
  await expect(inspector.getByRole("button", { name: "إدارة المتجر" })).toBeVisible();
  await expect(inspector.getByRole("link", { name: /الملف الكامل/ })).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get("inspect")).toBe(first.id);
  await page.reload();
  await expect(inspector.getByRole("img", { name: "النشر: مخفي", exact: true })).toBeVisible();
  await inspector.getByRole("button", { name: "إغلاق التفاصيل", exact: true }).press("Escape");
  await expect(inspector).toHaveCount(0);
  await expect(trigger).toBeFocused();
  const url = new URL(page.url());
  expect(url.searchParams.get("q")).toBe("اختبار");
  expect(url.searchParams.get("status")).toBe("published");
  expect(url.searchParams.get("sort")).toBe("oldest");
  expect(url.searchParams.has("inspect")).toBe(false);
});

test("store inspection separates forbidden and malformed reads from readiness and retries", async ({ page }) => {
  await setup(page);
  let state = "forbidden";
  await page.route("**/api/stores/inspector-store/publication", (route) => route.fulfill(state === "forbidden"
    ? { status: 403, json: { error: { code: "FORBIDDEN" } } }
    : state === "malformed" ? { json: { store: { ...first, id: second.id, publicationReadiness: { ready: true } } } }
    : { json: { store: { ...first, publicationReadiness: { ready: true } } } }));
  await page.goto("/partners?inspect=inspector-store");
  const inspector = page.getByRole("region", { name: "تفاصيل المتجر", exact: true });
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
  await page.route("**/api/partners/workbench**", (route) => route.fulfill({ json: valid ? { rows: [], nextCursor: "" } : { rows: null, nextCursor: "" } }));
  await page.goto("/partners");
  const registry = page.locator(".store-registry");
  await expect(registry.getByRole("alert")).toContainText("غير صالحة");
  await expect(registry.getByText("لا توجد سجلات مطابقة", { exact: true })).toHaveCount(0);
  valid = true;
  await registry.getByRole("button", { name: "إعادة المحاولة", exact: true }).click();
  await expect(registry.getByText("لا توجد سجلات مطابقة", { exact: true })).toBeVisible();
});

test("store inline management preserves the selected registry query", async ({ page }, testInfo) => {
  await setup(page);
  const reads: URL[] = [];
  await page.route("**/api/partners/workbench**", (route) => {
    const url = new URL(route.request().url()); reads.push(url);
    return route.fulfill({ json: url.searchParams.has("cursor") ? { rows: registryRows([second]), nextCursor: "" } : { rows: registryRows([first]), nextCursor: "store-page-two" } });
  });
  await page.route("**/api/stores/second-store/publication", (route) => route.fulfill({ json: { store: { ...second, publicationReadiness: { ready: true } } } }));
  await page.route("**/api/partners/roster/partner", (route) => route.fulfill({ json: { partner: { actorId: "partner", role: "partner", phoneE164: "+967777000002", enabled: true, securityEnabled: true, activatedAt: "2026-10-01T00:00:00Z" }, joiningCase: null } }));
  await page.goto("/partners?kind=store&q=اختبار&status=published&sort=oldest");
  await page.getByRole("navigation", { name: "صفحات السجل الموحد للشركاء" }).getByRole("button", { name: "التالي", exact: true }).click();
  const trigger = page.locator('.partner-unified-table tr[data-kind="store"]').getByRole("button", { name: "إدارة المتجر" });
  await expect(trigger).toBeVisible();
  await trigger.click();
  const inspector = page.getByRole("region", { name: "تفاصيل المتجر", exact: true });
  await expect(inspector.getByText("المتجر مستوفٍ لشروط النشر الحالية.", { exact: true })).toBeVisible();
  await inspector.getByRole("button", { name: "إدارة المتجر" }).click();
  await expect(page.locator(".adaptive-record-workspace")).toHaveAttribute("data-full", "true");
  await expect(inspector.getByRole("region", { name: "إدارة بيانات المتجر" })).toBeVisible();
  await expect(inspector.getByRole("heading", { name: "تحرير المتجر" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("store-inline-management.png"), fullPage: false });
  await inspector.getByRole("tab", { name: "نظرة عامة" }).click();
  await expect(inspector.getByText("المتجر مستوفٍ لشروط النشر الحالية.", { exact: true }).first()).toBeVisible();
  const restored = new URL(page.url()).searchParams;
  expect(restored.get("cursor")).toBe("page-2");
  expect(restored.get("q")).toBe("اختبار");
  expect(restored.get("status")).toBe("published");
  expect(restored.get("sort")).toBe("oldest");
  expect(restored.get("inspect")).toBe(second.id);
  await inspector.getByRole("button", { name: "إغلاق التفاصيل", exact: true }).click();
  await expect(trigger).toBeFocused();
  await page.getByRole("navigation", { name: "صفحات السجل الموحد للشركاء" }).getByRole("button", { name: "السابق", exact: true }).click();
  await expect(page.locator('.partner-unified-table tr[data-kind="store"]').first().getByRole("button", { name: "إدارة المتجر" })).toBeVisible();
  expect(reads.every((url) => url.searchParams.get("kind") === "store" && url.searchParams.get("q") === "اختبار" && url.searchParams.get("status") === "published" && url.searchParams.get("sort") === "oldest")).toBe(true);
});

test("a failed next store page remains recoverable through the first page", async ({ page }) => {
  await setup(page);
  await page.route("**/api/partners/workbench**", (route) => route.fulfill(new URL(route.request().url()).searchParams.has("cursor")
    ? { status: 503, json: { error: { code: "DSH_STORAGE_UNAVAILABLE" } } }
    : { json: { rows: registryRows([first]), nextCursor: "store-page-two" } }));
  await page.goto("/partners?kind=store&q=اختبار");
  const pagination = page.getByRole("navigation", { name: "صفحات السجل الموحد للشركاء" });
  await pagination.getByRole("button", { name: "التالي", exact: true }).click();
  await expect(page.locator(".store-registry").getByRole("alert")).toBeVisible();
  await pagination.getByRole("button", { name: "السابق", exact: true }).click();
  await expect(page.locator('.partner-unified-table tr[data-kind="store"]').first().getByRole("button", { name: "إدارة المتجر" })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("q")).toBe("اختبار");
});

test("changing a store registry filter preserves the prior cursor page on Back", async ({ page }) => {
  await setup(page);
  const requestedCursors: string[] = [];
  await page.route("**/api/partners/workbench**", (route) => {
    const url = new URL(route.request().url());
    requestedCursors.push(url.searchParams.get("cursor") ?? "");
    return route.fulfill({ json: url.searchParams.has("cursor") ? { rows: registryRows([second]), nextCursor: "" } : { rows: registryRows([first]), nextCursor: "store-page-two" } });
  });
  await page.goto("/partners?kind=store&q=اختبار&status=published&sort=oldest");
  await page.getByRole("navigation", { name: "صفحات السجل الموحد للشركاء" }).getByRole("button", { name: "التالي", exact: true }).click();
  await expect(page.locator('.partner-unified-table tr[data-kind="store"]').first().getByRole("button", { name: "إدارة المتجر" })).toBeVisible();
  await page.locator("#partner-unified-status").selectOption("unpublished");
  await expect(page).toHaveURL(/status=unpublished/);
  await expect(page).not.toHaveURL(/cursor=/);
  await page.goBack();
  await expect(page).toHaveURL(/cursor=page-2/);
  await expect(page.locator("#partner-unified-status")).toHaveValue("published");
  await expect(page.locator('.partner-unified-table tr[data-kind="store"]').first().getByRole("button", { name: "إدارة المتجر" })).toBeVisible();
  expect(requestedCursors.at(-1)).toBe("store-page-two");
});

test("mobile advanced filters stay discoverable and clearing them resets the canonical store view", async ({ page }) => {
  await setup(page);
  await page.route("**/api/service-cities**", (route) => route.fulfill({ json: { cities: [{ id: "sanaa", displayNameAr: "صنعاء" }] } }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/partners?status=published&serviceCityId=sanaa&sort=oldest");
  const status = page.locator("#partner-unified-status");
  await expect(status).toBeVisible();
  await expect(status).toHaveValue("published");
  await expect(page.locator("#partner-unified-city")).toHaveCount(0);
  await page.getByRole("button", { name: "خيارات إضافية" }).click();
  await expect(page.locator("#partner-unified-city")).toHaveValue("sanaa");
  await page.getByRole("button", { name: "مسح المرشحات" }).click();
  await expect(page).not.toHaveURL(/status=|serviceCityId=|sort=|kind=/);
  await expect(status).toHaveValue("");
  await page.setViewportSize({ width: 1368, height: 900 });
  await expect(status).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
});

test("a shared registry renders store rows and verified storeless partners without duplicate accounts", async ({ page }) => {
  await setup(page);
  const partner = { actorId: "no-store-actor", phoneE164: "+967777000001", enabled: true, securityEnabled: true, activatedAt: null };
  let requestCount = 0;
  await page.route("**/api/partners/workbench**", (route) => {
    requestCount += 1;
    const kind = new URL(route.request().url()).searchParams.get("kind");
    if (kind === "partner") return route.fulfill({ json: { rows: [{ kind: "partner", actor: partner }], nextCursor: "" } });
    return route.fulfill({ json: {
      rows: [{ kind: "store", store: first, partnerRole: { actorId: "partner", phoneE164: "+967777000002", enabled: true, securityEnabled: true, activatedAt: "2026-10-01" } }],
      nextCursor: "",
    } });
  });
  await page.goto("/partners");
  const rows = page.locator(".partner-unified-table tbody tr[data-kind=\"store\"]");
  await expect(rows).toHaveCount(1);
  await expect(rows.first().getByRole("img", { name: /نشط/ })).toBeVisible();
  await expect(rows.first().getByRole("link", { name: "شريك الاختبار" })).toHaveAttribute("href", "/partners/actors/partner");
  await page.locator("#partner-unified-kind").selectOption("partner");
  await expect(page).toHaveURL(/kind=partner/);
  const partnerRows = page.locator('.partner-unified-table tbody tr[data-kind="partner"]');
  await expect(partnerRows).toHaveCount(1);
  await expect(rows).toHaveCount(0);
  await expect(partnerRows.first()).toContainText("شريك دون متجر");
  await expect(partnerRows.first().getByRole("img", { name: "الحساب بانتظار التفعيل" })).toBeVisible();
  await expect(partnerRows.first().getByRole("button", { name: /ملف الحساب/ })).toBeVisible();
  expect(requestCount).toBeLessThan(6);
});

test("registry keeps a fixed page-size at thousand-store scale and filters on the server", async ({ page }) => {
  await setup(page);
  const requests: URL[] = [];
  await page.route("**/api/partners/workbench**", (route) => {
    const url = new URL(route.request().url());
    requests.push(url);
    const cursor = url.searchParams.get("cursor");
    const sample = Array.from({ length: 10 }, (_, i) => ({
      kind: "store",
      store: { ...first, id: `store-${cursor ? 10000 + i : i}`, name: `متجر ${cursor ? 10000 + i : i}` },
      partnerRole: null,
    }));
    return route.fulfill({ json: { rows: sample, nextCursor: cursor ? "" : "page-ten-thousand" } });
  });
  await page.goto("/partners");
  await expect(page.locator(".partner-unified-table tbody tr")).toHaveCount(10);
  await page.getByRole("navigation", { name: "صفحات السجل الموحد للشركاء" }).getByRole("button", { name: "التالي" }).click();
  await expect(page.locator(".partner-unified-table tbody tr")).toHaveCount(10);
  await expect(page.locator(".partner-unified-table tbody tr").first()).toContainText("10000");
  await page.locator("#partner-unified-status").selectOption("published");
  await expect(page).toHaveURL(/status=published/);
  await expect(page).not.toHaveURL(/cursor=/);
  expect(requests.every((url) => url.pathname === "/api/partners/workbench" && url.searchParams.get("kind") === "store")).toBe(true);
  expect(requests.length).toBeLessThan(7);
});

test("phone lookup stays out of the browser URL and sends a same-origin private search", async ({ page }) => {
  await setup(page);
  const seen: { method: string; url: string; search: string }[] = [];
  const partner = { actorId: "phone-only-actor", phoneE164: "+967777123456", enabled: true, securityEnabled: true, activatedAt: null };
  await page.route("**/api/partners/workbench**", (route) => {
    const req = route.request();
    const search = req.method() === "POST" ? (req.postDataJSON() as { q: string }).q : "";
    const kind = new URL(req.url()).searchParams.get("kind");
    seen.push({ method: req.method(), url: req.url(), search });
    const rows = kind === "partner" ? [{ kind: "partner", actor: partner }] : registryRows([first]);
    return route.fulfill({ json: { rows, nextCursor: search ? "p1.private-page-cursor" : "" } });
  });
  await page.goto("/partners");
  await page.locator("#partner-unified-kind").selectOption("partner");
  await page.locator("#partner-unified-search").fill("+967777123456");
  await page.locator(".partner-unified-toolbar").getByRole("button", { name: "بحث" }).click();
  await expect(page.locator(".partner-unified-table tbody tr")).toHaveCount(1);
  await expect(page.locator(".partner-unified-table tbody tr").first()).toContainText("+967777123456");
  expect(new URL(page.url()).searchParams.has("q")).toBe(false);
  await expect.poll(() => seen.some((v) => v.method === "POST" && v.search === "+967777123456" && !v.url.includes("+967777123456"))).toBe(true);
  await page.getByRole("navigation", { name: "صفحات السجل الموحد للشركاء" }).getByRole("button", { name: "التالي" }).click();
  expect(new URL(page.url()).searchParams.get("cursor")).toBe("page-2");
  await page.reload();
  await expect(page.locator("#partner-unified-search")).toHaveValue("+967777123456");
  expect(new URL(page.url()).searchParams.has("q")).toBe(false);
});

test("compact indicators preserve independent states and a legend even without pagination", async ({ page }, testInfo) => {
  await setup(page);
  await page.setViewportSize({ width: 1368, height: 900 });
  await page.route("**/api/partners/workbench**", (route) => route.fulfill({ json: { rows: registryRows([{ ...first, fulfillmentModes: ["BTHWANI_CAPTAIN", "PARTNER_CAPTAIN", "CUSTOMER_PICKUP"] }]), nextCursor: "" } }));
  await page.goto("/partners");
  const row = page.locator(".partner-registry-table tbody tr[data-kind=\"store\"]");
  await expect(row.getByRole("img", { name: "حالة الحساب غير متاحة", exact: true })).toBeVisible();
  await expect(row.getByRole("img", { name: "النشر: منشور", exact: true })).toBeVisible();
  for (const name of ["توصيل بثواني", "توصيل المتجر", "استلم بنفسك من المتجر"]) {
    await expect(row.getByRole("img", { name, exact: true })).toBeVisible();
  }
  const publication = row.getByRole("img", { name: "النشر: منشور", exact: true });
  await expect(publication).toHaveAttribute("title", "النشر: منشور");
  await expect(page.getByRole("complementary", { name: "دليل رموز الحساب والنشر والتوصيل" })).toBeVisible();
  await expect(row).toContainText("منشور");
  await expect(page.getByRole("navigation", { name: "صفحات الشركاء والمتاجر" })).toHaveCount(0);
  await expect(page.locator(".partner-unified-table thead th")).toHaveCount(6);
  await expect(page.getByRole("complementary", { name: "دليل رموز الحساب والنشر والتوصيل" })).toContainText("استلم بنفسك من المتجر");
  await page.screenshot({ path: testInfo.outputPath("compact-registry-desktop.png"), fullPage: true });
});

test("a security-disabled identity is never shown as an active account beside a published store", async ({ page }) => {
  await setup(page);
  await page.route("**/api/partners/workbench**", (route) => route.fulfill({ json: { rows: [{ kind: "store", store: first, partnerRole: { actorId: "partner", role: "partner", phoneE164: "+967777000101", enabled: true, securityEnabled: false, activatedAt: "2026-10-01T00:00:00Z", createdAt: "2026-10-01T00:00:00Z", actorVersion: 1, roleVersion: 1 } }], nextCursor: "" } }));
  await page.goto("/partners");
  const row = page.locator(".partner-registry-table tbody tr[data-kind=\"store\"]");
  await expect(row.getByRole("img", { name: "الحساب موقوف", exact: true })).toBeVisible();
  await expect(row.getByRole("img", { name: "الحساب نشط", exact: true })).toHaveCount(0);
  await expect(row.getByRole("img", { name: "النشر: منشور", exact: true })).toBeVisible();
});

test("mobile cards expose states and keep selection and preview recovery usable", async ({ page }, testInfo) => {
  await setup(page);
  await page.route("**/api/stores/inspector-store/publication", (route) => route.fulfill({ json: { store: { ...first, publicationReadiness: { ready: false, blockedReason: "CATALOG_NOT_READY" } } } }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/partners");
  const cards = page.locator(".partner-unified-cards");
  await expect(cards.locator(":scope > li")).toHaveCount(2);
  await expect(cards.getByText("منشور", { exact: true })).toHaveCount(2);
  await cards.getByRole("checkbox", { name: "تحديد متجر الاختبار", exact: true }).check();
  await expect(page.getByRole("button", { name: "تصدير المحدد" })).toBeEnabled();
  const storeCard = cards.locator(':scope > li[data-kind="store"]').filter({ hasText: "متجر الاختبار" }).first();
  const trigger = storeCard.getByRole("button", { name: /إدارة المتجر/ });
  await trigger.click();
  const inspector = page.getByRole("region", { name: "تفاصيل المتجر", exact: true });
  // Published stores remain published even when readiness degrades later.
  await expect(inspector).toContainText("رحلة المتجر — منشور للعملاء");
  await expect(inspector).toContainText("تجهيز الهوية والاتفاقية والكتالوج: قيد الاستكمال");
  await expect(inspector).toContainText("النشر للعميل: مكتمل");
  await expect(inspector.getByRole("button", { name: "إعادة قراءة المعاينة" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(inspector).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(storeCard.getByRole("checkbox", { name: "تحديد متجر الاختبار", exact: true })).toBeChecked();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("compact-registry-mobile.png"), fullPage: true });
});


test("store file tabs render coherent local synthetic product and branch fixtures without modifying backend data", async ({ page }, testInfo) => {
  await setup(page);
  await page.setViewportSize({ width: 1600, height: 940 });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });

  const image = (base: string, icon: string) => "data:image/svg+xml," + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 180"><rect width="240" height="180" fill="${base}"/><circle cx="120" cy="89" r="54" fill="#ffffff" opacity=".14"/><text x="120" y="110" text-anchor="middle" font-size="64">${icon}</text></svg>`,
  );
  const offer = (id: string, productName: string, priceMinor: number, color: string, icon: string) => ({
    offerId: id, storeId: first.id, productId: `product-${id}`, variantId: `variant-${id}`,
    productName, variantTitle: "الحبة", priceMinor, currency: "YER", availability: true, publicationState: "published",
    media: [{ uri: image(color, icon) }], modifierGroups: [], version: 1, updatedAt: "2026-10-16T07:00:00Z",
  });
  await page.route("**/api/stores/inspector-store/publication", (route) => route.fulfill({
    json: { store: { ...first, storeProfileImage: { uri: image("#e5f3ff", "🏪"), role: "primary" }, storeCoverImage: { uri: image("#224c72", "🛒"), role: "cover" }, publicationReadiness: { ready: true, blockedReason: null } } },
  }));
  await page.route("**/api/partners/roster/partner", (route) => route.fulfill({
    json: { partner: { id: "partner", enabled: true, securityEnabled: true, activatedAt: "2026-10-11T12:00:00Z", phoneE164: "+967777111222" },
      joiningCase: { id: "join-test-1", businessName: "متجر الاختبار", state: "approved", firstStoreWorkingHours: {
        intervals: [{ dayOfWeek: 1, opensAt: "08:00", closesAt: "22:00", closesNextDay: false }],
      }, firstStoreProofImageUploaded: true, reviewPhotoUploaded: true } },
  }));
  await page.route("**/api/partners/roster/partner/stores?*", (route) => route.fulfill({
    json: { stores: [first, second], nextCursor: "" },
  }));
  await page.route("**/api/stores/inspector-store/offers?*", (route) => route.fulfill({
    json: { offers: [
      offer("water", "مياه نقية", 600, "#d4eaff", "💧"),
      offer("tomato", "طماطم طازجة", 800, "#ffd6c2", "🍅"),
      offer("banana", "موز بلدي", 1200, "#fff1ad", "🍌"),
    ], nextCursor: "" },
  }));

  await page.goto("/partners");
  await page.locator('.partner-unified-table tr[data-kind="store"]').first().getByRole("button", { name: "إدارة المتجر" }).click();
  const file = page.getByRole("region", { name: "تفاصيل المتجر" });
  await file.getByRole("button", { name: "توسيع ملف السجل" }).click();
  await expect(file.getByRole("tab", { name: "نظرة عامة" })).toHaveAttribute("aria-selected", "true");
  await expect(file.getByRole("tabpanel", { name: "نظرة عامة" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("synthetic-store-overview-dark.png"), fullPage: false });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.screenshot({ path: testInfo.outputPath("synthetic-store-overview-light.png"), fullPage: false });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });

  await file.getByRole("tab", { name: "الكتالوج والمنتجات" }).click();
  await expect(file.getByRole("tabpanel", { name: "الكتالوج والمنتجات" })).toBeVisible();
  await expect(file.getByRole("tabpanel", { name: "نظرة عامة" })).toBeHidden();
  await expect(file.getByRole("tabpanel", { name: "الكتالوج والمنتجات" }).getByText("طماطم طازجة")).toBeVisible();
  await expect(file.getByRole("tabpanel", { name: "الكتالوج والمنتجات" }).getByText("موز بلدي")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("synthetic-store-products-dark.png"), fullPage: false });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(file.getByRole("tabpanel", { name: "الكتالوج والمنتجات" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("synthetic-store-products-mobile.png"), fullPage: false });
  await page.setViewportSize({ width: 1600, height: 940 });

  await file.getByRole("tab", { name: "الفروع" }).click();
  await expect(file.getByRole("tabpanel", { name: "الفروع" }).getByText("المتجر الثاني")).toBeVisible();
  await file.getByRole("tab", { name: "أوقات العمل" }).click();
  await expect(file.getByRole("tabpanel", { name: "أوقات العمل" })).toContainText("08:00");
  await file.getByRole("tab", { name: "الوثائق والاعتمادات" }).click();
  await expect(file.getByRole("tabpanel", { name: "الوثائق والاعتمادات" })).toContainText("مرفقة");
  await expect(file.getByRole("tab", { name: "المالية" })).toHaveCount(0);

  await file.getByRole("tab", { name: "نظرة عامة" }).click();
  await expect(file.getByRole("tabpanel", { name: "نظرة عامة" })).toBeVisible();
  await file.getByRole("button", { name: "استعادة عرض القائمة والملف" }).click();
  await expect(page.locator(".partner-registry-table")).toBeVisible();
});
