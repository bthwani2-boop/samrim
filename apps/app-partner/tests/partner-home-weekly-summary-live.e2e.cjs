const assert = require("node:assert/strict");
const { chromium } = require("@playwright/test");

async function main() {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
  let page;
  try {
    const context = browser.contexts().find(c => c.pages().some(tab => tab.url().startsWith("http://localhost:18102"))) ?? browser.contexts()[0];
    assert.ok(context,"EXISTING_PARTNER_CONTEXT_REQUIRED");
    page = await context.newPage();
    await page.setViewportSize({width:1360,height:860});
    const summaryPromise = page.waitForResponse(response =>
      response.url().includes("/dsh/partner/stores/") &&
      response.url().includes("/orders/summary?period=7d"), {timeout:20000});
    await page.goto("http://localhost:18102/more",{waitUntil:"domcontentloaded",timeout:25000});
    const response = await summaryPromise;
    assert.equal(response.status(),200,"authorized partner weekly summary");
    const output = await response.json();
    const match = new URL(response.url()).pathname.split("/");
    const storeId = decodeURIComponent(match[match.indexOf("stores")+1] || "");
    assert.ok(storeId);
    assert.equal(output.summary?.storeId,storeId,"scope must be canonical");
    assert.equal(output.summary?.period,"7d");
    assert.ok(Number.isSafeInteger(output.summary.totalOrders));
    assert.ok(output.summary.totalOrders>=0);
    const summaryTile = page.getByRole("button",{name:"طلبات ٧ أيام، فتح التفاصيل"});
    await summaryTile.waitFor({state:"visible",timeout:14000});
    await summaryTile.getByText(new Intl.NumberFormat("ar-YE").format(output.summary.totalOrders),{exact:true})
      .waitFor({state:"visible",timeout:12000});
    console.log("PARTNER_HOME_WEEKLY_SUMMARY_LIVE=PASS_SCOPED_DSH_READBACK "+JSON.stringify({http:response.status(),period:output.summary.period}));
  } finally {
    if(page) await page.close().catch(()=>{});
    await browser.close();
  }
}
main().catch(e=>{console.error("PARTNER_HOME_WEEKLY_SUMMARY_LIVE=FAIL "+String(e.stack||e).slice(0,2000));process.exitCode=1});
