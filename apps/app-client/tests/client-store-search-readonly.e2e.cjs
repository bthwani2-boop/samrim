const assert = require("node:assert/strict");
const { chromium } = require("@playwright/test");

// Read-only authenticated Client discovery -> Store projection proof.
// Never click cart, favorites, checkout or mutate an existing Store/offer.
async function main() {
  const browser = await chromium.connectOverCDP(process.env.BTHWANI_BROWSER_CDP ?? "http://127.0.0.1:9222");
  let page;
  try {
    const origin = "http://localhost:18101";
    const context = browser.contexts().find(item =>
      item.pages().some(tab => tab.url().startsWith(origin + "/")));
    assert.ok(context, "AUTHORIZED_CLIENT_CDP_CONTEXT_REQUIRED");
    page = await context.newPage();
    await page.setViewportSize({ width: 390, height: 844 });
    const failures = [];
    // Public catalog pages also work as a guest. Prove that this is the
    // already-authorized Client session before calling it authenticated.
    await page.goto(origin + "/orders", { waitUntil: "domcontentloaded", timeout: 25000 });
    await page.getByLabel("طلباتي", { exact: true }).waitFor({ state: "visible", timeout: 12000 })
      .catch(() => { throw new Error("AUTHORIZED_CLIENT_EDGE_CONTEXT_REQUIRED"); });
    assert.equal(new URL(page.url()).pathname, "/orders", "AUTHORIZED_CLIENT_EDGE_CONTEXT_REQUIRED");
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
    // Read the clicked home card's canonical identity rather than guessing
    // from a matching display name (different products can share a name).
    await product.click();
    await page.waitForURL(url => url.pathname.startsWith("/store/") && Boolean(url.searchParams.get("productId")), { timeout: 12000 });
    const homeDestination = new URL(page.url());
    const homeStoreID = decodeURIComponent(homeDestination.pathname.slice("/store/".length));
    const homeProductID = homeDestination.searchParams.get("productId");
    assert.ok(homeStoreID && homeProductID, "HOME_OFFER_IDENTITY_REQUIRED");
    await page.goto(origin + "/home", { waitUntil: "domcontentloaded", timeout: 25000 });
    const headerSearch = page.getByPlaceholder("ابحث عن متجر أو منتج");
    await headerSearch.click();
    await page.getByRole("button", { name: "المنتجات", exact: true }).click();
    const search = page.getByPlaceholder("ابحث عن متجر أو منتج");
    const serverSearch = page.waitForResponse(response => {
      const url = new URL(response.url());
      return response.ok() && response.request().method() === "GET" &&
        url.pathname === "/dsh/public/catalog/search" && url.searchParams.get("q") === productName;
    }, { timeout: 16000 });
    await search.fill(productName);
    const searchPayload = await (await serverSearch).json();
    assert.ok(Array.isArray(searchPayload?.offers), "CANONICAL_SEARCH_OFFERS_REQUIRED");
    const namedOffers = searchPayload.offers.filter(offer =>
      `عرض ${offer.productName} من ${offer.storeName || "المتجر"}` === label &&
      typeof offer.storeId === "string" && offer.storeId &&
      typeof offer.productId === "string" && offer.productId);
    const matchedIndex = namedOffers.findIndex(offer => offer.storeId === homeStoreID && offer.productId === homeProductID);
    assert.notEqual(matchedIndex, -1, "ORIGINAL_STORE_OFFER_NOT_IN_SEARCH_RESULTS");
    const selectedOffer = namedOffers[matchedIndex];
    await page.getByText(productName, { exact: true }).first()
      .waitFor({ state: "visible", timeout: 16000 });
    await page.getByText("نتائج المنتجات").waitFor({ state: "visible", timeout: 12000 });
    assert.equal(await page.locator("html").getAttribute("dir"), "rtl");
    console.log("CLIENT_PRODUCT_SEARCH=PASS_CURRENT_STORE_OFFER");

    // The search cards preserve DSH's offer order. Select the original
    // Store/Product identity among name-matched results, not the first name.
    const searchResults = page.locator('[aria-label="نتائج البحث عن المنتجات"]');
    const matchingOffers = searchResults.getByRole("button", { name: label, exact: true });
    await matchingOffers.first().waitFor({ state: "visible", timeout: 16000 });
    assert.equal(await matchingOffers.count(), namedOffers.length, "SEARCH_OFFER_IDENTITY_COUNT_MISMATCH");
    await matchingOffers.nth(matchedIndex).click();
    await page.waitForURL(url => url.pathname.startsWith("/store/") && Boolean(url.searchParams.get("productId")), { timeout: 12000 });
    const destination = new URL(page.url());
    assert.equal(decodeURIComponent(destination.pathname.slice("/store/".length)), selectedOffer.storeId, "OPENED_WRONG_STORE");
    assert.equal(destination.searchParams.get("productId"), selectedOffer.productId, "OPENED_WRONG_PRODUCT");
    await page.locator('[aria-label^="كتالوج "]').first()
      .waitFor({ state: "visible", timeout: 16000 });
    await page.getByRole("button", { name: "عرض تفاصيل " + productName, exact: true }).first()
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
