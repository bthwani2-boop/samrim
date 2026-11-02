const assert = require("node:assert/strict");
const { chromium } = require("@playwright/test");

// Real Partner Store catalog UX. No product/price changes are submitted.
async function main() {
  const browser = await chromium.connectOverCDP(process.env.BTHWANI_BROWSER_CDP ?? "http://127.0.0.1:9223");
  let page;
  try {
    const context = browser.contexts().find(c =>
      c.pages().some(p => p.url().startsWith("http://localhost:18102/")));
    assert.ok(context, "AUTHORIZED_PARTNER_CONTEXT_REQUIRED");
    page = await context.newPage();
    for (const width of [1360, 390]) {
      await page.setViewportSize({ width, height: 850 });
      await page.goto("http://localhost:18102/products", {
        waitUntil: "domcontentloaded", timeout: 25000,
      });
      const edit = page.getByRole("button", { name: /^تعديل سعر / }).first();
      await edit.waitFor({ state: "visible", timeout: 16000 });
      const name = (await edit.getAttribute("aria-label")).slice("تعديل سعر ".length);
      assert.ok(name.length > 0, "PRODUCT_CONTEXT_REQUIRED");
      await edit.click();
      const query = page.getByRole("textbox", { name: "بحث الأسعار السريعة" });
      await query.waitFor({ state: "visible", timeout: 13000 });
      assert.equal(await query.inputValue(), name, "PRODUCT_EDIT_LOST_SELECTED_PRODUCT");
      await page.getByText("المنتج المحدد: " + name, { exact: true })
        .waitFor({ state: "visible", timeout: 14000 });
      await page.getByRole("textbox", { name: "السعر الجديد لـ " + name })
        .first().waitFor({ state: "visible", timeout: 16000 });
      assert.equal(await page.evaluate(() =>
        document.documentElement.scrollWidth <= innerWidth + 2), true,
        "TARGETED_EDIT_OVERFLOW_" + width);
      console.log("PARTNER_TARGETED_PRICE_EDIT=PASS_READONLY width=" + width);
    }
    await page.setViewportSize({ width: 1360, height: 850 });
    await page.goto("http://localhost:18102/products", {
      waitUntil: "domcontentloaded", timeout: 25000,
    });
    await page.getByRole("button", { name: "تعديل المنتجات" }).click();
    const bulkSearch = page.getByRole("textbox", { name: "بحث الأسعار السريعة" });
    await bulkSearch.waitFor({ state: "visible", timeout: 14000 });
    assert.equal(await bulkSearch.inputValue(), "", "BULK_PRICE_EDIT_MUST_START_UNFILTERED");
    assert.equal(await page.getByText("المنتج المحدد:", { exact: false }).count(), 0,
      "BULK_PRICE_EDIT_HAS_STALE_TARGET");
    console.log("PARTNER_BULK_PRICE_EDIT=PASS_NO_PRESELECTED_PRODUCT");
  } finally {
    if (page) await page.close().catch(() => {});
    await browser.close();
  }
}
main().catch(e => {
  console.error("PARTNER_TARGETED_PRICE_EDIT=FAIL " + String(e.message).slice(0, 230));
  process.exitCode = 1;
});
