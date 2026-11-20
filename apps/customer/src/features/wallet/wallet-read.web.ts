import type { VerifiedIdentitySession } from "@bthwani/identity";
import {
  type CustomerFundingHistory, type CustomerWalletBalance,
  parseCustomerFundingHistory, parseCustomerWalletBalance,
} from "@bthwani/wlt";

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

// Both financial reads confirm the browser's current Customer twice.
// A Store, Merchant or old Customer cannot be inherited from a previous view.
async function readVerifiedFinance<T extends { actorId: string }>(
  path: string, parse: (body: unknown) => T,
  readCustomerAdmission: AdmissionReader, signal: AbortSignal, expectedActorId?: string,
): Promise<Result<T>> {
  const before = await readCustomerAdmission(signal);
  if (!before.enabled) return { kind: "unavailable" };
  if (before.session?.role !== "customer" ||
    (expectedActorId !== undefined && before.session.actorId !== expectedActorId) ||
    Date.parse(before.session.sessionExpiresAt) <= Date.now()) return { kind: "signed-out" };
  const response = await fetch(path, {
    method: "GET", credentials: "same-origin", redirect: "error", cache: "no-store", signal,
  });
  if (response.status === 401 || response.status === 403) return { kind: "signed-out" };
  if (response.status !== 200 || response.headers.get("Cache-Control")?.toLowerCase() !== "no-store") {
    return { kind: "unavailable" };
  }
  const value = parse(await response.json());
  const after = await readCustomerAdmission(signal);
  signal.throwIfAborted();
  if (!after.enabled || after.session?.role !== "customer" ||
    before.session.actorId !== after.session.actorId ||
    after.session.actorId !== value.actorId) return { kind: "signed-out" };
  const expiresAt = Math.min(Date.parse(before.session.sessionExpiresAt), Date.parse(after.session.sessionExpiresAt));
  return expiresAt > Date.now() ? { kind: "ready", value, expiresAt } : { kind: "signed-out" };
}

export async function readVerifiedWallet(
  readCustomerAdmission: AdmissionReader, signal: AbortSignal,
): Promise<WalletReadState> {
  const result = await readVerifiedFinance("/api/customer-auth/wallet",
    parseCustomerWalletBalance, readCustomerAdmission, signal);
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
    (cursor === undefined ? "" : `?cursor=${encodeURIComponent(cursor)}`);
  const result = await readVerifiedFinance(path,
    parseCustomerFundingHistory, readCustomerAdmission, signal, expectedActorId);
  return result.kind === "ready"
    ? { kind: "ready", history: result.value, expiresAt: result.expiresAt } : result;
}
