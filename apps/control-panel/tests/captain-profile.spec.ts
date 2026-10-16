import { expect, test } from "./coverage-fixtures";

const identity = {
  subject: "captain-profile-operator", sessionId: "captain-session",
  role: "operator", permissions: ["operations"], surface: "control-panel",
  expiresAt: "2099-01-01T00:00:00.000Z",
};
const captain = {
  actorId: "captain-fixture", phoneE164: "+967777000101", role: "captain",
  enabled: true, securityEnabled: true, activatedAt: "2026-10-10T10:00:00Z",
  createdAt: "2026-10-08T10:00:00Z", actorVersion: 2, roleVersion: 3,
  lastAppOpenedAt: "2026-10-15T12:00:00Z", lastAuthenticatedAt: "2026-10-15T12:00:00Z",
};
const admission = {
  id: "captain-admission-fixture", actorId: "captain-fixture", fullNameAr: "أحمد محمد",
  contactPhoneE164: "+967777000101", walletProviderKey: "provider_a",
  state: "eligible", availabilityState: "available", requiresProfileReview: false,
  version: 5, createdAt: "2026-10-08T10:00:00Z", updatedAt: "2026-10-15T10:00:00Z",
};

test("captain roster opens the canonical file beside the list and restores row focus on close", async ({ page }, testInfo) => {
  await page.route("**/api/auth/session**", (route) => route.fulfill({ json: { identity } }));
  await page.route("**/api/notifications**", (route) => route.fulfill({ json: { notifications: [], unreadCount: 0 } }));
  await page.route("**/api/captains?**", (route) => {
    const url = new URL(route.request().url());
    return route.fulfill({ json: {
      items: url.searchParams.get("scope") === "candidates" ? [] : [{ ...captain, admission }], nextCursor: "",
    } });
  });
  await page.route("**/api/wallet-providers**", (route) => route.fulfill({ json: { walletProviders: [] } }));
  await page.route("**/api/captains/captain-fixture", (route) => route.fulfill({ json: { captain, admission } }));
  await page.route("**/api/finance/**", (route) => route.fulfill({ status: 403, json: { error: { code: "FORBIDDEN" } } }));
  await page.goto("/captains");
  const opener = page.getByRole("button", { name: "فتح ملف أحمد محمد" });
  await opener.click();
  await expect(page).toHaveURL(/\/captains\?captain=captain-fixture/);
  await expect(page.getByRole("heading", { name: "أحمد محمد" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "قائمة الكباتن وأهليتهم وتوفرهم" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("captain-roster-desktop.png"), fullPage: false });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".adaptive-record-workspace .adaptive-record-detail")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("captain-roster-mobile.png"), fullPage: false });
  await page.getByRole("button", { name: "إغلاق التفاصيل" }).click();
  await expect(page).toHaveURL("/captains");
  await expect(opener).toBeFocused();
});

test("captain technical identifiers stay behind support details", async ({ page }) => {
  await page.route("**/api/auth/session**", (route) => route.fulfill({ json: { identity } }));
  await page.route("**/api/notifications**", (route) => route.fulfill({ json: { notifications: [], unreadCount: 0 } }));
  await page.route("**/api/captains/captain-fixture", (route) => route.fulfill({ json: { captain, admission } }));
  await page.route("**/api/finance/**", (route) => route.fulfill({ status: 403, json: { error: { code: "FORBIDDEN" } } }));

  await page.goto("/captains/captain-fixture");
  await expect(page.getByRole("heading", { name: "أحمد محمد" })).toBeVisible();
  await page.getByRole("tab", { name: "الحساب والأهلية" }).click();
  await expect(page.getByText("captain-admission-fixture", { exact: true })).toHaveCount(0);

  await page.getByRole("tab", { name: "السجل" }).click();
  const actorReference = page.getByText("captain-fixture", { exact: true });
  const admissionReference = page.getByText("captain-admission-fixture", { exact: true });
  await expect(actorReference).toBeHidden();
  await expect(admissionReference).toBeHidden();
  await page.getByText("مرجعيات الدعم والتدقيق", { exact: true }).click();
  await expect(actorReference).toBeVisible();
  await expect(admissionReference).toBeVisible();
});

