// GENERATED - do not edit. Run: node tools/dev/generate-openapi-operations.mjs
// Owner contract is services/wlt/contracts/openapi/wlt.openapi.yaml.
// Normalized OpenAPI SHA-256: 0f425bd23cbfc1dbb3bf35f328bc73b15fd1cd5006ee53e04c86d01f2b8ef73f
// DTO and runtime validation remain the owner's responsibility.
export const wltOperations = {
  getCurrentCustomerWalletBalance: { method: "GET", path: "/v1/wallets/me" },
  listCurrentCustomerWalletTransactions: { method: "GET", path: "/v1/wallets/me/transactions" },
} as const;
