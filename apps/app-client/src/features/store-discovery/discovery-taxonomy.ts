import type { CatalogCategory, PublicCommerceVertical } from "@bthwani/dsh";

export function normalizeDiscoveryTaxonomy(verticals: unknown, categories: unknown): {
  verticals: ReadonlyArray<PublicCommerceVertical>;
  categories: ReadonlyArray<CatalogCategory>;
} {
  return {
    verticals: Array.isArray(verticals) ? verticals : [],
    categories: Array.isArray(categories) ? categories : [],
  };
}
