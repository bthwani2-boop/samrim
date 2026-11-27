import { DshPublicError, onlyKeys } from "./client-core.ts";
import { dshOperations } from "./generated/dsh-operations.ts";
import type { StoreRegistrationRelation } from "./operator-store-registration-policy.ts";
import { privateOwnerRequest } from "./private-owner-request.ts";

export type PublicationReviewItem = {
  id: string;
  name: string;
  verticalId: string;
  cityActive: boolean;
  verticalActive: boolean;
  locationRecorded: boolean;
  registrationTermsRecorded: boolean;
  weeklyHoursRecorded: boolean;
  catalogRecorded: boolean;
};
export type PublicationReviewPage = {
  cityId: string;
  relation: StoreRegistrationRelation;
  items: PublicationReviewItem[];
  nextCursor?: string;
};

const pageLimit = 20;
const booleanFields = [
  "cityActive", "verticalActive", "locationRecorded",
  "registrationTermsRecorded", "weeklyHoursRecorded", "catalogRecorded",
] as const;
const itemFields = ["id", "name", "verticalId", ...booleanFields];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPublicId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9-]{1,64}$/u.test(value);
}

function isScope(city: unknown, relation: unknown): boolean {
  return isPublicId(city) && (relation === "DIRECT" || relation === "MARKETPLACE");
}

function isName(value: unknown): value is string {
  // Store creation uses Go Unicode whitespace, rune length and control checks.
  // BOM is not whitespace in Go; unpaired JS surrogates are not Unicode scalars.
  return typeof value === "string" && [...value].length <= 120
    && /\P{White_Space}/u.test(value) && !/[\p{Cc}\p{Cs}]/u.test(value);
}

function isReviewItem(value: unknown, previous: string): value is PublicationReviewItem {
  return isRecord(value) && onlyKeys(value, itemFields)
    && Object.keys(value).length === itemFields.length
    && isPublicId(value.id) && value.id > previous
    && isName(value.name) && isPublicId(value.verticalId)
    && booleanFields.every(key => typeof value[key] === "boolean");
}

/** Observed facts only: this projection never confers publication approval. */
export function isPublicationReviewPage(
  value: unknown, city: string, relation: StoreRegistrationRelation, after = "",
): value is PublicationReviewPage {
  if (!isScope(city, relation) || (after !== "" && !isPublicId(after))
    || !isRecord(value) || !onlyKeys(value, ["cityId", "relation", "items", "nextCursor"])
    || value.cityId !== city || value.relation !== relation
    || !Array.isArray(value.items) || value.items.length > pageLimit) return false;

  // IDs are ASCII and the owner uses PostgreSQL C collation. The exclusive
  // cursor and strictly increasing row IDs must agree with that order.
  let previous = after;
  for (const item of value.items) {
    if (!isReviewItem(item, previous)) return false;
    previous = item.id;
  }
  return value.nextCursor === undefined
    || (value.items.length === pageLimit && value.nextCursor === previous);
}

export async function listOperatorStorePublicationReview(
  origin: string, city: string, relation: StoreRegistrationRelation, bearer: string,
  after?: string, signal?: AbortSignal,
): Promise<PublicationReviewPage> {
  if (!isScope(city, relation) || (after !== undefined && !isPublicId(after))) {
    throw new DshPublicError(400, "INVALID_REQUEST");
  }
  if (typeof bearer !== "string" || !/^[A-Za-z0-9_-]{43}$/u.test(bearer)) {
    throw new DshPublicError(401, "UNAUTHENTICATED");
  }
  const path = dshOperations.listOperatorStorePublicationReview.path
    .replace("{cityID}", city).replace("{relation}", relation);
  const result = await privateOwnerRequest(origin, after === undefined ? path : path + "?after=" + after,
    bearer, "GET", undefined, signal);
  if (!isPublicationReviewPage(result, city, relation, after)) {
    throw new DshPublicError(502, "OWNER_RESPONSE_INVALID");
  }
  return result;
}
