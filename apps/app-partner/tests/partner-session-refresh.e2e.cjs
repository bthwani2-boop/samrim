const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { chromium } = require("@playwright/test");

const api = "http://localhost:18082";
const app = "http://localhost:18102";
const origin = app;

async function run() {
  // Only the already-configured local development actor is used. Never create or reset real accounts.
  const clientInstanceId = randomUUID();
  const response = await fetch("http://127.0.0.1:18082/auth/development/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role: "partner", clientInstanceId }),
  });
  if (!response.ok) {
    console.log("PARTNER_SESSION_E2E=BLOCKED_DEV_ACTOR status=" + response.status);
    process.exitCode = 2;
    return;
  }
  const pair = await response.json();
  assert.equal(pair.identity.role, "partner");
  assert.equal(pair.identity.surface, "app-partner");
  let browser;
  let context;
  try {
    browser = await chromium.launch({ channel: "msedge", headless: true });
    context = await browser.newContext({ viewport: { width: 1280, height: 820 } });
    await context.addCookies([
      { url: api, name: "bt_partner_web_refresh", value: pair.refreshToken, httpOnly: true, sameSite: "Strict", expires: Math.floor(Date.now() / 1000) + 3600 },
      { url: api, name: "bt_partner_web_device", value: clientInstanceId, httpOnly: true, sameSite: "Strict", expires: Math.floor(Date.now() / 1000) + 3600 },
    ]);
    const page = await context.newPage();
    const statuses = [];
    page.on("response", response => {
      if (response.url().includes("/auth/web/partner/session")) statuses.push(response.status());
    });
    await page.goto(app + "/orders", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => location.pathname === "/orders" && document.body.innerText.includes("الطلبات"), { timeout: 30000 });
    assert.equal(page.url().split("?")[0], app + "/orders");
    assert.equal(await page.getByText("تسجيل الدخول").count(), 0, "login appeared after cookie restore");

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => location.pathname === "/orders" && document.body.innerText.includes("الطلبات"), { timeout: 30000 });
    assert.equal(await page.getByText("تسجيل الدخول").count(), 0, "F5 caused a new login");
    assert.ok(statuses.filter(status => status === 200).length >= 2, "session was not restored after reload");

    const wrong = await context.request.post(api + "/auth/web/partner/session", { headers: { Origin: "http://localhost:18101" } });
    assert.equal(wrong.status(), 403, "other allowed app must not restore Partner session");

    const logout = await context.request.post(api + "/auth/web/partner/logout", {
      headers: { Origin: origin, Authorization: "Bearer " + pair.accessToken },
    });
    assert.equal(logout.status(), 204, "logout failed");
    const cookies = await context.cookies(api);
    assert.ok(!cookies.some(c => c.name.startsWith("bt_partner_web_")), "logout retained Partner cookies");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByText("تسجيل الدخول").waitFor({ timeout: 30000 });
    console.log("PARTNER_SESSION_E2E=PASS restore=200 reload=200 wrong-origin=403 logout=204 post-logout=signed-out");
  } finally {
    if (context) {
      // Best-effort cleanup of the test-owned browser session.
      try { await context.request.post(api + "/auth/web/partner/logout", { headers: { Origin: origin } }); } catch {}
    }
    if (browser) await browser.close();
  }
}
run().catch(err => { console.error("PARTNER_SESSION_E2E=FAIL " + (err && err.message || "unknown")); process.exitCode = 1; });
