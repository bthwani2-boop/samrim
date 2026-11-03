const assert = require("node:assert/strict");
const { chromium } = require("@playwright/test");

// Browser-only contract check. Simulated DSH readbacks prove UI scoping;
// they are not a substitute for the real DSH service tests.
async function main() {
  const browser = await chromium.connectOverCDP(process.env.BTHWANI_BROWSER_CDP ?? "http://127.0.0.1:9222");
  let page;
  try {
    const context = browser.contexts().find(c => c.pages().some(tab => tab.url().startsWith("http://localhost:18102"))) ?? browser.contexts()[0];
    assert.ok(context, "EXISTING_AUTHORIZED_PARTNER_CONTEXT_REQUIRED");
    page = await context.newPage();
    await page.setViewportSize({ width: 1360, height: 860 });
    let requests = 0;
    let foreign = false;
    await page.route("**/dsh/stores/*/inventory-summary", async route => {
      requests++;
      const url = new URL(route.request().url());
      const segments = url.pathname.split("/");
      const storeId = decodeURIComponent(segments[segments.indexOf("stores") + 1] || "");
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        summary: { storeId: foreign ? "another-store" : storeId,
          totalOffers: 1000, publishedOffers: 900, availableOffers: 637,
          unavailableOffers: 263, stockoutOffers: 57 },
      }) });
    });
    await page.goto("http://localhost:18102/more", { waitUntil: "domcontentloaded", timeout: 25000 });
    await page.getByText("المنتجات المتاحة", { exact: true }).waitFor({ state: "visible", timeout: 18000 });
    await page.getByText("من جميع عروض المتجر المنشورة، DSH", { exact: true }).waitFor({ state: "visible", timeout: 18000 });
    await page.getByText(new Intl.NumberFormat("ar-YE").format(637), { exact: true }).waitFor({ state: "visible", timeout: 15000 });
    await page.getByText("نفاد المخزون", { exact: true }).first().waitFor({ state: "visible" });
    await page.getByText(new Intl.NumberFormat("ar-YE").format(57) + " منتج من عروض المتجر المنشورة", { exact: true }).waitFor({ state: "visible" });
    assert.ok(requests > 0, "canonical full inventory summary not fetched");
    foreign = true;
    await page.reload({ waitUntil: "domcontentloaded", timeout: 25000 });
    await page.getByText("تعذر قراءة إجمالي المخزون", { exact: true }).first().waitFor({ state: "visible", timeout: 17000 });
    assert.equal(await page.getByText(new Intl.NumberFormat("ar-YE").format(637), { exact: true }).count(), 0);
    assert.ok(requests > 1, "expected a fresh DSH read after navigation");
    console.log("PARTNER_HOME_INVENTORY=PASS_FULL_DSH_TOTAL_AND_FOREIGN_STORE_REJECTED");
  } finally {
    if (page) await page.close().catch(() => {});
    await browser.close();
  }
}
main().catch(err => { console.error("PARTNER_HOME_INVENTORY=FAIL " + String(err?.stack || err).slice(0, 1800)); process.exitCode = 1; });
