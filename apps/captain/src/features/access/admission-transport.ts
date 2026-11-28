import {
  type CaptainStanding, CaptainStandingError, readApprovedCaptainStanding,
  readCaptainApplication, requestCaptainApplication,
} from "@bthwani/dsh";
import {
  admitCurrentCustomerAsCaptain, establishPersistentIdentitySession, IdentityClientError,
  issueCustomerPhoneChallenge, readPersistentIdentityRole, readVerifiedIdentitySession,
  resumeCurrentCustomerCaptainSession, revokePersistentIdentitySession,
  revokeVerifiedIdentitySession, type VerifiedIdentitySession, verifyCustomerPhoneChallenge,
} from "@bthwani/identity";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

// Isolated environment configuration, independent of device or launcher.
// Public origins are not secrets. Do not repoint this existing isolated
// credential namespace across trust domains.
const identityOrigin = process.env.EXPO_PUBLIC_BTHWANI_ISOLATED_IDENTITY_ORIGIN ?? "";
const dshOrigin = process.env.EXPO_PUBLIC_BTHWANI_ISOLATED_DSH_ORIGIN ?? "";
const options = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
// Preserve installed-device storage identifiers for recovery.
const accessKey = "bthwani.captain.synthetic-admission.v1";
const refreshKey = accessKey + ".refresh.v1";
const pendingKey = accessKey + ".pending.v1";

type Marker = "in-flight" | "refreshing" | "sign-out" | "owner-denied";
type Current = Awaited<ReturnType<typeof readPersistentIdentityRole>>;
export type CaptainAdmissionState = Readonly<{
  enabled: boolean;
  standingReady: boolean;
  session: VerifiedIdentitySession | null;
  standing?: CaptainStanding;
}>;
export type CaptainVerifiedResult = Readonly<
  { state: "pending" } | { state: "approved"; session: VerifiedIdentitySession }
>;

const get = (key: string) => SecureStore.getItemAsync(key, options);
const put = (key: string, value: string) => SecureStore.setItemAsync(key, value, options);
const remove = (key: string) => SecureStore.deleteItemAsync(key, options);
const mark = (state: Marker) => put(pendingKey, state);
const unknown = () => new IdentityClientError(0, "OPERATION_RESULT_UNKNOWN");
const stale = () => new IdentityClientError(0, "OWNER_RESPONSE_STALE");
const unavailable = () => new IdentityClientError(503, "OWNER_UNAVAILABLE");
const signOutRequired = () => new IdentityClientError(409, "SIGN_OUT_REQUIRED");
const revoked = (error: unknown) =>
  error instanceof IdentityClientError && error.status === 401 && error.code === "UNAUTHORIZED";
const guest = (enabled = true, standingReady = true): CaptainAdmissionState =>
  ({ enabled, standingReady, session: null });

function configured(): boolean {
  return Platform.OS !== "web" && Boolean(identityOrigin);
}
function requireOwners(): void {
  if (!configured() || !dshOrigin) throw unavailable();
}
function checkActive(signal: AbortSignal): void {
  if (signal.aborted) throw unknown();
}

// Separate queues: a sign-out cannot wait for a stalled DSH read. Its durable
// marker and the final storage readback reject late owner replies.
function serialQueue() {
  let tail: Promise<void> = Promise.resolve();
  return {
    run<T>(operation: () => Promise<T>): Promise<T> {
      const result = tail.then(operation);
      tail = result.then(() => undefined, () => undefined);
      return result;
    },
    idle: () => tail,
  };
}
const storage = serialQueue();
const identityReads = serialQueue();
let admissionBusy = false;

async function confirmedRevocation(action: () => Promise<void>): Promise<void> {
  try { await action(); }
  catch (error) { if (!revoked(error)) throw error; }
}

// Caller holds storage queue. Do not release quarantine until owner
// revocation and local removal are confirmed for both credentials.
async function recoverQuarantine(signal: AbortSignal, strict = false, receivedRefresh: string | null = null): Promise<boolean> {
  const marker = await get(pendingKey);
  if (!marker) return false;
  try {
    checkActive(signal);
    const bearer = await get(accessKey);
    const savedRefresh = await get(refreshKey);
    if (receivedRefresh && savedRefresh && receivedRefresh !== savedRefresh) throw stale();
    // An issued receipt can still be known to the caller when its secure
    // storage write failed before persistence. Revoke it explicitly.
    const refresh = savedRefresh ?? receivedRefresh;
    if (refresh) {
      await confirmedRevocation(() => revokePersistentIdentitySession(identityOrigin, refresh, signal));
    }
    if (bearer && marker !== "owner-denied") {
      await confirmedRevocation(() => revokeVerifiedIdentitySession(identityOrigin, bearer, signal));
    }
    checkActive(signal);
    if (savedRefresh) await remove(refreshKey);
    if (bearer) await remove(accessKey);
    await remove(pendingKey);
  } catch (error) {
    if (strict) throw error;
  }
  return true;
}

