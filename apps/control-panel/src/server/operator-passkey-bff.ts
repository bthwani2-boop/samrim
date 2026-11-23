/** Stable public Operator BFF interface; implementation stays server-side and fails closed. */

export type { OperatorAccessState, VerifiedOperatorWorkspaceAccess } from "./operator-passkey-access.ts";
export { readOperatorAccessState, readVerifiedOperatorAccess } from "./operator-passkey-access.ts";
export type { OperatorPasskeyConfig } from "./operator-passkey-config.ts";
export { canonicalOperatorEntryRedirect, isTrustedOperatorLoopbackTarget, isTrustedOperatorRequest, OPERATOR_COOKIE, OPERATOR_REFRESH_COOKIE, resolveInitialOperatorBootstrapConfig, resolveIsolatedOperatorConfig, resolveOperatorRecoveryConfig } from "./operator-passkey-config.ts";
export { boundedRequestBody, boundedResponseJSON, isEmptyRequestBody, operatorIdentityRequest } from "./operator-passkey-transport.ts";
export type { IssuedOperatorToken, VerifiedOperatorPrincipal } from "./operator-passkey-validation.ts";
export { cookieLifetimeSeconds, parseInitialOperatorOptions, parseIssuedOperatorToken, parsePasskeyOptions, parseVerifiedOperatorPrincipal, validAssertion, validInitialOperatorPayload } from "./operator-passkey-validation.ts";
