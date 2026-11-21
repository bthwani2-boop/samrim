// GENERATED - do not edit. Run: node tools/dev/generate-openapi-operations.mjs
// Owner contract is services/wlt/contracts/openapi/wlt.openapi.yaml.
// Normalized OpenAPI SHA-256: d83a192c6fb4677fc3f9eccb46b7121401960a7b7bab4d840417fac7bb4909ad
// DTO and runtime validation remain the owner's responsibility.
export const wltOperations = {
  getCurrentCustomerWalletBalance: { method: "GET", path: "/v1/wallets/me" },
  listCurrentCustomerWalletTransactions: { method: "GET", path: "/v1/wallets/me/transactions" },
} as const;
