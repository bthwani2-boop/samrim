const assert = require("node:assert/strict");
const { chromium } = require("@playwright/test");

async function run() {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
  const context = browser.contexts().find(c => c.pages().some(p => p.url().startsWith("http://localhost:18102")));
  assert.ok(context, "EXISTING_PARTNER_BROWSER_SESSION_REQUIRED");
  const page = await context.newPage();
  const owned = { id: "probe-owned", name: "المتجر المملوك", serviceCityId: "probe-sanaa", primaryVerticalId: "probe-food", publicationState: "published", fulfillmentModes: ["BTHWANI_CAPTAIN"], owned: true, permissions: [] };
  const delegated = { id: "probe-delegated", name: "المتجر المفوض", serviceCityId: "probe-sanaa", primaryVerticalId: "probe-food", publicationState: "published", fulfillmentModes: ["BTHWANI_CAPTAIN"], owned: false, permissions: ["orders"] };
  const observed = [];
  try {
    await page.route("**/dsh/partner/stores?*", route => {
      observed.push("scope-read");
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ stores: [delegated, owned], nextCursor: "" }) });
    });
    await page.route("**/dsh/partner/stores/probe-owned/access", route => {
      observed.push("owned-grant-read");
      return route.fulfill({ status: 200, contentType: "application/json", body: '{"items":[]}' });
    });
    await page.setViewportSize({ width: 1360, height: 860 });
    await page.goto("http://localhost:18102/more", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.getByRole("button", { name: "اختيار المتجر: المتجر المملوك" }).waitFor({ timeout: 20000 });
    await page.getByRole("button", { name: "اختيار المتجر: المتجر المملوك" }).click();
    await page.getByRole("button", { name: "اختيار متجر المتجر المفوض" }).click();
    await page.getByRole("link", { name: "الموظفين", exact: true }).click();
    await page.waitForURL(url => new URL(url).pathname === "/employees", { timeout: 15000 });
    await page.getByText("اختر أحد متاجرك المملوكة من القائمة للمتابعة.", { exact: true }).waitFor({ timeout: 20000 });
    assert.equal(await page.getByRole("button", { name: "إضافة موظف" }).count(), 0, "DELEGATED_STORE_MUST_NOT_OFFER_EMPLOYEE_WRITE");
    await page.getByRole("button", { name: "اختيار المتجر: اختر متجرًا مصرحًا" }).click();
    assert.equal(await page.getByRole("button", { name: "اختيار متجر المتجر المفوض" }).count(), 0, "EMPLOYEE_SCOPE_SELECTOR_MUST_HIDE_DELEGATED_STORE");
    await page.getByRole("button", { name: "اختيار متجر المتجر المملوك" }).click();
    await page.getByRole("button", { name: "إضافة موظف" }).waitFor({ timeout: 18000 });
    await page.getByText("موظفو المتجر", { exact: true }).waitFor({ timeout: 18000 });
    assert.ok(observed.includes("scope-read"), "SCOPES_MUST_BE_READ");
    assert.ok(observed.includes("owned-grant-read"), "OWNER_GRANTS_MUST_BE_READ_AFTER_SELECTION");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2);
    assert.equal(overflow, false);
    console.log("MIXED_OWNED_DELEGATED_EMPLOYEES=PASS");
  } finally {
    await page.close().catch(() => {});
    await browser.close();
  }
}
run().catch(e => { console.error("MIXED_OWNED_DELEGATED_EMPLOYEES=FAIL " + String(e.stack || e)); process.exitCode = 1; });
