const assert = require("node:assert/strict");
const { chromium } = require("@playwright/test");

// Read-only authenticated Client discovery -> Store projection proof.
// Never click cart, favorites, checkout or mutate an existing Store/offer.
async function main() {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
  let page;
  try {
    const origin = "http://localhost:18101";
    const context = browser.contexts().find(item =>
      item.pages().some(tab => tab.url().startsWith(origin + "/")));
    assert.ok(context, "AUTHORIZED_CLIENT_EDGE_CONTEXT_REQUIRED");
    page = await context.newPage();
    await page.setViewportSize({ width: 390, height: 844 });
    const failures = [];
    page.on("pageerror", e => failures.push("script:" + String(e.message).slice(0, 120)));
    page.on("response", r => {
      if (r.status() >= 500 && r.url().startsWith(origin))
        failures.push("server:" + r.status());
    });

    await page.goto(origin + "/home", { waitUntil: "domcontentloaded", timeout: 25000 });
    const product = page.getByRole("button", { name: /^عرض .* من / }).first();
    await product.waitFor({ state: "visible", timeout: 16000 });
    const label = (await product.getAttribute("aria-label")) || "";
    const separator = label.lastIndexOf(" من ");
    assert.ok(label.startsWith("عرض ") && separator > 4, "HOME_PRODUCT_LABEL_MALFORMED");
    const productName = label.slice(4, separator).trim();
    assert.ok(productName.length >= 2, "HOME_PRODUCT_NAME_REQUIRED");
    const headerSearch = page.getByPlaceholder("ابحث عن متجر أو منتج");
    await headerSearch.click();
    await page.getByRole("button", { name: "المنتجات", exact: true }).click();
    const search = page.getByPlaceholder("ابحث عن متجر أو منتج");
    await search.fill(productName);
    await page.getByText(productName, { exact: true }).first()
      .waitFor({ state: "visible", timeout: 16000 });
    await page.getByText("نتائج المنتجات").waitFor({ state: "visible", timeout: 12000 });
    assert.equal(await page.locator("html").getAttribute("dir"), "rtl");
    console.log("CLIENT_PRODUCT_SEARCH=PASS_CURRENT_STORE_OFFER");

    await page.goto(origin + "/home", { waitUntil: "domcontentloaded", timeout: 25000 });
    const store = page.getByRole("button", { name: /^فتح متجر/ }).first();
    await store.waitFor({ state: "visible", timeout: 16000 });
    await store.click();
    await page.waitForURL(url => url.pathname.startsWith("/store/"), { timeout: 12000 });
    await page.getByText("من منتجات المتجر").first()
      .waitFor({ state: "visible", timeout: 16000 });
    for (const width of [390, 1366]) {
      await page.setViewportSize({ width, height: 844 });
      assert.equal(await page.evaluate(() =>
        document.documentElement.scrollWidth <= innerWidth + 2), true,
        "STOREFRONT_HORIZONTAL_OVERFLOW_" + width);
    }
    assert.deepEqual(failures, [], "CLIENT_DISCOVERY_PAGE_ERRORS");
    console.log("CLIENT_STORE_PROJECTION=PASS_READONLY_RESPONSIVE");
  } finally {
    if (page) await page.close().catch(() => {});
    await browser.close();
  }
}
main().catch(error => {
  console.error("CLIENT_DISCOVERY=FAIL " + String(error.message).slice(0, 280));
  process.exitCode = 1;
});
