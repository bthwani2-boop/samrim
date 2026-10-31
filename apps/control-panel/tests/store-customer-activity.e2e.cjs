const assert = require("node:assert/strict");
const { chromium } = require("@playwright/test");

function summary(storeId, period, completedCustomers, returningCustomers) {
  return {
    storeId,
    period,
    measuredAt: "2026-10-31T10:00:00Z",
    totalOrders: 1800,
    deliveredOrders: 900,
    pickedUpOrders: 120,
    cancelledOrders: 30,
    rejectedOrders: 20,
    deliveryFailedOrders: 5,
    completedOrderValueMinor: 840000,
    completedCustomers,
    returningCustomers,
    customerActorId: "anonymous-customer-must-not-appear",
  };
}

async function metric(page, label) {
  const rows = page.locator("dl.store-profile-facts > div");
  const row = rows.filter({ has: page.getByText(label, { exact: true }) });
  await row.waitFor({ state: "visible", timeout: 12000 });
  assert.equal(await row.count(), 1, `EXPECTED_ONE_METRIC_ROW: ${label}`);
  return (await row.locator("dd").innerText()).trim();
}

async function main() {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
  let page;
  try {
    const origin = "http://localhost:13000";
    const context = browser.contexts().find(candidate =>
      candidate.pages().some(openPage => openPage.url().startsWith(origin))
    );
    assert.ok(context, "OPERATOR_BROWSER_CONTEXT_REQUIRED");
    page = await context.newPage();
    await page.setViewportSize({ width: 1360, height: 850 });

    const requests = [];
    let responseMode = "valid";
    await page.route("**/api/stores/*/orders/summary?*", async route => {
      const url = new URL(route.request().url());
      const match = url.pathname.match(/\/api\/stores\/([^/]+)\/orders\/summary$/);
      assert.ok(match, `UNEXPECTED_SUMMARY_PATH: ${url.pathname}`);
      const storeId = decodeURIComponent(match[1]);
      const period = url.searchParams.get("period");
      requests.push({ storeId, period });

      let result = summary(storeId, period, 1386, 428);
      if (responseMode === "scope-mismatch") {
        responseMode = "valid";
        result = summary("another-store", period, 99, 88);
      } else if (period === "7d") {
        result = summary(storeId, period, 24, 7);
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ summary: result }),
      });
    });

    await page.goto(origin + "/partners?tab=directory", {
      waitUntil: "domcontentloaded",
      timeout: 28000,
    });
    const storeRow = page.locator('tr[data-kind="store"]').first();
    await storeRow.waitFor({ state: "visible", timeout: 20000 });
    await storeRow.locator("td").first().click();
    await page.getByRole("tab", { name: "العملاء والجودة" }).click();

    await page.getByText("عملاء أكملوا طلبًا", { exact: true }).waitFor({ state: "visible", timeout: 12000 });
    assert.equal(requests[0]?.period, "30d", "DEFAULT_SUMMARY_PERIOD_MUST_BE_30_DAYS");
    assert.ok(requests[0].storeId.length > 0, "STORE_ID_REQUIRED_IN_SUMMARY_REQUEST");
    assert.equal(await metric(page, "عملاء أكملوا طلبًا"), (1386).toLocaleString("ar-YE"));
    assert.equal(await metric(page, "عملاء كرروا الشراء"), (428).toLocaleString("ar-YE"));
    assert.ok(!(await page.locator("body").innerText()).includes("anonymous-customer-must-not-appear"));

    responseMode = "scope-mismatch";
    await page.getByRole("button", { name: "7 أيام" }).click();
    await page.getByText("تعذر قراءة نشاط عملاء المتجر من DSH.", { exact: false }).waitFor({ state: "visible", timeout: 12000 });
    assert.equal(await page.getByText("99", { exact: true }).count(), 0, "CROSS_STORE_TOTAL_MUST_NOT_RENDER");
    assert.deepEqual(requests.at(-1), { storeId: requests[0].storeId, period: "7d" });

    await page.getByRole("button", { name: "إعادة المحاولة" }).click();
    await page.getByText("عملاء أكملوا طلبًا", { exact: true }).waitFor({ state: "visible", timeout: 12000 });
    assert.equal(await metric(page, "عملاء أكملوا طلبًا"), (24).toLocaleString("ar-YE"));
    assert.equal(await metric(page, "عملاء كرروا الشراء"), (7).toLocaleString("ar-YE"));
    assert.deepEqual(requests.at(-1), { storeId: requests[0].storeId, period: "7d" });
    assert.equal(requests.filter(request => request.period === "7d").length, 2, "RETRY_MUST_REISSUE_SCOPED_READ");

    console.log("OPERATOR_STORE_CUSTOMER_ACTIVITY=PASS_MOCKED_ANONYMOUS_COUNTS_SCOPE_REJECTION_AND_RETRY");
  } finally {
    if (page) await page.close().catch(() => {});
    await browser.close();
  }
}

main().catch(error => {
  console.error("OPERATOR_STORE_CUSTOMER_ACTIVITY=FAIL " + String(error.stack || error).slice(0, 1800));
  process.exitCode = 1;
});