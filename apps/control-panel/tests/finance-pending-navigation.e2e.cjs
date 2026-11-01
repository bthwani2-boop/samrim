const assert = require("node:assert/strict");
const { chromium } = require("@playwright/test");

// Read-only finance navigation proof. Never submits a financial action or
// fabricates WLT responses; financial balances require separate owner readback.
async function main() {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
  let page;
  try {
    const origin = "http://localhost:13000";
    const context = browser.contexts().find(item =>
      item.pages().some(tab => tab.url().startsWith(origin)));
    assert.ok(context, "AUTHORIZED_OPERATOR_EDGE_CONTEXT_REQUIRED");
    page = await context.newPage();
    await page.setViewportSize({ width: 1366, height: 900 });
    const failures = [];
    page.on("pageerror", error => failures.push("script:" + String(error.message).slice(0, 120)));
    page.on("response", response => {
      if (response.status() >= 500 && response.url().startsWith(origin + "/api/finance")) {
        failures.push("finance-http:" + response.status());
      }
    });
    await page.goto(origin + "/finance", { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.getByText("المركز المالي", { exact: true }).waitFor({ state: "visible", timeout: 15000 });
    assert.equal(await page.locator("html").getAttribute("dir"), "rtl");
    assert.equal(new URL(page.url()).pathname, "/finance");
    await page.getByRole("button", { name: "المعلقة", exact: true }).click();
    await page.waitForURL(url => url.pathname === "/finance" &&
      url.searchParams.get("tab") === "pending", { timeout: 10000 });
    await page.getByText("طابور القرارات المالية", { exact: true })
      .waitFor({ state: "visible", timeout: 10000 });
    assert.equal(await page.getByRole("searchbox", { name: "البحث في السجلات المعروضة" }).count(), 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), true,
      "FINANCE_PENDING_HORIZONTAL_OVERFLOW");
    assert.deepEqual(failures, [], "PAGE_OR_FINANCE_RESPONSE_ERRORS");
    console.log("FINANCE_PENDING_NAVIGATION=PASS_READONLY_REAL_SESSION");
  } finally {
    if (page) await page.close().catch(() => {});
    await browser.close();
  }
}
main().catch(error => {
  console.error("FINANCE_PENDING_NAVIGATION=FAIL " + String(error.stack || error).slice(0, 700));
  process.exitCode = 1;
});
