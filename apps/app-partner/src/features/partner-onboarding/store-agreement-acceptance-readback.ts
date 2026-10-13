import type { StoreCommercialAgreement } from "./store-commercial-agreement-client";

export function isConfirmedOwnStoreAgreementAcceptance(
  candidate: StoreCommercialAgreement | undefined,
  expected: Readonly<{
    storeID: string;
    actorID: string;
    agreementID: string;
    expectedVersion: number;
  }>,
): boolean {
  return Boolean(
    candidate &&
    candidate.storeId === expected.storeID &&
    candidate.partnerActorId === expected.actorID &&
    candidate.agreementId === expected.agreementID &&
    candidate.agreementVersion >= expected.expectedVersion &&
    (candidate.status === "PARTNER_ACCEPTED" || candidate.status === "ACTIVE") &&
    candidate.partnerAcceptedByActorId === expected.actorID &&
    Boolean(candidate.partnerAcceptedAt),
  );
}
