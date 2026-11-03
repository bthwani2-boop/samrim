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
