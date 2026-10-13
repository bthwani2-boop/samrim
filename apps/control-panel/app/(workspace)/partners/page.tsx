import Link from "next/link";
import { PageHeader } from "../../../src/shell/page-header";
import { PartnerDirectory } from "../../../src/features/partners/partner-directory";
import { PartnerOperatorBoundary } from "../../../src/features/partner-onboarding/partner-workspace";
import { StoreRegistry } from "../../../src/features/stores/store-registry";

export default async function PartnersPage({ searchParams }: Readonly<{ searchParams: Promise<{ view?: string }> }>) {
  const params = await searchParams;
  const accounts = params.view === "accounts";
  return (
    <PartnerOperatorBoundary>
      {accounts ? (
        <section className="workspace-page" aria-labelledby="partners-page-title">
          <PageHeader id="partners-page-title" title="حسابات الشركاء" actions={<Link className="button button-secondary" href="/partners">العودة إلى الشركاء والمتاجر</Link>} />
          <PartnerDirectory />
        </section>
      ) : (
        <StoreRegistry />
      )}
    </PartnerOperatorBoundary>
  );
}

export const metadata = { title: "الشركاء والمتاجر" };
