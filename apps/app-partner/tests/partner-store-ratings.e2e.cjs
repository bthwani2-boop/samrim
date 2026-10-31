const assert=require("node:assert/strict");
const {chromium}=require("@playwright/test");

async function main() {
  const browser=await chromium.connectOverCDP("http://127.0.0.1:9223");
  let page;
  try {
    const context=browser.contexts().find(c=>c.pages().some(p=>p.url().startsWith("http://localhost:18102"))) ?? browser.contexts()[0];
    assert.ok(context,"PARTNER_BROWSER_CONTEXT_REQUIRED");
    page=await context.newPage();
    await page.setViewportSize({width:1360,height:850});
    let requestStore="",foreign=false;
    await page.route("**/dsh/partner/stores/*/ratings?*",async route=>{
      const url=new URL(route.request().url());
      requestStore=decodeURIComponent(url.pathname.split("/").at(-2));
      const ratings=foreign?[{orderId:"foreign-order",storeId:"another-store",rating:1,review:"لا يجوز عرضه",createdAt:"2026-10-31T10:00:00Z"}]:
        [{orderId:"own-order",storeId:requestStore,rating:4,review:"تقييم طلب حقيقي تجريبي",createdAt:"2026-10-31T10:00:00Z",clientActorId:"client-private"}];
      await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({ratings,nextCursor:foreign?"":"next",summary:{totalRatings:1,averageRating:4,oneStar:0,twoStars:0,threeStars:0,fourStars:1,fiveStars:0}})});
    });
    await page.goto("http://localhost:18102/insights?view=ratings",{waitUntil:"domcontentloaded",timeout:28000});
    await page.getByText("تقييم طلب حقيقي تجريبي",{exact:true}).waitFor({state:"visible",timeout:18000});
    assert.ok(requestStore.length>0);
    await page.getByText("4.0 من 5",{exact:true}).waitFor({state:"visible",timeout:10000});
    assert.ok(await page.getByText("تقييمًا من طلبات مكتملة",{exact:false}).isVisible());
    assert.ok(!(await page.locator("body").innerText()).includes("client-private"));
    foreign=true;
    await page.getByRole("button",{name:"صفحة التقييمات التالية"}).click();
    await page.getByText("تعذرت قراءة تقييمات الطلبات.",{exact:false}).waitFor({state:"visible",timeout:12000});
    assert.equal(await page.getByText("لا يجوز عرضه",{exact:true}).count(),0);
    foreign=false;
    await page.getByRole("button",{name:"إعادة قراءة التقييمات"}).click();
    await page.getByText("تقييم طلب حقيقي تجريبي",{exact:true}).waitFor({state:"visible",timeout:12000});
    await page.setViewportSize({width:390,height:844});
    await page.waitForTimeout(450);
    assert.ok(await page.getByText("تقييمات الطلبات المكتملة",{exact:true}).isVisible());
    assert.ok((await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth))<=2);
    console.log("PARTNER_STORE_ORDER_RATINGS=PASS_MOCKED_READ_SCOPE_RETRY_MOBILE");
  }finally{if(page)await page.close().catch(()=>{});await browser.close();}
}
main().catch(e=>{console.error("PARTNER_STORE_ORDER_RATINGS=FAIL "+String(e.stack||e).slice(0,1750));process.exitCode=1});
