import { canManagePolicy, policyCapabilities } from "../src/features/policies/policy-capabilities";
import { expect, test } from "./coverage-fixtures";

test("catalog retains its existing product register and contextual secondary tools", async ({ page }) => {
  let proposalReads = 0;
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/catalog/proposals") proposalReads++;
    const responses: Record<string, unknown> = {
      "/api/auth/session": { identity: { subject: "catalog-operator", sessionId: "catalog-session",
        role: "operator", permissions: ["catalog"], surface: "control-panel", expiresAt: "2099-01-01T00:00:00.000Z" } },
      "/api/notifications": { notifications: [], unreadCount: 0 },
      "/api/catalog/verticals": { verticals: [] },
      "/api/catalog/products": { products: [], nextCursor: "" },
      "/api/catalog/proposals": { proposals: [], nextCursor: "" },
      "/api/catalog/categories": { categories: [], nextCursor: "" },
    };
    return route.fulfill(path in responses ? { status: 200, json: responses[path] }
      : { status: 404, json: { error: { message: "غير متاح في بيانات الاختبار" } } });
  });
  await page.goto("/catalog");
  await expect(page.getByTestId("catalog-center")).toBeVisible();
  await expect(page.getByRole("button", { name: "جدول المنتجات" })).toBeVisible();
  await expect(page.getByRole("button", { name: "معرض الصور" })).toBeVisible();
  expect(proposalReads).toBe(0);
  await page.getByRole("group", { name: "إدارة الكتالوج" }).getByRole("button", { name: "مقترحات الشركاء" }).click();
  await expect.poll(() => proposalReads).toBeGreaterThan(0);
});

function mockPolicies(page: import("@playwright/test").Page, permissions = ["platform_policies"]) {
  let cityReads = 0;
  let walletReads = 0;
  void page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/service-cities") cityReads++;
    if (path === "/api/wallet-providers") walletReads++;
    const responses: Record<string, unknown> = {
      "/api/auth/session": { identity: { subject: "policy-operator", sessionId: "policy-session",
        role: "operator", permissions, surface: "control-panel", expiresAt: "2099-01-01T00:00:00.000Z" } },
      "/api/notifications": { notifications: [], unreadCount: 0 },
      "/api/service-cities": { cities: [
        { id: "sanaa", displayNameAr: "صنعاء", active: true, version: 1 },
        { id: "ibb", displayNameAr: "إب", active: true, version: 1 },
        { id: "taiz", displayNameAr: "تعز", active: false, version: 1 },
      ] },
      "/api/wallet-providers": { walletProviders: [
        { key: "wallet-1", displayNameAr: "محفظة تجريبية", active: true, version: 1 },
      ] },
      "/api/finance/policy-registry": {
        deliveryFees: [{ id: "", name: "القاعدة العامة", distanceBands: [{ upToMeters: 500, ratePerKmMinor: 150 }, { upToMeters: 5000, ratePerKmMinor: 120 }, { upToMeters: null, ratePerKmMinor: 100 }],
          version: 2, policyVersion: "delivery-fee:global:v2", createdAt: "2026-10-16T08:00:00Z", createdBy: "operator" }],
        deliveryTotal: 1,
        fieldRewards: [{ id: "grocery-market", name: "سوبر ماركت", rewardMinor: 250, version: 1,
          createdAt: "2026-10-16T08:00:00Z", createdBy: "operator" }], fieldTotal: 1,
      },
      "/api/finance/partner-financial-terms-policy": { policy: { id: "terms-1", version: 1,
        settlementPeriod: "WEEKLY", createdBy: "operator", createdAt: "2026-10-16T08:00:00Z" } },
      "/api/finance/captain-minimum-balance-policy": { policy: { id: "captain-min-1", version: 1,
        minimumAvailableMinor: 700, currency: "YER", state: "ACTIVE", createdBy: "operator",
        changeReason: "اعتماد رصيد الكابتن", createdAt: "2026-10-16T08:00:00Z", retiredAt: null } },
    };
    return route.fulfill(path in responses ? { status: 200, json: responses[path] }
      : { status: 404, json: { error: { message: "مورد غير مهيأ للاختبار" } } });
  });
  return { getCityReads: () => cityReads, getWalletReads: () => walletReads };
}

