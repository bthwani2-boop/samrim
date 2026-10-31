const assert = require("node:assert/strict");
const { chromium } = require("@playwright/test");

async function run() {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
  let page;
  try {
    const context = browser.contexts().find(c => c.pages().some(p => p.url().startsWith("http://localhost:18102")));
    assert.ok(context, "EXISTING_PARTNER_WEB_SESSION_REQUIRED");
    page = await context.newPage();
    await page.goto("http://localhost:18102/more", { waitUntil: "domcontentloaded", timeout: 25000 });
    const card = page.getByText("رابط متجر", { exact: false }).first();
    await card.waitFor({ state: "visible", timeout: 15000 });
    const whatsapp = page.getByRole("button", { name: "مشاركة عبر واتساب" });
    const preview = page.getByLabel("رابط المعاينة المحلية");
    if (await preview.count()) {
      assert.equal(await whatsapp.count(), 0, "a local preview must never allow WhatsApp sharing");
      console.log("LOCAL_PREVIEW_SHARE_GUARD=PASS");
    } else {
      const storePublic = page.getByLabel("رابط المتجر العام");
      if (await storePublic.count()) {
        assert.equal(await whatsapp.count(), 1);
        console.log("PUBLIC_STORE_SHARE_BUTTON=PASS");
      } else {
        assert.equal(await whatsapp.count(), 0, "no share button without an explicitly configured public Store URL");
        console.log("UNCONFIGURED_SHARE_GUARD=PASS");
      }
    }
  } finally {
    if (page) await page.close().catch(() => {});
    await browser.close();
  }
}
run().catch(error => { console.error("STOREFRONT_SHARE_E2E=FAIL " + (error.stack || error.message)); process.exitCode = 1; });
