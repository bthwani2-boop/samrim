// GENERATED - do not edit. Run: node tools/dev/generate-openapi-operations.mjs
// Owner contract is services/wlt/contracts/openapi/wlt.openapi.yaml.
// Normalized OpenAPI SHA-256: f40d4821e045612ddceb9e8c75874b5bdb13322473a4dc5e6b646666d5860517
// DTO and runtime validation remain the owner's responsibility.
export const wltOperations = {
  getCurrentCustomerWalletBalance: { method: "GET", path: "/v1/wallets/me" },
  listCurrentCustomerWalletTransactions: { method: "GET", path: "/v1/wallets/me/transactions" },
} as const;
