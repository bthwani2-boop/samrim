const assert = require("node:assert/strict");
const { chromium } = require("@playwright/test");

async function run() {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
  try {
    const context = browser.contexts()[0];
    assert.ok(context, "EDGE_CONTEXT_REQUIRED");
    const elleen = context.pages().find(page => page.url().startsWith("https://elleen.ye/admin"));
    if (elleen) {
      const reference = await elleen.evaluate(() => ({
        rtl: document.documentElement.dir,
        width: innerWidth,
        sidebar: (() => {
          const boxes = [...document.querySelectorAll("aside, nav, [class*=sidebar]")];
          const match = boxes.map(el => el.getBoundingClientRect())
            .find(box => box.width > 170 && box.width < 340 && box.height > 500 && box.right > innerWidth - 15);
          return match ? {width: Math.round(match.width), atRight: Math.abs(match.right-innerWidth)<16} : null;
        })(),
      }));
      process.stdout.write("REFERENCE_SHELL " + JSON.stringify(reference) + "\n");
    }
    const page = context.pages().find(tab => tab.url().startsWith("http://localhost:18102/"));
    assert.ok(page, "EXISTING_PARTNER_TAB_REQUIRED");
    const originalWidth = page.viewportSize();
    const errors = [];
    page.on("pageerror", () => errors.push("pageerror"));
    try {
      await page.waitForTimeout(300);
      const snapshot = await page.evaluate(() => {
        const rail = document.querySelector('[aria-label="التنقل الرئيسي للشريك"]');
        const rect = rail?.getBoundingClientRect();
        return {
          path: location.pathname, rtl: document.documentElement.dir,
          width: innerWidth, textLen: document.body.innerText.length,
          hasErrorOverlay: /SyntaxError|TransformError|Internal Server Error/.test(document.body.innerText),
          sidebar: rect ? { x: Math.round(rect.x), right: Math.round(rect.right), width: Math.round(rect.width), height: Math.round(rect.height) } : null,
          links: [...document.querySelectorAll('[role="link"]')].map(el => el.getAttribute("aria-label")).filter(Boolean),
        };
      });
      process.stdout.write("PARTNER_MORE " + JSON.stringify(snapshot) + "\n");
      if (snapshot.path === "/") {
        process.stdout.write("PARTNER_DESKTOP_E2E=SKIP_AUTH_REQUIRED\n");
        return;
      }
      assert.ok(!snapshot.hasErrorOverlay, "BUNDLE_ERROR_VISIBLE");
      assert.equal(snapshot.rtl, "rtl", "RTL_MISSING");
      assert.ok(snapshot.sidebar, "RIGHT_SIDEBAR_MISSING");
      assert.ok(Math.abs(snapshot.sidebar.right - snapshot.width) <= 4, "SIDEBAR_NOT_ON_RIGHT");
      assert.ok(snapshot.links.includes("الحساب والإعدادات"), "ACCOUNT_LINK_MISSING");
      assert.equal(errors.length, 0, "PAGE_ERRORS_PRESENT");
      process.stdout.write("PARTNER_DESKTOP_E2E=PASS_READ_ONLY\n");
    } finally {
      // This audit never clicks, navigates, logs out or changes the live Edge tab.
      void originalWidth;
    }
  } finally {
    await browser.close();
  }
}
run().catch(error => {process.stderr.write("PARTNER_DESKTOP_E2E=FAIL " + (error?.message||"unknown").slice(0,450) + "\n");process.exitCode=1});
