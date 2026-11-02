const assert = require("node:assert/strict");
const { chromium } = require("@playwright/test");

// UI integration test with scoped DSH responses; live financial/data state is untouched.
async function run() {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
  let page;
  try {
    const context = browser.contexts().find(c => c.pages().some(p => p.url().startsWith("http://localhost:18102"))) ?? browser.contexts()[0];
    assert.ok(context, "EXISTING_AUTHORIZED_PARTNER_CONTEXT_REQUIRED");
    page = await context.newPage();
    await page.setViewportSize({ width: 390, height: 844 });
    let reads = 0;
    let foreign = false;
    await page.route("**/dsh/stores/*/inventory-summary", async route => {
      reads++;
      const url = new URL(route.request().url());
      const segments = url.pathname.split("/");
      const storeId = decodeURIComponent(segments[segments.indexOf("stores") + 1] || "");
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        summary: {
          storeId: foreign ? "foreign-store" : storeId,
          totalOffers: 1000, publishedOffers: 900,
          availableOffers: 637, unavailableOffers: 263, stockoutOffers: 57,
        },
      }) });
    });
    await page.goto("http://localhost:18102/more", { waitUntil: "domcontentloaded", timeout: 25000 });
    await page.getByRole("button", { name: "منتجات متاحة، عرض التفاصيل" }).waitFor({ state: "visible", timeout: 20000 });
    await page.getByText(new Intl.NumberFormat("ar-YE").format(637), { exact: true }).waitFor({ state: "visible", timeout: 15000 });
    const stockoutButton = page.getByRole("button", { name: "نفاد المخزون، عرض التفاصيل" });
    await stockoutButton.waitFor({ state: "visible", timeout: 14000 });
    assert.ok(reads > 0);
    const layout = await page.evaluate(() => ({
      rtl: document.documentElement.dir,
      hasDesktopSidebar: !!document.querySelector('[aria-label="التنقل الرئيسي للشريك"]'),
      overflow: document.documentElement.scrollWidth > window.innerWidth + 2,
    }));
    assert.equal(layout.rtl, "rtl");
    assert.equal(layout.hasDesktopSidebar, false);
    assert.equal(layout.overflow, false);
    await stockoutButton.click();
    await page.waitForURL(u => new URL(u).pathname === "/products", { timeout: 15000 });
    assert.equal(new URL(page.url()).searchParams.get("filter"), "stockout");

    foreign = true;
    await page.goto("http://localhost:18102/more", { waitUntil: "domcontentloaded", timeout: 25000 });
    await page.getByRole("button", { name: "منتجات متاحة، عرض التفاصيل" }).waitFor({ state: "visible", timeout: 15000 });
    await page.getByText("—", { exact: true }).first().waitFor({ state: "visible", timeout: 15000 });
    assert.equal(await page.getByRole("button", { name: "نفاد المخزون، عرض التفاصيل" }).count(), 0);
    assert.equal(await page.getByText(new Intl.NumberFormat("ar-YE").format(637), { exact: true }).count(), 0);
    assert.ok(reads >= 2);

    // The same Store-wide projection powers the desktop report overview.
    foreign = false;
    await page.setViewportSize({ width: 1360, height: 900 });
    await page.goto("http://localhost:18102/insights?view=overview", { waitUntil: "domcontentloaded", timeout: 25000 });
    await page.getByRole("button", { name: "منتجات متاحة، عرض التفاصيل" }).waitFor({ state: "visible", timeout: 20000 });
    await page.getByText(new Intl.NumberFormat("ar-YE").format(637), { exact: true }).waitFor({ state: "visible", timeout: 14000 });
    await page.getByRole("button", { name: "نفاد المخزون، عرض التفاصيل" }).waitFor({ state: "visible" });
    await page.getByText(new Intl.NumberFormat("ar-YE").format(263), { exact: true }).first().waitFor({ state: "visible" });
    const desktop = await page.evaluate(() => ({
      rtl: document.documentElement.dir,
      sidebar: !!document.querySelector('[aria-label="التنقل الرئيسي للشريك"]'),
      overflow: document.documentElement.scrollWidth > window.innerWidth + 2,
    }));
    assert.equal(desktop.rtl, "rtl");
    assert.equal(desktop.sidebar, true);
    assert.equal(desktop.overflow, false);
    console.log("PARTNER_INVENTORY_REPORTS=PASS_MOBILE_DESKTOP_FULL_DSH_TOTALS_NAV_RTL_AND_FOREIGN_STORE_REJECTED");
  } finally {
    if (page) await page.close().catch(() => {});
    await browser.close();
  }
}
run().catch(error => { console.error("PARTNER_MOBILE_INVENTORY=FAIL " + String(error?.stack || error).slice(0, 1500)); process.exitCode = 1; });
