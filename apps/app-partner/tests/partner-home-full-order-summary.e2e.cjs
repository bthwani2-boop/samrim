const assert = require("node:assert/strict");
const { chromium } = require("@playwright/test");

async function main() {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
  let page;
  try {
    const context = browser.contexts().find(c => c.pages().some(tab => tab.url().startsWith("http://localhost:18102"))) ?? browser.contexts()[0];
    assert.ok(context, "EXISTING_AUTHORIZED_PARTNER_CONTEXT_REQUIRED");
    page = await context.newPage();
    await page.setViewportSize({width:1360,height:860});
    let reads = 0;
    let foreign = false;
    await page.route("**/dsh/partner/stores/*/orders/summary?period=7d", async route => {
      reads++;
      const uri = new URL(route.request().url());
      const parts = uri.pathname.split("/");
      const storeId = decodeURIComponent(parts[parts.indexOf("stores") + 1] || "");
      await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({summary:{
        storeId:foreign ? "foreign-store" : storeId,
        period:"7d",totalOrders:1234,measuredAt:"2026-10-31T14:00:00Z"
      }})});
    });
    await page.goto("http://localhost:18102/more",{waitUntil:"domcontentloaded",timeout:25000});
    await page.getByText("طلبات ٧ أيام",{exact:true}).waitFor({state:"visible",timeout:16000});
    await page.getByText(new Intl.NumberFormat("ar-YE").format(1234),{exact:true}).waitFor({state:"visible",timeout:16000});
    assert.ok(reads>0,"summary not fetched from DSH");
    assert.ok(await page.getByText("جميع طلبات هذا المتجر المنشأة خلال الفترة، من DSH",{exact:true}).isVisible());
    foreign = true;
    await page.reload({waitUntil:"domcontentloaded",timeout:25000});
    await page.getByText("تعذر قراءة ملخص المتجر الكامل",{exact:true}).waitFor({state:"visible",timeout:17000});
    assert.equal(await page.getByText(new Intl.NumberFormat("ar-YE").format(1234),{exact:true}).count(),0);
    assert.ok(reads>1);
    console.log("PARTNER_HOME_FULL_WEEKLY_SUMMARY=PASS_SCOPED_SERVER_TOTAL_WITH_FOREIGN_STORE_FAIL_CLOSED");
  } finally {
    if(page) await page.close().catch(()=>{});
    await browser.close();
  }
}
main().catch(error=>{console.error("PARTNER_HOME_FULL_WEEKLY_SUMMARY=FAIL "+String(error.stack||error).slice(0,1500));process.exitCode=1});
