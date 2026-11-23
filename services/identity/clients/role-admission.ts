import { identityOperations } from "./generated/identity-operations.ts";
import { issuedSessionFrom, ownerRequest } from "./transport.ts";
import type { IssuedRoleSession, MerchantAdmission } from "./types.ts";

/** Requires a verified Customer session. Never implies a DSH Store grant. */
export async function admitCurrentCustomerAsMerchant(
  baseUrl: string, customerBearer: string, signal?: AbortSignal,
): Promise<MerchantAdmission> {
  return issuedSessionFrom(await ownerRequest(baseUrl, identityOperations.admitVerifiedCurrentCustomerAsMerchant.path,
    customerBearer, "POST", 201, signal));
}
/** Revokes previous Merchant sessions at Identity before issuing a new one. */
export async function resumeCurrentCustomerMerchantSession(
  baseUrl: string, customerBearer: string, signal?: AbortSignal,
): Promise<MerchantAdmission> {
  return issuedSessionFrom(await ownerRequest(baseUrl, identityOperations.resumeVerifiedCurrentCustomerMerchantSession.path,
    customerBearer, "POST", 200, signal));
}
/** The DSH-approved Captain standing is checked again by Identity at issue time. */
export async function admitCurrentCustomerAsCaptain(
  baseUrl: string, customerBearer: string, signal?: AbortSignal,
): Promise<IssuedRoleSession> {
  return issuedSessionFrom(await ownerRequest(baseUrl, identityOperations.admitVerifiedCustomerAsApprovedCaptain.path,
    customerBearer, "POST", 201, signal));
}
/** Re-entry rotates the existing Captain bearer without reactivating a role. */
export async function resumeCurrentCustomerCaptainSession(
  baseUrl: string, customerBearer: string, signal?: AbortSignal,
): Promise<IssuedRoleSession> {
  return issuedSessionFrom(await ownerRequest(baseUrl, identityOperations.resumeApprovedCaptainRoleSession.path,
    customerBearer, "POST", 200, signal));
}
