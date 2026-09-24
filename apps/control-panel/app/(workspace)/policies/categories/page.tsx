"use client";

import { CatalogCategoryRegistry } from "../../../../src/features/central-catalog/catalog-category-registry";
import { PoliciesWorkspace } from "../../../../src/features/policies/policies-workspace";

export default function PolicyCategoriesPage() {
  return <PoliciesWorkspace resource="categories"><CatalogCategoryRegistry /></PoliciesWorkspace>;
}
