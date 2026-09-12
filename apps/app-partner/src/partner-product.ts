import { createDshMobileClient, type PartnerBootstrapResponse } from "@bthwani/dsh";
import { readIdentityAccessToken } from "./identity";

function dshBaseUrl(): string {
  const explicit = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
  if (!explicit) throw new Error("DSH_BASE_URL_REQUIRED");
  return explicit;
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
