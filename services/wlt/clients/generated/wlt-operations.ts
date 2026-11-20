// GENERATED - do not edit. Run: node tools/dev/generate-openapi-operations.mjs
// Owner contract is services/wlt/contracts/openapi/wlt.openapi.yaml.
// Normalized OpenAPI SHA-256: 7a58e7002f09c6d888aeebe81bcf2c072c47351dda8a54a3e2084c9dadfbc25b
// DTO and runtime validation remain the owner's responsibility.
export const wltOperations = {
  getCurrentCustomerWalletBalance: { method: "GET", path: "/v1/wallets/me" },
  listCurrentCustomerWalletTransactions: { method: "GET", path: "/v1/wallets/me/transactions" },
} as const;
