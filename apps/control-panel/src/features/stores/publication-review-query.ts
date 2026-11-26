import type { StoreRegistrationRelation } from "@bthwani/dsh";

export type PublicationReviewScope = Readonly<{ city: string; relation: StoreRegistrationRelation; after?: string }>;

const publicId = /^[a-z0-9-]{1,64}$/;

export function parsePublicationReviewScope(input: Record<string, string | string[] | undefined>): PublicationReviewScope | null {
  if (Object.keys(input).some(key => !["city", "relation", "after"].includes(key))) return null;
  const { city, relation, after } = input;
  if (city === undefined && relation === undefined && after === undefined) return { city: "", relation: "MARKETPLACE" };
  if (typeof city !== "string" || !publicId.test(city) ||
    (relation !== "MARKETPLACE" && relation !== "DIRECT") ||
    (after !== undefined && (typeof after !== "string" || !publicId.test(after)))) return null;
  return { city, relation, ...(after ? { after } : {}) };
}

export function isReviewStoreInScope(storeId: string, scope: PublicationReviewScope): boolean {
  return Boolean(scope.city && publicId.test(storeId) && (!scope.after || storeId > scope.after));
}

export function publicationReviewHref(scope: PublicationReviewScope, storeId?: string): string {
  const query = new URLSearchParams({ city: scope.city, relation: scope.relation });
  if (scope.after) query.set("after", scope.after);
  const route = storeId ? `/merchants/stores/${encodeURIComponent(storeId)}` : "/merchants/joining";
  return `${route}?${query.toString()}`;
}