// Cleanup must remain bounded even when the original UI request is cancelled.
async function boundedCleanup(operation: (signal: AbortSignal) => Promise<unknown>): Promise<void> {
  const controller = new AbortController();
  let finish!: () => void;
  const ended = new Promise<void>(resolve => { finish = resolve; });
  const timer = setTimeout(() => { controller.abort(); finish(); }, 2000);
  try {
    await Promise.race([operation(controller.signal).catch(() => undefined), ended]);
  } finally {
    clearTimeout(timer);
  }
}

async function currentCredential(signal: AbortSignal): Promise<Current | null> {
  return identityReads.run(async () => {
    if (signal.aborted || admissionBusy) return null;
    const saved = await storage.run(async () => {
      if (admissionBusy || await recoverQuarantine(signal)) return null;
      const bearer = await get(accessKey);
      return bearer ? { bearer, refresh: await get(refreshKey) } : null;
    });
    if (!saved) return null;
    try {
      const result = await readPersistentIdentityRole(
        identityOrigin, saved.bearer, saved.refresh, "captain", signal,
        () => storage.run(async () => {
          if (signal.aborted || await get(pendingKey) || await get(accessKey) !== saved.bearer) throw stale();
          await mark("refreshing");
        }),
        (issued, previous, rotated) => storage.run(async () => {
          const marker = await get(pendingKey);
          if (await get(accessKey) !== previous ||
              (rotated ? marker !== "refreshing" : Boolean(marker) || signal.aborted)) return false;
          await put(refreshKey, issued.refreshToken);
          if (rotated) {
            await put(accessKey, issued.accessToken);
            await remove(pendingKey);
          }
          return true;
        }),
      );
      if (result.session.role !== "captain") throw new IdentityClientError(403, "FORBIDDEN");
      return result;
    } catch (error) {
      if (!revoked(error) || signal.aborted) throw error;
      await storage.run(async () => {
        if (await get(accessKey) !== saved.bearer) return;
        if (!await get(pendingKey)) await mark("owner-denied");
        await recoverQuarantine(signal);
      });
      return null;
    }
  });
}

export async function readCaptainAdmission(signal: AbortSignal): Promise<CaptainAdmissionState> {
  if (!configured()) return guest(false, false);
  if (!dshOrigin) return guest(true, false);
  const current = await currentCredential(signal);
  if (!current || signal.aborted) return guest();
  const session = current.session;
  const standing = await readApprovedCaptainStanding(dshOrigin, current.bearer, "captain", session.actorId, signal);
  const stillCurrent = await storage.run(async () =>
    !signal.aborted && !admissionBusy && !await get(pendingKey) && await get(accessKey) === current.bearer);
  return { enabled: true, standingReady: true, session: stillCurrent ? session : null, ...(stillCurrent ? { standing } : {}) };
}

export async function requestCaptainPhoneCode(phone: string, signal: AbortSignal): Promise<string> {
  requireOwners();
  return issueCustomerPhoneChallenge(identityOrigin, phone, signal);
}

async function currentApplication(bearer: string, actorId: string, signal: AbortSignal): Promise<"PENDING" | "APPROVED"> {
  try {
    await readApprovedCaptainStanding(dshOrigin, bearer, "customer", actorId, signal);
    return "APPROVED";
  } catch (error) {
    if (!(error instanceof CaptainStandingError && error.code === "CAPTAIN_NOT_ELIGIBLE")) throw error;
  }
  try {
    return await requestCaptainApplication(dshOrigin, bearer, actorId, signal);
  } catch (error) {
    if (!(error instanceof CaptainStandingError && error.code === "OPERATION_RESULT_UNKNOWN") || signal.aborted) throw error;
    try {
      return await readCaptainApplication(dshOrigin, bearer, actorId, signal);
    } catch (readError) {
      if (readError instanceof CaptainStandingError && readError.code === "CAPTAIN_NOT_ELIGIBLE") throw readError;
      throw error;
    }
  }
}

async function issueCaptain(bearer: string, signal: AbortSignal) {
  try {
    return await admitCurrentCustomerAsCaptain(identityOrigin, bearer, signal);
  } catch (error) {
    if (!(error instanceof IdentityClientError &&
        ["ALREADY_PROVISIONED", "OPERATION_RESULT_UNKNOWN"].includes(error.code)) || signal.aborted) throw error;
    return resumeCurrentCustomerCaptainSession(identityOrigin, bearer, signal);
  }
}

