"use client";

import { CatalogVerticalRegistry } from "../../../../src/features/central-catalog/catalog-vertical-registry";
import { PoliciesWorkspace } from "../../../../src/features/policies/policies-workspace";

export default function PolicyVerticalsPage() {
  return <PoliciesWorkspace resource="verticals"><CatalogVerticalRegistry /></PoliciesWorkspace>;
}