test("policy rich rows show source-backed counts and open a compact summary without editor requests", async ({ page }) => {
  const reads = mockPolicies(page);
  await page.goto("/policies");
  const studio = page.getByTestId("policy-studio");
  const rows = studio.getByRole("list", { name: "سجل سياسات المنصة" }).getByRole("listitem");
  await expect(rows).toHaveCount(6);
  await expect(rows.first()).toContainText("2 نشطة · 1 متوقفة");
  await expect(rows.nth(1)).toContainText("1 نشطة · 0 متوقفة");
  await expect(rows.nth(2)).toContainText("نطاقات تسعير");
  await expect(rows.nth(3)).toContainText("أنواع متاجر");
  await expect(studio.locator(".policy-rich-access")).toHaveCount(0);
  await expect.poll(reads.getCityReads).toBeGreaterThan(0);
  await expect.poll(reads.getWalletReads).toBeGreaterThan(0);
  await expect(studio.locator(".policy-studio-filters")).toHaveCount(0);
  await expect(studio.locator(".policy-studio-facts")).toHaveCount(0);
  await expect(studio.getByRole("dialog")).toHaveCount(0);

  const listWidthBefore = await studio.getByRole("list", { name: "سجل سياسات المنصة" }).evaluate((node) => node.getBoundingClientRect().width);
  await studio.getByRole("button", { name: "معاينة مدن الخدمة" }).click();
  const preview = studio.getByRole("dialog", { name: "معاينة مدن الخدمة" });
  await expect(preview).toBeVisible();
  const listWidthAfter = await studio.getByRole("list", { name: "سجل سياسات المنصة" }).evaluate((node) => node.getBoundingClientRect().width);
  expect(Math.abs(listWidthAfter - listWidthBefore)).toBeLessThan(1);
  await expect(preview).toContainText("2 نشطة");
  await expect(preview).toContainText("1 متوقفة");
  await expect(preview).toContainText("صنعاء");
  await expect(preview).toContainText("إب");
  await expect(preview).toContainText("تعز");
  await expect(studio.locator(".policy-rich-drawer[open]")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(preview).not.toBeVisible();
  await expect(studio.getByRole("button", { name: "معاينة مدن الخدمة" })).toBeFocused();
});

test("policy drawer creates through the existing editor and retains unfinished draft", async ({ page }) => {
  mockPolicies(page);
  await page.goto("/policies");
  const studio = page.getByTestId("policy-studio");
  await studio.getByRole("button", { name: "إدارة سياسة" }).click();
  const chooser = studio.getByRole("dialog", { name: "إدارة سياسة" });
  await chooser.getByLabel("السياسة المعتمدة").selectOption("service-cities");
  const drawer = studio.getByRole("dialog", { name: "مدن الخدمة" });
  await chooser.getByRole("button", { name: "إضافة سياسة أو قاعدة" }).click();
  const create = drawer.locator("details.create-disclosure");
  await expect(create).toHaveAttribute("open", "");
  await drawer.getByLabel("الاسم العربي").fill("مدينة تجريبية");
  await drawer.getByRole("button", { name: "اختيار إجراء آخر" }).click();
  await chooser.getByRole("button", { name: "تعديل سياسة موجودة" }).click();
  await expect(drawer.getByLabel("الاسم العربي")).toHaveValue("مدينة تجريبية");

  await drawer.getByRole("button", { name: "إغلاق تفاصيل السياسة" }).click();
  await expect(drawer).not.toBeVisible();
  await studio.getByRole("button", { name: "إدارة سياسة" }).click();
  await chooser.getByRole("button", { name: "تعديل سياسة موجودة" }).click();
  await expect(drawer.getByLabel("الاسم العربي")).toHaveValue("مدينة تجريبية");
});

test("policy search and finance permission are accurate with no fabricated status", async ({ page }) => {
  mockPolicies(page, ["platform_policies"]);
  await page.goto("/policies?policy=partner-financial-terms");
  const studio = page.getByTestId("policy-studio");
  await expect(studio.getByRole("dialog", { name: "شروط الشريك المالية" })).toHaveCount(0);
  await expect(studio.getByRole("button", { name: "تعديل شروط الشريك المالية" })).toHaveCount(0);
  await expect(studio.getByRole("searchbox", { name: "البحث في السياسات" })).toHaveCount(0);
  await expect(studio.getByRole("list", { name: "سجل سياسات المنصة" }).getByRole("listitem")).toHaveCount(6);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(studio.getByRole("button", { name: "معاينة رسوم التوصيل" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});

test("failed policy summary read does not masquerade as zero records", async ({ page }) => {
  mockPolicies(page);
  await page.route("**/api/service-cities?**", (route) => route.fulfill({ status: 503, json: { error: { message: "unavailable" } } }));
  await page.goto("/policies");
  const studio = page.getByTestId("policy-studio");
  await expect(studio.getByRole("listitem").first()).toContainText("تعذرت قراءة الملخص");
  await studio.getByRole("button", { name: "معاينة مدن الخدمة" }).click();
  await expect(studio.getByRole("dialog", { name: "معاينة مدن الخدمة" })).toContainText("تعذرت قراءة السجلات");
});

test("one policy management action creates a field reward by commercial store type, never by vertical", async ({ page }) => {
  mockPolicies(page);
  let submitted: Record<string, unknown> | null = null;
  let saved = false;
  await page.route("**/api/catalog/verticals", (route) => route.fulfill({ json: { verticals: [
    { id: "grocery", nameAr: "البقالة", active: true },
  ] } }));
  await page.route("**/api/catalog/commercial-store-types?**", (route) => route.fulfill({ json: { storeTypes: [
    { id: "market-store-type", nameAr: "سوبر ماركت", active: true },
  ] } }));
  await page.route("**/api/finance/field-acquisition-policy**", async (route) => {
    if (route.request().method() === "POST") {
      submitted = route.request().postDataJSON() as Record<string, unknown>;
      saved = true;
      return route.fulfill({ json: { idempotentReplay: false } });
    }
    return route.fulfill(saved ? { json: { policy: {
      id: "field-store-policy-1", scopeType: "STORE_TYPE", scopeId: "market-store-type",
      rewardMinor: 250, roundingUnitMinor: 50, state: "ACTIVE", version: 1,
      createdBy: "operator-actor-1", createdAt: "2026-10-16T08:00:00Z", retiredAt: null,
    } } } : { status: 404, json: { error: { code: "NOT_FOUND", message: "not configured" } } });
  });
  await page.goto("/policies");
  const studio = page.getByTestId("policy-studio");
  await studio.getByRole("button", { name: "إدارة سياسة" }).click();
  const chooser = studio.getByRole("dialog", { name: "إدارة سياسة" });
  await expect(chooser.getByLabel("السياسة المعتمدة")).toHaveValue("");
  await chooser.getByLabel("السياسة المعتمدة").selectOption("field-acquisition");
  await chooser.getByRole("button", { name: "إضافة سياسة أو قاعدة" }).click();
  const drawer = studio.getByRole("dialog", { name: "استحقاق ضم الشريك للميداني" });
  await expect(drawer).toContainText("للعثور على نوع المتجر");
  await drawer.locator("#field-reward-vertical").selectOption("grocery");
  await expect(drawer).toContainText("هذا النوع وحده نطاق سياسة المكافأة");
  await drawer.locator("#field-reward-commercial-type").selectOption("market-store-type");
  await expect(drawer).toContainText("لا توجد سياسة لنوع");
  await drawer.getByLabel("مبلغ الاستحقاق (ريال)").fill("250");
  await drawer.getByLabel("سبب الإنشاء أو التغيير").fill("اعتماد مبلغ استحقاق نوع المتجر");
  await drawer.getByRole("button", { name: "إنشاء السياسة" }).click();
  await expect.poll(() => submitted).not.toBeNull();
  expect(submitted).toMatchObject({ scopeType: "STORE_TYPE", scopeId: "market-store-type", rewardMinor: 250 });
  expect(submitted).not.toHaveProperty("verticalId");
  await expect(drawer).toContainText("تم حفظ السياسة ومطابقة مبلغها وإصدارها");
  await expect(drawer.getByRole("region", { name: "بيانات الإصدار المعتمد" })).toContainText("operator-actor-1");
});

test("unified policy management shows only supported families and honors finance permission", async ({ page }) => {
  mockPolicies(page, ["platform_policies"]);
  await page.goto("/policies");
  const studio = page.getByTestId("policy-studio");
  await studio.getByRole("button", { name: "إدارة سياسة" }).click();
  const chooser = studio.getByRole("dialog", { name: "إدارة سياسة" });
  const options = chooser.locator("#policy-manage-target option");
  await expect(options).toHaveCount(6); // placeholder and the five permitted policy families
  await expect(chooser.locator('#policy-manage-target option[value="partner-financial-terms"]')).toHaveCount(0);
  await expect(chooser.getByRole("button", { name: "إضافة سياسة أو قاعدة" })).toBeDisabled();
  await chooser.getByLabel("السياسة المعتمدة").selectOption("wallet-providers");
  await expect(chooser.getByRole("button", { name: "تعديل سياسة موجودة" })).toBeEnabled();
});

test("policy quick preview is anchored, opens without switching editor, and pencil takes one click", async ({ page }) => {
  mockPolicies(page);
  await page.goto("/policies");
  const studio = page.getByTestId("policy-studio");
  const rows = studio.getByRole("list", { name: "سجل سياسات المنصة" });
  await expect(rows.getByRole("listitem")).toHaveCount(6);

  const trigger = studio.getByRole("button", { name: "معاينة مدن الخدمة" });
  const before = await rows.evaluate((node) => node.getBoundingClientRect().width);
  await trigger.click();
  const peek = studio.getByRole("dialog", { name: "معاينة مدن الخدمة" });
  await expect(peek).toBeVisible();
  await expect(peek.getByRole("listitem")).toHaveCount(3);
  await expect(peek).toContainText("صنعاء");
  await expect(peek).toContainText("إب");
  await expect(peek).toContainText("تعز");
  expect(Math.abs((await rows.evaluate((node) => node.getBoundingClientRect().width)) - before)).toBeLessThan(1);
  await expect(studio.locator(".policy-rich-drawer[open]")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await studio.getByRole("button", { name: "تعديل مدن الخدمة" }).click();
  const editor = studio.getByRole("dialog", { name: "مدن الخدمة" });
  await expect(editor).toBeVisible();
  await expect(peek).toHaveCount(0);
  await expect(editor.getByRole("button", { name: "اختيار إجراء آخر" })).toBeVisible();
  await editor.getByRole("button", { name: "إغلاق تفاصيل السياسة" }).click();
  await studio.getByRole("button", { name: "تعديل رسوم التوصيل" }).click();
  await expect(studio.getByRole("dialog", { name: "رسوم التوصيل" })).toBeVisible();
});

test("policy peek respects financial permissions and exposes no inert edit action", async ({ page }) => {
  mockPolicies(page, ["platform_policies"]);
  await page.goto("/policies");
  const studio = page.getByTestId("policy-studio");
  const row = studio.getByRole("listitem").filter({ hasText: "شروط الشريك المالية" });
  await expect(row.getByRole("button", { name: "تعديل شروط الشريك المالية" })).toHaveCount(0);
  await row.getByRole("button", { name: "معاينة شروط الشريك المالية" }).click();
  const peek = studio.getByRole("dialog", { name: "معاينة شروط الشريك المالية" });
  await expect(peek).toBeVisible();
  await expect(peek.getByRole("button", { name: "تعديل" })).toHaveCount(0);
  await expect(peek).toContainText("تتطلب صلاحية المالية");
  await page.keyboard.press("Escape");
  await expect(peek).not.toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await studio.getByRole("button", { name: "معاينة مدن الخدمة" }).click();
  const mobilePeek = studio.getByRole("dialog", { name: "معاينة مدن الخدمة" });
  await expect(mobilePeek).toBeVisible();
  const bounds = await mobilePeek.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(391);
});

test("canonical policy deep links reuse the unified editor and retain financial access restrictions", async ({ page }) => {
  mockPolicies(page, ["platform_policies"]);
  for (const [key, label] of [
    ["service-cities", "مدن الخدمة"],
    ["wallet-providers", "مزودو المحافظ الرسمية"],
    ["delivery-fees", "رسوم التوصيل"],
    ["field-acquisition", "استحقاق ضم الشريك للميداني"],
  ] as const) {
    await page.goto(`/policies?policy=${key}&action=manage`);
    await expect(page).toHaveURL(new RegExp(`/policies\\?policy=${key}&action=manage`));
    await expect(page.getByTestId("policy-studio").getByRole("dialog", { name: label })).toBeVisible();
    await expect(page.getByTestId("policy-studio").getByRole("heading", { name: label })).toBeVisible();
  }
  await page.goto("/policies?policy=partner-financial-terms&action=manage");
  await expect(page).toHaveURL(/\/policies\?policy=partner-financial-terms&action=manage/);
  const financialDialog = page.getByTestId("policy-studio").getByRole("dialog", { name: "شروط الشريك المالية" });
  await expect(financialDialog).toHaveCount(0);
  await expect(page.getByTestId("policy-studio").getByRole("button", { name: "تعديل شروط الشريك المالية" })).toHaveCount(0);
});

test("policy manifest has unique families and one explicit commercial Store Type scope", () => {
  const keys = policyCapabilities.map((item) => item.key);
  const urls = policyCapabilities.map((item) => item.href);
  expect(new Set(keys).size).toBe(keys.length);
  expect(new Set(urls).size).toBe(urls.length);
  expect(policyCapabilities.find((item) => item.key === "field-acquisition")?.scope).toBe("نوع المتجر التجاري");
  expect(policyCapabilities.find((item) => item.key === "field-acquisition")?.owner).toBe("WLT");
  expect(canManagePolicy("partner-financial-terms", ["platform_policies"])).toBe(false);
  expect(canManagePolicy("partner-financial-terms", ["platform_policies", "finance"])).toBe(true);
  expect(canManagePolicy("service-cities", ["platform_policies"])).toBe(true);
});

test("captain minimum balance is managed centrally and refreshes the real policy row", async ({page}) => {
  mockPolicies(page);
  let active=700;
  let version=1;
  let submitted:Record<string,unknown>|null=null;
  await page.route("**/api/finance/captain-minimum-balance-policy**", async route=>{
    const query=new URL(route.request().url()).searchParams;
    if(query.get("history")==="true")return route.fulfill({json:{items:[
      {id:"v2",version:2,minimumAvailableMinor:1000,currency:"YER",state:"ACTIVE",createdBy:"operator",
       createdAt:"2026-10-16T10:00:00Z",changeReason:"رفع الحد للطلبات",retiredAt:null},
    ]}});
    if(route.request().method()==="POST"){
      submitted=route.request().postDataJSON() as Record<string,unknown>;
      active=Number(submitted.minimumAvailableMinor);version+=1;
    }
    return route.fulfill({json:{policy:{id:"captain-policy-1",minimumAvailableMinor:active,version,
      currency:"YER",state:"ACTIVE",createdBy:"operator",createdAt:"2026-10-16T10:00:00Z",
      changeReason:"رفع الحد للطلبات",retiredAt:null}}});
  });
  await page.route("**/api/finance/policy-history?**", route=>route.fulfill({json:{items:[
    {id:"min-audit-1",scopeId:"",version:2,actorId:"operator",createdAt:"2026-10-16T10:00:00Z",
      reason:"رفع الحد للطلبات",field:"الحد الأدنى للرصيد المتاح",before:"700",after:"1000"},
  ]}}));
  await page.goto("/policies");
  const studio=page.getByTestId("policy-studio");
  const row=studio.getByRole("listitem").filter({hasText:"الحد الأدنى لرصيد الكابتن"});
  await expect(row).toContainText("٧٠٠");
  await studio.getByRole("button",{name:"إدارة سياسة"}).click();
  const chooser=studio.getByRole("dialog",{name:"إدارة سياسة"});
  await chooser.getByLabel("السياسة المعتمدة").selectOption("captain-minimum-balance");
  await chooser.getByRole("button",{name:"تعديل سياسة موجودة"}).click();
  const editor=studio.getByRole("dialog",{name:"الحد الأدنى لرصيد الكابتن"});
  await editor.getByLabel("الحد الأدنى للرصيد المتاح (ريال)").fill("1000");
  await editor.getByLabel("سبب الاعتماد أو التعديل").fill("رفع الحد للطلبات");
  await editor.getByRole("button",{name:"اعتماد الحد المعدل"}).click();
  await expect.poll(()=>submitted).toMatchObject({minimumAvailableMinor:1000,expectedVersion:1});
  await expect(editor).toContainText("تم اعتماد الحد الأدنى");
  await editor.getByRole("button",{name:"إغلاق تفاصيل السياسة"}).click();
  await expect(row).toContainText("١٬٠٠٠");
  await row.getByRole("button",{name:"معاينة الحد الأدنى لرصيد الكابتن"}).click();
  const peek=studio.getByRole("dialog",{name:"معاينة الحد الأدنى لرصيد الكابتن"});
  await expect(peek).toContainText("رفع الحد للطلبات");
  const peekBounds = await peek.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, viewportHeight: window.innerHeight };
  });
  expect(peekBounds.top).toBeGreaterThanOrEqual(0);
  expect(peekBounds.bottom).toBeLessThanOrEqual(peekBounds.viewportHeight);
  const operatorReference = peek.getByText("operator", { exact: true });
  await expect(operatorReference).toBeHidden();
  await peek.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await peek.getByText("بيانات التدقيق", { exact: true }).click();
  await expect(operatorReference).toBeVisible();
});

test("unconfigured captain minimum balance is not silently invented", async ({page})=>{
  mockPolicies(page);
  await page.route("**/api/finance/captain-minimum-balance-policy",route=>route.fulfill({
    status:404,json:{error:{code:"CAPTAIN_MINIMUM_BALANCE_NOT_CONFIGURED"}}
  }));
  await page.goto("/policies");
  const studio=page.getByTestId("policy-studio");
  const row=studio.getByRole("listitem").filter({hasText:"الحد الأدنى لرصيد الكابتن"});
  await expect(row).toContainText("لم تُفعّل سياسة بعد");
  await row.getByRole("button",{name:"تعديل الحد الأدنى لرصيد الكابتن"}).click();
  const editor=studio.getByRole("dialog",{name:"الحد الأدنى لرصيد الكابتن"});
  await expect(editor).toContainText("لم تُعتمد سياسة الحد الأدنى بعد");
  await expect(editor.getByRole("button",{name:"اعتماد أول حد"})).toBeDisabled();
});

test("delivery tariff editor is distance-only and calculates progressive tier prices",async({page})=>{
 mockPolicies(page);
 let version=1;
 let activeBands:null|{upToMeters:number|null;ratePerKmMinor:number}[]=null;
 let posted:null|Record<string,unknown>=null;
 await page.route("**/api/finance/distance-band-fee-policy**",async route=>{
  if(route.request().method()==="POST"){
   posted=route.request().postDataJSON() as Record<string,unknown>;
   activeBands=posted.distanceBands as {upToMeters:number|null;ratePerKmMinor:number}[];
   version++;
  }
  await route.fulfill({json:{policy:{
   id:"test-fee",serviceCityId:"",policyVersion:`delivery-fee:global:v${version}`,
   state:"ACTIVE",distanceBands:activeBands,version,createdBy:"operator",createdAt:"2026-10-16T08:00:00Z",retiredAt:null,
  }}});
 });
 await page.goto("/policies");
 await page.getByTestId("policy-studio").getByRole("button",{name:"تعديل رسوم التوصيل"}).click();
 const editor=page.getByTestId("policy-studio").getByRole("dialog",{name:"رسوم التوصيل"});
 await expect(editor).toBeVisible();
 await expect(editor.getByText("رسوم كل وحدة حجم")).toHaveCount(0);
 await expect(editor.getByText("بدل المنطقة")).toHaveCount(0);
 await expect(editor.getByText("الرسوم الأساسية")).toHaveCount(0);
 await editor.getByRole("spinbutton",{name:"سعر الشريحة 1 لكل كيلومتر بالريال"}).fill("150");
 await editor.getByRole("button",{name:"إضافة شريحة"}).click();
 await editor.getByRole("spinbutton",{name:"نهاية الشريحة 1 بالكيلومتر"}).fill("0.5");
 await editor.getByRole("spinbutton",{name:"سعر الشريحة 2 لكل كيلومتر بالريال"}).fill("120");
 await editor.getByRole("button",{name:"إضافة شريحة"}).click();
 await editor.getByRole("spinbutton",{name:"نهاية الشريحة 2 بالكيلومتر"}).fill("5");
 await editor.getByRole("spinbutton",{name:"سعر الشريحة 3 لكل كيلومتر بالريال"}).fill("100");
 await editor.getByLabel("معاينة لمسافة (كم)").fill("6");
 await expect(editor.locator(".delivery-tariff-estimate-total")).toContainText("٧١٥");
 await editor.getByLabel("سبب التعديل").fill("تغيير أسعار شرائح المسافات");
 await editor.getByRole("button",{name:"اعتماد الشرائح"}).click();
 await expect.poll(()=>posted).toMatchObject({
  serviceCityId:"",expectedVersion:1,distanceBands:[
   {upToMeters:500,ratePerKmMinor:150},
   {upToMeters:5000,ratePerKmMinor:120},
   {upToMeters:null,ratePerKmMinor:100},
  ],
 });
 await expect(editor).toContainText("تم اعتماد الشرائح والتحقق من WLT");
});
