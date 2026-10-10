import type { CreateFieldJoiningCaseDraftRequest, JoiningCaseView, StoreWorkingHoursInterval } from "@bthwani/dsh";

function matchesDraftText(expected: string | undefined, actual: string | null | undefined): boolean {
  return (expected ?? "").trim() === (actual ?? "").trim();
}

function hoursSignature(intervals: ReadonlyArray<StoreWorkingHoursInterval>): string {
  return intervals
    .map(({ dayOfWeek, opensAt, closesAt, closesNextDay }) => `${dayOfWeek}:${opensAt}:${closesAt}:${closesNextDay}`)
    .sort()
    .join("|");
}

function modesSignature(modes: ReadonlyArray<string>): string {
  return [...modes].sort().join("|");
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

export function fieldDraftMediaUploadConfirmed(
  uploaded: JoiningCaseView,
  canonical: JoiningCaseView,
  kind: "store" | "proof",
  previousVersion: number,
): boolean {
  if (uploaded.id !== canonical.id || uploaded.origin !== "field" ||
    uploaded.version <= previousVersion || canonical.version < uploaded.version) return false;
  if (kind === "proof") return uploaded.firstStoreProofImageUploaded && canonical.firstStoreProofImageUploaded;
  const submittedImage = uploaded.storeProfileImage;
  const savedImage = canonical.storeProfileImage;
  // The private DSH media readback includes the persisted URI and SHA-256.
  // Missing evidence or another stored image cannot confirm this particular upload.
  if (!submittedImage?.uri || !savedImage?.uri || !submittedImage.contentSha256 || !savedImage.contentSha256) return false;
  return submittedImage.uri === savedImage.uri && submittedImage.contentSha256 === savedImage.contentSha256;
}
