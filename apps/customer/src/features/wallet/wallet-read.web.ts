import { parseCustomerWalletBalance, type CustomerWalletBalance } from "@bthwani/wlt";
import type { VerifiedIdentitySession } from "@bthwani/identity";

export type WalletReadState =
  | { kind: "ready"; balance: CustomerWalletBalance; expiresAt: number }
  | { kind: "signed-out" | "unavailable" };

export async function readVerifiedWallet(
  readCustomerAdmission: (signal: AbortSignal) => Promise<{ enabled: boolean; session: VerifiedIdentitySession | null }>,
  signal: AbortSignal,
): Promise<WalletReadState> {
  const before = await readCustomerAdmission(signal);
  if (!before.enabled) return { kind: "unavailable" };
  if (!before.session) return { kind: "signed-out" };
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
  if (!after.enabled || !after.session || before.session.actorId !== after.session.actorId ||
    after.session.actorId !== balance.actorId) return { kind: "signed-out" };
  const expiresAt = Math.min(Date.parse(before.session.sessionExpiresAt), Date.parse(after.session.sessionExpiresAt));
  return expiresAt > Date.now() ? { kind: "ready", balance, expiresAt } : { kind: "signed-out" };
}
