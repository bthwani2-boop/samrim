import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const read = file => readFileSync(path.resolve(root, file), "utf8");
const clientRoot = path.resolve(root, "../app-client");
const readClient = file => readFileSync(path.resolve(clientRoot, file), "utf8");

test("the public Store website belongs to Client Expo Web, not Partner workspace", () => {
  const route = readClient("app/storefront/[storeId].tsx");
  const site = readClient("src/features/store-discovery/full-storefront.tsx");
  const partner = read("src/features/partner-onboarding/partner-store.tsx");
  assert.match(route, /Platform\.OS !== "web"/);
  assert.match(route, /ClientFullStorefront/);
  assert.match(site, /readPublishedIndependentWebStore/);
  assert.match(site, /listPublishedIndependentWebCatalog/);
  assert.match(partner, /section === "website"/);
  assert.match(partner, /PartnerIndependentCustomerPolicyDraftEditor/);
  assert.match(partner, /PartnerStorefrontLink/);
  assert.doesNotMatch(partner, /PartnerIndependentStorePreview|IndependentStorefrontPresentation/);
});

test("independent public website never inherits marketplace cart or preview authority", () => {
  const site = readClient("src/features/store-discovery/full-storefront.tsx");
  assert.match(site, /isMarketplace \? <BthwaniButton label=\{"سلة المتجر"/);
  assert.match(site, /relation: "independent"/);
  assert.match(site, /ready\??\.relation === "independent"/);
  assert.doesNotMatch(site, /readOwnIndependentStorePreview|readPartnerIndependentStorePreview|independent-preview/);
});

test("Partner public URL reads DSH publication before displaying the same Client Web site", () => {
  const link = read("src/features/partner-onboarding/use-partner-independent-public-link.ts");
  const url = read("src/features/partner-onboarding/partner-storefront-url.ts");
  assert.match(link, /readPublishedIndependentWebStore/);
  assert.match(link, /EXPO_PUBLIC_CLIENT_WEB_ORIGIN/);
  assert.match(link, /partnerSetupSessionKey/);
  assert.doesNotMatch(link, /EXPO_PUBLIC_INDEPENDENT_STOREFRONT_WEB_ORIGIN/);
  assert.match(url, /url\.pathname = "\/storefront\/" \+ encodeURIComponent\(store\.id\)/);
});
