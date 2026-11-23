import {
  type CustomerFundingHistory, type CustomerWalletBalance,
  readCurrentCustomerWallet, readCurrentCustomerWalletTransactions, WltReadError,
} from "@bthwani/wlt";
import { Platform } from "react-native";
import { withVerifiedNativeCustomerRead } from "../access/customer-session-transport";

export type NativeWalletRead =
  | { kind: "ready"; balance: CustomerWalletBalance; expiresAt: number }
  | { kind: "signed-out" | "unavailable" };

export type NativeWalletHistoryRead =
  | { kind: "ready"; history: CustomerFundingHistory; expiresAt: number }
  | { kind: "signed-out" | "unavailable" };

// Only the opt-in isolated Android emulator may contact the WLT loopback owner.
// No production URL, physical device LAN address, or automatic host fallback.
function nativeWalletOrigin(): string | null {
  if (Platform.OS !== "android" ||
    process.env.EXPO_PUBLIC_BTHWANI_SURFACE_PREVIEW !== "1") return null;
  const origin = process.env.EXPO_PUBLIC_CUSTOMER_SYNTHETIC_WLT_ORIGIN ?? "";
  const match = /^http:\/\/10\.0\.2\.2:([1-9][0-9]{0,4})$/.exec(origin);
  return match && Number(match[1]) <= 65535 ? origin : null;
}

async function readNativeFinance<T extends { actorId: string }>(
  signal: AbortSignal, readOwner: (origin: string, bearer: string) => Promise<T>,
  expectedActorId?: string,
): Promise<{ kind: "ready"; value: T; expiresAt: number } | { kind: "signed-out" | "unavailable" }> {
  const origin = nativeWalletOrigin();
  if (!origin) return { kind: "unavailable" };
  try {
    return await withVerifiedNativeCustomerRead(signal, bearer => readOwner(origin, bearer), expectedActorId);
  } catch (error) {
    if (signal.aborted) throw error;
    if (error instanceof WltReadError && (error.status === 401 || error.status === 403)) {
      return { kind: "signed-out" };
    }
    return { kind: "unavailable" };
  }
}

export async function readNativeWallet(signal: AbortSignal): Promise<NativeWalletRead> {
  const result = await readNativeFinance(signal, (origin, bearer) =>
    readCurrentCustomerWallet(origin, bearer, signal));
  return result.kind === "ready"
    ? { kind: "ready", balance: result.value, expiresAt: result.expiresAt } : result;
}

export async function readNativeWalletTransactions(
  signal: AbortSignal, cursor?: string, expectedActorId?: string,
): Promise<NativeWalletHistoryRead> {
  const result = await readNativeFinance(signal,
    (origin, bearer) => readCurrentCustomerWalletTransactions(origin, bearer, signal, cursor), expectedActorId);
  return result.kind === "ready"
    ? { kind: "ready", history: result.value, expiresAt: result.expiresAt } : result;
}
