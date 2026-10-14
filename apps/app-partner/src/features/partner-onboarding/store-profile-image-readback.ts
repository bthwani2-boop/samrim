import type { JoiningCaseView, MediaProvenanceInput } from "@bthwani/dsh";

// DSH trims provenance text and lowercases the URI scheme before persisting.
function normalizedURI(uri: string | undefined): string {
  return (uri ?? "").trim().replace(/^https?:/i, (scheme) => scheme.toLowerCase());
}

export function partnerStoreImageReadbackMatches(
  actual: JoiningCaseView,
  expected: Readonly<{
    caseID: string;
    partnerActorID: string;
    role: "primary" | "cover";
    contentSha256: string;
    provenance: MediaProvenanceInput;
  }>,
): boolean {
  const image = expected.role === "cover" ? actual.storeCoverImage : actual.storeProfileImage;
  const stored = image?.provenance;
  const requested = expected.provenance;
  return Boolean(
    actual.id === expected.caseID &&
    expected.partnerActorID &&
    actual.partnerActorId === expected.partnerActorID &&
    image?.uri &&
    image.contentSha256 === expected.contentSha256 &&
    stored &&
    requested.rightsAttested &&
    stored.attestedByActorId === expected.partnerActorID &&
    stored.attestedAt &&
    stored.creator === requested.creator.trim() &&
    stored.sourceDescription === requested.sourceDescription.trim() &&
    normalizedURI(stored.sourceUri) === normalizedURI(requested.sourceUri) &&
    stored.rightsStatement === requested.rightsStatement.trim() &&
    normalizedURI(stored.rightsUri) === normalizedURI(requested.rightsUri),
  );
}
