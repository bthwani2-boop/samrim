"use client";

import { CatalogAttributePolicyWorkspace } from "../../../../src/features/central-catalog/catalog-attribute-policy-workspace";
import { PoliciesWorkspace } from "../../../../src/features/policies/policies-workspace";

export default function PolicyAttributesPage() {
  return <PoliciesWorkspace resource="attributes"><CatalogAttributePolicyWorkspace /></PoliciesWorkspace>;
}
