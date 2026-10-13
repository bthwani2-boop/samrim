/** Account roster pagination must filter before returning a page or its next cursor. */
export async function collectScopedPage<T, U>(input: Readonly<{
  limit: number;
  cursor: string;
  fetchPage: (limit: number, cursor: string) => Promise<Readonly<{ items: ReadonlyArray<T>; nextCursor?: string }>>;
  enrich: (item: T) => Promise<U>;
  matches: (item: U) => boolean;
}>): Promise<{ items: U[]; nextCursor: string | undefined }> {
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 50) throw new Error("INVALID_SCOPED_ROSTER_LIMIT");
  const collected: U[] = [];
  const visited = new Set<string>();
  let cursor = input.cursor;
  for (;;) {
    if (visited.has(cursor)) throw new Error("INVALID_SCOPED_ROSTER_CURSOR_CYCLE");
    visited.add(cursor);
    const remaining = input.limit - collected.length;
    const page = await input.fetchPage(remaining, cursor);
    if (page.items.length > remaining) throw new Error("INVALID_SCOPED_ROSTER_PAGE");
    const enriched = await Promise.all(page.items.map(input.enrich));
    collected.push(...enriched.filter(input.matches));
    if (page.nextCursor && visited.has(page.nextCursor)) throw new Error("INVALID_SCOPED_ROSTER_CURSOR_CYCLE");
    if (!page.nextCursor || collected.length === input.limit) return { items: collected, nextCursor: page.nextCursor };
    cursor = page.nextCursor;
  }
}
