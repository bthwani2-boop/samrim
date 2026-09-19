"use client";

import { CatalogCategoryRegistry } from "../../../../src/features/central-catalog/catalog-category-registry";
import { CatalogWorkspace } from "../../../../src/features/central-catalog/catalog-workspace";

export default function CatalogCategoriesPage() {
  return <CatalogWorkspace resource="categories"><CatalogCategoryRegistry /></CatalogWorkspace>;
}
