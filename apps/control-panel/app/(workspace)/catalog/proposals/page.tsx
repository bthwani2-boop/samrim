"use client";

import { CatalogProposalReview } from "../../../../src/features/central-catalog/catalog-proposal-review";
import { CatalogWorkspace } from "../../../../src/features/central-catalog/catalog-workspace";

export default function CatalogProposalsPage() {
  return <CatalogWorkspace resource="proposals"><CatalogProposalReview /></CatalogWorkspace>;
}
