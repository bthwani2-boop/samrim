import assert from "node:assert/strict";
import test from "node:test";
import { buildPartnerIndependentStorefrontURL } from "../src/features/partner-onboarding/partner-storefront-url.ts";

// PostgreSQL forbids marketplace publication_state='published' for INDEPENDENT_STORE.
// Only the DSH independent public GET can prove web publication.
test("independent web publication does not require marketplace publication", () => {
  const independent = {
    id: "independent_qa", serviceCityId: "city_sanaa",
    relationModel: "INDEPENDENT_STORE", publicationState: "unpublished",
  };
  assert.equal(buildPartnerIndependentStorefrontURL(independent, "https://bthwani.example", false), null);
  const verified = buildPartnerIndependentStorefrontURL(independent, "https://bthwani.example", true);
  assert.equal(verified?.url,
    "https://bthwani.example/storefront/independent_qa?serviceCityId=city_sanaa");
});
