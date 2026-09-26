"use client";

import { CatalogTaxonomyWorkspace } from "../../../../src/features/central-catalog/catalog-taxonomy-workspace";
import { CatalogWorkspace } from "../../../../src/features/central-catalog/catalog-workspace";

export default function CatalogCategoriesPage() {
  return <CatalogWorkspace resource="categories"><CatalogTaxonomyWorkspace /></CatalogWorkspace>;
}
