import { identityOperations } from "./generated/identity-operations.ts";
import { readVerifiedIdentitySession } from "./sessions.ts";
import {
  credential, exactKeys, IdentityClientError, issuedSessionFrom, ownerRequest, validDate,
} from "./transport.ts";
import type {
  IdentityRole, PersistedIdentityCredentials, PersistentIdentityGrant,
  RotatedIdentitySession, VerifiedIdentitySession,
} from "./types.ts";

type CredentialHandoff = (
  credentials: PersistedIdentityCredentials, previousBearer: string, rotated: boolean,
) => Promise<boolean>;
type VerifiedRead = { session: VerifiedIdentitySession; bearer: string };

const unknownResult = () => new IdentityClientError(502, "OPERATION_RESULT_UNKNOWN");
const staleView = () => new IdentityClientError(0, "OWNER_RESPONSE_STALE");

function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw unknownResult();
  const result = value as Record<string, unknown>;
  if (!exactKeys(result, keys)) throw unknownResult();
  return result;
}

function grantFrom(value: unknown): PersistentIdentityGrant {
  const grant = record(value, ["refreshToken", "refreshExpiresAt"]);
  if (typeof grant.refreshToken !== "string" || !credential.test(grant.refreshToken) ||
      !validDate(grant.refreshExpiresAt)) throw unknownResult();
  return { refreshToken: grant.refreshToken, refreshExpiresAt: grant.refreshExpiresAt };
}

export async function establishPersistentIdentitySession(
  baseUrl: string, accessToken: string, signal?: AbortSignal,
): Promise<PersistentIdentityGrant> {
  const { path } = identityOperations.establishPersistentIdentitySession;
  return grantFrom(await ownerRequest(baseUrl, path, accessToken, "POST", 201, signal));
}

export async function rotatePersistentIdentitySession(
  baseUrl: string, refreshToken: string, signal?: AbortSignal,
): Promise<RotatedIdentitySession> {
  const { path } = identityOperations.rotatePersistentIdentitySession;
  const value = record(await ownerRequest(baseUrl, path, refreshToken, "POST", 200, signal),
    ["accessToken", "sessionExpiresAt", "refreshToken", "refreshExpiresAt"]);
  return {
    ...issuedSessionFrom({ accessToken: value.accessToken, sessionExpiresAt: value.sessionExpiresAt }),
    ...grantFrom({ refreshToken: value.refreshToken, refreshExpiresAt: value.refreshExpiresAt }),
  };
}

export async function revokePersistentIdentitySession(
  baseUrl: string, refreshToken: string, signal?: AbortSignal,
): Promise<void> {
  const { path } = identityOperations.revokePersistentIdentitySession;
  await ownerRequest(baseUrl, path, refreshToken, "DELETE", 204, signal);
}

async function withinDeadline<T>(timeout: number, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try { return await operation(controller.signal); }
  finally { clearTimeout(timer); }
}

function activeRead(session: VerifiedIdentitySession, bearer: string, signal: AbortSignal): VerifiedRead {
  if (signal.aborted) throw staleView();
  if (!validDate(session.sessionExpiresAt)) throw new IdentityClientError(401, "UNAUTHORIZED");
  return { session, bearer };
}

// Only verified credentials may release the device's quarantine. A rejected
// verification or storage handoff attempts revocation of the received family;
// an unknown cleanup outcome never converts rejection into admission.
async function deliverVerified(
  origin: string, received: PersistedIdentityCredentials, previous: string,
  rotated: boolean, verify: () => Promise<VerifiedIdentitySession>, commit: CredentialHandoff,
): Promise<VerifiedIdentitySession> {
  try {
    const session = await verify();
    if (!await commit(received, previous, rotated)) throw staleView();
    return session;
  } catch (error) {
    await withinDeadline(2000, signal => revokePersistentIdentitySession(origin, received.refreshToken, signal))
      .catch(() => undefined);
    throw error;
  }
}

async function enrollCurrent(
  origin: string, current: VerifiedIdentitySession, bearer: string,
  signal: AbortSignal, commit: CredentialHandoff,
): Promise<VerifiedRead> {
  let grant: PersistentIdentityGrant;
  try {
    grant = await establishPersistentIdentitySession(origin, bearer, signal);
  } catch (error) {
    // Optional enrollment failure does not invalidate an already verified
    // access session. Device rejection is not part of this network fallback.
    if (signal.aborted) throw staleView();
    if (!(error instanceof IdentityClientError && [0, 409, 503].includes(error.status))) throw error;
    return activeRead(current, bearer, signal);
  }
  const verified = await deliverVerified(origin, { accessToken: bearer, refreshToken: grant.refreshToken },
    bearer, false, async () => activeRead(current, bearer, signal).session, commit);
  return activeRead(verified, bearer, signal);
}

async function rotateVerified(
  origin: string, bearer: string, refreshToken: string, role: IdentityRole,
  current: VerifiedIdentitySession | null, signal: AbortSignal,
  prepare: () => Promise<void>, commit: CredentialHandoff,
): Promise<VerifiedRead> {
  // The old pair remains quarantined until a fresh owner read verifies the
  // received access token. The durable operation survives view cancellation,
  // but the cancelled view cannot observe or use its result.
  await prepare();
  const received = await withinDeadline(10_000,
    deadline => rotatePersistentIdentitySession(origin, refreshToken, deadline));
  const verified = await deliverVerified(origin, received, bearer, true, async () => {
    const session = await withinDeadline(5000,
      deadline => readVerifiedIdentitySession(origin, received.accessToken, deadline));
    if (session.role !== role || (current && session.actorId !== current.actorId)) {
      throw new IdentityClientError(502, "OWNER_RESPONSE_INVALID");
    }
    return session;
  }, commit);
  return activeRead(verified, received.accessToken, signal);
}

// Identity owns the session family, actor and role. The native consumer owns
// serialized secure storage, quarantine and account-switch admission checks.
export async function readPersistentIdentityRole(
  origin: string, bearer: string, refreshToken: string | null, role: IdentityRole,
  signal: AbortSignal, prepareRotation: () => Promise<void>, commit: CredentialHandoff,
): Promise<VerifiedRead> {
  let current: VerifiedIdentitySession | null;
  try {
    current = await readVerifiedIdentitySession(origin, bearer, signal);
  } catch (error) {
    if (!(refreshToken && error instanceof IdentityClientError && error.status === 401)) throw error;
    current = null;
  }
  if (signal.aborted) throw staleView();
  if (current) {
    if (current.role !== role) throw new IdentityClientError(403, "FORBIDDEN");
    if (!refreshToken) return enrollCurrent(origin, current, bearer, signal, commit);
    if (Date.parse(current.sessionExpiresAt) - Date.now() > 120_000) {
      return activeRead(current, bearer, signal);
    }
  }
  if (!refreshToken) throw new IdentityClientError(401, "UNAUTHORIZED");
  return rotateVerified(origin, bearer, refreshToken, role, current, signal, prepareRotation, commit);
}
