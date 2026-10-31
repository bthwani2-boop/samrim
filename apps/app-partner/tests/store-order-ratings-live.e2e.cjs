const assert = require("node:assert/strict");
const { chromium } = require("@playwright/test");

async function run() {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
  let operatorPage, partnerPage;
  try {
    const origin = "http://localhost:13000";
    const operatorContext = browser.contexts().find(c => c.pages().some(p => p.url().startsWith(origin))) ?? browser.contexts()[0];
    assert.ok(operatorContext, "EXISTING_OPERATOR_CONTEXT_REQUIRED");
    operatorPage = await operatorContext.newPage();
    await operatorPage.setViewportSize({ width: 1360, height: 850 });
    await operatorPage.goto(origin + "/partners?tab=directory", { waitUntil: "domcontentloaded", timeout: 25000 });
    const rows = operatorPage.locator('tr[data-kind="store"]');
    await rows.first().waitFor({state: "visible", timeout: 17000});
    const storeCount = await rows.count();
    await rows.first().locator("td").first().click();
    await operatorPage.waitForURL(url=>Boolean(url.searchParams.get("inspect")),{timeout:12000});
    const ownedOperatorStore = new URL(operatorPage.url()).searchParams.get("inspect");
    assert.ok(ownedOperatorStore,"OPERATOR_INSPECTED_STORE_REQUIRED");
    await operatorPage.getByRole("tab", {name:"العملاء والجودة"}).click();
    const operatorResult = await operatorPage.waitForResponse(r => r.url().includes("/api/stores/") && r.url().includes("/ratings?"), {timeout:18000});
    assert.equal(operatorResult.status(),200,"authorized operator Store ratings read");
    const operatorPageData = await operatorResult.json();
    assert.ok(Array.isArray(operatorPageData.ratings));
    assert.ok(operatorPageData.ratings.every(item => item.storeId === ownedOperatorStore));
    assert.ok(operatorPageData.ratings.every(item => !Object.prototype.hasOwnProperty.call(item,"clientActorId")));

    let foreignStore = "";
    if (storeCount > 1) {
      await operatorPage.goto(origin+"/partners?tab=directory",{waitUntil:"domcontentloaded",timeout:25000});
      await operatorPage.locator('tr[data-kind="store"]').nth(1).waitFor({state:"visible",timeout:17000});
      await operatorPage.locator('tr[data-kind="store"]').nth(1).locator("td").first().click();
      await operatorPage.waitForURL(url=>Boolean(url.searchParams.get("inspect")),{timeout:12000});
      foreignStore = new URL(operatorPage.url()).searchParams.get("inspect") || "";
    }

    const partnerContext = browser.contexts().find(c => c.pages().some(p => p.url().startsWith("http://localhost:18102"))) ?? browser.contexts()[0];
    assert.ok(partnerContext,"EXISTING_PARTNER_CONTEXT_REQUIRED");
    partnerPage = await partnerContext.newPage();
    await partnerPage.setViewportSize({width:1360,height:850});
    const partnerRead = partnerPage.waitForResponse(r => r.url().includes("/dsh/partner/stores/") && r.url().includes("/ratings?"),{timeout:25000});
    await partnerPage.goto("http://localhost:18102/insights?view=ratings", {waitUntil:"domcontentloaded",timeout:27000});
    const response = await partnerRead;
    assert.equal(response.status(),200,"authorized partner ratings read");
    const partnerData = await response.json();
    const path = new URL(response.url()).pathname.split("/");
    const authorizedStore = decodeURIComponent(path[path.indexOf("stores")+1]||"");
    assert.ok(authorizedStore);
    assert.ok(Array.isArray(partnerData.ratings));
    assert.ok(partnerData.ratings.every(item=>item.storeId===authorizedStore));
    assert.ok(partnerData.ratings.every(item=>!Object.prototype.hasOwnProperty.call(item,"clientActorId")));

    let isolation = "NOT_RUN_NO_SECOND_STORE";
    if (foreignStore && foreignStore !== authorizedStore) {
      const authHeader = (await response.request().allHeaders()).authorization;
      assert.ok(authHeader && authHeader.startsWith("Bearer "),"PARTNER_AUTHORIZATION_HEADER_REQUIRED");
      const denied = await partnerContext.request.get(
        "http://127.0.0.1:18080/dsh/partner/stores/"+encodeURIComponent(foreignStore)+"/ratings?limit=1",
        {headers:{Authorization:authHeader},timeout:15000}
      );
      isolation = String(denied.status());
      assert.equal(denied.status(),403,"partner must not read another actual Store");
    }
    console.log("STORE_ORDER_RATINGS_LIVE=PASS "+JSON.stringify({
      operatorStatus:operatorResult.status(),
      partnerStatus:response.status(),
      operatorRows:operatorPageData.ratings.length,
      partnerRows:partnerData.ratings.length,
      crossStoreDenial:isolation
    }));
  } finally {
    if (operatorPage) await operatorPage.close().catch(()=>{});
    if (partnerPage) await partnerPage.close().catch(()=>{});
    await browser.close();
  }
}
run().catch(error=>{console.error("STORE_ORDER_RATINGS_LIVE=FAIL "+String(error.stack||error).slice(0,1600));process.exitCode=1;});
