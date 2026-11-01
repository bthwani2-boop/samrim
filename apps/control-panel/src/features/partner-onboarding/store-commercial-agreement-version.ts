export type PreviousCommercialAgreement = Readonly<{
  status: string;
  agreementVersion: number;
}>;

// WLT owns the lifecycle. This read-only UI preflight keeps existing active
// agreements in force while allowing a newer explicit proposal for the same
// Store. WLT independently checks the version and pending state in a transaction.
export function nextStoreCommercialAgreementVersion(agreements: readonly PreviousCommercialAgreement[]): number | null {
  if (agreements.length === 0) return 0;
  const versions = new Set<number>();
  let activeVersion = 0;
  let hasSuperseded = false;
  for (const agreement of agreements) {
    const { status, agreementVersion } = agreement;
    if (!Number.isSafeInteger(agreementVersion) || agreementVersion < 1 || versions.has(agreementVersion)) return null;
    if (status === "PROPOSED" || status === "PARTNER_ACCEPTED") return null;
    if (!["ACTIVE", "SUPERSEDED", "FINANCE_REJECTED"].includes(status)) return null;
    if (status === "ACTIVE") {
      if (activeVersion !== 0) return null;
      activeVersion = agreementVersion;
    }
    if (status === "SUPERSEDED") hasSuperseded = true;
    versions.add(agreementVersion);
  }
  const highest = Math.max(...versions);
  if (versions.size !== highest || (hasSuperseded && activeVersion === 0) ||
    agreements.some(agreement => agreement.status === "SUPERSEDED" && agreement.agreementVersion >= activeVersion)) return null;
  return highest;
}
