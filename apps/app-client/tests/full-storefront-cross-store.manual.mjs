// Read-only real-DSH cross-Store browser probe. Use only the EXISTING
// approved Chrome CDP process and genuinely published public Partner Stores.
// Absence of a second published Store is BLOCKED, never a fabricated PASS.
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";

const origin = process.env.BTHWANI_CLIENT_WEB_ORIGIN ?? "http://localhost:18101";
const browser = await chromium.connectOverCDP(process.env.BTHWANI_BROWSER_CDP ?? "http://127.0.0.1:9222");
// Reuse the original user's already-open Chrome context. A disposable public
// page must never clone the login/profile or close the user's context.
const context = browser.contexts()[0];
assert(context, "BLOCKED_NO_ORIGINAL_CDP_CONTEXT");
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const found = [];
let cityChoices = 0;
let pagination = "NOT_RUN";
let unselectedCityInExistingContext = false;

async function openHome() {
  const response = await page.goto(origin + "/home", { waitUntil: "domcontentloaded", timeout: 40000 });
  assert(response?.ok(), "public home failed HTTP " + (response?.status() ?? "none"));
  const cityButtons = page.getByRole("button", { name: /اختيار مدينة/ });
  await Promise.any([
    cityButtons.first().waitFor({ timeout: 18000 }),
    page.getByText("اكتشف المتاجر").waitFor({ timeout: 18000 }),
  ]).catch(() => {});
  if (await cityButtons.first().isVisible().catch(() => false)) {
    cityChoices = await cityButtons.count();
    // A city selection persists to the user's original browser storage.
    // Do not change it just to turn a test green.
    unselectedCityInExistingContext = true;
    return;
  }
  await page.getByRole("button", { name: /فتح متجر/ }).first().waitFor({ timeout: 16000 }).catch(() => {});
}

async function inspectStore(storeButtonIndex) {
  const buttons = page.getByRole("button", { name: /فتح متجر/ });
  const count = await buttons.count();
  if (storeButtonIndex >= count) return false;
  await buttons.nth(storeButtonIndex).click();
  await expect(page).toHaveURL(/\/store\/[^/?]+/, { timeout: 16000 });
  const marketplace = new URL(page.url());
  const id = decodeURIComponent(marketplace.pathname.split("/store/")[1] ?? "").trim();
  assert(id, "missing actual Store id in Marketplace route");
  await expect(page.getByRole("button", { name: "زيارة موقع المتجر الكامل" })).toBeVisible({ timeout: 16000 });
  await page.getByRole("button", { name: "زيارة موقع المتجر الكامل" }).click();
  await expect(page).toHaveURL(/\/storefront\//, { timeout: 16000 });
  await expect(page.getByText("منتجات المتجر", { exact: true })).toBeVisible({ timeout: 20000 });
  assert.equal(await page.locator("html").getAttribute("dir"), "rtl");

  const site = new URL(page.url());
  assert.equal(decodeURIComponent(site.pathname.split("/storefront/")[1] ?? ""), id, "website Store differs from Marketplace");
  const offerLinks = page.getByRole("link", { name: /^عرض / });
  await expect(offerLinks.first()).toBeVisible({ timeout: 16000 });
  const hrefs = await offerLinks.evaluateAll((elements) => elements.map((e) => e.getAttribute("href")).filter(Boolean));
  assert(hrefs.length > 0);
  for (const href of hrefs) {
    const link = new URL(href, origin);
    assert.equal(decodeURIComponent(link.pathname.split("/store/")[1] ?? ""), id, "cross-Store offer link detected");
    if (site.searchParams.get("serviceCityId")) {
      assert.equal(link.searchParams.get("serviceCityId"), site.searchParams.get("serviceCityId"), "cross-city offer link detected");
    }
  }

  const search = page.getByRole("textbox", { name: "البحث في منتجات المتجر" });
  await search.focus();
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "البحث في منتجات المتجر");
  const more = page.getByRole("button", { name: "تحميل المزيد" });
  if (await more.isVisible().catch(() => false)) {
    const before = hrefs.length;
    await more.click();
    await expect.poll(() => offerLinks.count(), { timeout: 20000 }).toBeGreaterThan(before);
    const all = await offerLinks.evaluateAll((elements) => elements.map((e) => e.getAttribute("href")).filter(Boolean));
    for (const href of all) assert.equal(decodeURIComponent(new URL(href, origin).pathname.split("/store/")[1] ?? ""), id);
    pagination = "PASS_OWNER_SCOPED_NEXT_PAGE";
  } else {
    pagination = pagination === "PASS_OWNER_SCOPED_NEXT_PAGE" ? pagination : "NOT_APPLICABLE_NO_PUBLIC_NEXT_CURSOR";
  }

  // Real anchor must also be keyboard-activatable and retain the
  // exact Store + product deep link, without adding an item to the cart.
  const target = new URL(hrefs[0], origin);
  await offerLinks.first().focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/store\/[^/?]+/, { timeout: 16000 });
  const opened = new URL(page.url());
  assert.equal(opened.pathname, target.pathname, "keyboard link must preserve Store");
  assert.equal(opened.searchParams.get("productId"), target.searchParams.get("productId"), "keyboard link must preserve product");
  await page.goBack({ waitUntil: "domcontentloaded", timeout: 20000 });
  await expect(page).toHaveURL(/\/storefront\//, { timeout: 16000 });
  await expect(page.getByText("منتجات المتجر", { exact: true })).toBeVisible({ timeout: 20000 });

  found.push({ id, city: site.searchParams.get("serviceCityId") || "", products: hrefs.length });
  await page.goBack({ waitUntil: "domcontentloaded", timeout: 20000 });
  await expect(page).toHaveURL(/\/store\/[^/?]+/, { timeout: 16000 });
  await openHome();
  return true;
}

try {
  await openHome();
  const count = unselectedCityInExistingContext ? 0 : await page.getByRole("button", { name: /فتح متجر/ }).count();
  const capacity = Math.min(count, 8);
  for (let i = 0; i < capacity && new Set(found.map((s) => s.id)).size < 2; i++) {
    await inspectStore(i);
  }
  const distinct = [...new Map(found.map((s) => [s.id, s])).values()];
  if (unselectedCityInExistingContext) {
    console.log(JSON.stringify({ outcome: "BLOCKED_ORIGINAL_SESSION_CITY_UNSELECTED", activeCityChoices: cityChoices, userStoragePreserved: true, errors }));
  } else if (distinct.length < 2) {
    console.log(JSON.stringify({ outcome: "BLOCKED_SECOND_PUBLISHED_PARTNER_STORE", seenPublishedStores: distinct.length, visibleStoreButtons: count, activeCityChoices: cityChoices, oneStoreOwnerLinksChecked: distinct.length === 1, keyboardDeepLinkChecked: distinct.length === 1, pagination, errors }));
  } else {
    // Each real Store's public catalog links must remain scoped to its own
    // canonical DSH Store ID, rather than retaining the previous Store's data.
    assert.notEqual(distinct[0].id, distinct[1].id);
    assert.deepEqual(errors, [], "public Store navigation JavaScript errors");
    console.log(JSON.stringify({ outcome: "PASS_TWO_REAL_PUBLISHED_STORES", uniqueStores: distinct.length, sameCity: distinct[0].city === distinct[1].city, perStoreOwnerLinksChecked: true, pagination, keyboardFocus: true, browserErrors: errors }));
  }
} finally {
  await page.close();
  // Leave the user's CDP context, other pages, login and Chrome process intact.
}
// End this disposable probe process without sending browser.close() or
// context.close() to the user's existing Chrome session.
process.exit(0);
