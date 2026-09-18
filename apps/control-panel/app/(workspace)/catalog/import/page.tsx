"use client";

import { CatalogImportWorkspace } from "../../../../src/features/central-catalog/catalog-import-workspace";
import { CatalogWorkspace } from "../../../../src/features/central-catalog/catalog-workspace";

export default function CatalogImportPage() {
  return <CatalogWorkspace resource="import"><CatalogImportWorkspace /></CatalogWorkspace>;
}
