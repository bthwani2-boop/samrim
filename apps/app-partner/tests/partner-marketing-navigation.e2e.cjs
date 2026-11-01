const assert = require("node:assert/strict");
const { chromium } = require("@playwright/test");

async function run() {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
  let page;
  try {
    const context = browser.contexts().find(c => c.pages().some(p => p.url().startsWith("http://localhost:18102")));
    assert.ok(context, "EXISTING_PARTNER_EDGE_SESSION_REQUIRED");
    page = await context.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    page.on("console", message => {
      if (message.type() === "error" && /(Warning|Encountered two|TypeError|ReferenceError|Error:)/i.test(message.text())) errors.push(message.text().slice(0, 220));
    });

    await page.setViewportSize({ width: 1360, height: 850 });
    await page.goto("http://localhost:18102/store?section=promotions&view=overview",
      { waitUntil: "domcontentloaded", timeout: 22000 });
    await page.getByText("مساحة الشريك / التسويق", { exact: true }).waitFor({ state: "visible", timeout: 18000 });
    for (const label of ["نظرة تسويقية", "العروض والقسائم", "حملات المنصة", "مقاطع المتجر"]) {
      assert.equal(await page.getByRole("button", { name: label, exact: true }).count(), 1, label);
    }
    for (const label of ["عروض نشطة", "مجدولة", "مسودات", "موقوفة", "استخدامات مسجلة", "حملات تتطلب قرارًا"]) {
      await page.getByText(label, { exact: true }).waitFor({ state: "visible", timeout: 12000 });
    }
    const overview = await page.evaluate(() => ({
      rtl: document.documentElement.dir,
      width: innerWidth,
      overflow: document.documentElement.scrollWidth > innerWidth + 2,
      currentRoute: location.pathname + location.search,
      isRight: (() => { const el = document.querySelector('[aria-label="التنقل الرئيسي للشريك"]'); if (!el) return false; const bounds = el.getBoundingClientRect(); return Math.abs(bounds.right - innerWidth) < 5; })(),
      subscriptionGate: /\bPRO\b|شراء باقة|تفعيل اشتراك/.test(document.body.innerText)
    }));
    assert.equal(overview.rtl, "rtl");
    assert.equal(overview.overflow, false);
    assert.equal(overview.isRight, true);
    assert.equal(overview.subscriptionGate, false);
    await page.screenshot({path:"D:\\samrim-FILING\\BTHWANI-PARTNER-MARKETING-OVERVIEW-20261031.png",fullPage:true});
    console.log("OVERVIEW "+JSON.stringify(overview));
    await page.getByRole("button",{ name:"العروض والقسائم", exact:true }).click();
    await page.waitForURL(/view=offers/, { timeout: 10000 });
    await page.getByRole("button",{ name:"عرض جديد" }).first().waitFor({ state:"visible" });
    await page.getByRole("button",{ name:"عرض جديد" }).first().click();
    await page.getByText("عرض متجر جديد", { exact:true }).waitFor({ state:"visible" });
    await page.getByLabel("رمز العرض").waitFor({ state:"visible" });
    // Intentionally do not submit the form or alter business data.
    await page.getByRole("button",{ name:"إغلاق" }).first().click();
    console.log("OFFERS_READ_ONLY=PASS");
    await page.getByRole("button",{ name:"حملات المنصة", exact:true }).click();
    await page.waitForURL(/view=campaigns/, { timeout:10000 });
    await page.getByText("حملات المنصة المؤهلة", { exact:true }).waitFor({ state:"visible" });
    assert.equal(await page.getByRole("button",{ name:"عرض جديد" }).count(),0);
    console.log("CAMPAIGNS_READ_ONLY=PASS");
    await page.getByRole("button",{ name:"مقاطع المتجر", exact:true }).click();
    await page.waitForURL(/view=content/, { timeout:10000 });
    await page.getByText("مقاطع المتجر", { exact:true }).first().waitFor({ state:"visible" });
    await page.getByRole("button",{ name:"اختر مقطع MP4" }).waitFor({ state:"visible", timeout:12000 });
    console.log("CONTENT_READ_ONLY=PASS");
    await page.getByRole("button",{ name:"نظرة تسويقية", exact:true }).click();
    await page.waitForURL(/view=overview/, { timeout:10000 });
    await page.screenshot({path:"D:\\samrim-FILING\\BTHWANI-PARTNER-MARKETING-OVERVIEW-VIEW.png",fullPage:false});

    for (const width of [1024,390]) {
      await page.setViewportSize({ width,height:850 });
      await page.waitForTimeout(350);
      const layout = await page.evaluate(() => ({
        width:innerWidth, rtl:document.documentElement.dir,
        overflow:document.documentElement.scrollWidth > innerWidth + 2,
        links:[...document.querySelectorAll('[aria-label="أقسام تسويق المتجر"] [role="button"]')].length,
        sidebar:Boolean(document.querySelector('[aria-label="التنقل الرئيسي للشريك"]'))
      }));
      assert.equal(layout.rtl,"rtl");
      assert.equal(layout.overflow,false, "horizontal overflow "+width);
      assert.equal(layout.links,4);
      assert.equal(layout.sidebar,width>=1024);
      console.log("VIEWPORT "+JSON.stringify(layout));
    }
    assert.deepEqual(errors,[],"RUNTIME_CONSOLE_ERRORS");
    // Force only the campaign read to fail. The independent Store promotions read must survive.
    const failedCampaignPath = "**/dsh/partner/stores/**/campaigns";
    await page.route(failedCampaignPath, route => route.fulfill({
      status: 503, contentType: "application/json", body: '{"error":"simulated_campaign_read_failure"}',
    }));
    await page.setViewportSize({ width: 1360, height: 850 });
    await page.goto("http://localhost:18102/store?section=promotions&view=overview",{waitUntil:"domcontentloaded"});
    await page.getByText("تعذر قراءة حملات المنصة. ما زالت عروض المتجر معروضة.",{exact:true})
      .waitFor({state:"visible",timeout:16000});
    await page.getByText("عروض المتجر",{exact:true}).waitFor({state:"visible"});
    console.log("CAMPAIGN_READ_PARTIAL_FAILURE=PASS");
    await page.unroute(failedCampaignPath);
    await page.reload({waitUntil:"domcontentloaded"});
    await page.getByText("العروض المعتمدة والنشطة لهذا المتجر تظهر للعملاء", {exact:false})
      .first().waitFor({state:"visible",timeout:13000});
    console.log("MARKETING_E2E=PASS");
  } finally {
    if (page) await page.close().catch(()=>{});
    await browser.close();
  }
}
run().catch(e => { console.error("MARKETING_E2E=FAIL "+String(e?.stack ?? e)); process.exitCode=1; });
