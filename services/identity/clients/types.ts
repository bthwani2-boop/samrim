export type IdentityRole = "customer" | "merchant" | "captain" | "operator";
export const identityOperatorPermissions = [
  "operations", "merchant", "catalog", "marketing", "finance", "hr", "platform_policies",
] as const;
export type IdentityOperatorPermission = (typeof identityOperatorPermissions)[number];
export type OperatorPermissionRevision = {
  permission: IdentityOperatorPermission;
  state: "ACTIVE" | "REVOKED";
  version: number;
};
export type OperatorPermissionChange = {
  state: OperatorPermissionRevision["state"];
  expectedVersion: number;
  operationId: string;
  reason: string;
};
export interface VerifiedIdentitySession {
  actorId: string;
  role: IdentityRole;
  sessionExpiresAt: string;
}
export interface IssuedRoleSession {
  accessToken: string;
  sessionExpiresAt: string;
}
export type MerchantAdmission = IssuedRoleSession;
export type PersistentIdentityGrant = {
  refreshToken: string;
  refreshExpiresAt: string;
};
export type RotatedIdentitySession = IssuedRoleSession & PersistentIdentityGrant;
export type PersistedIdentityCredentials = Readonly<{accessToken:string;refreshToken:string}>;
