// Read-only assessment of the existing remote Partner Expo Web runtime.
// Uses the one approved CDP browser profile; never logs personal form values.
const assert = require("node:assert/strict");
const { chromium } = require("@playwright/test");

async function audit() {
  const browser = await chromium.connectOverCDP(process.env.BTHWANI_BROWSER_CDP ?? "http://127.0.0.1:9222");
  try {
    const context = browser.contexts()[0];
    assert.ok(context, "APPROVED_CHROME_CONTEXT_REQUIRED");
    const page = await context.newPage();
    try {
      const pageErrors = [];
      page.on("pageerror", e => pageErrors.push(String(e.message || e).slice(0, 160)));
      const response = await page.goto("http://localhost:18102/apply", { waitUntil: "domcontentloaded", timeout: 30000 });
      assert.ok(response && response.status() < 400, "PARTNER_APPLY_HTTP_UNAVAILABLE");
      await page.getByText("طلب الانضمام إلى بثواني", { exact: true }).waitFor({ state: "visible", timeout: 20000 });
      for (const size of [{ width: 1280, height: 840 }, { width: 390, height: 844 }]) {
        await page.setViewportSize(size);
        const report = await page.evaluate(() => {
          const words = document.body.innerText || "";
          return {
            pathname: location.pathname,
            rtl: document.documentElement.dir,
            width: innerWidth,
            overflow: document.documentElement.scrollWidth > innerWidth + 1,
            title: words.includes("طلب الانضمام إلى بثواني"),
            registerMode: words.includes("تسجيل رقم جديد"),
            loginMode: words.includes("الدخول بحساب موجود"),
            requiresDocumentPhoto: words.includes("أرفق صورة الوثيقة"),
            runtimeError: /(TransformError|Internal Server Error|Unable to resolve)/.test(words)
          };
        });
        console.log("PARTNER_APPLY_VIEW=" + JSON.stringify(report));
        assert.equal(report.pathname, "/apply");
        assert.equal(report.rtl, "rtl");
        assert.equal(report.title, true);
        assert.equal(report.overflow, false);
        assert.equal(report.requiresDocumentPhoto, false);
        assert.equal(report.runtimeError, false);
      }
      if (pageErrors.length) throw new Error("EXPO_RENDER_ERRORS " + JSON.stringify(pageErrors));
      console.log("PARTNER_APPLY_READONLY=PASS");
    } finally {
      await page.close().catch(() => {});
    }
  } finally {
    await browser.close();
  }
}
audit().catch(e => { console.error("PARTNER_APPLY_READONLY=FAIL " + String(e.message || e).slice(0, 260)); process.exitCode = 1; });
