export type TaxonomySort = "default" | "name_asc" | "name_desc";
export type TaxonomyKind = "all" | "vertical" | "type" | "category" | "shortcut";
export type TaxonomyStatus = "all" | "active" | "inactive";

export function buildCategoryListParams(input: Readonly<{
  verticalId: string;
  query: string;
  status: TaxonomyStatus;
  sort: TaxonomySort;
  cursor?: string | undefined;
}>): URLSearchParams {
  const params = new URLSearchParams({
    verticalId: input.verticalId,
    status: input.status,
    sort: input.sort === "name_desc" ? "name_desc" : "name_asc",
    limit: "100",
  });
  if (input.query.trim()) params.set("query", input.query.trim());
  if (input.cursor) params.set("cursor", input.cursor);
  return params;
}

export function isLoadedViewSort(kind: TaxonomyKind, hasNextCursor: boolean): boolean {
  return kind === "all" && hasNextCursor;
}

export function canLoadMoreCategories(kind: TaxonomyKind, hasNextCursor: boolean): boolean {
  return hasNextCursor && (kind === "all" || kind === "category");
}

export function taxonomyResultSummary(loadedCount: number, kind: TaxonomyKind, hasNextCursor: boolean): string {
  return canLoadMoreCategories(kind, hasNextCursor)
    ? `${loadedCount} عنصر محمّل؛ توجد فئات إضافية`
    : `${loadedCount} عنصر`;
}

export function sortTaxonomyRows<T extends Readonly<{ nameAr: string }>>(
  rows: ReadonlyArray<T>,
  sort: TaxonomySort,
  kind: TaxonomyKind,
): ReadonlyArray<T> {
  if (kind === "category" || sort === "default") return rows;
  const direction = sort === "name_asc" ? 1 : -1;
  return [...rows].sort((left, right) => direction * left.nameAr.localeCompare(right.nameAr, "ar"));
}