test("captain record is an actionable single-page file without leaking financial data", async ({ page }) => {
  await page.route("**/api/auth/session**", (route) => route.fulfill({ json: { identity } }));
  await page.route("**/api/notifications**", (route) => route.fulfill({ json: { notifications: [], unreadCount: 0 } }));
  await page.route("**/api/captains/captain-fixture", (route) => route.fulfill({ json: { captain, admission } }));
  await page.route("**/api/finance/**", (route) => route.fulfill({ status: 403, json: { error: { code: "FORBIDDEN" } } }));
  await page.goto("/captains/captain-fixture");
  await expect(page.getByRole("heading", { name: "ملف الكابتن" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "أحمد محمد" })).toBeVisible();
  const tabs = page.getByRole("tablist", { name: "أقسام ملف الكابتن" });
  await expect(tabs.getByRole("tab")).toHaveCount(6);
  await expect(tabs.getByRole("tab", { name: /نظرة عامة/ })).toHaveAttribute("aria-selected", "true");
  await tabs.getByRole("tab", { name: /المالية/ }).click();
  await expect(page.getByRole("heading", { name: "المحفظة ووجهة صرف المستحقات" })).toBeVisible();
  await expect(page.getByText("التفاصيل المالية لا تظهر دون صلاحية المالية.")).toBeVisible();
  await expect(page).toHaveURL(/tab=finance/);
  await tabs.getByRole("tab", { name: /الحساب والأهلية/ }).click();
  await expect(page.getByRole("heading", { name: "الانضمام وأهلية التوصيل" })).toBeVisible();
  await expect(page.locator(".captain-profile-actionsMenu summary")).toBeVisible();
  await page.locator(".captain-profile-actionsMenu summary").click();
  await page.getByRole("button", { name: "إيقاف الكابتن" }).click();
  await expect(page.getByRole("button", { name: "تأكيد التنفيذ" })).toBeDisabled();
  await page.getByLabel("سبب الإجراء (5 أحرف على الأقل)").fill("تجربة إيقاف الكابتن");
  await expect(page.getByRole("button", { name: "تأكيد التنفيذ" })).toBeEnabled();
  await page.getByRole("button", { name: "إلغاء" }).click();
  await expect(page.getByRole("button", { name: "تأكيد التنفيذ" })).toHaveCount(0);
});

test("availability update uses the canonical readback before announcing success", async ({ page }) => {
  let currentAvailability: "available" | "unavailable" = "available";
  let posted: unknown = null;
  await page.route("**/api/auth/session**", (route) => route.fulfill({ json: { identity } }));
  await page.route("**/api/notifications**", (route) => route.fulfill({ json: { notifications: [], unreadCount: 0 } }));
  await page.route("**/api/finance/**", (route) => route.fulfill({ status: 403, json: { error: { code: "FORBIDDEN" } } }));
  await page.route("**/api/captains/captain-fixture", (route) => route.fulfill({ json: { captain, admission: { ...admission, availabilityState: currentAvailability, version: currentAvailability === "available" ? 5 : 6 } } }));
  await page.route("**/api/captains", async (route) => {
    posted = route.request().postDataJSON();
    currentAvailability = "unavailable";
    await route.fulfill({ json: { admission: { ...admission, availabilityState: currentAvailability, version: 6 } } });
  });
  await page.goto("/captains/captain-fixture?tab=account");
  await expect(page.getByRole("tab", { name: /الحساب والأهلية/ })).toHaveAttribute("aria-selected", "true");
  await page.locator(".captain-profile-actionsMenu summary").click();
  await page.getByRole("button", { name: "إيقاف استقبال الطلبات" }).click();
  await page.getByLabel("سبب الإجراء (5 أحرف على الأقل)").fill("تغيير حالة التوفر حسب التحقق");
  await page.getByRole("button", { name: "تأكيد التنفيذ" }).click();
  await expect(page.getByRole("status")).toContainText("تم تحديث حالة التوفر والتحقق منها.");
  await page.locator(".captain-profile-actionsMenu summary").click();
  await expect(page.getByRole("button", { name: "السماح باستقبال الطلبات" })).toBeVisible();
  expect(posted).toMatchObject({ action: "availability", actorId: "captain-fixture", available: false, expectedVersion: 5 });
});

test("captain profile fits a narrow viewport without horizontal document overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/auth/session**", (route) => route.fulfill({ json: { identity } }));
  await page.route("**/api/notifications**", (route) => route.fulfill({ json: { notifications: [], unreadCount: 0 } }));
  await page.route("**/api/captains/captain-fixture", (route) => route.fulfill({ json: { captain, admission } }));
  await page.route("**/api/finance/**", (route) => route.fulfill({ status: 403, json: { error: { code: "FORBIDDEN" } } }));
  await page.goto("/captains/captain-fixture");
  await expect(page.getByRole("heading", { name: "أحمد محمد" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);
});

