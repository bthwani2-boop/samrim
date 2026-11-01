// Read-only, isolated browser proof for the local client Web surface.
// Run directly with Node; never uses the owner's existing browser context.
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";

const origin = process.env.BTHWANI_CLIENT_WEB_ORIGIN ?? "http://localhost:18101";
const cdp = process.env.BTHWANI_BROWSER_CDP ?? "http://127.0.0.1:9223";
const browser = await chromium.connectOverCDP(cdp);
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "ar" });
const page = await context.newPage();
const pageErrors = [];
page.on("pageerror", error => pageErrors.push(error.message));
try {
  await page.goto(origin + "/home", { waitUntil: "domcontentloaded", timeout: 30000 });
  // First-time guests may need to select an active service city before discovery.
  const cityOption = page.getByRole("button", { name: /اختيار مدينة صنعاء/ });
  await Promise.any([cityOption.waitFor({ timeout: 20000 }), page.getByText("اكتشف المتاجر").waitFor({ timeout: 20000 })]);
  if (await cityOption.isVisible()) await cityOption.click();
  await expect(page.getByText("اكتشف المتاجر")).toBeVisible({ timeout: 25000 });
  assert.equal(await page.locator("html").getAttribute("dir"), "rtl");
  await expect(page.getByPlaceholder("ابحث عن متجر أو منتج")).toBeVisible();
  const homeOverflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);

  const storeLink = page.getByRole("button", { name: /فتح متجر/ }).first();
  const hasStore = await storeLink.count() > 0;
  if (hasStore) {
    await storeLink.click();
    await expect(page).toHaveURL(/\/store\//u, { timeout: 12000 });
  }

  await page.goto(origin + "/wallet-cash-in?amountMinor=2500&fromCheckout=1", {
    waitUntil: "domcontentloaded", timeout: 30000,
  });
  await expect.poll(() => new URL(page.url()).searchParams.get("returnTo"), { timeout: 15000 })
    .toBe("/wallet-cash-in?amountMinor=2500&fromCheckout=1");
  await expect(page.getByText("تسجيل الدخول").first()).toBeVisible();

  await page.goto(origin + "/home", { waitUntil: "domcontentloaded", timeout: 30000 });
  await expect(page.getByText("اكتشف المتاجر")).toBeVisible({ timeout: 20000 });
  await context.setOffline(true);
  const offlineNotice = page.getByText("لا يوجد اتصال بالإنترنت");
  await expect(offlineNotice).toBeVisible({ timeout: 10000 });
  await context.setOffline(false);
  await expect(offlineNotice).toHaveCount(0, { timeout: 10000 });
  assert.equal(pageErrors.length, 0, "client JavaScript page errors: " + pageErrors.slice(0, 3).join("; "));
  console.log(JSON.stringify({
    outcome: "PASS", guestHome: true, rtl: true, storeOpened: hasStore,
    walletReturn: true, offlineRecovered: true, mobileHorizontalOverflowPx: homeOverflow,
    pageErrors: 0,
  }));
} finally {
  await context.close();
  await browser.close();
}
