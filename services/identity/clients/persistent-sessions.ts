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

const budget = { read: 5000, enroll: 5000, rotate: 10000, revoke: 5000, cleanup: 2000 } as const;
const unknownResult = () => new IdentityClientError(502, "OPERATION_RESULT_UNKNOWN");
const staleView = () => new IdentityClientError(0, "OWNER_RESPONSE_STALE");

function receipt(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw unknownResult();
  const result = value as Record<string, unknown>;
  if (!exactKeys(result, keys)) throw unknownResult();
  return result;
}

function grantFrom(value: unknown): PersistentIdentityGrant {
  const grant = receipt(value, ["refreshToken", "refreshExpiresAt"]);
  if (typeof grant.refreshToken !== "string" || !credential.test(grant.refreshToken) ||
      !validDate(grant.refreshExpiresAt)) throw unknownResult();
  return { refreshToken: grant.refreshToken, refreshExpiresAt: grant.refreshExpiresAt };
}

// All persistent-session owner calls have a finite end-to-end budget. The
// owner transport races cancellation even if the fetch bridge ignores it.
// Link the view only for operations that are allowed to stop with the view.
async function withinOwnerBudget<T>(
  timeout: number, operation: (signal: AbortSignal) => Promise<T>, caller?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  caller?.addEventListener("abort", cancel, { once: true });
  if (caller?.aborted) cancel();
  const timer = setTimeout(cancel, timeout);
  try {
    return await operation(controller.signal);
  } finally {
    clearTimeout(timer);
    caller?.removeEventListener("abort", cancel);
  }
}

export async function establishPersistentIdentitySession(
  baseUrl: string, accessToken: string, signal?: AbortSignal,
): Promise<PersistentIdentityGrant> {
  const { path } = identityOperations.establishPersistentIdentitySession;
  const value = await withinOwnerBudget(budget.enroll,
    deadline => ownerRequest(baseUrl, path, accessToken, "POST", 201, deadline), signal);
  return grantFrom(value);
}

export async function rotatePersistentIdentitySession(
  baseUrl: string, refreshToken: string, signal?: AbortSignal,
): Promise<RotatedIdentitySession> {
  const { path } = identityOperations.rotatePersistentIdentitySession;
  const value = receipt(await withinOwnerBudget(budget.rotate,
    deadline => ownerRequest(baseUrl, path, refreshToken, "POST", 200, deadline), signal),
  ["accessToken", "sessionExpiresAt", "refreshToken", "refreshExpiresAt"]);
  return {
    ...issuedSessionFrom({ accessToken: value.accessToken, sessionExpiresAt: value.sessionExpiresAt }),
    ...grantFrom({ refreshToken: value.refreshToken, refreshExpiresAt: value.refreshExpiresAt }),
  };
}

async function revokeFamily(
  origin: string, refreshToken: string, timeout: number, caller?: AbortSignal,
): Promise<void> {
  const { path } = identityOperations.revokePersistentIdentitySession;
  await withinOwnerBudget(timeout,
    deadline => ownerRequest(origin, path, refreshToken, "DELETE", 204, deadline), caller);
}

export async function revokePersistentIdentitySession(
  baseUrl: string, refreshToken: string, signal?: AbortSignal,
): Promise<void> {
  await revokeFamily(baseUrl, refreshToken, budget.revoke, signal);
}

async function verifiedRead(origin: string, bearer: string, caller?: AbortSignal): Promise<VerifiedIdentitySession> {
  try {
    return await withinOwnerBudget(budget.read,
      deadline => readVerifiedIdentitySession(origin, bearer, deadline), caller);
  } catch (error) {
    // An internal deadline is an outage, not a caller account switch.
    if (error instanceof IdentityClientError && error.code === "OWNER_RESPONSE_STALE" && !caller?.aborted) {
      throw new IdentityClientError(0, "OWNER_NETWORK_UNAVAILABLE");
    }
    throw error;
  }
}

