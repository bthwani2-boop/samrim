// GENERATED - do not edit. Run: node tools/dev/generate-openapi-operations.mjs
// Owner contract is services/identity/contracts/openapi/identity.openapi.yaml.
// Normalized OpenAPI SHA-256: 1434160d669d28552705a7f9363e43257433b807d1fda7a3c98e674c8fff1ca4
// DTO and runtime validation remain the owner's responsibility.
export const identityOperations = {
  admitVerifiedCurrentCustomerAsMerchant: { method: "POST", path: "/v1/actors/me/merchant-role" },
  admitVerifiedCustomerAsApprovedCaptain: { method: "POST", path: "/v1/actors/me/captain-role" },
  beginExistingOperatorPasskeyRecovery: { method: "POST", path: "/v1/operators/passkey/recovery/options" },
  beginInitialOperatorPasskeyRegistration: { method: "POST", path: "/v1/operators/passkey/bootstrap/options" },
  beginOperatorPasskeyAuthentication: { method: "POST", path: "/v1/operators/passkey/authentication/options" },
  finishExistingOperatorPasskeyRecovery: { method: "POST", path: "/v1/operators/passkey/recovery" },
  finishInitialOperatorPasskeyRegistration: { method: "POST", path: "/v1/operators/passkey/bootstrap" },
  finishOperatorPasskeyAuthentication: { method: "POST", path: "/v1/operators/passkey/authentication" },
  getEffectiveOperatorPermission: { method: "GET", path: "/v1/operators/me/permissions/{permission}" },
  getIdentityDevelopmentHealth: { method: "GET", path: "/health" },
  getVerifiedIdentitySession: { method: "GET", path: "/v1/sessions/current" },
  issueCustomerPhoneChallenge: { method: "POST", path: "/v1/customer-auth/phone-challenges" },
  manageOriginalOperatorPermission: { method: "PATCH", path: "/v1/operators/{actorId}/permissions/{permission}" },
  resumeApprovedCaptainRoleSession: { method: "POST", path: "/v1/actors/me/captain-session" },
  resumeVerifiedCurrentCustomerMerchantSession: { method: "POST", path: "/v1/actors/me/merchant-session" },
  reviewOriginalOperatorPermissions: { method: "GET", path: "/v1/operators/{actorId}/permissions" },
  revokeCurrentIdentitySession: { method: "DELETE", path: "/v1/sessions/current" },
  verifyCustomerPhoneChallenge: { method: "POST", path: "/v1/customer-auth/phone-verification" },
} as const;
