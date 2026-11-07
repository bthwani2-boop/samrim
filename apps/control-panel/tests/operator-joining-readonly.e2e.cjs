// Read-only proof in the existing authorized Chrome CDP profile.
// Do not log case names, phone numbers, actor IDs, response payloads, or tokens.
const assert = require("node:assert/strict");
const { chromium } = require("@playwright/test");

async function main() {
  const browser = await chromium.connectOverCDP(process.env.BTHWANI_BROWSER_CDP ?? "http://127.0.0.1:9222");
  let page;
  try {
    const context = browser.contexts().find((candidate) =>
      candidate.pages().some((tab) => tab.url().startsWith("http://localhost:13000/")));
    assert.ok(context, "AUTHORIZED_OPERATOR_CHROME_CONTEXT_REQUIRED");
    page = await context.newPage();
    const blockedWrites = [];
    page.on("request", (request) => {
      const method = request.method();
      const path = new URL(request.url()).pathname;
      if (!["GET", "HEAD", "OPTIONS"].includes(method) && /^\/(?:dsh|api\/partners)/.test(path)) {
        blockedWrites.push("unexpected mutation");
      }
    });
    const queueRead = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === "/api/partners/workbench" &&
        url.searchParams.get("kind") === "joining" &&
        response.request().method() === "GET";
    }, { timeout: 25000 });
    await page.goto("http://localhost:13000/partners?view=joining", { waitUntil: "domcontentloaded", timeout: 25000 });
    const queueResponse = await queueRead;
    assert.equal(queueResponse.status(), 200, "JOINING_QUEUE_CANONICAL_READ_FAILED");
    const payload = await queueResponse.json();
    assert.ok(Array.isArray(payload?.rows), "JOINING_ROWS_MISSING");
    assert.ok(payload.rows.length <= 50, "JOINING_ROWS_UNBOUNDED");
    assert.ok(payload.rows.every((row) => row?.kind === "joining"), "JOINING_QUEUE_WRONG_KIND");
    assert.equal(typeof payload.nextCursor, "string", "JOINING_QUEUE_CURSOR_MISSING");
    console.log("OPERATOR_JOINING_API_READBACK=PASS rows=" + payload.rows.length +
      " more=" + Boolean(payload.nextCursor));
    await page.getByText("طلبات الانضمام", { exact: true }).first().waitFor({ state: "visible", timeout: 20000 });
    await page.locator("#partner-unified-search").waitFor({ state: "visible", timeout: 18000 });
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 844 });
      const state = await page.evaluate(() => {
        const body = document.body.innerText || "";
        return {
          path: location.pathname,
          rtl: document.documentElement.dir === "rtl",
          joiningQueue: body.includes("طلبات الانضمام"),
          searchable: Boolean(document.querySelector("#partner-unified-search")),
          reviewAvailable: body.includes("مراجعة الطلب") || body.includes("سجلًا في الصفحة"),
          accessDenied: body.includes("ليس لديك صلاحية"),
          overflow: document.documentElement.scrollWidth > window.innerWidth + 2,
        };
      });
      console.log("OPERATOR_JOINING_VIEW=" + JSON.stringify({ width, ...state }));
      assert.equal(state.path, "/partners");
      assert.equal(state.rtl, true);
      assert.equal(state.joiningQueue, true);
      assert.equal(state.searchable, true);
      assert.equal(state.accessDenied, false);
      assert.equal(state.overflow, false);
    }
    assert.deepEqual(blockedWrites, [], "READ_ONLY_PROBE_MUST_NOT_WRITE");
    console.log("OPERATOR_JOINING_READONLY=PASS");
  } finally {
    if (page) await page.close().catch(() => {});
    await browser.close();
  }
}
main().catch((error) => {
  console.error("OPERATOR_JOINING_READONLY=FAIL " + String(error?.message || error).slice(0, 180));
  process.exitCode = 1;
});
