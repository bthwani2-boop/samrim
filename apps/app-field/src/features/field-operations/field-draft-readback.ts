import type { CreateFieldJoiningCaseDraftRequest, JoiningCaseResponse, JoiningCaseView, MediaProvenance, MediaProvenanceInput, StoreWorkingHoursInterval } from "@bthwani/dsh";

function matchesDraftText(expected: string | undefined, actual: string | null | undefined): boolean {
  return (expected ?? "").trim() === (actual ?? "").trim();
}

function hoursSignature(intervals: ReadonlyArray<StoreWorkingHoursInterval>): string {
  return intervals
    .map(({ dayOfWeek, opensAt, closesAt, closesNextDay }) => `${dayOfWeek}:${opensAt}:${closesAt}:${closesNextDay}`)
    .sort((left, right) => left.localeCompare(right))
    .join("|");
}

function modesSignature(modes: ReadonlyArray<string>): string {
  return [...modes].sort((left, right) => left.localeCompare(right)).join("|");
}

// DSH draft create/update replaces the full snapshot; omitted fields clear to null or empty.
// Compare the normalized, persisted snapshot without depending on set ordering.
export function fieldDraftMatchesReadback(
  requested: CreateFieldJoiningCaseDraftRequest,
  actual: JoiningCaseView,
  minimumVersion: number,
): boolean {
  if (actual.state !== "draft" || actual.origin !== "field" || actual.version < minimumVersion) return false;
  if (actual.contactPhoneE164 !== requested.contactPhoneE164) return false;
  if (!matchesDraftText(requested.ownerFullName, actual.ownerFullName)) return false;
  if (!matchesDraftText(requested.businessName, actual.businessName)) return false;
  if (!matchesDraftText(requested.firstStoreName, actual.firstStoreName)) return false;
  if (!matchesDraftText(requested.walletProviderKey, actual.walletProviderKey)) return false;
  if (!matchesDraftText(requested.firstStoreAddress, actual.firstStoreAddress)) return false;
  if (!matchesDraftText(requested.serviceCityId, actual.serviceCityId)) return false;
  if (!matchesDraftText(requested.firstStoreVerticalId, actual.firstStoreVerticalId)) return false;
  if (!matchesDraftText(requested.firstStoreCommercialTypeId, actual.firstStoreCommercialTypeId)) return false;
  if (!matchesDraftText(requested.firstStoreProofType, actual.firstStoreProofType)) return false;
  if (!matchesDraftText(requested.firstStoreNotes, actual.firstStoreNotes)) return false;
  if (hoursSignature(requested.firstStoreWorkingHours?.intervals ?? []) !== hoursSignature(actual.firstStoreWorkingHours?.intervals ?? [])) return false;
  if (modesSignature(requested.firstStoreFulfillmentModes ?? []) !== modesSignature(actual.firstStoreFulfillmentModes)) return false;
  const latitude = requested.firstStoreLatitude ?? 0;
  const longitude = requested.firstStoreLongitude ?? 0;
  if (latitude === 0 && longitude === 0) {
    // DSH currently projects absent coordinates (NULL in PostgreSQL) as 0,0.
    // Both forms represent an unset draft location, never a chosen point.
    if ((actual.firstStoreLatitude != null && actual.firstStoreLatitude !== 0) ||
        (actual.firstStoreLongitude != null && actual.firstStoreLongitude !== 0)) return false;
  } else if (actual.firstStoreLatitude == null || actual.firstStoreLongitude == null ||
    Math.abs(actual.firstStoreLatitude - latitude) > 0.000001 ||
    Math.abs(actual.firstStoreLongitude - longitude) > 0.000001) return false;
  return true;
}

// A successful draft write followed by failed readback has an uncertain outcome;
// preserve its original idempotency identity instead of starting another write.
export function markFieldDraftReadbackUncertain(cause: unknown): Error {
  return Object.assign(new Error("FIELD_JOINING_CASE_CANONICAL_READBACK_UNAVAILABLE"), { cause });
}

// Only the post-upload canonical read is uncertain; an upload request failure keeps its own error classification.
export function markFieldMediaReadbackUncertain(cause: unknown): Error {
  return Object.assign(new Error("FIELD_MEDIA_UPLOAD_CANONICAL_READBACK_UNAVAILABLE"), { cause });
}

