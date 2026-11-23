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
const publicId = /^[a-z0-9-]{1,64}$/;
const booleanFields = ["cityActive", "verticalActive", "locationRecorded", "registrationTermsRecorded", "weeklyHoursRecorded", "catalogRecorded"] as const;
const itemFields = ["id", "name", "verticalId", ...booleanFields];
export function isPublicationReviewPage(value: unknown, city: string, relation: StoreRegistrationRelation, after = ""): value is PublicationReviewPage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const page = value as Record<string, unknown>;
  if (!onlyKeys(page, ["cityId", "relation", "items", "nextCursor"]) ||
    page.cityId !== city || page.relation !== relation || !Array.isArray(page.items) ||
    page.items.length > 20) return false;
  let previous = after;
  for (const raw of page.items) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
    const item = raw as Record<string, unknown>;
    if (!onlyKeys(item, itemFields) || Object.keys(item).length !== itemFields.length ||
      typeof item.id !== "string" || !publicId.test(item.id) || item.id <= previous ||
      typeof item.name !== "string" || [...item.name.trim()].length < 1 || [...item.name].length > 120 ||
      typeof item.verticalId !== "string" || !publicId.test(item.verticalId) ||
      !booleanFields.every(key => typeof item[key] === "boolean")) return false;
    previous = item.id;
  }
  return page.nextCursor === undefined ||
    (page.items.length === 20 && typeof page.nextCursor === "string" && page.nextCursor === previous);
}
export async function listOperatorStorePublicationReview(
  origin: string, city: string, relation: StoreRegistrationRelation, bearer: string,
  after?: string, signal?: AbortSignal,
): Promise<PublicationReviewPage> {
  if (!publicId.test(city) || (relation !== "DIRECT" && relation !== "MARKETPLACE") ||
    (after !== undefined && !publicId.test(after))) throw new DshPublicError(400, "INVALID_REQUEST");
  if (!/^[A-Za-z0-9_-]{43}$/.test(bearer)) throw new DshPublicError(401, "UNAUTHENTICATED");
  const path = dshOperations.listOperatorStorePublicationReview.path
    .replace("{cityID}", city).replace("{relation}", relation);
  const result = await privateOwnerRequest(origin, after ? `${path}?after=${after}` : path, bearer, "GET", undefined, signal);
  if (!isPublicationReviewPage(result, city, relation, after)) {
    throw new DshPublicError(502, "OWNER_RESPONSE_INVALID");
  }
  return result;
}
