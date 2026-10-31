const assert = require("node:assert/strict");
const { chromium } = require("@playwright/test");

async function checkPartner(browser) {
  const origin = "http://localhost:18102";
  const context = browser.contexts().find(c => c.pages().some(p => p.url().startsWith(origin))) ?? browser.contexts()[0];
  assert.ok(context, "EXISTING_PARTNER_SESSION_REQUIRED");
  const page = await context.newPage();
  try {
    let calls = 0;
    let foreign = false;
    await page.route("**/dsh/partner/stores/*/discovery-content/summary", async route => {
      const uri = new URL(route.request().url());
      const parts = uri.pathname.split("/");
      const scope = decodeURIComponent(parts[parts.indexOf("stores") + 1]);
      calls++;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        storeId: foreign ? "foreign-store" : scope,
        contentCount: 3, impressions: 250, clicks: 90, attributedOrdersCreated: 5,
      }) });
    });
    await page.goto(origin + "/store?section=promotions&view=overview", {waitUntil:"domcontentloaded",timeout:28000});
    await page.getByText("أداء مقاطع المتجر", { exact:true }).waitFor({ state:"visible", timeout:18000 });
    await page.getByText("طلبات منشأة منسوبة", {exact:true}).waitFor({state:"visible",timeout:10000});
    await page.getByText("٥", {exact:true}).first().waitFor({state:"visible",timeout:10000});
    const before = calls;
    foreign = true;
    await page.goto(origin + "/store?section=promotions&view=content", {waitUntil:"domcontentloaded",timeout:28000});
    await page.goto(origin + "/store?section=promotions&view=overview", {waitUntil:"domcontentloaded",timeout:28000});
    await page.getByText("تعذرت قراءة تحليلات مقاطع هذا المتجر.", {exact:false}).waitFor({state:"visible",timeout:18000});
    assert.ok(calls > before);
    assert.equal(await page.getByText("طلبات منشأة منسوبة", {exact:true}).count(),0);
    foreign = false;
    await page.getByRole("button", {name:"إعادة قراءة تحليلات المقاطع"}).click();
    await page.getByText("طلبات منشأة منسوبة", {exact:true}).waitFor({state:"visible",timeout:12000});
    await page.setViewportSize({width:390,height:844});
    await page.waitForTimeout(350);
    assert.equal(await page.getByText("أداء مقاطع المتجر", {exact:true}).isVisible(),true);
    console.log("PARTNER_STORE_MARKETING_SUMMARY=PASS_MOCKED_SCOPE_RETRY_MOBILE");
  } finally { await page.close().catch(()=>{}); }
}

async function checkOperator(browser) {
  const origin = "http://localhost:13000";
  const context = browser.contexts().find(c => c.pages().some(p => p.url().startsWith(origin))) ?? browser.contexts()[0];
  assert.ok(context,"EXISTING_OPERATOR_SESSION_REQUIRED");
  const page = await context.newPage();
  try {
    let calls=0, foreign=false;
    await page.route("**/api/stores/*/marketing/summary", async route => {
      const parts=new URL(route.request().url()).pathname.split("/");
      const storeId=decodeURIComponent(parts[parts.indexOf("stores")+1]);
      calls++;
      await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({
        storeId:foreign?"foreign-store":storeId,contentCount:3,impressions:250,clicks:90,attributedOrdersCreated:5,
      })});
    });
    await page.goto(origin + "/partners?tab=directory",{waitUntil:"domcontentloaded",timeout:28000});
    const row=page.locator('tr[data-kind="store"]').first();
    await row.waitFor({state:"visible",timeout:18000});
    await row.locator("td").first().click();
    await page.getByRole("tab",{name:"المنتجات والعروض"}).click();
    await page.getByText("إحصاءات مقاطع هذا المتجر").waitFor({state:"visible",timeout:15000}).catch(async () => {
      await page.locator('section[aria-label="إحصاءات مقاطع هذا المتجر"]').waitFor({state:"visible",timeout:12000});
    });
    await page.getByText("طلبات منشأة منسوبة",{exact:true}).waitFor({state:"visible",timeout:12000});
    const before=calls;
    foreign=true;
    await page.getByRole("tab",{name:"العملاء والجودة"}).click();
    await page.getByRole("tab",{name:"المنتجات والعروض"}).click();
    await page.getByText("تعذرت قراءة تحليلات مقاطع المتجر.",{exact:false}).waitFor({state:"visible",timeout:12000});
    assert.ok(calls>before);
    assert.equal(await page.getByText("طلبات منشأة منسوبة",{exact:true}).count(),0);
    foreign=false;
    await page.getByRole("button",{name:"إعادة المحاولة"}).last().click();
    await page.getByText("طلبات منشأة منسوبة",{exact:true}).waitFor({state:"visible",timeout:12000});
    console.log("OPERATOR_STORE_MARKETING_SUMMARY=PASS_MOCKED_SCOPE_RETRY");
  } finally { await page.close().catch(()=>{}); }
}

async function main() {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
  try {await checkPartner(browser);await checkOperator(browser);} finally {await browser.close();}
}
main().catch(error=>{console.error("STORE_MARKETING_E2E=FAIL "+String(error.stack||error).slice(0,1900));process.exitCode=1});
