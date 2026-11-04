"use strict";
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const origin = "http://localhost:18102";
const item = "حامل هاتف للسيارة - تجريبي 20261104";
const action = process.env.BTHWANI_LOCAL_DEMO_ACTION || "inspect";
if (!["inspect","create-publish"].includes(action)) throw Error("INVALID_DEMO_ACTION");
async function main(){
 // Enforce the repository's authorized Chrome-profile and signed-in page gate
 // before attaching Playwright or allowing any Partner mutation.
 const repo = path.resolve(__dirname, "../../..");
 const gate = spawnSync("pwsh", [
  "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
  path.join(repo, "tools", "dev", "Start-BrowserAutomation.ps1"),
  "-Url", origin + "/products",
  "-VerifyAuthenticated", "-RequireSelector",
  'button:has-text("إضافة منتج")',
 ], { cwd: repo, encoding: "utf8", timeout: 60000, windowsHide: true });
 if (gate.error || gate.status !== 0) throw new Error("PARTNER_SITE_AUTHENTICATION_REQUIRED");
 const { chromium } = require("@playwright/test");
 const browser=await chromium.connectOverCDP("http://127.0.0.1:9222");
 const context=browser.contexts()[0];assert.ok(context,"AUTHENTICATED_CHROME_CONTEXT_REQUIRED");
 const page=await context.newPage();
 try{
  await page.goto(origin+"/products",{waitUntil:"domcontentloaded",timeout:25000});
  await page.getByRole("button",{name:"إضافة منتج"}).waitFor({state:"visible",timeout:18000});
  assert.equal(await page.getByText("تقنية صنعاء التجريبية",{exact:true}).count()>0,true,"TEST_STORE_OWNER_REQUIRED");
  await page.getByRole("button",{name:"تعديل سعر شاحن USB-C بقدرة 25 واط"}).waitFor({state:"visible",timeout:18000});
  if(action==="inspect"){
   await page.getByRole("button",{name:"إخفاء "+item,exact:true}).waitFor({state:"visible",timeout:18000});
   console.log("DEMO_OFFER=PASS_READONLY_OWNER_READBACK");
  } else {
  const itemVisible=page.getByText(item,{exact:true});
  if(!(await itemVisible.count())){
   await page.getByRole("button",{name:"إضافة منتج"}).click();
   await page.getByRole("textbox",{name:"اسم منتج المتجر"}).fill(item);
   await page.getByRole("textbox",{name:"سعر المنتج الجديد بالريال اليمني"}).fill("1900");
   await page.getByRole("textbox",{name:"وصف منتج المتجر"}).fill("عرض تجريبي محلي لا يمثل سلعة متاحة للبيع خارج بيئة التطوير.");
   await page.getByRole("button",{name:"إكسسوارات الهواتف",exact:true}).click();
   const save=page.getByRole("button",{name:"إنشاء منتج المتجر"});
   assert.equal(await save.isEnabled(),true,"PRODUCT_FORM_INVALID");
   await save.click();
   const feedback=page.getByText("تم إنشاء المنتج وعرض سعره كمسودة",{exact:false});
   await feedback.waitFor({state:"visible",timeout:25000});
   console.log("DEMO_PRODUCT=CREATED_VIA_PARTNER_DSH");
  }else console.log("DEMO_PRODUCT=ALREADY_EXISTS");
  await page.goto(origin+"/products",{waitUntil:"domcontentloaded",timeout:25000});
  await page.getByText(item,{exact:true}).waitFor({state:"visible",timeout:18000});
  const publish=page.getByRole("button",{name:"نشر "+item,exact:true});
  if(await publish.count()){
   await publish.click();
   await page.getByRole("button",{name:"إخفاء "+item,exact:true}).waitFor({state:"visible",timeout:20000});
   console.log("DEMO_OFFER=PUBLISHED_VIA_PARTNER_DSH");
  }else{
   assert.ok(await page.getByRole("button",{name:"إخفاء "+item,exact:true}).count(),"PUBLISHED_READBACK_REQUIRED");
   console.log("DEMO_OFFER=ALREADY_PUBLISHED");
  }
  await page.reload({waitUntil:"domcontentloaded",timeout:25000});
  await page.getByRole("button",{name:"إخفاء "+item,exact:true}).waitFor({state:"visible",timeout:20000});
  assert.ok((await page.getByText(item,{exact:true}).count())>0,"CANONICAL_OFFER_ITEM_NOT_VISIBLE");
  console.log("DEMO_OFFER=PASS_PUBLISHED_OWNER_READBACK");
  }
  await page.goto("http://localhost:18101/orders",{waitUntil:"domcontentloaded",timeout:25000});
  await page.getByLabel("طلباتي",{exact:true}).waitFor({state:"visible",timeout:13000});
  await page.goto("http://localhost:18101/home",{waitUntil:"domcontentloaded",timeout:25000});
  const searchTrigger=page.getByPlaceholder("ابحث عن متجر أو منتج");
  await searchTrigger.click();
  await page.getByRole("button",{name:"المنتجات",exact:true}).click();
  const responsePromise=page.waitForResponse(r=>{
    const url=new URL(r.url());
    return r.request().method()==="GET" && url.pathname==="/dsh/public/catalog/search" && url.searchParams.get("q")===item;
  },{timeout:18000});
  await page.getByPlaceholder("ابحث عن متجر أو منتج").fill(item);
  const publicResponse=await responsePromise;
  assert.equal(publicResponse.ok(),true,"PUBLIC_SEARCH_HTTP_FAILURE");
  const publicPayload=await publicResponse.json();
  const matches=(publicPayload?.offers||[]).filter(x=>x.productName===item && x.storeName==="تقنية صنعاء التجريبية");
  assert.ok(matches.length>0,"PUBLIC_SEARCH_CANONICAL_OFFER_MISSING");
  await page.getByRole("button",{name:"عرض "+item+" من تقنية صنعاء التجريبية",exact:true}).first().waitFor({state:"visible",timeout:16000});
  console.log("DEMO_OFFER=PASS_CLIENT_DSH_SEARCH_READBACK");

 }finally{await page.close().catch(()=>{});await browser.close();}
}
main().catch(e=>{console.error("DEMO_OFFER=FAIL "+String(e.message).slice(0,300));process.exitCode=1});
