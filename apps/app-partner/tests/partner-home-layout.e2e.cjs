const assert=require("node:assert/strict");
const {chromium}=require("@playwright/test");

async function main(){
  const browser=await chromium.connectOverCDP("http://127.0.0.1:9223");
  let page;
  try{
    const context=browser.contexts().find(c=>c.pages().some(p=>p.url().startsWith("http://localhost:18102")));
    assert.ok(context,"PARTNER_EDGE_CONTEXT_REQUIRED");
    page=await context.newPage();
    const errors=[];
    page.on("pageerror",error=>errors.push(String(error.message).slice(0,160)));
    page.on("console",msg=>{if(msg.type()==="error"&&/(TypeError|ReferenceError|SyntaxError)/.test(msg.text()))errors.push(msg.text().slice(0,160))});
    for(const width of [1360,1024,390]){
      await page.setViewportSize({width,height:860});
      await page.goto("http://localhost:18102/more",{waitUntil:"domcontentloaded",timeout:23000});
      const expected=width>=1024 ? "تجهيز المتجر وتشغيله" : "الحساب والتفضيلات";
      await page.getByText(expected,{exact:true}).first().waitFor({state:"visible",timeout:19000});
      if(width>=1024){
        await page.getByText("أحدث الطلبات",{exact:true}).first().waitFor({state:"visible",timeout:13000});
        await page.getByText("الطلبات حسب الحالة",{exact:true}).first().waitFor({state:"visible",timeout:13000});
        await page.getByText("اتجاه الطلبات الأخيرة",{exact:true}).first().waitFor({state:"visible",timeout:13000});
      }
      const snap=await page.evaluate(()=>{
        const sidebar=document.querySelector('[aria-label="التنقل الرئيسي للشريك"]');
        const box=sidebar?.getBoundingClientRect();
        const body=document.body.innerText||"";
        return {route:location.pathname,rtl:document.documentElement.dir,width:innerWidth,
          sidebarAtRight:box?Math.abs(box.right-innerWidth)<6:null,
          sidebarWidth:box?Math.round(box.width):0,
          hasStockAttention:body.includes("متابعة المخزون"),
          hasSetup:body.includes("تجهيز المتجر وتشغيله"),
          hasRecentOrders:body.includes("أحدث الطلبات"),
          hasSummary:body.includes("الطلبات حسب الحالة"),
          hasTrend:body.includes("اتجاه الطلبات الأخيرة"),
          hasShopLink:body.includes("نسخ رابط المتجر")||body.includes("نسخ رابط المعاينة"),
          overflow:document.documentElement.scrollWidth>innerWidth+2,
          hasRuntimeError:/(TransformError|SyntaxError|Unable to resolve|Internal Server Error)/.test(body),
          documentHeight:document.documentElement.scrollHeight};
      });
      console.log("HOME_VIEWPORT "+JSON.stringify(snap));
      assert.equal(snap.route,"/more");assert.equal(snap.rtl,"rtl");assert.equal(snap.overflow,false);assert.equal(snap.hasRuntimeError,false);
      if(width>=1024){
        assert.equal(snap.sidebarAtRight,true);
        assert.equal(snap.hasSetup,true);
        assert.equal(snap.hasRecentOrders,true);
        assert.equal(snap.hasTrend,true);
        assert.equal(snap.hasSummary,true);
      }else assert.equal(snap.sidebarAtRight,null);
      if(width===1360)await page.screenshot({path:"D:\\samrim-FILING\\BTHWANI-PARTNER-HOME-20261031-TOP.png",fullPage:false});
      if(width===1360)await page.screenshot({path:"D:\\samrim-FILING\\BTHWANI-PARTNER-HOME-20261031-FULL.png",fullPage:true});
    }
    assert.equal(errors.length,0,"SCRIPT_ERRORS "+JSON.stringify(errors));
    console.log("PARTNER_HOME_E2E=PASS");
  }finally{
    if(page)await page.close().catch(()=>{});
    await browser.close();
  }
}
main().catch(e=>{console.error("PARTNER_HOME_E2E=FAIL "+String(e?.message||e).slice(0,540));process.exitCode=1});
