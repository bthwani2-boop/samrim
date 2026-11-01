const assert = require("node:assert/strict");
const { chromium } = require("@playwright/test");

async function inspect(page, width) {
  await page.setViewportSize({width,height:850});
  await page.goto("http://localhost:18102/notifications", {waitUntil:"domcontentloaded",timeout:20000});
  await page.waitForFunction(() => {
    const t=document.body.innerText||"";
    return t.includes("تعذر التحقق") || t.includes("الإشعارات") || location.pathname === "/";
  }, {timeout:11000}).catch(() => {});
  return page.evaluate(() => {
    const text=document.body.innerText || "";
    const sidebar=document.querySelector('[aria-label="التنقل الرئيسي للشريك"]');
    const r=sidebar?.getBoundingClientRect();
    return {
      path:location.pathname, direction:document.documentElement.dir,
      width:innerWidth, blocked:text.includes("تعذر التحقق") || location.pathname === "/",
      renderedInbox:text.includes("الإشعارات"),
      hasSidebar:!!sidebar, sidebarRight:r?Math.round(r.right):null,
      overflow:document.documentElement.scrollWidth>innerWidth+2,
      visibleError:/(TransformError|SyntaxError|Unable to resolve)/.test(text)
    };
  });
}

async function run() {
  const browser=await chromium.connectOverCDP("http://127.0.0.1:9223");
  let page;
  try {
    const context=browser.contexts().find(c=>c.pages().some(p=>p.url().startsWith("http://localhost:18102"))) ?? browser.contexts()[0];
    assert.ok(context,"LOCAL_EDGE_CONTEXT_REQUIRED");
    page=await context.newPage();
    const desktop=await inspect(page,1360);
    console.log("NOTIFICATIONS_DESKTOP "+JSON.stringify(desktop));
    if(desktop.blocked){console.log("NOTIFICATIONS_E2E=BLOCKED_AUTH");process.exitCode=2;return;}
    assert.equal(desktop.direction,"rtl");
    assert.equal(desktop.path,"/notifications");
    assert.equal(desktop.renderedInbox,true);
    assert.equal(desktop.hasSidebar,true);
    assert.ok(Math.abs(desktop.sidebarRight-desktop.width)<=5);
    assert.equal(desktop.overflow,false);
    assert.equal(desktop.visibleError,false);
    const mobile=await inspect(page,390);
    console.log("NOTIFICATIONS_MOBILE "+JSON.stringify(mobile));
    assert.equal(mobile.renderedInbox,true);
    assert.equal(mobile.hasSidebar,false);
    assert.equal(mobile.overflow,false);
    console.log("NOTIFICATIONS_E2E=PASS");
  } finally {
    if(page)await page.close().catch(()=>{});
    await browser.close();
  }
}
run().catch(error=>{console.error("NOTIFICATIONS_E2E=FAIL "+String(error?.message||error).slice(0,400));process.exitCode=1;});