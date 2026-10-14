import { expect, type Page, test } from "@playwright/test";

const first = { id: "inspector-store", partnerActorId: "partner", name: "متجر الاختبار", partnerName: "شريك الاختبار", serviceCityName: "صنعاء", primaryVerticalName: "البقالة", serviceCityId: null, primaryVerticalId: null, commercialStoreTypeId: null, deliveryOrigin: null, publicationState: "published", fulfillmentModes: ["BTHWANI_CAPTAIN"], version: 1, createdAt: "2026-10-12T00:00:00Z", updatedAt: "2026-10-12T00:00:00Z" };
const second = { ...first, id: "second-store", name: "المتجر الثاني" };

const registryRows = (stores: ReadonlyArray<typeof first & { storeProfileImage?: { uri: string; role: string } }>) => stores.map((store) => ({ kind: "store", store, partnerRole: null }));

async function setup(page: Page) {
  await page.route("**/api/auth/session**", (route) => route.fulfill({ json: { identity: { subject: "inspector-operator", sessionId: "inspector-session", role: "operator", permissions: ["partners"], surface: "control-panel", expiresAt: "2099-01-01T00:00:00Z" } } }));
  await page.route("**/api/notifications**", (route) => route.fulfill({ json: { notifications: [], unreadCount: 0 } }));
  await page.route("**/api/partners/registry**", (route) => route.fulfill({ json: { rows: registryRows([first, second]) } }));
}

test("store registry shows the canonical logo beside the store and a fallback for stores without images", async ({ page }) => {
  await setup(page);
  const imageUri = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44"><rect width="44" height="44" fill="#567"/></svg>');
  await page.route("**/api/partners/registry**", (route) => route.fulfill({
    json: { rows: registryRows([{ ...first, storeProfileImage: { uri: imageUri, role: "primary" } }, second]) },
  }));
  await page.goto("/partners");
  const rows = page.locator(".store-registry tbody tr");
  await expect(rows).toHaveCount(2);
  const logo = rows.first().getByRole("img", { name: "شعار متجر متجر الاختبار" });
  await expect(logo).toHaveAttribute("src", imageUri);
  await expect.poll(() => logo.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBe(44);
  await expect(rows.nth(1).getByRole("img", { name: "لا يوجد شعار متاح لمتجر المتجر الثاني" })).toBeVisible();
  await expect(rows.first().getByRole("link", { name: "شريك الاختبار" })).toHaveAttribute("href", "/partners/actors/partner");
});
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
  await expect(inspector.getByRole("img", { name: "النشر: مخفي", exact: true })).toBeVisible();
  await expect(inspector).toContainText("لا يوجد كتالوج أو عرض منشور صالح يجعل المتجر جاهزًا");
  await expect(inspector.getByRole("button", { name: /نشر|إخفاء المتجر/ })).toHaveCount(0);
  await expect(inspector.getByRole("link", { name: "فتح ملف المتجر الكامل", exact: true })).toHaveAttribute("href", /\/partners\/stores\/inspector-store\?.*q=/);
  expect(new URL(page.url()).searchParams.get("inspect")).toBe(first.id);
  await page.reload();
  await expect(inspector.getByRole("img", { name: "النشر: مخفي", exact: true })).toBeVisible();
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
  await page.route("**/api/partners/registry**", (route) => route.fulfill({ json: valid ? { rows: [] } : { rows: null } }));
  await page.goto("/partners/stores");
  const registry = page.locator(".store-registry");
  await expect(registry.getByRole("alert")).toContainText("غير صالحة");
  await expect(registry.getByText("لا توجد نتائج مطابقة", { exact: true })).toHaveCount(0);
  valid = true;
  await registry.getByRole("button", { name: "إعادة المحاولة", exact: true }).click();
  await expect(registry.getByText("لا توجد نتائج مطابقة", { exact: true })).toBeVisible();
});

