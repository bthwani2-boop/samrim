const assert = require("node:assert/strict");
const { chromium } = require("@playwright/test");

async function inspect(page, width) {
  await page.setViewportSize({ width, height: 850 });
  await page.goto("http://localhost:18102/account", { waitUntil: "domcontentloaded", timeout: 25000 });
  await page.waitForFunction(() => {
    const text = document.body.innerText || "";
    return text.includes("حسابي · خدمات المتجر") || text.includes("تعذر التحقق") || location.pathname === "/";
  }, { timeout: 12000 }).catch(() => {});
  return page.evaluate(() => {
    const text = document.body.innerText || "";
    return {
      pathname: location.pathname,
      rtl: document.documentElement.dir,
      width: innerWidth,
      hasHub: text.includes("حسابي · خدمات المتجر"),
      hasAccountPreferences: text.includes("الحساب والتفضيلات"),
      hasJoining: text.includes("ملف الانضمام والمراجعة") || text.includes("طلب انضمام متجر"),
      hasAgreement: text.includes("الاتفاقية التجارية"),
      hasWallet: text.includes("المحفظة والتسويات"),
      hasVisibleError: /TransformError|SyntaxError|Unable to resolve|Internal Server Error/.test(text),
      authBlocked: text.includes("تعذر التحقق") || location.pathname === "/",
      overflow: document.documentElement.scrollWidth > innerWidth + 2,
    };
  });
}

async function run() {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
  let page;
  try {
    const context = browser.contexts().find(c => c.pages().some(p => p.url().startsWith("http://localhost:18102/")));
    assert.ok(context, "AUTHORIZED_PARTNER_CONTEXT_REQUIRED");
    page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(String(error?.message || error).slice(0, 120)));
    for (const width of [1360, 390]) {
      const result = await inspect(page, width);
      console.log("ACCOUNT_VIEWPORT " + JSON.stringify(result));
      if (result.authBlocked) { console.log("ACCOUNT_E2E=BLOCKED_AUTH"); process.exitCode=2; return; }
      assert.equal(result.pathname, "/account");
      assert.equal(result.rtl, "rtl");
      assert.ok(result.hasHub);
      assert.ok(result.hasAccountPreferences);
      assert.equal(result.hasVisibleError, false);
      assert.equal(result.overflow, false);
      if (result.hasAgreement) {
        const link = page.getByRole("button", { name: /الاتفاقية التجارية/ }).first();
        assert.ok(await link.count(), "AGREEMENT_LINK_NOT_ACCESSIBLE");
      }
      if (result.hasWallet) {
        const link = page.getByRole("button", { name: /المحفظة والتسويات/ }).first();
        assert.ok(await link.count(), "WALLET_LINK_NOT_ACCESSIBLE");
      }
    }
    await page.setViewportSize({width:390,height:850});
    await page.goto("http://localhost:18102/more",{waitUntil:"domcontentloaded",timeout:20000});
    const accountShortcut=page.getByRole("button",{name:"فتح حسابي وملف الانضمام والاتفاقيات"});
    await accountShortcut.waitFor({state:"visible",timeout:10000});
    await accountShortcut.click();
    await page.waitForURL("**/account",{timeout:10000});
    assert.equal(new URL(page.url()).pathname,"/account","MOBILE_ACCOUNT_NAV_FAILED");
    console.log("ACCOUNT_MOBILE_NAV=PASS");
    assert.equal(errors.length,0,"PAGE_ERRORS " + JSON.stringify(errors));
    console.log("ACCOUNT_E2E=PASS");
  } finally {
    if(page)await page.close().catch(()=>{});
    await browser.close();
  }
}
run().catch(error => { console.error("ACCOUNT_E2E=FAIL "+String(error?.message||error).slice(0,400)); process.exitCode=1; });
