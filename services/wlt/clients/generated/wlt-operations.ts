// GENERATED - do not edit. Run: node tools/dev/generate-openapi-operations.mjs
// Owner contract is services/wlt/contracts/openapi/wlt.openapi.yaml.
// Normalized OpenAPI SHA-256: 04f8f900d1be46925875353d964e232265ede7c039edbb8b006328f67a191d3a
// DTO and runtime validation remain the owner's responsibility.
export const wltOperations = {
  getCurrentCustomerOrderPaymentAllocation: { method: "GET", path: "/v1/wallets/me/order-payment-allocations/{checkoutID}" },
  getCurrentCustomerWalletBalance: { method: "GET", path: "/v1/wallets/me" },
  getOperatorCommercialAgreementReview: { method: "GET", path: "/v1/operators/stores/{storeID}/commercial-agreement" },
  getWltDevelopmentHealth: { method: "GET", path: "/health" },
  listCurrentCustomerWalletTransactions: { method: "GET", path: "/v1/wallets/me/transactions" },
} as const;