function normalizedProvenanceURI(value: string | undefined): string {
  return (value ?? "").trim().replace(/^https?:/i, (scheme) => scheme.toLowerCase());
}

function fieldImageRightsMatch(actual: MediaProvenance | null | undefined, expected: MediaProvenanceInput): boolean {
  return Boolean(actual && expected.rightsAttested &&
    actual.attestedByActorId && actual.attestedAt &&
    actual.creator === expected.creator.trim() &&
    actual.sourceDescription === expected.sourceDescription.trim() &&
    normalizedProvenanceURI(actual.sourceUri) === normalizedProvenanceURI(expected.sourceUri) &&
    actual.rightsStatement === expected.rightsStatement.trim() &&
    normalizedProvenanceURI(actual.rightsUri) === normalizedProvenanceURI(expected.rightsUri));
}

export function fieldDraftMediaUploadConfirmed(
  uploaded: JoiningCaseView,
  canonical: JoiningCaseView,
  kind: "store",
  previousVersion: number,
  expectedCaseID: string,
  expectedRights: MediaProvenanceInput,
): boolean {
  if (kind !== "store" || uploaded.id !== expectedCaseID || canonical.id !== expectedCaseID ||
    uploaded.origin !== "field" || canonical.origin !== "field" ||
    uploaded.version <= previousVersion || canonical.version < uploaded.version) return false;
  const submittedImage = uploaded.storeProfileImage;
  const savedImage = canonical.storeProfileImage;
  // The same image bytes and BOTH DSH rights records must match this upload.
  if (!submittedImage?.uri || !savedImage?.uri || !submittedImage.contentSha256 || !savedImage.contentSha256) return false;
  return submittedImage.uri === savedImage.uri &&
    submittedImage.contentSha256 === savedImage.contentSha256 &&
    fieldImageRightsMatch(submittedImage.provenance, expectedRights) &&
    fieldImageRightsMatch(savedImage.provenance, expectedRights) &&
    submittedImage.provenance?.attestedByActorId === savedImage.provenance?.attestedByActorId;
}

// Both Field submission entry points must reuse one idempotency identity
// for the same joining case and version after an uncertain network outcome.
export function fieldSubmitIdempotencyPayload(caseID: string, expectedVersion: number): string {
  return `field-submit:${caseID}:${expectedVersion}`;
}

type FieldSubmitReadback =
  | Readonly<{ kind: "confirmed"; canonical: JoiningCaseResponse }>
  | Readonly<{ kind: "draft"; canonical: JoiningCaseResponse }>
  | Readonly<{ kind: "unconfirmed" }>;

// A lost HTTP response is not permission to send another mutation: DSH may
// have committed the submission already. Recover from the canonical case
// before rendering success or advising a retry from the existing case list.
export async function submitFieldCaseWithReadback(
  caseID: string,
  submit: () => Promise<unknown>,
  read: () => Promise<JoiningCaseResponse>,
  isUncertain: (cause: unknown) => boolean,
): Promise<FieldSubmitReadback> {
  try {
    await submit();
  } catch (cause) {
    if (!isUncertain(cause)) throw cause;
    console.warn("DSH Field submission response uncertain", cause);
  }
  try {
    const canonical = await read();
    if (canonical.case.id !== caseID || canonical.case.origin !== "field") return { kind: "unconfirmed" };
    return canonical.case.state === "draft" ? { kind: "draft", canonical } : { kind: "confirmed", canonical };
  } catch (cause) {
    console.warn("DSH Field submission readback unavailable", cause);
    return { kind: "unconfirmed" };
  }
}

export function fieldReviewPhotoUploadConfirmed(
  uploaded: JoiningCaseView,
  canonical: JoiningCaseView,
  caseID: string,
  expectedVersion: number,
): boolean {
  return uploaded.id === caseID && canonical.id === caseID &&
    uploaded.origin === "field" && canonical.origin === "field" &&
    uploaded.version > expectedVersion && canonical.version >= uploaded.version &&
    uploaded.reviewPhotoUploaded && canonical.reviewPhotoUploaded;
}
