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
      await page.getByText("انضم إلى شركاء بثواني", { exact: true }).waitFor({ state: "visible", timeout: 20000 });
      for (const size of [{ width: 1280, height: 840 }, { width: 390, height: 844 }]) {
        await page.setViewportSize(size);
        // React Native Web recomputes useWindowDimensions asynchronously after resize.
        await page.waitForTimeout(450);
        const report = await page.evaluate(() => {
          const words = document.body.innerText || "";
          const phoneRect = document.querySelector('input[aria-label="رقم الجوال"]')?.getBoundingClientRect();
          const passwordRect = document.querySelector('input[aria-label="كلمة المرور"]')?.getBoundingClientRect();
          return {
            phoneRightOfPassword: Boolean(phoneRect && passwordRect && phoneRect.left > passwordRect.left),
            phoneAbovePassword: Boolean(phoneRect && passwordRect && phoneRect.top < passwordRect.top),
            pathname: location.pathname,
            rtl: document.documentElement.dir,
            width: innerWidth,
            overflow: document.documentElement.scrollWidth > innerWidth + 1,
            title: words.includes("انضم إلى شركاء بثواني"),
            registerMode: words.includes("إنشاء حساب"),
            loginMode: words.includes("تسجيل الدخول"),
            cardTitle: words.includes("رقم الجوال وكلمة المرور فقط"),
            prematureName: Boolean(document.querySelector('input[aria-label="الاسم الكامل"]')),
            prematureEmail: Boolean(document.querySelector('input[type="email"]')),
            requiresDocumentPhoto: words.includes("أرفق صورة الوثيقة"),
            runtimeError: /(TransformError|Internal Server Error|Unable to resolve)/.test(words)
          };
        });
        console.log("PARTNER_APPLY_VIEW=" + JSON.stringify(report));
        assert.equal(report.pathname, "/apply");
        assert.equal(report.rtl, "rtl");
        assert.equal(report.title, true);
        assert.equal(report.cardTitle, true);
        assert.equal(report.prematureName, false);
        assert.equal(report.prematureEmail, false);
        if(size.width>=720)assert.equal(report.phoneRightOfPassword, true, "DESKTOP_RTL_FIELD_ORDER_INVERTED");
        else assert.equal(report.phoneAbovePassword, true, "MOBILE_FIELD_ORDER_INVERTED");
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
      const cardBox = await page.getByText("بيانات الحساب", { exact: true }).locator("..").boundingBox();
      assert.ok(cardBox && cardBox.width < 700 && cardBox.width > 250, "SIGNUP_CARD_NOT_CONSTRAINED");
      assert.equal(await page.locator('input[type="password"]').count(), 2, "REGISTER_PASSWORD_CONFIRMATION_MISSING");
      const phoneInput = page.getByLabel("رقم الجوال");
      const createAccount = page.getByRole("button", { name: "إنشاء حساب", exact: true });
      assert.equal(await createAccount.count(), 1, "DUPLICATED_REGISTER_ACTION");
      assert.equal(await page.getByRole("radio", { name: "إنشاء حساب" }).count(), 0, "REDUNDANT_ACCOUNT_MODE_TABS");
      assert.equal(await page.getByRole("button", { name: "العودة لتسجيل دخول الشريك" }).count(), 0, "REDUNDANT_RETURN_ACTION");
      assert.equal(await createAccount.isDisabled(), true, "REGISTER_SHOULD_NEED_COMPLETE_FORM");
      await phoneInput.fill("777123456");
      await page.getByLabel("كلمة المرور", { exact: true }).fill("12345678");
      assert.equal(await createAccount.isDisabled(), true, "PASSWORD_CONFIRMATION_REQUIRED");
      await page.getByLabel("تأكيد كلمة المرور", {exact:true}).fill("12345670");
      assert.equal(await createAccount.isDisabled(), true, "MISMATCHED_PASSWORD_CONFIRMATION_ACCEPTED");
      await page.getByText("كلمتا المرور غير متطابقتين. اضغط على رمز العين لمراجعة القيمتين.").waitFor({state:"visible"});
      await page.getByRole("button", {name:"إظهار كلمة المرور",exact:true}).click();
      assert.equal(await page.getByLabel("كلمة المرور", {exact:true}).evaluate(input=>input.type),"text","PASSWORD_SHOW_TOGGLE_FAILED");
      await page.getByRole("button", {name:"إظهار تأكيد كلمة المرور",exact:true}).click();
      assert.equal(await page.getByLabel("تأكيد كلمة المرور", {exact:true}).evaluate(input=>input.type),"text","CONFIRM_SHOW_TOGGLE_FAILED");
      await page.getByLabel("تأكيد كلمة المرور", {exact:true}).fill("12345678");
      assert.equal(await createAccount.isEnabled(), true, "VALID_REGISTRATION_FORM_NOT_READY");
      await page.getByText("كلمتا المرور متطابقتان.", {exact:true}).waitFor({state:"visible"});
      await page.getByRole("button", {name:"إخفاء كلمة المرور",exact:true}).click();
      assert.equal(await page.getByLabel("كلمة المرور", {exact:true}).evaluate(input=>input.type),"password","PASSWORD_HIDE_TOGGLE_FAILED");
      await page.getByRole("button", {name:"إخفاء تأكيد كلمة المرور",exact:true}).click();
      assert.equal(await page.getByLabel("تأكيد كلمة المرور", {exact:true}).evaluate(input=>input.type),"password","CONFIRM_HIDE_TOGGLE_FAILED");
      await phoneInput.fill("77");
      assert.equal(await createAccount.isDisabled(), true, "INVALID_REGISTER_PHONE_ACCEPTED");
      await phoneInput.fill("");
      await page.getByRole("button", { name: "لديك حساب؟ تسجيل الدخول" }).click();
      assert.equal(await page.locator('input[type="password"]').count(), 1, "LOGIN_PASSWORD_FIELD_MISSING");
      await phoneInput.fill("777123456");
      await page.getByLabel("كلمة المرور", { exact: true }).fill("");
      assert.equal(await page.getByRole("button", { name: "تسجيل الدخول", exact: true }).isDisabled(), true, "EMPTY_LOGIN_PASSWORD_ACCEPTED");
      // Existing Identity credentials are not constrained by the new-account password shape.
      await page.getByLabel("كلمة المرور", { exact: true }).fill("1234567");
      assert.equal(await page.getByRole("button", { name: "تسجيل الدخول", exact: true }).isEnabled(), true, "LEGACY_LOGIN_PASSWORD_BLOCKED");
      await page.getByLabel("كلمة المرور", { exact: true }).fill("12345678");
      assert.equal(await page.getByRole("button", { name: "تسجيل الدخول", exact: true }).isEnabled(), true, "VALID_LOGIN_FIELDS_NOT_READY");
      await page.getByRole("button", { name: "نسيت كلمة المرور؟" }).click();
      await page.getByText("استعادة كلمة المرور", { exact: true }).waitFor({ state: "visible" });
      assert.equal(await page.locator('input[type="password"]').count(), 0, "RECOVERY_PASSWORD_BEFORE_PROOF");
      const recoveryCode = page.getByRole("button", { name: "إرسال رمز الاستعادة" });
      assert.equal(await recoveryCode.isEnabled(), true, "RECOVERY_SHOULD_REUSE_LOGIN_PHONE");
      await phoneInput.fill("");
      assert.equal(await recoveryCode.isDisabled(), true, "RECOVERY_CODE_WITHOUT_PHONE");
      await phoneInput.fill("777123456");
      assert.equal(await recoveryCode.isEnabled(), true, "RECOVERY_CODE_VALID_PHONE");
      await page.getByRole("button", { name: "العودة لتسجيل الدخول" }).click();
      assert.equal(await page.locator('input[type="password"]').count(), 1, "RETURN_TO_LOGIN_MISSING_PASSWORD");
      await page.getByRole("button", { name: "ليس لديك حساب؟ إنشاء حساب" }).click();
      assert.equal(await page.locator('input[type="password"]').count(), 2, "REGISTER_PASSWORDS_NOT_VISIBLE");
      assert.equal(await createAccount.isDisabled(), true, "MODE_SWITCH_MUST_CLEAR_PREVIOUS_PASSWORD");
      console.log("PARTNER_SIGNUP_FLOW_LAYOUT=PASS");
      await page.goto("http://localhost:18102/", {waitUntil:"domcontentloaded"});
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
        await page.getByLabel("كلمة المرور", {exact:true}).waitFor({ state: "visible", timeout: 8000 });
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
