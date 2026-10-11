import { expect, test } from "./coverage-fixtures";

test("joining case accepts missing optional wallet provider without blocking required intake", async ({ page }) => {
  test.setTimeout(90_000);
  await page.route("**/api/auth/session**", (route) => route.fulfill({
    json: { identity: {
      subject: "operator-optional-wallet", sessionId: "session", role: "operator",
      permissions: ["partners"], surface: "control-panel", expiresAt: "2099-01-01T00:00:00.000Z",
    } },
  }));
  await page.route("**/api/service-cities**", (route) => route.fulfill({
    json: { cities: [{ id: "city-1", active: true, displayNameAr: "صنعاء" }] },
  }));
  await page.route("**/api/catalog/verticals**", (route) => route.fulfill({
    json: { verticals: [{ id: "vertical-1", active: true, nameAr: "المطاعم" }] },
  }));
  await page.route("**/api/catalog/commercial-store-types?**", (route) => route.fulfill({
    json: { storeTypes: [{ id: "type-1", active: true, verticalId: "vertical-1", nameAr: "مطعم" }] },
  }));
  // An unavailable optional reference service must not block an otherwise valid first-Store intake.
  await page.route("**/api/wallet-providers**", (route) => route.fulfill({ status: 503, json: { error: "unavailable" } }));
  let received: Record<string, unknown> | undefined;
  await page.route("**/api/partners/joining-cases", async (route) => {
    received = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ status: 201, json: {
      case: { id: "case-optional-wallet", walletProviderKey: received.walletProviderKey },
      idempotentReplay: false,
    } });
  });

  await page.goto("/partners/new");
  await expect(page.locator("#joining-owner")).toBeVisible();
  await expect(page.getByLabel("مزوّد المحفظة الذي حدده المالك (اختياري)")).toHaveValue("");
  await page.locator("#joining-owner").fill("محمد عبدالله");
  await page.locator("#joining-phone").fill("777000100");
  await page.locator("#joining-business").fill("مؤسسة النخيل");
  await page.locator("#joining-store").fill("مطعم النخيل");
  await page.locator("#joining-address").fill("شارع حدة قرب الجامع");
  await page.locator("#joining-city").selectOption("city-1");
  await page.locator("#joining-vertical").selectOption("vertical-1");
  await expect(page.locator("#joining-commercial-type")).toBeEnabled();
  await page.locator("#joining-commercial-type").selectOption("type-1");
  await page.getByRole("checkbox", { name: "الاثنين" }).check();
  await page.locator("#joining-proof-number").fill("DOC-TEST-9001");
  await page.locator("#joining-latitude").fill("15.369445");
  await page.locator("#joining-longitude").fill("44.191006");
  await page.getByRole("checkbox", { name: /توصيل بثواني/ }).check();
  await page.getByRole("button", { name: "إنشاء حالة انضمام" }).click();
  await expect.poll(() => received?.walletProviderKey).toBe("");
  expect(received?.firstStoreName).toBe("مطعم النخيل");
  expect(received?.firstStoreFulfillmentModes).toEqual(["BTHWANI_CAPTAIN"]);
  await expect(page).toHaveURL(/\/partners\/case-optional-wallet/);
  await page.goto("/partners/new");
  await expect(page.locator("#joining-owner")).toHaveValue("");
  await expect(page.locator("#joining-store")).toHaveValue("");
  await expect(page.locator("#joining-proof-number")).toHaveValue("");
  await expect(page.getByRole("button", { name: "إنشاء حالة انضمام" })).toBeVisible();
  await expect(page.getByText("وجدنا محاولة سابقة غير محسومة")).toHaveCount(0);
});
