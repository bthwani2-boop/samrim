import type { VerifiedIdentitySession } from "@bthwani/identity";
import {
  type CustomerFundingHistory,
  type CustomerWalletBalance,
  parseCustomerFundingHistory,
  parseCustomerWalletBalance,
  WltReadError,
} from "@bthwani/wlt";
import { readBoundedCustomerJSON } from "../access/bounded-customer-json";

type AdmissionReader = (signal: AbortSignal) =>
  Promise<{ enabled: boolean; session: VerifiedIdentitySession | null }>;
type Result<T> = { kind: "ready"; value: T; expiresAt: number } |
  { kind: "signed-out" | "unavailable" };

export type WalletReadState =
  | { kind: "ready"; balance: CustomerWalletBalance; expiresAt: number }
  | { kind: "signed-out" | "unavailable" };
export type WalletTransactionsReadState =
  | { kind: "ready"; history: CustomerFundingHistory; expiresAt: number }
  | { kind: "signed-out" | "unavailable" };

function discardEnvelope(response: Response): void {
  try {
    const body = response.body;
    if (body && !body.locked && !response.bodyUsed) void body.cancel().catch(() => {});
  } catch {
    // A rejected envelope remains rejected even when cleanup fails.
  }
}

function sessionExpiry(session: VerifiedIdentitySession | null, expectedActorId?: string): number {
  if (session?.role !== "customer" ||
    (expectedActorId !== undefined && session.actorId !== expectedActorId)) return 0;
  return Date.parse(session.sessionExpiresAt);
}

// One caller cancellation boundary owns both Identity reads and the WLT reply.
// Every late stage checks cancellation before dispatching or publishing anything.
async function readVerifiedFinance<T extends { actorId: string }>(
  admission: AdmissionReader, signal: AbortSignal, expectedActorId: string | undefined,
  path: string, maxBytes: number, parse: (body: unknown) => T,
): Promise<Result<T>> {
  signal.throwIfAborted();
  let rejectStopped!: (reason: unknown) => void;
  const stopped = new Promise<never>((_resolve, reject) => { rejectStopped = reject; });
  const interrupt = () => rejectStopped(signal.reason);
  signal.addEventListener("abort", interrupt, { once: true });

  async function read(): Promise<Result<T>> {
    const before = await admission(signal);
    signal.throwIfAborted();
    if (!before.enabled) return { kind: "unavailable" };
    const initial = before.session;
    const initialExpiry = sessionExpiry(initial, expectedActorId);
    if (!initial || !(initialExpiry > Date.now())) return { kind: "signed-out" };

    const response = await fetch(path, {
      method: "GET", credentials: "same-origin", redirect: "error", cache: "no-store", signal,
    });
    if (signal.aborted || response.status !== 200 ||
      response.headers.get("Cache-Control")?.toLowerCase() !== "no-store") {
      discardEnvelope(response);
      signal.throwIfAborted();
      return { kind: response.status === 401 || response.status === 403 ? "signed-out" : "unavailable" };
    }
    // Once handed over, the bounded reader alone owns consumption and cancellation.
    const body = await readBoundedCustomerJSON({ headers: response.headers, body: response.body, signal }, maxBytes);
    signal.throwIfAborted();
    if (body === null) throw new WltReadError(502);
    const value = parse(body);

    const after = await admission(signal);
    signal.throwIfAborted();
    const expiresAt = Math.min(initialExpiry, sessionExpiry(after.session, initial.actorId));
    if (!after.enabled || value.actorId !== initial.actorId || !(expiresAt > Date.now())) {
      return { kind: "signed-out" };
    }
    return { kind: "ready", value, expiresAt };
  }

  try {
    const result = await Promise.race([read(), stopped]);
    signal.throwIfAborted();
    return result;
  } finally {
    signal.removeEventListener("abort", interrupt);
  }
}

export async function readVerifiedWallet(
  readCustomerAdmission: AdmissionReader, signal: AbortSignal, expectedActorId?: string,
): Promise<WalletReadState> {
  const result = await readVerifiedFinance(readCustomerAdmission, signal, expectedActorId,
    "/api/customer-auth/wallet", 4096, parseCustomerWalletBalance);
  return result.kind === "ready"
    ? { kind: "ready", balance: result.value, expiresAt: result.expiresAt } : result;
}

export async function readVerifiedWalletTransactions(
  readCustomerAdmission: AdmissionReader, signal: AbortSignal, cursor?: string,
  expectedActorId?: string,
): Promise<WalletTransactionsReadState> {
  signal.throwIfAborted();
  if (cursor !== undefined && (typeof cursor !== "string" || !/^[A-Za-z0-9_-]{20,240}$/.test(cursor))) {
    return { kind: "unavailable" };
  }
  const path = "/api/customer-auth/wallet-transactions" +
    (cursor === undefined ? "" : "?cursor=" + encodeURIComponent(cursor));
  const result = await readVerifiedFinance(readCustomerAdmission, signal, expectedActorId,
    path, 8192, body => parseCustomerFundingHistory(body, cursor));
  return result.kind === "ready"
    ? { kind: "ready", history: result.value, expiresAt: result.expiresAt } : result;
}
