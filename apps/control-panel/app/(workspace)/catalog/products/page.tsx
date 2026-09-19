"use client";

import { CatalogWorkspace } from "../../../../src/features/central-catalog/catalog-workspace";
import { CentralCatalog } from "../../../../src/features/central-catalog/central-catalog";

export default function CatalogProductsPage() {
  return <CatalogWorkspace resource="products"><CentralCatalog /></CatalogWorkspace>;
}
