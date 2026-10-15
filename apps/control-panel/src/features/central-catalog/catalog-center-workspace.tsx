"use client";

import { LazyWorkspaceDisclosure } from "../shared/lazy-workspace-disclosure";
import { CentralCatalog } from "./central-catalog";
import { CatalogTaxonomyWorkspace } from "./catalog-taxonomy-workspace";
import { CatalogProposalReview } from "./catalog-proposal-review";

export function CatalogCenterWorkspace() {
  return <div className="catalog-center work-stack" data-testid="catalog-center">
    <p className="muted">المنتجات في سجل واحد. افتح إدارة الفئات أو المقترحات عند الحاجة، دون فقد قائمة المنتجات.</p>
    <section aria-label="أعمال الكتالوج المكملة" className="catalog-center-tools">
      <LazyWorkspaceDisclosure name="المجالات والفئات" description="إدارة الشجرة والفئات وقواعدها" className="catalog-center-disclosure">
        <CatalogTaxonomyWorkspace />
      </LazyWorkspaceDisclosure>
      <LazyWorkspaceDisclosure name="مقترحات الشركاء" description="مراجعة مقترحات المنتجات المرسلة" className="catalog-center-disclosure">
        <CatalogProposalReview />
      </LazyWorkspaceDisclosure>
    </section>
    <CentralCatalog />
  </div>;
}
