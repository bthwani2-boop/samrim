const assert = require("node:assert/strict");
const { chromium } = require("@playwright/test");

// Actor-facing, read-only catalogue UX proof. Do not create or modify products,
// upload images or write commercial prices/stock.
async function main() {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
  let page;
  try {
    const origin = "http://localhost:13000";
    const context = browser.contexts().find(c =>
      c.pages().some(p => p.url().startsWith(origin)));
    assert.ok(context, "AUTHORIZED_OPERATOR_CONTEXT_REQUIRED");
    page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", error => pageErrors.push(String(error.message).slice(0, 100)));
    page.on("response", response => {
      const status = response.status();
      if (status >= 500 && response.url().startsWith(origin))
        pageErrors.push("server-error:" + status);
    });
    for (const width of [1366, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(origin + "/catalog?catalogView=products", {
        waitUntil: "domcontentloaded", timeout: 22000,
      });
      await page.getByRole("tab", { name: "المنتجات" })
        .waitFor({ state: "visible", timeout: 13000 });
      const open = page.getByRole("button", { name: "منتج جديد", exact: true });
      await open.waitFor({ state: "visible", timeout: 10000 });
      await open.click();
      await page.waitForURL(url =>
        url.pathname === "/catalog" && url.searchParams.get("mode") === "create",
        { timeout: 11000 });
      await page.locator("#catalog-product-name").waitFor({ state: "visible", timeout: 10000 });
      assert.equal(await page.locator("#catalog-product-description").count(), 1);
      assert.equal(await page.locator("#catalog-vertical").count(), 1);
      const view = await page.evaluate(() => ({
        rtl: document.documentElement.dir === "rtl",
        overflow: document.documentElement.scrollWidth > innerWidth + 2,
        createTitle: (document.body.innerText || "").includes("إضافة منتج إلى الكتالوج المشترك"),
      }));
      assert.equal(view.rtl, true, "CATALOG_RTL_REQUIRED");
      assert.equal(view.createTitle, true, "CATALOG_CREATE_PANEL_MISSING");
      assert.equal(view.overflow, false, "CATALOG_CREATE_HORIZONTAL_OVERFLOW");
      await page.getByRole("button", { name: "إغلاق التفاصيل" }).click();
      await page.waitForURL(url =>
        url.pathname === "/catalog" && url.searchParams.get("mode") !== "create",
        { timeout: 11000 });
      console.log("CATALOG_CREATE_NAV=PASS_READONLY width=" + width);
    }
    assert.deepEqual(pageErrors, [], "CATALOG_PAGE_ERRORS");
  } finally {
    if (page) await page.close().catch(() => {});
    await browser.close();
  }
}
main().catch(error => {
  console.error("CATALOG_CREATE_NAV=FAIL " + String(error.message).slice(0, 250));
  process.exitCode = 1;
});
