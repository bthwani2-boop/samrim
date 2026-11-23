import { identityOperations } from "./generated/identity-operations.ts";
import { readVerifiedIdentitySession } from "./sessions.ts";
import { credential, exactKeys, IdentityClientError, issuedSessionFrom, ownerRequest, validDate } from "./transport.ts";
import type { IdentityRole, PersistedIdentityCredentials, PersistentIdentityGrant, RotatedIdentitySession, VerifiedIdentitySession } from "./types.ts";

function persistentGrantFrom(value: unknown): PersistentIdentityGrant {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new IdentityClientError(502,"OPERATION_RESULT_UNKNOWN");
  }
  const v=value as Record<string,unknown>;
  if (!exactKeys(v,["refreshToken","refreshExpiresAt"]) ||
      typeof v.refreshToken !== "string" || !credential.test(v.refreshToken) ||
      !validDate(v.refreshExpiresAt)) {
    throw new IdentityClientError(502,"OPERATION_RESULT_UNKNOWN");
  }
  return v as PersistentIdentityGrant;
}
export async function establishPersistentIdentitySession(
  baseUrl:string, accessToken:string, signal?:AbortSignal,
):Promise<PersistentIdentityGrant> {
  return persistentGrantFrom(await ownerRequest(
    baseUrl,identityOperations.establishPersistentIdentitySession.path,accessToken,"POST",201,signal
  ));
}
export async function rotatePersistentIdentitySession(
  baseUrl:string, refreshToken:string, signal?:AbortSignal,
):Promise<RotatedIdentitySession> {
  const raw=await ownerRequest(
    baseUrl,identityOperations.rotatePersistentIdentitySession.path,refreshToken,"POST",200,signal
  );
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new IdentityClientError(502,"OPERATION_RESULT_UNKNOWN");
  }
  const v=raw as Record<string,unknown>;
  if (!exactKeys(v,["accessToken","sessionExpiresAt","refreshToken","refreshExpiresAt"])) {
    throw new IdentityClientError(502,"OPERATION_RESULT_UNKNOWN");
  }
  const access=issuedSessionFrom({accessToken:v.accessToken,sessionExpiresAt:v.sessionExpiresAt});
  const refresh=persistentGrantFrom({refreshToken:v.refreshToken,refreshExpiresAt:v.refreshExpiresAt});
  return {...access,...refresh};
}
export async function revokePersistentIdentitySession(
  baseUrl:string,refreshToken:string,signal?:AbortSignal,
):Promise<void> {
  await ownerRequest(baseUrl,identityOperations.revokePersistentIdentitySession.path,
    refreshToken,"DELETE",204,signal);
}

// Shared owner-side decision for native Customer, Merchant and Captain sessions.
// The caller alone owns device storage and serializes its account-switch writes.
export async function readPersistentIdentityRole(
  origin:string, bearer:string, refreshToken:string|null, role:IdentityRole,
  signal:AbortSignal,
  prepareRotation:()=>Promise<void>,
  commit:(credentials:PersistedIdentityCredentials,previousBearer:string,rotated:boolean)=>Promise<boolean>,
):Promise<{session:VerifiedIdentitySession;bearer:string}> {
  let current:VerifiedIdentitySession|null=null;
  try {
    current=await readVerifiedIdentitySession(origin,bearer,signal);
    if (current.role!==role) throw new IdentityClientError(403,"FORBIDDEN");
  } catch(error) {
    if (!(error instanceof IdentityClientError && error.status===401 && refreshToken)) throw error;
  }
  if (current && !refreshToken) {
    try {
      const enrolled=await establishPersistentIdentitySession(origin,bearer,signal);
      const accepted=await commit({accessToken:bearer,refreshToken:enrolled.refreshToken},bearer,false);
      if (!accepted) {
        await revokePersistentIdentitySession(origin,enrolled.refreshToken,AbortSignal.timeout(2000)).catch(()=>undefined);
        throw new IdentityClientError(0,"OWNER_RESPONSE_STALE");
      }
    } catch(error) {
      // A failed opt-in does not turn a still-verified access token into a signed-out user.
      // An uncertain enrollment may require an explicit new sign-in at its eventual expiry.
      if (!(error instanceof IdentityClientError && [0,409,503].includes(error.status))) throw error;
    }
    return {session:current,bearer};
  }
  if (current && refreshToken && Date.parse(current.sessionExpiresAt)-Date.now()>120_000) return {session:current,bearer};
  if (!refreshToken) throw new IdentityClientError(401,"UNAUTHORIZED");
  // Quarantine the old refresh credential on-device before the remote mutation:
  // a lost reply must never provoke an unsafe replay on the next cold start.
  await prepareRotation();
  const rotated=await rotatePersistentIdentitySession(origin,refreshToken,signal);
  const accepted=await commit(rotated,bearer,true);
  if (!accepted) {
    await revokePersistentIdentitySession(origin,rotated.refreshToken,AbortSignal.timeout(2000)).catch(()=>undefined);
    throw new IdentityClientError(0,"OWNER_RESPONSE_STALE");
  }
  const verified=await readVerifiedIdentitySession(origin,rotated.accessToken,signal);
  if (verified.role!==role || (current && verified.actorId!==current.actorId)) {
    throw new IdentityClientError(502,"OWNER_RESPONSE_INVALID");
  }
  return {session:verified,bearer:rotated.accessToken};
}
