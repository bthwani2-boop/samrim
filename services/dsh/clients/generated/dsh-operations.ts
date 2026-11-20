// GENERATED - do not edit. Run: node tools/dev/generate-openapi-operations.mjs
// Owner contract is services/dsh/contracts/openapi/dsh.openapi.yaml.
// Method/path metadata only; runtime schemas, authorization and errors remain owner contracts.
export const dshOperations = {
  applyCurrentCustomerForCaptainStanding: { method: "POST", path: "/v1/actors/me/captain-application" },
  changeCaptainStandingByAuthorizedOperator: { method: "PATCH", path: "/v1/operators/captains/{actorId}/standing" },
  dshHealth: { method: "GET", path: "/health" },
  getCityStoreOperationalPolicy: { method: "GET", path: "/v1/operators/cities/{cityID}/store-availability-policy" },
  getCurrentCaptainStanding: { method: "GET", path: "/v1/captains/me/standing" },
  getCurrentCustomerCaptainApplication: { method: "GET", path: "/v1/actors/me/captain-application" },
  getCurrentCustomerCaptainEligibility: { method: "GET", path: "/v1/actors/me/captain-eligibility" },
  getOperatorCaptainStanding: { method: "GET", path: "/v1/operators/captains/{actorId}/standing" },
  getPublicStore: { method: "GET", path: "/v1/public/stores/{id}" },
  getStoreOperationalAvailability: { method: "GET", path: "/v1/stores/{storeID}/availability" },
  listCurrentMerchantStores: { method: "GET", path: "/v1/stores/mine" },
  listOperatorCaptainStandings: { method: "GET", path: "/v1/operators/captains" },
  listPublicOffers: { method: "GET", path: "/v1/public/stores/{id}/offers" },
  listPublicStores: { method: "GET", path: "/v1/public/stores" },
  listPublicVerticals: { method: "GET", path: "/v1/public/verticals" },
  replaceCityStoreOperationalPolicy: { method: "PATCH", path: "/v1/operators/cities/{cityID}/store-availability-policy" },
  updateStoreOperationalAvailability: { method: "PATCH", path: "/v1/stores/{storeID}/availability" },
} as const;
