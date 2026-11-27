// GENERATED - do not edit. Run: node tools/dev/generate-openapi-operations.mjs
// Owner contract is services/wlt/contracts/openapi/wlt.openapi.yaml.
// Normalized OpenAPI SHA-256: aede98ee427c0477001873b07e2c5132e18be9afbdc40d03027d0774b781b0e5
// DTO and runtime validation remain the owner's responsibility.
export const wltOperations = {
  getCurrentCustomerOrderPaymentAllocation: { method: "GET", path: "/v1/wallets/me/order-payment-allocations/{checkoutID}" },
  getCurrentCustomerWalletBalance: { method: "GET", path: "/v1/wallets/me" },
  getOperatorCommercialAgreementReview: { method: "GET", path: "/v1/operators/stores/{storeID}/commercial-agreement" },
  getOwnedMerchantCommercialAgreementReview: { method: "GET", path: "/v1/merchants/stores/{storeID}/commercial-agreement" },
  getWltDevelopmentHealth: { method: "GET", path: "/health" },
  listCurrentCustomerWalletTransactions: { method: "GET", path: "/v1/wallets/me/transactions" },
  recordIsolatedFinanceAgreementDecision: { method: "POST", path: "/v1/operators/stores/{storeID}/commercial-agreement/decisions" },
  recordIsolatedMerchantAgreementDecision: { method: "POST", path: "/v1/merchants/stores/{storeID}/commercial-agreement/decisions" },
} as const;
