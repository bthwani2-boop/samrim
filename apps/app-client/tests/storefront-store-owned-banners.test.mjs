import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import path from "node:path";
const feature=path.resolve(import.meta.dirname,"../src/features/store-discovery");
const client=readFileSync(path.join(feature,"store-detail.tsx"),"utf8");
const api=readFileSync(path.join(feature,"store-discovery-client.ts"),"utf8");
test("customer store banners use only Store-scoped DSH publication, never the main homepage feed",()=>{
 assert.match(client,/listPublicStoreBanners\(storeId, selectedCityID\)/);
 assert.doesNotMatch(client,/listPublicDiscoveryContent\(selectedCityID\)/);
 assert.doesNotMatch(client,/bannerCatalogOffers\.slice\(0, 5\)/);
 assert.match(api,/listPublicStoreBanners\(storeID, serviceCityID\)/);
});
test("client carousel uses one full-width merchant image and allows no-banner fallback",()=>{
 assert.match(client,/accessibilityLabel="بنرات المتجر"/);
 assert.match(client,/bannerItems\.map/);
 assert.match(client,/reduceMotion/);
 assert.doesNotMatch(client,/عرض المنتج الرائج/);
});
