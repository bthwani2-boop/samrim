"use strict";
const assert = require("node:assert/strict");
const { chromium } = require("@playwright/test");

// Read-only, authenticated browser regression. Do not mock the DSH error or
// fabricate credentials. The 165-character order ID triggers input rejection.
async function main() {
  const browser = await chromium.connectOverCDP(process.env.BTHWANI_BROWSER_CDP ?? "http://127.0.0.1:9222");
  let page;
  try {
    const context = browser.contexts().find(c => c.pages().some(p => p.url().startsWith("http://localhost:18102"))) ?? browser.contexts()[0];
    assert.ok(context, "EXISTING_AUTHORIZED_PARTNER_CONTEXT_REQUIRED");
    page = await context.newPage();
    await page.goto("http://localhost:18102/orders?orderId=" + "x".repeat(165),
      { waitUntil: "domcontentloaded", timeout: 25000 });
    await page.getByText("تعذر قراءة الطلبات. ستُعاد المحاولة تلقائيًا.", { exact: true })
      .waitFor({ state: "visible", timeout: 22000 });
    const clear = page.getByRole("button", { name: "مسح بحث الطلبات" });
    await clear.waitFor({ state: "visible", timeout: 22000 });
    assert.equal(await clear.count(), 1, "failure recovery must have exactly one clear action");
    await clear.click();
    await page.waitForURL(url => !new URL(url).searchParams.get("orderId") && !new URL(url).searchParams.get("q"),
      { timeout: 18000 });
    console.log("PARTNER_FAILED_ORDER_SEARCH_CLEAR=PASS_REAL_AUTHENTICATED_UI");
  } finally {
    await page?.close().catch(() => {});
    await browser.close();
  }
}
main().catch(error => {
  console.error("PARTNER_FAILED_ORDER_SEARCH_CLEAR=FAIL " + String(error?.stack || error).slice(0, 1600));
  process.exitCode = 1;
});
