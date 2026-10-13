import type { CorrectJoiningCaseRequest, JoiningCaseView, StoreWeeklyWorkingHours } from "@bthwani/dsh";

function hoursFingerprint(value: StoreWeeklyWorkingHours | null | undefined): string {
  return (value?.intervals ?? [])
    .map(({ dayOfWeek, opensAt, closesAt, closesNextDay }) =>
      `${dayOfWeek}:${opensAt}:${closesAt}:${closesNextDay ? 1 : 0}`)
    .sort()
    .join("|");
}

function modesFingerprint(value: ReadonlyArray<string>): string {
  return [...value].sort().join("|");
}

// Identical corrections for the same case version must use the same idempotency
// identity after a lost response; changed facts must not silently replay old facts.
export function partnerCorrectionIdentityPayload(
  caseID: string,
  expectedVersion: number,
  input: CorrectJoiningCaseRequest,
): string {
  return JSON.stringify([
    caseID, expectedVersion, input.ownerFullName, input.businessName, input.firstStoreName,
    input.firstStoreAddress, input.serviceCityId, input.firstStoreVerticalId,
    input.firstStoreCommercialTypeId, input.firstStoreLatitude, input.firstStoreLongitude,
    hoursFingerprint(input.firstStoreWorkingHours), input.firstStoreProofType,
    input.firstStoreProofNumber, input.firstStoreNotes ?? "",
    modesFingerprint(input.firstStoreFulfillmentModes),
  ]);
}

// Only canonical DSH submission state and public facts can confirm recovery.
// The private proof number is encrypted: its exact contents cannot be read back here.
export function partnerCorrectionPublicReadbackMatches(
  caseID: string,
  input: CorrectJoiningCaseRequest,
  actual: JoiningCaseView,
): boolean {
  return actual.id === caseID
    && actual.state === "submitted"
    && actual.ownerFullName === input.ownerFullName
    && actual.businessName === input.businessName
    && actual.firstStoreName === input.firstStoreName
    && actual.firstStoreAddress === input.firstStoreAddress
    && actual.serviceCityId === input.serviceCityId
    && actual.firstStoreVerticalId === input.firstStoreVerticalId
    && actual.firstStoreCommercialTypeId === input.firstStoreCommercialTypeId
    && actual.firstStoreLatitude === input.firstStoreLatitude
    && actual.firstStoreLongitude === input.firstStoreLongitude
    && hoursFingerprint(actual.firstStoreWorkingHours) === hoursFingerprint(input.firstStoreWorkingHours)
    && actual.firstStoreProofType === input.firstStoreProofType
    && actual.firstStoreProofNumberPresent
    && (actual.firstStoreNotes ?? "") === (input.firstStoreNotes ?? "")
    && modesFingerprint(actual.firstStoreFulfillmentModes) === modesFingerprint(input.firstStoreFulfillmentModes);
}
