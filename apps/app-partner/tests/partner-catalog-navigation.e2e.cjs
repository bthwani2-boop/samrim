const assert = require("node:assert/strict");
const { chromium } = require("@playwright/test");

async function main() {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
  let page;
  try {
    const context = browser.contexts().find(ctx => ctx.pages().some(tab => tab.url().startsWith("http://localhost:18102")));
    assert.ok(context, "PARTNER_EDGE_SESSION_REQUIRED");
    page = await context.newPage();
    await page.setViewportSize({width:1360,height:860});
    // Cold deep links must preserve the requested filtered catalog for an
    // authorized Store actor; route guards must still reject denied actors.
    await page.goto("http://localhost:18102/products?filter=stockout",{waitUntil:"domcontentloaded",timeout:20000});
    await page.locator('[aria-label="التنقل الرئيسي للشريك"]').waitFor({state:"visible",timeout:12000});
    await page.waitForTimeout(1800);
    const direct = new URL(page.url());
    assert.equal(direct.pathname,"/products","AUTHORIZED_CATALOG_DEEP_LINK_REDIRECTED");
    assert.equal(direct.searchParams.get("filter"),"stockout","CATALOG_DEEP_LINK_FILTER_LOST");
    await page.goto("http://localhost:18102/more",{waitUntil:"domcontentloaded",timeout:20000});
    const sidebar=page.locator('[aria-label="التنقل الرئيسي للشريك"]');
    await sidebar.waitFor({state:"visible",timeout:12000});
    await sidebar.getByRole("button",{name:"الكتالوج"}).waitFor({state:"visible",timeout:14000});
    const catalog=sidebar.getByRole("button",{name:"الكتالوج"});
    assert.equal(await catalog.getAttribute("aria-expanded"),"true");
    for(const label of ["جميع المنتجات","نفاد المخزون","المنتجات غير المتاحة","الاستيراد والتصدير والأسعار"]) {
      assert.equal(await sidebar.getByRole("link",{name:label}).isVisible(),true, label+" missing");
    }
    await catalog.click();
    assert.equal(await catalog.getAttribute("aria-expanded"),"false");
    assert.equal(await sidebar.getByRole("link",{name:"نفاد المخزون"}).count(),0);
    await catalog.click();
    assert.equal(await catalog.getAttribute("aria-expanded"),"true");
    await sidebar.getByRole("link",{name:"نفاد المخزون"}).click();
    await page.waitForURL(url=>url.pathname==="/products"&&url.searchParams.get("filter")==="stockout",{timeout:12000});
    const filter=page.getByRole("button",{name:"تصفية حسب حالة المنتج"});
    await filter.waitFor({state:"visible",timeout:14000});
    await filter.click();
    const stockout=page.getByRole("button",{name:"نفاد المخزون"}).last();
    assert.equal(await stockout.getAttribute("aria-selected"),"true");
    await page.getByRole("button",{name:"إغلاق التصفية"}).click();
    await sidebar.getByRole("link",{name:"المنتجات غير المتاحة"}).click();
    await page.waitForURL(url=>url.pathname==="/products"&&url.searchParams.get("filter")==="unavailable",{timeout:12000});
    await filter.click();
    const unavailable=page.getByRole("button",{name:"غير المتاحة"}).last();
    assert.equal(await unavailable.getAttribute("aria-selected"),"true");
    await page.getByRole("button",{name:"إغلاق التصفية"}).click();
    const result=await page.evaluate(()=>{
      const side=document.querySelector('[aria-label="التنقل الرئيسي للشريك"]')?.getBoundingClientRect();
      return {route:location.pathname,filter:new URLSearchParams(location.search).get("filter"),
      rtl:document.documentElement.dir,sidebarAtRight:!!side&&Math.abs(side.right-innerWidth)<6,
      horizontalOverflow:document.documentElement.scrollWidth>innerWidth+2};
    });
    assert.equal(result.horizontalOverflow,false);
    assert.equal(result.sidebarAtRight,true);
    assert.equal(result.rtl,"rtl");
    for (const protectedPath of ["/orders","/wallet"]) {
      await page.goto("http://localhost:18102"+protectedPath,{waitUntil:"domcontentloaded",timeout:20000});
      await page.locator('[aria-label="التنقل الرئيسي للشريك"]').waitFor({state:"visible",timeout:12000});
      await page.waitForTimeout(900);
      assert.equal(new URL(page.url()).pathname,protectedPath,
        "AUTHORIZED_PROTECTED_TAB_DEEP_LINK_REDIRECTED_"+protectedPath);
    }
    console.log("PARTNER_OWNED_PROTECTED_LINKS=PASS");
    await page.setViewportSize({width:390,height:844});
    await page.goto("http://localhost:18102/products?filter=stockout",{waitUntil:"domcontentloaded",timeout:20000});
    await page.getByRole("button",{name:"تصفية حسب حالة المنتج"}).waitFor({state:"visible",timeout:14000});
    await page.waitForTimeout(750);
    const mobile = new URL(page.url());
    assert.equal(mobile.pathname,"/products","MOBILE_CATALOG_DEEP_LINK_REDIRECTED");
    assert.equal(mobile.searchParams.get("filter"),"stockout","MOBILE_CATALOG_FILTER_LOST");
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)<=2);
    console.log("CATALOG_DEEP_LINK_MOBILE=PASS");
    const guestContext = await browser.newContext({viewport:{width:390,height:844}});
    try {
      const guest = await guestContext.newPage();
      await guest.goto("http://localhost:18102/products?filter=stockout",{waitUntil:"domcontentloaded",timeout:20000});
      await guest.waitForURL(url=>url.pathname==="/"&&url.searchParams.has("returnTo"),{timeout:15000});
      assert.equal(await guest.getByLabel("إدارة عروض المتجر").count(),0,"GUEST_CATALOG_LEAKED");
      console.log("CATALOG_GUEST_DEEP_LINK=PASS_AUTH_REDIRECT");
    } finally {
      await guestContext.close();
    }
    console.log("CATALOG_NAV=PASS "+JSON.stringify(result));
  } finally {
    if(page)await page.close().catch(()=>{});
    await browser.close();
  }
}
main().catch(e=>{console.error("CATALOG_NAV=FAIL "+String(e?.message||e).slice(0,600));process.exitCode=1;});