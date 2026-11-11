export type TaxonomySort = "default" | "name_asc" | "name_desc";
export type TaxonomyKind = "all" | "vertical" | "type" | "category" | "shortcut";
export type TaxonomyStatus = "all" | "active" | "inactive";
// Registry views never silently restrict the list of commercial activities to
// the last vertical selected while managing another kind of catalog item.
export function taxonomyResourceForView(view: Exclude<TaxonomyKind, "all">): "categories" | "types" | "shortcuts" | "none" {
  switch (view) {
    case "category": return "categories";
    case "type": return "types";
    case "shortcut": return "shortcuts";
    case "vertical": return "none";
  }
}

export function visibleTaxonomyVertical(view: TaxonomyKind, selectedVerticalId: string, candidateId: string): boolean {
  return view === "vertical" || !selectedVerticalId || selectedVerticalId === candidateId;
}

export function matchesTaxonomyName(
  item: Readonly<{ nameAr: string; nameEn: string }>,
  query: string,
): boolean {
  const normalized = query.trim().toLocaleLowerCase("ar");
  return !normalized || [item.nameAr, item.nameEn].some((name) => name.toLocaleLowerCase("ar").includes(normalized));
}

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

export type ShortcutCategoryOption = Readonly<{ id: string; nameAr: string; active: boolean; pathAr: string }>;

// Keep selected categories visible while the server-paginated search shows a
// different page; dropping an ID from selection removes it from this view.
export function retainSelectedCategoryOptions(
  selectedOptions: ReadonlyArray<ShortcutCategoryOption>,
  visibleOptions: ReadonlyArray<ShortcutCategoryOption>,
  selectedIds: ReadonlyArray<string>,
): ReadonlyArray<ShortcutCategoryOption> {
  const optionsById = new Map([...selectedOptions, ...visibleOptions].map((option) => [option.id, option]));
  return selectedIds.flatMap((id) => {
    const option = optionsById.get(id);
    return option ? [option] : [];
  });
}
