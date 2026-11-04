import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
const feature = path.dirname(new URL(import.meta.url).pathname).replace(/^\/(?=[A-Za-z]:)/,"");
const source = () => readFileSync(path.join(feature,"partner-store-banners.tsx"),"utf8");
test("Partner banner authoring is separate from platform marketing and bound to owned Store", () => {
 const ui = source();
 assert.match(ui,/kind.*"BANNER"/);
 assert.match(ui,/\/dsh\/partner\/stores\/\$\{encodeURIComponent\(storeId\)\}/);
 assert.match(ui,/endpoint\(storeId\)\+"\/discovery-content"/);
 assert.match(ui,/getUsableIdentityAccessToken/);
 assert.match(ui,/DocumentPicker/);
 assert.match(ui,/partnerEnabled/);
});
test("the same Partner marketing surface exposes Store banners on mobile and web", () => {
 const workspace = readFileSync(path.join(feature,"../partner-onboarding/partner-marketing-workspace.tsx"),"utf8");
 const desktop = readFileSync(path.join(feature,"../../shell/partner-desktop-workspace.tsx"),"utf8");
 assert.match(workspace,/PartnerStoreBanners/);
 assert.match(desktop,/view=banners/);
});

test("Partner banner attempts survive failed owner readback and are cleared only after it succeeds", () => {
 const ui = source();
 assert.ok(ui.includes('const refresh = useCallback(async (expected?: Readonly'));
 assert.ok(ui.includes('if (!await refresh({ id: attempt.contentId }, items.length)) throw new Error("STORE_BANNER_READBACK_FAILED");'));
 assert.ok(ui.includes('if (!await refresh({ id: item.id, enabled }, items.length)) throw new Error("STORE_BANNER_VISIBILITY_READBACK_FAILED");'));
 assert.ok(ui.includes('if (request.current !== current) return false;'));
 assert.match(ui, /submitAttempt\.current=null;setFile\(null\)/);
 assert.match(ui, /toggleAttempt\.current=null;\s*setNotice/);
});

test("canonical banner readback checks exact changed records across bounded keyset pages", () => {
 const ui = source();
 assert.ok(ui.includes('for (let page = 1; cursor && page < 20 &&'));
 assert.ok(ui.includes('visited.has(cursor)'));
 assert.ok(ui.includes('"/banners?cursor=" + encodeURIComponent(cursor)'));
 assert.ok(ui.includes('visibleItems.find(item => item.id === expected.id)'));
 assert.ok(ui.includes('item.partnerEnabled !== expected.enabled'));
 assert.ok(ui.includes('STORE_BANNER_CANONICAL_READBACK_MISMATCH'));
 assert.ok(ui.includes('visibleItems.length < minimumItems'));
});

test("unfiltered mount does not issue a competing target search", () => {
 const ui = source();
 assert.ok(ui.includes('if (targetType === "STORE") return;'));
 assert.ok(ui.includes('[storeId,targetSearch,targetType]'));
 assert.ok(ui.includes('if (targetSearch.trim()) setTargets([])'));
});
