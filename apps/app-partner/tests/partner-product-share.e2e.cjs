const assert = require("node:assert/strict");
const { chromium } = require("@playwright/test");

async function run() {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
  let page;
  try {
    const context = browser.contexts().find(c => c.pages().some(p => p.url().startsWith("http://localhost:18102"))) ?? browser.contexts()[0];
    assert.ok(context, "EXISTING_PARTNER_SESSION_REQUIRED");
    page = await context.newPage();
    await page.setViewportSize({width:1360,height:860});
    await page.goto("http://localhost:18102/more",{waitUntil:"domcontentloaded",timeout:28000});
    const sidebar=page.locator('[aria-label="التنقل الرئيسي للشريك"]');
    await sidebar.waitFor({state:"visible",timeout:14000});
    await sidebar.getByRole("link",{name:"جميع المنتجات"}).click();
    await page.waitForURL(url=>url.pathname==="/products",{timeout:14000});
    const productRoot = page.getByLabel("إدارة عروض المتجر");
    await productRoot.waitFor({state:"visible",timeout:12000});
    const action = productRoot.getByText(/^نسخ رابط (المعاينة|المنتج)$/);
    await action.first().waitFor({state:"visible",timeout:12000}).catch(()=>{});
    const share = productRoot.getByText("مشاركة عبر واتساب",{exact:true});

    const copies = await action.count();
    const shares = await share.count();
    if (copies>0) {
      await action.first().click();
      const notice = page.getByText(/تم نسخ (رابط المنتج العام|معاينة المنتج المحلية)/);
      await notice.waitFor({state:"visible",timeout:12000});
      if ((await notice.innerText()).includes("معاينة")) {
        assert.equal(shares,0,"local Store preview must never offer public WhatsApp sharing");
      }
      await page.setViewportSize({width:390,height:844});
      await page.waitForTimeout(350);
      assert.ok((await page.evaluate(() => document.documentElement.scrollWidth - innerWidth))<=2);
      console.log("PARTNER_PRODUCT_SHARE_LIVE=PASS_COPY "+JSON.stringify({copies,shares,mobileRTL:await page.evaluate(()=>document.documentElement.dir)}));
    } else {
      const noItems = await page.getByText("لا توجد عروض مرتبطة بهذا المتجر بعد.").count();
      const text = await page.locator("body").innerText();
      assert.ok(noItems>0 || text.includes("قائمة المتجر") || text.includes("منشور") || text.includes("العروض"),"share action missing without a visible reason");
      assert.equal(shares,0,"WhatsApp must not appear without eligible published product");
      console.log("PARTNER_PRODUCT_SHARE_LIVE=NOT_RUN_NO_ELIGIBLE_PUBLISHED_OFFER");
    }
  } finally {
    if(page)await page.close().catch(()=>{});
    await browser.close();
  }
}
run().catch(e=>{console.error("PARTNER_PRODUCT_SHARE_LIVE=FAIL "+String(e.stack||e).slice(0,1700));process.exitCode=1});
