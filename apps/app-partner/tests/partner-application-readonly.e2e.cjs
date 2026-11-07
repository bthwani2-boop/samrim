// Read-only Expo Web proof. A fresh CDP browser context deliberately contains
// no existing Partner/Client cookies or local storage. Never submit auth forms.
const assert = require("node:assert/strict");
const { chromium } = require("@playwright/test");

async function proof() {
 const browser=await chromium.connectOverCDP(process.env.BTHWANI_BROWSER_CDP??"http://127.0.0.1:9222");
 const context=await browser.newContext({locale:"ar-YE"});
 try {
  const page=await context.newPage();
  const errors=[];
  page.on("pageerror",e=>errors.push(String(e?.message||e).slice(0,160)));
  const response=await page.goto("http://localhost:18102/apply",{waitUntil:"domcontentloaded",timeout:30000});
  assert.ok(response&&response.status()<400,"PARTNER_APPLY_UNAVAILABLE");
  await page.getByText("إنشاء حساب شريك",{exact:true}).waitFor({state:"visible",timeout:20000});
  for(const size of [{width:1280,height:840},{width:390,height:844}]){
   await page.setViewportSize(size);
   await page.waitForTimeout(500);
   const view=await page.evaluate(()=>{
    const phone=document.querySelector('input[aria-label="رقم الجوال"]')?.getBoundingClientRect();
    const password=document.querySelector('input[aria-label="كلمة المرور"]')?.getBoundingClientRect();
    const text=document.body.innerText||"";
    return {
     path:location.pathname,rtl:document.documentElement.dir,
     overflow:document.documentElement.scrollWidth>innerWidth+2,
     heading:text.includes("إنشاء حساب شريك"),
     joiningRequest:text.includes("طلب انضمام"),
     phoneRight:Boolean(phone&&password&&phone.left>password.left),
     phoneAbove:Boolean(phone&&password&&phone.top<password.top),
     nameField:Boolean(document.querySelector('input[aria-label="الاسم الكامل"]')),
     emailField:Boolean(document.querySelector('input[type="email"]')),
    };
   });
   console.log("DIRECT_PARTNER_REGISTER_VIEW="+JSON.stringify({width:size.width,...view}));
   assert.equal(view.path,"/apply");
   assert.equal(view.rtl,"rtl");
   assert.equal(view.heading,true);
   assert.equal(view.joiningRequest,false);
   assert.equal(view.overflow,false);
   assert.equal(view.nameField,false);
   assert.equal(view.emailField,false);
   assert.equal(size.width>=720?view.phoneRight:view.phoneAbove,true,"PHONE_FIELD_ORDER_INVALID");
  }
  const phone=page.getByLabel("رقم الجوال",{exact:true});
  const password=page.getByLabel("كلمة المرور",{exact:true});
  const confirmation=page.getByLabel("تأكيد كلمة المرور",{exact:true});
  const create=page.getByRole("button",{name:"إنشاء حساب",exact:true});
  assert.equal(await create.count(),1);
  assert.equal(await create.isDisabled(),true);
  await phone.fill("777123456");
  await password.fill("12345678");
  await confirmation.fill("12345670");
  assert.equal(await create.isDisabled(),true,"MISMATCHED_PASSWORD_ENABLED");
  await page.getByRole("button",{name:"إظهار كلمة المرور"}).click();
  assert.equal(await password.evaluate(node=>node.type),"text");
  await page.getByRole("button",{name:"إخفاء كلمة المرور"}).click();
  assert.equal(await password.evaluate(node=>node.type),"password");
  await confirmation.fill("12345678");
  assert.equal(await create.isEnabled(),true,"VALID_FORM_DISABLED");
  await phone.fill("77");
  assert.equal(await create.isDisabled(),true,"INVALID_PHONE_ENABLED");
  await page.getByRole("button",{name:"لديك حساب؟ تسجيل الدخول"}).click();
  await page.getByText("تسجيل الدخول",{exact:true}).first().waitFor({state:"visible"});
  assert.equal(await page.locator('input[type="password"]').count(),1);
  await phone.fill("777123456");
  assert.equal(await page.getByRole("button",{name:"تسجيل الدخول",exact:true}).isDisabled(),true);
  await password.fill("12345678");
  assert.equal(await page.getByRole("button",{name:"تسجيل الدخول",exact:true}).isEnabled(),true);
  await page.getByRole("button",{name:"نسيت كلمة المرور؟"}).click();
  await page.getByText("استعادة كلمة المرور",{exact:true}).first().waitFor({state:"visible"});
  assert.equal(await page.locator('input[type="password"]').count(),0);
  assert.equal(await page.getByRole("button",{name:"إرسال رمز الاستعادة"}).isEnabled(),true);
  await page.getByRole("button",{name:"العودة لتسجيل الدخول"}).click();
  await page.getByRole("button",{name:"ليس لديك حساب؟ إنشاء حساب"}).click();
  assert.equal(await create.isDisabled(),true,"MODE_SWITCH_MUST_CLEAR_CREDENTIALS");
  console.log("DIRECT_PARTNER_REGISTER_READONLY=PASS");
  if(process.env.BTHWANI_CAPTURE_SIGNUP_QA==="1"){
   const fs=require("node:os"),path=require("node:path");
   await page.screenshot({path:path.join(fs.tmpdir(),"BTHWANI_DIRECT_PARTNER_REGISTER.png"),fullPage:true});
  }
  await page.goto("http://localhost:18102/setup",{waitUntil:"domcontentloaded",timeout:25000});
  await page.waitForURL(url=>new URL(url).pathname==="/",{timeout:18000});
  console.log("DIRECT_PARTNER_UNAUTHENTICATED_SETUP_REDIRECT=PASS");
  assert.equal(errors.length,0,"EXPO_WEB_RENDER_ERRORS");
 }finally{await context.close();await browser.close()}
}
proof().catch(e=>{console.error("DIRECT_PARTNER_REGISTER_READONLY=FAIL "+String(e.message||e).slice(0,240));process.exitCode=1});