function activeRead(session: VerifiedIdentitySession, bearer: string, signal: AbortSignal): VerifiedRead {
  if (signal.aborted) throw staleView();
  if (!validDate(session.sessionExpiresAt)) throw new IdentityClientError(401, "UNAUTHORIZED");
  return { session, bearer };
}

// Only a currently verified, unexpired owner receipt can release storage
// quarantine. A rejected readback or handoff never becomes admission, even
// if the bounded attempt to revoke the received family cannot be confirmed.
async function deliverVerified(
  origin: string, received: PersistedIdentityCredentials, grant: PersistentIdentityGrant,
  previous: string, rotated: boolean, verify: () => Promise<VerifiedIdentitySession>,
  commit: CredentialHandoff, issuedAccessExpiry?: string, view?: AbortSignal,
): Promise<VerifiedIdentitySession> {
  try {
    const session = await verify();
    if (view?.aborted) throw staleView();
    if (!validDate(grant.refreshExpiresAt) ||
        (issuedAccessExpiry !== undefined && !validDate(issuedAccessExpiry))) throw unknownResult();
    if (!validDate(session.sessionExpiresAt)) throw new IdentityClientError(401, "UNAUTHORIZED");
    if (!await commit(received, previous, rotated)) throw staleView();
    return session;
  } catch (error) {
    await revokeFamily(origin, grant.refreshToken, budget.cleanup).catch(() => undefined);
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
    // Enrollment is optional for an already verified access session. Network
    // uncertainty is not proof that enrollment failed, and is never retried
    // here or converted to a persisted credential.
    if (signal.aborted) throw staleView();
    if (!(error instanceof IdentityClientError && [0, 409, 503].includes(error.status))) throw error;
    return activeRead(current, bearer, signal);
  }
  const verified = await deliverVerified(origin, { accessToken: bearer, refreshToken: grant.refreshToken },
    grant, bearer, false, async () => current, commit, undefined, signal);
  return activeRead(verified, bearer, signal);
}

async function rotateVerified(
  origin: string, bearer: string, refreshToken: string, role: IdentityRole,
  current: VerifiedIdentitySession | null, signal: AbortSignal,
  prepare: () => Promise<void>, commit: CredentialHandoff,
): Promise<VerifiedRead> {
  // A prepared durable rotation must finish or remain quarantined even if
  // the view disappears. It cannot publish into an abandoned view.
  await prepare();
  const received = await rotatePersistentIdentitySession(origin, refreshToken);
  const verified = await deliverVerified(origin, received, received, bearer, true, async () => {
    const session = await verifiedRead(origin, received.accessToken);
    if (session.role !== role || (current && session.actorId !== current.actorId)) {
      throw new IdentityClientError(502, "OWNER_RESPONSE_INVALID");
    }
    return session;
  }, commit, received.sessionExpiresAt);
  return activeRead(verified, received.accessToken, signal);
}

// Identity owns actor, role and session family. The application owns the
// serialized secure storage, quarantine and account-switch admission checks.
export async function readPersistentIdentityRole(
  origin: string, bearer: string, refreshToken: string | null, role: IdentityRole,
  signal: AbortSignal, prepareRotation: () => Promise<void>, commit: CredentialHandoff,
): Promise<VerifiedRead> {
  let current: VerifiedIdentitySession | null;
  try {
    current = await verifiedRead(origin, bearer, signal);
  } catch (error) {
    if (!(refreshToken && error instanceof IdentityClientError && error.status === 401)) throw error;
    current = null;
  }
  if (signal.aborted) throw staleView();
  if (current) {
    if (current.role !== role) throw new IdentityClientError(403, "FORBIDDEN");
    if (!refreshToken) return enrollCurrent(origin, current, bearer, signal, commit);
    if (Date.parse(current.sessionExpiresAt) - Date.now() > 120_000) return activeRead(current, bearer, signal);
  }
  if (!refreshToken) throw new IdentityClientError(401, "UNAUTHORIZED");
  return rotateVerified(origin, bearer, refreshToken, role, current, signal, prepareRotation, commit);
}
