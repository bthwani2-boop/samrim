export type PreviousCommercialAgreement = Readonly<{
  status: string;
  agreementVersion: number;
}>;

// Never overwrite an active or pending agreement, and do not silently retry
// a financially rejected proposal without a new monotonic version.
export function initialZeroCommissionProposalVersion(agreements: readonly PreviousCommercialAgreement[]): number | null {
  if (agreements.length === 0) return 0;
  const versions = new Set<number>();
  for (const agreement of agreements) {
    if (agreement.status !== "FINANCE_REJECTED" || !Number.isSafeInteger(agreement.agreementVersion) || agreement.agreementVersion < 1 || versions.has(agreement.agreementVersion)) return null;
    versions.add(agreement.agreementVersion);
  }
  const maximum = Math.max(...versions);
  if (versions.size !== maximum) return null;
  return maximum;
}