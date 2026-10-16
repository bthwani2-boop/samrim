import { expect, test } from "./coverage-fixtures";

const identity = { subject: "partner-unified-operator", sessionId: "s", role: "operator", permissions: ["partners"], surface: "control-panel", expiresAt: "2099-01-01T00:00:00.000Z" };
const store = { id: "store-one", partnerActorId: "actor-one", name: "متجر النور", partnerName: "محمد علي",
  primaryVerticalName: "البقالة", commercialStoreTypeNameAr: "سوبر ماركت", serviceCityName: "صنعاء", serviceCityId: "sanaa",
  fulfillmentModes: ["BTHWANI_CAPTAIN"], publicationState: "published", storeProfileImage: null,
  publicationReadiness: { ready: true, blockedReason: "" }, version: 1, updatedAt: "2026-10-15T12:00:00Z", createdAt: "2026-10-10T10:00:00Z",
};
const joining = { id: "case-one", firstStoreName: "مطعم السعادة", businessName: "مؤسسة السعادة", contactPhoneE164: "+967777000111",
  origin: "field", state: "submitted", createdAt: "2026-10-12T10:00:00Z", updatedAt: "2026-10-15T11:00:00Z", version: 2,
};
const grant = { id: "grant-one", storeId: "store-one", storeName: "متجر النور", delegatePhoneMasked: "***987",
  state: "pending_role_admission", permissions: ["orders", "catalog"], expiresAt: "2026-11-01T10:00:00Z",
  updatedAt: "2026-10-15T12:00:00Z", version: 1,
};
const partner = { actorId: "actor-unlinked", phoneE164: "+967777000222", enabled: true, securityEnabled: true,
  activatedAt: "2026-10-12T10:00:00Z", roleVersion: 1,
};
const allRows = [
  { kind: "joining", case: joining }, { kind: "access", grant },
  { kind: "store", store, partnerRole: { ...partner, actorId: "actor-one", phoneE164: "+967777000333" } },
  { kind: "partner", actor: partner },
];
test.beforeEach(async ({ page }) => {
  await page.route("**/api/auth/session**", (route) => route.fulfill({ json: { identity } }));
  await page.route("**/api/notifications**", (route) => route.fulfill({ json: { notifications: [], unreadCount: 0 } }));
  await page.route("**/api/service-cities**", (route) => route.fulfill({ json: { cities: [{ id: "sanaa", displayNameAr: "صنعاء" }] } }));
});