test("store pages and the full-file return preserve the selected registry query", async ({ page }) => {
  await setup(page);
  const reads: URL[] = [];
  await page.route("**/api/partners/registry**", (route) => {
    const url = new URL(route.request().url()); reads.push(url);
    return route.fulfill({ json: url.searchParams.has("cursor") ? { rows: registryRows([second]) } : { rows: registryRows([first]), nextCursor: "store-page-two" } });
  });
  await page.route("**/api/stores/second-store/publication", (route) => route.fulfill({ json: { store: { ...second, publicationReadiness: { ready: true } } } }));
  await page.goto("/partners/stores?q=اختبار&state=published&sort=updated_asc");
  await page.getByRole("navigation", { name: "صفحات الشركاء والمتاجر" }).getByRole("button", { name: "التالي", exact: true }).click();
  const trigger = page.getByRole("button", { name: "معاينة متجر المتجر الثاني", exact: true });
  await expect(trigger).toBeVisible();
  await trigger.click();
  const inspector = page.getByRole("region", { name: "معاينة المتجر", exact: true });
  await expect(inspector.getByText("المتجر مستوفٍ لشروط النشر الحالية.", { exact: true })).toBeVisible();
  await inspector.getByRole("link", { name: "فتح ملف المتجر الكامل", exact: true }).click();
  await expect(page.getByRole("heading", { name: second.name, level: 1, exact: true })).toBeVisible();
  await page.locator("#workspace-main").getByRole("link", { name: "الشركاء والمتاجر", exact: true }).click();
  await expect(inspector.getByText("المتجر مستوفٍ لشروط النشر الحالية.", { exact: true })).toBeVisible();
  const restored = new URL(page.url()).searchParams;
  expect(restored.get("cursor")).toBe("store-page-two");
  expect(restored.get("q")).toBe("اختبار");
  expect(restored.get("state")).toBe("published");
  expect(restored.get("sort")).toBe("updated_asc");
  expect(restored.get("inspect")).toBe(second.id);
  await inspector.getByRole("button", { name: "إغلاق المعاينة", exact: true }).click();
  await expect(trigger).toBeFocused();
  await page.getByRole("navigation", { name: "صفحات الشركاء والمتاجر" }).getByRole("button", { name: "الأولى", exact: true }).click();
  await expect(page.getByRole("button", { name: "معاينة متجر متجر الاختبار", exact: true })).toBeVisible();
  expect(reads.every((url) => url.searchParams.get("q") === "اختبار" && url.searchParams.get("state") === "published" && url.searchParams.get("sort") === "updated_asc" && url.searchParams.get("mode") === "all")).toBe(true);
});

