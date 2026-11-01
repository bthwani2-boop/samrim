// Browser-only, read-only discovery and responsive regression check.
// Uses a fresh isolated context, never the user's existing browser session.
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";

const origin = process.env.BTHWANI_CLIENT_WEB_ORIGIN ?? "http://localhost:18101";
const browser = await chromium.connectOverCDP(process.env.BTHWANI_BROWSER_CDP ?? "http://127.0.0.1:9223");
const context = await browser.newContext({
  viewport: { width: 390, height: 844 }, locale: "ar-YE", reducedMotion: "reduce",
});
const page = await context.newPage();
const pageErrors = [];
page.on("pageerror", error => pageErrors.push(error.message));
let stage = "start";
const summary = { outcome: "IN_PROGRESS", widths: {}, noMatchStores: false, noMatchProducts: false, guestStoreDetail: false, pageErrors: 0 };

try {
  stage = "discovery bootstrap";
  await page.goto(origin + "/home", { waitUntil: "domcontentloaded", timeout: 30000 });
  const city = page.getByRole("button", { name: /اختيار مدينة صنعاء/ });
  await Promise.any([city.waitFor({ timeout: 20000 }), page.getByText("اكتشف المتاجر").waitFor({ timeout: 20000 })]);
  if (await city.isVisible()) await city.click();
  await expect(page.getByText("اكتشف المتاجر")).toBeVisible({ timeout: 20000 });
  assert.equal(await page.locator("html").getAttribute("dir"), "rtl");
  const homeOffer = page.getByRole("button", { name: /^عرض .* من / }).first();
  await homeOffer.waitFor({ state: "visible", timeout: 14000 }).catch(() => {});
  const homeOfferLabel = (await homeOffer.count()) ? (await homeOffer.getAttribute("aria-label")) ?? "" : "";
  const homeOfferName = homeOfferLabel.startsWith("عرض ") && homeOfferLabel.lastIndexOf(" من ") > 4
    ? homeOfferLabel.slice(4, homeOfferLabel.lastIndexOf(" من ")) : "";
  summary.positiveProductSearch = "NOT_RUN";

  stage = "product search no-results";
  const search = page.getByPlaceholder("ابحث عن متجر أو منتج");
  // Focusing swaps the transparent hero header for the dedicated search header.
  await search.click();
  await expect(page.getByRole("button", { name: "المنتجات", exact: true })).toBeVisible({ timeout: 12000 });
  const activeSearch = page.getByPlaceholder("ابحث عن متجر أو منتج");
  if (homeOfferName) {
    stage = "positive product search";
    await activeSearch.fill(homeOfferName);
    await expect(page.getByText(homeOfferName, { exact: true }).first()).toBeVisible({ timeout: 16000 });
    summary.positiveProductSearch = "PASS";
  }
  stage = "product search no-results";
  await activeSearch.fill("__bthwani_nonexistent_store_20261101__");
  await expect(activeSearch).toHaveValue("__bthwani_nonexistent_store_20261101__");
  await expect(page.getByText("لا توجد منتجات مطابقة")).toBeVisible({ timeout: 16000 });
  summary.noMatchProducts = true;

  stage = "offline product search retry";
  await context.setOffline(true);
  await activeSearch.fill("__bthwani_offline_query_20261101__");
  await expect(page.getByText("لا يوجد اتصال بالإنترنت")).toBeVisible({ timeout: 12000 });
  await expect(page.getByText("تعذر البحث عن المنتجات")).toBeVisible({ timeout: 16000 });
  await context.setOffline(false);
  await expect(page.getByText("لا يوجد اتصال بالإنترنت")).toHaveCount(0, { timeout: 12000 });
  await page.getByRole("button", { name: "إعادة المحاولة" }).first().click();
  await expect(page.getByText("لا توجد منتجات مطابقة")).toBeVisible({ timeout: 16000 });
  summary.offlineProductSearchRecovered = true;

  stage = "store search no-results";
  await page.getByRole("button", { name: "المتاجر", exact: true }).click();
  await expect(page.getByText("لا توجد نتائج بهذا الاسم")).toBeVisible({ timeout: 16000 });
  summary.noMatchStores = true;

  stage = "return to discovery";
  await activeSearch.fill("");
  const closeSearch = page.getByRole("button", { name: "إغلاق البحث" }).first();
  if (await closeSearch.isVisible()) await closeSearch.click();
  await expect(page.getByText("اكتشف المتاجر")).toBeVisible({ timeout: 18000 });

  stage = "responsive accessibility";
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 850 });
    await expect(page.getByText("اكتشف المتاجر")).toBeVisible({ timeout: 12000 });
    const overflow = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - innerWidth));
    summary.widths[width] = { overflow };
    assert.equal(overflow, 0, `unexpected horizontal overflow at ${width}px`);
  }

  stage = "guest store detail";
  const storeLink = page.getByRole("button", { name: /فتح متجر/ }).first();
  if (await storeLink.count() > 0) {
    await storeLink.click();
    await expect(page).toHaveURL(url => url.pathname.startsWith("/store/"), { timeout: 12000 });
    summary.guestStoreDetail = true;
  }

  stage = "guest cart and favorite boundary";
  summary.guestCartGuard = "NOT_RUN";
  summary.guestFavoriteGuard = "NOT_RUN";
  await page.goto(origin + "/home", { waitUntil: "domcontentloaded", timeout: 30000 });
  await expect(page.getByText("اكتشف المتاجر")).toBeVisible({ timeout: 16000 });
  const addButtons = page.getByRole("button", { name: /إضافة .* إلى السلة/ });
  await addButtons.first().waitFor({ state: "visible", timeout: 16000 }).catch(() => {});
  for (const add of await addButtons.all()) {
    if (!(await add.isEnabled())) continue;
    await add.click();
    await expect.poll(() => new URL(page.url()).searchParams.get("returnTo"), { timeout: 12000 }).toBe("/home");
    summary.guestCartGuard = "PASS";
    break;
  }
  await page.goto(origin + "/home", { waitUntil: "domcontentloaded", timeout: 30000 });
  await expect(page.getByText("اكتشف المتاجر")).toBeVisible({ timeout: 16000 });
  const favorite = page.getByRole("button", { name: /إضافة .* إلى المفضلة/ }).first();
  if (await favorite.count()) {
    await favorite.click();
    await expect.poll(() => new URL(page.url()).searchParams.get("returnTo"), { timeout: 12000 }).toBe("/home");
    summary.guestFavoriteGuard = "PASS";
  }

  stage = "guest account and appearance";
  await page.goto(origin + "/account", { waitUntil: "domcontentloaded", timeout: 30000 });
  await expect(page.getByText("حسابي")).toBeVisible({ timeout: 16000 });
  await expect(page.getByText("المظهر")).toBeVisible({ timeout: 16000 });
  summary.guestAccount = true;

  stage = "protected route redirects";
  summary.protectedRoutes = [];
  for (const route of ["/orders", "/addresses", "/wallet", "/notifications", "/multi-store-checkout", "/wallet-cash-in?amountMinor=2500&fromCheckout=1"]) {
    await page.goto(origin + route, { waitUntil: "domcontentloaded", timeout: 30000 });
    await expect.poll(() => new URL(page.url()).searchParams.get("returnTo"), { timeout: 12000 }).toBe(route);
    await expect(page.getByText("تسجيل الدخول").first()).toBeVisible({ timeout: 10000 });
    summary.protectedRoutes.push(route);
  }

  stage = "complete";
  assert.equal(pageErrors.length, 0, "unexpected JS page errors: " + pageErrors.slice(0, 3).join("; "));
  summary.outcome = "PASS";
  console.log(JSON.stringify(summary));
} catch (error) {
  console.error(JSON.stringify({ outcome: "FAIL", stage, url: page.url(), details: String(error).slice(0, 700), summary }));
  throw error;
} finally {
  await context.close();
  await browser.close();
}
