// Read-only browser proof. Connect to the existing approved Chrome CDP process;
// do not launch another browser, change application state, or publish a Store.
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";

const origin = process.env.BTHWANI_CLIENT_WEB_ORIGIN ?? "http://localhost:18101";
const browser = await chromium.connectOverCDP(process.env.BTHWANI_BROWSER_CDP ?? "http://127.0.0.1:9222");
// Use a new tab inside the existing authorized CDP context so current actor
// cookies and browser security policies are never replaced by an isolated profile.
const context = browser.contexts()[0];
assert(context, "approved Chrome CDP context is required");
const page = await context.newPage();
await page.setViewportSize({ width: 390, height: 844 });
await page.emulateMedia({ colorScheme: "light" });
const errors = [];
page.on("pageerror", error => errors.push({ route: new URL(page.url()).pathname, message: error.message, stack: error.stack?.slice(0, 400) }));

async function availableCity() {
  const pick = page.getByRole("button", { name: /اختيار مدينة/ }).first();
  await Promise.any([
    pick.waitFor({ timeout: 20000 }),
    page.getByText("اكتشف المتاجر").waitFor({ timeout: 20000 }),
  ]).catch(() => {});
  if (await pick.isVisible().catch(() => false)) await pick.click();
}

try {
  const homeResponse = await page.goto(origin + "/home", { waitUntil: "domcontentloaded", timeout: 40000 });
  assert(homeResponse?.ok(), "public client home HTTP failure; status=" + (homeResponse?.status() ?? "no response") + " url=" + page.url());
  await availableCity();
  const storeButton = page.getByRole("button", { name: /فتح متجر/ }).first();
  await storeButton.waitFor({ timeout: 22000 }).catch(() => {});

  if (!await storeButton.isVisible().catch(() => false)) {
    const route = await page.goto(origin + "/storefront/invalid-unpublished-store?serviceCityId=invalid-city", { waitUntil: "domcontentloaded", timeout: 40000 });
    console.log(JSON.stringify({ outcome: "BLOCKED_NO_PUBLISHED_MARKETPLACE_STORE", homeHTTP: homeResponse.status(), routeHTTP: route?.status(), htmlDirection: await page.locator("html").getAttribute("dir"), reason: "No authorized public Partner Store found in the current guest directory" }));
    // An absent approved Store is a blocked positive journey, not a green E2E run.
    process.exitCode = 2;
  } else {
    await storeButton.click();
    await expect(page).toHaveURL(/\/store\//, { timeout: 12000 });
    await expect(page.getByRole("button", { name: "زيارة موقع المتجر الكامل" })).toBeVisible({ timeout: 20000 });
    await page.getByRole("button", { name: "زيارة موقع المتجر الكامل" }).click();
    await expect(page).toHaveURL(/\/storefront\//, { timeout: 12000 });
    await expect(page.getByText("منتجات المتجر", { exact: true })).toBeVisible({ timeout: 22000 });
    assert.equal(await page.locator("html").getAttribute("dir"), "rtl");

    const layouts = [];
    for (const width of [390, 768, 1360]) {
      await page.setViewportSize({ width, height: 900 });
      const outcome = await page.evaluate(() => ({
        screen: window.innerWidth,
        horizontalOverflow: Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) - innerWidth,
        cards: Array.from(document.querySelectorAll('[aria-label^="عرض "]')).length,
      }));
      assert(outcome.horizontalOverflow <= 2, "unexpected horizontal overflow at " + width + ": " + outcome.horizontalOverflow);
      const screenshot = await page.screenshot({ animations: "disabled" });
      assert(screenshot.byteLength > 2000, "blank screenshot at " + width);
      layouts.push({ ...outcome, screenshotBytes: screenshot.byteLength });
    }

    // Measure the real application surface, not CSS color-scheme (which may be "normal").
    const readThemeTextColor = () => page.getByText("منتجات المتجر", { exact: true }).evaluate((element) => getComputedStyle(element).color);
    const lightThemeTextColor = await readThemeTextColor();
    await page.emulateMedia({ colorScheme: "dark" });
    await expect.poll(readThemeTextColor, { timeout: 10000 }).not.toBe(lightThemeTextColor);
    const darkThemeTextColor = await readThemeTextColor();
    const darkCapture = await page.screenshot({ animations: "disabled" });
    assert(darkCapture.byteLength > 2000);
    await page.emulateMedia({ colorScheme: "light" });
    await expect.poll(readThemeTextColor, { timeout: 10000 }).toBe(lightThemeTextColor);

    const storeSearch = page.getByRole("textbox", { name: "البحث في منتجات المتجر" });
    await storeSearch.focus();
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "البحث في منتجات المتجر");
    await storeSearch.fill("zzzz-no-such-published-product-412345");
    await storeSearch.press("Enter");
    await expect(page.getByText("لا توجد نتائج مطابقة لهذا البحث أو التصنيف.")).toBeVisible({ timeout: 20000 });
    await page.getByRole("button", { name: "عرض جميع المنتجات" }).click();
    await expect(page.getByRole("link", { name: /^عرض / }).first()).toBeVisible({ timeout: 20000 });

    // Simulate only a browser-side catalog read outage; never mutate DSH data.
    const catalogEndpoint = "**/dsh/public/stores/*/catalog**";
    await page.route(catalogEndpoint, (route) => route.abort("failed"));
    await storeSearch.fill("zzzz-failure-retry-412345");
    await storeSearch.press("Enter");
    await expect(page.getByText("تعذر تحديث المنتجات. النتائج السابقة محفوظة.")).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole("link", { name: /^عرض / }).first()).toBeVisible();
    await page.unroute(catalogEndpoint);
    await page.getByRole("button", { name: "إعادة قراءة المنتجات" }).click();
    await expect(page.getByText("لا توجد نتائج مطابقة لهذا البحث أو التصنيف.")).toBeVisible({ timeout: 20000 });
    await page.getByRole("button", { name: "عرض جميع المنتجات" }).click();
    await expect(page.getByRole("link", { name: /^عرض / }).first()).toBeVisible({ timeout: 20000 });

    // Simulated DSH withdrawal: public catalog must not leave previous Store data visible.
    await page.route(catalogEndpoint, (route) => route.fulfill({
      status: 404,
      contentType: "application/json",
      body: '{"code":"NOT_FOUND","message":"Store unavailable"}',
    }));
    await storeSearch.fill("revocation-probe");
    await storeSearch.press("Enter");
    await expect(page.getByText("هذا المتجر غير متاح")).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole("link", { name: /^عرض / })).toHaveCount(0);
    await page.unroute(catalogEndpoint);

    const site = new URL(page.url());
    site.pathname = "/storefront/non-existent-published-store";
    const invalidResponse = await page.goto(site.href, { waitUntil: "domcontentloaded", timeout: 40000 });
    assert(invalidResponse?.ok(), "unavailable Store route did not render");
    const serverHTML = await invalidResponse.text();
    assert.match(serverHTML, /noindex/i, "SSR must not index public-independent or unavailable Store URLs");
    assert.match(serverHTML, /<html[^>]*lang="ar"[^>]*dir="rtl"/i, "SSR document must be Arabic RTL");
    assert.match(await page.locator('meta[name="robots"]').getAttribute("content") ?? "", /noindex/i, "rendered metadata must remain noindex");
    await expect(page.getByText("هذا المتجر غير متاح")).toBeVisible({ timeout: 20000 });
    await expect(page.getByText("منتجات المتجر", { exact: true })).toHaveCount(0);

    console.log(JSON.stringify({ outcome: errors.length ? "BROWSER_WARN_JS_ERRORS" : "PASS_BROWSER", rtl: true, layouts, lightThemeTextColor, darkThemeTextColor, searchNoResultsRecovered: true, catalogFailureRetryRecovered: true, withdrawnStoreGuard: true, ssrNoindex: true, keyboardFocus: true, negativeStoreBlocked: true, errors, websiteUrl: site.origin + "/storefront/<store-id>" }));
    assert.deepEqual(errors, [], "Browser JavaScript errors during the public Storefront journey");
  }
} finally {
  // Only close the tab created by this proof, never the shared Chrome context.
  await page.close();
  await browser.close();
}
