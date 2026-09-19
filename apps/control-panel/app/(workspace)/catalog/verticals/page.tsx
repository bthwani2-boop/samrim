"use client";

import { CatalogVerticalRegistry } from "../../../../src/features/central-catalog/catalog-vertical-registry";
import { CatalogWorkspace } from "../../../../src/features/central-catalog/catalog-workspace";

export default function CatalogVerticalsPage() {
  return <CatalogWorkspace resource="verticals"><CatalogVerticalRegistry /></CatalogWorkspace>;
}
