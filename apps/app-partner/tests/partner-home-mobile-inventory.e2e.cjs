const assert = require("node:assert/strict");
const { chromium } = require("@playwright/test");

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
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ summary: {
        storeId: foreign ? "foreign-store" : storeId,
        totalOffers: 200, publishedOffers: 140, availableOffers: 132, unavailableOffers: 8, stockoutOffers: 7
      } }) });
    });
    await page.goto("http://localhost:18102/more", { waitUntil: "domcontentloaded", timeout: 25000 });
    await page.getByText("تنبيه مخزون المتجر", { exact: true }).waitFor({ state: "visible", timeout: 20000 });
    await page.getByRole("button", { name: "عرض المنتجات نافدة المخزون" }).waitFor({ state: "visible", timeout: 15000 });
    assert.ok((await page.getByText("منتج نافد من كامل مخزون المتجر", { exact: false }).allTextContents()).some(text => text.includes(new Intl.NumberFormat("ar-YE").format(7))), "full store stockout count missing");
    const display = await page.evaluate(() => ({
      rtl: document.documentElement.dir,
      hasDesktopSidebar: !!document.querySelector('[aria-label="التنقل الرئيسي للشريك"]'),
      overflow: document.documentElement.scrollWidth > window.innerWidth + 2
    }));
    assert.equal(display.rtl, "rtl");
    assert.equal(display.hasDesktopSidebar, false);
    assert.equal(display.overflow, false);
    assert.ok(reads > 0);
    await page.getByRole("button", { name: "عرض المنتجات نافدة المخزون" }).click();
    await page.waitForURL(u => new URL(u).pathname === "/products", { timeout: 15000 });
    assert.equal(new URL(page.url()).searchParams.get("filter"), "stockout");
    foreign = true;
    await page.goto("http://localhost:18102/more", { waitUntil: "domcontentloaded", timeout: 25000 });
    await page.getByText("تنبيه مخزون المتجر", { exact: true }).waitFor({ state: "visible", timeout: 15000 });
    await page.getByText("تعذر قراءة إجمالي مخزون المتجر. أعد المحاولة.", { exact: false }).waitFor({ state: "visible", timeout: 18000 });
    assert.equal(await page.getByText("منتج نافد من كامل مخزون المتجر", { exact: false }).count(), 0);
    assert.ok(reads >= 2);
    console.log("PARTNER_MOBILE_INVENTORY=PASS_FULL_STOCKOUT_NAV_RTL_AND_FOREIGN_STORE_FAIL_CLOSED");
  } finally {
    if (page) await page.close().catch(() => {});
    await browser.close();
  }
}
run().catch(error => { console.error("PARTNER_MOBILE_INVENTORY=FAIL " + String(error?.stack || error).slice(0, 1500)); process.exitCode = 1; });
