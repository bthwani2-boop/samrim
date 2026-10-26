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
