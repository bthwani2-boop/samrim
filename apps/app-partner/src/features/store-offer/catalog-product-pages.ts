import type { CatalogProduct } from "@bthwani/dsh";

export function mergeCatalogProductPage(
  current: ReadonlyArray<CatalogProduct>,
  page: ReadonlyArray<CatalogProduct>,
  append: boolean,
): ReadonlyArray<CatalogProduct> {
  if (!append) return page;
  const seen = new Set(current.map((product) => product.id));
  return [...current, ...page.filter((product) => !seen.has(product.id))];
}

export function replaceCatalogProductInPage(
  current: ReadonlyArray<CatalogProduct>,
  updated: CatalogProduct,
): ReadonlyArray<CatalogProduct> {
  return current.map((product) => product.id === updated.id ? updated : product);
}

export function isCurrentCatalogProductRequest(requestSequence: number, currentSequence: number): boolean {
  return requestSequence === currentSequence;
}

export function releaseCatalogProductPageRequest(activeSequence: number | null, requestSequence: number): number | null {
  return activeSequence === requestSequence ? null : activeSequence;
}
