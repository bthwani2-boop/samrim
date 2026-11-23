import { identityOperations } from "./generated/identity-operations.ts";
import { ownerRequest, sessionFrom } from "./transport.ts";
import type { VerifiedIdentitySession } from "./types.ts";

export async function revokeVerifiedIdentitySession(
  baseUrl: string, bearer: string, signal?: AbortSignal,
): Promise<void> {
  await ownerRequest(baseUrl, identityOperations.revokeCurrentIdentitySession.path, bearer, "DELETE", 204, signal);
}
export async function readVerifiedIdentitySession(
  baseUrl: string, bearer: string, signal?: AbortSignal,
): Promise<VerifiedIdentitySession> {
  return sessionFrom(await ownerRequest(baseUrl, identityOperations.getVerifiedIdentitySession.path, bearer, "GET", 200, signal));
}
