const assert = require("node:assert/strict");
const { chromium } = require("@playwright/test");

async function audit() {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
  try {
    const context = browser.contexts()[0];
    const page = context.pages().find(tab => tab.url().startsWith("http://localhost:18102/"));
    assert.ok(page, "PARTNER_EDGE_TAB_REQUIRED");
    const originalUrl = page.url();
    const errors = [];
    page.on("pageerror", error => errors.push(String(error?.message || error).slice(0, 120)));
    try {
      await page.goto("http://localhost:18102/more", { waitUntil: "domcontentloaded", timeout: 20000 });
      await page.locator('[aria-label="التنقل الرئيسي للشريك"]').waitFor({state:"attached",timeout:7500}).catch(()=>{});
      const snap = await page.evaluate(() => {
        const rect = el => {
          if(!el) return null;
          const r=el.getBoundingClientRect();
          return {x:Math.round(r.x),right:Math.round(r.right),width:Math.round(r.width),height:Math.round(r.height)};
        };
        const side=document.querySelector('[aria-label="التنقل الرئيسي للشريك"]');
        const words=(document.body.innerText||"");
        return {
          route:location.pathname, rtl:document.documentElement.dir,width:innerWidth,
          side:rect(side),sidebarColor:side?getComputedStyle(side).backgroundColor:null,
          labels:["مساحة الشريك","أحدث الطلبات","مساحة العمل اليومي","يحتاج انتباهك","تجهيز المتجر وتشغيله","الحساب والإعدادات"]
            .filter(label=>words.includes(label)),
          textLength:words.length, authUnavailable:/(يلزم تسجيل الدخول|انتهت صلاحية جلسة|تعذر التحقق من جلسة)/.test(words),
          agreementUnavailable:words.includes("تعذر التحقق من الاتفاقية"), loading:words.includes("جارٍ"),
          errors:/(SyntaxError|TransformError|Internal Server Error|Unable to resolve)/.test(words),
          overflow:document.documentElement.scrollWidth>innerWidth+1
        };
      });
      console.log("DASHBOARD "+JSON.stringify(snap));
      if (snap.route === "/" || snap.authUnavailable) { console.log("E2E=BLOCKED_AUTHENTICATION"); process.exitCode = 2; return; }
      assert.equal(snap.route,"/more");
      assert.equal(snap.rtl,"rtl");
      assert.ok(snap.side && Math.abs(snap.side.right - snap.width)<5,"SIDEBAR_NOT_RIGHT");
      assert.ok(snap.labels.includes("أحدث الطلبات"),"DASHBOARD_SUMMARY_MISSING");
      assert.ok(snap.labels.includes("يحتاج انتباهك"),"ATTENTION_PANEL_MISSING");
      assert.equal(snap.errors,false,"VISIBLE_RUNTIME_ERROR");
      assert.equal(snap.overflow,false,"HORIZONTAL_OVERFLOW");
      console.log("DASHBOARD_RENDER=PASS");
      await page.getByRole("button",{name:"فتح الحساب والإعدادات"}).click();
      await page.waitForTimeout(750);
      const account=await page.evaluate(()=>({pathname:location.pathname, hasAppearance:(document.body.innerText||"").includes("المظهر")}));
      console.log("ACCOUNT "+JSON.stringify(account));
      assert.equal(account.pathname,"/account","ACCOUNT_NAV_FAILED");
      assert.equal(account.hasAppearance,true,"ACCOUNT_SETTINGS_MISSING");
      console.log("DASHBOARD_ACCOUNT_NAV=PASS");
      if (errors.length) throw Error("PAGE_ERRORS "+JSON.stringify(errors));
      console.log("E2E=PASS");
    } finally {
      if (page.url() !== originalUrl) {
        await page.goto(originalUrl,{waitUntil:"domcontentloaded",timeout:18000}).catch(e=>console.log("RESTORE_BLOCKED "+String(e.message).slice(0,120)));
      }
    }
  } finally { await browser.close(); }
}
audit().catch(e=>{console.error("E2E=FAIL "+String(e?.message||e).slice(0,300));process.exitCode=1});
