// GENERATED - do not edit. Run: node tools/dev/generate-openapi-operations.mjs
// Owner contract is services/wlt/contracts/openapi/wlt.openapi.yaml.
// Normalized OpenAPI SHA-256: 1853cc6c2b3bf17063b370c947af7592ecf59eb364b7d9163d7b120624a9a094
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
