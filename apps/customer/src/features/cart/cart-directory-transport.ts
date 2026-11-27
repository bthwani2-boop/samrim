import {
  type CustomerCartDirectory,
  DshPublicError,
  listCurrentCustomerCarts,
  parseCustomerCartDirectory,
} from "@bthwani/dsh";
import { Platform } from "react-native";
import { discardCustomerResponse, readBoundedCustomerJSON } from "../access/bounded-customer-json";
import { readCustomerAdmission, withVerifiedNativeCustomerRead } from "../access/customer-session-transport";

const nativeOwner = process.env.EXPO_PUBLIC_CUSTOMER_SYNTHETIC_DSH_ORIGIN;
const route = "/api/customer-auth/carts";
const readDeadlineMs = 20_000;
const pageByteLimit = 32 * 1024;

type DirectoryRead = { value: CustomerCartDirectory; expiresAt: number };

function unavailable(): DshPublicError {
  return new DshPublicError(503, "OWNER_UNAVAILABLE");
}

function unauthorized(): DshPublicError {
  return new DshPublicError(401, "UNAUTHORIZED");
}

// The complete operation has one finite lifetime, even if a native bridge
// or HTTP collaborator does not settle its promise when interrupted.
async function withinReadLifetime<T>(
  caller: AbortSignal, execute: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  caller.throwIfAborted();
  const deadline = new AbortController();
  const signal = AbortSignal.any([caller, deadline.signal]);
  let rejectStopped!: (reason: unknown) => void;
  const stopped = new Promise<never>((_resolve, reject) => { rejectStopped = reject; });
  const interrupt = () => rejectStopped(signal.reason);
  signal.addEventListener("abort", interrupt, { once: true });
  const timer = setTimeout(() => deadline.abort(unavailable()), readDeadlineMs);
  try {
    const result = await Promise.race([execute(signal), stopped]);
    signal.throwIfAborted();
    return result;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", interrupt);
  }
}

async function currentSession(signal: AbortSignal, expectedActor?: string) {
  signal.throwIfAborted();
  const admission = await readCustomerAdmission(signal);
  signal.throwIfAborted();
  if (!admission.enabled) throw unavailable();
  const session = admission.session;
  if (session?.role !== "customer" ||
      (expectedActor !== undefined && session.actorId !== expectedActor) ||
      !(Date.parse(session.sessionExpiresAt) > Date.now())) {
    throw unauthorized();
  }
  return session;
}

export function verifyCartDirectorySession(signal: AbortSignal, actor?: string) {
  return withinReadLifetime(signal, current => currentSession(current, actor));
}

async function readWeb(
  actor: string, after: string | undefined, signal: AbortSignal,
): Promise<DirectoryRead> {
  signal.throwIfAborted();
  const path = after === undefined ? route : route + "?after=" + after;
  const response = await fetch(path, {
    method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error", signal,
    headers: { "X-Customer-Context": actor },
  });

  if (signal.aborted || response.status !== 200 ||
      response.headers.get("Cache-Control")?.toLowerCase() !== "no-store") {
    discardCustomerResponse(response);
    signal.throwIfAborted();
    const denied = response.status === 401 || response.status === 403;
    throw new DshPublicError(denied ? 401 : 503, "DIRECTORY_REQUEST_REJECTED");
  }

  // Transfer ownership of the body to the bounded JSON reader once.
  const body = await readBoundedCustomerJSON({
    headers: response.headers, body: response.body, signal,
  }, pageByteLimit);
  signal.throwIfAborted();
  const value = parseCustomerCartDirectory(body, actor, after);
  const current = await currentSession(signal, actor);
  return { value, expiresAt: Date.parse(current.sessionExpiresAt) };
}

async function readNative(
  actor: string, after: string | undefined, signal: AbortSignal,
): Promise<DirectoryRead> {
  signal.throwIfAborted();
  if (!nativeOwner) throw unavailable();
  const origin = nativeOwner;
  const result = await withVerifiedNativeCustomerRead(signal, bearer => {
    signal.throwIfAborted();
    return listCurrentCustomerCarts(origin, bearer, actor, after, signal);
  }, actor);
  signal.throwIfAborted();
  if (result.kind !== "ready") {
    throw new DshPublicError(result.kind === "signed-out" ? 401 : 503, "DIRECTORY_REQUEST_REJECTED");
  }
  return { value: result.value, expiresAt: result.expiresAt };
}

export function readVerifiedCartDirectory(
  caller: AbortSignal, after?: string, actor?: string,
): Promise<DirectoryRead> {
  return withinReadLifetime(caller, async signal => {
    if (after !== undefined && (typeof after !== "string" || !/^[a-z0-9-]{1,64}$/.test(after))) {
      throw new DshPublicError(400, "INVALID_REQUEST");
    }
    const before = await currentSession(signal, actor);
    const initialExpiry = Date.parse(before.sessionExpiresAt);
    const result = await (Platform.OS === "web"
      ? readWeb(before.actorId, after, signal)
      : readNative(before.actorId, after, signal));
    signal.throwIfAborted();
    const expiresAt = Math.min(initialExpiry, result.expiresAt);
    if (result.value.actorId !== before.actorId || !(expiresAt > Date.now())) throw unauthorized();
    return { value: result.value, expiresAt };
  });
}
