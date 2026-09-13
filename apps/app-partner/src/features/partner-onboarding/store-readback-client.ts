import * as Crypto from "expo-crypto";
import { createDshMobileClient, type JoiningCaseResponse } from "@bthwani/dsh";
import { readIdentityAccessToken } from "../../bootstrap/identity";

function dshBaseUrl(): string {
  const explicit = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
  if (!explicit) throw new Error("DSH_BASE_URL_REQUIRED");
  return explicit;
}

function dshClient() {
  return createDshMobileClient(dshBaseUrl(), { cryptoRandomUUID: () => Crypto.randomUUID() });
}

function accessToken(): string {
  const token = readIdentityAccessToken();
  if (!token) throw new Error("DSH_PARTNER_SESSION_UNAVAILABLE");
  return token;
}

export async function readOwnJoiningCase(): Promise<JoiningCaseResponse> {
  return dshClient().readOwnJoiningCase(accessToken());
}

export async function correctAndResubmitOwnJoiningCase(caseID: string, businessName: string, firstStoreName: string, expectedVersion: number): Promise<JoiningCaseResponse> {
  return dshClient().correctAndResubmitJoiningCase(accessToken(), caseID, { businessName, firstStoreName }, expectedVersion);
}

export function isJoiningCaseNotFound(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { kind?: unknown; status?: unknown };
  return candidate.kind === "http" && candidate.status === 404;
}
