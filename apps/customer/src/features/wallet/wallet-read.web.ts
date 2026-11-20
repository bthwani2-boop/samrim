import type { VerifiedIdentitySession } from "@bthwani/identity";
import { type CustomerWalletBalance, parseCustomerWalletBalance } from "@bthwani/wlt";

export type WalletReadState =
  | { kind: "ready"; balance: CustomerWalletBalance; expiresAt: number }
  | { kind: "signed-out" | "unavailable" };

export async function readVerifiedWallet(
  readCustomerAdmission: (signal: AbortSignal) => Promise<{ enabled: boolean; session: VerifiedIdentitySession | null }>,
  signal: AbortSignal,
): Promise<WalletReadState> {
  const before = await readCustomerAdmission(signal);
  if (!before.enabled) return { kind: "unavailable" };
  if (before.session?.role !== "customer" ||
    Date.parse(before.session.sessionExpiresAt) <= Date.now()) return { kind: "signed-out" };
  const response = await fetch("/api/customer-auth/wallet", {
    method: "GET", credentials: "same-origin", redirect: "error", cache: "no-store", signal,
  });
  if (response.status === 401 || response.status === 403) return { kind: "signed-out" };
  if (response.status !== 200 || response.headers.get("Cache-Control")?.toLowerCase() !== "no-store") {
    return { kind: "unavailable" };
  }
  const balance = parseCustomerWalletBalance(await response.json());
  const after = await readCustomerAdmission(signal);
  signal.throwIfAborted();
  if (!after.enabled || !after.session || after.session.role !== "customer" ||
    before.session.actorId !== after.session.actorId ||
    after.session.actorId !== balance.actorId) return { kind: "signed-out" };
  const expiresAt = Math.min(Date.parse(before.session.sessionExpiresAt), Date.parse(after.session.sessionExpiresAt));
  return expiresAt > Date.now() ? { kind: "ready", balance, expiresAt } : { kind: "signed-out" };
}
