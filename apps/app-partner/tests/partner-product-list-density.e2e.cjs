const assert = require("node:assert/strict");
const { chromium } = require("@playwright/test");

// Read-only catalog scan geometry; no inventory or price controls are activated.
async function main() {
  const browser = await chromium.connectOverCDP(process.env.BTHWANI_BROWSER_CDP ?? "http://127.0.0.1:9222");
  let page;
  try {
    const context = browser.contexts().find(c =>
      c.pages().some(p => p.url().startsWith("http://localhost:18102/")));
    assert.ok(context, "AUTHORIZED_PARTNER_CONTEXT_REQUIRED");
    page = await context.newPage();
    for (const width of [1360, 390]) {
      await page.setViewportSize({ width, height: 850 });
      await page.goto("http://localhost:18102/products", {
        waitUntil: "domcontentloaded", timeout: 25000,
      });
      await page.getByRole("button", { name: /^تعديل سعر / })
        .first().waitFor({ state: "visible", timeout: 16000 });
      const shape = await page.evaluate(() => {
        const edits = [...document.querySelectorAll('[role="button"]')]
          .filter(e => (e.getAttribute("aria-label") || "").startsWith("تعديل سعر "));
        const cards = edits.slice(0, 2).map(e => e.parentElement.parentElement);
        const rects = cards.map(e => e.getBoundingClientRect());
        const within = edits.slice(0, 2).every(e => {
          const r = e.getBoundingClientRect();
          const c = e.parentElement.parentElement.getBoundingClientRect();
          return r.left >= c.left && r.right <= c.right && r.top >= c.top && r.bottom <= c.bottom;
        });
        return {
          count: cards.length,
          sameRow: rects.length === 2 && Math.abs(rects[0].top - rects[1].top) < 3,
          distinctCols: rects.length === 2 && Math.abs(rects[0].left - rects[1].left) > 30,
          sequentialRows: rects.length === 2 && rects[1].top >= rects[0].bottom - 2,
          actionsWithinCards: within,
          switchesWithinTracks: [...document.querySelectorAll('[role="switch"]')].every(input => {
            const track = input.parentElement?.getBoundingClientRect();
            const thumb = input.parentElement?.children?.[1]?.getBoundingClientRect();
            return track && thumb && thumb.left >= track.left - 1 && thumb.right <= track.right + 1;
          }),
          overflow: document.documentElement.scrollWidth > innerWidth + 2,
          rtl: document.documentElement.dir === "rtl",
        };
      });
      assert.equal(shape.count, 2, "NEED_TWO_CATALOG_ITEMS_FOR_COMPARISON");
      assert.equal(shape.rtl, true, "CATALOG_MUST_BE_RTL");
      assert.equal(shape.overflow, false, "CATALOG_HORIZONTAL_OVERFLOW");
      assert.equal(shape.actionsWithinCards, true, "CATALOG_ITEM_ACTION_CLIPPED");
      assert.equal(shape.switchesWithinTracks, true, "RTL_AVAILABILITY_THUMB_OUTSIDE_TRACK");
      if (width === 1360) {
        assert.equal(shape.sameRow && shape.distinctCols, true,
          "DESKTOP_CATALOG_DENSITY_REQUIRES_TWO_COLUMNS");
      } else {
        assert.equal(shape.sequentialRows, true, "MOBILE_CATALOG_MUST_STACK_READABLY");
      }
      console.log("PARTNER_CATALOG_DENSITY=PASS_READONLY width=" + width);
    }
  } finally {
    if (page) await page.close().catch(()=>{});
    await browser.close();
  }
}
main().catch(e => {
  console.error("PARTNER_CATALOG_DENSITY=FAIL " + String(e.message).slice(0,220));
  process.exitCode = 1;
});
