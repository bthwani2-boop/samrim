const assert=require("node:assert/strict");
const {readFile}=require("node:fs/promises");
const {chromium}=require("@playwright/test");

async function run(){
  const origin="http://localhost:13000";
  const browser=await chromium.connectOverCDP("http://127.0.0.1:9223");
  let page;
  try{
    const context=browser.contexts().find(c=>c.pages().some(p=>p.url().startsWith(origin)));
    assert.ok(context,"EXISTING_OPERATOR_SESSION_REQUIRED");
    page=await context.newPage();
    await page.setViewportSize({width:1360,height:850});
    let pagesRead=0;
    await page.route("**/api/stores/*/offers?*",async route=>{
      const url=new URL(route.request().url());
      const parts=url.pathname.split("/");
      const storeId=decodeURIComponent(parts[parts.indexOf("stores")+1]||"");
      const cursor=url.searchParams.get("cursor");
      pagesRead++;
      const offer=n=>({storeId,offerId:"operator-test-"+n,productId:"mock-"+n,
        productName:"منتج تصدير "+n,variantTitle:"افتراضي",brand:"اختبار",
        priceMinor:300,availability:true,publicationState:"published",measurementKind:"DISCRETE",baseUnit:"COUNT"});
      await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({
        offers:cursor?[offer(2)]:[offer(1)],nextCursor:cursor?"":"next"
      })});
    });
    await page.goto(origin+"/partners?tab=directory",{waitUntil:"domcontentloaded",timeout:25000});
    const row=page.locator('tr[data-kind="store"]').first();
    await row.waitFor({state:"visible",timeout:20000});
    await row.locator("td").first().click();
    await page.getByRole("tab",{name:"المنتجات والعروض"}).click();
    const button=page.getByRole("button",{name:"تصدير CSV كامل"});
    await button.waitFor({state:"visible",timeout:20000});
    const promise=page.waitForEvent("download",{timeout:16000});
    await button.click();
    const download=await promise;
    assert.match(download.suggestedFilename(),/^bthwani-store-.+-catalog\.csv$/);
    const path=await download.path();
    assert.ok(path);
    const csv=await readFile(path,"utf8");
    assert.equal(csv[0],"\uFEFF");
    assert.ok(csv.includes("منتج تصدير 1"));
    assert.ok(csv.includes("منتج تصدير 2"));
    assert.ok(pagesRead>=2);
    console.log("OPERATOR_STORE_CATALOG_CSV=PASS_MOCKED_DSH_READ");
  }finally{if(page)await page.close().catch(()=>{});await browser.close();}
}
run().catch(e=>{console.error("OPERATOR_STORE_CATALOG_CSV=FAIL "+String(e.stack||e).slice(0,1500));process.exitCode=1});
