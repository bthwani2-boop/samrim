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
 assert.match(client,/Platform\.OS === "web" \? -1 : 1/);
 assert.doesNotMatch(client,/عرض المنتج الرائج/);
});

test("customer receives recoverable Store banner errors without losing confirmed content", () => {
 assert.match(client,/setBannerError\(true\)/);
 assert.match(client,/setBannerError\(false\)/);
 assert.match(client,/label="إعادة قراءة البنرات"/);
 assert.match(client,/async function retryBanners\(\)/);
 assert.doesNotMatch(client,/\.catch\(\(\) => \{ if \(requestID === storeRequestID\.current\) setMarketingContents\(\[\]\); \}\)/);
});

test("newest successful banner read wins while failed later refreshes cannot discard retries",()=>{
 assert.match(client,/const bannerRequest = \+\+bannerRequestID\.current/);
 assert.match(client,/const bannerAppliedRequestID = useRef\(0\)/);
 assert.match(client,/active && storeGeneration === storeRequestID\.current && bannerRequest > bannerAppliedRequestID\.current/);
 assert.match(client,/bannerAppliedRequestID\.current = bannerRequest/);
 assert.match(client,/const contentID = \+\+bannerRequestID\.current/);
 assert.match(client,/contentID > bannerAppliedRequestID\.current/);
 assert.match(client,/requestID !== storeRequestID\.current \|\| bannerRequest <= bannerAppliedRequestID\.current/);
 assert.match(client,/bannerRequest === bannerRequestID\.current\) setBannerError\(true\)/);
});