test("performance tab keeps missing delivery KPIs distinct from financial evidence", async ({ page }) => {
  await page.route("**/api/auth/session**", (route) => route.fulfill({ json: { identity } }));
  await page.route("**/api/notifications**", (route) => route.fulfill({ json: { notifications: [], unreadCount: 0 } }));
  await page.route("**/api/captains/captain-fixture", (route) => route.fulfill({ json: { captain, admission } }));
  await page.route("**/api/finance/**", (route) => route.fulfill({ status: 403, json: { error: { code: "FORBIDDEN" } } }));
  await page.goto("/captains/captain-fixture?tab=performance");
  await expect(page.getByRole("tab", { name: /الأداء/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "مؤشرات جودة التوصيل" })).toBeVisible();
  await expect(page.getByText("غير قابل للحساب بعد")).toHaveCount(4);
  await expect(page.getByText("تقييم العملاء")).toBeVisible();
  await expect(page.getByText("غير متاح من مصدر معتمد")).toBeVisible();
  const tabs = page.getByRole("tablist", { name: "أقسام ملف الكابتن" });
  await tabs.getByRole("tab", { name: /الأداء/ }).focus();
  await page.keyboard.press("Home");
  await expect(tabs.getByRole("tab", { name: /نظرة عامة/ })).toHaveAttribute("aria-selected", "true");
  await page.goBack();
  await expect(tabs.getByRole("tab", { name: /الأداء/ })).toHaveAttribute("aria-selected", "true");
});

test("captain admission can be approved from the management file with canonical confirmation", async ({ page }) => {
  let state: "pending_review" | "pending_identity" = "pending_review";
  let action: unknown = null;
  await page.route("**/api/auth/session**", (route) => route.fulfill({ json: { identity } }));
  await page.route("**/api/notifications**", (route) => route.fulfill({ json: { notifications: [], unreadCount: 0 } }));
  await page.route("**/api/finance/**", (route) => route.fulfill({ status: 403, json: { error: { code: "FORBIDDEN" } } }));
  await page.route("**/api/captains/captain-fixture", (route) => route.fulfill({ json: { captain, admission: { ...admission, state, version: state === "pending_review" ? 5 : 6 } } }));
  await page.route("**/api/captains", (route) => {
    action = route.request().postDataJSON();
    state = "pending_identity";
    return route.fulfill({ json: { admission: { ...admission, state, version: 6 } } });
  });
  await page.goto("/captains/captain-fixture");
  await page.locator(".captain-profile-actionsMenu summary").click();
  await page.getByRole("button", { name: "اعتماد طلب الانضمام" }).click();
  await expect(page.getByRole("button", { name: "تأكيد التنفيذ" })).toBeEnabled();
  await page.getByRole("button", { name: "تأكيد التنفيذ" }).click();
  await expect(page.getByRole("status")).toContainText("تم اعتماد الملف");
  await page.locator(".captain-profile-actionsMenu summary").click();
  await expect(page.getByRole("button", { name: "تأسيس حساب الكابتن" })).toBeVisible();
  expect(action).toMatchObject({ action: "approve", admissionId: "captain-admission-fixture", expectedVersion: 5 });
});