test("partner directory and onboarding approvals stay in separate server-filtered workspace tabs", async ({ page }, info) => {
  const requestedKinds: string[] = [];
  await page.route("**/api/partners/workbench?**", (route) => {
    const kind = new URL(route.request().url()).searchParams.get("kind") || "all";
    requestedKinds.push(kind);
    return route.fulfill({ json: { rows: allRows.filter((row) => kind === "all" || (kind === "requests" && (row.kind === "joining" || row.kind === "access")) || row.kind === kind), nextCursor: "" } });
  });
  await page.goto("/partners");
  await expect(page.getByRole("tab", { name: "المتاجر والشركاء", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".partner-unified-table tbody tr")).toHaveCount(1);
  await expect(page.locator(".partner-unified-table tbody tr")).toHaveAttribute("data-kind", "store");
  expect(requestedKinds.at(-1)).toBe("store");

  await page.getByRole("tab", { name: "طلبات الانضمام والاعتمادات", exact: true }).click();
  await expect(page).toHaveURL(/tab=requests/);
  await expect(page.getByLabel("نوع السجل")).toHaveValue("requests");
  await expect(page.locator(".partner-unified-table tbody tr")).toHaveCount(2);
  await expect(page.locator('.partner-unified-table tbody tr[data-kind="joining"]')).toHaveCount(1);
  await expect(page.locator('.partner-unified-table tbody tr[data-kind="access"]')).toHaveCount(1);
  await expect(page.locator('.partner-unified-table tbody tr[data-kind="store"]')).toHaveCount(0);
  await expect(page.locator(".partner-unified-table caption")).toHaveText("طلبات الانضمام واعتمادات الوصول");
  expect(requestedKinds.at(-1)).toBe("requests");
  await page.screenshot({ path: info.outputPath("partner-requests-and-access.png"), fullPage: false });

  await page.getByLabel("نوع السجل").selectOption("joining");
  await expect(page.locator(".partner-unified-table tbody tr")).toHaveCount(1);
  await expect(page.locator(".partner-unified-table tbody tr")).toHaveAttribute("data-kind", "joining");
  expect(requestedKinds.at(-1)).toBe("joining");
  await page.getByLabel("نوع السجل").selectOption("access");
  await expect(page.locator(".partner-unified-table tbody tr")).toHaveCount(1);
  await expect(page.locator(".partner-unified-table tbody tr")).toHaveAttribute("data-kind", "access");
  await expect(page.locator(".partner-unified-table caption")).toHaveText("اعتمادات وصول المتاجر");
  expect(requestedKinds.at(-1)).toBe("access");
});

test("the shared toolbar and table keep directory records separate from joining and access work", async ({ page }) => {
  await page.route("**/api/partners/workbench?**", (route) => {
    const kind = new URL(route.request().url()).searchParams.get("kind") || "store";
    return route.fulfill({ json: { rows: allRows.filter((row) => kind === "requests" ? row.kind === "joining" || row.kind === "access" : row.kind === kind), nextCursor: "" } });
  });
  await page.goto("/partners");
  await expect(page.getByRole("heading", { name: "الشركاء والمتاجر" })).toHaveCount(1);
  await expect(page.getByRole("navigation", { name: "عرض سجلات الشركاء" })).toHaveCount(0);
  await expect(page.locator(".partner-unified-table tbody tr")).toHaveCount(1);
  await expect(page.locator('.partner-unified-table tbody tr[data-kind="store"]')).toHaveCount(1);
  await page.getByLabel("نوع السجل").selectOption("partner");
  await expect(page.locator('.partner-unified-table tbody tr[data-kind="partner"]')).toHaveCount(1);
  await expect(page.locator('.partner-unified-table tbody tr[data-kind="joining"]')).toHaveCount(0);
  await page.getByRole("tab", { name: "طلبات الانضمام والاعتمادات" }).click();
  await expect(page.locator('.partner-unified-table tbody tr[data-kind="joining"]')).toHaveCount(1);
  await expect(page.locator('.partner-unified-table tbody tr[data-kind="access"]')).toHaveCount(1);
  await expect(page.locator('.partner-unified-table tbody tr[data-kind="store"]')).toHaveCount(0);
  await page.getByLabel("نوع السجل").selectOption("joining");
  await expect(page.locator('.partner-unified-table tbody tr[data-kind="joining"]')).toHaveCount(1);
  await expect(page.locator('.partner-unified-table tbody tr[data-kind="joining"]')).toContainText("مؤسسة السعادة");
  await page.getByLabel("نوع السجل").selectOption("access");
  await expect(page.locator('.partner-unified-table tbody tr[data-kind="access"]')).toContainText("إدارة الطلبات");
});

test("joining case and access grant are managed inside the same page", async ({ page }) => {
  let posted = 0;
  await page.route("**/api/partners/workbench?**", (route) => {
    const kind = new URL(route.request().url()).searchParams.get("kind") || "store";
    return route.fulfill({ json: { rows: allRows.filter((row) => (kind === "requests" ? row.kind === "joining" || row.kind === "access" : row.kind === kind) && !(posted && row.kind === "access")), nextCursor: "" } });
  });
  await page.route("**/api/partners/joining-cases/case-one", (route) => route.fulfill({ json: { case: {
    ...joining, ownerFullName: "عبدالله أحمد", serviceCityId: "sanaa", firstStoreVerticalId: "grocery",
    firstStoreCommercialTypeId: "grocery", firstStoreAddress: "صنعاء",
    firstStoreFulfillmentModes: ["BTHWANI_CAPTAIN"], firstStoreWorkingHours: { intervals: [] },
    financialProfileState: "REQUIRED", firstStoreProofType: "COMMERCIAL_REGISTRATION",
  } } }));
  await page.route("**/api/partners/store-access-admissions/grant-one/provision", (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().headers()["idempotency-key"]).toBeTruthy();
    posted++;
    return route.fulfill({ json: { state: "active" } });
  });
  await page.goto("/partners");
  await page.getByRole("tab", { name: "طلبات الانضمام والاعتمادات" }).click();
  await page.locator('tr[data-kind="joining"]').getByRole("button", { name: /مراجعة الطلب/ }).click();
  await expect(page.getByRole("region", { name: "ملف طلب الانضمام" })).toBeVisible();
  await page.locator(".adaptive-record-sheet button[aria-label='إغلاق التفاصيل']").click();
  await page.getByLabel("نوع السجل").selectOption("access");
  await page.locator('tr[data-kind="access"]').getByRole("button", { name: /مراجعة الاعتماد/ }).click();
  await expect(page.getByRole("region", { name: "مراجعة اعتماد الوصول" })).toBeVisible();
  await page.getByRole("button", { name: "اعتماد دور الشريك" }).click();
  await expect.poll(() => page.locator('tr[data-kind="access"]').count()).toBe(0);
  expect(posted).toBe(1);
});