test("a failed next store page remains recoverable through the first page", async ({ page }) => {
  await setup(page);
  await page.route("**/api/partners/registry**", (route) => route.fulfill(new URL(route.request().url()).searchParams.has("cursor")
    ? { status: 503, json: { error: { code: "DSH_STORAGE_UNAVAILABLE" } } }
    : { json: { rows: registryRows([first]), nextCursor: "store-page-two" } }));
  await page.goto("/partners/stores?q=اختبار");
  const pagination = page.getByRole("navigation", { name: "صفحات الشركاء والمتاجر" });
  await pagination.getByRole("button", { name: "التالي", exact: true }).click();
  await expect(page.locator(".store-registry").getByRole("alert")).toBeVisible();
  await pagination.getByRole("button", { name: "السابق", exact: true }).click();
  await expect(page.getByRole("button", { name: "معاينة متجر متجر الاختبار", exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("q")).toBe("اختبار");
});

test("changing a store registry filter preserves the prior cursor page on Back", async ({ page }) => {
  await setup(page);
  const requestedCursors: string[] = [];
  await page.route("**/api/partners/registry**", (route) => {
    const url = new URL(route.request().url());
    requestedCursors.push(url.searchParams.get("cursor") ?? "");
    return route.fulfill({ json: url.searchParams.has("cursor") ? { rows: registryRows([second]) } : { rows: registryRows([first]), nextCursor: "store-page-two" } });
  });
  await page.goto("/partners/stores?q=اختبار&state=published&sort=updated_asc");
  await page.getByRole("navigation", { name: "صفحات الشركاء والمتاجر" }).getByRole("button", { name: "التالي", exact: true }).click();
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

test("mobile filters open on demand and clearing all removes every registry restriction", async ({ page }) => {
  await setup(page);
  await page.route("**/api/service-cities**", (route) => route.fulfill({ json: { cities: [{ id: "sanaa", displayNameAr: "صنعاء" }] } }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/partners?state=published&serviceCityId=sanaa&mode=stores&sort=updated_asc");
  const publication = page.locator("#partner-store-publication-filter");
  await expect(publication).toBeHidden();
  await page.getByRole("button", { name: "الفلاتر والترتيب · مفعلة", exact: true }).click();
  await expect(publication).toBeVisible();
  await page.getByRole("button", { name: "مسح الكل", exact: true }).click();
  await expect(page).not.toHaveURL(/state=|serviceCityId=|mode=|sort=/);
  await expect(publication).toHaveValue("");
  await page.setViewportSize({ width: 1368, height: 900 });
  await expect(publication).toBeVisible();
  await expect(page.getByRole("button", { name: "الفلاتر والترتيب", exact: true })).toBeHidden();
});

test("a shared registry renders store rows and verified storeless partners without duplicate accounts", async ({ page }) => {
  await setup(page);
  const partner = { actorId: "no-store-actor", phoneE164: "+967777000001", enabled: true, securityEnabled: true, activatedAt: null };
  let requestCount = 0;
  await page.route("**/api/partners/registry**", (route) => {
    requestCount += 1;
    const mode = new URL(route.request().url()).searchParams.get("mode");
    if (mode === "without_store") return route.fulfill({ json: { rows: [{ kind: "partner", actor: partner }], nextCursor: "" } });
    return route.fulfill({ json: {
      rows: [{ kind: "store", store: first, partnerRole: { actorId: "partner", phoneE164: "+967777000002", enabled: true, securityEnabled: true, activatedAt: "2026-10-01" } }],
      nextCursor: "bounded-cursor-1",
    } });
  });
  await page.goto("/partners");
  const rows = page.locator(".store-registry tbody tr");
  await expect(rows).toHaveCount(1);
  await expect(rows.first().getByRole("img", { name: /نشط/ })).toBeVisible();
  await expect(rows.first().getByRole("link", { name: "شريك الاختبار" })).toHaveAttribute("href", "/partners/actors/partner");
  await page.locator("#partner-registry-mode").selectOption("without_store");
  await expect(page).toHaveURL(/mode=without_store/);
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("بدون متجر");
  await expect(rows.first()).toContainText("بانتظار التفعيل");
  await expect(rows.first().getByRole("link", { name: "+967777000001" })).toHaveAttribute("href", "/partners/actors/no-store-actor");
  expect(requestCount).toBeLessThan(6);
});

test("registry keeps a fixed page-size at thousand-store scale and filters on the server", async ({ page }) => {
  await setup(page);
  const requests: URL[] = [];
  await page.route("**/api/partners/registry**", (route) => {
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
  await expect(page.locator(".store-registry tbody tr")).toHaveCount(10);
  await page.getByRole("navigation", { name: "صفحات الشركاء والمتاجر" }).getByRole("button", { name: "التالي" }).click();
  await expect(page.locator(".store-registry tbody tr")).toHaveCount(10);
  await expect(page.locator(".store-registry tbody tr").first()).toContainText("10000");
  await page.locator("#partner-store-publication-filter").selectOption("published");
  await expect(page).toHaveURL(/state=published/);
  await expect(page).not.toHaveURL(/cursor=/);
  expect(requests.every((url) => url.pathname === "/api/partners/registry")).toBe(true);
  expect(requests.length).toBeLessThan(7);
});

test("phone lookup stays out of the browser URL and sends a same-origin private search", async ({ page }) => {
  await setup(page);
  const seen: { method: string; url: string; search: string }[] = [];
  const partner = { actorId: "phone-only-actor", phoneE164: "+967777123456", enabled: true, securityEnabled: true, activatedAt: null };
  await page.route("**/api/partners/registry**", (route) => {
    const req = route.request();
    const search = req.method() === "POST" ? (req.postDataJSON() as { q: string }).q : "";
    seen.push({ method: req.method(), url: req.url(), search });
    const rows = search ? [{ kind: "partner", actor: partner }] : registryRows([first]);
    return route.fulfill({ json: { rows, nextCursor: search ? "p1.private-page-cursor" : "" } });
  });
  await page.goto("/partners");
  await page.locator("#partner-store-search").fill("+967777123456");
  await page.locator(".store-registry-search-form").getByRole("button", { name: "بحث" }).click();
  await expect(page.locator(".store-registry tbody tr")).toHaveCount(1);
  await expect(page.locator(".store-registry tbody tr").first()).toContainText("+967777123456");
  expect(new URL(page.url()).searchParams.has("q")).toBe(false);
  await expect.poll(() => seen.some((v) => v.method === "POST" && v.search === "+967777123456" && !v.url.includes("+967777123456"))).toBe(true);
  await page.getByRole("navigation", { name: "صفحات الشركاء والمتاجر" }).getByRole("button", { name: "التالي" }).click();
  expect(new URL(page.url()).searchParams.get("cursor")).toBe("page-2");
  await page.reload();
  await expect(page.locator("#partner-store-search")).toHaveValue("+967777123456");
  expect(new URL(page.url()).searchParams.has("q")).toBe(false);
});

test("store logo opens the shared full-image review and restores keyboard focus", async ({ page }) => {
  await setup(page);
  const imageUri = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44"><rect width="44" height="44" fill="#567"/></svg>');
  await page.route("**/api/partners/registry**", (route) => route.fulfill({
    json: { rows: registryRows([{ ...first, storeProfileImage: { uri: imageUri, role: "primary" } }]) },
  }));
  await page.goto("/partners");
  const trigger = page.getByRole("button", { name: "تكبير شعار متجر متجر الاختبار" });
  await expect(trigger).toBeVisible();
  await trigger.click();
  const viewer = page.getByRole("dialog", { name: "شعار متجر متجر الاختبار" });
  await expect(viewer).toBeVisible();
  await expect(viewer.getByRole("img", { name: "شعار متجر متجر الاختبار" })).toHaveAttribute("src", imageUri);
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("compact indicators preserve independent states and a legend even without pagination", async ({ page }, testInfo) => {
  await setup(page);
  await page.setViewportSize({ width: 1368, height: 900 });
  await page.route("**/api/partners/registry**", (route) => route.fulfill({ json: { rows: registryRows([{ ...first, fulfillmentModes: ["BTHWANI_CAPTAIN", "PARTNER_CAPTAIN", "CUSTOMER_PICKUP"] }]) } }));
  await page.goto("/partners");
  const row = page.locator(".partner-registry-table tbody tr");
  await expect(row.getByRole("img", { name: "حالة الحساب غير متاحة", exact: true })).toBeVisible();
  await expect(row.getByRole("img", { name: "النشر: منشور", exact: true })).toBeVisible();
  for (const name of ["توصيل بثواني", "توصيل المتجر", "استلم بنفسك من المتجر"]) {
    await expect(row.getByRole("img", { name, exact: true })).toBeVisible();
  }
  const publication = row.getByRole("img", { name: "النشر: منشور", exact: true });
  await publication.focus();
  await expect(publication).toHaveAttribute("title", "النشر: منشور");
  await publication.press("Escape");
  await expect(publication).toBeFocused();
  await expect(publication).toHaveAttribute("title", "النشر: منشور");
  await expect(page.getByRole("complementary", { name: "دليل رموز الحساب والنشر والتوصيل" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "صفحات الشركاء والمتاجر" })).toHaveCount(0);
  const share = await row.evaluate((element) => {
    const cells = Array.from(element.querySelectorAll(".indicator-column,.fulfillment-column"));
    return cells.reduce((sum, cell) => sum + cell.getBoundingClientRect().width, 0) / element.getBoundingClientRect().width;
  });
  expect(share).toBeLessThan(0.3);
  await page.screenshot({ path: testInfo.outputPath("compact-registry-desktop.png"), fullPage: true });
});

test("a security-disabled identity is never shown as an active account beside a published store", async ({ page }) => {
  await setup(page);
  await page.route("**/api/partners/registry**", (route) => route.fulfill({ json: { rows: [{ kind: "store", store: first, partnerRole: { actorId: "partner", role: "partner", phoneE164: "+967777000101", enabled: true, securityEnabled: false, activatedAt: "2026-10-01T00:00:00Z", createdAt: "2026-10-01T00:00:00Z", actorVersion: 1, roleVersion: 1 } }] } }));
  await page.goto("/partners");
  const row = page.locator(".partner-registry-table tbody tr");
  await expect(row.getByRole("img", { name: "الحساب موقوف", exact: true })).toBeVisible();
  await expect(row.getByRole("img", { name: "الحساب نشط", exact: true })).toHaveCount(0);
  await expect(row.getByRole("img", { name: "النشر: منشور", exact: true })).toBeVisible();
});

test("mobile cards expose states and keep selection and preview recovery usable", async ({ page }, testInfo) => {
  await setup(page);
  await page.route("**/api/stores/inspector-store/publication", (route) => route.fulfill({ json: { store: { ...first, publicationReadiness: { ready: false, blockedReason: "CATALOG_NOT_READY" } } } }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/partners");
  const cards = page.locator(".store-registry-mobile");
  await expect(cards.locator(":scope > li")).toHaveCount(2);
  await expect(cards.getByRole("img", { name: "النشر: منشور", exact: true })).toHaveCount(2);
  await cards.getByRole("checkbox", { name: "تحديد متجر متجر الاختبار", exact: true }).check();
  await expect(page.getByRole("button", { name: "تصدير المحدد" })).toBeEnabled();
  const trigger = cards.getByRole("button", { name: "معاينة متجر متجر الاختبار", exact: true });
  await trigger.click();
  const inspector = page.getByRole("region", { name: "معاينة المتجر", exact: true });
  await expect(inspector).toContainText("المطلوب قبل النشر");
  await expect(inspector.getByRole("button", { name: "إعادة قراءة المعاينة" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(inspector).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(cards.getByRole("checkbox", { name: "تحديد متجر متجر الاختبار", exact: true })).toBeChecked();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("compact-registry-mobile.png"), fullPage: true });
});
