const assert = require("node:assert/strict");
const { chromium } = require("@playwright/test");

async function run() {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
  const context = browser.contexts().find(c => c.pages().some(p => p.url().startsWith("http://localhost:18102")));
  assert.ok(context, "PARTNER_SESSION_CONTEXT_REQUIRED");
  const page = await context.newPage();
  const requested = [];
  try {
    await page.route("**/dsh/partner/stores?*", route => route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ stores: [{
        id:"summary-owned",name:"متجر اختبار التقرير",serviceCityId:"sanaa",primaryVerticalId:"groceries",
        publicationState:"published",fulfillmentModes:["BTHWANI_CAPTAIN"],owned:true,permissions:[]
      }], nextCursor:"" })
    }));
    await page.route("**/dsh/partner/stores/*/orders/summary?*", async route => {
      const url = new URL(route.request().url());
      const path = url.pathname.match(/\/dsh\/partner\/stores\/([^/]+)\/orders\/summary/);
      assert.ok(path);
      const storeId = decodeURIComponent(path[1]);
      const period = url.searchParams.get("period");
      requested.push({ storeId, period });
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        summary: { storeId, period, measuredAt: "2026-10-31T00:00:00Z", totalOrders: 27,
          deliveredOrders: 10, pickedUpOrders: 3, cancelledOrders: 2, rejectedOrders: 1,
          deliveryFailedOrders: 4, completedOrderValueMinor: 1234567 },
      }) });
    });
    for (const width of [1360, 390]) {
      await page.setViewportSize({width,height:850});
      await page.goto("http://localhost:18102/insights?view=orders", { waitUntil: "domcontentloaded", timeout: 30000 });
      try {
        await page.getByText("إجماليات الطلبات من الخادم", {exact:true}).waitFor({ state:"visible", timeout:20000 });
      } catch (error) {
        throw new Error("SUMMARY_SECTION_NOT_VISIBLE " + (await page.locator("body").innerText()).slice(0,1200), { cause:error });
      }
      try { await page.getByText("٢٧", {exact:true}).waitFor({timeout: 14000}); }
      catch (cause) { throw new Error("MISSING_SUMMARY requested="+JSON.stringify(requested)+" body="+(await page.locator("body").innerText()).slice(0,1300), {cause}); }
      assert.ok((await page.getByText("١٣", {exact:true}).count()) > 0);
      assert.ok((await page.getByText("السجلات والتصدير تخص الصفحة المعروضة فقط", {exact:false}).count()) > 0);
      await page.getByRole("button", {name:"آخر 7 أيام"}).click();
      await page.waitForTimeout(350);
      await page.getByText("٢٧", {exact:true}).waitFor({timeout: 18000});
      assert.ok((await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth))<=2);
    }
    // A mismatched Store reply is untrusted and must not leave stale totals or a permanent spinner.
    const mismatch = async route => route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ summary: {
        storeId: "another-store", period: "30d", measuredAt: "2026-10-31T00:00:00Z",
        totalOrders: 999, deliveredOrders: 999, pickedUpOrders: 0, cancelledOrders: 0,
        rejectedOrders: 0, deliveryFailedOrders: 0, completedOrderValueMinor: 999999999,
      } }),
    });
    const summaryPattern = "**/dsh/partner/stores/*/orders/summary?*";
    await page.route(summaryPattern, mismatch);
    await page.goto("http://localhost:18102/insights?view=orders", {waitUntil:"domcontentloaded",timeout:30000});
    await page.getByText("تعذر قراءة إجماليات المتجر", {exact:false}).first().waitFor({timeout:16000});
    assert.equal(await page.getByText("٩٩٩", {exact:true}).count(), 0, "foreign Store figures must be hidden");
    await page.unroute(summaryPattern, mismatch);
    await page.getByRole("button", {name:"إعادة قراءة إجماليات الطلبات"}).click();
    await page.getByText("٢٧", {exact:true}).waitFor({timeout:16000});
    assert.equal(await page.getByText("تعذر قراءة إجماليات المتجر", {exact:false}).count(), 0);
    assert.ok(requested.some(r=>r.period==="30d"));
    assert.ok(requested.some(r=>r.period==="7d"));
    assert.ok(requested.every(r=>r.storeId));
    console.log("PARTNER_ORDER_SUMMARY_UI=PASS_MOCKED_READ_ONLY");
  } finally {
    await page.close().catch(()=>{});
    await browser.close();
  }
}
run().catch(e=>{console.error("PARTNER_ORDER_SUMMARY_UI=FAIL "+String(e.stack||e));process.exitCode=1});