test("filters and cursor paging use the same server registry and keep phone searches out of URLs", async ({ page }) => {
  const requests: Array<{ kind: string; q: string; method: string; cursor: string }> = [];
  await page.route("**/api/partners/workbench?**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const kind = url.searchParams.get("kind") || "all";
    const q = req.method() === "POST" ? (req.postDataJSON() as {q:string}).q : url.searchParams.get("q") || "";
    requests.push({kind, q, method: req.method(), cursor: url.searchParams.get("cursor") || ""});
    await route.fulfill({ json: { rows: allRows.filter((row) => row.kind === kind),
      nextCursor: url.searchParams.has("cursor") ? "" : "cursor-test-2" } });
  });
  await page.goto("/partners");
  await expect(page.locator(".partner-unified-table tbody tr")).toHaveCount(1);
  await page.getByRole("button", { name: "التالي" }).click();
  await expect.poll(() => requests.some((r) => r.cursor === "cursor-test-2")).toBe(true);
  await page.getByLabel("بحث في جميع السجلات").fill("+967777000111");
  await page.getByRole("button", { name: "بحث", exact: true }).click();
  await expect.poll(() => requests.some((r) => r.method === "POST" && r.q === "+967777000111")).toBe(true);
  expect(page.url()).not.toContain("+967777000111");
  await page.getByRole("button", { name: "مسح المرشحات" }).click();
  await expect(page.getByLabel("نوع السجل")).toHaveValue("store");
});

test("mobile uses cards and never overflows the page", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/partners/workbench?**", (route) => {
    const kind = new URL(route.request().url()).searchParams.get("kind") || "store";
    return route.fulfill({ json: { rows: allRows.filter((row) => row.kind === kind), nextCursor: "" } });
  });
  await page.goto("/partners");
  await expect(page.locator(".partner-unified-cards > li")).toHaveCount(1);
  await expect(page.locator(".partner-unified-cards")).toBeVisible();
  await expect(page.locator(".partner-unified-table")).toBeHidden();
  const box = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
  expect(box).toBe(true);
});

test("request cards remain visible through the tablet table breakpoint", async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 900 });
  await page.route("**/api/partners/workbench?**", (route) => {
    const kind = new URL(route.request().url()).searchParams.get("kind") || "requests";
    return route.fulfill({ json: { rows: allRows.filter((row) => kind === "requests" ? row.kind === "joining" || row.kind === "access" : row.kind === kind), nextCursor: "" } });
  });
  await page.goto("/partners?tab=requests");
  await expect(page.locator(".partner-unified-cards")).toBeVisible();
  await expect(page.locator(".partner-unified-cards > li")).toHaveCount(2);
  await expect(page.locator(".partner-unified-table-wrap")).toBeHidden();
  await expect(page.locator(".partner-registry-summary")).toContainText("2 سجلًا");
});

test("legacy joining and access URLs open the right type filter without restoring old tabs", async ({ page }) => {
  await page.route("**/api/partners/workbench?**", (route) => {
    const kind = new URL(route.request().url()).searchParams.get("kind") || "joining";
    return route.fulfill({ json: { rows: allRows.filter((row) => row.kind === kind), nextCursor: "" } });
  });
  await page.goto("/partners/joining");
  await expect(page.getByRole("tab", { name: "طلبات الانضمام والاعتمادات" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("نوع السجل")).toHaveValue("joining");
  await page.goto("/partners/store-access");
  await expect(page.getByRole("tab", { name: "طلبات الانضمام والاعتمادات" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("نوع السجل")).toHaveValue("access");
  await page.goto("/partners?kind=joining");
  await expect(page.getByRole("tab", { name: "طلبات الانضمام والاعتمادات" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("نوع السجل")).toHaveValue("joining");
  await page.goto("/partners?kind=access");
  await expect(page.getByRole("tab", { name: "طلبات الانضمام والاعتمادات" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("نوع السجل")).toHaveValue("access");
});

test("unlinked partner opens the real account management workspace without leaving the registry", async ({ page }) => {
  await page.route("**/api/partners/workbench?**", (route) => {
    const kind = new URL(route.request().url()).searchParams.get("kind") || "store";
    return route.fulfill({ json: { rows: allRows.filter((row) => row.kind === kind), nextCursor: "" } });
  });
  await page.route("**/api/partners/roster/actor-unlinked", (route) => route.fulfill({ json: { partner, joiningCase: null } }));
  await page.route("**/api/partners/roster/actor-unlinked/stores?**", (route) => route.fulfill({ json: { stores: [], nextCursor: "" } }));
  await page.goto("/partners");
  await page.getByLabel("نوع السجل").selectOption("partner");
  await page.locator('tr[data-kind="partner"]').getByRole("button", { name: /ملف الحساب/ }).click();
  await expect(page).toHaveURL(/actor=actor-unlinked/);
  const panel = page.getByRole("region", { name: "إدارة حساب الشريك" });
  await expect(panel).toBeVisible();
  await expect(panel.getByText("الحساب والانضمام").first()).toBeVisible();
  await expect(panel.getByText("+967777000222").first()).toBeVisible();
  await panel.getByRole("button", { name: "إغلاق التفاصيل" }).click();
  await expect(page).not.toHaveURL(/actor=/);
});
