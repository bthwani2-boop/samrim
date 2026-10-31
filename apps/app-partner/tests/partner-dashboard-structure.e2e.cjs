const assert = require("node:assert/strict");
const { chromium } = require("@playwright/test");

async function run() {
  const browser=await chromium.connectOverCDP("http://127.0.0.1:9223");
  let page;
  try {
    const context=browser.contexts().find(c=>c.pages().some(p=>p.url().startsWith("http://localhost:18102"))) ?? browser.contexts()[0];
    assert.ok(context, "LOCAL_EDGE_CONTEXT_REQUIRED");
    page=await context.newPage();
    await page.setViewportSize({width:1360,height:900});
    await page.goto("http://localhost:18102/more",{waitUntil:"domcontentloaded",timeout:20000});
    await page.waitForFunction(()=>{
      const t=document.body.innerText||"";
      return t.includes("تعذر التحقق")||t.includes("أحدث الطلبات")||t.includes("تعذر تحميل المتاجر")||location.pathname==="/";
    },null,{timeout:15000}).catch(()=>{});
    const view=await page.evaluate(()=>{
      const body=document.body.innerText||"";
      const rail=document.querySelector('[aria-label="التنقل الرئيسي للشريك"]');
      const r=rail?.getBoundingClientRect();
      const labels=["أحدث الطلبات","مساحة العمل اليومي","يحتاج انتباهك","تجهيز المتجر وتشغيله","الإشعارات","الفريق وكباتن المتجر","ملف المتجر والاتفاقيات","إدارة التشغيل"];
      return {route:location.pathname,rtl:document.documentElement.dir,
        blocked:body.includes("تعذر التحقق")||location.pathname==="/",
        sidebarAtRight:r?Math.abs(r.right-innerWidth)<=5:false,
        sidebarWidth:r?Math.round(r.width):null,
        labels:labels.filter(k=>body.includes(k)),
        textLength:body.length, hasDashboardGreeting:body.includes("مرحبًا،"),
        authRetry:body.includes("إعادة المحاولة"), hasStoreLoadFailure:body.includes("تعذر تحميل المتاجر"),
        noOverflow:document.documentElement.scrollWidth<=innerWidth+2,
        hasSyntaxError:/TransformError|SyntaxError|Unable to resolve/.test(body),
        countOfButtons:document.querySelectorAll('[role=button]').length};
    });
    await page.screenshot({path:"D:\\samrim-FILING\\BTHWANI-PARTNER-DASHBOARD-20261031-1360.png",fullPage:false});
    console.log("PARTNER_DASHBOARD "+JSON.stringify(view));
    if(view.blocked){console.log("PARTNER_DASHBOARD=BLOCKED_AUTH");process.exitCode=2;return;}
    assert.equal(view.route,"/more");
    assert.equal(view.rtl,"rtl");
    assert.equal(view.sidebarAtRight,true);
    assert.equal(view.noOverflow,true);
    assert.equal(view.hasSyntaxError,false);
    assert.ok(view.labels.includes("الإشعارات"));
    assert.ok(view.labels.includes("أحدث الطلبات"));
    console.log("PARTNER_DASHBOARD=PASS");
    await page.getByRole("link", {name:"الحساب والإعدادات"}).click();
    await page.waitForURL(url=>new URL(url).pathname==="/account",{timeout:12000});
    await page.waitForFunction(()=>document.body.innerText.includes("المظهر"),null,{timeout:9000});
    console.log("PARTNER_ACCOUNT_NAV=PASS");
    await page.setViewportSize({width:390,height:844});
    await page.goto("http://localhost:18102/more",{waitUntil:"domcontentloaded",timeout:20000});
    await page.waitForFunction(()=>document.body.innerText.includes("الحساب والتفضيلات"),null,{timeout:15000});
    const mobile=await page.evaluate(()=>({
      route:location.pathname,
      rtl:document.documentElement.dir,
      hasNotifications:document.body.innerText.includes("الإشعارات"),
      hasNativeMore:document.body.innerText.includes("الحساب والتفضيلات"),
      hasDesktopSidebar:!!document.querySelector('[aria-label="التنقل الرئيسي للشريك"]'),
      hasOverflow:document.documentElement.scrollWidth>innerWidth+2
    }));
    console.log("PARTNER_MOBILE "+JSON.stringify(mobile));
    assert.equal(mobile.route,"/more");
    assert.equal(mobile.rtl,"rtl");
    assert.equal(mobile.hasNotifications,true);
    assert.equal(mobile.hasNativeMore,true);
    assert.equal(mobile.hasDesktopSidebar,false);
    assert.equal(mobile.hasOverflow,false);
    console.log("PARTNER_MOBILE=PASS");
  } finally { if(page)await page.close().catch(()=>{}); await browser.close(); }
}
run().catch(err=>{console.error("PARTNER_DASHBOARD=FAIL "+String(err?.message||err).slice(0,350));process.exitCode=1;});