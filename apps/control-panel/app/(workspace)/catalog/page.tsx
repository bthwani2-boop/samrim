"use client";

import { CatalogOverview, CatalogWorkspace } from "../../../src/features/central-catalog/catalog-workspace";

export default function CentralCatalogPage() {
  return <CatalogWorkspace resource="overview"><CatalogOverview /></CatalogWorkspace>;
}
