const assert=require("node:assert/strict");
const {chromium}=require("@playwright/test");

function verify(data,scope){
  assert.equal(data.storeId,scope,"Store scope mismatch");
  for(const key of ["contentCount","impressions","clicks","attributedOrdersCreated"]){
    assert.ok(Number.isSafeInteger(data[key]) && data[key]>=0,"invalid "+key);
  }
  assert.equal(Object.hasOwn(data,"clientActorId"),false);
  assert.equal(Object.hasOwn(data,"customerPhone"),false);
}

async function main(){
  const browser=await chromium.connectOverCDP("http://127.0.0.1:9223");
  let operator,partner;
  try {
    const context=browser.contexts().find(c=>c.pages().some(p=>p.url().startsWith("http://localhost:13000")))??browser.contexts()[0];
    assert.ok(context,"EXISTING_BROWSER_SESSION_REQUIRED");
    operator=await context.newPage();
    await operator.goto("http://localhost:13000/partners?tab=directory",{waitUntil:"domcontentloaded",timeout:28000});
    const rows=operator.locator('tr[data-kind="store"]');
    await rows.first().waitFor({state:"visible",timeout:20000});
    const count=await rows.count();
    await rows.first().locator("td").first().click();
    await operator.waitForURL(url=>Boolean(url.searchParams.get("inspect")),{timeout:14000});
    const firstStore=new URL(operator.url()).searchParams.get("inspect");
    assert.ok(firstStore);
    const readOperator=operator.waitForResponse(r=>r.url().includes("/api/stores/")&&r.url().endsWith("/marketing/summary"),{timeout:20000});
    await operator.getByRole("tab",{name:"المنتجات والعروض"}).click();
    const operatorResponse=await readOperator;
    assert.equal(operatorResponse.status(),200,"authorized operator Store marketing read");
    verify(await operatorResponse.json(),firstStore);
    let secondStore="";
    if(count>1){
      await operator.goto("http://localhost:13000/partners?tab=directory",{waitUntil:"domcontentloaded",timeout:25000});
      await operator.locator('tr[data-kind="store"]').nth(1).waitFor({state:"visible",timeout:20000});
      await operator.locator('tr[data-kind="store"]').nth(1).locator("td").first().click();
      await operator.waitForURL(url=>Boolean(url.searchParams.get("inspect")),{timeout:14000});
      secondStore=new URL(operator.url()).searchParams.get("inspect")||"";
    }

    const partnerContext=browser.contexts().find(c=>c.pages().some(p=>p.url().startsWith("http://localhost:18102")))??browser.contexts()[0];
    partner=await partnerContext.newPage();
    const readPartner=partner.waitForResponse(r=>r.url().includes("/dsh/partner/stores/")&&r.url().endsWith("/discovery-content/summary"),{timeout:23000});
    await partner.goto("http://localhost:18102/store?section=promotions&view=overview",{waitUntil:"domcontentloaded",timeout:28000});
    const partnerResponse=await readPartner;
    assert.equal(partnerResponse.status(),200,"authorized partner content summary read");
    const parts=new URL(partnerResponse.url()).pathname.split("/");
    const partnerStore=decodeURIComponent(parts[parts.indexOf("stores")+1]||"");
    assert.ok(partnerStore);
    verify(await partnerResponse.json(),partnerStore);

    let crossStoreDenial="NOT_RUN_NO_SECOND_STORE";
    const foreign=secondStore&&secondStore!==partnerStore?secondStore:firstStore!==partnerStore?firstStore:"";
    if(foreign){
      const headers=await partnerResponse.request().allHeaders();
      assert.ok(headers.authorization?.startsWith("Bearer "),"partner session token unavailable for scoped read");
      const denied=await partnerContext.request.get(
        "http://127.0.0.1:18080/dsh/partner/stores/"+encodeURIComponent(foreign)+"/discovery-content/summary",
        {headers:{Authorization:headers.authorization},timeout:15000}
      );
      crossStoreDenial=String(denied.status());
      assert.equal(denied.status(),403,"cross-Store data must not be readable");
    }
    console.log("STORE_MARKETING_SUMMARY_LIVE=PASS "+JSON.stringify({operatorStatus:operatorResponse.status(),partnerStatus:partnerResponse.status(),crossStoreDenial}));
  } finally {
    if(operator)await operator.close().catch(()=>{});
    if(partner)await partner.close().catch(()=>{});
    await browser.close();
  }
}
main().catch(e=>{console.error("STORE_MARKETING_SUMMARY_LIVE=FAIL "+String(e.stack||e).slice(0,2200));process.exitCode=1});
