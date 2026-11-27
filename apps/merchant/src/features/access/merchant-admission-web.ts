import { MerchantStandingError, standingFrom } from "@bthwani/dsh";
import {
  IdentityClientError, parseCustomerPhoneChallenge, parseVerifiedIdentitySession,
  type VerifiedIdentitySession,
} from "@bthwani/identity";
import { readMerchantJSON } from "./merchant-json.ts";

type Operation = "entry" | "standing" | "challenge" | "verify" | "logout";
type EntryState = { enabled: boolean; session: VerifiedIdentitySession | null };
const operations = {
  entry: { method: "GET", status: 200, limit: 4096 },
  standing: { method: "GET", status: 200, limit: 262144 },
  challenge: { method: "POST", status: 201, limit: 4096 },
  verify: { method: "POST", status: 200, limit: 4096 },
  logout: { method: "DELETE", status: 204, limit: 0 },
} as const;

function document(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function reject(operation: Operation, status: number, code: string): never {
  if (operation === "standing" && code === "STORE_ACCESS_DENIED" && (status === 401 || status === 403)) {
    throw new MerchantStandingError(status, code);
  }
  throw new IdentityClientError(status, code);
}

async function request(operation: Operation, signal: AbortSignal, data?: object): Promise<Record<string, unknown>> {
  const config = operations[operation];
  const writing = config.method !== "GET";
  const invalidCode = writing ? "OPERATION_RESULT_UNKNOWN" : "OWNER_RESPONSE_INVALID";
  const current = () => {
    if (signal.aborted) reject(operation, 0, writing ? "OPERATION_RESULT_UNKNOWN" : "OWNER_RESPONSE_STALE");
  };
  current();
  let reply: Response;
  try {
    reply = await fetch(operation === "standing" ? "/api/admission?stores=mine" : "/api/admission", {
      method: config.method, signal, credentials: "same-origin", cache: "no-store", redirect: "error",
      ...(data === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }),
    });
  } catch {
    current();
    reject(operation, 0, writing ? "OPERATION_RESULT_UNKNOWN" : "OWNER_NETWORK_UNAVAILABLE");
  }
  try {
    current();
    const noStore = reply.headers.get("Cache-Control")?.toLowerCase().split(",")
      .some(value => value.trim() === "no-store");
    if (!noStore || (reply.ok && reply.status !== config.status)) {
      reject(operation, 502, invalidCode);
    }
    if (reply.ok && operation === "logout") {
      if (reply.body !== null) reject(operation, 502, invalidCode);
      return {};
    }
    const body = document(await readMerchantJSON(reply, signal, reply.ok ? config.limit : 4096, 5000));
    current();
    if (!reply.ok) {
      const code = body && Object.keys(body).length === 1 && typeof body.code === "string" && body.code
        ? body.code : null;
      reject(operation, reply.status, writing && (reply.status >= 500 || !code)
        ? "OPERATION_RESULT_UNKNOWN" : code ?? "OWNER_UNAVAILABLE");
    }
    if (!body) reject(operation, 502, invalidCode);
    return body;
  } finally {
    try {
      if (reply.body && !reply.body.locked && !reply.bodyUsed) void reply.body.cancel().catch(() => {});
    } catch { /* Disposal must not replace the admission outcome. */ }
  }
}

function merchantSession(value: unknown): VerifiedIdentitySession {
  const session = parseVerifiedIdentitySession(value);
  if (session.role !== "merchant" || Date.parse(session.sessionExpiresAt) <= Date.now()) {
    throw new IdentityClientError(502, "OWNER_RESPONSE_INVALID");
  }
  return session;
}

export async function readBrowserAdmission(signal: AbortSignal): Promise<EntryState> {
  const body = await request("entry", signal);
  if (Object.keys(body).length !== 2 || typeof body.enabled !== "boolean" ||
    !Object.hasOwn(body, "session") || (!body.enabled && body.session !== null)) {
    throw new IdentityClientError(502, "OWNER_RESPONSE_INVALID");
  }
  return { enabled: body.enabled, session: body.session === null ? null : merchantSession(body.session) };
}

export async function readBrowserStanding(signal: AbortSignal) {
  const body = await request("standing", signal);
  if (Object.keys(body).length !== 1 || !Object.hasOwn(body, "standing")) {
    throw new MerchantStandingError(502, "OWNER_RESPONSE_INVALID");
  }
  return standingFrom(body.standing);
}

export async function requestBrowserAdmissionCode(phone: string, signal: AbortSignal): Promise<string> {
  return parseCustomerPhoneChallenge(await request("challenge", signal, { phone }));
}

export async function submitBrowserAdmissionCode(ticket: string, code: string, signal: AbortSignal): Promise<VerifiedIdentitySession> {
  const body = await request("verify", signal, { ticket, code });
  try {
    if (Object.keys(body).length !== 1 || !Object.hasOwn(body, "session")) {
      throw new IdentityClientError(502, "OWNER_RESPONSE_INVALID");
    }
    return merchantSession(body.session);
  } catch {
    throw new IdentityClientError(502, "OPERATION_RESULT_UNKNOWN");
  }
}

export async function signOutBrowserAdmission(signal: AbortSignal): Promise<void> {
  await request("logout", signal);
}
