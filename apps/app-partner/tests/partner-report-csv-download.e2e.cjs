const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const { chromium } = require("@playwright/test");

async function run() {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
  let page;
  try {
    const context = browser.contexts().find(c => c.pages().some(p => p.url().startsWith("http://localhost:18102")));
    assert.ok(context, "EXISTING_PARTNER_BROWSER_SESSION_REQUIRED");
    page = await context.newPage();
    await page.setViewportSize({ width: 1360, height: 860 });
    let requestCount = 0;
    let foreign = false;
    await page.route("**/dsh/partner/orders?*", async route => {
      requestCount++;
      const url = new URL(route.request().url());
      const storeId = (url.searchParams.get("storeIds") || "").split(",")[0];
      const cursor = url.searchParams.get("cursor");
      const order = n => ({
        id: "export-order-" + n,
        storeId: foreign ? "another-store" : storeId,
        state: "DELIVERED",
        totalAmountMinor: 100 + n,
        createdAt: "2026-10-31T10:00:00Z",
        fulfillmentMode: "CUSTOMER_PICKUP",
      });
      await route.fulfill({ status: 200, contentType: "application/json",
        body: JSON.stringify({ orders: cursor ? [order(2)] : [order(1)], nextCursor: cursor ? "" : "page-2", attention: null }) });
    });
    await page.goto("http://localhost:18102/insights?view=orders", { waitUntil: "domcontentloaded", timeout: 28000 });
    const button = page.getByRole("button", { name: "تنزيل CSV لجميع صفحات المتجر" });
    await button.waitFor({ state: "visible", timeout: 22000 });
    const downloadPromise = page.waitForEvent("download", { timeout: 20000 });
    await button.click();
    const download = await downloadPromise;
    assert.match(download.suggestedFilename(), /^bthwani-store-.*-orders-report\.csv$/);
    const data = await readFile(await download.path(), "utf8");
    assert.equal(data[0], "\uFEFF");
    assert.ok(data.includes("export-order-1"));
    assert.ok(data.includes("export-order-2"));
    assert.equal(data.split("\r\n").length, 3);
    assert.ok(requestCount >= 2);
    const oldCount = requestCount;
    let unexpected = 0;
    page.on("download", () => { unexpected++; });
    foreign = true;
    await button.click();
    await page.getByText("تعذر تجهيز ملف CSV كامل.", { exact: false }).waitFor({ state: "visible", timeout: 14000 });
    assert.ok(requestCount > oldCount);
    assert.equal(unexpected, 0, "foreign Store report must not download");
    console.log("PARTNER_REPORT_FULL_CSV=PASS_MOCKED_DSH_PAGINATION_AND_SCOPE_DENIAL");
    let catalogReads = 0;
    await page.route("**/dsh/stores/*/offers?*", async route => {
      catalogReads++;
      const uri = new URL(route.request().url());
      const pathParts = uri.pathname.split("/");
      const storeId = decodeURIComponent(pathParts[pathParts.indexOf("stores") + 1] || "");
      const cursor = uri.searchParams.get("cursor");
      const offer = n => ({
        storeId, offerId: "report-catalog-" + n,
        productId: "report-product-" + n, productName: "منتج تقرير " + n,
        variantTitle: "افتراضي", brand: "اختبار", priceMinor: 125,
        availability: true, publicationState: "published", measurementKind: "DISCRETE",
        baseUnit: "COUNT", media: [],
      });
      await route.fulfill({ status: 200, contentType: "application/json",
        body: JSON.stringify({ offers: cursor ? [offer(2)] : [offer(1)], nextCursor: cursor ? "" : "catalog-page-2" }) });
    });
    await page.getByRole("button", { name: "تقرير المنتجات" }).click();
    const catalogButton = page.getByRole("button", { name: "تنزيل CSV لجميع صفحات المتجر" });
    await catalogButton.waitFor({ state: "visible", timeout: 15000 });
    const catalogPromise = page.waitForEvent("download", { timeout: 18000 });
    await catalogButton.click();
    const catalogDownload = await catalogPromise;
    assert.ok(catalogDownload.suggestedFilename().startsWith("bthwani-store-"));
    assert.ok(catalogDownload.suggestedFilename().endsWith("-catalog-report.csv"));
    const catalogData = await readFile(await catalogDownload.path(), "utf8");
    assert.ok(catalogData.includes("منتج تقرير 1"));
    assert.ok(catalogData.includes("منتج تقرير 2"));
    assert.ok(catalogReads >= 2);
    console.log("PARTNER_CATALOG_REPORT_FULL_CSV=PASS_MOCKED_DSH_PAGINATION");
  } finally {
    if (page) await page.close().catch(()=>{});
    await browser.close();
  }
}
run().catch(error => {console.error("PARTNER_REPORT_FULL_CSV=FAIL " + String(error.stack||error).slice(0,2400));process.exitCode=1});
