// GENERATED - do not edit. Run: node tools/dev/generate-openapi-operations.mjs
// Owner contract is services/dsh/contracts/openapi/dsh.openapi.yaml.
// Normalized OpenAPI SHA-256: 986132bbf4a02eadf97958b4879c4720fe26f876906f65de7899a02b7a43ef09
// DTO and runtime validation remain the owner's responsibility.
export const dshOperations = {
  applyCurrentCustomerForCaptainStanding: { method: "POST", path: "/v1/actors/me/captain-application" },
  changeCaptainStandingByAuthorizedOperator: { method: "PATCH", path: "/v1/operators/captains/{actorId}/standing" },
  dshHealth: { method: "GET", path: "/health" },
  estimatePublicOffer: { method: "GET", path: "/v1/public/stores/{id}/offers/{offerId}/estimate" },
  getCityStoreOperationalPolicy: { method: "GET", path: "/v1/operators/cities/{cityID}/store-availability-policy" },
  getCurrentCaptainStanding: { method: "GET", path: "/v1/captains/me/standing" },
  getCurrentCustomerCaptainApplication: { method: "GET", path: "/v1/actors/me/captain-application" },
  getCurrentCustomerCaptainEligibility: { method: "GET", path: "/v1/actors/me/captain-eligibility" },
  getCurrentCustomerCart: { method: "GET", path: "/v1/carts/{storeID}" },
  getOperatorCaptainStanding: { method: "GET", path: "/v1/operators/captains/{actorId}/standing" },
  getPublicStore: { method: "GET", path: "/v1/public/stores/{id}" },
  getStoreOperationalAvailability: { method: "GET", path: "/v1/stores/{storeID}/availability" },
  listCurrentMerchantStores: { method: "GET", path: "/v1/stores/mine" },
  listOperatorCaptainStandings: { method: "GET", path: "/v1/operators/captains" },
  listPublicCities: { method: "GET", path: "/v1/public/cities" },
  listPublicOffers: { method: "GET", path: "/v1/public/stores/{id}/offers" },
  listPublicStores: { method: "GET", path: "/v1/public/stores" },
  listPublicVerticals: { method: "GET", path: "/v1/public/verticals" },
  replaceCityStoreOperationalPolicy: { method: "PATCH", path: "/v1/operators/cities/{cityID}/store-availability-policy" },
  replaceCurrentCustomerCart: { method: "PUT", path: "/v1/carts/{storeID}" },
  updateStoreOperationalAvailability: { method: "PATCH", path: "/v1/stores/{storeID}/availability" },
} as const;
