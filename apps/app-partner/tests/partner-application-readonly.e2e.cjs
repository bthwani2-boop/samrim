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
            registerMode: words.includes("حساب جديد"),
            loginMode: words.includes("لدي حساب"),
            cardTitle: words.includes("ابدأ الآن"),
            requiresDocumentPhoto: words.includes("أرفق صورة الوثيقة"),
            runtimeError: /(TransformError|Internal Server Error|Unable to resolve)/.test(words)
          };
        });
        console.log("PARTNER_APPLY_VIEW=" + JSON.stringify(report));
        assert.equal(report.pathname, "/apply");
        assert.equal(report.rtl, "rtl");
        assert.equal(report.title, true);
        assert.equal(report.cardTitle, true);
        assert.equal(report.registerMode, true);
        assert.equal(report.loginMode, true);
        assert.equal(report.overflow, false);
        assert.equal(report.requiresDocumentPhoto, false);
        assert.equal(report.runtimeError, false);
      }
      if (process.env.BTHWANI_CAPTURE_SIGNUP_QA === "1") {
        const dir = require("node:os").tmpdir();
        const join = require("node:path").join;
        const mobileScreenshot = join(dir, "BTHWANI_SIGNUP_QA_39_MOBILE.png");
        await page.screenshot({ path: mobileScreenshot, fullPage: true });
        await page.setViewportSize({width:1280,height:840});
        const desktopScreenshot = join(dir, "BTHWANI_SIGNUP_QA_39_DESKTOP.png");
        await page.screenshot({ path: desktopScreenshot, fullPage: true });
        await page.setViewportSize({width:390,height:844});
        await page.emulateMedia({colorScheme:"dark"});
        await page.waitForTimeout(350);
        const darkScreenshot = join(dir, "BTHWANI_SIGNUP_QA_39_DARK.png");
        await page.screenshot({path:darkScreenshot,fullPage:true});
        await page.emulateMedia({colorScheme:"light"});
        console.log("PARTNER_SIGNUP_SCREENSHOTS=" + mobileScreenshot + ";" + desktopScreenshot + ";" + darkScreenshot);
      }
      const cardBox = await page.getByText("ابدأ الآن", { exact: true }).locator("..").boundingBox();
      assert.ok(cardBox && cardBox.width < 600 && cardBox.width > 250, "SIGNUP_CARD_NOT_CONSTRAINED");
      assert.equal(await page.locator('input[type="password"]').count(), 0, "PREMATURE_PASSWORD_FIELDS");
      const phoneInput = page.getByLabel("رقم الجوال");
      const sendCode = page.getByRole("button", { name: "إرسال رمز التحقق" });
      assert.equal(await sendCode.isDisabled(), true, "SEND_CODE_WITHOUT_PHONE_SHOULD_BE_DISABLED");
      await phoneInput.fill("777123456");
      assert.equal(await sendCode.isEnabled(), true, "VALID_YEMEN_PHONE_SHOULD_ENABLE_CODE");
      await phoneInput.fill("77");
      assert.equal(await sendCode.isDisabled(), true, "INVALID_PHONE_SHOULD_DISABLE_CODE");
      await phoneInput.fill("");
      await page.getByRole("radio", { name: "لدي حساب" }).click();
      assert.equal(await page.locator('input[type="password"]').count(), 1, "LOGIN_PASSWORD_FIELD_MISSING");
      await phoneInput.fill("777123456");
      await page.getByLabel("كلمة المرور").fill("1234567");
      assert.equal(await page.getByRole("button", { name: "الدخول إلى طلبي" }).isDisabled(), true, "INVALID_PASSWORD_SHAPE_ACCEPTED");
      await page.getByLabel("كلمة المرور").fill("12345678");
      assert.equal(await page.getByRole("button", { name: "الدخول إلى طلبي" }).isEnabled(), true, "VALID_LOGIN_FIELDS_NOT_READY");
      await page.getByRole("button", { name: "نسيت كلمة المرور؟" }).click();
      await page.getByText("استعادة كلمة المرور", { exact: true }).waitFor({ state: "visible" });
      assert.equal(await page.locator('input[type="password"]').count(), 0, "RECOVERY_PASSWORD_BEFORE_PROOF");
      const recoveryCode = page.getByRole("button", { name: "إرسال رمز التحقق" });
      assert.equal(await recoveryCode.isEnabled(), true, "RECOVERY_SHOULD_REUSE_LOGIN_PHONE");
      await phoneInput.fill("");
      assert.equal(await recoveryCode.isDisabled(), true, "RECOVERY_CODE_WITHOUT_PHONE");
      await phoneInput.fill("777123456");
      assert.equal(await recoveryCode.isEnabled(), true, "RECOVERY_CODE_VALID_PHONE");
      await page.getByRole("button", { name: "العودة لتسجيل الدخول" }).click();
      assert.equal(await page.locator('input[type="password"]').count(), 1, "RETURN_TO_LOGIN_MISSING_PASSWORD");
      await page.getByRole("radio", { name: "حساب جديد" }).click();
      assert.equal(await page.locator('input[type="password"]').count(), 0, "REGISTER_PASSWORD_PREMATURE");
      console.log("PARTNER_SIGNUP_FLOW_LAYOUT=PASS");
      await page.getByRole("button", { name: "العودة لتسجيل دخول الشريك" }).click();
      await page.waitForURL(url => new URL(url).pathname === "/", { timeout: 15000 });
      await page.waitForTimeout(900); // allow an existing role-scoped session to redirect
      const returnState = await page.evaluate(() => ({
        path: location.pathname,
        signedOutLogin: (document.body.innerText || "").includes("تسجيل الدخول"),
        passwordField: Boolean(document.querySelector('input[type="password"]')),
        workspace: (document.body.innerText || "").includes("الطلبات") || (document.body.innerText || "").includes("متجري"),
      }));
      console.log("PARTNER_RETURN_STATE=" + JSON.stringify(returnState));
      if (returnState.path === "/") {
        await page.getByText("تسجيل الدخول", { exact: true }).first().waitFor({ state: "visible", timeout: 8000 });
        await page.getByLabel("رقم الجوال").waitFor({ state: "visible", timeout: 8000 });
        await page.getByLabel("كلمة المرور").waitFor({ state: "visible", timeout: 8000 });
        console.log("PARTNER_APPLY_RETURN_LOGIN=PASS");
      } else if (returnState.path.startsWith("/orders") && returnState.workspace) {
        console.log("PARTNER_APPLY_RETURN_LOGIN=NOT_RUN_SIGNED_IN_SESSION");
      } else {
        throw new Error("RETURN_DESTINATION_NOT_VERIFIED");
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