async function commitAdmission(bearer: string, refresh: string, signal: AbortSignal): Promise<void> {
  await storage.run(async () => {
    checkActive(signal);
    if (await get(accessKey) || await get(refreshKey) || await get(pendingKey)) throw signOutRequired();
    await mark("in-flight");
    await put(accessKey, bearer);
    checkActive(signal);
    await put(refreshKey, refresh);
    checkActive(signal);
    // Both acknowledged credential writes are the commit point. Do not report
    // rejection if marker deletion succeeded but its acknowledgement failed.
    await remove(pendingKey).catch(() => undefined);
  });
}

async function abandonCaptain(bearer: string, refresh: string | null): Promise<void> {
  const persisted = await storage.run(async () => {
    if (await get(accessKey) !== bearer || !await get(pendingKey)) return false;
    if (refresh && !await get(refreshKey)) await put(refreshKey, refresh).catch(() => undefined);
    return true;
  }).catch(() => false);
  if (persisted) {
    await boundedCleanup(signal => storage.run(() => recoverQuarantine(signal, false, refresh)));
    return;
  }
  if (refresh) await boundedCleanup(signal => revokePersistentIdentitySession(identityOrigin, refresh, signal));
  await boundedCleanup(signal => revokeVerifiedIdentitySession(identityOrigin, bearer, signal));
}

export async function verifyCaptainCode(ticket: string, code: string, signal: AbortSignal): Promise<CaptainVerifiedResult> {
  requireOwners();
  if (admissionBusy) throw signOutRequired();
  admissionBusy = true;
  try {
    await identityReads.idle();
    await storage.run(async () => {
      if (await recoverQuarantine(signal) || await get(accessKey) || await get(refreshKey)) throw signOutRequired();
      checkActive(signal);
    });
    const customerIssued = await verifyCustomerPhoneChallenge(identityOrigin, ticket, code, signal);
    let captainBearer: string | null = null;
    let refresh: string | null = null;
    try {
      const customer = await readVerifiedIdentitySession(identityOrigin, customerIssued.accessToken, signal);
      if (customer.role !== "customer") throw new IdentityClientError(502, "OWNER_RESPONSE_INVALID");
      if (await currentApplication(customerIssued.accessToken, customer.actorId, signal) === "PENDING") return { state: "pending" };
      checkActive(signal);
      const issued = await issueCaptain(customerIssued.accessToken, signal);
      captainBearer = issued.accessToken;
      const captain = await readVerifiedIdentitySession(identityOrigin, captainBearer, signal);
      if (captain.role !== "captain" || captain.actorId !== customer.actorId) {
        throw new IdentityClientError(502, "OWNER_RESPONSE_INVALID");
      }
      await readApprovedCaptainStanding(dshOrigin, captainBearer, "captain", captain.actorId, signal);
      checkActive(signal);
      refresh = (await establishPersistentIdentitySession(identityOrigin, captainBearer, signal)).refreshToken;
      await commitAdmission(captainBearer, refresh, signal);
      captainBearer = null;
      return { state: "approved", session: captain };
    } catch (error) {
      if (captainBearer) await abandonCaptain(captainBearer, refresh);
      if (signal.aborted || (error instanceof CaptainStandingError &&
        ["CAPTAIN_NOT_ELIGIBLE", "OPERATION_RESULT_UNKNOWN"].includes(error.code))) throw error;
      throw new IdentityClientError(0, "PHONE_CHALLENGE_CONSUMED");
    } finally {
      await boundedCleanup(cleanup => revokeVerifiedIdentitySession(identityOrigin, customerIssued.accessToken, cleanup));
    }
  } finally {
    admissionBusy = false;
  }
}

export async function leaveCaptainAdmission(signal: AbortSignal, expectedActorId?: string): Promise<void> {
  requireOwners();
  if (admissionBusy) throw signOutRequired();
  await storage.run(async () => {
    if (admissionBusy) throw signOutRequired();
    if (await get(pendingKey)) {
      await recoverQuarantine(signal, true);
      return;
    }
    const bearer = await get(accessKey);
    const refresh = await get(refreshKey);
    if (!bearer && !refresh) return;
    if (expectedActorId !== undefined) {
      if (!bearer) throw new IdentityClientError(409, "CAPTAIN_CONTEXT_CHANGED");
      try {
        const current = await readVerifiedIdentitySession(identityOrigin, bearer, signal);
        if (current.role !== "captain" || current.actorId !== expectedActorId) {
          throw new IdentityClientError(409, "CAPTAIN_CONTEXT_CHANGED");
        }
      } catch (error) {
        if (!revoked(error)) throw error;
      }
    }
    await mark("sign-out");
    await recoverQuarantine(signal, true);
  });
}
