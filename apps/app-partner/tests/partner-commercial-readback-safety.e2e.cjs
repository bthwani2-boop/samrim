const assert = require("node:assert/strict");
const { chromium } = require("@playwright/test");

// Real, read-only Partner/DSH contract proof. Never log actor/store identifiers,
// tokens, agreement amounts, or raw response bodies.
async function main() {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
  let page;
  try {
    const context = browser.contexts().find(candidate =>
      candidate.pages().some(tab => tab.url().startsWith("http://localhost:18102/")));
    assert.ok(context, "AUTHORIZED_PARTNER_CONTEXT_REQUIRED");
    page = await context.newPage();
    await page.setViewportSize({ width: 1360, height: 900 });
    const isAgreementRead = response => {
      try {
        const url = new URL(response.url());
        return response.request().method() === "GET" &&
          /^\/dsh\/partner\/stores\/[^/]+\/commercial-agreements$/.test(url.pathname);
      } catch { return false; }
    };
    const read = page.waitForResponse(isAgreementRead, { timeout: 18000 });
    await page.goto("http://localhost:18102/more", {
      waitUntil: "domcontentloaded", timeout: 20000,
    });
    const response = await read;
    const body = await response.json().catch(() => null);
    const storeID = decodeURIComponent(new URL(response.url()).pathname.split("/")[4] ?? "");
    assert.equal(response.status(), 200, "CANONICAL_AGREEMENT_READ_NOT_OK");
    assert.ok(Array.isArray(body?.agreements), "AGREEMENT_ARRAY_REQUIRED");
    assert.ok(body.agreements.every(item => item && item.storeId === storeID),
      "CROSS_STORE_AGREEMENT_READBACK");
    const validModel = agreement =>
      ["COMMISSION", "SUBSCRIPTION", "HYBRID"].includes(agreement.commercialModel) &&
      ["NONE", "MONTHLY", "ANNUAL"].includes(agreement.billingPeriod) &&
      agreement.billingTimeZone === "Asia/Aden" &&
      ["NONE", "MANUAL", "AUTOMATIC"].includes(agreement.renewalPolicy);
    const legacyFields = {
      commercialModel: "", recurringAmountMinor: 0, billingPeriod: "",
      billingTimeZone: "", invoiceDueDays: 0, graceDays: 0, renewalPolicy: "",
      terminationTerms: "", adjustmentTerms: "",
    };
    const isHistoricalCommissionBridge = agreement =>
      ["ACTIVE", "SUPERSEDED", "FINANCE_REJECTED", "REJECTED"].includes(agreement.status) &&
      Array.isArray(agreement.rates) && agreement.rates.length > 0 &&
      Object.entries(legacyFields).every(([field, empty]) => agreement[field] === empty);
    const contractValid = body.agreements.every(item => validModel(item) || isHistoricalCommissionBridge(item));
    const hasLegacyBridge = body.agreements.some(isHistoricalCommissionBridge);
    await page.waitForTimeout(450);
    const shown = await page.evaluate(() => {
      const text = document.body.innerText || "";
      return {
        warning: text.includes("تعذر التحقق من الاتفاقية"),
        active: text.includes("الاتفاقية سارية"),
        dashboard: text.includes("أحدث الطلبات"),
        rtl: document.documentElement.dir === "rtl",
        noOverflow: document.documentElement.scrollWidth <= innerWidth + 2,
      };
    });
    assert.equal(shown.dashboard, true, "PARTNER_DASHBOARD_NOT_RENDERED");
    assert.equal(shown.rtl, true, "PARTNER_RTL_REQUIRED");
    assert.equal(shown.noOverflow, true, "PARTNER_HORIZONTAL_OVERFLOW");
    if (!contractValid) {
      assert.equal(shown.warning, true, "MALFORMED_AGREEMENT_MUST_FAIL_CLOSED");
      assert.equal(shown.active, false, "MALFORMED_AGREEMENT_MUST_NOT_BE_ACTIVE");
      console.log("PARTNER_AGREEMENT=PASS_FAIL_CLOSED_RUNTIME_CONTRACT_INCOMPATIBLE");
      return;
    }
    if (body.agreements.some(item => item.status === "ACTIVE")) {
      assert.equal(shown.warning, false, "VALID_ACTIVE_AGREEMENT_SHOULD_RENDER");
      assert.equal(shown.active, true, "VALID_ACTIVE_AGREEMENT_NOT_RENDERED");
      await page.setViewportSize({ width: 390, height: 844 });
      const mobileRead = page.waitForResponse(isAgreementRead, { timeout: 18000 });
      await page.goto("http://localhost:18102/more", {
        waitUntil: "domcontentloaded", timeout: 20000,
      });
      await mobileRead;
      await page.getByText("الاتفاقية سارية", { exact: true })
        .first().waitFor({ state: "visible", timeout: 12000 });
      const mobileSafe = await page.evaluate(() =>
        document.documentElement.dir === "rtl" &&
        document.documentElement.scrollWidth <= innerWidth + 2 &&
        !(document.body.innerText || "").includes("تعذر التحقق من الاتفاقية"));
      assert.equal(mobileSafe, true, "MOBILE_AGREEMENT_READBACK_NOT_SAFE");
      console.log("PARTNER_AGREEMENT_MOBILE=PASS_REAL_READBACK_RTL");
    }
    if (hasLegacyBridge) {
      await page.setViewportSize({ width: 1360, height: 900 });
      await page.goto("http://localhost:18102/store?section=settings", {
        waitUntil: "domcontentloaded", timeout: 20000,
      });
      await page.getByText("هذه اتفاقية عمولة قديمة", { exact: false })
        .first().waitFor({ state: "visible", timeout: 12000 });
      const details = await page.evaluate(() => {
        const text = document.body.innerText || "";
        const activeAcceptanceButtons = [...document.querySelectorAll("button,[role=button]")]
          .filter(item => {
            const box = item.getBoundingClientRect();
            return box.width > 0 && box.height > 0 &&
              /قبول الاتفاقية|تأكيد القبول/.test(item.innerText || item.getAttribute("aria-label") || "");
          });
        return { warning: text.includes("تعذر التحقق من الاتفاقية"),
          activeAcceptanceButtons: activeAcceptanceButtons.length };
      });
      assert.equal(details.warning, false, "HISTORICAL_DETAILS_SHOULD_RENDER");
      assert.equal(details.activeAcceptanceButtons, 0, "HISTORICAL_ACTIVE_AGREEMENT_MUST_NOT_BE_ACCEPTABLE_AGAIN");
      console.log("PARTNER_AGREEMENT_DETAILS=PASS_READONLY_HISTORICAL_NO_ACCEPTANCE");
    }
    console.log(hasLegacyBridge
      ? "PARTNER_AGREEMENT=PASS_LEGACY_COMMISSION_DISPLAY_ONLY_WLT_UPGRADE_STILL_REQUIRED"
      : "PARTNER_AGREEMENT=PASS_COMPATIBLE_CONTRACT_READBACK");
  } finally {
    if (page) await page.close().catch(() => {});
    await browser.close();
  }
}
main().catch(error => {
  console.error("PARTNER_AGREEMENT=FAIL " + String(error?.message || error).slice(0, 200));
  process.exitCode = 1;
});
