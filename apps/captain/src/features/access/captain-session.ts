import { parseVerifiedIdentitySession, type VerifiedIdentitySession } from "@bthwani/identity";

/** Presentation check for an Identity-verified session; never an authentication authority. */
export type CaptainSessionView = Readonly<VerifiedIdentitySession & { role: "captain" }>;

export function hasActiveCaptainSession(value: unknown): value is CaptainSessionView {
  try {
    return parseVerifiedIdentitySession(value).role === "captain";
  } catch {
    return false;
  }
}
