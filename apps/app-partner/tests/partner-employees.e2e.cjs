const assert = require("node:assert/strict");
const { chromium } = require("@playwright/test");

async function main() {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
  let page;
  try {
    const context = browser.contexts().find(item => item.pages().some(p => p.url().startsWith("http://localhost:18102")));
    assert.ok(context, "PARTNER_SESSION_CONTEXT_REQUIRED");
    page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message.slice(0, 200)));
    for (const width of [1360, 1024, 390]) {
      await page.setViewportSize({ width, height: 860 });
      if (width === 1360) {
        await page.goto("http://localhost:18102/more", { waitUntil: "domcontentloaded", timeout: 25000 });
        await page.getByRole("link", { name: "الموظفين", exact: true }).click();
        await page.waitForURL(url => new URL(url).pathname === "/employees", { timeout: 12000 });
      } else {
        await page.goto("http://localhost:18102/employees", { waitUntil: "domcontentloaded", timeout: 25000 });
      }
      await page.getByRole("heading", {name: "الموظفين"}).first().waitFor({ state: "visible", timeout: 18000 });
      const snap = await page.evaluate(() => {
        const text = document.body.innerText || "";
        const nav = document.querySelector('[aria-label="التنقل الرئيسي للشريك"]');
        const rect = nav?.getBoundingClientRect();
        return {
          pathname: location.pathname, rtl: document.documentElement.dir, width: innerWidth,
          mainTab: !!document.querySelector('[aria-label="الموظفين"][role="link"]'),
          sidebarRight: rect ? Math.abs(rect.right - innerWidth) < 6 : null,
          hasEmployeeHeading: text.includes("الموظفين"), hasInvite: text.includes("إضافة موظف"),
          hasGrants: text.includes("موظفو المتجر"),
          hasSafetyCopy: text.includes("لا تمنح ملكيته"),
          hasError: /(SyntaxError|TransformError|Unable to resolve|Internal Server Error)/.test(text),
          overflow: document.documentElement.scrollWidth > innerWidth + 2,
        };
      });
      console.log("EMPLOYEES_VIEWPORT " + JSON.stringify(snap));
      assert.equal(snap.pathname, "/employees");
      assert.equal(snap.rtl, "rtl");
      assert.equal(snap.overflow, false);
      assert.equal(snap.hasError, false);
      if (width >= 1024) {
        assert.equal(snap.sidebarRight, true);
        assert.equal(snap.mainTab, true);
      } else assert.equal(snap.sidebarRight, null);
      assert.equal(snap.hasEmployeeHeading, true);
      assert.equal(snap.hasGrants, true, "STORE_EMPLOYEE_REGISTRY_REQUIRED");
      assert.equal(snap.hasSafetyCopy, true);
      if (width === 1360) {
        await page.getByRole("button", { name: "إضافة موظف" }).click();
        await page.getByLabel("اسم الموظف").waitFor({state: "visible"});
        await page.getByLabel("رقم هاتف الموظف").waitFor({state: "visible"});
        const submit = page.getByRole("button", { name: "إنشاء الموظف" });
        assert.equal(await submit.isDisabled(), true, "EMPTY_EMPLOYEE_INVITATION_MUST_BE_DISABLED");
        await page.getByRole("button", { name: "إغلاق إضافة موظف" }).click();
        assert.equal(await page.getByLabel("اسم الموظف").isVisible().catch(() => false), false);
        await page.screenshot({ path: "D:\\\\samrim-FILING\\\\BTHWANI-PARTNER-EMPLOYEES-20261031.png", fullPage: false });
      }
    }
    assert.deepEqual(errors, [], "RUNTIME_ERRORS");
    console.log("PARTNER_EMPLOYEES_E2E=PASS");
  } finally {
    if (page) await page.close().catch(() => {});
    await browser.close();
  }
}
main().catch(err => { console.error("PARTNER_EMPLOYEES_E2E=FAIL " + String(err?.message || err).slice(0, 450)); process.exitCode = 1; });
