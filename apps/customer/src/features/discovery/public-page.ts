import type { PublicPage } from "@bthwani/dsh";

// An owner rejection is not an outage. Only an explicit temporary outage
// permits keeping an already verified snapshot for a continuation retry.
export function publicFailureCode(reason: unknown): string {
  return reason instanceof Error && reason.message ? reason.message : "UNKNOWN";
}

export function retainsPublicContinuation(code: string): boolean {
  return code === "OWNER_NETWORK_UNAVAILABLE" || code === "OWNER_UNAVAILABLE";
}

// Admission of a continuation is atomic: never mix revisions or repeated IDs.
export function mergePublicPage<T>(
  items: readonly T[],
  revision: number | undefined,
  cursor: string | undefined,
  page: PublicPage<T>,
  key: (item: T) => string,
): T[] | null {
  if (cursor !== undefined && (page.revision !== revision || page.nextCursor === cursor)) return null;
  const seen = new Set(items.map(key));
  for (const item of page.items) {
    const id = key(item);
    if (seen.has(id)) return null;
    seen.add(id);
  }
  return [...items, ...page.items];
}
