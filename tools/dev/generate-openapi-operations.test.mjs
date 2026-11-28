import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { generatedOperationSource, generatedOperationsPath, operationRows } from "./generate-openapi-operations.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function fixture(t, owner) {
  const base = mkdtempSync(path.join(tmpdir(), "bthwani-generated-operation-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const dir = path.join("services", owner, "contracts", "openapi");
  cpSync(path.join(root, dir), path.join(base, dir), { recursive: true });
  return { base, contract: path.join(base, dir) };
}

// Compatibility floor, not another source of current operations. New owner operations
// need not change a count; deleting or changing a previously admitted endpoint
// requires deliberate consumer migration and an explicit compatibility-test update.
const retainedOperations = {
  identity: [
    ["admitVerifiedCurrentCustomerAsMerchant", "POST", "/v1/actors/me/merchant-role"],
    ["admitVerifiedCustomerAsApprovedCaptain", "POST", "/v1/actors/me/captain-role"],
    ["beginExistingOperatorPasskeyRecovery", "POST", "/v1/operators/passkey/recovery/options"],
    ["beginInitialOperatorPasskeyRegistration", "POST", "/v1/operators/passkey/bootstrap/options"],
    ["beginOperatorPasskeyAuthentication", "POST", "/v1/operators/passkey/authentication/options"],
    ["establishPersistentIdentitySession", "POST", "/v1/sessions/persistent"],
    ["finishExistingOperatorPasskeyRecovery", "POST", "/v1/operators/passkey/recovery"],
    ["finishInitialOperatorPasskeyRegistration", "POST", "/v1/operators/passkey/bootstrap"],
    ["finishOperatorPasskeyAuthentication", "POST", "/v1/operators/passkey/authentication"],
    ["getEffectiveOperatorPermission", "GET", "/v1/operators/me/permissions/{permission}"],
    ["getIdentityDevelopmentHealth", "GET", "/health"],
    ["getVerifiedIdentitySession", "GET", "/v1/sessions/current"],
    ["issueCustomerPhoneChallenge", "POST", "/v1/customer-auth/phone-challenges"],
    ["manageOriginalOperatorPermission", "PATCH", "/v1/operators/{actorId}/permissions/{permission}"],
    ["resumeApprovedCaptainRoleSession", "POST", "/v1/actors/me/captain-session"],
    ["resumeVerifiedCurrentCustomerMerchantSession", "POST", "/v1/actors/me/merchant-session"],
    ["reviewOriginalOperatorPermissions", "GET", "/v1/operators/{actorId}/permissions"],
    ["revokeCurrentIdentitySession", "DELETE", "/v1/sessions/current"],
    ["revokePersistentIdentitySession", "DELETE", "/v1/sessions/refresh"],
    ["rotatePersistentIdentitySession", "POST", "/v1/sessions/refresh"],
    ["verifyCustomerPhoneChallenge", "POST", "/v1/customer-auth/phone-verification"],
  ],
  dsh: [
    ["applyCurrentCustomerForCaptainStanding", "POST", "/v1/actors/me/captain-application"],
    ["changeCaptainStandingByAuthorizedOperator", "PATCH", "/v1/operators/captains/{actorId}/standing"],
    ["changeOperatorStoreRegistrationPolicy", "PATCH", "/v1/operators/cities/{cityID}/store-registration-policy/{relation}"],
    ["createCurrentMerchantCatalogDraft", "POST", "/v1/stores/{storeID}/catalog"],
    ["dshHealth", "GET", "/health"],
    ["estimateCurrentCustomerCartMerchandise", "GET", "/v1/carts/{storeID}/merchandise-estimate"],
    ["estimatePublicOffer", "GET", "/v1/public/stores/{id}/offers/{offerId}/estimate"],
    ["getCityStoreOperationalPolicy", "GET", "/v1/operators/cities/{cityID}/store-availability-policy"],
    ["getCompanyEmployee", "GET", "/v1/operators/employees/{id}"],
    ["getCurrentCaptainStanding", "GET", "/v1/captains/me/standing"],
    ["getCurrentCustomerCaptainApplication", "GET", "/v1/actors/me/captain-application"],
    ["getCurrentCustomerCaptainEligibility", "GET", "/v1/actors/me/captain-eligibility"],
    ["getCurrentCustomerCart", "GET", "/v1/carts/{storeID}"],
    ["getMerchantStoreRegistrationOptions", "GET", "/v1/stores/registration-options"],
    ["getMerchantStoreRegistrationReceipt", "GET", "/v1/store-registration-receipts/{operationID}"],
    ["getOperatorCaptainStanding", "GET", "/v1/operators/captains/{actorId}/standing"],
    ["getOperatorStoreRegistrationPolicy", "GET", "/v1/operators/cities/{cityID}/store-registration-policy/{relation}"],
    ["getPublicStore", "GET", "/v1/public/stores/{id}"],
    ["getStoreOperationalAvailability", "GET", "/v1/stores/{storeID}/availability"],
    ["listCompanyEmployees", "GET", "/v1/operators/employees"],
    ["listCurrentMerchantStoreCatalog", "GET", "/v1/stores/{storeID}/catalog"],
    ["listCurrentMerchantStores", "GET", "/v1/stores/mine"],
    ["listOperatorCaptainInterest", "GET", "/v1/operators/captain-interest"],
    ["listOperatorCaptainStandings", "GET", "/v1/operators/captains"],
    ["listOperatorStorePublicationReview", "GET", "/v1/operators/cities/{cityID}/store-publication-review/{relation}"],
    ["listOperatorStoreRegistrationPolicyHistory", "GET", "/v1/operators/cities/{cityID}/store-registration-policy/{relation}/history"],
    ["listPublicCities", "GET", "/v1/public/cities"],
    ["listPublicOffers", "GET", "/v1/public/stores/{id}/offers"],
    ["listPublicStores", "GET", "/v1/public/stores"],
    ["listPublicVerticals", "GET", "/v1/public/verticals"],
    ["markOperatorCaptainInterestContacted", "PATCH", "/v1/operators/captain-interest/{id}/contact"],
    ["readCurrentMerchantCatalogDraftHistory", "GET", "/v1/stores/{storeID}/catalog/{offerID}/draft-history"],
    ["readCurrentMerchantInventorySummary", "GET", "/v1/stores/{storeID}/inventory-summary"],
    ["registerCompanyEmployee", "POST", "/v1/operators/employees"],
    ["registerMerchantStore", "POST", "/v1/stores"],
    ["replaceCityStoreOperationalPolicy", "PATCH", "/v1/operators/cities/{cityID}/store-availability-policy"],
    ["replaceCurrentCustomerCart", "PUT", "/v1/carts/{storeID}"],
    ["submitPublicCaptainInterest", "POST", "/v1/captain-interest"],
    ["updateCurrentMerchantCatalogDraft", "PATCH", "/v1/stores/{storeID}/catalog/{offerID}"],
    ["updateStoreOperationalAvailability", "PATCH", "/v1/stores/{storeID}/availability"],
  ],
  wlt: [
    ["getCurrentCustomerOrderPaymentAllocation", "GET", "/v1/wallets/me/order-payment-allocations/{checkoutID}"],
    ["getCurrentCustomerWalletBalance", "GET", "/v1/wallets/me"],
    ["getOperatorCommercialAgreementReview", "GET", "/v1/operators/stores/{storeID}/commercial-agreement"],
    ["getOwnedMerchantCommercialAgreementReview", "GET", "/v1/merchants/stores/{storeID}/commercial-agreement"],
    ["getWltDevelopmentHealth", "GET", "/health"],
    ["listCurrentCustomerWalletTransactions", "GET", "/v1/wallets/me/transactions"],
    ["recordIsolatedFinanceAgreementDecision", "POST", "/v1/operators/stores/{storeID}/commercial-agreement/decisions"],
    ["recordIsolatedFinanceAgreementProposal", "POST", "/v1/operators/stores/{storeID}/commercial-agreement/proposals"],
    ["recordIsolatedMerchantAgreementDecision", "POST", "/v1/merchants/stores/{storeID}/commercial-agreement/decisions"],
  ],
};
const samplePaths = { identity: "/v1/sessions/current:", dsh: "/v1/stores/mine:", wlt: "/v1/wallets/me:" };
for (const owner of Object.keys(retainedOperations)) {
  test(owner + " operations are exactly reproducible and match owner OpenAPI", () => {
    const first = generatedOperationSource(owner);
    const second = generatedOperationSource(owner);
    assert.equal(first, second);
    assert.equal(first, readFileSync(generatedOperationsPath(owner), "utf8"));
    const rows = operationRows(owner);
    assert.equal(new Set(rows.map(row => row.id)).size, rows.length);
    assert.ok(rows.every(row => row.path.startsWith("/")));
    for (const [id, method, endpoint] of retainedOperations[owner]) {
      assert.ok(rows.some(row => row.id === id && row.method === method && row.path === endpoint),
        "previously admitted operation missing or changed: " + id);
    }
  });

  test(owner + " refuses stale method/path metadata after real OpenAPI mutation", t => {
    const { base, contract } = fixture(t, owner);
    const entryFile = path.join(contract, owner + ".openapi.yaml");
    const initial = generatedOperationSource(owner, base);
    const entry = readFileSync(entryFile, "utf8");
    const oldPath = samplePaths[owner];
    assert.ok(entry.includes(oldPath), "mutation must target current contract");
    writeFileSync(entryFile, entry.replace(oldPath, oldPath.replace(":", "-drift:")));
    assert.notEqual(generatedOperationSource(owner, base), initial,
      "a new owner route must invalidate the checked-in generated operation manifest");
  });
}

test("generator does not follow a path fragment outside the owner directory", t => {
  const { base, contract } = fixture(t, "dsh");
  const mainFile = path.join(contract, "dsh.openapi.yaml");
  const source = readFileSync(mainFile, "utf8");
  assert.ok(source.includes("./paths/stores.yaml"));
  writeFileSync(mainFile, source.replace("./paths/stores.yaml", "./paths/../shadow.yaml"));
  assert.throws(() => operationRows("dsh", base), /outside canonical owner/);
});

test("generator rejects operation IDs that collide across path fragments", t => {
  const { base, contract } = fixture(t, "dsh");
  const file = path.join(contract, "paths", "stores.yaml");
  const source = readFileSync(file, "utf8");
  assert.ok(source.includes("operationId: listPublicStores"));
  writeFileSync(file, source.replace("operationId: listPublicStores", "operationId: listPublicVerticals"));
  assert.throws(() => operationRows("dsh", base), /duplicate or unsafe operationId/);
});

test("owner fingerprints detect changes beyond operation names and routes", t => {
  const { base, contract } = fixture(t, "wlt");
  const baseline = generatedOperationSource("wlt", base);
  const rows = operationRows("wlt", base);
  const mutations = [
    ["paths/wallets.yaml", "'403':", "'404':"],
    ["paths/wallets.yaml", "const: no-store", "const: private"],
    ["paths/wallets.yaml", "- OpaqueSession: []", "- OpaqueSession: [other]"],
    ["paths/wallets.yaml", "#/components/schemas/Error", "#/components/schemas/CustomerWalletBalance"],
    ["wlt.openapi.yaml", "additionalProperties: false", "additionalProperties: true"],
  ];
  for (const [file, before, after] of mutations) {
    const filename = path.join(contract, file);
    const source = readFileSync(filename, "utf8");
    assert.ok(source.includes(before));
    writeFileSync(filename, source.replace(before, after));
    assert.deepEqual(operationRows("wlt", base), rows);
    assert.notEqual(generatedOperationSource("wlt", base), baseline, before);
    writeFileSync(filename, source);
  }
});

test("fingerprints ignore YAML comments and mapping order", t => {
  const { base, contract } = fixture(t, "wlt");
  const baseline = generatedOperationSource("wlt", base);
  const filename = path.join(contract, "paths", "wallets.yaml");
  const source = readFileSync(filename, "utf8");
  const changed = source.replace("type: string, const: no-store", "const: no-store, type: string");
  assert.notEqual(changed, source);
  writeFileSync(filename, "# comment outside the parsed contract\n" + changed);
  assert.equal(generatedOperationSource("wlt", base), baseline);
});

test("WLT agreement proposal and projection share the exact positive int64 text limit", () => {
  const filename = path.join(root, "services", "wlt", "contracts", "openapi", "wlt.openapi.yaml");
  const { schemas } = YAML.parse(readFileSync(filename, "utf8")).components;
  for (const name of ["AgreementProposalInput", "CommercialAgreementProposalReview"]) {
    assert.equal(schemas[name].properties.subscriptionAmountYer.$ref, "#/components/schemas/AgreementSubscriptionAmountYer");
  }
  const pattern = new RegExp(schemas.AgreementSubscriptionAmountYer.pattern);
  const limit = 9223372036854775807n;
  const candidates = [1n, 9007199254740993n, 10n ** 18n, limit - 1n, limit, limit + 1n, 10n ** 19n - 1n];
  // Cross the ceiling's decimal place boundaries, including prefixes that end in zero.
  for (let place = 10n; place <= 10n ** 18n; place *= 10n) {
    const prefix = limit / place * place;
    candidates.push(prefix - 1n, prefix, prefix + place - 1n, prefix + place);
  }
  for (const amount of candidates) assert.equal(pattern.test(String(amount)), amount <= limit, String(amount));
  for (const malformed of ["", "0", "01", "-1", "+1", "1.0", "1e3", "1\n"]) {
    assert.equal(pattern.test(malformed), false, JSON.stringify(malformed));
  }
});

test("WLT proposal contract admits only time text exact at microsecond precision", () => {
  const filename = path.join(root, "services", "wlt", "contracts", "openapi", "wlt.openapi.yaml");
  const { proposedEffectiveAt } = YAML.parse(readFileSync(filename, "utf8")).components.schemas.AgreementProposalInput.properties;
  assert.equal(proposedEffectiveAt.format, "date-time");
  const pattern = new RegExp(proposedEffectiveAt.pattern);
  const instant = "2027-01-01T10:00:00";
  for (const suffix of ["Z", ".1Z", ".000001+03:00", ".0000010000+03:00"]) {
    assert.match(instant + suffix, pattern);
  }
  for (const suffix of [".0000001Z", ".0000010001+03:00", ",000001Z", "+02:60", "+24:00"]) {
    assert.doesNotMatch(instant + suffix, pattern);
  }
});
