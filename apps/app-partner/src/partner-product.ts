import Constants from "expo-constants";

import { createDshMobileClient, type PartnerBootstrapResponse } from "@bthwani/dsh";
import { readIdentityAccessToken } from "./identity";

function dshBaseUrl(): string {
  const explicit = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
  if (explicit) return explicit;
  const rawHostUri = (Constants.expoConfig as { hostUri?: string } | null)?.hostUri?.trim();
  if (!rawHostUri) throw new Error("DSH_BASE_URL_UNAVAILABLE");
  const normalized = rawHostUri.replace(/^[a-z]+:\/\//i, "");
  const host = normalized.startsWith("[") ? normalized.slice(0, normalized.indexOf("]") + 1) : normalized.split(":")[0];
  if (!host) throw new Error("DSH_BASE_URL_UNAVAILABLE");
  return `http://${host}:58080`;
}

export async function readOwnPartnerBootstrap(): Promise<PartnerBootstrapResponse> {
  const token = readIdentityAccessToken();
  if (!token) throw new Error("DSH_PARTNER_SESSION_UNAVAILABLE");
  return createDshMobileClient(dshBaseUrl()).readOwnPartnerBootstrap(token);
}

export function isPartnerBootstrapNotFound(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { kind?: unknown; status?: unknown };
  return candidate.kind === "http" && candidate.status === 404;
}
