import {
  type CustomerFundingHistory, type CustomerWalletBalance,
  isolatedNativeWltOrigin, readCurrentCustomerWallet, readCurrentCustomerWalletTransactions, WltReadError,
} from "@bthwani/wlt";
import { isDevice } from "expo-device";
import { Platform } from "react-native";
import { withVerifiedNativeCustomerRead } from "../access/customer-session-transport";

export type NativeWalletRead =
  | { kind: "ready"; balance: CustomerWalletBalance; expiresAt: number }
  | { kind: "signed-out" | "unavailable" };

export type NativeWalletHistoryRead =
  | { kind: "ready"; history: CustomerFundingHistory; expiresAt: number }
  | { kind: "signed-out" | "unavailable" };

async function readNativeFinance<T extends { actorId: string }>(
  signal: AbortSignal, readOwner: (origin: string, bearer: string) => Promise<T>,
  expectedActorId?: string,
): Promise<{ kind: "ready"; value: T; expiresAt: number } | { kind: "signed-out" | "unavailable" }> {
  const origin = isolatedNativeWltOrigin(Platform.OS, isDevice,
    process.env.EXPO_PUBLIC_CUSTOMER_SYNTHETIC_IDENTITY_ORIGIN,
    process.env.EXPO_PUBLIC_CUSTOMER_SYNTHETIC_WLT_ORIGIN);
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

export async function readNativeWallet(signal: AbortSignal, expectedActorId?: string): Promise<NativeWalletRead> {
  const result = await readNativeFinance(signal, (origin, bearer) =>
    readCurrentCustomerWallet(origin, bearer, signal), expectedActorId);
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
