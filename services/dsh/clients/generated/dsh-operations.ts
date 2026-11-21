// GENERATED - do not edit. Run: node tools/dev/generate-openapi-operations.mjs
// Owner contract is services/dsh/contracts/openapi/dsh.openapi.yaml.
// Normalized OpenAPI SHA-256: a42d36e248741875e3e14df76a22bb0aedfeb38be8a8e9f5cf9306d30c59d6c7
// DTO and runtime validation remain the owner's responsibility.
export const dshOperations = {
  applyCurrentCustomerForCaptainStanding: { method: "POST", path: "/v1/actors/me/captain-application" },
  changeCaptainStandingByAuthorizedOperator: { method: "PATCH", path: "/v1/operators/captains/{actorId}/standing" },
  dshHealth: { method: "GET", path: "/health" },
  estimatePublicOffer: { method: "GET", path: "/v1/public/stores/{id}/offers/{offerId}/estimate" },
  getCityStoreOperationalPolicy: { method: "GET", path: "/v1/operators/cities/{cityID}/store-availability-policy" },
  getCompanyEmployee: { method: "GET", path: "/v1/operators/employees/{id}" },
  getCurrentCaptainStanding: { method: "GET", path: "/v1/captains/me/standing" },
  getCurrentCustomerCaptainApplication: { method: "GET", path: "/v1/actors/me/captain-application" },
  getCurrentCustomerCaptainEligibility: { method: "GET", path: "/v1/actors/me/captain-eligibility" },
  getCurrentCustomerCart: { method: "GET", path: "/v1/carts/{storeID}" },
  getOperatorCaptainStanding: { method: "GET", path: "/v1/operators/captains/{actorId}/standing" },
  getPublicStore: { method: "GET", path: "/v1/public/stores/{id}" },
  getStoreOperationalAvailability: { method: "GET", path: "/v1/stores/{storeID}/availability" },
  listCompanyEmployees: { method: "GET", path: "/v1/operators/employees" },
  listCurrentMerchantStores: { method: "GET", path: "/v1/stores/mine" },
  listOperatorCaptainStandings: { method: "GET", path: "/v1/operators/captains" },
  listPublicCities: { method: "GET", path: "/v1/public/cities" },
  listPublicOffers: { method: "GET", path: "/v1/public/stores/{id}/offers" },
  listPublicStores: { method: "GET", path: "/v1/public/stores" },
  listPublicVerticals: { method: "GET", path: "/v1/public/verticals" },
  registerCompanyEmployee: { method: "POST", path: "/v1/operators/employees" },
  replaceCityStoreOperationalPolicy: { method: "PATCH", path: "/v1/operators/cities/{cityID}/store-availability-policy" },
  replaceCurrentCustomerCart: { method: "PUT", path: "/v1/carts/{storeID}" },
  updateStoreOperationalAvailability: { method: "PATCH", path: "/v1/stores/{storeID}/availability" },
} as const;
