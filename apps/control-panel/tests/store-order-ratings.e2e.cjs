const assert=require("node:assert/strict");
const {chromium}=require("@playwright/test");

async function main() {
  const browser=await chromium.connectOverCDP("http://127.0.0.1:9223");
  let page;
  try {
    const origin="http://localhost:13000";
    const context=browser.contexts().find(c=>c.pages().some(p=>p.url().startsWith(origin))) ?? browser.contexts()[0];
    assert.ok(context,"OPERATOR_BROWSER_CONTEXT_REQUIRED");
    page=await context.newPage();
    await page.setViewportSize({width:1360,height:850});
    let requestStore="";
    let foreign=false;
    await page.route("**/api/stores/*/ratings?*",async route=>{
      const url=new URL(route.request().url());
      requestStore=decodeURIComponent(url.pathname.split("/").at(-2));
      const body=foreign?{ratings:[{orderId:"foreign-order",storeId:"another-store",rating:1,review:"محتوى غير مصرح",createdAt:"2026-10-31T10:00:00Z"}]}:
        {ratings:[{orderId:"rating-test-1",storeId:requestStore,rating:5,review:"تقييم خدمة ممتازة",createdAt:"2026-10-31T10:00:00Z",clientActorId:"never-show-private"}],nextCursor:"next"};
      await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(body)});
    });
    await page.goto(origin+"/partners?tab=directory",{waitUntil:"domcontentloaded",timeout:28000});
    const row=page.locator('tr[data-kind="store"]').first();
    await row.waitFor({state:"visible",timeout:20000});
    await row.locator("td").first().click();
    await page.getByRole("tab",{name:"العملاء والجودة"}).click();
    await page.getByText("تقييم خدمة ممتازة",{exact:true}).waitFor({state:"visible",timeout:12000});
    const text=await page.locator("body").innerText();
    assert.ok(!text.includes("never-show-private"));
    assert.ok(requestStore.length>0);
    foreign=true;
    await page.getByRole("button",{name:"التالي"}).click();
    await page.getByText("تعذرت قراءة تقييمات الطلبات.",{exact:false}).waitFor({state:"visible",timeout:12000});
    assert.equal(await page.getByText("محتوى غير مصرح",{exact:true}).count(),0);
    console.log("OPERATOR_STORE_ORDER_RATINGS=PASS_MOCKED_READ_SCOPE_AND_RECOVERY");
  } finally {if(page)await page.close().catch(()=>{});await browser.close();}
}
main().catch(e=>{console.error("OPERATOR_STORE_ORDER_RATINGS=FAIL "+String(e.stack||e).slice(0,1800));process.exitCode=1});