test("authorized finance panel exposes existing official wallet destination management", async ({ page }) => {
  await page.route("**/api/auth/session**", (route) => route.fulfill({ json: { identity: { ...identity, permissions: ["operations", "finance"] } } }));
  await page.route("**/api/notifications**", (route) => route.fulfill({ json: { notifications: [], unreadCount: 0 } }));
  await page.route("**/api/captains/captain-fixture", (route) => route.fulfill({ json: { captain, admission } }));
  await page.route("**/api/finance/actor-payout-state**", (route) => route.fulfill({ json: { state: {
    actorId: "captain-fixture", eligibleAvailableMinor: 0, heldMinor: 0, destination: null, latestPayout: null,
  } } }));
  await page.route("**/api/finance/beneficiaries/captain/captain-fixture/financial-statement**", (route) => route.fulfill({ json: { statement: {
    currency: "YER", openingBalanceMinor: 0, creditsMinor: 0, debitsMinor: 0, closingBalanceMinor: 0, currentBalanceMinor: 0, entries: [],
  } } }));
  await page.route("**/api/finance/actor-destination/intent**", (route) => route.fulfill({ json: { intent: {
    actorType: "captain", actorId: "captain-fixture", providerKey: "provider_a", sourceId: "captain-admission-fixture",
  }, operatorActorId: identity.subject } }));
  await page.route("**/api/finance/actor-destination?**", (route) => route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND" } } }));
  await page.route("**/api/wallet-providers**", (route) => route.fulfill({ json: { items: [] } }));
  await page.goto("/captains/captain-fixture?tab=finance");
  await expect(page.getByText("إدارة وجهة المحفظة الرسمية")).toBeVisible();
  await page.getByText("إدارة وجهة المحفظة الرسمية").click();
  await page.getByRole("button", { name: "قراءة النية والوجهة والسجل المالي" }).click();
  await expect(page.getByRole("button", { name: "إنشاء مرشح من هوية ومزوّد مسجلين" })).toBeVisible();
});

test("record tabs share accessible sizing at desktop and phone widths", async ({ page }) => {
  await page.route("**/api/auth/session**", (route) => route.fulfill({ json: { identity } }));
  await page.route("**/api/notifications**", (route) => route.fulfill({ json: { notifications: [], unreadCount: 0 } }));
  await page.route("**/api/captains/captain-fixture", (route) => route.fulfill({ json: { captain, admission } }));
  await page.route("**/api/finance/**", (route) => route.fulfill({ status: 403, json: { error: { code: "FORBIDDEN" } } }));
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/captains/captain-fixture");
    const tabs = page.getByRole("tablist", { name: "أقسام ملف الكابتن" });
    await expect(tabs.getByRole("tab")).toHaveCount(6);
    const geometry = await tabs.evaluate((nav) => {
      const buttons = Array.from(nav.querySelectorAll("button"));
      return {
        wrap: getComputedStyle(nav).flexWrap,
        heights: buttons.map((button) => Math.round(button.getBoundingClientRect().height)),
        tops: buttons.map((button) => Math.round(button.getBoundingClientRect().top)),
        sizes: buttons.map((button) => getComputedStyle(button).fontSize),
        padding: buttons.map((button) => getComputedStyle(button).padding),
        captions: nav.querySelectorAll("small").length,
      };
    });
    expect(geometry.wrap).toBe("nowrap");
    expect(new Set(geometry.tops).size).toBe(1);
    expect(geometry.heights).toEqual(Array(6).fill(width === 390 ? 44 : 40));
    expect(geometry.sizes).toEqual(Array(6).fill("13px"));
    expect(geometry.padding).toEqual(Array(6).fill("8px 12px"));
    expect(geometry.captions).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  }
});


test("captain navigation and management actions share exactly one persistent row", async ({ page }) => {
  await page.route("**/api/auth/session**", (route) => route.fulfill({ json: { identity } }));
  await page.route("**/api/notifications**", (route) => route.fulfill({ json: { notifications: [], unreadCount: 0 } }));
  await page.route("**/api/captains/captain-fixture", (route) => route.fulfill({ json: { captain, admission } }));
  await page.route("**/api/finance/**", (route) => route.fulfill({ status: 403, json: { error: { code: "FORBIDDEN" } } }));
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/captains/captain-fixture");
    const toolbar = page.locator(".captain-profile-toolbar");
    const tabs = toolbar.getByRole("tablist", { name: "أقسام ملف الكابتن" });
    const menu = toolbar.locator(".captain-profile-actionsMenu summary");
    const refresh = toolbar.getByRole("button", { name: "تحديث", exact: true });
    await expect(tabs.getByRole("tab")).toHaveCount(6);
    await expect(menu).toBeVisible();
    await expect(refresh).toBeVisible();
    const layout = await toolbar.evaluate((element) => {
      const nav = element.querySelector('[role="tablist"]')!;
      const summary = element.querySelector("summary")!;
      const refresh = element.querySelector(".captain-profile-toolbarRefresh")!;
      const rect = (node: Element) => node.getBoundingClientRect();
      return {
        wrap: getComputedStyle(element).flexWrap,
        topNav: rect(nav).top, topMenu: rect(summary).top, topRefresh: rect(refresh).top,
        heightNav: rect(nav).height, heightMenu: rect(summary).height,
        overflowPage: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      };
    });
    expect(layout.wrap).toBe("nowrap");
    expect(Math.abs(layout.topNav - layout.topMenu)).toBeLessThanOrEqual(2);
    expect(Math.abs(layout.topMenu - layout.topRefresh)).toBeLessThanOrEqual(2);
    expect(layout.heightNav).toBe(width === 390 ? 44 : 40);
    expect(layout.heightMenu).toBe(width === 390 ? 44 : 40);
    expect(layout.overflowPage).toBe(false);
    await menu.click();
    await expect(toolbar.getByRole("button", { name: "إيقاف الكابتن" })).toBeVisible();
    await toolbar.getByRole("button", { name: "إيقاف الكابتن" }).click();
    await expect(page.getByRole("button", { name: "تأكيد التنفيذ" })).toBeVisible();
    await expect(tabs).toBeVisible();
  }
});
