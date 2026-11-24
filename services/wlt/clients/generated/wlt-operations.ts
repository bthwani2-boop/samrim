// GENERATED - do not edit. Run: node tools/dev/generate-openapi-operations.mjs
// Owner contract is services/wlt/contracts/openapi/wlt.openapi.yaml.
// Normalized OpenAPI SHA-256: 197369efaf2e0eb634588709b1c12a71aaa5cf8e9e762337f4cd2cb1a164647c
// DTO and runtime validation remain the owner's responsibility.
export const wltOperations = {
  getCurrentCustomerWalletBalance: { method: "GET", path: "/v1/wallets/me" },
  getWltDevelopmentHealth: { method: "GET", path: "/health" },
  listCurrentCustomerWalletTransactions: { method: "GET", path: "/v1/wallets/me/transactions" },
} as const;
