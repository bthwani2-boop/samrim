/** Public contract-derived Identity client API; implementations remain owner-local. */
export { identityOperations } from "./generated/identity-operations.ts";
export { changeOriginalOperatorPermission, isOperatorActorId, reviewOriginalOperatorPermissions } from "./operator-permissions.ts";
export { establishPersistentIdentitySession, readPersistentIdentityRole, revokePersistentIdentitySession, rotatePersistentIdentitySession } from "./persistent-sessions.ts";
export { issueCustomerPhoneChallenge, normalizeYemeniMobile, verifyCustomerPhoneChallenge } from "./phone-challenge.ts";
export { admitCurrentCustomerAsCaptain, admitCurrentCustomerAsMerchant, resumeCurrentCustomerCaptainSession, resumeCurrentCustomerMerchantSession } from "./role-admission.ts";
export { readVerifiedIdentitySession, revokeVerifiedIdentitySession } from "./sessions.ts";
export { IdentityClientError } from "./transport.ts";
export type {
  IdentityOperatorPermission,
  IdentityRole,
  IssuedRoleSession,
  MerchantAdmission,
  OperatorPermissionChange,
  OperatorPermissionRevision,
  PersistedIdentityCredentials,
  PersistentIdentityGrant,
  RotatedIdentitySession,
  VerifiedIdentitySession,
} from "./types.ts";
export { identityOperatorPermissions } from "./types.ts";
