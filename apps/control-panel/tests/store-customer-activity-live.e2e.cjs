const assert = require("node:assert/strict");
const { chromium, expect } = require("@playwright/test");

async function main() {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9223", {timeout: 40000});
  let operator, partner;
  try {
    const origin = "http://localhost:13000";
    const operatorContext = browser.contexts().find(c => c.pages().some(p => p.url().startsWith(origin))) ?? browser.contexts()[0];
    assert.ok(operatorContext, "EXISTING_OPERATOR_SESSION_REQUIRED");
    operator = await operatorContext.newPage();
    await operator.goto(origin + "/partners?tab=directory", {waitUntil: "domcontentloaded", timeout: 25000});
    const storeRow = operator.locator('tr[data-kind="store"]').first();
    await storeRow.waitFor({state: "visible", timeout: 18000});
    await storeRow.locator("td").first().click();
    await operator.waitForURL(url=>Boolean(url.searchParams.get("inspect")), {timeout: 12000});
    const storeId = new URL(operator.url()).searchParams.get("inspect");
    assert.ok(storeId);
    const customerTab = operator.getByRole("tab", {name: "العملاء والجودة"});
    await customerTab.waitFor({state: "visible", timeout: 15000});
    // The inspector mounts while it still reads its canonical store and owner data.
    // A visible tab is not yet proof that the authenticated inspector is interactive.
    await operator.waitForLoadState("networkidle", {timeout: 15000});
    const responsePromise = operator.waitForResponse(r => r.url().includes("/api/stores/") && r.url().includes("/orders/summary?"), {timeout: 18000});
    await customerTab.click();
    await expect(customerTab).toHaveAttribute("aria-selected", "true", {timeout: 5000});
    const response = await responsePromise;
    assert.equal(response.status(), 200);
    const data = await response.json();
    assert.equal(data.summary.storeId, storeId);
    assert.equal(data.summary.period, "30d");
    assert.ok(Number.isSafeInteger(data.summary.completedCustomers));
    assert.ok(Number.isSafeInteger(data.summary.returningCustomers));
    assert.ok(data.summary.returningCustomers <= data.summary.completedCustomers);
    assert.equal(Object.hasOwn(data.summary, "clientActorId"), false);
    const partnerContext = browser.contexts().find(c => c.pages().some(p => p.url().startsWith("http://localhost:18102"))) ?? browser.contexts()[0];
    partner = await partnerContext.newPage();
    const partnerPromise = partner.waitForResponse(r=>r.url().includes("/dsh/partner/stores/") && r.url().includes("/orders/summary?"), {timeout:25000});
    await partner.goto("http://localhost:18102/insights?view=orders", {waitUntil: "domcontentloaded", timeout:28000});
    const partnerResponse = await partnerPromise;
    assert.equal(partnerResponse.status(), 200);
    const partnerBody = await partnerResponse.json();
    const partnerStoreId = decodeURIComponent(new URL(partnerResponse.url()).pathname.split("/").at(-3) || "");
    assert.ok(partnerStoreId);
    assert.equal(partnerBody.summary.storeId, partnerStoreId);
    assert.ok(Number.isSafeInteger(partnerBody.summary.completedCustomers));
    assert.ok(Number.isSafeInteger(partnerBody.summary.returningCustomers));
    assert.ok(partnerBody.summary.returningCustomers <= partnerBody.summary.completedCustomers);
    console.log("STORE_CUSTOMER_ACTIVITY_LIVE=PASS " + JSON.stringify({
      operatorStatus: response.status(), operatorStore: "scoped", operatorCompleted: data.summary.completedCustomers,
      partnerStatus: partnerResponse.status(), partnerStore: "scoped", partnerCompleted: partnerBody.summary.completedCustomers
    }));
  } finally {
    if (operator) await operator.close().catch(()=>{});
    if (partner) await partner.close().catch(()=>{});
    await browser.close();
  }
}
main().catch(error => {console.error("STORE_CUSTOMER_ACTIVITY_LIVE=FAIL " + String(error.stack||error).slice(0,1600));process.exitCode=1});
