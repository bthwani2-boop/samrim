import type { VerifiedIdentitySession } from "@bthwani/identity";
import {
  type CustomerFundingHistory, type CustomerWalletBalance,
  parseCustomerFundingHistory, parseCustomerWalletBalance, WltReadError,
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

// Verify the same current Customer across the entire bounded owner read.
// The parser owns the financial response contract (including continuation).
async function readVerifiedFinance<T extends { actorId: string }>(
  admission: AdmissionReader, signal: AbortSignal, expectedActorId: string | undefined,
  path: string, maxBytes: number, parse: (body: unknown) => T,
): Promise<Result<T>> {
  const before = await admission(signal);
  signal.throwIfAborted();
  if (!before.enabled) return { kind: "unavailable" };
  const initial = before.session;
  if (initial?.role !== "customer" ||
    (expectedActorId !== undefined && initial.actorId !== expectedActorId) ||
    !(Date.parse(initial.sessionExpiresAt) > Date.now())) return { kind: "signed-out" };

  const response = await fetch(path, {
    method: "GET", credentials: "same-origin", redirect: "error", cache: "no-store", signal,
  });
  if (signal.aborted || response.status !== 200 || response.headers.get("Cache-Control")?.toLowerCase() !== "no-store") {
    void response.body?.cancel().catch(() => {});
    signal.throwIfAborted();
    return { kind: response.status === 401 || response.status === 403 ? "signed-out" : "unavailable" };
  }
  const body = await readBoundedCustomerJSON({ headers: response.headers, body: response.body, signal }, maxBytes);
  signal.throwIfAborted();
  if (body === null) {
    void response.body?.cancel().catch(() => {});
    throw new WltReadError(502);
  }
  const value = parse(body);

  const after = await admission(signal);
  signal.throwIfAborted();
  const current = after.session;
  if (!after.enabled || current?.role !== "customer" ||
    initial.actorId !== current.actorId || current.actorId !== value.actorId) return { kind: "signed-out" };
  const expiresAt = Math.min(Date.parse(initial.sessionExpiresAt), Date.parse(current.sessionExpiresAt));
  return expiresAt > Date.now() ? { kind: "ready", value, expiresAt } : { kind: "signed-out" };
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
  if (cursor !== undefined && !/^[A-Za-z0-9_-]{20,240}$/.test(cursor)) {
    return { kind: "unavailable" };
  }
  const path = "/api/customer-auth/wallet-transactions" +
    (cursor === undefined ? "" : "?cursor=" + encodeURIComponent(cursor));
  const result = await readVerifiedFinance(readCustomerAdmission, signal, expectedActorId,
    path, 8192, body => parseCustomerFundingHistory(body, cursor));
  return result.kind === "ready"
    ? { kind: "ready", history: result.value, expiresAt: result.expiresAt } : result;
}
