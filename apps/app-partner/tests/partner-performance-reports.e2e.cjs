const assert = require("node:assert/strict");
const { chromium } = require("@playwright/test");
async function run() {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
  const context = browser.contexts().find(c => c.pages().some(p => p.url().startsWith("http://localhost:18102"))) ?? browser.contexts()[0];
  assert.ok(context, "PARTNER_WEB_BROWSER_CONTEXT_REQUIRED");
  const page = await context.newPage();
  try {
    await page.setViewportSize({ width: 1360, height: 900 });
    await page.goto("http://localhost:18102/insights?view=overview", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.getByText("الأداء والتقارير", { exact: true }).waitFor({ timeout: 20000 });
    const button = page.getByRole("button", { name: "الأداء والتقارير" });
    assert.equal(await button.getAttribute("aria-expanded"), "true");
    assert.equal(await page.getByRole("link", { name: "نظرة عامة" }).count(), 1);
    console.log("PERFORMANCE_GROUP=PASS");
    await button.click();
    assert.equal(await button.getAttribute("aria-expanded"), "false");
    assert.equal(await page.getByRole("link", { name: "نظرة عامة" }).count(), 0);
    await button.click();
    assert.equal(await button.getAttribute("aria-expanded"), "true");
    console.log("PERFORMANCE_GROUP_COLLAPSE=PASS");
    const orders = page.getByRole("link", { name: "تقرير الطلبات" });
    const catalog = page.getByRole("link", { name: "تقرير المنتجات والمخزون" });
    if (await orders.count()) {
      await orders.click();
      await page.waitForURL(u => u.pathname === "/insights" && u.searchParams.get("view") === "orders", { timeout: 15000 });
      await page.getByText("السجلات والتصدير تخص الصفحة المعروضة فقط", { exact: false }).waitFor({ timeout: 15000 });
      await page.waitForTimeout(800);
      const text = await page.locator("body").innerText();
      assert.ok(/جارٍ قراءة التقرير|لا توجد سجلات|السجلات|تعذر قراءة التقرير/.test(text));
      assert.ok(!/TransformError|Unable to resolve/.test(text));
      console.log("ORDERS_REPORT=PASS " + (text.includes("تعذر قراءة التقرير") ? "DATA_READ_ERROR" : "READ_PRESENT"));
    } else console.log("ORDERS_REPORT=NOT_AUTHORIZED");
    if (await catalog.count()) {
      await catalog.click();
      await page.waitForURL(u => u.pathname === "/insights" && u.searchParams.get("view") === "catalog", { timeout: 15000 });
      await page.getByText("السجلات والتصدير تخص الصفحة المعروضة فقط", { exact: false }).waitFor({ timeout: 15000 });
      await page.waitForTimeout(800);
      const text = await page.locator("body").innerText();
      assert.ok(/جارٍ قراءة التقرير|لا توجد سجلات|السجلات|تعذر قراءة التقرير/.test(text));
      assert.ok(!/TransformError|Unable to resolve/.test(text));
      console.log("CATALOG_REPORT=PASS " + (text.includes("تعذر قراءة التقرير") ? "DATA_READ_ERROR" : "READ_PRESENT"));
      await page.screenshot({ path: "D:\\samrim\\apps\\app-partner\\.expo\\performance-catalog-desktop.png", animations: "disabled" });
    } else console.log("CATALOG_REPORT=NOT_AUTHORIZED");
    const financial = page.getByRole("link", { name: "الكشف المالي والتسويات" });
    if (await financial.count()) {
      await financial.click();
      await page.waitForURL(u => u.pathname === "/wallet", { timeout: 15000 });
      console.log("FINANCE_LINK=PASS");
    } else console.log("FINANCE_LINK=NOT_AUTHORIZED");
    if (await page.getByRole("link", { name: "تقرير الطلبات" }).count()) {
      await page.route("**/dsh/partner/orders*", route => route.abort("failed"));
      await page.goto("http://localhost:18102/insights?view=orders", { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.getByText("تعذر قراءة التقرير", { exact: false }).first().waitFor({ timeout: 15000 });
      await page.unroute("**/dsh/partner/orders*");
      await page.getByText("تعذر قراءة التقرير", { exact: false }).first().click();
      await page.getByText("السجلات (", { exact: false }).first().waitFor({ timeout: 15000 });
      console.log("REPORT_RETRY_AFTER_NETWORK_FAILURE=PASS");
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("http://localhost:18102/insights?view=overview", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.getByText("نظرة عامة", { exact: true }).first().waitFor({ timeout: 15000 });
    assert.equal(await page.locator('[aria-label="التنقل الرئيسي للشريك"]').count(), 0);
    const tabs = await page.locator('[aria-label="أقسام الأداء والتقارير"]').count();
    assert.equal(tabs, 1);
    assert.ok((await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 2);
    console.log("MOBILE_REPORT_TABS=PASS");
    const mobileOrders = page.getByRole("button", { name: "تقرير الطلبات" });
    if (await mobileOrders.count()) {
      await mobileOrders.click();
      await page.waitForURL(u => u.pathname === "/insights" && u.searchParams.get("view") === "orders", { timeout: 15000 });
      await page.getByText("السجلات والتصدير تخص الصفحة المعروضة فقط", { exact: false }).first().waitFor({ timeout: 15000 });
      assert.ok((await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 2);
      console.log("MOBILE_ORDER_REPORT=PASS");
    }
  } finally { await page.close().catch(() => {}); await browser.close(); }
}
run().catch(e => { console.error("PERFORMANCE_E2E=FAIL " + (e.stack || e.message)); process.exitCode = 1; });
