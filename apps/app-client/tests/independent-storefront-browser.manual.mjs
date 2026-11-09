// Browser-only UI integration using isolated intercepted public DSH responses.
// No database mutation, independent publication release, customer login, or
// checkout is performed. THIS IS NOT an owner-backed live E2E proof.
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";

const origin = process.env.BTHWANI_CLIENT_WEB_ORIGIN ?? "http://localhost:18101";
const browser = await chromium.connectOverCDP(process.env.BTHWANI_BROWSER_CDP ?? "http://127.0.0.1:9222");
const context = browser.contexts()[0];
assert(context, "authorized Chrome CDP context required");
const page = await context.newPage();
const errors = [];
page.on("pageerror", error => errors.push(error.message));
const id = "independent-browser-qa";
const storeName = "متجر مستقل تجريبي";
let cityID = "";
let published = true;
const json = (route, status, payload) => route.fulfill({
  status, contentType: "application/json",
  headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" },
  body: JSON.stringify(payload),
});
try {
  // An independent website does not require any published marketplace Store.
  // Read the active City from DSH's genuine unauthenticated canonical registry.
  const citiesResponse = await page.request.get(
    (process.env.BTHWANI_DSH_API_ORIGIN ?? "http://127.0.0.1:18080") + "/dsh/public/service-cities",
    { timeout: 12000 },
  );
  assert(citiesResponse.ok(), "real DSH public Service City registry unavailable");
  const citiesPayload = await citiesResponse.json();
  assert(Array.isArray(citiesPayload.cities), "invalid DSH service cities response");
  cityID = citiesPayload.cities.find(city => city.active && /^[A-Za-z0-9_-]{1,128}$/.test(city.id))?.id ?? "";
  assert.match(cityID, /^[A-Za-z0-9_-]{1,128}$/, "no active DSH Service City");
  await page.route("**/dsh/public/stores/" + id + "**", route => json(route, 404, { code: "NOT_FOUND" }));
  await page.route("**/dsh/public/independent-stores/" + id + "**", route => {
    if (!published) return json(route, 404, { code: "NOT_FOUND" });
    if (new URL(route.request().url()).pathname.endsWith("/catalog")) {
      return json(route, 200, {
        storeId: id,
        offers: [{
          offerId: "offer-qa", productId: "product-qa", variantId: "variant-qa",
          productName: "منتج مستقل تجريبي", variantTitle: "الحبة",
          priceMinor: 2500, currency: "YER",
          quantityMinBaseUnits: 1, quantityMaxBaseUnits: 8, quantityStepBaseUnits: 1,
          media: [{ uri: "https://images.example.com/public-product.jpg", role: "primary" }],
        }],
        nextCursor: "",
      });
    }
    return json(route, 200, {
      storeId: id, serviceCityId: cityID, name: storeName,
      hostingTermsVersion: "approved-test", merchantPolicyVersion: "policy-test",
      profileImageUri: "https://images.example.com/logo.jpg",
      coverImageUri: "https://images.example.com/cover.jpg",
      cancellationTerms: "إلغاء الطلب وفق السياسة المعتمدة",
      returnsTerms: "إرجاع المنتجات وفق السياسة المعتمدة",
      fulfillmentTerms: "تجهيز المنتج في المتجر",
      collectionTerms: "استلام العميل من المتجر",
      businessPhoneE164: "+967700000000",
      checkoutEnabled: false,
      privateOwnerNote: "NEVER_SHOW_PRIVATE_OWNER_NOTE",
    });
  });

  await page.goto(origin + "/storefront/" + id + "?serviceCityId=" + cityID, {
    waitUntil: "domcontentloaded", timeout: 40000,
  });
  await expect(page.getByText(storeName, { exact: true })).toBeVisible({ timeout: 20000 });
  await expect(page.getByText("منتج مستقل تجريبي")).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("الطلب المباشر غير متاح حتى اعتماد خدمة المتجر.")).toBeVisible();
  await expect(page.getByRole("button", { name: /سلة المتجر/ })).toHaveCount(0);
  await expect(page.getByText("NEVER_SHOW_PRIVATE_OWNER_NOTE")).toHaveCount(0);
  assert.equal(await page.locator("html").getAttribute("dir"), "rtl");
  // Use the original authorized Chrome identity profile as-is. Do not log
  // out a real customer or clear cookies to fabricate an anonymous flow.
  const customerAlreadySignedIn = await page.getByRole("button", { name: "حسابي" }).isVisible();
  if (customerAlreadySignedIn) {
    await expect(page.getByRole("button", { name: "تسجيل الدخول" })).toHaveCount(0);
    await page.getByRole("button", { name: "حسابي" }).click();
    await expect(page).toHaveURL(/\/account(?:\?|$)/, { timeout: 15000 });
    // The same Client Identity account is reachable from the independent
    // Store. No login, signout, credential export or order mutation is needed.
    await page.goto(origin + "/storefront/" + id + "?serviceCityId=" + cityID, {
      waitUntil: "domcontentloaded", timeout: 40000,
    });
    await expect(page.getByText(storeName, { exact: true })).toBeVisible({ timeout: 15000 });
  } else {
    await expect(page.getByRole("button", { name: "تسجيل الدخول" })).toBeVisible();
    await page.getByRole("button", { name: "تسجيل الدخول" }).click();
    const login = new URL(page.url());
    assert.equal(login.pathname, "/");
    const returnTo = login.searchParams.get("returnTo") ?? "";
    assert.equal(returnTo, "/storefront/" + id + "?serviceCityId=" + cityID);
  }

  // The real published Store reader remains authoritative on refocus/reload.
  published = false;
  // The existing open site must invalidate without a full browser reload when
  // the customer returns to it from another window/tab.
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByText("هذا المتجر غير متاح")).toBeVisible({ timeout: 15000 });
  await expect(page.getByText(storeName)).toHaveCount(0);
  await expect(page.getByText("منتج مستقل تجريبي")).toHaveCount(0);
  assert.deepEqual(errors, [], "browser JavaScript errors");
  console.log(JSON.stringify({
    outcome: "PASS_INTERCEPTED_BROWSER_UI_ONLY",
    cityScope: "real DSH directory",
    independentUI: true,
    customerIdentityEntry: customerAlreadySignedIn ? "existing_authenticated_session" : "scoped_login_return",
    marketplaceCheckoutDenied: true,
    unpublishedAndPrivateHidden: true,
    errors: 0,
  }));
} finally {
  await page.close();
  await browser.close();
}
