const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const { chromium } = require("@playwright/test");

async function run() {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
  let page;
  try {
    const context = browser.contexts().find(c => c.pages().some(p => p.url().startsWith("http://localhost:18102")));
    assert.ok(context, "EXISTING_PARTNER_WEB_SESSION_REQUIRED");
    page = await context.newPage();
    await page.setViewportSize({width:1360,height:860});
    let pagesRead = 0;
    await page.route("**/dsh/stores/*/offers?*", async route => {
      const url = new URL(route.request().url());
      const parts = url.pathname.split("/");
      const storeId = decodeURIComponent(parts[parts.indexOf("stores")+1] || "");
      const cursor = url.searchParams.get("cursor");
      pagesRead++;
      const offer = n => ({
        storeId,offerId:"export-test-"+n,productId:"mock-product-"+n,productName:"منتج تصدير "+n,
        variantTitle:"الافتراضي",brand:"اختبار",priceMinor:120,availability:true,
        publicationState:"published",measurementKind:"DISCRETE",baseUnit:"COUNT"
      });
      await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({
        offers:cursor==="page-2"?[offer(2)]:[offer(1)],nextCursor:cursor?"":"page-2"
      })});
    });
    await page.goto("http://localhost:18102/more",{waitUntil:"domcontentloaded",timeout:25000});
    const sidebar=page.locator('[aria-label="التنقل الرئيسي للشريك"]');
    await sidebar.getByRole("link",{name:"الاستيراد والتصدير والأسعار"}).click();
    const button = page.getByText("تصدير عروض المتجر",{exact:true}).first();
    try { await button.waitFor({state:"visible",timeout:14000}); } catch (error) { console.error("CATALOG_SCREEN="+JSON.stringify({url:page.url(),body:(await page.locator("body").innerText()).slice(0,1600)})); throw error; }
    const downloadPromise = page.waitForEvent("download",{timeout:14000}).catch(()=>null);
    await button.click();
    const download = await downloadPromise;
    if (!download) { console.error("EXPORT_DIAGNOSTIC="+JSON.stringify({pagesRead,body:(await page.locator("body").innerText()).slice(0,1100)})); throw new Error("EXPORT_DOWNLOAD_NOT_TRIGGERED"); }
    assert.match(download.suggestedFilename(),/^bthwani-store-.+-catalog\.csv$/);
    const file = await download.path();
    assert.ok(file);
    const bytes = await readFile(file,"utf8");
    console.log("CATALOG_DOWNLOAD_DIAGNOSTIC="+JSON.stringify({pagesRead,fileLength:bytes.length,hasMock1:bytes.includes("منتج تصدير 1"),hasMock2:bytes.includes("منتج تصدير 2"),lines:bytes.split("\r\n").length}));
    assert.equal(bytes[0],"\uFEFF");
    assert.ok(bytes.includes("منتج تصدير 1"));
    assert.ok(bytes.includes("منتج تصدير 2"));
    assert.ok(pagesRead>=2,"the second catalog cursor page was not fetched");
    await page.route("**/dsh/stores/*/offers?*", async route => {
      await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({
        offers:[{storeId:"foreign-store",offerId:"foreign-offer",productName:"other",variantTitle:"other",
          brand:"",priceMinor:1,availability:true,publicationState:"published",measurementKind:"DISCRETE",baseUnit:"COUNT"}],
        nextCursor:""
      })});
    });
    let unexpectedDownloads = 0;
    page.on("download", () => unexpectedDownloads++);
    await button.click();
    await page.getByText("تعذر تجهيز ملف الكتالوج.",{exact:false}).waitFor({state:"visible",timeout:10000});
    assert.equal(unexpectedDownloads,0,"foreign Store data must not be downloaded");
    console.log("PARTNER_CATALOG_CSV_FILE_DOWNLOAD=PASS_MOCKED_DSH_READ_AND_SCOPE_REJECTION");
  } finally {
    if(page) await page.close().catch(()=>{});
    await browser.close();
  }
}
run().catch(e=>{console.error("PARTNER_CATALOG_CSV_FILE_DOWNLOAD=FAIL "+String(e.stack||e));process.exitCode=1});
