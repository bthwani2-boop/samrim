/** Query-only presentation inputs for public DSH Store Offer inspection. */
export type PublishedOfferQuery = Readonly<{
  storeId: string;
  query: string;
  cursor?: string;
}>;

const publicId = /^[a-z0-9-]{1,64}$/;
const publicCursor = /^[A-Za-z0-9_-]{1,512}$/;

export function parsePublishedOfferQuery(
  params: Record<string, string | string[] | undefined>,
): PublishedOfferQuery | null {
  if (Object.keys(params).some(key => !["store", "q", "cursor"].includes(key))) return null;
  const { store, q, cursor } = params;
  if ([store, q, cursor].some(Array.isArray)) return null;
  if (store === undefined && q === undefined && cursor === undefined) {
    return { storeId: "", query: "" };
  }
  if (typeof store !== "string" || !publicId.test(store)) return null;
  const query = typeof q === "string" ? q.trim() : "";
  if (q !== undefined && (typeof q !== "string" || Array.from(q).length > 80 ||
    Array.from(q).some(char => {
      const point = char.codePointAt(0) ?? 0;
      return point < 32 || point === 127 || (point >= 0xD800 && point <= 0xDFFF);
    }))) return null;
  if (cursor !== undefined && (typeof cursor !== "string" || !publicCursor.test(cursor))) return null;
  return { storeId: store, query, ...(typeof cursor === "string" ? { cursor } : {}) };
}

export function publishedOfferHref(scope: PublishedOfferQuery): string {
  const params = new URLSearchParams({ store: scope.storeId });
  if (scope.query) params.set("q", scope.query);
  if (scope.cursor) params.set("cursor", scope.cursor);
  return `/catalog?${params.toString()}`;
}
