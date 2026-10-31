const { chromium } = require("@playwright/test");
(async () => {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
  const context = browser.contexts()[0];
  const page = context?.pages().find(page => page.url().startsWith("http://localhost:18102/"));
  if (!page) { console.log("PARTNER_TAB=NOT_FOUND"); return; }
  const details = await page.evaluate(() => {
    const inputs = [...document.querySelectorAll("input")];
    const password = inputs.find(e => e.type === "password");
    const phone = inputs.find(e => e.type === "tel" || e.inputMode === "tel" || e.autocomplete === "tel") || inputs[0];
    return {
      pathname: location.pathname,
      loginVisible: document.body.innerText.includes("تسجيل الدخول"),
      phoneFilled: Boolean(phone?.value?.trim()),
      passwordFilled: Boolean(password?.value),
      authenticationPanelVisible: document.body.innerText.includes("رقم الجوال") && document.body.innerText.includes("كلمة المرور"),
      rtl: document.documentElement.dir,
    };
  });
  const cookieNames = (await context.cookies("http://localhost:18082")).map(c => c.name).filter(n => n.includes("partner_web"));
  console.log("PARTNER_TAB=" + JSON.stringify({ ...details, sessionCookieNames: cookieNames }));
})().catch(e => { console.log("PARTNER_TAB=BLOCKED " + String(e.message).slice(0, 200)); process.exitCode = 2; });
