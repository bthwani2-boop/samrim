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
  const operation = identityOperations.establishPersistentIdentitySession;
  return grantFrom(await ownerRequest(baseUrl, operation.path, accessToken, "POST", 201, signal));
}

export async function rotatePersistentIdentitySession(
  baseUrl: string, refreshToken: string, signal?: AbortSignal,
): Promise<RotatedIdentitySession> {
  const operation = identityOperations.rotatePersistentIdentitySession;
  const rotation = record(await ownerRequest(baseUrl, operation.path, refreshToken, "POST", 200, signal),
    ["accessToken", "sessionExpiresAt", "refreshToken", "refreshExpiresAt"]);
  return {
    ...issuedSessionFrom({ accessToken: rotation.accessToken, sessionExpiresAt: rotation.sessionExpiresAt }),
    ...grantFrom({ refreshToken: rotation.refreshToken, refreshExpiresAt: rotation.refreshExpiresAt }),
  };
}

export async function revokePersistentIdentitySession(
  baseUrl: string, refreshToken: string, signal?: AbortSignal,
): Promise<void> {
  const operation = identityOperations.revokePersistentIdentitySession;
  await ownerRequest(baseUrl, operation.path, refreshToken, "DELETE", 204, signal);
}

function activeRead(session: VerifiedIdentitySession, bearer: string, signal: AbortSignal): VerifiedRead {
  if (signal.aborted) throw staleView();
  if (!validDate(session.sessionExpiresAt)) throw new IdentityClientError(401, "UNAUTHORIZED");
  return { session, bearer };
}

// A device rejection or unknown storage write must not become a successful
// owner read. Attempt to invalidate only the received family, even if the view
// has gone away. Failure to confirm cleanup never changes the rejected outcome.
async function handoff(
  origin: string, credentials: PersistedIdentityCredentials, previous: string,
  rotated: boolean, commit: CredentialHandoff,
): Promise<void> {
  try {
    if (!await commit(credentials, previous, rotated)) throw staleView();
  } catch (error) {
    await revokePersistentIdentitySession(origin, credentials.refreshToken, AbortSignal.timeout(2000))
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
    // Optional enrollment may fail while the current access session remains
    // usable. This catch is deliberately restricted to the owner request:
    // rejection by device storage must never be interpreted as an outage.
    if (signal.aborted) throw staleView();
    if (!(error instanceof IdentityClientError && [0, 409, 503].includes(error.status))) throw error;
    return activeRead(current, bearer, signal);
  }
  await handoff(origin, { accessToken: bearer, refreshToken: grant.refreshToken }, bearer, false, commit);
  return activeRead(current, bearer, signal);
}

async function rotateAfterQuarantine(
  origin: string, bearer: string, refreshToken: string,
  prepare: () => Promise<void>, commit: CredentialHandoff,
): Promise<RotatedIdentitySession> {
  // The device quarantines the old refresh credential before any mutation.
  // Once dispatched, a bounded owner operation and credential handoff survive
  // view cancellation; replaying an unknown rotation is never safe.
  await prepare();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  let received: RotatedIdentitySession;
  try {
    received = await rotatePersistentIdentitySession(origin, refreshToken, controller.signal);
  } finally {
    clearTimeout(timer);
  }
  await handoff(origin, received, bearer, true, commit);
  return received;
}

// Identity owns the session family, actor and role. Each native application
// owns serialized secure storage and its account-switch admission checks.
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

  const received = await rotateAfterQuarantine(origin, bearer, refreshToken, prepareRotation, commit);
  if (signal.aborted) throw staleView();
  const verified = await readVerifiedIdentitySession(origin, received.accessToken, signal);
  if (verified.role !== role || (current && verified.actorId !== current.actorId)) {
    await revokePersistentIdentitySession(origin, received.refreshToken, AbortSignal.timeout(2000))
      .catch(() => undefined);
    throw new IdentityClientError(502, "OWNER_RESPONSE_INVALID");
  }
  return activeRead(verified, received.accessToken, signal);
}
