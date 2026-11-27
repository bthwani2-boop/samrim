// GENERATED - do not edit. Run: node tools/dev/generate-openapi-operations.mjs
// Owner contract is services/wlt/contracts/openapi/wlt.openapi.yaml.
// Normalized OpenAPI SHA-256: d555f5d802b18f4c14eba6d0a73f1cdc3a5894a7f1d5b7196e73d302af7dccbf
// DTO and runtime validation remain the owner's responsibility.
export const wltOperations = {
  getCurrentCustomerOrderPaymentAllocation: { method: "GET", path: "/v1/wallets/me/order-payment-allocations/{checkoutID}" },
  getCurrentCustomerWalletBalance: { method: "GET", path: "/v1/wallets/me" },
  getOperatorCommercialAgreementReview: { method: "GET", path: "/v1/operators/stores/{storeID}/commercial-agreement" },
  getOwnedMerchantCommercialAgreementReview: { method: "GET", path: "/v1/merchants/stores/{storeID}/commercial-agreement" },
  getWltDevelopmentHealth: { method: "GET", path: "/health" },
  listCurrentCustomerWalletTransactions: { method: "GET", path: "/v1/wallets/me/transactions" },
  recordIsolatedFinanceAgreementDecision: { method: "POST", path: "/v1/operators/stores/{storeID}/commercial-agreement/decisions" },
  recordIsolatedFinanceAgreementProposal: { method: "POST", path: "/v1/operators/stores/{storeID}/commercial-agreement/proposals" },
  recordIsolatedMerchantAgreementDecision: { method: "POST", path: "/v1/merchants/stores/{storeID}/commercial-agreement/decisions" },
} as const;
